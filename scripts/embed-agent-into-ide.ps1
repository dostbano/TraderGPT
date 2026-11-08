# Bundle agent + portable Node into a 5Tick IDE app folder (resources/app/5tick-agent)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$DestApp = $args[0]
if (-not $DestApp) {
  $DestApp = Join-Path $Root "apps\ide\dist\5Tick-win32-x64"
}
$AppRes = Join-Path $DestApp "resources\app"
if (-not (Test-Path $AppRes)) { throw "App resources missing: $AppRes" }

Write-Host "[5Tick] Building agent + extension..."
Push-Location $Root
try {
  npm run build
} finally {
  Pop-Location
}

$agentOut = Join-Path $AppRes "5tick-agent"
if (Test-Path $agentOut) { Remove-Item $agentOut -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $agentOut "dist") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $agentOut "runtime") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $agentOut "node_modules\@5tick\shared") | Out-Null

# Agent dist
Copy-Item (Join-Path $Root "apps\agent\dist\*") (Join-Path $agentOut "dist") -Recurse -Force
Copy-Item (Join-Path $Root "apps\agent\package.json") $agentOut -Force

# Shared package (workspace dep)
$sharedSrc = Join-Path $Root "packages\shared"
Copy-Item (Join-Path $sharedSrc "package.json") (Join-Path $agentOut "node_modules\@5tick\shared\") -Force
New-Item -ItemType Directory -Force -Path (Join-Path $agentOut "node_modules\@5tick\shared\dist") | Out-Null
Copy-Item (Join-Path $sharedSrc "dist\*") (Join-Path $agentOut "node_modules\@5tick\shared\dist\") -Recurse -Force

# Production deps from monorepo node_modules (express/cors/zod + transitive)
$nm = Join-Path $Root "node_modules"
$need = @("express", "cors", "zod", "ms", "debug", "encodeurl", "escape-html", "etag", "finalhandler",
  "fresh", "http-errors", "merge-descriptors", "methods", "on-finished", "parseurl", "path-to-regexp",
  "proxy-addr", "qs", "range-parser", "send", "serve-static", "statuses", "type-is", "utils-merge",
  "vary", "accepts", "content-disposition", "content-type", "cookie", "cookie-signature", "depd",
  "destroy", "encodeurl", "escape-html", "etag", "body-parser", "bytes", "call-bind-apply-helpers",
  "call-bound", "es-define-property", "es-errors", "es-object-atoms", "function-bind", "get-intrinsic",
  "gopd", "has-symbols", "hasown", "iconv-lite", "inherits", "ipaddr.js", "math-intrinsics",
  "media-typer", "mime", "mime-db", "mime-types", "negotiator", "object-assign", "object-inspect",
  "raw-body", "safe-buffer", "safer-buffer", "side-channel", "side-channel-list", "side-channel-map",
  "side-channel-weakmap", "toidentifier", "unpipe", "ee-first", "setprototypeof", "array-flatten")
foreach ($pkg in ($need | Select-Object -Unique)) {
  $src = Join-Path $nm $pkg
  if (Test-Path $src) {
    $dst = Join-Path $agentOut "node_modules\$pkg"
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    robocopy $src $dst /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  }
}

# Portable Node runtime
$nodeSrc = "C:\Tools\nodejs-24\node.exe"
if (-not (Test-Path $nodeSrc)) { $nodeSrc = (Get-Command node -EA SilentlyContinue).Source }
if (-not $nodeSrc -or -not (Test-Path $nodeSrc)) { throw "node.exe not found to bundle" }
Copy-Item $nodeSrc (Join-Path $agentOut "runtime\node.exe") -Force

# Ship .env template + copy real .env if present (user machine)
$envExample = Join-Path $Root ".env.example"
if (Test-Path $envExample) { Copy-Item $envExample (Join-Path $agentOut "env.example") -Force }
$envReal = Join-Path $Root ".env"
if (Test-Path $envReal) { Copy-Item $envReal (Join-Path $agentOut ".env") -Force }

# Re-embed extension into built-in extensions folder
$extDest = Join-Path $AppRes "extensions\5tick.5tick-agent"
if (Test-Path $extDest) { Remove-Item $extDest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $extDest | Out-Null
Copy-Item (Join-Path $Root "apps\extension\package.json") $extDest -Force
Copy-Item (Join-Path $Root "apps\extension\out") (Join-Path $extDest "out") -Recurse -Force
Copy-Item (Join-Path $Root "apps\extension\media") (Join-Path $extDest "media") -Recurse -Force

# Apply brand icons into win32 resources if present
$brand = Join-Path $Root "apps\ide\branding"
$win32 = Join-Path $AppRes "resources\win32"
if ((Test-Path $win32) -and (Test-Path (Join-Path $brand "5tick.ico"))) {
  Copy-Item (Join-Path $brand "5tick.ico") (Join-Path $win32 "code.ico") -Force
  if (Test-Path (Join-Path $brand "code_70x70.png")) {
    Copy-Item (Join-Path $brand "code_70x70.png") (Join-Path $win32 "code_70x70.png") -Force
  }
  if (Test-Path (Join-Path $brand "code_150x150.png")) {
    Copy-Item (Join-Path $brand "code_150x150.png") (Join-Path $win32 "code_150x150.png") -Force
  }
}

# Also patch top-level exe icon via rcedit if available later; copy ico beside exe
if (Test-Path (Join-Path $brand "5tick.ico")) {
  Copy-Item (Join-Path $brand "5tick.ico") (Join-Path $DestApp "5tick.ico") -Force
}

Write-Host "[5Tick] Embedded agent -> $agentOut"
Write-Host "[5Tick] Embedded extension -> $extDest"
