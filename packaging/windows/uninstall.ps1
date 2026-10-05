[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param([switch]$RemoveData)
$ErrorActionPreference = 'Stop'
$base = Join-Path $env:LOCALAPPDATA 'Programs\ARCC'
$data = Join-Path $env:LOCALAPPDATA 'ARCC'
Unregister-ScheduledTask -TaskName 'ARCC Local Runtime' -Confirm:$false -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath (Join-Path $base 'current.json')) {
  $current = Get-Content -Raw -LiteralPath (Join-Path $base 'current.json') | ConvertFrom-Json
  $env:ARCC_APP_ROOT = $current.applicationRoot
  $credential = Join-Path $data 'runtime\postgres-password.dpapi'
  if (Test-Path -LiteralPath $credential) {
    & (Join-Path $current.applicationRoot 'scripts\windows\stop.ps1') -IncludeInfrastructure
  } else {
    & (Join-Path $current.applicationRoot 'scripts\windows\stop.ps1')
  }
}
if ($PSCmdlet.ShouldProcess($base, 'Remove ARCC application files')) {
  Remove-Item -LiteralPath $base -Recurse -Force -ErrorAction SilentlyContinue
}
if ($RemoveData -and $PSCmdlet.ShouldProcess($data, 'Permanently remove ARCC data and backups')) {
  Remove-Item -LiteralPath $data -Recurse -Force -ErrorAction SilentlyContinue
} else {
  Write-Host "Application removed. User data was preserved in $data"
}
