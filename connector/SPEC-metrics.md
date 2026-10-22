# Connector — metrics + history + CORS (Stage 3, Dashboard data source)

## Goal

Give the Dashboard real data to show. The ТЗ forbids inventing metrics, so this
endpoint reports only what the Connector actually observes: request counts,
latency, and the recent command history it itself handled.

## Work (in `connector/`, reuse existing helper/auth/json)

### 1. In-memory telemetry (`src/telemetry.ts`)

Track, per process lifetime (reset on restart — honest, no persistence yet):

- `commandsTotal` — number of `/command` and `/v1/chat/completions` calls
  dispatched to the agent.
- `commandsFailed` — those that ended in an error response.
- `lastLatencyMs`, `lastLatencyAtMs` — duration of the last successful agent
  call and when.
- a bounded ring of recent commands: `{ id, ts, text (truncated), source
  ("command"|"chat"), ok, latencyMs }`, keep last 20.
- `startedAtMs` — process start epoch-ms (for uptime).

Wire these intos the `/command` and `/v1/chat/completions` success/error paths
(a single `record()` helper called from the server routes). Metrics are per
process; do not claim cross-restart persistence.

### 2. `GET /metrics` (auth required)

```json
{
  "ok": true,
  "startedAtMs": 1710000000000,
  "commandsTotal": 12,
  "commandsFailed": 1,
  "lastLatencyMs": 2341,
  "lastLatencyAtMs": 1710000123456,
  "recent": [ { "id", "ts", "text", "source", "ok", "latencyMs" } ]
}
```

No token counts, no GPU/CPU/probability numbers — those are not observed here.
The Dashboard will show only these fields.

### 3. CORS for the Dashboard origin

The Dashboard runs as a separate origin in a portal, so add permissive CORS on
the JSON responses (`access-control-allow-origin` + OPTIONS preflight 204) but
**restricted to loopback origins**: allow `http://127.0.0.1:*`, `http://localhost:*`.
Keep auth enforcement unchanged (CORS headers alone grant nothing).

### 4. Tests (`connector/test/telemetry.test.ts`)

- `telemetry.ts` unit tests: record() increments counts, caps ring at 20, sets
  latency; error path increments `commandsFailed`, not `commandsTotal`? — no:
  `commandsTotal` counts all dispatched, `commandsFailed` counts failures; test
  both.
- server route test: GET /metrics returns the schema fields; 401 without token.

### 5. README

Document `/metrics` fields and that counters are process-local (reset on
restart).

## Acceptance (verified by Hina)

- `npm test` green.
- Live: after one `/command` call, GET /metrics shows commandsTotal>=1 and a
  recent entry; CORS preflight returns 204 with the loopback allow-origin
  header.