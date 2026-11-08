# Launch cloud in a detached PowerShell window (survives this script exit).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ensure = Join-Path $PSScriptRoot "ensure-cloud.ps1"

try {
  $h = Invoke-RestMethod "http://127.0.0.1:3850/health" -TimeoutSec 2
  if ($h.ok) {
    Write-Host "[5Tick] cloud already up"
    exit 0
  }
} catch {}

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $ensure
) -WorkingDirectory $Root -WindowStyle Minimized

$deadline = (Get-Date).AddSeconds(25)
do {
  Start-Sleep -Milliseconds 500
  try {
    $h = Invoke-RestMethod "http://127.0.0.1:3850/health" -TimeoutSec 2
    if ($h.ok) {
      Write-Host "[5Tick] cloud ready: $($h.publicBaseUrl)"
      exit 0
    }
  } catch {}
} while ((Get-Date) -lt $deadline)

Write-Host "[5Tick] cloud start timed out - check minimized cloud window"
exit 1
