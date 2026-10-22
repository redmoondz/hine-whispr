# Local Windows Electron build (unsigned) — electron-builder --win --dir.
#
# OpenWhispr's electron-builder.json enables Azure TrustedSigning (release-only,
# needs the release team's credentials). For a local build we strip signing,
# package the unpacked dir, then restore the original config.
#
# Usage: powershell -ExecutionPolicy Bypass -File hina-package.ps1
param([string]$Checkout = "C:\Users\siriu\projects\hina-desktop\desktop")

. (Join-Path $PSScriptRoot "hina-env.ps1")
Set-Location $Checkout

$cfg = Join-Path (Get-Location) "electron-builder.json"
$bak = "$cfg.hina-bak"
Copy-Item $cfg $bak -Force

node -e "const fs=require('fs');const p='electron-builder.json';const d=JSON.parse(fs.readFileSync(p,'utf8'));d.win.forceCodeSigning=false;delete d.win.azureSignOptions;fs.writeFileSync(p,JSON.stringify(d,null,2));"

$code = 1
try {
  npx electron-builder --win --dir
  $code = $LASTEXITCODE
} finally {
  Move-Item $bak $cfg -Force
}

Write-Output "PACKAGE_EXIT=$code"
exit $code