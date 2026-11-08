# Repair corrupted files inside resources/app/node_modules.asar by overlaying
# matching paths from apps/ide/vscode/node_modules (gulp/asar can swap same-size files).
param(
  [Parameter(Mandatory = $true)][string]$AppResourcesDir
)

$ErrorActionPreference = "Stop"

$asarPath = Join-Path $AppResourcesDir "node_modules.asar"
if (-not (Test-Path $asarPath)) {
  Write-Host "[5Tick] no node_modules.asar at $asarPath - skip"
  exit 0
}

$Node24 = "C:\Tools\nodejs-24\node.exe"
$Root = Split-Path -Parent $PSScriptRoot
$Vscode = Join-Path $Root "apps\ide\vscode"
$asarCli = Join-Path $Vscode "node_modules\asar\bin\asar.js"
$nmRoot = Join-Path $Vscode "node_modules"

if (-not (Test-Path $Node24)) { throw "Node 24 missing at $Node24" }
if (-not (Test-Path $asarCli)) { throw "asar CLI missing at $asarCli" }

$work = Join-Path $env:TEMP ("5tick-asar-fix-" + [guid]::NewGuid().ToString("n"))
$extractDir = Join-Path $work "root"
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

Write-Host "[5Tick] Extracting asar..."
& $Node24 $asarCli extract $asarPath $extractDir

$fixed = 0
$checked = 0
Get-ChildItem $extractDir -Recurse -File | ForEach-Object {
  if ($_.Name -eq "Directory.Build.targets") {
    Remove-Item $_.FullName -Force
    return
  }
  $rel = $_.FullName.Substring($extractDir.Length).TrimStart('\')
  $src = Join-Path $nmRoot $rel
  if (-not (Test-Path -LiteralPath $src)) { return }
  $checked++
  $a = [System.IO.File]::ReadAllBytes($_.FullName)
  $b = [System.IO.File]::ReadAllBytes($src)
  $same = ($a.Length -eq $b.Length)
  if ($same) {
    for ($i = 0; $i -lt $a.Length; $i++) {
      if ($a[$i] -ne $b[$i]) { $same = $false; break }
    }
  }
  if (-not $same) {
    [System.IO.File]::Copy($src, $_.FullName, $true)
    $fixed++
  }
}
Write-Host "[5Tick] Asar overlay checked=$checked fixed=$fixed"

$bak = "$asarPath.pre-fix.bak"
if (-not (Test-Path $bak)) { Copy-Item $asarPath $bak -Force }
Remove-Item $asarPath -Force
& $Node24 $asarCli pack $extractDir $asarPath
Write-Host ("[5Tick] Repacked asar (" + [math]::Round((Get-Item $asarPath).Length / 1MB, 1) + " MB)")

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
