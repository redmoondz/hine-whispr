# Hina Connector

A standalone Node.js process connecting a loopback HTTP API to the existing
OpenClaw agent `hina`. Runtime uses Node built-ins only. TypeScript and Vitest
are development dependencies. Use Node 22.18+ or Node 24+.

## Install and run

```bash
cd connector
npm install
npm test
npm run build
# Set CONNECTOR_API_TOKEN securely in this shell or a private environment file.
# OPENCLAW_GATEWAY_TOKEN is inherited when your Gateway requires it.
npm start
```

Run from a normal standalone shell, a systemd user service, or `nohup`.
OpenClaw sets `OPENCLAW_SHELL=exec` inside an agent's execution context; agent
turns launched from that context fail with "lost inter-session attribution".
Connector refuses startup with that marker. To intentionally launch a standalone
background process from that context, with credentials already in the environment:

```bash
umask 077
nohup env -u OPENCLAW_SHELL node dist/server.js > connector.log 2>&1 &
```

The standalone process invokes exactly:

```text
openclaw agent --agent hina --message-file <private temporary file> --json
```

It creates no agent and uses neither OpenRouter directly nor `/tools/invoke`.
Input is written as UTF-8 to a mode-0600 file in a private temporary directory,
then deleted after completion or failure. Environment, including Gateway
credentials, is inherited at runtime. There is no shell interpolation of input.
Do not commit environment files, credentials, or private CLI output.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONNECTOR_API_TOKEN` | Required | Nonempty bearer token without whitespace |
| `CONNECTOR_PORT` | `3210` | Integer port, 1–65535 |
| `CONNECTOR_TIMEOUT_MS` | `120000` | CLI timeout in milliseconds, 1–2147483647 |
| `OPENCLAW_BIN` | `openclaw` on `PATH` | Optional executable path |
| `OPENCLAW_GATEWAY_TOKEN` | Inherited if set | Gateway credential used by OpenClaw |
| `TMPDIR` | OS default | Optional base directory for private message files |

Connector always binds `127.0.0.1`, following `SPEC.md`; older architecture notes
mentioning `0.0.0.0` do not apply to this milestone. It never logs tokens, commands,
CLI stdout, or stderr. `npm run dev` uses Node's built-in TypeScript stripping;
`npm run build` compiles to `dist/`; `npm start` runs the compiled server.

## Manual acceptance checks

In a second normal shell with the same `CONNECTOR_API_TOKEN` set:

```bash
curl --fail-with-body "http://127.0.0.1:${CONNECTOR_PORT:-3210}/health"
# {"ok":true,"agent":"hina"}

curl -i -X POST "http://127.0.0.1:${CONNECTOR_PORT:-3210}/command" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Reply with exactly OK"}'
# HTTP 401; {"ok":false,"error":"Unauthorized"}

curl --fail-with-body "http://127.0.0.1:${CONNECTOR_PORT:-3210}/command" \
  -H "Authorization: Bearer ${CONNECTOR_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Reply with exactly OK"}'
# Expected: {"reply":"OK","ok":true}; reply must be nonempty.
```

`/health` requires no authentication. Every `/command` request requires the exact
bearer token. Commands accept a nonempty `text` string and at most 64 KiB of JSON.
Text payloads from `result.payloads` are joined with newlines. Invalid input returns
400, oversized bodies 413, CLI failures/invalid replies 502, and CLI timeouts 504.
All failures use `{ "ok": false, "error": "..." }`.

A manual command invokes the configured agent and may incur provider charges.

## OpenWhispr Desktop chat completions

For self-hosted dictation-agent / reasoning / voice-assistant mode in OpenWhispr
Desktop, use `http://127.0.0.1:3210` as the Connector base URL (adjust the port
if configured). Desktop adds `/v1` automatically; a base URL ending in `/v1`
also works. Set Desktop's API key to the value of `CONNECTOR_API_TOKEN`.

`POST /v1/chat/completions` and its alias `POST /chat/completions` use the same
bearer authentication, 64 KiB body limit, and error responses as `/command`.
Send JSON with `messages` containing a nonempty string in the final `user`
message. Only that message is forwarded to the existing Hina agent; system
messages, earlier conversation history, `model`, and sampling options are ignored.
A missing, empty, or non-string final user message returns 400.

