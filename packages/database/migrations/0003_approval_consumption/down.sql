delete from schema_migrations where version = '0003_approval_consumption';
drop index if exists approvals_authorized_unconsumed_idx;
alter table approvals
  drop constraint if exists approvals_consumption_consistency_check,
  drop column if exists version,
  drop column if exists consumed_at,
  drop column if exists authorization_id,
  drop column if exists proof_method;
