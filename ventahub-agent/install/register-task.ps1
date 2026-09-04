# Registers a VentaHub Scraper Agent to run every 4 hours via Task Scheduler.
# Run this ONCE per laptop PER MARKETPLACE (right-click > Run with PowerShell)
# after copying the agent folder (the agent exe + its scraper exes) onto the
# machine.
#
# A laptop can run more than one agent — one per marketplace, each with its own
# Chrome profile, device id and schedule. Every kind therefore gets its OWN
# task name: they used to share one, and because Register-ScheduledTask is
# called with -Force, installing a second agent would have silently replaced
# the first one's task and stopped it running.
#
# Right-click > "Run with PowerShell" cannot pass arguments, so use the
# per-marketplace wrappers next to this file (register-task-flipkart.ps1,
# register-task-noon.ps1). Running THIS script directly registers the Amazon
# agent, which is what it always did.

param(
    [ValidateSet('amazon', 'flipkart', 'noon')]
    [string]$Kind = 'amazon'
)

$ErrorActionPreference = "Stop"

$Spec = @{
    amazon   = @{ Exe = 'VentaHubAgent.exe';         Task = 'VentaHub Scraper Agent';            Site = 'Amazon' }
    flipkart = @{ Exe = 'VentaHubAgentFlipkart.exe'; Task = 'VentaHub Scraper Agent (Flipkart)'; Site = 'Flipkart' }
    noon     = @{ Exe = 'VentaHubAgentNoon.exe';     Task = 'VentaHub Scraper Agent (Noon)';     Site = 'noon' }
}[$Kind]

$ExeName = $Spec.Exe
$TaskName = $Spec.Task

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

$Action = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $ExeDir

# Fire 5 minutes from now, then repeat every 4 hours forever.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
    -RepetitionInterval (New-TimeSpan -Hours 4)

# IgnoreNew => never start a second instance of THIS task while one is still
# running. Different marketplaces are different tasks, so they may overlap —
# which is fine and intended: each has its own Chrome profile, so they do not
# contend for Chromium's profile lock.
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 3)

# Run as the logged-in user, interactively, so Chrome can use the signed-in
# session in this agent's profile.
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
    -Settings $Settings -Principal $Principal -Force | Out-Null

Write-Host "Registered scheduled task '$TaskName'."
Write-Host "  Kind:     $Kind"
Write-Host "  Exe:      $ExePath"
Write-Host "  Schedule: every 4 hours (first run ~5 min from now)."
Write-Host ""
Write-Host "IMPORTANT — first-time setup:"
Write-Host "  Double-click $ExeName once now to enter your email + profile IDs and"
Write-Host "  sign in to $($Spec.Site). After that, the scheduled task runs unattended."
Write-Host "  Each marketplace agent has its own browser profile, so this sign-in is"
Write-Host "  needed once per agent, not once per laptop."
