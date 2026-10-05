[CmdletBinding()]
param([double]$Hours = 24, [int]$IntervalSeconds = 60, [string]$OutputPath)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
if ($Hours -le 0 -or $IntervalSeconds -lt 5) { throw 'Hours must be positive and IntervalSeconds at least 5.' }
$dataRoot = Get-ArccDataRoot
if (-not $OutputPath) { $OutputPath = Join-Path $dataRoot "logs\endurance-$([DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')).jsonl" }
$deadline = [DateTimeOffset]::Now.AddHours($Hours)
$failures = 0
$samples = 0
while ([DateTimeOffset]::Now -lt $deadline) {
  $entry = [ordered]@{ at = [DateTimeOffset]::Now.ToString('o'); healthy = $false; processes = @() }
  try {
    $port = if ($env:API_PORT) { $env:API_PORT } else { '4000' }
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/ready" -TimeoutSec 5
    $entry.healthy = $health.status -eq 'ready'
    $entry.processes = @(foreach ($item in Read-ArccProcessState) {
      $process = Get-Process -Id $item.pid -ErrorAction SilentlyContinue
      if ($process) { [ordered]@{ name = $item.name; workingSetMb = [math]::Round($process.WorkingSet64 / 1MB, 2); cpuSeconds = [math]::Round($process.CPU, 2) } }
    })
  } catch { $entry.error = $_.Exception.Message }
  if (-not $entry.healthy) { $failures++ }
  $samples++
  $entry | ConvertTo-Json -Compress -Depth 5 | Add-Content -LiteralPath $OutputPath -Encoding UTF8
  Start-Sleep -Seconds $IntervalSeconds
}
$summary = [ordered]@{ event = 'endurance.completed'; samples = $samples; failures = $failures; passed = $failures -eq 0; output = $OutputPath }
$summary | ConvertTo-Json -Compress
if ($failures) { exit 2 }
