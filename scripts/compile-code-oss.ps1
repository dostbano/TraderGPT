# Phase 7.4 - compile Code-OSS JS/TS with Node 24
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vscode = Join-Path $Root "apps\ide\vscode"
$Node24Dir = "C:\Tools\nodejs-24"
$Npm24 = Join-Path $Node24Dir "npm.cmd"

if (-not (Test-Path (Join-Path $Vscode "node_modules"))) {
  throw "Deps missing. Run: npm run ide:install-oss"
}
if (-not (Test-Path $Npm24)) {
  throw "Node 24 missing at $Node24Dir"
}

& (Join-Path $PSScriptRoot "ensure-spectre-lib-mirror.ps1")

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"

# Parent monorepo @types/vscode conflicts with Code-OSS typecheck
$hideTypes = Join-Path $Root "node_modules\@types\vscode"
$hiddenTypes = Join-Path $Root "node_modules\@types\vscode.__5tick_hide"
$didHide = $false
if ((Test-Path $hideTypes) -and -not (Test-Path $hiddenTypes)) {
  Rename-Item $hideTypes "vscode.__5tick_hide"
  $didHide = $true
  Write-Host "[5Tick] temporarily hid monorepo @types/vscode"
}

Write-Host "[5Tick] Compiling Code-OSS (can take 30-90+ minutes)..."
$tmp = Join-Path $env:TEMP "5tick-compile-oss.cmd"
$cmd = @"
call "$vcvars"
cd /d "$Vscode"
set PATH=$Node24Dir;%PATH%
set npm_config_msvs_version=2022
REM Skip compile-copilot (often breaks; not required for 5Tick IDE core)
"$Npm24" run gulp compile
if errorlevel 1 exit /b 1
"$Npm24" run gulp compile-extensions
if errorlevel 1 (
  echo [5Tick] WARN compile-extensions failed - core may still run
)
echo [5Tick] compile OK
"@
Set-Content $tmp $cmd -Encoding ASCII
try {
  cmd /c $tmp
  if ($LASTEXITCODE -ne 0) { throw "compile failed ($LASTEXITCODE)" }
} finally {
  if ($didHide -and (Test-Path $hiddenTypes) -and -not (Test-Path $hideTypes)) {
    Rename-Item $hiddenTypes "vscode"
    Write-Host "[5Tick] restored monorepo @types/vscode"
  }
}
Write-Host "[5Tick] Next: npm run ide:run-oss  or  npm run ide:installer"
