$ErrorActionPreference = 'Stop'

$composeProject = 'arcc-phase02-test'
$composeFile = Join-Path $PSScriptRoot '..\infra\docker-compose.yml'
$migrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0001_initial\up.sql'
$migrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0001_initial\down.sql'
$projectMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0002_project_manifests\up.sql'
$projectMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0002_project_manifests\down.sql'
$approvalMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0003_approval_consumption\up.sql'
$approvalMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0003_approval_consumption\down.sql'
$runtimeMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0004_mission_runtime\up.sql'
$runtimeMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0004_mission_runtime\down.sql'
$modelMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0005_model_routing\up.sql'
$modelMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0005_model_routing\down.sql'
$supervisorMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0006_supervisor_agents\up.sql'
$supervisorMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0006_supervisor_agents\down.sql'
$computerUseMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0007_computer_use\up.sql'
$computerUseMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0007_computer_use\down.sql'
$knowledgeMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0008_local_knowledge\up.sql'
$knowledgeMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0008_local_knowledge\down.sql'
$schedulerMigrationUp = Join-Path $PSScriptRoot '..\packages\database\migrations\0009_scheduler_monitoring\up.sql'
$schedulerMigrationDown = Join-Path $PSScriptRoot '..\packages\database\migrations\0009_scheduler_monitoring\down.sql'
$env:POSTGRES_USER = 'arcc_test'
$env:POSTGRES_PASSWORD = 'phase02-ephemeral-password'
$env:POSTGRES_DB = 'arcc_test'
$env:POSTGRES_PORT = '55432'

function Invoke-PsqlFile {
  param([Parameter(Mandatory)][string]$Path)
  Get-Content -Raw -LiteralPath $Path | docker compose -p $composeProject -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $env:POSTGRES_USER -d $env:POSTGRES_DB
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for $Path"
  }
}

function Invoke-PsqlScalar {
  param([Parameter(Mandatory)][string]$Sql)
  $value = docker compose -p $composeProject -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -At -U $env:POSTGRES_USER -d $env:POSTGRES_DB -c $Sql
  if ($LASTEXITCODE -ne 0) {
    throw 'psql scalar query failed'
  }
  return ($value | Select-Object -Last 1).Trim()
}

