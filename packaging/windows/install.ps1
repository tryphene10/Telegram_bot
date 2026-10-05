[CmdletBinding()]
param([switch]$NoScheduledTask)
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $packageRoot 'config\runtime-versions.json') | ConvertFrom-Json
$base = Join-Path $env:LOCALAPPDATA 'Programs\ARCC'
$releaseRoot = Join-Path $base "releases\$($manifest.release)"
$dataRoot = Join-Path $env:LOCALAPPDATA 'ARCC'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Copy-Item -Path (Join-Path $packageRoot '*') -Destination $releaseRoot -Recurse -Force
@{ release = $manifest.release; applicationRoot = $releaseRoot; installedAt = [DateTimeOffset]::Now.ToString('o') } |
  ConvertTo-Json |
  Set-Content -LiteralPath (Join-Path $base 'current.json') -Encoding UTF8
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $dataRoot '/inheritance:r' '/grant:r' "${currentUser}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict data directory ACL.' }
if (-not $NoScheduledTask) {
  $command = "`$env:ARCC_APP_ROOT='$releaseRoot'; & '$releaseRoot\scripts\windows\start.ps1'"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -Command `"$command`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName 'ARCC Local Runtime' -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
}
Write-Host "ARCC $($manifest.release) installed in $releaseRoot"
Write-Host "Run: `$env:ARCC_APP_ROOT='$releaseRoot'; & '$releaseRoot\scripts\windows\setup.ps1'"
