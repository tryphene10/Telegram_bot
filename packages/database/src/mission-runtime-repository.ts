import type { MissionStatus } from './states.js';
import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export interface QueuedMission {
  readonly publicId: string;
  readonly status: MissionStatus;
  readonly normalizedGoal: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly successCriteria: readonly string[];
  readonly definitionOfDone: readonly string[];
  readonly submissionSequence: number;
  readonly executionEpoch: number;
  readonly version: number;
}

interface MissionRuntimeRow {
  public_id: string;
  status: MissionStatus;
  normalized_goal: string;
  context: Record<string, unknown>;
  success_criteria: string[];
  definition_of_done: string[];
  submission_sequence: string | number;
  execution_epoch: number;
  version: number;
}

function mission(row: MissionRuntimeRow): QueuedMission {
  return {
    publicId: row.public_id,
    status: row.status,
    normalizedGoal: row.normalized_goal,
    context: row.context,
    successCriteria: row.success_criteria,
    definitionOfDone: row.definition_of_done,
    submissionSequence: Number(row.submission_sequence),
    executionEpoch: row.execution_epoch,
    version: row.version,
  };
}

export interface ActionReceipt {
  readonly publicId: string;
  readonly status: 'CLAIMED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly actionHash: string;
  readonly result?: Readonly<Record<string, unknown>>;
  readonly owned: boolean;
}

interface ActionReceiptRow {
  public_id: string;
  status: ActionReceipt['status'];
  action_hash: string;
  result_sanitized: Record<string, unknown> | null;
  owned: boolean;
}

export class MissionRuntimeRepository {
  constructor(private readonly sql: SqlClient) {}

