insert into agents (agent_key, agent_type, enabled, configuration)
values
  ('SUPERVISOR', 'SUPERVISOR', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb),
  ('DEVELOPER', 'SPECIALIST', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb),
  ('TESTING', 'SPECIALIST', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb),
  ('FILE', 'SPECIALIST', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb),
  ('SECURITY_REVIEWER', 'SPECIALIST', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb),
  ('DEVOPS', 'SPECIALIST', true, '{"managedBy":"0006_supervisor_agents"}'::jsonb)
on conflict (agent_key) do nothing;

alter table mission_steps
  add column requested_provider text,
  add column requested_model text,
  add column model_change_approved boolean not null default false,
  add column maximum_tool_calls integer not null default 8
    check (maximum_tool_calls between 1 and 100);

alter table agent_runs
  add column maximum_ai_calls integer not null default 1
    check (maximum_ai_calls between 1 and 100),
  add column maximum_tool_calls integer not null default 8
    check (maximum_tool_calls between 1 and 100),
  add column maximum_iterations integer not null default 3
    check (maximum_iterations between 1 and 20),
  add column maximum_wall_clock_ms bigint not null default 120000
    check (maximum_wall_clock_ms between 1000 and 86400000),
  add column ai_calls integer not null default 0 check (ai_calls >= 0),
  add column tool_calls integer not null default 0 check (tool_calls >= 0),
  add column iteration_count integer not null default 0 check (iteration_count >= 0),
  add column exit_reason text;

create index agent_runs_active_budget_idx
  on agent_runs (mission_id, status)
  where status in ('CREATED', 'RUNNING');

insert into schema_migrations(version) values ('0006_supervisor_agents');
