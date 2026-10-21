# Connector — settings contract (Stage 3, foundation)

## Goal

Add a versioned settings contract to the Connector so Hina Desktop and the
Dashboard share **one** configuration source with conflict handling and a
clear "saved vs actually-applied" distinction. This is the single source of
truth the ТЗ requires for two-way sync.

## Contract (REST, loopback, bearer auth — reuse existing helper)

### `GET /settings`

Response:

```json
{
  "schemaVersion": 1,
  "revision": 3,
  "settings": { "...": "current saved settings object ..." },
  "appliedRevision": 2,
  "appliedSettings": { "...": "last actually-applied settings object ..." }
}
```

- `revision` = monotonic integer, +1 per committed `PUT`.
- `appliedRevision`/`appliedSettings` = what a real device last acked (see PUT
  below). Starts equal to `revision`/`settings` at process start (baseline).

### `PUT /settings`

Request: `{ baseRevision: number, settings: object }`.

Rules (implement precisely, with tests):

1. Auth required (bearer). 401 otherwise.
2. Body must be JSON object with numeric `baseRevision` and object `settings`.
   400 otherwise.
3. If `baseRevision !== current revision` → `409` with body
   `{ ok:false, error:"CONFLICT", revision: <current>, settings: <current> }`.
   (Optimistic concurrency: caller must retry against the returned revision.)
4. On match: validate `settings` against the schema (below); reject unknown
   top-level groups or wrong types with `400 { ok:false, error:"VALIDATION",
   details }`. Do not silently drop fields.
5. Commit: increment `revision`, store `settings`. Do NOT auto-advance
   `appliedRevision` — applying is a **separate** ack. Return
   `200 { revision, settings }`.

### `POST /settings/applied`

Request: `{ revision: number }` — a device reports it actually applied a
specific revision.

Rules: only sets `appliedRevision`/`appliedSettings` to the revision's stored
snapshot if that revision exists and is <= current. Returns
`{ appliedRevision, appliedSettings }`. Invalid/unknown revision → `400
INVALID`. This keeps "saved" vs "applied" honest.

### Extended settings keys (document, validate types; only these groups)

```json
{
  "voice": {
    "sttModel": "string",
    "language": "string",
    "inputDevice": "string",
    "vadEnabled": "boolean",
    "ttsEnabled": "boolean",
    "playbackRate": "number"
  },
  "agent": {
    "model": "string",
    "confirmActions": "boolean"
  },
  "hands": {
    "browserControl": "boolean",
    "confirmMode": "boolean"
  }
}
```

All leaf fields optional on PUT (partial update merges into defaults), but
types are enforced. Unknown top-level groups are rejected.

## Implementation notes

- In-memory store is enough for MVP (no sqlite yet), but keep `settings` access
  behind a tiny module (`src/settingsStore.ts`) so it can swap to persistence
  later without touching the route.
- Defaults: a `DEFAULT_SETTINGS` constant in `settingsStore.ts`.
- No secrets in settings or logs.
- Routes live in the existing server module or an exported helper, reusing the
  existing `authorized()` and `json()` helpers.

## Tests (`connector/test/settings.test.ts`)

- GET returns schemaVersion 1 and baseline revision 1.
- PUT with wrong `baseRevision` → 409 + current revision (conflict).
- PUT valid → revision increments; GET reflects it.
- PUT unknown group → 400 VALIDATION.
- POST /settings/applied with unknown revision → 400; with valid → applied
  snapshot advanced, `appliedRevision` updates, `revision` unchanged.
- Auth: GET/PUT/POST without token → 401.

## Acceptance (verified by Hina)

- `npm test` green (existing 56 + new settings tests).
- Live: curl GET/PUT/applied cycle matches the contract above.