import type { SqlClient } from './sql.js';

export type OperationalQueue = 'TOOLS' | 'APPROVALS' | 'NOTIFICATIONS' | 'SCHEDULED_TASKS';

export interface ClaimedQueueItem {
  readonly publicId: string;
  readonly missionPublicId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

interface QueueRow {
  public_id: string;
  mission_public_id: string | null;
  payload: Record<string, unknown>;
}

function item(row: QueueRow): ClaimedQueueItem {
  return {
    publicId: row.public_id,
    ...(row.mission_public_id === null ? {} : { missionPublicId: row.mission_public_id }),
    payload: row.payload,
  };
}

export class OperationalQueueRepository {
  constructor(private readonly sql: SqlClient) {}

  async claimTool(worker: string, leaseSeconds = 60): Promise<ClaimedQueueItem | null> {
    const result = await this.sql.query<QueueRow>(
      `with candidate as (
         select id from tool_executions
         where status = 'AUTHORIZED'
         order by created_at, id
         for update skip locked limit 1
       )
       update tool_executions t
       set status = 'RUNNING', lease_owner = $1,
           lease_expires_at = now() + make_interval(secs => $2),
           attempts = attempts + 1, started_at = coalesce(started_at, now())
       from candidate, missions m
       where t.id = candidate.id and m.id = t.mission_id
       returning t.public_id, m.public_id as mission_public_id,
                 jsonb_build_object('executionId', t.execution_id, 'parameters', t.parameters_sanitized) as payload`,
      [worker, leaseSeconds],
    );
    return result.rows[0] ? item(result.rows[0]) : null;
  }

  async claimNotification(worker: string, leaseSeconds = 60): Promise<ClaimedQueueItem | null> {
    const result = await this.sql.query<QueueRow>(
      `with candidate as (
         select n.id, m.public_id as mission_public_id
         from notifications n left join missions m on m.id = n.mission_id
         where n.status = 'PENDING' and n.scheduled_at <= now()
           and (n.lease_expires_at is null or n.lease_expires_at < now())
         order by n.scheduled_at, n.id
         for update skip locked limit 1
       )
       update notifications n
       set lease_owner = $1, lease_expires_at = now() + make_interval(secs => $2),
           attempts = attempts + 1
       from candidate
       where n.id = candidate.id
       returning n.public_id, candidate.mission_public_id, n.payload_sanitized as payload`,
      [worker, leaseSeconds],
    );
    return result.rows[0] ? item(result.rows[0]) : null;
  }

  async claimScheduledTask(worker: string, leaseSeconds = 60): Promise<ClaimedQueueItem | null> {
    const result = await this.sql.query<QueueRow>(
      `with candidate as (
         select id from scheduled_tasks
         where enabled = true and next_run_at <= now()
           and (lease_expires_at is null or lease_expires_at < now())
         order by next_run_at, id
         for update skip locked limit 1
       )
       update scheduled_tasks s
       set lease_owner = $1, lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
       from candidate
       where s.id = candidate.id
       returning s.public_id, null::uuid as mission_public_id,
                 jsonb_build_object('name', s.name, 'template', s.mission_template,
                                    'triggerType', s.trigger_type,
                                    'scheduleExpression', s.schedule_expression) as payload`,
      [worker, leaseSeconds],
    );
    return result.rows[0] ? item(result.rows[0]) : null;
  }

  async pendingApprovals(missionPublicId: string): Promise<readonly ClaimedQueueItem[]> {
    const result = await this.sql.query<QueueRow>(
      `select a.public_id, m.public_id as mission_public_id,
              jsonb_build_object('actionKey', a.action_key, 'actionHash', a.action_hash,
                                 'level', a.level, 'expiresAt', a.expires_at,
                                 'parameters', a.parameters_sanitized) as payload
       from approvals a join missions m on m.id = a.mission_id
       where m.public_id = $1::uuid and a.status = 'PENDING' and a.expires_at > now()
       order by a.created_at, a.id`,
      [missionPublicId],
    );
    return result.rows.map(item);
  }

  async recoverExpiredTools(): Promise<number> {
    const result = await this.sql.query(
      `update tool_executions
       set status = case when attempts >= 20 then 'FAILED' else 'AUTHORIZED' end,
           lease_owner = null, lease_expires_at = null
       where status = 'RUNNING' and lease_expires_at < now()`,
    );
    return result.rowCount;
  }
}
