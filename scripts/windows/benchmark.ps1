[CmdletBinding()]
param([int]$Samples = 20, [string]$OutputPath)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
$dataRoot = Get-ArccDataRoot
if (-not $OutputPath) { $OutputPath = Join-Path $dataRoot "logs\benchmark-$([DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')).json" }
$samplesMs = [System.Collections.Generic.List[double]]::new()
foreach ($index in 1..$Samples) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:$($(if ($env:API_PORT) { $env:API_PORT } else { '4000' }))/ready" -TimeoutSec 5
  $watch.Stop()
  if ($response.status -ne 'ready') { throw 'Readiness benchmark failed.' }
  $samplesMs.Add($watch.Elapsed.TotalMilliseconds)
}
$processes = foreach ($item in Read-ArccProcessState) {
  $process = Get-Process -Id $item.pid -ErrorAction SilentlyContinue
  if ($process) { [ordered]@{ name = $item.name; workingSetMb = [math]::Round($process.WorkingSet64 / 1MB, 2); cpuSeconds = [math]::Round($process.CPU, 2) } }
}
$sorted = @($samplesMs | Sort-Object)
$diskBytes = (Get-ChildItem -LiteralPath $dataRoot -File -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$report = [ordered]@{
  measuredAt = [DateTimeOffset]::Now.ToString('o')
  samples = $Samples
  readinessMs = [ordered]@{ average = [math]::Round(($samplesMs | Measure-Object -Average).Average, 2); p95 = [math]::Round($sorted[[math]::Min($sorted.Count - 1, [math]::Floor($sorted.Count * 0.95))], 2); maximum = [math]::Round(($samplesMs | Measure-Object -Maximum).Maximum, 2) }
  processes = @($processes)
  dataDiskMb = [math]::Round($diskBytes / 1MB, 2)
}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
$report | ConvertTo-Json -Depth 6
