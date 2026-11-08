# Phase 7.5 - build Windows x64 app folder / portable zip via gulp
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vscode = Join-Path $Root "apps\ide\vscode"
$OutDir = Join-Path $Root "apps\ide\dist"
$Node24Dir = "C:\Tools\nodejs-24"
$Npm24 = Join-Path $Node24Dir "npm.cmd"

if (-not (Test-Path (Join-Path $Vscode "out\main.js"))) {
  Write-Host "[5Tick] out/ missing - compiling first..."
  & (Join-Path $PSScriptRoot "compile-code-oss.ps1")
}
if (-not (Test-Path $Npm24)) {
  throw "Node 24 missing at $Node24Dir"
}

& (Join-Path $PSScriptRoot "ensure-spectre-lib-mirror.ps1")

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# Parent monorepo @types/vscode conflicts with Code-OSS typecheck during package
$hideTypes = Join-Path $Root "node_modules\@types\vscode"
$hiddenTypes = Join-Path $Root "node_modules\@types\vscode.__5tick_hide"
$didHide = $false
if ((Test-Path $hideTypes) -and -not (Test-Path $hiddenTypes)) {
  Rename-Item $hideTypes "vscode.__5tick_hide"
  $didHide = $true
  Write-Host "[5Tick] temporarily hid monorepo @types/vscode"
}

# Skip marketplace built-ins (async download is flaky offline / rate-limited)
$productPath = Join-Path $Vscode "product.json"
$product = Get-Content $productPath -Raw | ConvertFrom-Json
$product.builtInExtensions = @()
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($productPath, ($product | ConvertTo-Json -Depth 40), $utf8)
Write-Host "[5Tick] cleared builtInExtensions for packaging"

try {
  Write-Host "[5Tick] Packaging win32-x64 (gulp vscode-win32-x64-min). Long running..."
  $tmp = Join-Path $env:TEMP "5tick-package-oss.cmd"
  $cmdLines = @(
    ('call "' + $vcvars + '"'),
    ('cd /d "' + $Vscode + '"'),
    ('set PATH=' + $Node24Dir + ';%PATH%'),
    'set npm_config_msvs_version=2022',
    ('"' + $Npm24 + '" run gulp -- vscode-win32-x64-min'),
    'if errorlevel 1 (',
    '  echo [5Tick] min failed, trying full vscode-win32-x64',
    ('  "' + $Npm24 + '" run gulp -- vscode-win32-x64'),
    ')',
    'echo PACKAGE_EXIT=%ERRORLEVEL%'
  )
  Set-Content -Path $tmp -Value $cmdLines -Encoding ASCII
  cmd /c $tmp
  $gulpExit = $LASTEXITCODE
  $packaged = Join-Path (Split-Path $Vscode -Parent) "VSCode-win32-x64"
  $hasExe = (Test-Path (Join-Path $packaged "5Tick.exe")) -or (Test-Path (Join-Path $packaged "Code - OSS.exe")) -or (Test-Path (Join-Path $packaged "Code.exe"))
  if ($gulpExit -ne 0 -and -not $hasExe) {
    throw ("gulp win32 package failed (" + $gulpExit + ")")
  }
  if ($gulpExit -ne 0 -and $hasExe) {
    Write-Host ("[5Tick] gulp exited " + $gulpExit + " but VSCode-win32-x64 app folder exists - continuing")
  }
} finally {
  if ($didHide -and (Test-Path $hiddenTypes) -and -not (Test-Path $hideTypes)) {
    Rename-Item $hiddenTypes "vscode"
    Write-Host "[5Tick] restored monorepo @types/vscode"
  }
}

$candidates = @(
  (Join-Path $Root "apps\ide\VSCode-win32-x64"),
  (Join-Path (Split-Path $Vscode -Parent) "VSCode-win32-x64"),
  (Join-Path $Vscode "VSCode-win32-x64")
)

$found = $null
foreach ($c in $candidates) {
  if (Test-Path $c) { $found = $c; break }
}
if (-not $found) {
  $found = Get-ChildItem -Path (Split-Path $Vscode -Parent), $Root -Directory -Filter "VSCode-win32-x64*" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $found) {
  Write-Host "[5Tick] WARNING: could not locate VSCode-win32-x64 output. Check apps\ide\"
  exit 1
}

# Repair asar package.json corruption before copying to dist
$appRes = Join-Path $found "resources\app"
& (Join-Path $PSScriptRoot "fix-asar-package-json.ps1") -AppResourcesDir $appRes

