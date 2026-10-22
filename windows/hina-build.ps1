# Windows build (tier 2): typecheck + Vite renderer build.
# Usage: powershell -ExecutionPolicy Bypass -File hina-build.ps1
param([string]$Checkout = "C:\Users\siriu\projects\hina-desktop\desktop")

. (Join-Path $PSScriptRoot "hina-env.ps1")
Set-Location $Checkout

Write-Output "== typecheck =="
npm run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Output "== build:renderer (Vite) =="
npm run build:renderer
exit $LASTEXITCODE