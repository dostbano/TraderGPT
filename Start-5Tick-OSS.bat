@echo off
set ROOT=%~dp0
set APP=%ROOT%apps\ide\dist\5Tick-win32-x64
if not exist "%APP%\5Tick.exe" set APP=%ROOT%apps\ide\VSCode-win32-x64
if not exist "%APP%\5Tick.exe" (
  echo [5Tick] Build missing. Run: npm run ide:installer
  exit /b 1
)
REM Agent is auto-started by the built-in extension when the IDE opens.
REM Optional: still ensure standalone agent if you prefer monorepo mode.
start "" "%APP%\5Tick.exe" --disable-workspace-trust %*
