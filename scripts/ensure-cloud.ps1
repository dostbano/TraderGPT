# Start 5Tick cloud control plane on :3850 if not already healthy.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

try {
  $h = Invoke-RestMethod "http://127.0.0.1:3850/health" -TimeoutSec 2
  if ($h.ok) {
    Write-Host "[5Tick] cloud already running on :3850 (public=$($h.publicBaseUrl))"
    exit 0
  }
} catch {
  # not running
}

Write-Host "[5Tick] starting cloud..."
Set-Location $Root

# Load root .env into process env for this session
$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    Set-Item -Path "Env:$k" -Value $v
  }
}

if (-not $env:FIVETICK_PUBLIC_BASE_URL) { $env:FIVETICK_PUBLIC_BASE_URL = "https://ai.11tick.com" }
if (-not $env:FIVETICK_AGENT_URL) { $env:FIVETICK_AGENT_URL = "http://127.0.0.1:3847" }
if (-not $env:FIVETICK_AUTH_ENABLED) { $env:FIVETICK_AUTH_ENABLED = "0" }
if (-not $env:FIVETICK_CLOUD_PORT) { $env:FIVETICK_CLOUD_PORT = "3850" }
if (-not $env:FIVETICK_CLOUD_HOST) { $env:FIVETICK_CLOUD_HOST = "0.0.0.0" }

npm run start -w @5tick/cloud
