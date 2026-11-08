# Build classic Windows Setup.exe with Inno Setup 6
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $Root "apps\ide\dist\5Tick-win32-x64"
$OutDir = Join-Path $Root "apps\ide\dist"
$Brand = Join-Path $Root "apps\ide\branding"
$Iss = Join-Path $Brand "5tick-setup.iss"

if (-not (Test-Path (Join-Path $AppDir "5Tick.exe"))) {
  throw "Missing 5Tick.exe under apps/ide/dist/5Tick-win32-x64. Run npm run ide:installer first."
}

# Ensure agent embedded
& (Join-Path $PSScriptRoot "embed-agent-into-ide.ps1") $AppDir

# Locate / install Inno
$iscc = @(
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
  "C:\Tools\InnoSetup\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $iscc) {
  $installer = Join-Path $env:TEMP "innosetup-installer.exe"
  if (-not (Test-Path $installer) -or (Get-Item $installer).Length -lt 1000000) {
    Write-Host "Downloading Inno Setup..."
    Invoke-WebRequest -Uri "https://github.com/jrsoftware/issrc/releases/download/is-6_4_3/innosetup-6.4.3.exe" `
      -OutFile $installer -UseBasicParsing
  }
  Write-Host "Installing Inno Setup (silent)..."
  $tools = "C:\Tools\InnoSetup"
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  Start-Process -FilePath $installer -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART","/DIR=`"$tools`"" -Wait
  $iscc = Join-Path $tools "ISCC.exe"
  if (-not (Test-Path $iscc)) {
    $iscc = @(
      "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
      "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
}
if (-not $iscc -or -not (Test-Path $iscc)) {
  throw "ISCC.exe not found after Inno install"
}

$ico = Join-Path $Brand "5tick.ico"
# Literal ISS body (no PowerShell expansion)
$lines = @(
  '#define MyAppName "5Tick IDE"',
  '#define MyAppVersion "0.1.0"',
  '#define MyAppPublisher "5Tick"',
  '#define MyAppExeName "5Tick.exe"',
  '',
  '[Setup]',
  'AppId={{A5T1CK-1DE0-4F5A-9B2C-5TICKINSTALL}}',
  'AppName={#MyAppName}',
  'AppVersion={#MyAppVersion}',
  'AppPublisher={#MyAppPublisher}',
  'DefaultDirName={autopf}\5Tick',
  'DefaultGroupName=5Tick',
  'DisableProgramGroupPage=yes',
  ('OutputDir=' + $OutDir),
  'OutputBaseFilename=5Tick-Setup-win64',
  ('SetupIconFile=' + $ico),
  'Compression=lzma2',
  'SolidCompression=yes',
  'WizardStyle=modern',
  'PrivilegesRequired=lowest',
  'ArchitecturesInstallIn64BitMode=x64compatible',
  'UninstallDisplayIcon={app}\{#MyAppExeName}',
  '',
  '[Languages]',
  'Name: "english"; MessagesFile: "compiler:Default.isl"',
  '',
  '[Tasks]',
  'Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"',
  '',
  '[Files]',
  ('Source: "' + $AppDir + '\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs'),
  '',
  '[Icons]',
  'Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"',
  'Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"; Tasks: desktopicon',
  '',
  '[Run]',
  'Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"; Description: "Launch 5Tick IDE"; Flags: nowait postinstall skipifsilent'
)
Set-Content -Path $Iss -Value $lines -Encoding ASCII
Write-Host ("Compiling Setup.exe via " + $iscc)
& $iscc $Iss
if ($LASTEXITCODE -ne 0) { throw ("ISCC failed (" + $LASTEXITCODE + ")") }

$setup = Join-Path $OutDir "5Tick-Setup-win64.exe"
if (Test-Path $setup) {
  Get-Item $setup | Format-List FullName, @{N='MB';E={[math]::Round($_.Length/1MB,1)}}
  Write-Host ("Classic installer ready: " + $setup)
} else {
  throw "Setup exe not produced"
}