  async enqueue(input: {
    readonly idempotencyKey: string;
    readonly userPublicId: string;
    readonly projectPublicId: string;
    readonly machinePublicId: string;
    readonly initialPrompt: string;
    readonly normalizedGoal: string;
    readonly context: Readonly<Record<string, unknown>>;
    readonly successCriteria: readonly string[];
    readonly definitionOfDone: readonly string[];
    readonly classification: 'PUBLIC' | 'CLOUD_SAFE' | 'LOCAL_ONLY' | 'SECRET';
    readonly requestedProvider?: string;
    readonly requestedModel?: string;
  }): Promise<QueuedMission> {
    const result = await this.sql.query<MissionRuntimeRow>(
      `insert into missions (
         user_id, project_id, machine_id, prompt_initial, normalized_goal, status,
         data_classification, requested_provider, requested_model, context,
         success_criteria, definition_of_done, idempotency_key, queued_at
       )
       select u.id, p.id, m.id, $4, $5, 'QUEUED', $6, $7, $8, $9::jsonb,
              $10::jsonb, $11::jsonb, $1, now()
       from users u, projects p, machines m
       where u.public_id = $2::uuid and p.public_id = $3::uuid and m.public_id = $12::uuid
       on conflict (idempotency_key) do update
         set idempotency_key = missions.idempotency_key
       returning public_id, status, normalized_goal, context, success_criteria,
                 definition_of_done, submission_sequence, execution_epoch, version`,
      [
        input.idempotencyKey,
        input.userPublicId,
        input.projectPublicId,
        input.initialPrompt,
        input.normalizedGoal,
        input.classification,
        input.requestedProvider ?? null,
        input.requestedModel ?? null,
        JSON.stringify(input.context),
        JSON.stringify(input.successCriteria),
        JSON.stringify(input.definitionOfDone),
        input.machinePublicId,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('mission_scope_not_found');
    return mission(row);
  }

  async claimNext(worker: string, leaseSeconds = 60): Promise<QueuedMission | null> {
    const result = await this.sql.query<MissionRuntimeRow>(
      `with candidate as (
         select id from missions
         where status = 'QUEUED' and cancellation_requested = false
         order by submission_sequence asc
         for update skip locked
         limit 1
       )
       update missions m
       set status = 'PLANNING', lease_owner = $1,
           lease_expires_at = now() + make_interval(secs => $2),
           execution_epoch = execution_epoch + 1,
           started_at = coalesce(started_at, now()), updated_at = now(), version = version + 1
       from candidate
       where m.id = candidate.id
       returning m.public_id, m.status, m.normalized_goal, m.context, m.success_criteria,
                 m.definition_of_done, m.submission_sequence, m.execution_epoch, m.version`,
      [worker, leaseSeconds],
    );
    return result.rows[0] ? mission(result.rows[0]) : null;
  }

  async renewLease(publicId: string, worker: string, leaseSeconds = 60): Promise<void> {
    const result = await this.sql.query(
      `update missions set lease_expires_at = now() + make_interval(secs => $3), updated_at = now()
       where public_id = $1::uuid and lease_owner = $2
         and status in ('PLANNING', 'RUNNING', 'VERIFYING')`,
      [publicId, worker, leaseSeconds],
    );
    if (result.rowCount !== 1) throw new ConcurrentUpdateError('mission lease', publicId);
  }

  async recoverExpired(): Promise<number> {
    const result = await this.sql.query(
      `update missions
       set status = case when cancellation_requested then 'CANCELLED' else 'QUEUED' end,
           lease_owner = null, lease_expires_at = null, updated_at = now(), version = version + 1
       where status in ('PLANNING', 'RUNNING', 'VERIFYING')
         and lease_expires_at < now()`,
    );
    return result.rowCount;
  }

  async acquireProjectLease(input: {
    readonly missionPublicId: string;
    readonly projectPublicId: string;
    readonly worker: string;
    readonly leaseSeconds?: number;
  }): Promise<boolean> {
    const result = await this.sql.query(
      `insert into project_execution_leases (project_id, mission_id, owner, expires_at)
       select p.id, m.id, $3, now() + make_interval(secs => $4)
       from projects p, missions m
       where p.public_id = $1::uuid and m.public_id = $2::uuid
       on conflict (project_id) do update
         set mission_id = excluded.mission_id, owner = excluded.owner,
             expires_at = excluded.expires_at, updated_at = now()
       where project_execution_leases.expires_at < now()
          or (project_execution_leases.mission_id = excluded.mission_id
              and project_execution_leases.owner = excluded.owner)
       returning project_id`,
      [input.projectPublicId, input.missionPublicId, input.worker, input.leaseSeconds ?? 60],
    );
    return result.rowCount === 1;
  }

  async reserveAction(input: {
    readonly missionPublicId: string;
    readonly stepPublicId: string;
    readonly idempotencyKey: string;
    readonly actionHash: string;
    readonly worker: string;
    readonly leaseSeconds?: number;
  }): Promise<ActionReceipt> {
    const result = await this.sql.query<ActionReceiptRow>(
      `with inserted as (
         insert into mission_action_receipts (
           mission_id, mission_step_id, idempotency_key, action_hash,
           status, lease_owner, lease_expires_at
         )
         select m.id, s.id, $3, $4, 'CLAIMED', $5,
                now() + make_interval(secs => $6)
         from missions m join mission_steps s on s.mission_id = m.id
         where m.public_id = $1::uuid and s.public_id = $2::uuid
         on conflict (idempotency_key) do nothing
         returning public_id, status, action_hash, result_sanitized, true as owned
       )
       select * from inserted
       union all
       select public_id, status, action_hash, result_sanitized, false as owned
       from mission_action_receipts
       where idempotency_key = $3 and not exists (select 1 from inserted)
       limit 1`,
      [
        input.missionPublicId,
        input.stepPublicId,
        input.idempotencyKey,
        input.actionHash,
        input.worker,
        input.leaseSeconds ?? 60,
      ],
    );
    const row = result.rows[0];
    if (!row || row.action_hash !== input.actionHash)
      throw new Error('action_idempotency_conflict');
    return {
      publicId: row.public_id,
      status: row.status,
      actionHash: row.action_hash,
      ...(row.result_sanitized === null ? {} : { result: row.result_sanitized }),
      owned: row.owned,
    };
  }

  async completeAction(
    receiptPublicId: string,
    worker: string,
    resultSanitized: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const result = await this.sql.query(
      `update mission_action_receipts
       set status = 'COMPLETED', result_sanitized = $3::jsonb,
           completed_at = now(), lease_expires_at = null
       where public_id = $1::uuid and status = 'CLAIMED' and lease_owner = $2`,
      [receiptPublicId, worker, JSON.stringify(resultSanitized)],
    );
    if (result.rowCount !== 1) throw new ConcurrentUpdateError('action receipt', receiptPublicId);
  }
}
