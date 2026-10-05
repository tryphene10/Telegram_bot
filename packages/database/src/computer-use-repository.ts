import { ConcurrentUpdateError, type SqlClient } from './sql.js';

export type ComputerUseSessionStatus =
  | 'CREATED'
  | 'OBSERVING'
  | 'ACTING'
  | 'VERIFYING'
  | 'WAITING_FOR_UI'
  | 'WAITING_FOR_USER'
  | 'TAKEOVER'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface ComputerUseSession {
  readonly publicId: string;
  readonly status: ComputerUseSessionStatus;
  readonly controlMode: 'AUTOMATION' | 'TAKEOVER' | 'FOCUS';
  readonly targetFingerprint?: string;
  readonly checkpoint?: Readonly<Record<string, unknown>>;
  readonly emergencyStop: boolean;
}

export interface ComputerUseActionReservation {
  readonly publicId: string;
  readonly status:
    | 'CREATED'
    | 'AUTHORIZED'
    | 'RUNNING'
    | 'VERIFYING'
    | 'COMPLETED'
    | 'UNKNOWN'
    | 'FAILED'
    | 'CANCELLED';
  readonly actionHash: string;
  readonly owned: boolean;
  readonly replayAllowed: boolean;
  readonly verification?: Readonly<Record<string, unknown>>;
}

interface SessionRow {
  public_id: string;
  status: ComputerUseSessionStatus;
  control_mode: ComputerUseSession['controlMode'];
  target_fingerprint: string | null;
  checkpoint: Record<string, unknown> | null;
  emergency_stop: boolean;
}

interface ActionRow {
  public_id: string;
  status: ComputerUseActionReservation['status'];
  action_hash: string;
  owned: boolean;
  verification: Record<string, unknown> | null;
}

function mapSession(row: SessionRow): ComputerUseSession {
  return {
    publicId: row.public_id,
    status: row.status,
    controlMode: row.control_mode,
    ...(row.target_fingerprint ? { targetFingerprint: row.target_fingerprint } : {}),
    ...(row.checkpoint ? { checkpoint: row.checkpoint } : {}),
    emergencyStop: row.emergency_stop,
  };
}

export class ComputerUseRepository {
  constructor(private readonly sql: SqlClient) {}

