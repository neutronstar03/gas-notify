param(
  [string]$Version = "v0.9.1",
  [string]$Destination = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path "vendor\SnoreToast.exe")
)

$ErrorActionPreference = "Stop"

$destinationDir = Split-Path -Parent $Destination

New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null

if (Test-Path $Destination) {
  Write-Host "SnoreToast already present at $Destination"
  exit 0
}

$existingCommand = Get-Command "SnoreToast.exe" -ErrorAction SilentlyContinue
if ($existingCommand) {
  Copy-Item $existingCommand.Source $Destination -Force
  Write-Host "Copied SnoreToast from $($existingCommand.Source) to $Destination"
  exit 0
}

$downloadCandidates = @(
  "https://download.kde.org/stable/snoretoast/snoretoast-$Version.tar.bz2",
  "https://download.kde.org/stable/snoretoast/snoretoast-$Version.zip"
)

foreach ($url in $downloadCandidates) {
  try {
    $tempPath = Join-Path $env:TEMP ([IO.Path]::GetRandomFileName())
    Invoke-WebRequest -Uri $url -OutFile $tempPath
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
    Write-Warning "Downloaded archive from $url, but upstream does not publish a direct SnoreToast.exe binary there."
  }
  catch {
  }
}

throw @"
Unable to provision SnoreToast.exe automatically.

What the script checked:
- existing file at $Destination
- SnoreToast.exe already available on PATH
- KDE upstream download endpoints

Upstream currently exposes source archives, not a direct Windows executable, so please place SnoreToast.exe at:
$Destination
"@
