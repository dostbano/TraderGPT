# Phase 7.3 — shallow clone Code-OSS and apply 5Tick branding
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Ide = Join-Path $Root "apps\ide"
$Target = Join-Path $Ide "vscode"
$PatchFile = Join-Path $Ide "branding\product.json.patch.json"

New-Item -ItemType Directory -Force -Path $Ide | Out-Null

if (-not (Test-Path (Join-Path $Target ".git"))) {
  Write-Host "[5Tick] Cloning microsoft/vscode (shallow, main)..."
  Write-Host "[5Tick] This can take several minutes..."
  git clone --depth 1 --branch main https://github.com/microsoft/vscode.git $Target
} else {
  Write-Host "[5Tick] vscode already present at $Target"
}

$productPath = Join-Path $Target "product.json"
if (-not (Test-Path $productPath)) {
  throw "product.json missing after clone"
}

$product = Get-Content $productPath -Raw | ConvertFrom-Json
$patch = Get-Content $PatchFile -Raw | ConvertFrom-Json
foreach ($p in $patch.PSObject.Properties) {
  $product | Add-Member -NotePropertyName $p.Name -NotePropertyValue $p.Value -Force
}

# Backup original once
$bak = Join-Path $Target "product.json.upstream.bak"
if (-not (Test-Path $bak)) {
  Copy-Item $productPath $bak
}

$json = $product | ConvertTo-Json -Depth 40
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($productPath, $json, $utf8NoBom)
Write-Host "[5Tick] Branded product.json -> nameShort=$($product.nameShort)"
Write-Host "[5Tick] Next (manual, long):"
Write-Host "  cd apps\ide\vscode"
Write-Host "  npm install   # or yarn via corepack"
Write-Host "  npm run watch # / scripts\code.bat on Windows after deps"
Write-Host "[5Tick] Day-to-day use npm run ide until full build works."
