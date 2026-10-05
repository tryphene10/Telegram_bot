[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Backup,
  [switch]$VerifyOnly,
  [switch]$ConfirmRestore
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
Set-ArccInfrastructureEnvironment
$dataRoot = Initialize-ArccDirectories
$appRoot = Get-ArccApplicationRoot
$compose = Get-ArccComposeArguments
$source = [System.IO.Path]::GetFullPath($Backup)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Backup file not found.' }
$work = Join-Path $dataRoot "staging\restore-$([guid]::NewGuid().ToString('N'))"
$zip = Join-Path $work 'backup.zip'
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Unprotect-ArccFile -InputPath $source -OutputPath $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $work -Force
  $manifestPath = Join-Path $work 'manifest.json'
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    $path = Join-Path $work $file.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing backup member: $($file.path)" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
    if ($actual -ne $file.sha256) { throw "Backup hash mismatch: $($file.path)" }
  }
  $verifyDatabase = "arcc_verify_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  & docker @compose exec -T postgres createdb -U arcc $verifyDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated restore database.' }
  try {
    & docker @compose cp (Join-Path $work 'postgres.dump') 'postgres:/tmp/arcc-restore.dump'
    & docker @compose exec -T postgres pg_restore -U arcc -d $verifyDatabase --clean --if-exists '/tmp/arcc-restore.dump'
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL restore failed.' }
    $expectedMigrations = @(Get-ChildItem -LiteralPath (Join-Path $appRoot 'packages\database\migrations') -Directory | Sort-Object Name | Select-Object -ExpandProperty Name)
    $restoredMigrations = @(& docker @compose exec -T postgres psql -U arcc -d $verifyDatabase -At -c 'select version from schema_migrations order by version;')
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the restored migration ledger.' }
    $restoredMigrations = @($restoredMigrations | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
    $missingMigrations = @($expectedMigrations | Where-Object { $_ -notin $restoredMigrations })
    if ($missingMigrations.Count -gt 0) { throw "Restored schema is incomplete. Missing: $($missingMigrations -join ', ')." }
    $criticalTables = & docker @compose exec -T postgres psql -U arcc -d $verifyDatabase -At -c "select count(*) from (values ('missions'),('audit_logs'),('approvals'),('scheduled_tasks'),('knowledge_sources')) expected(name) where to_regclass('public.'||name) is not null;"
    if ($LASTEXITCODE -ne 0 -or [int](([string]($criticalTables | Select-Object -Last 1)).Trim()) -ne 5) { throw 'Restored critical tables are incomplete.' }
  }
  finally {
    & docker @compose exec -T postgres dropdb -U arcc --if-exists $verifyDatabase *> $null
  }
  if ($VerifyOnly) {
    Write-ArccEvent -Event 'backup.verified' -Level INFO -Data @{ backup = $source; release = $manifest.release }
    return
  }
  if (-not $ConfirmRestore) { throw 'Use -ConfirmRestore after reviewing the selected backup.' }
  & (Join-Path $PSScriptRoot 'stop.ps1')
  & docker @compose exec -T postgres dropdb -U arcc --if-exists arcc_restore
  & docker @compose exec -T postgres createdb -U arcc arcc_restore
  & docker @compose exec -T postgres pg_restore -U arcc -d arcc_restore --clean --if-exists '/tmp/arcc-restore.dump'
  if ($LASTEXITCODE -ne 0) { throw 'Staged restore failed; active database was not changed.' }
  & docker @compose exec -T postgres psql -U arcc -d postgres -v ON_ERROR_STOP=1 -c "alter database arcc rename to arcc_previous; alter database arcc_restore rename to arcc;"
  if ($LASTEXITCODE -ne 0) { throw 'Atomic database switch failed.' }
  foreach ($name in @('config.json', 'vault.json', 'telegram-state.json', 'telegram-preferences.json')) {
    $candidate = Join-Path $work $name
    if (Test-Path -LiteralPath $candidate) { Copy-Item -LiteralPath $candidate -Destination (Join-Path $dataRoot $name) -Force }
  }
  Write-ArccEvent -Event 'backup.restored' -Level WARN -Data @{ backup = $source; previousDatabase = 'arcc_previous' }
}
finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
}
