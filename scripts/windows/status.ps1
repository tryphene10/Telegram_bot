[CmdletBinding()]
param([switch]$Json)
. (Join-Path $PSScriptRoot 'Common.ps1')
$services = foreach ($item in Read-ArccProcessState) {
  $process = Get-Process -Id $item.pid -ErrorAction SilentlyContinue
  [pscustomobject]@{ name = $item.name; pid = $item.pid; running = $null -ne $process; startedAt = $item.startedAt }
}
$apiPort = if ($env:API_PORT) { [int]$env:API_PORT } else { 4000 }
$api = try { (Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/ready" -TimeoutSec 2).status } catch { 'unavailable' }
$result = [pscustomobject]@{ api = $api; services = @($services); autonomy = 'EXECUTE_SAFE' }
if ($Json) { $result | ConvertTo-Json -Depth 5 } else { $result.services | Format-Table -AutoSize; "API: $api" }
if ($api -ne 'ready' -or ($services.running -contains $false)) { exit 2 }
