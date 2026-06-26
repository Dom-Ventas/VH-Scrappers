$dir = Join-Path $env:LOCALAPPDATA 'SearchTermScrapper\chrome-profile'
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
$settings = @{
  emailId = 'dev@example.com'
  profileId = 'DEV-001'
  firstRunCompletedAt = (Get-Date -Format o)
} | ConvertTo-Json
$path = Join-Path $dir 'user-settings.json'
Set-Content -Path $path -Value $settings
Write-Host "Seeded: $path"
Get-Content $path
