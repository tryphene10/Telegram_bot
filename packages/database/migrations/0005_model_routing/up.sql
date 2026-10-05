create table model_catalog (
  id bigint generated always as identity primary key,
  provider text not null,
  model text not null,
  enabled boolean not null default false,
  available boolean not null default false,
  maximum_classification text not null
    check (maximum_classification in ('CLOUD_SAFE', 'SECRET')),
  context_tokens integer not null check (context_tokens > 0),
  maximum_output_tokens integer not null check (maximum_output_tokens > 0),
  capabilities jsonb not null default '{}'::jsonb,
  input_cost_microunits_per_million bigint not null default 0,
  output_cost_microunits_per_million bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (provider, model)
);

create table model_selections (
  id bigint generated always as identity primary key,
  user_id bigint not null references users(id) on delete cascade,
  mission_id bigint references missions(id) on delete cascade,
  agent_id bigint references agents(id) on delete cascade,
  provider text not null,
  model text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  constraint model_selections_scope_check check (
    (mission_id is null and agent_id is null)
    or (mission_id is not null and agent_id is null)
    or (mission_id is not null and agent_id is not null)
  )
);

create unique index model_selection_default_idx on model_selections (user_id)
  where mission_id is null and agent_id is null;
create unique index model_selection_mission_idx on model_selections (user_id, mission_id)
  where mission_id is not null and agent_id is null;
create unique index model_selection_agent_idx on model_selections (user_id, mission_id, agent_id)
  where mission_id is not null and agent_id is not null;

alter table agent_runs
  add column requested_model text,
  add column returned_model text,
  add column latency_ms bigint check (latency_ms is null or latency_ms >= 0),
  add column failure_reason text,
  add column selection_scope text check (
    selection_scope is null or selection_scope in ('DEFAULT', 'MISSION', 'AGENT')
  ),
  add column model_change_approved boolean not null default false;

update agent_runs set requested_model = model where requested_model is null;
alter table agent_runs alter column requested_model set not null;

insert into schema_migrations(version) values ('0005_model_routing');
