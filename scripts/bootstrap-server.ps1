# TraderGPT / 5Tick — first-run bootstrap for a new Windows server.
# Installs npm deps, builds packages, ensures .env, then can start services.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    throw "Node.js is not installed. Install Node 18+ from https://nodejs.org/ then re-run npm start"
  }
  $ver = (node -v) -replace "^v", ""
  $major = [int]($ver.Split(".")[0])
  if ($major -lt 18) {
    throw "Node.js $ver found; need 18+. Upgrade from https://nodejs.org/"
  }
  Write-Host "[TraderGPT] Node $(node -v) OK"
}

function Ensure-Env {
  $envFile = Join-Path $Root ".env"
  $example = Join-Path $Root ".env.example"
  if (-not (Test-Path $envFile)) {
    if (-not (Test-Path $example)) { throw ".env.example missing" }
    Copy-Item $example $envFile
    Write-Host "[TraderGPT] Created .env from .env.example — EDIT IT with your API keys before production use"
  } else {
    Write-Host "[TraderGPT] .env already present (keys not overwritten)"
  }
}

function Ensure-Install {
  if (-not (Test-Path (Join-Path $Root "node_modules"))) {
    Write-Host "[TraderGPT] npm install..."
    npm install
  } else {
    Write-Host "[TraderGPT] node_modules present — running npm install to sync workspaces..."
    npm install
  }
}

function Ensure-Build {
  Write-Host "[TraderGPT] Building shared + agent + cloud + extension..."
  npm run build
}

$StartServices = $args -contains "-Start"
Assert-Node
Ensure-Env
Ensure-Install
Ensure-Build

if ($StartServices) {
  Write-Host "[TraderGPT] Starting agent (background)..."
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "ensure-agent.ps1")
  ) -WorkingDirectory $Root -WindowStyle Minimized

  Write-Host "[TraderGPT] Starting cloud..."
  & (Join-Path $PSScriptRoot "start-cloud-bg.ps1")

  Write-Host ""
  Write-Host "[TraderGPT] Ready."
  Write-Host "  Agent health:  http://127.0.0.1:3847/health"
  Write-Host "  Cloud health:  http://127.0.0.1:3850/health"
  Write-Host "  Point Caddy/DNS for your domain to :3850 (you configure SSL/DNS)."
  Write-Host "  Edit .env for OpenAI/OpenRouter/Ollama/MT5 keys, then restart if needed."
} else {
  Write-Host "[TraderGPT] Bootstrap complete. Run: npm start   (or npm run server)"
}
