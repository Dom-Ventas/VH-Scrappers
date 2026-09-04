# Registers the Flipkart agent's scheduled task.
#
# Exists because right-click > "Run with PowerShell" cannot pass parameters, so
# register-task.ps1 -Kind flipkart is not reachable that way.
& (Join-Path $PSScriptRoot 'register-task.ps1') -Kind flipkart
