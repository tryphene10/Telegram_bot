alter table scheduled_tasks drop constraint scheduled_tasks_trigger_check;
alter table scheduled_tasks
  add constraint scheduled_tasks_trigger_check check (trigger_type in ('ONE_SHOT','INTERVAL','CRON','LOCAL_EVENT')),
  add column timezone text not null default 'Africa/Douala',
  add column catch_up_policy text not null default 'LATEST_ONLY' constraint scheduled_tasks_catch_up_check check (catch_up_policy in ('SKIP','LATEST_ONLY','BOUNDED')),
  add column catch_up_limit integer not null default 1 constraint scheduled_tasks_catch_up_limit_check check (catch_up_limit between 1 and 100),
  add column window_start time,
  add column window_end time,
  add column autonomy_level text not null default 'EXECUTE_SAFE' constraint scheduled_tasks_autonomy_check check (autonomy_level in ('OBSERVE','ASSIST','EXECUTE_SAFE','AUTONOMOUS')),
  add column status text not null default 'ACTIVE' constraint scheduled_tasks_status_check check (status in ('ACTIVE','PAUSED','COMPLETED','BLOCKED')),
  add column max_attempts integer not null default 3 constraint scheduled_tasks_max_attempts_check check (max_attempts between 1 and 20),
  add column daily_mission_budget integer not null default 50 constraint scheduled_tasks_daily_budget_check check (daily_mission_budget between 1 and 10000),
  add column last_result_sanitized jsonb,
  add column blocked_reason text,
  add column event_key text;

create table scheduler_control (
  singleton boolean primary key default true constraint scheduler_control_singleton check (singleton),
  globally_paused boolean not null default false,
  autonomy_level text not null default 'EXECUTE_SAFE' constraint scheduler_control_autonomy_check check (autonomy_level in ('OBSERVE','ASSIST','EXECUTE_SAFE','AUTONOMOUS')),
  global_concurrency integer not null default 2 constraint scheduler_control_global_concurrency_check check (global_concurrency between 1 and 64),
  project_concurrency integer not null default 1 constraint scheduler_control_project_concurrency_check check (project_concurrency between 1 and 16),
  daily_mission_budget integer not null default 100 constraint scheduler_control_daily_budget_check check (daily_mission_budget between 1 and 100000),
  daily_notification_budget integer not null default 100 constraint scheduler_control_notification_budget_check check (daily_notification_budget between 1 and 100000),
  pause_generation bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into scheduler_control(singleton) values (true);

create table schedule_occurrences (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  schedule_id bigint not null references scheduled_tasks(id) on delete cascade,
  project_id bigint references projects(id) on delete restrict,
  occurrence_key text not null,
  due_at timestamptz not null,
  submission_sequence bigint generated always as identity,
  status text not null default 'PENDING' constraint schedule_occurrences_status_check check (status in ('PENDING','RUNNING','WAITING_APPROVAL','BLOCKED','FAILED','CANCELLED','COMPLETED','UNKNOWN')),
  attempts integer not null default 0 constraint schedule_occurrences_attempts_check check (attempts between 0 and 20),
  max_attempts integer not null default 3 constraint schedule_occurrences_max_attempts_check check (max_attempts between 1 and 20),
  idempotency_key text not null unique,
  action_hash text,
  mission_id bigint references missions(id) on delete set null,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  result_sanitized jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_occurrences_schedule_key_unique unique(schedule_id, occurrence_key)
);
create index schedule_occurrences_claim_idx on schedule_occurrences(due_at,submission_sequence) where status='PENDING';
create index schedule_occurrences_recovery_idx on schedule_occurrences(lease_expires_at) where status='RUNNING';
create index schedule_occurrences_project_status_idx on schedule_occurrences(project_id,status);

create table monitor_definitions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  user_id bigint not null references users(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,
  name text not null,
  monitor_type text not null constraint monitor_definitions_type_check check (monitor_type in ('HTTP','PROCESS','TCP','SERVICE')),
  target_sanitized jsonb not null,
  enabled boolean not null default false,
  interval_seconds integer not null default 60 constraint monitor_definitions_interval_check check (interval_seconds between 15 and 86400),
  timeout_ms integer not null default 5000 constraint monitor_definitions_timeout_check check (timeout_ms between 100 and 60000),
  failure_threshold integer not null default 3 constraint monitor_definitions_failure_check check (failure_threshold between 1 and 100),
  recovery_threshold integer not null default 2 constraint monitor_definitions_recovery_check check (recovery_threshold between 1 and 100),
  window_size integer not null default 5 constraint monitor_definitions_window_check check (window_size between 1 and 100),
  sensitive boolean not null default false,
  environment text not null default 'LOCAL' constraint monitor_definitions_environment_check check (environment in ('LOCAL','DEVELOPMENT','STAGING','PRODUCTION')),
  cooldown_seconds integer not null default 300 constraint monitor_definitions_cooldown_check check (cooldown_seconds between 0 and 86400),
  max_restarts integer not null default 1 constraint monitor_definitions_restart_check check (max_restarts between 0 and 20),
  next_sample_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitor_definitions_user_name_unique unique(user_id,name)
);
create index monitor_definitions_due_idx on monitor_definitions(next_sample_at,id) where enabled=true;

create table monitor_samples (
  id bigint generated always as identity primary key,
  monitor_id bigint not null references monitor_definitions(id) on delete cascade,
  sampled_at timestamptz not null default now(),
  available boolean not null,
  latency_ms integer constraint monitor_samples_latency_check check (latency_ms is null or latency_ms >= 0),
  status_code integer,
  error_code text,
  details_sanitized jsonb not null default '{}'::jsonb
);
create index monitor_samples_monitor_time_idx on monitor_samples(monitor_id,sampled_at desc,id desc);

create table incidents (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  monitor_id bigint not null references monitor_definitions(id) on delete cascade,
  incident_key text not null,
  status text not null default 'OPEN' constraint incidents_status_check check (status in ('OPEN','ACKNOWLEDGED','INVESTIGATING','RESOLVED','IGNORED')),
  severity text not null constraint incidents_severity_check check (severity in ('INFO','WARNING','ERROR','SECURITY')),
  consecutive_failures integer not null default 0,
  consecutive_successes integer not null default 0,
  notification_count integer not null default 0,
  grouped_count integer not null default 0,
  restart_count integer not null default 0,
  opened_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  cooldown_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index incidents_one_active_idx on incidents(monitor_id,incident_key) where status in ('OPEN','ACKNOWLEDGED','INVESTIGATING');
create index incidents_status_time_idx on incidents(status,last_seen_at desc);

create table incident_events (
  id bigint generated always as identity primary key,
  incident_id bigint not null references incidents(id) on delete cascade,
  event_type text not null,
  action_hash text,
  actor text not null,
  payload_sanitized jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index incident_events_incident_time_idx on incident_events(incident_id,created_at,id);

insert into schema_migrations(version) values ('0009_scheduler_monitoring');
