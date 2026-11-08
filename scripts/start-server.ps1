# Install/build if needed, then start agent + cloud.
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "bootstrap-server.ps1") -Start
