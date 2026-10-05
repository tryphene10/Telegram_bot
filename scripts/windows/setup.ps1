[CmdletBinding()]
param(
  [string]$LocalModel = 'mistral-7b-instruct-q4',
  [string[]]$CloudModels = @(),
  [string]$FirstProject,
  [switch]$SkipTelegram
)
. (Join-Path $PSScriptRoot 'Common.ps1')
Assert-ArccWindows
$dataRoot = Initialize-ArccDirectories
$appRoot = Get-ArccApplicationRoot
$setupCliEntry = Resolve-ArccServiceEntryPoint -Service 'setup-cli'

$postgresSecretPath = Join-Path $dataRoot 'runtime\postgres-password.dpapi'
if (-not (Test-Path -LiteralPath $postgresSecretPath)) {
  $random = [byte[]]::new(32)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($random)
  $generator.Dispose()
  try {
    $databasePassword = [Convert]::ToBase64String($random)
    ConvertTo-SecureString $databasePassword -AsPlainText -Force |
      ConvertFrom-SecureString |
      Set-Content -LiteralPath $postgresSecretPath -Encoding ascii
  }
  finally {
    [Array]::Clear($random, 0, $random.Length)
    $databasePassword = $null
  }
}

$pinSecure = Read-Host 'PIN Owner à six chiffres' -AsSecureString
$pinAgainSecure = Read-Host 'Confirmez le PIN' -AsSecureString
$pin = [Net.NetworkCredential]::new('', $pinSecure).Password
$pinAgain = [Net.NetworkCredential]::new('', $pinAgainSecure).Password
if ($pin -ne $pinAgain) { throw 'Les PIN ne correspondent pas.' }

$telegramToken = ''
if (-not $SkipTelegram) {
  $telegramSecure = Read-Host 'Token du bot Telegram' -AsSecureString
  $telegramToken = [Net.NetworkCredential]::new('', $telegramSecure).Password
}

$providerKeys = @{}
foreach ($model in $CloudModels) {
  $provider = ($model -split ':', 2)[0].ToLowerInvariant()
  if ($provider -notin @('openai', 'anthropic', 'deepseek', 'moonshot')) {
    throw "Fournisseur cloud non pris en charge : $provider"
  }
  if (-not $providerKeys.ContainsKey($provider)) {
    $providerSecure = Read-Host "Cle API $provider" -AsSecureString
    $providerKeys[$provider] = [Net.NetworkCredential]::new('', $providerSecure).Password
  }
}

$payload = @{
  pin = $pin
  localModel = $LocalModel
  telegramToken = $telegramToken
  cloudModels = $CloudModels
  providerKeys = $providerKeys
}
if ($FirstProject) { $payload.firstProject = [System.IO.Path]::GetFullPath($FirstProject) }
try {
  $payload | ConvertTo-Json -Depth 5 -Compress |
    node $setupCliEntry $dataRoot
  if ($LASTEXITCODE -ne 0) { throw 'L’assistant sécurisé a échoué.' }
}
finally {
  $pin = $null
  $pinAgain = $null
  $telegramToken = $null
  foreach ($key in @($providerKeys.Keys)) { $providerKeys[$key] = $null }
  $providerKeys = $null
  $payload = $null
}

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $dataRoot '/inheritance:r' '/grant:r' "${currentUser}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Impossible de restreindre les permissions NTFS.' }
Write-ArccEvent -Event 'setup.completed' -Level INFO -Data @{ dataRoot = $dataRoot; autonomy = 'EXECUTE_SAFE' }
