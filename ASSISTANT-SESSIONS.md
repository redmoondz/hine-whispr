# Assistant session lifecycle

## Goal
Show OpenClaw execution in a reusable assistant chat without interrupting background work.

## Business rules
1. Voice submission opens the current conversation immediately.
2. Minimize preserves the session and background execution; clicking the overlay restores it.
3. Hotkey followed by a click opens text input in the current session.
4. Close archives the current session without cancelling work. The next invocation creates a new session.
5. History exposes running and completed sessions and their results.
6. Background events never reopen a minimized or closed conversation automatically.
7. Follow-up messages retain the same OpenClaw session identity.
8. Progress must reflect actual execution events, not simulated tool activity.

## Acceptance cases
| Case | Action | Expected result |
| --- | --- | --- |
| Voice | Submit speech | Current chat opens while work runs |
| Minimize | Minimize running chat | Overlay shown; work continues |
| Restore | Click overlay | Same conversation and messages |
| Text | Hotkey then click | Composer in current conversation |
| Follow-up | Submit another message | Same OpenClaw session; ordered execution |
| Close | Close running conversation | Work continues in history |
| New | Invoke after close | New session identity |
| Background finish | Finish hidden task | Result saved without reopening |
| History | Select old session | Its messages, status and result appear |

## Out of scope
Rolling back external actions or cancelling tasks when their window closes.

## Implementation and verification

Connector owns persisted background tasks, idempotent submissions, per-session
queues and a four-conversation concurrency limit. Follow-ups use a stable
OpenClaw session key. Public progress comes from the official Gateway history
API; unavailable history is explicitly reported. No synthetic tool steps are
shown. Restarted Connector jobs become unknown and are never replayed implicitly.

The local Desktop assistant has a full conversation view, History, Minimize,
Close and New conversation controls. Hidden task completion does not reopen the
window. A click on the text composer stops microphone capture without cancelling
OpenClaw work. Ordinary dictation is preserved.

Verified: Connector build and 230 tests; Desktop lint, types, renderer build and
full test suite (8690 passed, zero failures, 37 skips and one existing TODO).
Chromium component screenshots and interaction checks cover 600x700 and 360x640,
light and dark themes. The live Gateway accepted a read-only history request;
no inference was launched. See `desktop/docs/HINA-ASSISTANT-SESSIONS.md` and
`desktop/evidence/assistant-sessions/` in the separate Desktop repository.

Initial implementation verification did not deploy either component. The
subsequently authorized v0.5.0 release updated Connector only after verifying
that its complete service cgroup contained no other processes. Its authenticated
session API returned HTTP 200. The stable Windows release is published at
https://github.com/redmoondz/hina-desktop/releases/tag/v0.5.0 and available in
the public updater feed. Source tag: `51db2615bb9f810320efc7f06e8f73c486111af1`.
The user updates the installed Desktop through the tray. Interactive Windows
hotkey/microphone E2E remains user-side. Existing agent deadlines still apply.
