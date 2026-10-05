[CmdletBinding()]
param([string]$Reason = 'manual')
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
Set-ArccInfrastructureEnvironment
$dataRoot = Initialize-ArccDirectories
$appRoot = Get-ArccApplicationRoot
$compose = Get-ArccComposeArguments
$release = (Get-Content -Raw -LiteralPath (Join-Path $appRoot 'config\runtime-versions.json') | ConvertFrom-Json).release
$stamp = [DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')
$work = Join-Path $dataRoot "staging\backup-$stamp-$([guid]::NewGuid().ToString('N'))"
$zip = Join-Path $dataRoot "staging\backup-$stamp.zip"
$output = Join-Path $dataRoot "backups\arcc-$release-$stamp.arccb"
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  & docker @compose exec -T postgres pg_dump -U arcc -d arcc -Fc -f '/tmp/arcc-backup.dump'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed.' }
  & docker @compose cp 'postgres:/tmp/arcc-backup.dump' (Join-Path $work 'postgres.dump')
  if ($LASTEXITCODE -ne 0) { throw 'Could not retrieve PostgreSQL backup.' }
  foreach ($name in @('config.json', 'vault.json', 'telegram-state.json', 'telegram-preferences.json', 'telegram-security.jsonl')) {
    $candidate = Join-Path $dataRoot $name
    if (Test-Path -LiteralPath $candidate) { Copy-Item -LiteralPath $candidate -Destination $work }
  }
  $members = Get-ChildItem -LiteralPath $work -File | ForEach-Object {
    [ordered]@{ path = $_.Name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant(); bytes = $_.Length }
  }
  $manifest = [ordered]@{
    formatVersion = 1
    release = $release
    createdAt = [DateTimeOffset]::Now.ToString('o')
    reason = $Reason
    encryption = 'DPAPI_CURRENT_USER'
    files = @($members)
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $work 'manifest.json') -Encoding UTF8
  Compress-Archive -Path (Join-Path $work '*') -DestinationPath $zip -CompressionLevel Optimal
  Protect-ArccFile -InputPath $zip -OutputPath $output
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
  "$hash  $([IO.Path]::GetFileName($output))" | Set-Content -LiteralPath "$output.sha256" -Encoding ascii
  & (Join-Path $PSScriptRoot 'restore.ps1') -Backup $output -VerifyOnly
  if ($LASTEXITCODE -ne 0) { throw 'Backup verification failed.' }
  Write-ArccEvent -Event 'backup.created' -Level INFO -Data @{ backup = $output; sha256 = $hash; verified = $true }
}
finally {
  if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
}
