# Connector — Analytics (Stage 5, real metrics only)

## Goal

Add **persistent, honest** analytics to the Connector. `/metrics` stays
process-local (resets on restart — documented). `/analytics` accumulates in
SQLite and survives restarts. Only metrics the Connector actually observes; no
invented GPU/CPU/token numbers.

## Data + storage

- Use Node's built-in `node:sqlite` (`DatabaseSync`) — **no native npm dep**.
  Verified available on Node v24.22.0.
- DB file: `${CONNECTOR_DATA_DIR}/analytics.db` where `CONNECTOR_DATA_DIR`
  defaults to `<connector-dir>/data`. Create the dir on startup.
- Schema (single table is enough):

```sql
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,        -- epoch ms
  day TEXT NOT NULL,          -- 'YYYY-MM-DD' (UTC) for cheap aggregation
  source TEXT NOT NULL,       -- 'command' | 'chat'
  ok INTEGER NOT NULL,        -- 0/1
  latency_ms REAL NOT NULL
);
```

## Recording

- `src/analyticsStore.ts`: an `AnalyticsStore` class wrapping DatabaseSync with
  methods `record({ts,source,ok,latencyMs})`, `requestsByDay(sinceDay?, untilDay?)`,
  `latencyStats()`, `total()`, `failed()`, `close()`.
- Wire the same `record()` call site used by `/metrics` so both `/command` and
  `/v1/chat/completions` success/error paths insert a row. Reuse the existing
  telemetry module's recording call — do NOT double-record into telemetry; the
  two stores can be fed from one wrapper (`recordCall`).

## `GET /analytics` (auth required)

```json
{
  "ok": true,
  "schemaVersion": 1,
  "commandsTotal": 12,
  "commandsFailed": 1,
  "uptimeSeconds": 8443,
  "latency": { "avgMs": 2311.2, "p50Ms": 2200, "p90Ms": 4100, "maxMs": 6100 },
  "requestsByDay": [ { "day": "2026-10-22", "total": 12, "failed": 1 } ]
}
```

- `commandsTotal`/`commandsFailed` = cumulative from SQLite.
- `uptimeSeconds` = `(now - startedAtMs)/1000`, floor.
- `latency` = computed from all rows (mean, p50, p90 as discrete percentiles —
  if <2 rows, return null values).
- `requestsByDay` = last 30 days, `total` + `failed` per UTC day, sorted asc.
- No token counts (OpenRouter tokens not reliably available → omit, document
  why in README).

## Tests (`connector/test/analytics.test.ts`)

- `analyticsStore.ts` unit tests (in-memory DB): record + total/failed;
  requestsByDay groups correctly across day boundary; latency percentiles with
  a known sample; persistence across reopen (write to a temp file DB, reopen,
  counts retained).
- server route test: GET /analytics returns schema fields; 401 without token.

## README + .gitignore

- Document `/analytics` vs `/metrics` (persistent vs process-local), the data
  dir, and that token/GPU/CPU metrics are intentionally absent.
- Add `data/` and `*.db` to `connector/.gitignore`.

## Acceptance (verified by Hina)

- `npm test` green.
- Live: no DB file before first request; after one `/command`, `/analytics`
  shows `commandsTotal>=1` and one `requestsByDay` row; restart the Connector
  and confirm the count persists (file-based DB survives).
- No secret in DB path or logs.