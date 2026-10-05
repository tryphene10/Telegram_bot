[CmdletBinding()]
param([string]$OutputDirectory, [switch]$SkipVerify)
. (Join-Path $PSScriptRoot 'Common.ps1')
$appRoot = Get-ArccApplicationRoot
$OutputDirectory = if ($OutputDirectory) { $OutputDirectory } else { Join-Path $appRoot 'artifacts\releases' }
$version = (Get-Content -Raw -LiteralPath (Join-Path $appRoot 'config\runtime-versions.json') | ConvertFrom-Json).release
$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$stageName = ".package-stage-$version-$([guid]::NewGuid().ToString('N'))"
$staging = Join-Path $appRoot "artifacts\$stageName"
$archive = Join-Path $outputRoot "arcc-windows-$version.zip"
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
try {
  if (-not $SkipVerify) {
    & pnpm.cmd verify
    if ($LASTEXITCODE -ne 0) { throw 'Repository verification failed.' }
  }
  foreach ($service in @('api', 'desktop-agent', 'telegram-bot', 'setup-cli')) {
    $relativeDestination = "artifacts\$stageName\services\$service"
    & pnpm.cmd --config.node-linker=hoisted --filter "@arcc/$service" --prod --legacy deploy $relativeDestination
    if ($LASTEXITCODE -ne 0) { throw "Deployment failed for $service." }
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'apps\web-dashboard\dist') -Destination (Join-Path $staging 'web') -Recurse
  foreach ($folder in @('config', 'infra', 'scripts\windows', 'docs\operations', 'docs\security')) {
    $destination = Join-Path $staging $folder
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $appRoot $folder) -Destination $destination -Recurse
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'packages\database\migrations') -Destination (Join-Path $staging 'packages\database\migrations') -Recurse
  Copy-Item -LiteralPath (Join-Path $appRoot 'packaging\windows') -Destination (Join-Path $staging 'installer') -Recurse
  $files = Get-ChildItem -LiteralPath $staging -File -Recurse | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($staging.Length).TrimStart('\').Replace('\', '/'); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(); bytes = $_.Length }
  }
  [ordered]@{ release = $version; createdAt = [DateTimeOffset]::Now.ToString('o'); signed = $false; files = @($files) } |
    ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath (Join-Path $staging 'release-manifest.json') -Encoding UTF8
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  & tar.exe -c -a -h -f $archive -C $staging .
  if ($LASTEXITCODE -ne 0) { throw 'Release archive creation failed.' }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  "$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
  Write-ArccEvent -Event 'package.created' -Level INFO -Data @{ archive = $archive; sha256 = $hash; signed = $false }
}
finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
