[CmdletBinding()]
param([switch]$Json)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
$appRoot = Get-ArccApplicationRoot
$dataRoot = Get-ArccDataRoot
$checks = [System.Collections.Generic.List[object]]::new()
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([pscustomobject]@{ name = $Name; passed = $Passed; detail = $Detail })
}

foreach ($command in @('node', 'pnpm.cmd', 'git', 'docker')) {
  Add-Check "command.$command" (Test-ArccCommand $command) ($(if (Test-ArccCommand $command) { 'available' } else { 'missing' }))
}
$browserCandidates = @(
  'chrome.exe',
  'msedge.exe',
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
)
$browser = $browserCandidates | Where-Object {
  (Test-ArccCommand $_) -or (Test-Path -LiteralPath $_ -PathType Leaf)
} | Select-Object -First 1
Add-Check 'browser.chrome-or-edge' ($null -ne $browser) ($(if ($browser) { $browser } else { 'not found on PATH; verify installed browser manually' }))
$computer = Get-CimInstance Win32_ComputerSystem
$systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
Add-Check 'capacity.ram' ($computer.TotalPhysicalMemory -ge 8GB) "$([math]::Round($computer.TotalPhysicalMemory / 1GB, 1)) GB (minimum 8 GB)"
Add-Check 'capacity.disk' ($systemDrive.FreeSpace -ge 10GB) "$([math]::Round($systemDrive.FreeSpace / 1GB, 1)) GB free (minimum 10 GB)"
$gpu = @(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name)
Add-Check 'capacity.gpu' $true ($(if ($gpu.Count) { $gpu -join ', ' } else { 'not detected; CPU mode remains supported' }))
$versions = Get-Content -Raw -LiteralPath (Join-Path $appRoot 'config\runtime-versions.json') | ConvertFrom-Json
$nodeVersion = (& node --version 2>$null) -replace '^v', ''
Add-Check 'version.node' ($nodeVersion -eq $versions.node) "$nodeVersion (expected $($versions.node))"
$pnpmVersion = (& pnpm.cmd --version 2>$null)
Add-Check 'version.pnpm' ($pnpmVersion -eq $versions.pnpm) "$pnpmVersion (expected $($versions.pnpm))"
Add-Check 'config.safe' (Test-Path -LiteralPath (Join-Path $dataRoot 'config.json')) 'non-secret config'
Add-Check 'vault.dpapi' (Test-Path -LiteralPath (Join-Path $dataRoot 'vault.json')) 'encrypted vault'
Add-Check 'database.dpapi' (Test-Path -LiteralPath (Join-Path $dataRoot 'runtime\postgres-password.dpapi')) 'protected infrastructure credential'
if (Test-Path -LiteralPath (Join-Path $dataRoot 'runtime\postgres-password.dpapi')) { Set-ArccInfrastructureEnvironment }
$config = & docker compose -p arcc-doctor -f (Join-Path $appRoot 'infra\docker-compose.yml') config --quiet 2>&1
Add-Check 'compose.valid' ($LASTEXITCODE -eq 0) (($config | Out-String).Trim())
$apiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 4000 }
$foreign = @(Get-NetTCPConnection -State Listen -LocalPort $apiPort -ErrorAction SilentlyContinue | Where-Object LocalAddress -NotIn @('127.0.0.1', '::1'))
Add-Check 'network.loopback' ($foreign.Count -eq 0) "API port $apiPort must not listen on LAN"
$result = [pscustomobject]@{ passed = -not ($checks.passed -contains $false); checks = $checks }
if ($Json) { $result | ConvertTo-Json -Depth 5 } else { $checks | Format-Table -AutoSize }
if (-not $result.passed) { exit 2 }
