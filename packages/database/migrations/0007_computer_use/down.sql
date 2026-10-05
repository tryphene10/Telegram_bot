delete from schema_migrations where version = '0007_computer_use';

drop table if exists computer_use_actions;
drop index if exists computer_use_sessions_recovery_idx;
drop index if exists computer_use_global_ui_lease_idx;
drop table if exists computer_use_sessions;
drop table if exists automation_profiles;
drop table if exists application_catalog;

update missions set status = 'PAUSED'
where status in ('WAITING_FOR_UI', 'WAITING_FOR_USER');
update missions set status = 'QUEUED'
where status in ('RETRYING', 'RECOVERING');
update missions set status = 'FAILED'
where status = 'PARTIALLY_COMPLETED';

alter table missions drop constraint if exists missions_status_check;
alter table missions add constraint missions_status_check check (status in (
  'CREATED', 'QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING',
  'WAITING_APPROVAL', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED', 'COMPLETED'
));

drop index if exists missions_computer_use_active_idx;

drop index if exists missions_recovery_idx;
create index missions_recovery_idx on missions (lease_expires_at, id)
  where status in ('PLANNING', 'RUNNING', 'VERIFYING');
