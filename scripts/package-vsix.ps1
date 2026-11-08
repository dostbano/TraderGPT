# Phase 7.2 — package the VS Code extension as a .vsix (extension folder only)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Ext = Join-Path $Root "apps\extension"
$Out = Join-Path $Root "apps\ide\5tick-extension.vsix"

Push-Location $Root
try {
  npm run build -w 5tick | Out-Host
} finally {
  Pop-Location
}

# Remove a previous oversized package if present
if (Test-Path $Out) { Remove-Item $Out -Force }

Push-Location $Ext
try {
  npx --yes @vscode/vsce package --allow-missing-repository --skip-license -o $Out | Out-Host
} finally {
  Pop-Location
}

$item = Get-Item $Out
Write-Host "[5Tick] VSIX written: $($item.FullName) ($([math]::Round($item.Length/1KB,1)) KB)"
if ($item.Length -gt 5MB) {
  Write-Host "[5Tick] WARNING: VSIX is unexpectedly large; check .vscodeignore"
}
