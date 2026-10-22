import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HandsStore } from '../src/handsStore.ts';
import { createTestConnectorServer } from './testServer.ts';

const input = { type: 'app' as const, target: 'chrome', action: 'open', params: { url: 'https://example.com' } };
const defaults = { browserControl: true, confirmMode: true };

describe('HandsStore', () => {
  for (const type of ['browser', 'app', 'shell'] as const) {
    for (const browserControl of [false, true]) {
      for (const confirmMode of [false, true]) {
        for (const allowlisted of [false, true]) {
          it(`gates ${type}: browser=${browserControl}, confirm=${confirmMode}, allowlisted=${allowlisted}`, () => {
            const store = new HandsStore();
            if (allowlisted) store.setAllowlist(['chrome']);
            const operation = store.createOperation({ ...input, type }, { browserControl, confirmMode });
            const status = type === 'browser' && !browserControl ? 'auto-denied'
              : !confirmMode && allowlisted ? 'auto-approved' : 'pending';
            expect(operation.status).toBe(status);
            expect(operation.reason).toBe(status === 'auto-denied' ? 'browser_control_disabled' : undefined);
            expect(operation.resolvedAtMs).toEqual(status === 'pending' ? undefined : expect.any(Number));
            expect(operation.approver).toBeUndefined();
          });
        }
      }
    }
  }

  it.each(['approve', 'deny'] as const)('only allows %s on pending operations', method => {
    const store = new HandsStore();
    const operation = store.createOperation(input, defaults);
    expect(operation).toMatchObject({ ...input, status: 'pending', id: expect.any(String), createdAtMs: expect.any(Number) });
    const resolved = store[method](operation.id);
    expect(resolved).toMatchObject({ status: method === 'approve' ? 'approved' : 'denied', approver: 'connector', resolvedAtMs: expect.any(Number) });
    for (const transition of ['approve', 'deny'] as const) {
      expect(() => store[transition](operation.id)).toThrow('NOT_PENDING');
      for (const browserControl of [true, false]) {
        store.setAllowlist(['chrome']);
        const automatic = store.createOperation({ ...input, type: 'browser' }, { browserControl, confirmMode: false });
        expect(() => store[transition](automatic.id)).toThrow('NOT_PENDING');
      }
      expect(store[transition]('missing')).toBeUndefined();
    }
    expect(store.get(operation.id)).toEqual(resolved);
  });

  it('keeps the newest 50, in creation order even when timestamps tie', () => {
    const store = new HandsStore();
    const operations = Array.from({ length: 55 }, () => store.createOperation(input, defaults));
    expect(store.list()).toEqual(operations.slice(5).reverse());
    expect(new Set(operations.map(operation => operation.id)).size).toBe(55);
    expect(store.get(operations[0]!.id)).toBeUndefined();
    expect(store.approve(operations[0]!.id)).toBeUndefined();
    store.approve(operations[54]!.id);
    expect(store.list('approved')).toHaveLength(1);
    expect(store.list('pending')).toHaveLength(49);
  });

  it('replaces, trims and deduplicates allowlist targets using exact matches', () => {
    const store = new HandsStore();
    expect(store.getAllowlist()).toEqual([]);
    expect(store.setAllowlist([' chrome ', 'chrome', '', '   ', 'docs.google.com'])).toEqual(['chrome', 'docs.google.com']);
    expect(store.createOperation({ ...input, target: 'Chrome' }, { ...defaults, confirmMode: false }).status).toBe('pending');
    expect(store.setAllowlist([])).toEqual([]);
    expect(store.createOperation(input, { ...defaults, confirmMode: false }).status).toBe('pending');
  });

  it('isolates instances and protects stored state from returned or input objects', () => {
    const store = new HandsStore();
    const body = structuredClone(input);
    const operation = store.createOperation(body, defaults);
    body.params.url = 'changed';
    operation.status = 'approved';
    operation.params!.url = 'changed';
    store.get(operation.id)!.status = 'denied';
    store.list()[0]!.status = 'denied';
    expect(store.get(operation.id)).toMatchObject({ status: 'pending', params: input.params });
    store.setAllowlist(['chrome']).push('shell');
    store.getAllowlist().push('shell');
    expect(store.getAllowlist()).toEqual(['chrome']);
    expect(new HandsStore().list()).toEqual([]);
    expect(new HandsStore().getAllowlist()).toEqual([]);
  });
});

const servers: ReturnType<typeof createTestConnectorServer>[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.emit('close');
});

