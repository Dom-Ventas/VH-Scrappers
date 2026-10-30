$dir = Join-Path $env:LOCALAPPDATA 'SearchTermScrapper\chrome-profile'
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
# storeIds are VentaWiz store ids (integers). A file with only the old
# VentaHub profileIds is ignored and the first-run form is shown again.
$settings = @{
  emailId = 'dev@example.com'
  storeIds = @(13)
  firstRunCompletedAt = (Get-Date -Format o)
} | ConvertTo-Json
$path = Join-Path $dir 'user-settings.json'
Set-Content -Path $path -Value $settings
Write-Host "Seeded: $path"
Get-Content $path
