delete from schema_migrations where version = '0005_model_routing';

alter table agent_runs
  drop column if exists model_change_approved,
  drop column if exists selection_scope,
  drop column if exists failure_reason,
  drop column if exists latency_ms,
  drop column if exists returned_model,
  drop column if exists requested_model;

drop table if exists model_selections;
drop table if exists model_catalog;
