# Mirror MSVC libs into lib\spectre\* so Spectre-enabled node-gyp projects can link
# when official Spectre-mitigated packages are incomplete.
$ErrorActionPreference = "Stop"
$msvcRoot = Get-ChildItem "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC" -Directory |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $msvcRoot) { throw "MSVC toolset not found" }
$lib = Join-Path $msvcRoot.FullName "lib"
foreach ($arch in @("x64", "x86", "arm64")) {
  $src = Join-Path $lib $arch
  if (-not (Test-Path $src)) { continue }
  $dst = Join-Path $lib "spectre\$arch"
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item "$src\*" $dst -Force
  Write-Host "[5Tick] mirrored $arch -> $dst"
}
