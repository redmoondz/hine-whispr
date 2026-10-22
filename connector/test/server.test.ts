import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestConnectorServer as createConnectorServer } from './testServer.ts';
import { loadConfig } from '../src/config.ts';

const servers: ReturnType<typeof createConnectorServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});

async function setup() {
  const agent = vi.fn(async (_text: string) => 'OK');
  const server = createConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw' }, agent);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, agent };
}

it('exposes health without authentication', async () => {
  const { url, agent } = await setup();
  expect(await (await fetch(`${url}/health`)).json()).toEqual({ ok: true, agent: 'hina' });
  expect(agent).not.toHaveBeenCalled();
});

it.each([undefined, 'Bearer wrong', 'Basic test-token', 'Bearer test-token-extra'])('rejects unauthorized commands: %s', async authorization => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: authorization ? { authorization } : {}, body: '{"text":"hello"}' });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' });
  expect(agent).not.toHaveBeenCalled();
});

it('returns a reply for an authenticated command', async () => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{"text":"hello"}' });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, reply: 'OK' });
  expect(agent).toHaveBeenCalledWith('hello');
});

it('forwards a validated desktop timeout to the agent', async () => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ text: 'Long command', timeoutSeconds: 900 }) });
  expect(response.status).toBe(200);
  expect(agent).toHaveBeenCalledWith('Long command', 900000);
});

it.each([0, -1, 1.5, 3601, '300', null])('rejects an invalid per-request timeout: %s', async timeoutSeconds => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ text: 'Long command', timeoutSeconds }) });
  expect(response.status).toBe(400);
  expect(agent).not.toHaveBeenCalled();
});

it.each(['bad', 'null', '[]', '{}', '{"text":1}', '{"text":" "}'])('rejects invalid input: %s', async body => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body });
  expect(response.status).toBe(400);
  expect(agent).not.toHaveBeenCalled();
});

it('bounds request size', async () => {
  const { url, agent } = await setup();
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ text: 'x'.repeat(65536) }) });
  expect(response.status).toBe(413);
  expect(agent).not.toHaveBeenCalled();
});

it('does not expose unexpected errors', async () => {
  const { url, agent } = await setup();
  agent.mockRejectedValue(new Error('private token or stdout'));
  const response = await fetch(`${url}/command`, { method: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{"text":"hello"}' });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ ok: false, error: 'Agent request failed' });
});

it('loads and validates runtime configuration', () => {
  expect(() => loadConfig({})).toThrow('CONNECTOR_API_TOKEN');
  expect(() => loadConfig({ CONNECTOR_API_TOKEN: ' ' })).toThrow();
  for (const [key, value] of [['CONNECTOR_PORT', '0'], ['CONNECTOR_PORT', '65536'], ['CONNECTOR_TIMEOUT_MS', '-1'], ['CONNECTOR_TIMEOUT_MS', 'NaN']]) {
    expect(() => loadConfig({ CONNECTOR_API_TOKEN: 'test', [key!]: value })).toThrow();
  }
  expect(loadConfig({ CONNECTOR_API_TOKEN: 'test' })).toEqual({ apiToken: 'test', port: 3210, timeoutMs: 300000, executable: 'openclaw', dataDir: fileURLToPath(new URL('../data', import.meta.url)) });
});
