# Hina Dashboard

The Stage 3 portal UI: Overview, Voice, and Agent. Requires Node.js 22.12 or newer.

## Build and run

```sh
cd dashboard
npm install
npm run build
# Set CONNECTOR_API_TOKEN in the server environment using your secret manager.
# Optional: CONNECTOR_URL (default http://127.0.0.1:3210), PORT (default 5210).
npm start
```

Open `http://127.0.0.1:5210`. The server binds to loopback only and serves `dist/`.
It starts without configuration; API requests then receive HTTP 503 with
`CONNECTOR_NOT_CONFIGURED`.

For optional development, run the Node proxy and `npm run dev` separately. Vite
forwards browser `/api/*` requests to the local Node proxy. Build before using
`npm start` to serve the production UI.

## Security

`CONNECTOR_API_TOKEN` and `CONNECTOR_URL` belong exclusively to the Node server
environment. Never prefix them with `VITE_`, write them into frontend configuration,
or put credentials in URLs. The browser uses relative, same-origin `/api/*`
requests. Only the proxy adds the bearer header. It does not follow Connector
redirects, and it returns a generic 502 if the Connector is unavailable.

Voice saves include the full loaded settings object, use `baseRevision`, and then
acknowledge the saved revision through `/api/settings/applied`. A conflict keeps
the draft and offers an explicit reload. Reload replaces the draft with saved
settings. An apply failure leaves the saved and applied revisions distinct.

## Verification

```sh
npm run build
npm test
```

`test/proxy.test.mjs` uses Node's test runner and real HTTP servers on ephemeral
loopback ports. It covers missing configuration, bearer injection, method/body
forwarding, conflicts, preflight CORS, an unavailable Connector, static assets,
and SPA fallback. Socket binding restrictions such as `listen EPERM` are failures,
not skipped or passing tests. Run these tests in an environment that permits
loopback listeners.

UI acceptance requires a live Connector: verify counters, a Voice revision
round-trip, and an Agent reply. Check desktop and mobile layouts in a browser.
