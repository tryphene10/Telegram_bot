$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$data = Join-Path ([IO.Path]::GetTempPath()) "arcc-runtime-smoke-$([guid]::NewGuid().ToString('N'))"
$env:ARCC_DATA_ROOT = $data
$env:ARCC_APP_ROOT = $root
$env:ARCC_COMPOSE_PROJECT = 'arcc-phase19-smoke'
$env:API_PORT = '44019'
$env:POSTGRES_PORT = '55439'
$env:REDIS_PORT = '56389'
New-Item -ItemType Directory -Path (Join-Path $data 'runtime') -Force | Out-Null
try {
  & pnpm.cmd --filter @arcc/setup-cli build
  & pnpm.cmd --filter @arcc/api build
  & pnpm.cmd --filter @arcc/desktop-agent build
  & pnpm.cmd --filter @arcc/web-dashboard build
  if ($LASTEXITCODE -ne 0) { throw 'Smoke build failed.' }
  @{ pin = '246810'; localModel = 'test-local-model'; cloudModels = @(); firstProject = $root } |
    ConvertTo-Json -Compress |
    node (Join-Path $root 'apps\setup-cli\dist\index.js') $data | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Smoke setup failed.' }
  $random = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($random)
  $generator.Dispose()
  try {
    $password = [Convert]::ToBase64String($random)
    ConvertTo-SecureString $password -AsPlainText -Force |
      ConvertFrom-SecureString |
      Set-Content -LiteralPath (Join-Path $data 'runtime\postgres-password.dpapi') -Encoding ascii
  }
  finally { [Array]::Clear($random, 0, $random.Length); $password = $null }
  & (Join-Path $root 'scripts\windows\start.ps1') -WithoutTelegram | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Smoke runtime failed to start.' }
  $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:44019/' -TimeoutSec 5
  if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'ARCC') { throw 'Dashboard smoke failed.' }
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $login = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/api/v1/session' -Method Post -ContentType 'application/json' -Body '{"pin":"246810"}' -WebSession $session
  if (-not $login.csrfToken) { throw 'PIN session smoke failed.' }
  $overview = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/api/v1/overview' -WebSession $session
  if ($overview.version -ne 'v1') { throw 'Real PostgreSQL overview smoke failed.' }
  $projects = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/api/v1/entities/projects?limit=10&sort=name' -WebSession $session
  $machines = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/api/v1/entities/machines?limit=10&sort=name' -WebSession $session
  if (@($projects.items).Count -ne 1 -or @($machines.items).Count -ne 1) { throw 'Runtime bootstrap smoke failed.' }
  $missionBody = @{ action = 'MISSION_CREATE'; targetId = 'new'; expectedState = 'NEW'; input = @{ objective = 'Mission de recette'; model = 'LOCAL:test-local-model'; project = $projects.items[0].id; machine = $machines.items[0].id } } | ConvertTo-Json -Depth 5
  try {
    $mission = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/api/v1/actions' -Method Post -ContentType 'application/json' -Headers @{ 'x-csrf-token' = $login.csrfToken } -Body $missionBody -WebSession $session
  }
  catch {
    $reader = [IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    try { throw "Mission creation request failed: $($reader.ReadToEnd())" }
    finally { $reader.Dispose() }
  }
  if ($mission.status -ne 'COMPLETED') { throw 'Real mission creation smoke failed.' }
  & (Join-Path $root 'scripts\windows\benchmark.ps1') -Samples 5 -OutputPath (Join-Path $data 'logs\benchmark-smoke.json') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Runtime benchmark smoke failed.' }
  & (Join-Path $root 'scripts\windows\endurance.ps1') -Hours 0.002 -IntervalSeconds 5 -OutputPath (Join-Path $data 'logs\endurance-smoke.jsonl') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Runtime endurance smoke failed.' }
  & (Join-Path $root 'scripts\windows\backup.ps1') -Reason 'runtime-smoke' | Out-Null
  if (@(Get-ChildItem -LiteralPath (Join-Path $data 'backups') -Filter '*.arccb').Count -ne 1) { throw 'Verified encrypted backup was not produced.' }
  $state = Get-Content -Raw -LiteralPath (Join-Path $data 'runtime\processes.json') | ConvertFrom-Json
  $apiProcess = $state | Where-Object name -EQ 'api'
  Stop-Process -Id $apiProcess.pid -Force
  & (Join-Path $root 'scripts\windows\stop.ps1') | Out-Null
  & (Join-Path $root 'scripts\windows\start.ps1') -WithoutTelegram | Out-Null
  $recovered = Invoke-RestMethod -Uri 'http://127.0.0.1:44019/ready' -TimeoutSec 5
  if ($recovered.status -ne 'ready') { throw 'Runtime did not recover after forced API termination.' }
  Write-Host 'Windows runtime smoke: OK'
}
finally {
  try { & (Join-Path $root 'scripts\windows\stop.ps1') -IncludeInfrastructure 2>$null | Out-Null } catch { }
  try { & docker compose -p arcc-phase19-smoke -f (Join-Path $root 'infra\docker-compose.yml') down --volumes --remove-orphans 2>$null | Out-Null } catch { }
  if (Test-Path -LiteralPath $data) { Remove-Item -LiteralPath $data -Recurse -Force }
}
