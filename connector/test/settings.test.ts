import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { createTestConnectorServer as createConnectorServer } from './testServer.ts';
import { DEFAULT_SETTINGS } from '../src/settingsStore.ts';

// Exercise the actual listener without requiring sandbox socket permissions.
function setup() {
  const agent = vi.fn(async (_text: string) => 'OK');
  const server = createConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw' }, agent);
  function request(path = '/settings', method = 'GET', body?: unknown, authenticated = true): Promise<Response> {
    return new Promise(resolve => {
      const incoming = new IncomingMessage(new Socket());
      incoming.url = path;
      incoming.method = method;
      incoming.headers = authenticated ? { authorization: 'Bearer test-token' } : {};
      if (body !== undefined) incoming.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      incoming.push(null);
      const headers = new Headers();
      let status = 200;
      server.emit('request', incoming, {
        setHeader(name: string, value: string) { headers.set(name, value); },
        writeHead(code: number, values: Record<string, string>) {
          status = code;
          for (const [name, value] of Object.entries(values)) headers.set(name, value);
        },
        end(value: string) { resolve(new Response(value, { status, headers })); },
      });
    });
  }
  return { request, agent };
}

it('starts at schema 1, revision 1 with an applied baseline and independent stores', async () => {
  const { request, agent } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const baseline = await response.json();
  expect(baseline).toEqual({ schemaVersion: 1, revision: 1, settings: expect.any(Object), appliedRevision: 1, appliedSettings: baseline.settings });
  expect(baseline.settings).toEqual(DEFAULT_SETTINGS);
  expect(Object.keys(baseline.settings).sort()).toEqual(['agent', 'hands', 'voice']);
  await request('/settings', 'PUT', { baseRevision: 1, settings: { voice: { language: 'fr' } } });
  expect(await (await setup().request()).json()).toEqual(baseline);
  expect(agent).not.toHaveBeenCalled();
});

it('commits all supported fields without advancing the applied snapshot', async () => {
  const { request } = setup();
  const baseline = await (await request()).json();
  const settings = {
    voice: { sttModel: 'small', language: 'en', inputDevice: 'mic', vadEnabled: true, ttsEnabled: true, playbackRate: 1.25 },
    agent: { model: 'local', confirmActions: false },
    hands: { browserControl: true, confirmMode: false },
  };
  const response = await request('/settings', 'PUT', { baseRevision: 1, settings });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ revision: 2, settings });
  expect(await (await request()).json()).toEqual({ ...baseline, revision: 2, settings });
});

it('merges each partial PUT into defaults rather than the previous saved settings', async () => {
  const { request } = setup();
  const { settings: defaults } = await (await request()).json();
  await request('/settings', 'PUT', { baseRevision: 1, settings: { agent: { model: 'custom' } } });
  const response = await request('/settings', 'PUT', { baseRevision: 2, settings: { voice: { language: 'fr' } } });
  expect(await response.json()).toEqual({ revision: 3, settings: { ...defaults, voice: { ...defaults.voice, language: 'fr' } } });
});

it('returns the current snapshot on conflicts before schema validation', async () => {
  const { request } = setup();
  const saved = await (await request('/settings', 'PUT', { baseRevision: 1, settings: { agent: { model: 'custom' } } })).json();
  for (const baseRevision of [1, 0, -1, 1.5, 100]) {
    const response = await request('/settings', 'PUT', { baseRevision, settings: { unknown: true } });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'CONFLICT', ...saved });
  }
  expect((await (await request()).json()).revision).toBe(2);
});

it.each(['bad', 'null', '[]', '{}', '{"baseRevision":"1","settings":{}}', '{"baseRevision":1}', '{"baseRevision":1,"settings":null}', '{"baseRevision":1,"settings":[]}'])('rejects malformed PUT envelopes: %s', async body => {
  const { request } = setup();
  expect((await request('/settings', 'PUT', body)).status).toBe(400);
  expect((await (await request()).json()).revision).toBe(1);
});

const invalidSettings = [
  { unknown: {} }, { voice: null }, { agent: [] }, { hands: false },
  { voice: { unknown: 'value' } }, JSON.parse('{"__proto__":{}}'),
  JSON.parse('{"voice":{"__proto__":{}}}'),
  ...['sttModel', 'language', 'inputDevice'].map(key => ({ voice: { [key]: 42 } })),
  ...['vadEnabled', 'ttsEnabled'].map(key => ({ voice: { [key]: 'true' } })),
  { voice: { playbackRate: '1' } }, { voice: { playbackRate: null } },
  { agent: { model: false } }, { agent: { confirmActions: 1 } },
  { hands: { browserControl: 'true' } }, { hands: { confirmMode: null } },
];
it.each(invalidSettings)('rejects invalid schema without changing state: %j', async settings => {
  const { request } = setup();
  const before = await (await request()).json();
  const response = await request('/settings', 'PUT', { baseRevision: 1, settings });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, error: 'VALIDATION', details: expect.any(Array) });
  expect(await (await request()).json()).toEqual(before);
});

it('acknowledges historical snapshots, including the baseline, without changing saved state', async () => {
  const { request } = setup();
  const baseline = await (await request()).json();
  const second = await (await request('/settings', 'PUT', { baseRevision: 1, settings: { voice: { language: 'fr' } } })).json();
  const third = await (await request('/settings', 'PUT', { baseRevision: 2, settings: {} })).json();
  for (const snapshot of [second, third, baseline, second]) {
    const response = await request('/settings/applied', 'POST', { revision: snapshot.revision });
    expect(response.status).toBe(200);
    const applied = { appliedRevision: snapshot.revision, appliedSettings: snapshot.settings };
    expect(await response.json()).toEqual(applied);
    expect(await (await request()).json()).toEqual({ schemaVersion: 1, ...third, ...applied });
  }
});

it.each(['bad', null, [], {}, { revision: '1' }, { revision: null }, { revision: 0 }, { revision: -1 }, { revision: 1.5 }, { revision: 2 }].map(body => ({ body })))('rejects invalid or unknown acknowledgements: $body', async ({ body }) => {
  const { request } = setup();
  const before = await (await request()).json();
  const response = await request('/settings/applied', 'POST', body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ ok: false, error: 'INVALID' });
  expect(await (await request()).json()).toEqual(before);
});

it.each([['/settings', 'GET'], ['/settings', 'PUT'], ['/settings/applied', 'POST']])('requires authentication for %s %s', async (path, method) => {
  const { request } = setup();
  const response = await request(path, method, 'bad', false);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' });
});

it.each([['/settings', 'POST', 'GET, PUT'], ['/settings/applied', 'GET', 'POST']])('restricts methods for %s %s', async (path, method, allow) => {
  const response = await setup().request(path, method);
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe(allow);
});

it('bounds settings request bodies', async () => {
  const { request } = setup();
  const response = await request('/settings', 'PUT', { baseRevision: 1, settings: { voice: { language: 'x'.repeat(65536) } } });
  expect(response.status).toBe(413);
  expect((await (await request()).json()).revision).toBe(1);
});
