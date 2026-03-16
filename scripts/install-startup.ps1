param(
  [ValidateSet("TaskScheduler", "StartupShortcut", "Both")]
  [string]$Mode = "Both",
  [string]$TaskName = "GasNotify Base Fee",
  [string]$ConfigPath = "",
  [string]$BunPath = "bun",
  [string]$WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "GasNotify Base Fee.lnk"
$launcherScript = Join-Path $WorkingDirectory "scripts\start-gas-notify.ps1"

if (-not (Test-Path $launcherScript)) {
  throw "Launcher script not found at $launcherScript"
}

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", ('"' + $launcherScript + '"'),
  "-WorkingDirectory", ('"' + $WorkingDirectory + '"'),
  "-BunPath", ('"' + $BunPath + '"')
)

if ($ConfigPath) {
  $resolvedConfigPath = (Resolve-Path $ConfigPath).Path
  $argumentParts += @("-ConfigPath", ('"' + $resolvedConfigPath + '"'))
}

$arguments = $argumentParts -join ' '

if ($Mode -in @("TaskScheduler", "Both")) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $WorkingDirectory
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Write-Host "Created scheduled task: $TaskName"
}

if ($Mode -in @("StartupShortcut", "Both")) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,44"
  $shortcut.Save()
  Write-Host "Created startup shortcut: $shortcutPath"
}
