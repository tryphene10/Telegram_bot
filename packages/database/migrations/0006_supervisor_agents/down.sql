delete from schema_migrations where version = '0006_supervisor_agents';

drop index if exists agent_runs_active_budget_idx;

alter table agent_runs
  drop column if exists exit_reason,
  drop column if exists iteration_count,
  drop column if exists tool_calls,
  drop column if exists ai_calls,
  drop column if exists maximum_wall_clock_ms,
  drop column if exists maximum_iterations,
  drop column if exists maximum_tool_calls,
  drop column if exists maximum_ai_calls;

alter table mission_steps
  drop column if exists maximum_tool_calls,
  drop column if exists model_change_approved,
  drop column if exists requested_model,
  drop column if exists requested_provider;

delete from agents
where agent_key in ('SUPERVISOR', 'DEVELOPER', 'TESTING', 'FILE', 'SECURITY_REVIEWER', 'DEVOPS')
  and configuration ->> 'managedBy' = '0006_supervisor_agents';
