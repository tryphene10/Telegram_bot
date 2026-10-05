create extension if not exists pgcrypto;

create table schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table users (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  display_name text not null,
  role text not null default 'OWNER' constraint users_role_check check (role in ('OWNER', 'ADMINISTRATOR', 'OPERATOR', 'DEVELOPER', 'VIEWER')),
  status text not null default 'ACTIVE' constraint users_status_check check (status in ('ACTIVE', 'LOCKED', 'REVOKED')),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table telegram_accounts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  status text not null default 'ACTIVE' constraint telegram_accounts_status_check check (status in ('PENDING', 'ACTIVE', 'LOCKED', 'REVOKED')),
  failed_pin_attempts integer not null default 0 constraint telegram_accounts_failed_pin_attempts_check check (failed_pin_attempts >= 0),
  locked_until timestamptz,
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_accounts_user_unique unique (user_id)
);

create index telegram_accounts_user_id_idx on telegram_accounts(user_id);

create table machines (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  owner_id bigint not null references users(id) on delete restrict,
  name text not null,
  hostname text not null,
  os text not null,
  architecture text not null,
  agent_version text,
  status text not null default 'OFFLINE' constraint machines_status_check check (status in ('ONLINE', 'OFFLINE', 'BUSY', 'MAINTENANCE', 'REVOKED')),
  tags text[] not null default '{}',
  last_heartbeat_at timestamptz,
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machines_owner_name_unique unique (owner_id, name)
);

create index machines_owner_id_idx on machines(owner_id);
create index machines_status_heartbeat_idx on machines(status, last_heartbeat_at);

create table machine_capabilities (
  id bigint generated always as identity primary key,
  machine_id bigint not null references machines(id) on delete cascade,
  capability text not null,
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint machine_capabilities_machine_capability_unique unique (machine_id, capability)
);

create index machine_capabilities_machine_id_idx on machine_capabilities(machine_id);

