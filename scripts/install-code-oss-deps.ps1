# Phase 7 — install Code-OSS deps (Node 24 required by upstream .nvmrc)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Vscode = Join-Path $Root "apps\ide\vscode"
$Node24 = "C:\Tools\nodejs-24\node.exe"
$Npm24 = "C:\Tools\nodejs-24\npm.cmd"

if (-not (Test-Path (Join-Path $Vscode "package.json"))) {
  throw "Code-OSS missing. Run: npm run ide:bootstrap"
}
if (-not (Test-Path $Node24)) {
  throw "Node 24 not found at $Node24. Install node-v24.18.0-win-x64 into C:\Tools\nodejs-24"
}

$targetsXml = @"
<Project>
  <PropertyGroup>
    <SpectreMitigation>false</SpectreMitigation>
  </PropertyGroup>
</Project>
"@

function Write-SpectreBypass([string]$Dir) {
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  Set-Content -Path (Join-Path $Dir "Directory.Build.targets") -Value $targetsXml -Encoding UTF8
  $props = Join-Path $Dir "Directory.Build.props"
  if (Test-Path $props) { Remove-Item $props -Force }
}

Write-SpectreBypass $Vscode

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw "VS C++ Build Tools missing" }
$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"

& (Join-Path $PSScriptRoot "ensure-spectre-lib-mirror.ps1")

Write-Host "[5Tick] Using Node $(& $Node24 -v) for Code-OSS"
Write-Host "[5Tick] Step 1/3: npm install --ignore-scripts"
$tmp = Join-Path $env:TEMP "5tick-npm-oss.cmd"
$cmd1 = @"
call "$vcvars"
cd /d "$Vscode"
set PATH=C:\Tools\nodejs-24;%PATH%
set npm_config_msvs_version=2022
"$Npm24" install --ignore-scripts --no-fund --no-audit
if errorlevel 1 exit /b 1
"@
Set-Content $tmp $cmd1 -Encoding ASCII
cmd /c $tmp
if ($LASTEXITCODE -ne 0) { throw "npm install --ignore-scripts failed ($LASTEXITCODE)" }

Write-Host "[5Tick] Step 2/3: inject Spectre bypass"
Write-SpectreBypass (Join-Path $Vscode "node_modules")
Get-ChildItem (Join-Path $Vscode "node_modules") -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  if (Test-Path (Join-Path $_.FullName "binding.gyp")) { Write-SpectreBypass $_.FullName }
}
$scoped = Join-Path $Vscode "node_modules\@vscode"
if (Test-Path $scoped) {
  Get-ChildItem $scoped -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-Path (Join-Path $_.FullName "binding.gyp")) { Write-SpectreBypass $_.FullName }
  }
}

Write-Host "[5Tick] Step 3/3: npm rebuild native modules (Node 24)"
$cmd2 = @"
call "$vcvars"
cd /d "$Vscode"
set PATH=C:\Tools\nodejs-24;%PATH%
set npm_config_msvs_version=2022
"$Npm24" rebuild --ignore-scripts
if errorlevel 1 exit /b 1
REM rebuild without lifecycle scripts still won't compile natives — run node-gyp per package
for /d %%D in (node_modules\@vscode\*) do (
  if exist "%%D\binding.gyp" (
    echo [5Tick] gyp %%~nxD
    pushd "%%D"
    call "$vcvars" >nul
    C:\Tools\nodejs-24\node.exe C:\Tools\nodejs-24\node_modules\npm\node_modules\node-gyp\bin\node-gyp.js rebuild --msvs_version=2022
    if errorlevel 1 (
      echo [5Tick] WARN native rebuild failed for %%~nxD
    )
    popd
  )
)
for /d %%D in (node_modules\*) do (
  if exist "%%D\binding.gyp" (
    echo [5Tick] gyp %%~nxD
    pushd "%%D"
    C:\Tools\nodejs-24\node.exe C:\Tools\nodejs-24\node_modules\npm\node_modules\node-gyp\bin\node-gyp.js rebuild --msvs_version=2022
    if errorlevel 1 (
      echo [5Tick] WARN native rebuild failed for %%~nxD
    )
    popd
  )
)
echo [5Tick] npm install finished OK
"@
Set-Content $tmp $cmd2 -Encoding ASCII
cmd /c $tmp
if ($LASTEXITCODE -ne 0) { throw "native rebuild step failed ($LASTEXITCODE)" }

Write-Host "[5Tick] Next: npm run ide:compile-oss"
