<#
Installs the middleware as an auto-start Windows service with NSSM (https://nssm.cc).
Run from an elevated PowerShell on the server after `npm ci --omit=dev` and creating .env:

  powershell -ExecutionPolicy Bypass -File scripts\install-windows-service.ps1 -NssmPath C:\tools\nssm\nssm.exe

Re-running replaces an existing service with the same name.
#>
param(
  [string]$ServiceName = 'wxcc-custom-channel',
  [string]$NssmPath = 'nssm.exe'
)

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$serverJs = Join-Path $appDir 'src\server.js'
$logDir = Join-Path $appDir 'logs'
$node = (Get-Command node.exe -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $appDir '.env'))) {
  throw ".env not found in $appDir. Copy .env.example to .env and fill it in first."
}
if (-not (Test-Path (Join-Path $appDir 'node_modules'))) {
  throw "node_modules not found in $appDir. Run 'npm ci --omit=dev' first."
}

$nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or newer is required (found $(& $node --version))."
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "Replacing existing service $ServiceName"
  & $NssmPath stop $ServiceName | Out-Null
  & $NssmPath remove $ServiceName confirm | Out-Null
}

& $NssmPath install $ServiceName $node
& $NssmPath set $ServiceName AppParameters "`"$serverJs`""
& $NssmPath set $ServiceName AppDirectory $appDir
& $NssmPath set $ServiceName AppEnvironmentExtra NODE_ENV=production
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir 'service.log')
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir 'service.err.log')
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath start $ServiceName

Write-Host "Service $ServiceName installed. Logs: $logDir"
