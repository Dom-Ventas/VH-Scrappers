# Registers the VentaHub Scraper Agent to run every 4 hours via Task Scheduler.
# Run this ONCE per laptop (right-click > Run with PowerShell) after copying the
# agent folder (VentaHubAgent.exe + the scraper exes) onto the machine.

$ErrorActionPreference = "Stop"

$ExeName = "VentaHubAgent.exe"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# The exe sits one level up from the install/ folder, or alongside this script.
$Candidates = @(
    (Join-Path $ScriptDir $ExeName),
    (Join-Path (Split-Path -Parent $ScriptDir) $ExeName)
)
$ExePath = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $ExePath) {
    throw "Could not find $ExeName near this script. Put register-task.ps1 next to $ExeName (or in an install\ subfolder)."
}
$ExeDir = Split-Path -Parent $ExePath

$TaskName = "VentaHub Scraper Agent"

$Action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $ExeDir

# Fire 5 minutes from now, then repeat every 4 hours forever.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours 4)

# IgnoreNew => never start a second instance while one is still running.
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

# Run as the logged-in user, interactively, so Chrome can use the signed-in
# Amazon session in the shared profile.
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "  Exe:      $ExePath"
Write-Host "  Schedule: every 4 hours (first run ~5 min from now)."
Write-Host ""
Write-Host "IMPORTANT — first-time setup:"
Write-Host "  Double-click $ExeName once now to enter your email + profile IDs and"
Write-Host "  sign in to Amazon. After that, the scheduled task runs unattended."