# Drop incomplete Copilot (optional; SDK often missing in OSS package)
$copilot = Join-Path $found "resources\app\extensions\copilot"
if (Test-Path $copilot) {
  Write-Host "[5Tick] removing incomplete built-in copilot extension"
  cmd /c ("rmdir /s /q `"" + $copilot + "`"")
}

$dest = Join-Path $OutDir "5Tick-win32-x64"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Write-Host "[5Tick] Copying app folder to dist..."
robocopy $found $dest /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
Write-Host ("[5Tick] App folder: " + $dest)

# Embed 5Tick agent extension if VSIX present
$vsix = Join-Path $Root "apps\ide\5tick-extension.vsix"
if (-not (Test-Path $vsix)) {
  try { & (Join-Path $PSScriptRoot "package-vsix.ps1") } catch { Write-Host "[5Tick] vsix package skipped" }
}
if (Test-Path $vsix) {
  $extDir = Join-Path $dest "resources\app\extensions\5tick.5tick-agent"
  $tmp = Join-Path $env:TEMP "5tick-vsix-embed"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Copy-Item $vsix (Join-Path $tmp "ext.zip") -Force
  Expand-Archive (Join-Path $tmp "ext.zip") (Join-Path $tmp "unpacked") -Force
  $payload = Join-Path $tmp "unpacked\extension"
  if (Test-Path $payload) {
    New-Item -ItemType Directory -Force -Path $extDir | Out-Null
    robocopy $payload $extDir /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    Write-Host "[5Tick] embedded 5Tick extension"
  }
}

$exe = @(Get-ChildItem $dest -Filter "*.exe" -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(5Tick|Code|Code - OSS)' }) |
  Select-Object -First 1
if ($exe) {
  Write-Host ("[5Tick] Run: " + $exe.FullName)
}

$zip = Join-Path $OutDir "5Tick-win32-x64-portable.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host "[5Tick] Zipping portable app with tar..."
Push-Location $dest
try {
  tar -a -c -f $zip *
} finally {
  Pop-Location
}
Write-Host ("[5Tick] Portable zip: " + $zip)

$launcher = Join-Path $OutDir "Start-5Tick-IDE.bat"
$launchLines = @(
  '@echo off',
  'set ROOT=%~dp0',
  'set APP=%ROOT%5Tick-win32-x64',
  'set EXE=',
  'if exist "%APP%\5Tick.exe" set EXE=%APP%\5Tick.exe',
  'if not defined EXE if exist "%APP%\Code - OSS.exe" set EXE=%APP%\Code - OSS.exe',
  'if not defined EXE if exist "%APP%\Code.exe" set EXE=%APP%\Code.exe',
  'if not defined EXE (',
  '  echo [5Tick] App exe not found under %APP%',
  '  exit /b 1',
  ')',
  'start "" "%EXE%" --disable-workspace-trust %*'
)
Set-Content -Path $launcher -Value $launchLines -Encoding ASCII

$rootLauncher = Join-Path $Root "Start-5Tick-OSS.bat"
$rootLaunch = @(
  '@echo off',
  'set ROOT=%~dp0',
  'set APP=%ROOT%apps\ide\dist\5Tick-win32-x64',
  'if not exist "%APP%\5Tick.exe" set APP=%ROOT%apps\ide\VSCode-win32-x64',
  'if not exist "%APP%\5Tick.exe" (',
  '  echo [5Tick] Build missing. Run: npm run ide:installer',
  '  exit /b 1',
  ')',
  'start "" "%APP%\5Tick.exe" --disable-workspace-trust %*'
)
Set-Content -Path $rootLauncher -Value $rootLaunch -Encoding ASCII
Write-Host ("[5Tick] Launcher: " + $launcher)
Write-Host ("[5Tick] Launcher: " + $rootLauncher)

# Optional Inno user-setup (requires Inno Setup installed)
$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
  $tmpSetup = Join-Path $env:TEMP "5tick-package-setup.cmd"
  $setupLines = @(
    ('call "' + $vcvars + '" >nul'),
    ('cd /d "' + $Vscode + '"'),
    ('set PATH=' + $Node24Dir + ';%PATH%'),
    ('"' + $Npm24 + '" run gulp -- vscode-win32-x64-user-setup')
  )
  Set-Content -Path $tmpSetup -Value $setupLines -Encoding ASCII
  cmd /c $tmpSetup
  if ($LASTEXITCODE -eq 0) {
    $setup = Get-ChildItem -Path (Join-Path $Vscode ".build") -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "Setup|User" } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 3
    foreach ($s in $setup) {
      Copy-Item $s.FullName (Join-Path $OutDir $s.Name) -Force
      Write-Host ("[5Tick] Installer copied: " + $s.Name)
    }
  }
} else {
  Write-Host "[5Tick] Inno Setup not installed - portable folder/zip is the installer artifact"
}

Write-Host ("[5Tick] Artifacts under: " + $OutDir)
