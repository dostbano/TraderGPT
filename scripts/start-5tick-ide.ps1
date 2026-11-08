# 5Tick IDE launcher (Phase 7.1) — Extension Development Host as product shell
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Code = Join-Path $env:LocalAppData "Programs\Microsoft VS Code\bin\code.cmd"
if (-not (Test-Path $Code)) {
  $Code = Join-Path $env:LocalAppData "Programs\Microsoft VS Code\Code.exe"
}
if (-not (Test-Path $Code)) {
  throw "VS Code not found. Install VS Code first."
}

# Ensure extension is built
Push-Location $Root
try {
  npm run build -w 5tick | Out-Host
} finally {
  Pop-Location
}

# Health hint
try {
  $null = Invoke-RestMethod "http://127.0.0.1:3847/health" -TimeoutSec 2
  Write-Host "[5Tick IDE] agent OK on :3847"
} catch {
  Write-Host "[5Tick IDE] WARNING: agent not reachable. Start it with: npm run agent"
}

$demo = Join-Path $Root "demo-workspace"
$ext = Join-Path $Root "apps\extension"

Write-Host "[5Tick IDE] launching Extension Host..."
& $Code `
  --disable-workspace-trust `
  --extensionDevelopmentPath=$ext `
  $demo
