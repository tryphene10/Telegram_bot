delete from schema_migrations where version='0009_scheduler_monitoring';
drop table if exists incident_events;
drop table if exists incidents;
drop table if exists monitor_samples;
drop table if exists monitor_definitions;
drop table if exists schedule_occurrences;
drop table if exists scheduler_control;
alter table scheduled_tasks
  drop column if exists event_key,
  drop column if exists blocked_reason,
  drop column if exists last_result_sanitized,
  drop column if exists daily_mission_budget,
  drop column if exists max_attempts,
  drop column if exists status,
  drop column if exists autonomy_level,
  drop column if exists window_end,
  drop column if exists window_start,
  drop column if exists catch_up_limit,
  drop column if exists catch_up_policy,
  drop column if exists timezone;
alter table scheduled_tasks drop constraint if exists scheduled_tasks_trigger_check;
update scheduled_tasks set trigger_type=case trigger_type when 'INTERVAL' then 'RECURRENCE' when 'LOCAL_EVENT' then 'EVENT' else trigger_type end;
alter table scheduled_tasks add constraint scheduled_tasks_trigger_check check (trigger_type in ('ONE_SHOT','CRON','RECURRENCE','EVENT'));
