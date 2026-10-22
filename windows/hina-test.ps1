# Unit/integration tests (tier 1) — runs under plain Node.
# Usage: powershell -ExecutionPolicy Bypass -File hina-test.ps1
param([string]$Checkout = "C:\Users\siriu\projects\hina-desktop\desktop")

. (Join-Path $PSScriptRoot "hina-env.ps1")
Set-Location $Checkout

# Plain-node tests need better-sqlite3 rebuilt for the Node ABI (npm ci's
# postinstall rebuilt it for Electron via electron-builder install-app-deps).
Write-Output "== rebuilding better-sqlite3 for Node ABI =="
npm rebuild better-sqlite3
if ($LASTEXITCODE -ne 0) { Write-Output "REBUILD_FAILED"; exit $LASTEXITCODE }

Write-Output "== npm test =="
npm test
exit $LASTEXITCODE