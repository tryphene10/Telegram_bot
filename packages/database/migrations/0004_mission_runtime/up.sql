alter table missions
  add column submission_sequence bigint generated always as identity,
  add column idempotency_key text,
  add column definition_of_done jsonb not null default '[]'::jsonb,
  add column blocked_reason text,
  add column blocked_action text,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column cancellation_requested boolean not null default false,
  add column execution_epoch integer not null default 0;

alter table missions
  add constraint missions_idempotency_key_unique unique (idempotency_key),
  add constraint missions_blocked_context_check check (
    status <> 'BLOCKED' or (blocked_reason is not null and blocked_action is not null)
  );

drop index if exists missions_active_idx;
create index missions_fifo_idx
  on missions (submission_sequence)
  where status = 'QUEUED';
create index missions_recovery_idx
  on missions (lease_expires_at)
  where status in ('PLANNING', 'RUNNING', 'VERIFYING');

alter table mission_steps
  add column dependencies jsonb not null default '[]'::jsonb,
  add column idempotency_key text,
  add column loop_count integer not null default 0,
  add column max_loops integer not null default 1,
  add column last_error_sanitized text,
  add column result_sanitized jsonb,
  add constraint mission_steps_idempotency_unique unique (mission_id, idempotency_key),
  add constraint mission_steps_loop_check check (
    loop_count >= 0 and max_loops between 1 and 20 and loop_count <= max_loops
  );

create table mission_action_receipts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint not null references missions(id) on delete cascade,
  mission_step_id bigint not null references mission_steps(id) on delete cascade,
  idempotency_key text not null unique,
  action_hash text not null,
  status text not null constraint mission_action_receipts_status_check
    check (status in ('CLAIMED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  result_sanitized jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index mission_action_receipts_recovery_idx
  on mission_action_receipts (lease_expires_at)
  where status = 'CLAIMED';

create table project_execution_leases (
  project_id bigint primary key references projects(id) on delete cascade,
  mission_id bigint not null references missions(id) on delete cascade,
  owner text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index project_execution_leases_expiry_idx on project_execution_leases (expires_at);

alter table tool_executions
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add column attempts integer not null default 0,
  add constraint tool_executions_attempts_check check (attempts between 0 and 20);

create index tool_executions_queue_idx on tool_executions (created_at, id)
  where status = 'AUTHORIZED';
create index tool_executions_recovery_idx on tool_executions (lease_expires_at)
  where status = 'RUNNING';

alter table notifications
  add column idempotency_key text,
  add column lease_owner text,
  add column lease_expires_at timestamptz,
  add constraint notifications_idempotency_unique unique (idempotency_key);

alter table scheduled_tasks
  add column lease_owner text,
  add column lease_expires_at timestamptz;

create unique index approvals_one_pending_action_idx
  on approvals (mission_id, action_hash)
  where status = 'PENDING';

insert into schema_migrations(version) values ('0004_mission_runtime');
