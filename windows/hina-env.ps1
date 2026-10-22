# Hina Windows pipeline environment (portable node + git, no admin install).
# Dot-source:  . .\hina-env.ps1   (then call node/npm/git)
param([string]$ToolsRoot = "C:\Users\siriu\tools")

$Node = Join-Path $ToolsRoot "node-v24.22.1-win-x64"
$Git  = Join-Path $ToolsRoot "git"

# IMPORTANT: do NOT set $ErrorActionPreference = "Stop" here. npm/node write
# warnings to stderr, which PowerShell 5.1 surfaces as NativeCommandError and
# aborts the caller. Check $LASTEXITCODE after each native call instead.

$env:PATH = "$Node;$Git\cmd;$Git\bin;$env:PATH"
$env:npm_config_cache = Join-Path $ToolsRoot ".npm-cache"

Write-Output "Hina env ready: node=$(node --version) npm=$(npm --version) git=$(git --version)"