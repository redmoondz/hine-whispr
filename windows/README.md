# Windows Development & Test Pipeline — Hina Desktop

Drives the OpenWhispr-based Hina Desktop build on the **Windows 11 host** from
**WSL2**, without touching system services or SSH config. Toolchain is portable
(user-scope, no admin/UAC).

## Verified environment (2026-10-22)

| Item | Result |
|---|---|
| Windows OS | Windows 11 Pro 64-bit, host `RANDOMFOREST`, user `siriu` |
| WSL → Windows interop | Enabled (PowerShell 5.1 via full path; Windows tools NOT auto-appended to WSL PATH) |
| Windows SSH server | `sshd` running, inbound firewall rule on, reachable at `localhost:22` from WSL (mirrored networking) |
| SSH key auth for `siriu` | **NOT set up** for this WSL key (Windows has an ed25519 `macbook-air-m2` key; WSL has RSA `ssh-key-2026-08-21`). See "Blockers". |
| Windows Node.js | None pre-installed → installed portable **Node v24.22.1** |
| Windows Git | None pre-installed → installed portable **Git (MinGit) 2.56.0** |
| MSVC / VS Build Tools | Not installed (not needed: native modules use prebuilt binaries) |
| Elevation | Not elevated (`admin=False`) → portable installs only |

## Layout

```
C:\Users\siriu\tools\                      # portable toolchain (no admin)
  node-v24.22.1-win-x64\                   # node.exe, npm.cmd
  git\                                     # cmd\git.exe
  hina-env.ps1                             # env helper (PATH + npm cache)
  .npm-cache\

C:\Users\siriu\projects\hina-desktop\
  desktop\                                 # native Windows checkout (git clone upstream)
  windows\                                 # synced copy of this repo's windows/ scripts
  *.log                                    # build/test logs
```

Repo side (WSL): `windows/` in this repository holds `hina-env.ps1`,
`hina-test.ps1`, `hina-build.ps1`, `hina-package.ps1`, `win-run.sh` (the
authoritative, version-controlled copy).

## How to run (from WSL)

```bash
cd /home/redmoon/projects/hina-desktop/windows

# Tier 1 — unit/integration tests (auto)
./win-run.sh hina-test.ps1

# Tier 2 — typecheck + renderer build (auto)
./win-run.sh hina-build.ps1

# Tier 2 — full Electron packaging (heavy)
./win-run.sh hina-package.ps1
```

Or directly, without the wrapper:

```bash
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoProfile -ExecutionPolicy Bypass \
  -File "C:/Users/siriu/projects/hina-desktop/windows/hina-test.ps1"
```

### One-time setup (already done)

```powershell
# From WSL: portable Node + Git (no admin)
curl -sL -o /mnt/c/Users/siriu/tools/node-v24.22.1-win-x64.zip \
  https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip
# Expand-Archive to C:\Users\siriu\tools\  (PowerShell)

# MinGit from https://github.com/git-for-windows/git/releases/latest
# Expand to C:\Users\siriu\tools\git\
```

## Test tiers

1. **Unit / integration (auto)** — `npm test` (`node --import tsx --test`).
   Runs under plain Node, so `better-sqlite3` must be rebuilt for the **Node
   ABI** first (`npm rebuild better-sqlite3`) because `npm ci`'s postinstall
   (`electron-builder install-app-deps`) rebuilds it for the **Electron ABI**.
2. **Windows-native (auto)** — `typecheck`, `build:renderer` (Vite), and
   `electron-builder --win` (needs Electron ABI; electron-builder rebuilds
   native modules itself). Not "passed" until actually run.
3. **GUI / audio / hotkey E2E (interactive)** — requires a logged-in
   interactive Windows session. NOT runnable via SSH or WSL-only. Do not claim
   these passed unless run in the interactive session (see Blockers).

## Verification results (real, 2026-10-22)

| Step | Result |
|---|---|
| Portable Node + Git install | ✅ node 24.22.1, npm 11.19.1, git 2.56.0 |
| Windows checkout (`git clone` upstream) | ✅ 3139 files |
| `npm ci` | ✅ 1.2 GB, Electron binary + `better-sqlite3` prebuilt (no MSVC needed) |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` (after Node-ABI rebuild) | ⚠️ ~8245+ assertions pass, ~107 fail — **environment-specific, not toolchain** |
| `npm run build:renderer` (Vite) | ✅ exit 0, `dist/` produced |
| `electron-builder --win` (full) | ✅ produces `dist/win-unpacked/OpenWhispr.exe` (223 MB) + 791 MB unpacked app; fails only at **release code-signing** |
| `electron-builder --win --dir` (unsigned local) | ✅ exit 0 after stripping `win.azureSignOptions` + `forceCodeSigning=false` |

### Code signing

`electron-builder.json` sets `win.forceCodeSigning: true` + `win.azureSignOptions`
(Azure TrustedSigning, profile `openwhispr-release`). That step requires release
credentials this machine does not have, so a local build must disable it.
`hina-package.ps1` does this automatically: it strips signing, runs
`electron-builder --win --dir` (unsigned), then restores the config. A signed
NSIS installer is release-only.

### Remaining test failures (categorised, not pipeline defects)

- **Locale-sensitive UI assertions** — app defaults to Russian on this machine;
  upstream tests hardcode English (e.g. `"Built-in fallback"` vs
  `"Встроенная резервная справка"`, `"Enable GPU"`).
- **Environment/feature-dependent** — GPU checks, Linux-only helpers (e.g.
  Hyprland hotkey startup), cloud-API simulation tests.
- These need triage in the fork; they are not caused by the Windows toolchain.

## Codex integration

Codex runs in WSL2 and drives Windows the same way this pipeline does:

1. Edit sources in the **Windows checkout** (or the WSL checkout and let
   `win-run.sh` sync) →
2. `./windows/win-run.sh hina-build.ps1` (or `.ps1 test/package`) →
3. Read the `*.log` files for compile errors →
4. Fix → re-run →
5. Read `NPM_EXIT` / `$LASTEXITCODE` for the result.

Codex should treat sandbox `listen EPERM` on loopback ports as a sandbox
limitation (re-verify server-dependent steps outside the sandbox).

## Blockers (need owner action)

1. **SSH key auth** — to drive Windows over SSH (clean interactive-capable
   session for tier-3 E2E), authorize WSL key `~/.ssh/ssh-key-2026-08-21.pub`
   for `siriu` (add to `C:\ProgramData\ssh\administrators_authorized_keys`
   if `siriu` is an Administrator, or `C:\Users\siriu\.ssh\authorized_keys`).
   This is an SSH-config change and is **not done** without explicit consent.
2. **Interactive GUI/audio/hotkey E2E** — needs a logged-in Windows session.
   Safe launch options: a Scheduled Task with "run only when user is logged on"
   (interactive token), or the owner runs the E2E command manually.
3. **Windows system services** — not installed (per constraint).