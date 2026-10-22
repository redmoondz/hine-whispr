# Connector — Hands coordination contract (Stage 4, backend)

## Goal

The Hands feature's **execution** (driving a real browser / approved apps) is
Windows-host gated and will be driven by the Desktop fork later. But the
**mandatory approval gate + operation journal + allowlist** are backend
concerns that live in the Connector and are fully buildable/verifiable from
WSL2. This milestone builds that coordination contract so the Windows side has
a fixed, tested surface to integrate against.

## Security invariant (non-negotiable)

External actions are **never auto-executed silently**. The default is
`pending` until explicitly approved. The only auto-approve path is:
`confirmMode === false` AND the target is explicitly allowlisted.

## Gating logic (uses existing `settings.hands`)

`settings.hands` already has `browserControl: boolean` and `confirmMode:
boolean` (both default `true`). On `POST /hands/operations`:

1. If `type === "browser"` and `hands.browserControl === false` →
   `status: "auto-denied"`, `reason: "browser_control_disabled"`.
2. Else if `hands.confirmMode === true` → `status: "pending"` (always;
   explicit approval required — the mandatory default).
3. Else (`confirmMode === false`) and `target` is in the allowlist →
   `status: "auto-approved"`.
4. Else → `status: "pending"`.

## Allowlist

Separate resource, process-local for MVP (documented like `/metrics`) —
`src/handsStore.ts` holds it plus the journal.

- `GET /hands/allowlist` → `{ ok: true, targets: ["chrome", "docs.google.com"] }`.
- `PUT /hands/allowlist` body `{ targets: string[] }` → replace list (trim,
  dedupe, non-empty strings). Returns `{ targets }`. Bad body → 400.

## Operations + journal

Each operation: `{ id, type, target, action, params?, status, reason?,
createdAtMs, resolvedAtMs?, approver? }`.

- `POST /hands/operations` body `{ type, target, action, params? }`
  (`type` ∈ "browser" | "app" | "shell"; `action`/`target` non-empty strings;
  `params` optional object). Returns `{ ok: true, operation }`.
- `GET /hands/operations?status=pending|approved|denied|auto-approved|auto-denied`
  → `{ ok: true, operations: [...] }` filtered, newest first.
- `GET /hands/operations/:id` → one operation or 404.
- `POST /hands/operations/:id/approve` → only if `pending`; sets
  `status:"approved"`, `resolvedAtMs`, `approver:"connector"`. Non-pending →
  `409 { ok:false, error:"NOT_PENDING" }`.
- `POST /hands/operations/:id/deny` → same shape, sets `status:"denied"`.
- Journal ring: keep last 50 operations in memory (documented process-local).

## Implementation notes

- `src/handsStore.ts`: `createOperation()`, `list(status?)`, `get(id)`,
  `approve(id)`, `deny(id)`, allowlist get/set. No DB (in-memory, MVP).
- Reuse existing `authorized()` and `json()` helpers; all routes auth-required.
- No secrets, no invented state.

## Tests (`connector/test/hands.test.ts`)

- unit (`handsStore.ts`): default gating (confirmMode true → pending);
  browserControl false + type browser → auto-denied; confirmMode false +
  allowlisted target → auto-approved; approve/deny transition from pending
  only (non-pending → NOT_PENDING error); journal caps at 50; allowlist
  replace/dedupe.
- route: POST + GET + approve/deny happy path; 401 without token; 404 unknown
  id; invalid body → 400.

## Acceptance (verified by Hina)

- `npm test` green.
- Live curl: with `confirmMode:true` (default) a `POST /hands/operations` →
  `pending`; `approve` → `approved`; a browser op with `browserControl:false`
  → `auto-denied`; allowlist PUT changes auto-approve behavior.