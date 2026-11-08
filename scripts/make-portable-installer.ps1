# Creates a portable "installer" zip for 5Tick until full Code-OSS setup.exe is built.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "apps\ide\dist"
$Stage = Join-Path $Dist "5Tick-portable"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

# Ensure VSIX
& (Join-Path $PSScriptRoot "package-vsix.ps1")

Copy-Item (Join-Path $Root "apps\ide\5tick-extension.vsix") $Stage -Force
Copy-Item (Join-Path $Root ".env.example") (Join-Path $Stage "env.example") -Force

$launch = @"
@echo off
set ROOT=%~dp0
echo [5Tick] Portable launcher
echo 1) Ensure agent is running from the 5Tick repo: npm run agent
echo 2) Starting VS Code with 5Tick extension...
set CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe
if not exist "%CODE%" set CODE=%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd
"%CODE%" --disable-workspace-trust --install-extension "%ROOT%5tick-extension.vsix" --force
"%CODE%" --disable-workspace-trust
"@
Set-Content -Path (Join-Path $Stage "Start-5Tick.bat") -Value $launch -Encoding ASCII

$readme = @"
# 5Tick portable package

1. From the full repo, run: npm run agent
2. Double-click Start-5Tick.bat (installs the VSIX into VS Code)
3. Open a project folder and use the 5Tick activity bar icon

Full Code-OSS branded IDE compile is separate (npm run ide:compile-oss / ide:installer).
"@
Set-Content -Path (Join-Path $Stage "README.txt") -Value $readme -Encoding UTF8

$zip = Join-Path $Dist "5Tick-portable-win64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $zip -Force
Write-Host "[5Tick] Portable installer zip: $zip"
Get-Item $zip | Format-List FullName, Length