With `stream` absent or `false`, the response is:

```json
{"choices":[{"message":{"role":"assistant","content":"OK"},"finish_reason":"stop"}]}
```

Token usage is omitted because the existing CLI wrapper returns only reply text.
With `stream: true`, the response has `Content-Type: text/event-stream` and sends
the CLI's final reply as one content delta followed immediately by `[DONE]`:

```text
data: {"choices":[{"delta":{"content":"OK"}}]}

data: [DONE]

```

Streaming waits for the final agent reply; it adds no artificial token delays.
Agent failures return the existing JSON error before any SSE headers are sent.
To check both modes manually, run this request with `stream` set to `false`, then
repeat with `true`:

```bash
curl --fail-with-body --no-buffer \
  "http://127.0.0.1:${CONNECTOR_PORT:-3210}/v1/chat/completions" \
  -H "Authorization: Bearer ${CONNECTOR_API_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Reply with exactly OK"}],"stream":false}'
```

## Metrics, command history, and Dashboard CORS

`GET /metrics` requires the same bearer token as `/command` and returns JSON
with `Cache-Control: no-store`:

| Field | Meaning |
| --- | --- |
| `ok` | `true` |
| `startedAtMs` | Process start time in epoch milliseconds |
| `commandsTotal` | Completed agent calls, including failures, from `/command` and both chat routes |
| `commandsFailed` | Agent calls that ended in an error response |
| `lastLatencyMs` | Duration of the last successful agent call, or `null` before any success |
| `lastLatencyAtMs` | Completion time of that success in epoch milliseconds, or `null` |
| `recent` | Last 20 completed calls, oldest first |

Each recent entry contains a unique `id`, completion epoch-ms `ts`, command
`text` truncated to 200 UTF-16 code units, `source` (`command` or `chat`), boolean
`ok`, and `latencyMs`. Durations use a monotonic clock. Authentication failures,
invalid input, and other requests that never reach the agent are excluded.
Failures do not overwrite the last successful latency. In-flight calls appear
when they finish. Counters and history live only in memory and reset on restart;
there is no cross-restart persistence or inferred token, CPU, or GPU data.

JSON responses, including errors, allow browser access only from HTTP origins
on `127.0.0.1` or `localhost`, with any valid port (or the default HTTP port).
The server echoes the allowed origin and sends `Vary: Origin`. OPTIONS preflight
returns an empty 204 without requiring authentication, allowing `GET`, `POST`,
`PUT`, and `OPTIONS` with `Authorization` and `Content-Type` headers. Actual
requests still require their existing authentication. Other origins receive no
allow-origin header. The same origin policy also applies to chat SSE responses.

```bash
curl --fail-with-body "http://127.0.0.1:${CONNECTOR_PORT:-3210}/metrics" \
  -H "Authorization: Bearer ${CONNECTOR_API_TOKEN}"

curl -i -X OPTIONS "http://127.0.0.1:${CONNECTOR_PORT:-3210}/command" \
  -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

After an authenticated command completes, metrics should show an incremented
`commandsTotal` and a recent entry. The preflight should return 204 and
`Access-Control-Allow-Origin: http://localhost:5173`.

## Verification in the implementation environment

- `npm run build` passes with the locally installed TypeScript compiler.
- Vitest is available. All 110 tests in the telemetry/CORS, chat-completions,
  settings, and agent-client suites pass with
  `npm test -- test/telemetry.test.ts test/chatCompletions.test.ts test/settings.test.ts test/agentClient.test.ts`.
- Full `npm test` cannot pass in this sandbox: the existing server integration
  tests require loopback listeners and fail with `listen EPERM`. These tests
  still need to run in an environment that allows socket binding.
- Manual HTTP/Gateway verification remains pending: binding a loopback socket
  fails with `EPERM` in the execution sandbox. The curl responses above are
  expected results, not a claim of a completed live agent turn.
- A detached standalone invocation of the exact OpenClaw command was attempted
  without the exec marker. It exited with status 1 and returned no valid reply.

Run `npm test`, `npm run build`, then the curl checks in an
unrestricted standalone WSL2 shell to complete acceptance verification.
