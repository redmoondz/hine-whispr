# Connector — OpenAI-compatible chat/completions endpoint (Stage 2, milestone 2)

## Goal

Extend the existing Hina Connector (`connector/`) with an OpenAI-compatible
`/v1/chat/completions` endpoint so the OpenWhispr Desktop's **self-hosted
reasoning / voice-assistant** mode can route spoken commands to the existing
Hina agent with **zero behavioral fork of Desktop**. OpenWhispr already sends
this exact wire format to a self-hosted URL; this milestone makes the Connector
the self-hosted target.

## Verified upstream contract (from `desktop/src/services/ReasoningService.ts`)

- URL: `buildApiUrl(resolveSelfHostedOpenAIBase(base), "/chat/completions")`
  → base gets `ensureV1Suffix`, so the endpoint is `{base}/chat/completions`
  (typically `/v1/chat/completions`). Tolerate both `/chat/completions` and
  `/v1/chat/completions`.
- Request: `POST`, JSON `{ model, messages: [{role:"system"|"user", content}], stream: <bool>, ... }`.
  May carry `Authorization: Bearer <key>`.
- Non-streaming response (`stream` absent/false):
  `{ choices: [ { message: { role, content }, finish_reason } ], usage: {...} }`.
  OpenWhispr reads `choices[0].message.content`, strips thinking tags unless
  enabled, rejects empty content.
- Streaming response (`stream: true`), Server-Sent Events:
  - `data: {"choices":[{"delta":{"content":"..."}}]}\n\n` per chunk
  - `data: [DONE]\n\n` to end.
  OpenWhispr parses `data: ` lines, reads `choices[0].delta.content`, honors
  `[DONE]`.

## Work to do (in `connector/`, keep the existing `/command` and `/health`)

1. Add `POST /v1/chat/completions` (and alias `/chat/completions`) behind the
   same bearer auth as `/command`. Extract the final user text from `messages`
   (last `user` role content; if a `system` role exists, pass it through as a
   one-line prefix is NOT required — MVP passes only the last user message to
   the agent, but keep it simple and documented).
2. Map the call to the existing `runAgent(text, config)` (i.e. `openclaw agent
   --agent hina --message-file --json`). Do NOT call OpenRouter directly.
3. Non-streaming: return `choices[0].message.content = reply`, `finish_reason:
   "stop"`, plus a small `usage` mirror if trivially available (else omit —
   do not invent token counts).
4. Streaming: because the CLI returns a final answer (not tokens), emit the
   reply as one `delta` chunk(s) then `[DONE]`. No invented inter-token
   latency. Set `content-type: text/event-stream`.
5. Keep secrets in env only. Bearer token from `CONNECTOR_API_TOKEN` (reuse the
   existing auth helper; do not duplicate).
6. Tests (`connector/test/chatCompletions.test.ts`, vitest):
   - contract unit tests: message extraction (last user text), non-streaming
     response shape, SSE line format + `[DONE]`.
   - auth: 401 without/wrong token on the new route.
7. Update `connector/README.md`: describe that OpenWhispr Desktop should use
   self-hosted dictation-agent mode with the Connector base URL and set its API
   key to `CONNECTOR_API_TOKEN`.

## Acceptance (verified by Hina, not claimed by Codex)

- `npm test` green.
- Live: `POST /v1/chat/completions` with `stream:false` → JSON `choices[0]`
  containing the reply; `stream:true` → SSE ending in `[DONE]`.
- No secret committed.