create table projects (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  owner_id bigint not null references users(id) on delete restrict,
  primary_machine_id bigint references machines(id) on delete restrict,
  name text not null,
  description text,
  root_path text not null,
  repository_url text,
  default_branch text,
  stack jsonb not null default '{}'::jsonb,
  environment text not null default 'LOCAL' constraint projects_environment_check check (environment in ('LOCAL', 'DEVELOPMENT', 'STAGING', 'PRODUCTION')),
  status text not null default 'ACTIVE' constraint projects_status_check check (status in ('ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_owner_name_unique unique (owner_id, name),
  constraint projects_owner_root_unique unique (owner_id, root_path)
);

create index projects_owner_id_idx on projects(owner_id);
create index projects_primary_machine_id_idx on projects(primary_machine_id);

create table project_members (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  role text not null constraint project_members_role_check check (role in ('OWNER', 'OPERATOR', 'DEVELOPER', 'VIEWER')),
  created_at timestamptz not null default now(),
  constraint project_members_project_user_unique unique (project_id, user_id)
);

create index project_members_project_id_idx on project_members(project_id);
create index project_members_user_id_idx on project_members(user_id);

create table project_rules (
  id bigint generated always as identity primary key,
  project_id bigint not null references projects(id) on delete cascade,
  rule_key text not null,
  rule_value jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_rules_project_key_unique unique (project_id, rule_key)
);

create index project_rules_project_id_idx on project_rules(project_id);

create table agents (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  agent_key text not null unique,
  agent_type text not null,
  enabled boolean not null default false,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tools (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tool_key text not null unique,
  risk text not null constraint tools_risk_check check (risk in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  enabled boolean not null default false,
  requires_approval boolean not null default false,
  input_schema jsonb not null,
  output_schema jsonb not null,
  preconditions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table missions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references users(id) on delete restrict,
  project_id bigint references projects(id) on delete restrict,
  machine_id bigint references machines(id) on delete restrict,
  prompt_initial text not null,
  normalized_goal text,
  status text not null default 'CREATED' constraint missions_status_check check (status in ('CREATED', 'QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING', 'WAITING_APPROVAL', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED', 'COMPLETED')),
  priority smallint not null default 50 constraint missions_priority_check check (priority between 0 and 100),
  data_classification text not null default 'LOCAL_ONLY' constraint missions_classification_check check (data_classification in ('PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET')),
  requested_provider text,
  requested_model text,
  context jsonb not null default '{}'::jsonb,
  plan jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  final_report text,
  remaining_risks jsonb not null default '[]'::jsonb,
  version integer not null default 1 constraint missions_version_check check (version > 0),
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index missions_user_id_idx on missions(user_id);
create index missions_project_id_idx on missions(project_id);
create index missions_machine_id_idx on missions(machine_id);
create index missions_status_created_idx on missions(status, created_at desc);
create index missions_active_idx on missions(priority desc, created_at) where status in ('QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING', 'WAITING_APPROVAL');

create table mission_steps (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint not null references missions(id) on delete cascade,
  position integer not null constraint mission_steps_position_check check (position >= 0),
  title text not null,
  status text not null default 'PENDING' constraint mission_steps_status_check check (status in ('PENDING', 'RUNNING', 'WAITING_APPROVAL', 'BLOCKED', 'FAILED', 'CANCELLED', 'COMPLETED', 'SKIPPED')),
  agent_key text,
  tool_key text,
  risk text not null default 'LOW' constraint mission_steps_risk_check check (risk in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  exit_criteria jsonb not null default '[]'::jsonb,
  attempts integer not null default 0 constraint mission_steps_attempts_check check (attempts >= 0),
  max_attempts integer not null default 3 constraint mission_steps_max_attempts_check check (max_attempts between 1 and 20),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mission_steps_mission_position_unique unique (mission_id, position)
);

create index mission_steps_mission_id_idx on mission_steps(mission_id);
create index mission_steps_mission_status_idx on mission_steps(mission_id, status, position);

create table mission_events (
  id bigint generated always as identity primary key,
  mission_id bigint not null references missions(id) on delete cascade,
  sequence bigint not null constraint mission_events_sequence_check check (sequence > 0),
  event_type text not null,
  payload_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mission_events_mission_sequence_unique unique (mission_id, sequence)
);

create index mission_events_mission_id_idx on mission_events(mission_id);
create index mission_events_mission_created_idx on mission_events(mission_id, created_at, id);

create table approvals (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint not null references missions(id) on delete cascade,
  requested_by_agent_id bigint references agents(id) on delete set null,
  action_key text not null,
  action_hash text not null,
  parameters_sanitized jsonb not null,
  level text not null constraint approvals_level_check check (level in ('APPROVAL', 'STRONG_APPROVAL')),
  status text not null default 'PENDING' constraint approvals_status_check check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  expires_at timestamptz not null,
  decided_by_user_id bigint references users(id) on delete restrict,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint approvals_decision_consistency_check check ((status = 'PENDING' and decided_at is null) or status <> 'PENDING')
);

create index approvals_mission_id_idx on approvals(mission_id);
create index approvals_requested_by_agent_id_idx on approvals(requested_by_agent_id);
create index approvals_decided_by_user_id_idx on approvals(decided_by_user_id);
create index approvals_pending_expiry_idx on approvals(expires_at) where status = 'PENDING';

create table agent_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint not null references missions(id) on delete cascade,
  mission_step_id bigint references mission_steps(id) on delete cascade,
  agent_id bigint not null references agents(id) on delete restrict,
  provider text not null,
  model text not null,
  input_classification text not null constraint agent_runs_classification_check check (input_classification in ('PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET')),
  status text not null default 'CREATED' constraint agent_runs_status_check check (status in ('CREATED', 'RUNNING', 'FAILED', 'CANCELLED', 'COMPLETED')),
  input_tokens bigint not null default 0 constraint agent_runs_input_tokens_check check (input_tokens >= 0),
  output_tokens bigint not null default 0 constraint agent_runs_output_tokens_check check (output_tokens >= 0),
  cost_microunits bigint not null default 0 constraint agent_runs_cost_check check (cost_microunits >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index agent_runs_mission_id_idx on agent_runs(mission_id);
create index agent_runs_mission_step_id_idx on agent_runs(mission_step_id);
create index agent_runs_agent_id_idx on agent_runs(agent_id);
create index agent_runs_mission_created_idx on agent_runs(mission_id, created_at desc);

create table tool_executions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  execution_id uuid not null unique,
  mission_id bigint not null references missions(id) on delete cascade,
  mission_step_id bigint references mission_steps(id) on delete cascade,
  tool_id bigint not null references tools(id) on delete restrict,
  approval_id bigint references approvals(id) on delete restrict,
  status text not null default 'CREATED' constraint tool_executions_status_check check (status in ('CREATED', 'AUTHORIZED', 'RUNNING', 'CANCELLED', 'FAILED', 'COMPLETED')),
  risk text not null constraint tool_executions_risk_check check (risk in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  parameters_sanitized jsonb not null,
  result_sanitized jsonb,
  exit_code integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index tool_executions_mission_id_idx on tool_executions(mission_id);
create index tool_executions_mission_step_id_idx on tool_executions(mission_step_id);
create index tool_executions_tool_id_idx on tool_executions(tool_id);
create index tool_executions_approval_id_idx on tool_executions(approval_id);
create index tool_executions_mission_created_idx on tool_executions(mission_id, created_at desc);

create table files (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint references missions(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,
  direction text not null constraint files_direction_check check (direction in ('TELEGRAM_TO_MACHINE', 'MACHINE_TO_TELEGRAM', 'LOCAL')),
  original_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null constraint files_size_check check (size_bytes >= 0),
  sha256 text not null,
  classification text not null default 'LOCAL_ONLY' constraint files_classification_check check (classification in ('PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint files_parent_check check (mission_id is not null or project_id is not null)
);

create index files_mission_id_idx on files(mission_id);
create index files_project_id_idx on files(project_id);
create index files_expiry_idx on files(expires_at) where expires_at is not null;

create table artifacts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  mission_id bigint not null references missions(id) on delete cascade,
  file_id bigint references files(id) on delete set null,
  artifact_type text not null,
  title text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index artifacts_mission_id_idx on artifacts(mission_id);
create index artifacts_file_id_idx on artifacts(file_id);

create table memories (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint references users(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  scope text not null constraint memories_scope_check check (scope in ('SESSION', 'MISSION', 'PROJECT', 'USER_PREFERENCE')),
  content text not null,
  classification text not null default 'LOCAL_ONLY' constraint memories_classification_check check (classification in ('PUBLIC', 'CLOUD_SAFE', 'LOCAL_ONLY', 'SECRET')),
  source_path text,
  source_hash text,
  valid_at timestamptz not null default now(),
  invalidated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint memories_owner_check check (user_id is not null or project_id is not null or mission_id is not null)
);

create index memories_user_id_idx on memories(user_id);
create index memories_project_id_idx on memories(project_id);
create index memories_mission_id_idx on memories(mission_id);
create index memories_project_valid_idx on memories(project_id, valid_at desc) where invalidated_at is null;

create table secrets_metadata (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  owner_id bigint not null references users(id) on delete cascade,
  secret_key text not null,
  provider text,
  vault_reference text not null,
  status text not null default 'ACTIVE' constraint secrets_metadata_status_check check (status in ('ACTIVE', 'ROTATING', 'REVOKED')),
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint secrets_metadata_owner_key_unique unique (owner_id, secret_key)
);

create index secrets_metadata_owner_id_idx on secrets_metadata(owner_id);

create table audit_logs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  occurred_at timestamptz not null default now(),
  user_id bigint references users(id) on delete set null,
  machine_id bigint references machines(id) on delete set null,
  project_id bigint references projects(id) on delete set null,
  mission_id bigint references missions(id) on delete set null,
  agent_run_id bigint references agent_runs(id) on delete set null,
  tool_execution_id bigint references tool_executions(id) on delete set null,
  event_type text not null,
  action text not null,
  parameters_sanitized jsonb not null default '{}'::jsonb,
  result_sanitized jsonb,
  risk text constraint audit_logs_risk_check check (risk is null or risk in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  approval_public_id uuid,
  duration_ms bigint constraint audit_logs_duration_check check (duration_ms is null or duration_ms >= 0),
  correlation_id uuid not null,
  previous_hash text,
  entry_hash text not null
);

create index audit_logs_user_id_idx on audit_logs(user_id);
create index audit_logs_machine_id_idx on audit_logs(machine_id);
create index audit_logs_project_id_idx on audit_logs(project_id);
create index audit_logs_mission_id_idx on audit_logs(mission_id);
create index audit_logs_agent_run_id_idx on audit_logs(agent_run_id);
create index audit_logs_tool_execution_id_idx on audit_logs(tool_execution_id);
create index audit_logs_mission_time_idx on audit_logs(mission_id, occurred_at, id);
create index audit_logs_correlation_id_idx on audit_logs(correlation_id);

create function reject_audit_log_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_append_only
before update or delete on audit_logs
for each row execute function reject_audit_log_mutation();

create function append_audit_log(
  p_event_type text,
  p_action text,
  p_correlation_id uuid,
  p_parameters_sanitized jsonb default '{}'::jsonb,
  p_result_sanitized jsonb default null,
  p_risk text default null,
  p_user_id bigint default null,
  p_machine_id bigint default null,
  p_project_id bigint default null,
  p_mission_id bigint default null,
  p_agent_run_id bigint default null,
  p_tool_execution_id bigint default null,
  p_approval_public_id uuid default null,
  p_duration_ms bigint default null
) returns uuid
language plpgsql
as $$
declare
  v_occurred_at timestamptz := clock_timestamp();
  v_previous_hash text;
  v_entry_hash text;
  v_public_id uuid;
begin
  perform pg_advisory_xact_lock(918273645);
  select entry_hash into v_previous_hash
  from audit_logs
  order by id desc
  limit 1;

  v_entry_hash := encode(
    digest(
      concat_ws(
        '|',
        coalesce(v_previous_hash, ''),
        v_occurred_at::text,
        p_event_type,
        p_action,
        p_correlation_id::text,
        p_parameters_sanitized::text,
        coalesce(p_result_sanitized::text, ''),
        coalesce(p_risk, '')
      ),
      'sha256'
    ),
    'hex'
  );

  insert into audit_logs (
    occurred_at, user_id, machine_id, project_id, mission_id,
    agent_run_id, tool_execution_id, event_type, action,
    parameters_sanitized, result_sanitized, risk, approval_public_id,
    duration_ms, correlation_id, previous_hash, entry_hash
  ) values (
    v_occurred_at, p_user_id, p_machine_id, p_project_id, p_mission_id,
    p_agent_run_id, p_tool_execution_id, p_event_type, p_action,
    p_parameters_sanitized, p_result_sanitized, p_risk, p_approval_public_id,
    p_duration_ms, p_correlation_id, v_previous_hash, v_entry_hash
  )
  returning public_id into v_public_id;

  return v_public_id;
end;
$$;

revoke update, delete on audit_logs from public;

create table notifications (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references users(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  channel text not null constraint notifications_channel_check check (channel in ('TELEGRAM', 'WEB')),
  level text not null constraint notifications_level_check check (level in ('SILENT', 'NORMAL', 'VERBOSE', 'SECURITY')),
  status text not null default 'PENDING' constraint notifications_status_check check (status in ('PENDING', 'SENT', 'FAILED', 'CANCELLED')),
  payload_sanitized jsonb not null,
  attempts integer not null default 0 constraint notifications_attempts_check check (attempts >= 0),
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on notifications(user_id);
create index notifications_mission_id_idx on notifications(mission_id);
create index notifications_pending_idx on notifications(scheduled_at) where status = 'PENDING';

create table scheduled_tasks (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references users(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,
  name text not null,
  trigger_type text not null constraint scheduled_tasks_trigger_check check (trigger_type in ('ONE_SHOT', 'CRON', 'RECURRENCE', 'EVENT')),
  schedule_expression text not null,
  mission_template jsonb not null,
  enabled boolean not null default false,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_tasks_user_name_unique unique (user_id, name)
);

create index scheduled_tasks_user_id_idx on scheduled_tasks(user_id);
create index scheduled_tasks_project_id_idx on scheduled_tasks(project_id);
create index scheduled_tasks_due_idx on scheduled_tasks(next_run_at) where enabled = true;

create table model_usage (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  agent_run_id bigint references agent_runs(id) on delete cascade,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0 constraint model_usage_input_tokens_check check (input_tokens >= 0),
  output_tokens bigint not null default 0 constraint model_usage_output_tokens_check check (output_tokens >= 0),
  cost_microunits bigint not null default 0 constraint model_usage_cost_check check (cost_microunits >= 0),
  occurred_at timestamptz not null default now()
);

create index model_usage_user_id_idx on model_usage(user_id);
create index model_usage_mission_id_idx on model_usage(mission_id);
create index model_usage_agent_run_id_idx on model_usage(agent_run_id);
create index model_usage_provider_time_idx on model_usage(provider, occurred_at desc);

insert into schema_migrations(version) values ('0001_initial');