function setup() {
  const agent = vi.fn(async () => 'OK');
  const server = createTestConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw' }, agent);
  servers.push(server);
  function request(path: string, method = 'GET', body?: unknown, auth = true): Promise<Response> {
    return new Promise(resolve => {
      const incoming = new IncomingMessage(new Socket());
      incoming.url = path;
      incoming.method = method;
      incoming.headers = auth ? { authorization: 'Bearer test-token' } : {};
      if (body !== undefined) incoming.push(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      incoming.push(null);
      const headers = new Headers();
      let status = 200;
      server.emit('request', incoming, {
        setHeader(name: string, value: string) { headers.set(name, value); },
        writeHead(code: number, values: Record<string, string> = {}) {
          status = code;
          for (const [name, value] of Object.entries(values)) headers.set(name, value);
        },
        end(body?: string) { resolve(new Response(body ?? null, { status, headers })); },
      });
    });
  }
  return { request, agent };
}

describe('Hands routes', () => {
  it('creates, lists, fetches, approves and denies without calling the agent', async () => {
    const { request, agent } = setup();
    const operations = [];
    for (const type of ['browser', 'app', 'shell']) {
      const response = await request('/hands/operations', 'POST', { ...input, type });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.json();
      expect(body).toMatchObject({ ok: true, operation: { ...input, type, status: 'pending' } });
      operations.push(body.operation);
    }
    expect(await (await request('/hands/operations')).json()).toEqual({ ok: true, operations: [...operations].reverse() });
    for (const [index, method] of ['approve', 'deny'].entries()) {
      const path = `/hands/operations/${operations[index].id}`;
      expect(await (await request(path)).json()).toEqual({ ok: true, operation: operations[index] });
      const response = await request(`${path}/${method}`, 'POST');
      expect(response.status).toBe(200);
      const resolved = await response.json();
      const status = method === 'approve' ? 'approved' : 'denied';
      expect(resolved).toEqual({ ok: true, operation: { ...operations[index], status, approver: 'connector', resolvedAtMs: expect.any(Number) } });
      expect(await (await request(path)).json()).toEqual(resolved);
      expect(await (await request(`/hands/operations?status=${status}`)).json()).toEqual({ ok: true, operations: [resolved.operation] });
      for (const transition of ['approve', 'deny']) {
        const conflict = await request(`${path}/${transition}`, 'POST');
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toEqual({ ok: false, error: 'NOT_PENDING' });
      }
    }
    expect((await (await request('/hands/operations?status=pending')).json()).operations).toEqual([operations[2]]);
    expect(agent).not.toHaveBeenCalled();
  });

  it('uses current saved hands settings and allowlist, with browser denial taking priority', async () => {
    const { request } = setup();
    expect(await (await request('/hands/allowlist')).json()).toEqual({ ok: true, targets: [] });
    const put = await request('/hands/allowlist', 'PUT', { targets: [' chrome ', 'chrome', '', '  '] });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ targets: ['chrome'] });
    expect(await (await request('/hands/allowlist')).json()).toEqual({ ok: true, targets: ['chrome'] });
    let revision = 1;
    for (const hands of [defaults, { browserControl: false, confirmMode: false }, { browserControl: true, confirmMode: false }]) {
      expect((await request('/settings', 'PUT', { baseRevision: revision++, settings: { hands } })).status).toBe(200);
      const { operation } = await (await request('/hands/operations', 'POST', { ...input, type: 'browser' })).json();
      const status = !hands.browserControl ? 'auto-denied' : hands.confirmMode ? 'pending' : 'auto-approved';
      expect(operation.status).toBe(status);
      expect((await (await request(`/hands/operations?status=${status}`)).json()).operations).toContainEqual(operation);
    }
    await request('/hands/allowlist', 'PUT', { targets: [] });
    expect((await (await request('/hands/operations', 'POST', input)).json()).operation.status).toBe('pending');
    const fresh = setup().request;
    expect(await (await fresh('/hands/operations')).json()).toEqual({ ok: true, operations: [] });
    expect(await (await fresh('/hands/allowlist')).json()).toEqual({ ok: true, targets: [] });
  });

  const routes = [
    ['/hands/operations', 'GET', 'GET, POST'], ['/hands/operations', 'POST', 'GET, POST'],
    ['/hands/operations?status=pending', 'GET', 'GET, POST'],
    ['/hands/operations/missing', 'GET', 'GET'],
    ['/hands/operations/missing/approve', 'POST', 'POST'], ['/hands/operations/missing/deny', 'POST', 'POST'],
    ['/hands/allowlist', 'GET', 'GET, PUT'], ['/hands/allowlist', 'PUT', 'GET, PUT'],
  ];
  it.each(routes)('requires authentication for %s %s', async (path, method) => {
    expect((await setup().request(path!, method!, 'bad', false)).status).toBe(401);
  });
  it.each(routes)('restricts methods for %s %s', async (path, _method, allow) => {
    const response = await setup().request(path!, 'DELETE');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe(allow);
  });
  it.each(['', '/approve', '/deny'])('returns 404 for unknown operation %s', async suffix => {
    expect((await setup().request(`/hands/operations/missing${suffix}`, suffix ? 'POST' : 'GET')).status).toBe(404);
  });
  it.each([
    'bad', null, [], {}, { ...input, type: 'unknown' }, { ...input, target: '' }, { ...input, target: '  ' },
    { ...input, target: 1 }, { ...input, action: '' }, { ...input, action: '  ' }, { ...input, action: false },
    ...[null, [], 1, 'text'].map(params => ({ ...input, params })),
  ].map(body => ({ body })))('rejects invalid operation body $body', async ({ body }) => {
    const { request } = setup();
    expect((await request('/hands/operations', 'POST', body)).status).toBe(400);
    expect((await (await request('/hands/operations')).json()).operations).toEqual([]);
  });
  it.each(['bad', null, [], {}, { targets: null }, { targets: 'chrome' }, { targets: [1] }, { targets: ['chrome', null] }].map(body => ({ body })))('rejects invalid allowlist body $body atomically', async ({ body }) => {
    const { request } = setup();
    await request('/hands/allowlist', 'PUT', { targets: ['chrome'] });
    expect((await request('/hands/allowlist', 'PUT', body)).status).toBe(400);
    expect((await (await request('/hands/allowlist')).json()).targets).toEqual(['chrome']);
  });
  it('accepts omitted params and rejects invalid status filters and oversized bodies', async () => {
    const { request } = setup();
    expect((await request('/hands/operations', 'POST', { type: 'shell', target: 'terminal', action: 'open' })).status).toBe(200);
    expect((await request('/hands/operations?status=unknown')).status).toBe(400);
    expect((await request('/hands/operations', 'POST', { ...input, action: 'x'.repeat(65536) })).status).toBe(413);
    expect((await request('/hands/allowlist', 'PUT', { targets: ['x'.repeat(65536)] })).status).toBe(413);
  });
});
