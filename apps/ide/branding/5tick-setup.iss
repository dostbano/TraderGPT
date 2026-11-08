#define MyAppName "5Tick IDE"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "5Tick"
#define MyAppExeName "5Tick.exe"

[Setup]
AppId={{A5T1CK-1DE0-4F5A-9B2C-5TICKINSTALL}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\5Tick
DefaultGroupName=5Tick
DisableProgramGroupPage=yes
OutputDir=C:\Users\Administrator\Desktop\AiAgent\5Tick\apps\ide\dist
OutputBaseFilename=5Tick-Setup-win64
SetupIconFile=C:\Users\Administrator\Desktop\AiAgent\5Tick\apps\ide\branding\5tick.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "C:\Users\Administrator\Desktop\AiAgent\5Tick\apps\ide\dist\5Tick-win32-x64\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-workspace-trust"; Description: "Launch 5Tick IDE"; Flags: nowait postinstall skipifsilent
