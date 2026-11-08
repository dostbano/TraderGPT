@echo off
setlocal
set ROOT=%~dp0..
set VSCODE=%ROOT%\apps\ide\vscode
set DEMO=%ROOT%\demo-workspace
set PATH=C:\Tools\nodejs-24;%PATH%

echo [5Tick] Starting compiled Code-OSS (branded 5Tick)...
echo [5Tick] Tip: keep the agent running: npm run agent

if not exist "%VSCODE%\out\main.js" (
  echo [5Tick] ERROR: not compiled. Run: npm run ide:compile-oss
  exit /b 1
)

cd /d "%VSCODE%"
call scripts\code.bat "%DEMO%"
