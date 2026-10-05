[CmdletBinding()]
param([switch]$WithoutTelegram)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
$dataRoot = Initialize-ArccDirectories
$appRoot = Get-ArccApplicationRoot
$apiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 4000 }
$existing = Read-ArccProcessState | Where-Object { Get-Process -Id $_.pid -ErrorAction SilentlyContinue }
if ($existing) { throw 'ARCC is already running. Use status.ps1 for details.' }
Assert-ArccLoopbackPortFree -Port $apiPort
Set-ArccInfrastructureEnvironment
$compose = Get-ArccComposeArguments
& docker @compose up -d postgres redis
if ($LASTEXITCODE -ne 0) { throw 'Infrastructure startup failed.' }
foreach ($attempt in 1..30) {
  & docker @compose exec -T postgres pg_isready -U arcc -d arcc *> $null
  if ($LASTEXITCODE -eq 0) { break }
  if ($attempt -eq 30) { throw 'PostgreSQL readiness timed out.' }
  Start-Sleep -Seconds 1
}
& (Join-Path $PSScriptRoot 'migrate.ps1')

$releaseLayout = Test-Path -LiteralPath (Join-Path $appRoot 'services\api\dist\index.js')
$apiEntry = if ($releaseLayout) { Join-Path $appRoot 'services\api\dist\index.js' } else { Join-Path $appRoot 'apps\api\dist\index.js' }
$agentEntry = if ($releaseLayout) { Join-Path $appRoot 'services\desktop-agent\dist\index.js' } else { Join-Path $appRoot 'apps\desktop-agent\dist\index.js' }
$telegramEntry = if ($releaseLayout) { Join-Path $appRoot 'services\telegram-bot\dist\index.js' } else { Join-Path $appRoot 'apps\telegram-bot\dist\index.js' }
$webRoot = if ($releaseLayout) { Join-Path $appRoot 'web' } else { Join-Path $appRoot 'apps\web-dashboard\dist' }
$env:API_HOST = '127.0.0.1'
$env:API_PORT = [string]$apiPort
$env:ARCC_WEB_ROOT = $webRoot
$env:ARCC_DATA_ROOT = $dataRoot
$env:DATABASE_URL = "postgresql://$($env:POSTGRES_USER):$([Uri]::EscapeDataString($env:POSTGRES_PASSWORD))@127.0.0.1:$($env:POSTGRES_PORT)/$($env:POSTGRES_DB)"
$bootstrapEntry = if ($releaseLayout) { Join-Path $appRoot 'services\api\dist\bootstrap.js' } else { Join-Path $appRoot 'apps\api\dist\bootstrap.js' }
& node $bootstrapEntry
if ($LASTEXITCODE -ne 0) { throw 'Runtime bootstrap failed.' }

$processes = [System.Collections.Generic.List[object]]::new()
function Start-ArccBackground([string]$Name, [string]$Entry) {
  $out = Join-Path $dataRoot "logs\$Name.log"
  $err = Join-Path $dataRoot "logs\$Name.error.log"
  $process = Start-Process -FilePath (Get-Command node).Source -ArgumentList @($Entry) -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  $processes.Add([pscustomobject]@{ name = $Name; pid = $process.Id; startedAt = [DateTimeOffset]::Now.ToString('o') })
}

try {
  Start-ArccBackground 'api' $apiEntry
  Start-ArccBackground 'desktop-agent' $agentEntry
  if (-not $WithoutTelegram) { Start-ArccBackground 'telegram-bot' $telegramEntry }
  Write-ArccProcessState -Processes $processes
  foreach ($attempt in 1..30) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/ready" -TimeoutSec 2
      if ($health.status -eq 'ready') { break }
    } catch { }
    if ($attempt -eq 30) { throw 'API readiness timed out.' }
    Start-Sleep -Seconds 1
  }
  Write-ArccEvent -Event 'runtime.started' -Level INFO -Data @{ services = @($processes.name); url = "http://127.0.0.1:$apiPort" }
}
catch {
  foreach ($item in $processes) { Stop-Process -Id $item.pid -Force -ErrorAction SilentlyContinue }
  Write-ArccProcessState -Processes @()
  throw
}
