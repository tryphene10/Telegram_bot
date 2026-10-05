[CmdletBinding()]
param([ValidateSet('api', 'desktop-agent', 'telegram-bot', 'all')][string]$Service = 'all', [int]$Tail = 100, [switch]$Follow)
. (Join-Path $PSScriptRoot 'Common.ps1')
$logRoot = Join-Path (Get-ArccDataRoot) 'logs'
$names = if ($Service -eq 'all') { @('api', 'desktop-agent', 'telegram-bot') } else { @($Service) }
$paths = foreach ($name in $names) {
  foreach ($suffix in @('.log', '.error.log')) {
    $path = Join-Path $logRoot "$name$suffix"
    if (Test-Path -LiteralPath $path) { $path }
  }
}
if (-not $paths) { throw 'No runtime logs found.' }
Get-Content -LiteralPath $paths -Tail $Tail -Wait:$Follow
