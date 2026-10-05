[CmdletBinding()]
param([Parameter(Mandatory)][string]$Archive, [Parameter(Mandatory)][string]$Sha256)
. (Join-Path $PSScriptRoot 'Common.ps1')
$archivePath = [IO.Path]::GetFullPath($Archive)
$expected = (Get-Content -Raw -LiteralPath ([IO.Path]::GetFullPath($Sha256))).Split(' ', [StringSplitOptions]::RemoveEmptyEntries)[0].ToLowerInvariant()
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw 'Update checksum mismatch.' }
$base = Join-Path $env:LOCALAPPDATA 'Programs\ARCC'
$currentPath = Join-Path $base 'current.json'
$previous = Get-Content -Raw -LiteralPath $currentPath
$staging = Join-Path (Get-ArccDataRoot) "staging\update-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
  Expand-Archive -LiteralPath $archivePath -DestinationPath $staging
  $manifest = Get-Content -Raw -LiteralPath (Join-Path $staging 'release-manifest.json') | ConvertFrom-Json
  foreach ($file in $manifest.files) {
    $candidate = Join-Path $staging $file.path
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Invalid staged file: $($file.path)" }
  }
  & (Join-Path $PSScriptRoot 'backup.ps1') -Reason "pre-update-$($manifest.release)" | Out-Null
  & (Join-Path $PSScriptRoot 'stop.ps1')
  $releaseRoot = Join-Path $base "releases\$($manifest.release)"
  Move-Item -LiteralPath $staging -Destination $releaseRoot
  @{ release = $manifest.release; applicationRoot = $releaseRoot; installedAt = [DateTimeOffset]::Now.ToString('o') } |
    ConvertTo-Json |
    Set-Content -LiteralPath $currentPath -Encoding UTF8
  $env:ARCC_APP_ROOT = $releaseRoot
  & (Join-Path $releaseRoot 'scripts\windows\start.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Updated runtime smoke test failed.' }
}
catch {
  $previous | Set-Content -LiteralPath $currentPath -Encoding UTF8
  $rollback = $previous | ConvertFrom-Json
  $env:ARCC_APP_ROOT = $rollback.applicationRoot
  & (Join-Path $rollback.applicationRoot 'scripts\windows\start.ps1')
  throw
}
finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
