# Hina Dashboard — MVP (Stage 3, portal UI)

## Goal

A React (Vite + TS) web app served by a thin Node proxy that exposes Hina's
Connector data as three tabs: **Overview**, **Voice**, **Agent**. It runs as a
separate origin inside OpenClaw's portal. The Connector bearer token is kept
**server-side only** — the browser never sees it.

## Security requirement (non-negotiable)

- The token (`CONNECTOR_API_TOKEN`) and Connector base URL live in the **Node
  proxy's env only**.
- The browser calls **only** `/api/*` on the same origin (the proxy). No
  cross-origin fetch to the Connector, no token in client code.
- The proxy maps `/api/*` → `{CONNECTOR_URL}/*` and adds
  `Authorization: Bearer <token>`.
- If `CONNECTOR_API_TOKEN` is unset, the proxy starts but returns `503
  {"ok":false,"error":"CONNECTOR_NOT_CONFIGURED"}` for `/api/*` instead of
  failing at boot.

## Structure (new top-level `dashboard/` in the repo)

```
dashboard/
  package.json          # react, react-dom, vite, @vitejs/plugin-react, typescript
  vite.config.ts
  tsconfig.json
  index.html
  server.mjs            # Node ESM proxy + static server (no deps beyond Node)
  src/
    main.tsx
    App.tsx             # tab shell + fetches /api/health,/api/settings,/api/metrics
    api.ts              # typed fetch helpers + types
    components/StatCard.tsx, Switch.tsx (controlled), Badge.tsx
    tabs/Overview.tsx, Voice.tsx, Agent.tsx
    styles.css          # dark, visually aligned with OpenWhispr (accent, spacing)
```

## Tabs

### Overview
Real data from `GET /api/metrics` + `GET /api/health`:
- Agent name (`health.agent`), process uptime (`startedAtMs` → human "Nn hh mm"),
  `commandsTotal`, `commandsFailed`, `lastLatencyMs`.
- Do NOT invent GPU/CPU/token counts. If a value is absent, show "—".
- Auto-refresh metrics every 5 s (clear interval on unmount).

### Voice
Wrapped around `GET /api/settings` + `PUT /api/settings` + `POST /api/settings/applied`:
- Editable voice fields: `sttModel`, `language`, `inputDevice`, `vadEnabled`,
  `ttsEnabled`, `playbackRate`.
- "Save" does an optimistic-concurrency PUT using the loaded `revision` as
  `baseRevision`; on 409 show a non-blocking "conflict — reload" hint (do not
  silently drop). On success, optionally `POST /api/settings/applied` with the
  new revision (call it; it demonstrates the saved-vs-applied split).
- Show `revision` vs `appliedRevision` as small text to make the split visible.

### Agent
- Reuse `GET /api/metrics` recent history (the ring): list `text`, `source`,
  `ok`, `latencyMs`, timestamp.
- A small "Test command" text box + button that `POST /api/command` (text) and
  shows the reply. This proves the full loop live.

## Proxy (`server.mjs`)

- Port from `PORT` (default `5210`). Host `127.0.0.1`.
- `CONNECTOR_URL` default `http://127.0.0.1:3210`.
- Serve `dist/` (built Vite output) at `/` with `index.html` fallback.
- `GET/POST/PUT/OPTIONS /api/:rest` → forward method/body to
  `${CONNECTOR_URL}/:rest`, copy request body + content-type, add bearer
  token, return status + JSON body. Handle Connector down → `502`.
- Add the same loopback CORS headers the Connector adds (harmless).

## Build & run

- `npm run build` → `dist/`.
- `node server.mjs` serves it.
- `npm run dev` (Vite) is optional for Hina's local dev; not required for
  acceptance.

## Tests

Minimal but real (`dashboard/test/proxy.test.mjs`, node:test, no framework):
- proxy config: no token → 503 `CONNECTOR_NOT_CONFIGURED` for `/api/*`.
- a fake Connector (net/http on an ephemeral port) → proxy `GET /api/health`
  returns its body and forwards the (configured) bearer header.
- proxy returns 502 when Connector is down.
These test the proxy only; React rendering is verified manually by Hina.

## Acceptance (verified by Hina)

- `npm run build` succeeds; `node server.mjs` serves `/` (200) and proxies
  `/api/health` when both Connector and Dashboard run.
- Portal open → the built app renders; Overview shows real counters; Voice PUT
  round-trips a field and revision increments; Agent test command returns the
  agent reply.
- No token in any committed file or browser bundle.