try {
  docker compose -p $composeProject -f $composeFile up -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not start the isolated PostgreSQL container'
  }

  $ready = $false
  foreach ($attempt in 1..30) {
    docker compose -p $composeProject -f $composeFile exec -T postgres pg_isready -U $env:POSTGRES_USER -d $env:POSTGRES_DB *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'PostgreSQL did not become ready in time'
  }

  Invoke-PsqlFile -Path $migrationUp
  Invoke-PsqlFile -Path $projectMigrationUp
  Invoke-PsqlFile -Path $approvalMigrationUp
  Invoke-PsqlFile -Path $runtimeMigrationUp
  Invoke-PsqlFile -Path $modelMigrationUp
  Invoke-PsqlFile -Path $supervisorMigrationUp
  Invoke-PsqlFile -Path $computerUseMigrationUp
  Invoke-PsqlFile -Path $knowledgeMigrationUp
  Invoke-PsqlFile -Path $schedulerMigrationUp
  $tableCount = [int](Invoke-PsqlScalar -Sql "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';")
  if ($tableCount -lt 24) {
    throw "Expected at least 24 domain tables, got $tableCount"
  }
  $receiptTable = Invoke-PsqlScalar -Sql "select to_regclass('public.mission_action_receipts') is not null;"
  if ($receiptTable -ne 't') {
    throw 'Mission action receipts migration was not applied'
  }
  $specialistCount = [int](Invoke-PsqlScalar -Sql "select count(*) from agents where agent_key in ('SUPERVISOR', 'DEVELOPER', 'TESTING', 'FILE', 'SECURITY_REVIEWER', 'DEVOPS');")
  if ($specialistCount -ne 6) {
    throw "Expected six Supervisor agents, got $specialistCount"
  }
  $computerUseMigration = Invoke-PsqlScalar -Sql "select count(*) from schema_migrations where version = '0007_computer_use';"
  if ($computerUseMigration -ne '1') {
    throw 'Computer Use migration was not recorded'
  }
  $knowledgeMigration = Invoke-PsqlScalar -Sql "select count(*) from schema_migrations where version = '0008_local_knowledge';"
  if ($knowledgeMigration -ne '1') {
    throw 'Local knowledge migration was not recorded'
  }
  $schedulerMigration = Invoke-PsqlScalar -Sql "select count(*) from schema_migrations where version = '0009_scheduler_monitoring';"
  if ($schedulerMigration -ne '1') {
    throw 'Scheduler monitoring migration was not recorded'
  }

  $catalogEntry = Invoke-PsqlScalar -Sql "with owner as (insert into users(display_name) values ('computer-use-owner') returning id), machine as (insert into machines(owner_id,name,hostname,os,architecture) select id,'computer-use-machine','localhost','windows','x64' from owner returning id), app as (insert into application_catalog(machine_id,app_key,display_name,executable_path,launch_profile) select id,'fixture','Fixture','C:\\Apps\\fixture.exe',jsonb_build_object('windowTitles',jsonb_build_array('Fixture')) from machine returning public_id) select public_id from app;"
  if ([string]::IsNullOrWhiteSpace($catalogEntry)) {
    throw 'Application catalog entry was not created'
  }
  Invoke-PsqlScalar -Sql "update application_catalog set enabled = true where public_id = '$catalogEntry'::uuid returning public_id;" | Out-Null
  $enabledCatalog = Invoke-PsqlScalar -Sql "select count(*) from application_catalog where public_id = '$catalogEntry'::uuid and enabled = true;"
  if ($enabledCatalog -ne '1') {
    throw 'Application catalog entry was not enabled explicitly'
  }
  $sessionId = Invoke-PsqlScalar -Sql "with target as (select machine.id as machine_id, app.id as app_id, machine.owner_id from machines machine join application_catalog app on app.machine_id = machine.id where app.public_id = '$catalogEntry'::uuid), mission as (insert into missions(user_id,machine_id,prompt_initial) select owner_id,machine_id,'computer use integration' from target returning id), session as (insert into computer_use_sessions(mission_id,machine_id,application_id,status,lease_owner,lease_until) select mission.id,target.machine_id,target.app_id,'OBSERVING','integration-test',now()+interval '30 seconds' from mission cross join target returning public_id) select public_id from session;"
  Invoke-PsqlScalar -Sql "update computer_use_sessions set checkpoint = jsonb_build_object('id','checkpoint-1'),target_fingerprint = 'window-a' where public_id = '$sessionId'::uuid returning public_id;" | Out-Null
  Invoke-PsqlScalar -Sql "insert into computer_use_actions(session_id,sequence,action_hash,channel,risk,status,request,started_at) select id,1,repeat('a',64),'UIA','MEDIUM','RUNNING',jsonb_build_object('selector','save'),now() from computer_use_sessions where public_id = '$sessionId'::uuid returning public_id;" | Out-Null
  $recoveryState = Invoke-PsqlScalar -Sql "with target as (select id,checkpoint,target_fingerprint,emergency_stop from computer_use_sessions where public_id = '$sessionId'::uuid), unknown_actions as (update computer_use_actions action set status = 'UNKNOWN',error_code = 'CONNECTION_LOST_OUTCOME_UNKNOWN',finished_at = now() from target where action.session_id = target.id and action.status in ('RUNNING','VERIFYING') returning action.id,action.status), recovered as (update computer_use_sessions session set status = case when target.emergency_stop then 'CANCELLED' when target.checkpoint is null then 'WAITING_FOR_USER' when target.target_fingerprint is distinct from 'window-a' then 'WAITING_FOR_USER' when exists (select 1 from unknown_actions) then 'WAITING_FOR_USER' else 'OBSERVING' end,lease_owner = null,lease_until = null,updated_at = now() from target where session.id = target.id returning session.id,session.status,session.checkpoint) select recovered.status || ':' || unknown_actions.status || ':' || (recovered.checkpoint->>'id' = 'checkpoint-1')::text from recovered cross join unknown_actions;"
  if ($recoveryState -ne 'WAITING_FOR_USER:UNKNOWN:true') {
    throw "Unexpected Computer Use recovery state: $recoveryState"
  }
  $sessionState = Invoke-PsqlScalar -Sql "with stopped as (update computer_use_sessions set emergency_stop = true,status = 'CANCELLED',lease_owner = null,lease_until = null where public_id = '$sessionId'::uuid returning status,emergency_stop,lease_owner) select status || ':' || emergency_stop::text || ':' || (lease_owner is null)::text from stopped;"
  if ($sessionState -ne 'CANCELLED:true:true') {
    throw "Unexpected Computer Use emergency state: $sessionState"
  }

  $knowledgeProject = Invoke-PsqlScalar -Sql "with owner as (select owner_id from machines where name = 'computer-use-machine'), project as (insert into projects(owner_id,primary_machine_id,name,root_path) select owner.owner_id,machine.id,'knowledge-project','C:\Projects\knowledge' from owner join machines machine on machine.owner_id = owner.owner_id returning public_id) select public_id from project;"
  $knowledgeSource = Invoke-PsqlScalar -Sql "with target as (select id from projects where public_id = '$knowledgeProject'::uuid), source as (insert into knowledge_sources(project_id,source_type,relative_path,title,sha256,version,size_bytes,modified_at,git_head,git_dirty) select id,'README','README.md','README',repeat('a',64),1,20,now(),repeat('b',40),false from target returning id,public_id), chunk as (insert into knowledge_chunks(source_id,ordinal,section,anchor,start_offset,end_offset,content_sanitized,sha256,search_vector) select id,0,'Setup','setup',0,20,'verified local setup',repeat('c',64),to_tsvector('simple','verified local setup') from source returning source_id) select public_id from source;"
  Invoke-PsqlScalar -Sql "with source as (select id from knowledge_sources where public_id = '$knowledgeSource'::uuid), chunk as (select id,source_id from knowledge_chunks where source_id = (select id from source)), entry as (insert into memory_entries(project_id,source_id,scope,content_key,value,classification,sha256,version,source_path,source_hash) select knowledge_sources.project_id,knowledge_sources.id,'PROJECT','setup',jsonb_build_object('verified',true),'LOCAL_ONLY',repeat('d',64),1,'README.md',knowledge_sources.sha256 from knowledge_sources where knowledge_sources.id = (select id from source) returning id), embedding as (insert into knowledge_embeddings(chunk_id,model,dimension,namespace,vector,sha256) select id,'local-test',2,'local-test:2',array[0.1,0.2]::double precision[],repeat('e',64) from chunk returning id), job as (insert into knowledge_index_jobs(project_id,source_id,job_key,status,attempts,lease_owner,lease_until) select knowledge_sources.project_id,knowledge_sources.id,'reindex:test','RUNNING',1,'dead-worker',now()-interval '1 minute' from knowledge_sources where knowledge_sources.id = (select id from source) returning id) select (select count(*) from entry)+(select count(*) from embedding)+(select count(*) from job);" | Out-Null
  $knowledgeRecovery = Invoke-PsqlScalar -Sql "with recovered as (update knowledge_index_jobs set status = case when attempts >= 5 then 'FAILED' else 'RETRYING' end,lease_owner = null,lease_until = null,error_code = 'LEASE_EXPIRED' where status = 'RUNNING' and lease_until < now() returning status) select status || ':' || (select count(*) from knowledge_index_jobs)::text from recovered;"
  if ($knowledgeRecovery -ne 'RETRYING:1') {
    throw "Unexpected knowledge job recovery state: $knowledgeRecovery"
  }
  $knowledgeSearch = Invoke-PsqlScalar -Sql "select count(*) from knowledge_chunks where search_vector @@ websearch_to_tsquery('simple','verified setup');"
  if ($knowledgeSearch -ne '1') {
    throw 'Local lexical knowledge search failed'
  }
  $knowledgePurge = Invoke-PsqlScalar -Sql "with target as (select id,public_id from projects where public_id = '$knowledgeProject'::uuid), counts as (select (select count(*) from knowledge_sources where project_id=target.id) sources,(select count(*) from knowledge_chunks c join knowledge_sources s on s.id=c.source_id where s.project_id=target.id) chunks from target), deleted as (delete from knowledge_sources where project_id=(select id from target)), tombstone as (insert into memory_tombstones(project_public_id,reason,deleted_counts,purge_digest) select public_id,'integration purge',jsonb_build_object('sources',sources,'chunks',chunks),repeat('f',64) from target cross join counts returning public_id) select counts.sources || ':' || counts.chunks from counts cross join tombstone;"
  if ($knowledgePurge -ne '1:1') {
    throw "Unexpected knowledge purge report: $knowledgePurge"
  }
  $knowledgeResidual = Invoke-PsqlScalar -Sql "select (select count(*) from knowledge_sources)::text || ':' || (select count(*) from knowledge_chunks)::text || ':' || (select count(*) from knowledge_embeddings)::text || ':' || (select count(*) from memory_entries)::text || ':' || (select count(*) from memory_tombstones)::text;"
  if ($knowledgeResidual -ne '0:0:0:0:1') {
    throw "Knowledge purge left derived rows: $knowledgeResidual"
  }

  $scheduleId = Invoke-PsqlScalar -Sql "with owner as (select id from users where display_name='computer-use-owner'), project as (select id from projects where public_id='$knowledgeProject'::uuid), schedule as (insert into scheduled_tasks(user_id,project_id,name,trigger_type,schedule_expression,mission_template,enabled,next_run_at) select owner.id,project.id,'phase17-schedule','INTERVAL','PT15M',jsonb_build_object('goal','health','risk','LOW'),true,now()-interval '1 minute' from owner cross join project returning id,public_id), occurrence as (insert into schedule_occurrences(schedule_id,project_id,occurrence_key,due_at,idempotency_key) select schedule.id,project.id,'2026-10-01T00:00:00.000Z',now()-interval '1 minute','schedule:'||schedule.public_id||':2026-10-01T00:00:00.000Z' from schedule cross join project on conflict(schedule_id,occurrence_key) do nothing returning schedule_id) select public_id from schedule;"
  $firstClaim = Invoke-PsqlScalar -Sql "with candidate as(select o.id from schedule_occurrences o join scheduled_tasks s on s.id=o.schedule_id where o.status='PENDING' and s.public_id='$scheduleId'::uuid order by o.due_at,o.submission_sequence for update of o skip locked limit 1) update schedule_occurrences o set status='RUNNING',lease_owner='worker-a',lease_expires_at=now()-interval '1 second',attempts=attempts+1,started_at=now() from candidate where o.id=candidate.id returning o.public_id;"
  if ([string]::IsNullOrWhiteSpace($firstClaim)) { throw 'First scheduler worker did not claim the occurrence' }
  $secondClaim = Invoke-PsqlScalar -Sql "select count(*) from schedule_occurrences where status='PENDING' and schedule_id=(select id from scheduled_tasks where public_id='$scheduleId'::uuid);"
  if ($secondClaim -ne '0') { throw 'A second worker could claim the same occurrence' }
  $recoveredOccurrence = Invoke-PsqlScalar -Sql "with recovered as(update schedule_occurrences set status='UNKNOWN',error_code='LEASE_EXPIRED_OUTCOME_UNKNOWN',lease_owner=null,lease_expires_at=null where status='RUNNING' and lease_expires_at<now() returning status,error_code) select status||':'||error_code from recovered;"
  if ($recoveredOccurrence -ne 'UNKNOWN:LEASE_EXPIRED_OUTCOME_UNKNOWN') { throw "Unexpected scheduler recovery state: $recoveredOccurrence" }
  $duplicateCount = Invoke-PsqlScalar -Sql "with s as(select id,project_id,public_id from scheduled_tasks where public_id='$scheduleId'::uuid), duplicate as(insert into schedule_occurrences(schedule_id,project_id,occurrence_key,due_at,idempotency_key) select id,project_id,'2026-10-01T00:00:00.000Z',now(),'schedule:'||public_id||':2026-10-01T00:00:00.000Z' from s on conflict(schedule_id,occurrence_key) do nothing returning id) select count(*) from duplicate;"
  if ($duplicateCount -ne '0') { throw 'Scheduler duplicated an occurrence after recovery' }
  $monitorResult = Invoke-PsqlScalar -Sql "with owner as(select id from users where display_name='computer-use-owner'), monitor as(insert into monitor_definitions(user_id,project_id,name,monitor_type,target_sanitized,enabled,failure_threshold,recovery_threshold) select owner.id,project.id,'phase17-monitor','TCP',jsonb_build_object('host','127.0.0.1','port',5432),true,3,2 from owner cross join projects project where project.public_id='$knowledgeProject'::uuid returning id), samples as(insert into monitor_samples(monitor_id,available,error_code) select monitor.id,false,'ECONNREFUSED' from monitor cross join generate_series(1,3) returning monitor_id), incident as(insert into incidents(monitor_id,incident_key,severity,consecutive_failures) select monitor.id,'tcp-local-1','ERROR',3 from monitor returning id), event as(insert into incident_events(incident_id,event_type,actor) select id,'OPEN','monitor' from incident returning id) select (select count(*) from samples)||':'||(select count(*) from incident)||':'||(select count(*) from event);"
  if ($monitorResult -ne '3:1:1') { throw "Unexpected monitor incident state: $monitorResult" }

  $env:DATABASE_URL = "postgresql://$($env:POSTGRES_USER):$($env:POSTGRES_PASSWORD)@127.0.0.1:$($env:POSTGRES_PORT)/$($env:POSTGRES_DB)"
  & pnpm.cmd --filter '@arcc/telegram-bot' exec tsx (Join-Path $PSScriptRoot 'test-telegram-postgres.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Telegram PostgreSQL administration integration failed' }

  $auditId = Invoke-PsqlScalar -Sql "select append_audit_log('SECURITY', 'example', gen_random_uuid(), jsonb_build_object('token', '[REDACTED]'));"
  if ([string]::IsNullOrWhiteSpace($auditId)) {
    throw 'Audit append did not return an identifier'
  }
  $secretCount = [int](Invoke-PsqlScalar -Sql "select count(*) from audit_logs where parameters_sanitized::text like '%raw-example-secret%';")
  if ($secretCount -ne 0) {
    throw 'A raw secret appeared in the audit log'
  }

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  docker compose -p $composeProject -f $composeFile exec -T postgres psql -v ON_ERROR_STOP=1 -U $env:POSTGRES_USER -d $env:POSTGRES_DB -c "update audit_logs set action = 'tampered';" *> $null
  $mutationExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($mutationExitCode -eq 0) {
    throw 'Append-only audit protection accepted an update'
  }

  Invoke-PsqlScalar -Sql "insert into users(display_name) values ('persistence-check') returning id;" | Out-Null
  docker compose -p $composeProject -f $composeFile restart postgres | Out-Null
  $persisted = [int](Invoke-PsqlScalar -Sql "select count(*) from users where display_name = 'persistence-check';")
  if ($persisted -ne 1) {
    throw 'Data did not survive a PostgreSQL restart'
  }

  Invoke-PsqlFile -Path $schedulerMigrationDown
  $schedulerTable = Invoke-PsqlScalar -Sql "select to_regclass('public.schedule_occurrences') is null;"
  if ($schedulerTable -ne 't') { throw 'Scheduler down migration did not remove its tables' }
  Invoke-PsqlFile -Path $knowledgeMigrationDown
  $knowledgeTable = Invoke-PsqlScalar -Sql "select to_regclass('public.knowledge_sources') is null;"
  if ($knowledgeTable -ne 't') {
    throw 'Local knowledge down migration did not remove its tables'
  }
  Invoke-PsqlFile -Path $computerUseMigrationDown
  $computerUseTable = Invoke-PsqlScalar -Sql "select to_regclass('public.computer_use_sessions') is null;"
  if ($computerUseTable -ne 't') {
    throw 'Computer Use down migration did not remove its tables'
  }
  Invoke-PsqlFile -Path $supervisorMigrationDown
  Invoke-PsqlFile -Path $modelMigrationDown
  Invoke-PsqlFile -Path $runtimeMigrationDown
  Invoke-PsqlFile -Path $approvalMigrationDown
  Invoke-PsqlFile -Path $projectMigrationDown
  Invoke-PsqlFile -Path $migrationDown
  $usersTable = Invoke-PsqlScalar -Sql "select to_regclass('public.users') is null;"
  if ($usersTable -ne 't') {
    throw 'Down migration did not remove the users table'
  }
  Invoke-PsqlFile -Path $migrationUp
  Invoke-PsqlFile -Path $projectMigrationUp
  Invoke-PsqlFile -Path $approvalMigrationUp
  Invoke-PsqlFile -Path $runtimeMigrationUp
  Invoke-PsqlFile -Path $modelMigrationUp
  Invoke-PsqlFile -Path $supervisorMigrationUp
  Invoke-PsqlFile -Path $computerUseMigrationUp
  Invoke-PsqlFile -Path $knowledgeMigrationUp
  Invoke-PsqlFile -Path $schedulerMigrationUp
  Write-Host "Database integration checks passed ($tableCount tables, mission runtime, model routing, Supervisor, Computer Use, local knowledge and Scheduler included)."
}
finally {
  docker compose -p $composeProject -f $composeFile down --volumes --remove-orphans
}
