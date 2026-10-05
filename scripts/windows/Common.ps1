Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ArccRepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))

function Assert-ArccWindows {
  if ($env:OS -ne 'Windows_NT') { throw 'ARCC requires Windows.' }
}

function Get-ArccDataRoot {
  if ($env:ARCC_DATA_ROOT) { return [System.IO.Path]::GetFullPath($env:ARCC_DATA_ROOT) }
  if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required.' }
  return [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ARCC'))
}

function Get-ArccApplicationRoot {
  if ($env:ARCC_APP_ROOT) { return [System.IO.Path]::GetFullPath($env:ARCC_APP_ROOT) }
  return $script:ArccRepositoryRoot
}

function Resolve-ArccServiceEntryPoint {
  param(
    [Parameter(Mandatory)][ValidateSet('api', 'desktop-agent', 'telegram-bot', 'setup-cli')][string]$Service,
    [string]$Entry = 'dist\index.js'
  )
  $appRoot = Get-ArccApplicationRoot
  foreach ($layout in @('services', 'apps')) {
    $candidate = Join-Path $appRoot "$layout\$Service\$Entry"
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw "ARCC service entry point is missing: $Service/$Entry"
}

function Initialize-ArccDirectories {
  $root = Get-ArccDataRoot
  foreach ($name in @('backups', 'logs', 'runtime', 'staging')) {
    New-Item -ItemType Directory -Path (Join-Path $root $name) -Force | Out-Null
  }
  return $root
}

function Get-ArccComposeArguments {
  $app = Get-ArccApplicationRoot
  $project = if ($env:ARCC_COMPOSE_PROJECT) { $env:ARCC_COMPOSE_PROJECT } else { 'arcc-local' }
  return @('compose', '-p', $project, '-f', (Join-Path $app 'infra\docker-compose.yml'))
}

function Test-ArccCommand([Parameter(Mandatory)][string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-ArccEvent {
  param(
    [Parameter(Mandatory)][string]$Event,
    [Parameter(Mandatory)][ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level,
    [hashtable]$Data = @{}
  )
  $entry = [ordered]@{ at = [DateTimeOffset]::Now.ToString('o'); level = $Level; event = $Event }
  foreach ($key in $Data.Keys) { $entry[$key] = $Data[$key] }
  $entry | ConvertTo-Json -Compress
}

function Assert-ArccLoopbackPortFree([Parameter(Mandatory)][int]$Port) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ','
    throw "Port $Port is already occupied by process(es) $owners."
  }
}

function Get-ArccProcessStatePath { return Join-Path (Get-ArccDataRoot) 'runtime\processes.json' }

function Set-ArccInfrastructureEnvironment {
  $secretPath = Join-Path (Get-ArccDataRoot) 'runtime\postgres-password.dpapi'
  if (-not (Test-Path -LiteralPath $secretPath)) { throw 'Protected PostgreSQL credential is missing.' }
  $encoded = (Get-Content -Raw -LiteralPath $secretPath).Trim()
  $secure = ConvertTo-SecureString $encoded
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $env:POSTGRES_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  if (-not $env:POSTGRES_USER) { $env:POSTGRES_USER = 'arcc' }
  if (-not $env:POSTGRES_DB) { $env:POSTGRES_DB = 'arcc' }
  if (-not $env:POSTGRES_PORT) { $env:POSTGRES_PORT = '54329' }
  if (-not $env:REDIS_PORT) { $env:REDIS_PORT = '56379' }
}

function Read-ArccProcessState {
  $path = Get-ArccProcessStatePath
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  $value = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
  return @($value | Where-Object { $null -ne $_ -and $_.PSObject.Properties.Name -contains 'pid' })
}

function Write-ArccProcessState([Parameter(Mandatory)][AllowEmptyCollection()][array]$Processes) {
  $path = Get-ArccProcessStatePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
  $temporary = "$path.$PID.tmp"
  $json = ConvertTo-Json -InputObject $Processes -Depth 5
  [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Protect-ArccFile {
  param([Parameter(Mandatory)][string]$InputPath, [Parameter(Mandatory)][string]$OutputPath)
  $plain = [System.IO.File]::ReadAllBytes($InputPath)
  try {
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
      $plain,
      [Text.Encoding]::UTF8.GetBytes('ARCC-BACKUP-V1'),
      [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [System.IO.File]::WriteAllBytes($OutputPath, $protected)
  }
  finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Unprotect-ArccFile {
  param([Parameter(Mandatory)][string]$InputPath, [Parameter(Mandatory)][string]$OutputPath)
  $protected = [System.IO.File]::ReadAllBytes($InputPath)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    [Text.Encoding]::UTF8.GetBytes('ARCC-BACKUP-V1'),
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  try { [System.IO.File]::WriteAllBytes($OutputPath, $plain) }
  finally { [Array]::Clear($plain, 0, $plain.Length) }
}
