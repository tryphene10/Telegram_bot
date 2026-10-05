$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'windows') -Filter '*.ps1' -File -Recurse) {
  $tokens = $null
  $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  foreach ($error in $errors) { $failures.Add("$($file.Name): $($error.Message)") }
}
if ($failures.Count -gt 0) { throw ($failures -join [Environment]::NewLine) }

. (Join-Path $PSScriptRoot 'windows\Common.ps1')
$previousAppRoot = $env:ARCC_APP_ROOT
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) "arcc-entrypoint-$([guid]::NewGuid().ToString('N'))"
try {
  $releaseEntry = Join-Path $fixtureRoot 'services\setup-cli\dist\index.js'
  New-Item -ItemType Directory -Path (Split-Path -Parent $releaseEntry) -Force | Out-Null
  Set-Content -LiteralPath $releaseEntry -Value '// fixture' -Encoding ascii
  $env:ARCC_APP_ROOT = $fixtureRoot
  if ((Resolve-ArccServiceEntryPoint -Service 'setup-cli') -ne $releaseEntry) {
    throw 'Packaged setup CLI entry point was not resolved.'
  }
}
finally {
  $env:ARCC_APP_ROOT = $previousAppRoot
  if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
Write-Host 'Windows scripts: syntax OK'
