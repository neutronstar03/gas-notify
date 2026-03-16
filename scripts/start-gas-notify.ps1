param(
  [string]$WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [string]$BunPath = "bun",
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

if ($ConfigPath) {
  $env:GAS_NOTIFY_CONFIG = (Resolve-Path $ConfigPath).Path
}

Push-Location $WorkingDirectory
try {
  & $BunPath run "src/main.ts"
}
finally {
  Pop-Location
}
