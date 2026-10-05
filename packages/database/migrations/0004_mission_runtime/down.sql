delete from schema_migrations where version = '0004_mission_runtime';

drop index if exists approvals_one_pending_action_idx;

alter table scheduled_tasks
  drop column if exists lease_expires_at,
  drop column if exists lease_owner;

alter table notifications
  drop constraint if exists notifications_idempotency_unique,
  drop column if exists lease_expires_at,
  drop column if exists lease_owner,
  drop column if exists idempotency_key;

drop index if exists tool_executions_recovery_idx;
drop index if exists tool_executions_queue_idx;
alter table tool_executions
  drop constraint if exists tool_executions_attempts_check,
  drop column if exists attempts,
  drop column if exists lease_expires_at,
  drop column if exists lease_owner;

drop table if exists project_execution_leases;
drop table if exists mission_action_receipts;

alter table mission_steps
  drop constraint if exists mission_steps_loop_check,
  drop constraint if exists mission_steps_idempotency_unique,
  drop column if exists result_sanitized,
  drop column if exists last_error_sanitized,
  drop column if exists max_loops,
  drop column if exists loop_count,
  drop column if exists idempotency_key,
  drop column if exists dependencies;

drop index if exists missions_recovery_idx;
drop index if exists missions_fifo_idx;

alter table missions
  drop constraint if exists missions_blocked_context_check,
  drop constraint if exists missions_idempotency_key_unique,
  drop column if exists execution_epoch,
  drop column if exists cancellation_requested,
  drop column if exists lease_expires_at,
  drop column if exists lease_owner,
  drop column if exists blocked_action,
  drop column if exists blocked_reason,
  drop column if exists definition_of_done,
  drop column if exists idempotency_key,
  drop column if exists submission_sequence;

create index missions_active_idx on missions(priority desc, created_at)
  where status in ('QUEUED', 'PLANNING', 'RUNNING', 'VERIFYING', 'WAITING_APPROVAL');
