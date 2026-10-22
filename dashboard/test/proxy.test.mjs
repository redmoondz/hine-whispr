import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDashboardServer } from '../server.mjs';

// Intentionally fail on EPERM: a sandbox binding restriction is not a passing test.
async function listen(t, server) {
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const testToken = () => `test-${crypto.randomUUID()}`;

test('missing token returns configured 503 for every API method', async t => {
  const url = await listen(t, createDashboardServer({ token: '' }));
  for (const method of ['GET', 'POST', 'PUT', 'OPTIONS']) {
    const response = await fetch(`${url}/api/health`, { method });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'CONNECTOR_NOT_CONFIGURED' });
  }
});

test('forwards health with server bearer and preserves status/body', async t => {
  const token = testToken();
  const connectorUrl = await listen(t, createServer((request, response) => {
    assert.equal(request.url, '/health?check=1');
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, agent: 'hina' }));
  }));
  const url = await listen(t, createDashboardServer({ token, connectorUrl }));
  const response = await fetch(`${url}/api/health?check=1`, {
    headers: { authorization: 'Bearer browser-value', origin: 'http://localhost:5173' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.deepEqual(await response.json(), { ok: true, agent: 'hina' });
});

test('forwards POST, PUT and OPTIONS including body/content-type and conflict', async t => {
  const token = testToken();
  const connectorUrl = await listen(t, createServer(async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    assert.equal(request.headers['content-type'], 'application/json');
    response.writeHead(request.method === 'PUT' ? 409 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ method: request.method, path: request.url, body: JSON.parse(Buffer.concat(chunks)) }));
  }));
  const url = await listen(t, createDashboardServer({ token, connectorUrl }));
  for (const [method, path, body] of [
    ['PUT', '/settings', { baseRevision: 1, settings: { voice: { language: 'fr' } } }],
    ['POST', '/command', { text: 'Hello' }],
    ['POST', '/settings/applied', { revision: 2 }],
  ]) {
    const response = await fetch(`${url}/api${path}`, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, method === 'PUT' ? 409 : 200);
    assert.deepEqual(await response.json(), { method, path, body });
  }
  const preflight = await fetch(`${url}/api/settings`, { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:5210' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, PUT, OPTIONS');
});

test('unavailable Connector returns 502 without exposing configuration', async t => {
  const unavailable = createServer();
  const connectorUrl = await listen(t, unavailable);
  await new Promise(resolve => unavailable.close(resolve));
  const url = await listen(t, createDashboardServer({ token: testToken(), connectorUrl }));
  const response = await fetch(`${url}/api/health`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'CONNECTOR_UNAVAILABLE' });
});

test('serves built assets and SPA fallback without exposing source files', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'hina-dist-'));
  t.after(() => rm(distDir, { recursive: true, force: true }));
  await writeFile(join(distDir, 'index.html'), '<main>Hina</main>');
  await writeFile(join(distDir, 'app.js'), 'console.info("Hina");');
  const url = await listen(t, createDashboardServer({ token: '', distDir }));
  for (const path of ['/', '/voice', '/server.mjs']) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<main>Hina</main>');
  }
  const asset = await fetch(`${url}/app.js`);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'console.info("Hina");');
  const invalidOrigin = await fetch(`${url}/api/health`, { headers: { origin: 'https://example.com' } });
  assert.equal(invalidOrigin.headers.get('access-control-allow-origin'), null);
});