  async createSession(input: {
    readonly missionPublicId: string;
    readonly machinePublicId: string;
    readonly applicationPublicId?: string;
    readonly targetFingerprint?: string;
  }): Promise<ComputerUseSession> {
    const result = await this.sql.query<SessionRow>(
      `insert into computer_use_sessions (
         mission_id, machine_id, application_id, status, target_fingerprint
       )
       select m.id, machine.id, app.id, 'CREATED', $4
       from missions m
       join machines machine on machine.public_id = $2::uuid
       left join application_catalog app on app.public_id = $3::uuid
       where m.public_id = $1::uuid
         and ($3::uuid is null or app.id is not null)
       on conflict (mission_id) do update
         set target_fingerprint = excluded.target_fingerprint, updated_at = now()
       returning public_id, status, control_mode, target_fingerprint, checkpoint, emergency_stop`,
      [
        input.missionPublicId,
        input.machinePublicId,
        input.applicationPublicId ?? null,
        input.targetFingerprint ?? null,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('computer_use_scope_not_found');
    return mapSession(row);
  }

  async loadSession(sessionPublicId: string): Promise<ComputerUseSession | undefined> {
    const result = await this.sql.query<SessionRow>(
      `select public_id, status, control_mode, target_fingerprint, checkpoint, emergency_stop
       from computer_use_sessions where public_id = $1::uuid`,
      [sessionPublicId],
    );
    const row = result.rows[0];
    return row ? mapSession(row) : undefined;
  }

  async reserveAction(input: {
    readonly sessionPublicId: string;
    readonly sequence: number;
    readonly actionHash: string;
    readonly channel: 'CONNECTOR' | 'CLI' | 'UIA' | 'BROWSER' | 'VISION_INPUT';
    readonly risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    readonly request: Readonly<Record<string, unknown>>;
  }): Promise<ComputerUseActionReservation> {
    const result = await this.sql.query<ActionRow>(
      `with inserted as (
         insert into computer_use_actions (
           session_id, sequence, action_hash, channel, risk, status, request, started_at
         )
         select session.id, $2, $3, $4, $5, 'RUNNING', $6::jsonb, now()
         from computer_use_sessions session
         where session.public_id = $1::uuid and session.emergency_stop = false
         on conflict (session_id, action_hash) do nothing
         returning public_id, status, action_hash, verification, true as owned
       )
       select * from inserted
       union all
       select action.public_id, action.status, action.action_hash, action.verification, false as owned
       from computer_use_actions action
       join computer_use_sessions session on session.id = action.session_id
       where session.public_id = $1::uuid and action.action_hash = $3
         and not exists (select 1 from inserted)
       limit 1`,
      [
        input.sessionPublicId,
        input.sequence,
        input.actionHash,
        input.channel,
        input.risk,
        JSON.stringify(input.request),
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('computer_use_session_not_available');
    return {
      publicId: row.public_id,
      status: row.status,
      actionHash: row.action_hash,
      owned: row.owned,
      replayAllowed: row.owned,
      ...(row.verification ? { verification: row.verification } : {}),
    };
  }

  async completeAction(input: {
    readonly actionPublicId: string;
    readonly afterProof: Readonly<Record<string, unknown>>;
    readonly verification: Readonly<Record<string, unknown>>;
  }): Promise<void> {
    const result = await this.sql.query(
      `update computer_use_actions
       set status = 'COMPLETED', after_proof = $2::jsonb, verification = $3::jsonb,
           finished_at = now()
       where public_id = $1::uuid and status in ('RUNNING', 'VERIFYING')`,
      [input.actionPublicId, JSON.stringify(input.afterProof), JSON.stringify(input.verification)],
    );
    if (result.rowCount !== 1)
      throw new ConcurrentUpdateError('computer use action', input.actionPublicId);
  }

  async recoverInterrupted(
    sessionPublicId: string,
    currentTargetFingerprint: string,
  ): Promise<ComputerUseSession> {
    const result = await this.sql.query<SessionRow>(
      `with target as (
         select id, checkpoint, target_fingerprint, emergency_stop
         from computer_use_sessions where public_id = $1::uuid
       ), unknown_actions as (
         update computer_use_actions action
         set status = 'UNKNOWN', error_code = 'CONNECTION_LOST_OUTCOME_UNKNOWN', finished_at = now()
         from target
         where action.session_id = target.id and action.status in ('RUNNING', 'VERIFYING')
         returning action.id
       )
       update computer_use_sessions session
       set status = case
             when target.emergency_stop then 'CANCELLED'
             when target.checkpoint is null then 'WAITING_FOR_USER'
             when target.target_fingerprint is distinct from $2 then 'WAITING_FOR_USER'
             when exists (select 1 from unknown_actions) then 'WAITING_FOR_USER'
             else 'OBSERVING'
           end,
           lease_owner = null, lease_until = null, updated_at = now()
       from target
       where session.id = target.id
       returning session.public_id, session.status, session.control_mode,
                 session.target_fingerprint, session.checkpoint, session.emergency_stop`,
      [sessionPublicId, currentTargetFingerprint],
    );
    const row = result.rows[0];
    if (!row) throw new Error('computer_use_session_not_found');
    return mapSession(row);
  }

  async acquireUiLease(input: {
    readonly sessionPublicId: string;
    readonly owner: string;
    readonly leaseSeconds?: number;
  }): Promise<boolean> {
    const result = await this.sql.query(
      `with expired as (
         update computer_use_sessions
         set lease_owner = null, lease_until = null, status = 'WAITING_FOR_UI', updated_at = now()
         where lease_until < now() and lease_owner is not null
       )
       update computer_use_sessions target
       set lease_owner = $2, lease_until = now() + make_interval(secs => $3),
           status = 'OBSERVING', updated_at = now()
       where target.public_id = $1::uuid
         and target.emergency_stop = false
         and not exists (
           select 1 from computer_use_sessions other
           where other.id <> target.id and other.lease_owner is not null
             and other.lease_until >= now()
         )`,
      [input.sessionPublicId, input.owner, input.leaseSeconds ?? 30],
    );
    return result.rowCount === 1;
  }

  async checkpoint(
    sessionPublicId: string,
    checkpoint: Readonly<Record<string, unknown>>,
    targetFingerprint: string,
  ): Promise<void> {
    const result = await this.sql.query(
      `update computer_use_sessions
       set checkpoint = $2::jsonb, target_fingerprint = $3, updated_at = now()
       where public_id = $1::uuid and emergency_stop = false`,
      [sessionPublicId, JSON.stringify(checkpoint), targetFingerprint],
    );
    if (result.rowCount !== 1)
      throw new ConcurrentUpdateError('computer use session', sessionPublicId);
  }

  async setControlMode(
    sessionPublicId: string,
    mode: ComputerUseSession['controlMode'],
  ): Promise<void> {
    const status = mode === 'TAKEOVER' ? 'TAKEOVER' : 'WAITING_FOR_UI';
    const result = await this.sql.query(
      `update computer_use_sessions
       set control_mode = $2, status = $3, lease_owner = null, lease_until = null, updated_at = now()
       where public_id = $1::uuid and emergency_stop = false`,
      [sessionPublicId, mode, status],
    );
    if (result.rowCount !== 1)
      throw new ConcurrentUpdateError('computer use session', sessionPublicId);
  }

  async emergencyStop(sessionPublicId: string): Promise<void> {
    const result = await this.sql.query(
      `update computer_use_sessions
       set emergency_stop = true, status = 'CANCELLED', lease_owner = null,
           lease_until = null, updated_at = now()
       where public_id = $1::uuid`,
      [sessionPublicId],
    );
    if (result.rowCount !== 1)
      throw new ConcurrentUpdateError('computer use session', sessionPublicId);
  }
}
