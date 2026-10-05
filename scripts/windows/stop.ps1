[CmdletBinding()]
param([switch]$IncludeInfrastructure)
. (Join-Path $PSScriptRoot 'Common.ps1')
$state = Read-ArccProcessState
foreach ($item in $state) {
  $process = Get-Process -Id $item.pid -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  Stop-Process -Id $item.pid
  try { Wait-Process -Id $item.pid -Timeout 10 -ErrorAction Stop }
  catch { Stop-Process -Id $item.pid -Force -ErrorAction SilentlyContinue }
}
Write-ArccProcessState -Processes @()
if ($IncludeInfrastructure) {
  Set-ArccInfrastructureEnvironment
  & docker @(Get-ArccComposeArguments) stop postgres redis
}
Write-ArccEvent -Event 'runtime.stopped' -Level INFO
