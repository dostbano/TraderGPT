# Start 5Tick agent only if port 3847 is free; otherwise reuse the running one.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

try {
  $h = Invoke-RestMethod "http://127.0.0.1:3847/health" -TimeoutSec 2
  if ($h.ok) {
    Write-Host "[5Tick] agent already running on :3847 (product=$($h.product) model=$($h.model))"
    exit 0
  }
} catch {
  # not running
}

Write-Host "[5Tick] starting agent..."
Set-Location $Root
npm run start -w @5tick/agent
