import { ConcurrentUpdateError, type SqlClient } from './sql.js';

interface ClaimRow {
  public_id: string;
  schedule_id: string;
  occurrence_key: string;
  idempotency_key: string;
  project_id: string | null;
  autonomy_level: 'OBSERVE' | 'ASSIST' | 'EXECUTE_SAFE' | 'AUTONOMOUS';
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  mission_template: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  pause_generation: string | number;
}
export class SchedulerRepository {
  constructor(private readonly sql: SqlClient) {}
  async control() {
    const value = await this.sql.query<{
      globally_paused: boolean;
      pause_generation: string | number;
    }>(`select globally_paused,pause_generation from scheduler_control where singleton=true`);
    const row = value.rows[0];
    if (!row) throw new Error('scheduler_control_missing');
    return { globallyPaused: row.globally_paused, pauseGeneration: Number(row.pause_generation) };
  }
  async setGlobalPause(paused: boolean): Promise<number> {
    const value = await this.sql.query<{ pause_generation: string | number }>(
      `update scheduler_control set globally_paused=$1,pause_generation=pause_generation+1,updated_at=now() where singleton=true returning pause_generation`,
      [paused],
    );
    return Number(value.rows[0]?.pause_generation ?? 0);
  }
  async setAutonomy(level: 'OBSERVE' | 'ASSIST' | 'EXECUTE_SAFE' | 'AUTONOMOUS'): Promise<void> {
    await this.sql.query(
      `update scheduler_control set autonomy_level=$1,updated_at=now() where singleton=true`,
      [level],
    );
  }
  async materialize(
    scheduleId: string,
    occurrences: readonly { readonly key: string; readonly dueAt: string }[],
  ): Promise<number> {
    if (!occurrences.length) return 0;
    const value = await this.sql.query(
      `insert into schedule_occurrences(schedule_id,project_id,occurrence_key,due_at,idempotency_key,max_attempts)
      select s.id,s.project_id,v.occurrence_key,v.due_at,'schedule:'||s.public_id||':'||v.occurrence_key,s.max_attempts
      from scheduled_tasks s cross join jsonb_to_recordset($2::jsonb) as v(occurrence_key text,due_at timestamptz)
      where s.public_id=$1::uuid on conflict(schedule_id,occurrence_key) do nothing`,
      [
        scheduleId,
        JSON.stringify(
          occurrences.map((item) => ({ occurrence_key: item.key, due_at: item.dueAt })),
        ),
      ],
    );
    return value.rowCount;
  }
  async dueSchedules(now: string) {
    const value = await this.sql.query<{
      public_id: string;
      project_id: string | null;
      trigger_type: 'ONE_SHOT' | 'INTERVAL' | 'CRON' | 'LOCAL_EVENT';
      schedule_expression: string;
      timezone: string;
      catch_up_policy: 'SKIP' | 'LATEST_ONLY' | 'BOUNDED';
      catch_up_limit: number;
      window_start: string | null;
      window_end: string | null;
      next_run_at: string | null;
    }>(
      `select s.public_id,(select public_id from projects where id=s.project_id) project_id,s.trigger_type,s.schedule_expression,s.timezone,s.catch_up_policy,s.catch_up_limit,s.window_start::text,s.window_end::text,s.next_run_at::text from scheduled_tasks s where s.enabled and s.status='ACTIVE' and s.next_run_at<=$1::timestamptz order by s.next_run_at,s.id`,
      [now],
    );
    return value.rows.map((row) => ({
      id: row.public_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      triggerType: row.trigger_type,
      expression: row.schedule_expression,
      timezone: row.timezone,
      catchUpPolicy: row.catch_up_policy,
      catchUpLimit: row.catch_up_limit,
      ...(row.window_start && row.window_end
        ? { window: { start: row.window_start.slice(0, 5), end: row.window_end.slice(0, 5) } }
        : {}),
      ...(row.next_run_at ? { nextRunAt: new Date(row.next_run_at).toISOString() } : {}),
    }));
  }
  async advanceSchedule(scheduleId: string, nextRunAt: string | undefined): Promise<void> {
    const value = await this.sql.query(
      `update scheduled_tasks set next_run_at=$2::timestamptz,last_run_at=case when $2::timestamptz is null then coalesce(last_run_at,now()) else last_run_at end,status=case when $2::timestamptz is null and trigger_type='ONE_SHOT' then 'COMPLETED' else status end,updated_at=now() where public_id=$1::uuid`,
      [scheduleId, nextRunAt ?? null],
    );
    if (value.rowCount !== 1) throw new ConcurrentUpdateError('schedule', scheduleId);
  }
  async claim(worker: string, leaseSeconds: number) {
    const value = await this.sql.query<ClaimRow>(
      `with control as(select * from scheduler_control where singleton=true and not globally_paused), candidate as(
      select o.id from schedule_occurrences o join scheduled_tasks s on s.id=o.schedule_id cross join control c
      where o.status='PENDING' and o.due_at<=now() and s.enabled and s.status='ACTIVE' and o.attempts<o.max_attempts
        and (o.lease_expires_at is null or o.lease_expires_at<now())
        and (select count(*) from schedule_occurrences where status='RUNNING')<c.global_concurrency
        and (o.project_id is null or (select count(*) from schedule_occurrences p where p.status='RUNNING' and p.project_id=o.project_id)<c.project_concurrency)
        and (select count(*) from schedule_occurrences d where d.created_at>=date_trunc('day',now()) and d.status<>'CANCELLED')<least(c.daily_mission_budget,s.daily_mission_budget)
      order by o.due_at,o.submission_sequence for update of o skip locked limit 1)
      update schedule_occurrences o set status='RUNNING',attempts=attempts+1,lease_owner=$1,lease_expires_at=now()+make_interval(secs=>$2),heartbeat_at=now(),started_at=coalesce(started_at,now()),updated_at=now()
      from candidate,scheduled_tasks s,scheduler_control c where o.id=candidate.id and s.id=o.schedule_id and c.singleton=true
      returning o.public_id,s.public_id schedule_id,o.occurrence_key,o.idempotency_key,(select public_id from projects where id=o.project_id) project_id,
        s.autonomy_level,coalesce(s.mission_template->>'risk','LOW') risk,s.mission_template,o.attempts,o.max_attempts,c.pause_generation`,
      [worker, leaseSeconds],
    );
    const row = value.rows[0];
    if (!row) return undefined;
    return {
      id: row.public_id,
      scheduleId: row.schedule_id,
      occurrenceKey: row.occurrence_key,
      idempotencyKey: row.idempotency_key,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      autonomyLevel: row.autonomy_level,
      risk: row.risk,
      missionTemplate: row.mission_template,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      pauseGeneration: Number(row.pause_generation),
    };
  }
  async heartbeat(id: string, worker: string, leaseSeconds: number): Promise<boolean> {
    const value = await this.sql.query(
      `update schedule_occurrences set heartbeat_at=now(),lease_expires_at=now()+make_interval(secs=>$3),updated_at=now() where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [id, worker, leaseSeconds],
    );
    return value.rowCount === 1;
  }
  async complete(
    id: string,
    worker: string,
    result: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.finish(id, worker, 'COMPLETED', result);
  }
  async block(id: string, worker: string, reason: string, actionHash?: string): Promise<void> {
    await this.finish(id, worker, 'BLOCKED', { reason, ...(actionHash ? { actionHash } : {}) });
  }
  async waitApproval(id: string, worker: string, actionHash: string): Promise<void> {
    const value = await this.sql.query(
      `update schedule_occurrences set status='WAITING_APPROVAL',action_hash=$3,lease_owner=null,lease_expires_at=null,updated_at=now() where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [id, worker, actionHash],
    );
    if (value.rowCount !== 1) throw new ConcurrentUpdateError('schedule occurrence', id);
  }
  async unknown(id: string, worker: string, errorCode: string): Promise<void> {
    const value = await this.sql.query(
      `update schedule_occurrences set status='UNKNOWN',error_code=$3,lease_owner=null,lease_expires_at=null,updated_at=now() where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [id, worker, errorCode],
    );
    if (value.rowCount !== 1) throw new ConcurrentUpdateError('schedule occurrence', id);
  }
  async fail(id: string, worker: string, errorCode: string, retryable: boolean): Promise<void> {
    const value = await this.sql.query(
      `update schedule_occurrences set status=case when $4 and attempts<max_attempts then 'PENDING' else 'FAILED' end,error_code=$3,lease_owner=null,lease_expires_at=null,updated_at=now() where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [id, worker, errorCode, retryable],
    );
    if (value.rowCount !== 1) throw new ConcurrentUpdateError('schedule occurrence', id);
  }
  async recoverExpired(): Promise<number> {
    const value = await this.sql.query(
      `update schedule_occurrences set status='UNKNOWN',error_code='LEASE_EXPIRED_OUTCOME_UNKNOWN',lease_owner=null,lease_expires_at=null,updated_at=now() where status='RUNNING' and lease_expires_at<now()`,
    );
    return value.rowCount;
  }
  async diagnostics() {
    const value = await this.sql.query<{
      paused: boolean;
      autonomy: string;
      pending: string | number;
      running: string | number;
      unknown: string | number;
      open_incidents: string | number;
    }>(
      `select c.globally_paused paused,c.autonomy_level autonomy,(select count(*) from schedule_occurrences where status='PENDING') pending,(select count(*) from schedule_occurrences where status='RUNNING') running,(select count(*) from schedule_occurrences where status='UNKNOWN') unknown,(select count(*) from incidents where status in('OPEN','ACKNOWLEDGED','INVESTIGATING')) open_incidents from scheduler_control c where singleton=true`,
    );
    return value.rows[0] ?? {};
  }
  async claimMonitor(worker: string, leaseSeconds: number) {
    const value = await this.sql.query<{
      public_id: string;
      monitor_type: 'HTTP' | 'PROCESS' | 'TCP' | 'SERVICE';
      target_sanitized: Record<string, unknown>;
      failure_threshold: number;
      recovery_threshold: number;
      window_size: number;
    }>(
      `with candidate as(select id from monitor_definitions where enabled and next_sample_at<=now() and (lease_expires_at is null or lease_expires_at<now()) order by next_sample_at,id for update skip locked limit 1) update monitor_definitions m set lease_owner=$1,lease_expires_at=now()+make_interval(secs=>$2),next_sample_at=now()+make_interval(secs=>m.interval_seconds),updated_at=now() from candidate where m.id=candidate.id returning m.public_id,m.monitor_type,m.target_sanitized,m.failure_threshold,m.recovery_threshold,m.window_size`,
      [worker, leaseSeconds],
    );
    const row = value.rows[0];
    return row
      ? {
          id: row.public_id,
          type: row.monitor_type,
          target: row.target_sanitized,
          failureThreshold: row.failure_threshold,
          recoveryThreshold: row.recovery_threshold,
          windowSize: row.window_size,
        }
      : undefined;
  }
  async releaseMonitor(monitorId: string, worker: string): Promise<void> {
    await this.sql.query(
      `update monitor_definitions set lease_owner=null,lease_expires_at=null,updated_at=now()
       where public_id=$1::uuid and lease_owner=$2`,
      [monitorId, worker],
    );
  }
  async recent(monitorId: string, limit: number) {
    const value = await this.sql.query<{
      available: boolean;
      latency_ms: number | null;
      status_code: number | null;
      error_code: string | null;
    }>(
      `select available,latency_ms,status_code,error_code from monitor_samples s join monitor_definitions m on m.id=s.monitor_id where m.public_id=$1::uuid order by sampled_at desc,s.id desc limit $2`,
      [monitorId, limit],
    );
    return [...value.rows].reverse().map((row) => ({
      available: row.available,
      ...(row.latency_ms === null ? {} : { latencyMs: row.latency_ms }),
      ...(row.status_code === null ? {} : { statusCode: row.status_code }),
      ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    }));
  }
  async saveSample(
    monitorId: string,
    sample: {
      readonly available: boolean;
      readonly latencyMs?: number;
      readonly statusCode?: number;
      readonly errorCode?: string;
    },
  ): Promise<void> {
    await this.sql.query(
      `insert into monitor_samples(monitor_id,available,latency_ms,status_code,error_code) select id,$2,$3,$4,$5 from monitor_definitions where public_id=$1::uuid`,
      [
        monitorId,
        sample.available,
        sample.latencyMs ?? null,
        sample.statusCode ?? null,
        sample.errorCode ?? null,
      ],
    );
  }
  async activeIncident(monitorId: string) {
    const value = await this.sql.query<{
      public_id: string;
      status: 'OPEN' | 'ACKNOWLEDGED' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
      consecutive_failures: number;
      consecutive_successes: number;
    }>(
      `select i.public_id,i.status,i.consecutive_failures,i.consecutive_successes from incidents i join monitor_definitions m on m.id=i.monitor_id where m.public_id=$1::uuid order by i.created_at desc limit 1`,
      [monitorId],
    );
    const row = value.rows[0];
    return row
      ? {
          id: row.public_id,
          status: row.status,
          consecutiveFailures: row.consecutive_failures,
          consecutiveSuccesses: row.consecutive_successes,
        }
      : undefined;
  }
  async transition(
    monitorId: string,
    evaluation: {
      readonly transition: 'NONE' | 'OPEN' | 'UPDATE' | 'RESOLVE' | 'REOPEN';
      readonly failures: number;
      readonly successes: number;
    },
    sample: { readonly available: boolean; readonly errorCode?: string },
  ): Promise<void> {
    if (evaluation.transition === 'NONE') return;
    if (evaluation.transition === 'OPEN' || evaluation.transition === 'REOPEN')
      await this.sql.query(
        `with m as(select id from monitor_definitions where public_id=$1::uuid),created as(insert into incidents(monitor_id,incident_key,severity,consecutive_failures,consecutive_successes) select id,$2,'ERROR',$3,$4 from m returning id),event as(insert into incident_events(incident_id,event_type,actor,payload_sanitized) select id,$5,'monitor',jsonb_build_object('available',$6,'errorCode',$7) from created) select count(*) from event`,
        [
          monitorId,
          `${monitorId}:${Date.now()}`,
          evaluation.failures,
          evaluation.successes,
          evaluation.transition,
          sample.available,
          sample.errorCode ?? null,
        ],
      );
    else
      await this.sql.query(
        `with target as(select i.id from incidents i join monitor_definitions m on m.id=i.monitor_id where m.public_id=$1::uuid and i.status in('OPEN','ACKNOWLEDGED','INVESTIGATING') order by i.created_at desc limit 1),changed as(update incidents i set status=case when $2='RESOLVE' then 'RESOLVED' else i.status end,consecutive_failures=$3,consecutive_successes=$4,last_seen_at=now(),resolved_at=case when $2='RESOLVE' then now() else resolved_at end,updated_at=now() from target where i.id=target.id returning i.id),event as(insert into incident_events(incident_id,event_type,actor,payload_sanitized) select id,$2,'monitor',jsonb_build_object('available',$5,'errorCode',$6) from changed) select count(*) from event`,
        [
          monitorId,
          evaluation.transition,
          evaluation.failures,
          evaluation.successes,
          sample.available,
          sample.errorCode ?? null,
        ],
      );
  }
  private async finish(
    id: string,
    worker: string,
    status: 'COMPLETED' | 'BLOCKED',
    result: Readonly<Record<string, unknown>>,
  ) {
    const value = await this.sql.query(
      `update schedule_occurrences set status=$3,result_sanitized=$4::jsonb,lease_owner=null,lease_expires_at=null,completed_at=case when $3='COMPLETED' then now() else completed_at end,updated_at=now() where public_id=$1::uuid and lease_owner=$2 and status='RUNNING'`,
      [id, worker, status, JSON.stringify(result)],
    );
    if (value.rowCount !== 1) throw new ConcurrentUpdateError('schedule occurrence', id);
  }
}
