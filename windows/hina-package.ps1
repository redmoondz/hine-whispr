# Full Windows Electron packaging (tier 2, heavy): electron-builder --win.
# Downloads whisper.cpp/sherpa-onnx/etc. prebuilt binaries and rebuilds native
# modules for the Electron ABI. Needs CSC_IDENTITY_AUTO_DISCOVERY=false to skip
# code signing in local builds.
# Usage: powershell -ExecutionPolicy Bypass -File hina-package.ps1
param([string]$Checkout = "C:\Users\siriu\projects\hina-desktop\desktop")

. (Join-Path $PSScriptRoot "hina-env.ps1")
Set-Location $Checkout

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
Write-Output "== build:win (electron-builder) =="
npm run build:win
exit $LASTEXITCODE