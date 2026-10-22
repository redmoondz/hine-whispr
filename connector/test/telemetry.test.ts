import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentError } from '../src/agentClient.ts';
import { createConnectorServer } from '../src/server.ts';
import { Telemetry } from '../src/telemetry.ts';

afterEach(() => vi.restoreAllMocks());

it('counts successes and failures and retains the last successful latency', () => {
  const telemetry = new Telemetry();
  expect(telemetry.get()).toEqual({ ok: true, startedAtMs: expect.any(Number),
    commandsTotal: 0, commandsFailed: 0, lastLatencyMs: null, lastLatencyAtMs: null, recent: [] });
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  telemetry.record('hello', 'command', true, 25);
  vi.mocked(Date.now).mockReturnValue(2000);
  telemetry.record('failed', 'chat', false, 50);
  expect(telemetry.get()).toMatchObject({ commandsTotal: 2, commandsFailed: 1,
    lastLatencyMs: 25, lastLatencyAtMs: 1000, recent: [
      { id: expect.any(String), ts: 1000, text: 'hello', source: 'command', ok: true, latencyMs: 25 },
      { id: expect.any(String), ts: 2000, text: 'failed', source: 'chat', ok: false, latencyMs: 50 },
    ] });
});

it('caps history at 20, truncates text, and returns independent snapshots with unique IDs', () => {
  const telemetry = new Telemetry();
  for (let index = 0; index < 25; index++) telemetry.record(`${index}:${'x'.repeat(300)}`, 'command', true, index);
  const snapshot = telemetry.get();
  expect(snapshot.commandsTotal).toBe(25);
  expect(snapshot.recent).toHaveLength(20);
  expect(snapshot.recent[0]!.text).toBe(`5:${'x'.repeat(198)}`);
  expect(snapshot.recent.at(-1)!.text).toBe(`24:${'x'.repeat(197)}`);
  expect(new Set(snapshot.recent.map(entry => entry.id)).size).toBe(20);
  snapshot.recent[0]!.text = 'changed';
  snapshot.recent.pop();
  expect(telemetry.get().recent).toHaveLength(20);
  expect(telemetry.get().recent[0]!.text.startsWith('5:')).toBe(true);
});

// Exercise the actual listener without requiring socket permissions.
function setup() {
  const agent = vi.fn(async (_text: string) => 'OK');
  const server = createConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw' }, agent);
  function request(path = '/metrics', init: RequestInit = {}): Promise<Response> {
    return new Promise(resolve => {
      const incoming = new IncomingMessage(new Socket());
      incoming.url = path;
      incoming.method = init.method ?? 'GET';
      incoming.headers = Object.fromEntries(new Headers(init.headers ?? { authorization: 'Bearer test-token' }));
      if (init.body) incoming.push(Buffer.from(String(init.body)));
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

it('returns exactly the metrics schema and enforces bearer auth and GET', async () => {
  const { request } = setup();
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ ok: true, startedAtMs: expect.any(Number),
    commandsTotal: 0, commandsFailed: 0, lastLatencyMs: null, lastLatencyAtMs: null, recent: [] });
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    expect((await request('/metrics', { headers })).status).toBe(401);
  }
  const wrongMethod = await request('/metrics', { method: 'POST' });
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('GET');
});

it.each([
  { path: '/command', body: { text: 'hello' }, source: 'command' },
  ...['/v1/chat/completions', '/chat/completions'].flatMap(path => [false, true].map(stream => ({
    path, body: { messages: [{ role: 'user', content: 'hello' }], stream }, source: 'chat',
  }))),
])('records successes and errors for $path / $body', async ({ path, body, source }) => {
  const { request, agent } = setup();
  const post = () => request(path, { method: 'POST', body: JSON.stringify(body) });
  expect((await post()).status).toBe(200);
  const success = await (await request()).json();
  expect(success).toMatchObject({ commandsTotal: 1, commandsFailed: 0,
    lastLatencyMs: expect.any(Number), lastLatencyAtMs: expect.any(Number),
    recent: [{ id: expect.any(String), ts: expect.any(Number), text: 'hello', source, ok: true, latencyMs: expect.any(Number) }],
  });
  for (const error of [new Error('private error'), new AgentError('TIMEOUT', 'Agent request timed out')]) {
    agent.mockRejectedValueOnce(error);
    expect((await post()).status).toBe(error instanceof AgentError ? 504 : 502);
  }
  const failed = await (await request()).json();
  expect(failed.commandsTotal).toBe(3);
  expect(failed.commandsFailed).toBe(2);
  expect(failed.lastLatencyMs).toBe(success.lastLatencyMs);
  expect(failed.lastLatencyAtMs).toBe(success.lastLatencyAtMs);
  expect(failed.recent.map((entry: { ok: boolean }) => entry.ok)).toEqual([true, false, false]);
  expect(JSON.stringify(failed)).not.toContain('private error');
  expect((await (await setup().request()).json()).commandsTotal).toBe(0);
});

it('excludes requests that never dispatch to the agent', async () => {
  const { request, agent } = setup();
  await request('/command', { method: 'POST', headers: {}, body: '{"text":"hello"}' });
  await request('/command', { method: 'POST', body: '{}' });
  await request('/command', { method: 'POST', body: 'x'.repeat(65537) });
  for (const path of ['/command', '/health', '/settings']) await request(path);
  expect((await (await request()).json()).commandsTotal).toBe(0);
  expect(agent).not.toHaveBeenCalled();
});

it.each(['http://localhost:3000', 'http://127.0.0.1:5173', 'http://localhost', 'http://127.0.0.1'])(
  'allows loopback JSON responses and unauthenticated preflight: %s', async origin => {
    const { request, agent } = setup();
    const preflight = await request('/command', { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type',
    } });
    expect(preflight.status).toBe(204);
    expect(await preflight.text()).toBe('');
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    const allowedHeaders = preflight.headers.get('access-control-allow-headers')!.toLowerCase();
    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('content-type');
    for (const path of ['/health', '/metrics', '/settings', '/command', '/missing']) {
      const response = await request(path, { headers: { origin } });
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
      expect(response.headers.get('vary')).toBe('Origin');
      if (path === '/metrics') expect(response.status).toBe(401);
    }
    expect(agent).not.toHaveBeenCalled();
  },
);

it.each([undefined, 'null', 'https://localhost:3000', 'http://localhost.evil:3000', 'http://127.0.0.2:3000',
  'http://localhost:3000/path', 'http://user@localhost:3000', 'http://[::1]:3000', 'http://localhost:99999',
])('does not grant CORS to other origins: %s', async origin => {
  const { request } = setup();
  const headers = origin ? { origin } : {};
  for (const method of ['GET', 'OPTIONS']) {
    expect((await request('/metrics', { method, headers })).headers.has('access-control-allow-origin')).toBe(false);
  }
});
