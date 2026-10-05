[CmdletBinding()]
param([switch]$SkipBackup)
. (Join-Path $PSScriptRoot 'Common.ps1')
$appRoot = Get-ArccApplicationRoot
Set-ArccInfrastructureEnvironment
$compose = Get-ArccComposeArguments
$migrations = @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'packages\database\migrations') -Directory | Sort-Object Name)
$hasSchemaResult = & docker @compose exec -T postgres psql -U arcc -d arcc -At -c "select to_regclass('public.schema_migrations') is not null;" 2>$null
$hasSchema = $LASTEXITCODE -eq 0 -and ($hasSchemaResult | Select-Object -Last 1) -eq 't'
$appliedVersions = @()
if ($hasSchema) {
  & docker @compose exec -T postgres psql -v ON_ERROR_STOP=1 -U arcc -d arcc -c "insert into schema_migrations(version) select '0004_mission_runtime' where to_regclass('public.mission_action_receipts') is not null on conflict do nothing; insert into schema_migrations(version) select '0005_model_routing' where to_regclass('public.model_catalog') is not null on conflict do nothing; insert into schema_migrations(version) select '0006_supervisor_agents' where exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_runs' and column_name='maximum_ai_calls') on conflict do nothing;" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not repair the legacy migration ledger.' }
  $appliedVersions = @(& docker @compose exec -T postgres psql -U arcc -d arcc -At -c 'select version from schema_migrations order by version;' 2>$null)
}
$pending = @($migrations | Where-Object Name -NotIn $appliedVersions)
if (-not $SkipBackup -and $hasSchema -and $pending.Count -gt 0) {
  & (Join-Path $PSScriptRoot 'backup.ps1') -Reason 'pre-migration' | Out-Null
}
foreach ($migration in $pending) {
  $version = $migration.Name.Replace("'", "''")
  Get-Content -Raw -LiteralPath (Join-Path $migration.FullName 'up.sql') |
    & docker @compose exec -T postgres psql -v ON_ERROR_STOP=1 -U arcc -d arcc
  if ($LASTEXITCODE -ne 0) { throw "Migration $version failed." }
  Write-ArccEvent -Event 'migration.applied' -Level INFO -Data @{ version = $version }
}
