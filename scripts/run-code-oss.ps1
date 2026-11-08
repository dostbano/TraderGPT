# Run packaged 5Tick IDE (preferred) or compiled Code-OSS via scripts\code.bat
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vscode = Join-Path $Root "apps\ide\vscode"
$Demo = Join-Path $Root "demo-workspace"

try {
  $null = Invoke-RestMethod "http://127.0.0.1:3847/health" -TimeoutSec 2
} catch {
  Write-Host "[5Tick] WARNING: agent not on :3847 - start with npm run agent"
}

$packaged = @(
  (Join-Path $Root "apps\ide\dist\5Tick-win32-x64\5Tick.exe"),
  (Join-Path $Root "apps\ide\VSCode-win32-x64\5Tick.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($packaged) {
  Write-Host ("[5Tick] Launching " + $packaged)
  Start-Process -FilePath $packaged -ArgumentList @("--disable-workspace-trust", $Demo)
  exit 0
}

$scriptsCode = Join-Path $Vscode "scripts\code.bat"
if (Test-Path $scriptsCode) {
  Push-Location $Vscode
  try {
    & cmd /c ("scripts\code.bat `"" + $Demo + "`"")
  } finally {
    Pop-Location
  }
  exit 0
}

throw "Packaged 5Tick IDE not found. Run: npm run ide:installer"
