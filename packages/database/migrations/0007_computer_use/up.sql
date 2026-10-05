alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check check (status in (
  'CREATED', 'QUEUED', 'PLANNING', 'RUNNING', 'WAITING_FOR_UI',
  'WAITING_FOR_USER', 'RETRYING', 'RECOVERING', 'VERIFYING',
  'WAITING_APPROVAL', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED',
  'COMPLETED', 'PARTIALLY_COMPLETED'
));

create index missions_computer_use_active_idx on missions(priority desc, created_at)
  where status in (
    'QUEUED', 'PLANNING', 'RUNNING', 'WAITING_FOR_UI', 'WAITING_FOR_USER',
    'RETRYING', 'RECOVERING', 'VERIFYING', 'WAITING_APPROVAL'
  );

drop index if exists missions_recovery_idx;
create index missions_recovery_idx on missions (lease_expires_at, id)
  where status in ('PLANNING', 'RUNNING', 'RETRYING', 'RECOVERING', 'VERIFYING');

create table application_catalog (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  machine_id bigint not null references machines(id) on delete cascade,
  app_key text not null check (app_key ~ '^[a-z][a-z0-9._-]{1,63}$'),
  display_name text not null check (length(display_name) between 1 and 200),
  executable_path text not null,
  executable_sha256 text check (executable_sha256 is null or executable_sha256 ~ '^[a-f0-9]{64}$'),
  launch_profile jsonb not null default '{}'::jsonb,
  version_hint text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, app_key)
);

create table automation_profiles (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  application_id uuid not null references application_catalog(id) on delete cascade,
  profile_key text not null check (profile_key ~ '^[a-z][a-z0-9._-]{1,63}$'),
  profile_version integer not null check (profile_version > 0),
  application_version text,
  selectors jsonb not null default '[]'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  rollback_strategy jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, profile_key, profile_version)
);

create table computer_use_sessions (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  mission_id bigint not null references missions(id) on delete cascade,
  machine_id bigint not null references machines(id),
  application_id uuid references application_catalog(id),
  status text not null check (status in (
    'CREATED', 'OBSERVING', 'ACTING', 'VERIFYING', 'WAITING_FOR_UI',
    'WAITING_FOR_USER', 'TAKEOVER', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  control_mode text not null default 'AUTOMATION'
    check (control_mode in ('AUTOMATION', 'TAKEOVER', 'FOCUS')),
  target_fingerprint text,
  checkpoint jsonb,
  lease_owner text,
  lease_until timestamptz,
  emergency_stop boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id)
);

create unique index computer_use_global_ui_lease_idx
  on computer_use_sessions ((true))
  where lease_owner is not null and status in ('OBSERVING', 'ACTING', 'VERIFYING');

create table computer_use_actions (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  session_id uuid not null references computer_use_sessions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  action_hash text not null check (action_hash ~ '^[a-f0-9]{64}$'),
  channel text not null check (channel in ('CONNECTOR', 'CLI', 'UIA', 'BROWSER', 'VISION_INPUT')),
  risk text not null check (risk in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status text not null check (status in (
    'CREATED', 'AUTHORIZED', 'RUNNING', 'VERIFYING', 'COMPLETED',
    'UNKNOWN', 'FAILED', 'CANCELLED'
  )),
  request jsonb not null,
  before_proof jsonb,
  after_proof jsonb,
  verification jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, sequence),
  unique (session_id, action_hash)
);

create index computer_use_sessions_recovery_idx
  on computer_use_sessions (status, lease_until)
  where status in ('OBSERVING', 'ACTING', 'VERIFYING', 'WAITING_FOR_UI', 'WAITING_FOR_USER');

create index computer_use_actions_session_idx
  on computer_use_actions (session_id, sequence);

insert into schema_migrations(version) values ('0007_computer_use');
