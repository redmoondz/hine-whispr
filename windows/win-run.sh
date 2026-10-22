#!/usr/bin/env bash
# WSL -> Windows pipeline wrapper (Codex-friendly).
# Copies the pipeline .ps1 scripts onto the Windows filesystem (avoids
# \\wsl.localhost UNC issues) then invokes the chosen script via interop.
#
# Usage:  ./win-run.sh hina-build.ps1
#         ./win-run.sh hina-test.ps1
#         ./win-run.sh hina-package.ps1
set -euo pipefail

SCRIPT="${1:?usage: win-run.sh <hina-build.ps1|hina-test.ps1|hina-package.ps1>}"

PS_BIN="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
WIN_DIR_MNT="/mnt/c/Users/siriu/projects/hina-desktop/windows"
WIN_DIR_PL="C:/Users/siriu/projects/hina-desktop/windows"

# Source dir of this wrapper (the repo's windows/ dir).
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$WIN_DIR_MNT"
for f in hina-env.ps1 hina-test.ps1 hina-build.ps1 hina-package.ps1; do
  cp -f "$REPO_DIR/$f" "$WIN_DIR_MNT/$f"
done

"$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "$WIN_DIR_PL/$SCRIPT"