# Connector MVP — spec for Codex (Stage 2, first milestone)

## Goal (small + verifiable)

Build the **Hina Connector skeleton** in `connector/`, a standalone Node.js +
TypeScript process in WSL2 that receives a text command over an authenticated
local HTTP API and returns the reply of the **existing Hina agent** via the
official OpenClaw interface. This proves the Desktop→OpenClaw integration
linchpin end-to-end.

## Constraints (must follow)

1. **Do NOT create a second agent.** Call the existing agent `hina` through the
   official OpenClaw CLI (fallback path for MVP):
   `openclaw agent --agent hina --message-file <file> --json`
   Read the reply from stdout JSON. Do NOT call OpenRouter directly. Do NOT use
   `POST /tools/invoke` (too broad).
2. **No secrets in code/git.** The Gateway token (env `OPENCLAW_GATEWAY_TOKEN`)
   and any paths come from environment at runtime only.
3. **Local API is loopback-only + bearer auth.** Listen on `127.0.0.1`; require
   `Authorization: Bearer <token>` from env `CONNECTOR_API_TOKEN`. Reject
   otherwise with 401.
4. Keep it minimal: Node built-ins + TypeScript + `tsx`/`vitest` for tests only.
   No Electron, no STT/TTS here.

## Deliverables

- `connector/src/server.ts` — HTTP server:
  - `GET /health` → `{ ok: true, agent: "hina" }` (auth optional for health).
  - `POST /command` `{ text: string }` → runs agent turn, returns
    `{ reply: string, ok: true }` or `{ ok:false, error }` on failure.
  - Auth middleware for `/command`.
- `connector/src/agentClient.ts` — wraps `openclaw agent` via child_process,
  parses `--json` stdout, returns the reply text (or a typed error).
- `connector/src/config.ts` — env loading (API token, timeouts), no secrets logged.
- `connector/package.json` — scripts: `dev`, `build`, `test`, `start`.
- `connector/test/*.test.ts` — unit test mocking the CLI result parsing; a
  contract test for the auth middleware (401 without/wrong token).
- `connector/README.md` — run instructions, env vars, manual curl checks.

## Acceptance

- `npm test` passes in `connector/`.
- Manual check documented and shown to work:
  1. Start server with token.
  2. `curl http://127.0.0.1:<port>/health` → ok.
  3. `curl -H "Authorization: Bearer <token>" -d '{"text":"Reply with exactly OK"}' /command`
     → JSON with a non-empty `reply`.
- No secret in any committed file.

## Notes for implementation

- **Verified agent-turn JSON shape** (from `openclaw agent --agent hina -m "..." --json`):
  ```json
  { "ok": true, "result": { "payloads": [ { "text": "OK", "mediaUrl": null } ], "meta": { "agentMeta": { "sessionId": "...", "sessionFile": "agent:hina:main", "provider": "openrouter", "model": "openrouter/auto" } } } }
  ```
  Parse the reply as `result.payloads[].text` joined. Tolerate a missing `result`/`payloads` (error envelope) by mapping to a typed error.
- **Attribution marker**: within the agent's own exec context, env `OPENCLAW_SHELL=exec` is set and the CLI rejects agent turns ("lost inter-session attribution"). A standalone process (systemd user unit, `nohup`, or a normal shell) does NOT carry that marker and calls `openclaw agent` normally — **verified** (returns `OK`). So the Connector runs as its own process; do not launch it through an agent exec marker. Document this in `connector/README.md`.
- Do not log the bearer token or agent stdout that could contain private data at info level.