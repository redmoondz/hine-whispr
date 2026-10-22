import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AnalyticsStore } from '../src/analyticsStore.ts';
import { AgentError } from '../src/agentClient.ts';
import { loadConfig } from '../src/config.ts';
import { createConnectorServer } from '../src/server.ts';

const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) close();
});
function store(path = ':memory:') {
  const analytics = new AnalyticsStore(path);
  cleanup.push(() => analytics.close());
  return analytics;
}
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'connector-analytics-'));
  cleanup.push(() => rmSync(path, { recursive: true, force: true }));
  return path;
}
const record = (analytics: AnalyticsStore, ts: string, latencyMs = 10, ok = true) =>
  analytics.record({ ts: Date.parse(ts), source: 'command', ok, latencyMs });

it('counts successes and failures with unique rows at the same timestamp', () => {
  const analytics = store();
  expect(analytics.total()).toBe(0);
  expect(analytics.failed()).toBe(0);
  record(analytics, '2026-10-22T12:00:00Z');
  analytics.record({ ts: Date.parse('2026-10-22T12:00:00Z'), source: 'chat', ok: false, latencyMs: 20 });
  expect(analytics.total()).toBe(2);
  expect(analytics.failed()).toBe(1);
});

it('groups by UTC day, sorts ascending, and applies inclusive optional bounds', () => {
  const analytics = store();
  record(analytics, '2026-10-23T00:00:00Z', 10, false);
  record(analytics, '2026-10-21T23:59:59Z');
  record(analytics, '2026-10-22T23:59:59Z');
  record(analytics, '2026-10-22T00:00:00Z', 20, false);
  const days = [
    { day: '2026-10-21', total: 1, failed: 0 },
    { day: '2026-10-22', total: 2, failed: 1 },
    { day: '2026-10-23', total: 1, failed: 1 },
  ];
  expect(analytics.requestsByDay()).toEqual(days);
  expect(analytics.requestsByDay('2026-10-22')).toEqual(days.slice(1));
  expect(analytics.requestsByDay(undefined, '2026-10-22')).toEqual(days.slice(0, 2));
  expect(analytics.requestsByDay('2026-10-22', '2026-10-22')).toEqual([days[1]]);
  expect(analytics.requestsByDay('2026-10-24')).toEqual([]);
});

it('returns null latency values below two rows and discrete percentiles otherwise', () => {
  const analytics = store();
  const empty = { avgMs: null, p50Ms: null, p90Ms: null, maxMs: null };
  expect(analytics.latencyStats()).toEqual(empty);
  record(analytics, '2026-10-22T00:00:00Z', 100);
  expect(analytics.latencyStats()).toEqual(empty);
  record(analytics, '2026-10-22T00:00:00Z', 10, false);
  expect(analytics.latencyStats()).toEqual({ avgMs: 55, p50Ms: 10, p90Ms: 100, maxMs: 100 });
  for (const latency of [40, 20, 90, 30, 80, 50, 70, 60]) record(analytics, '2026-10-22T00:00:00Z', latency);
  expect(analytics.latencyStats()).toEqual({ avgMs: 55, p50Ms: 50, p90Ms: 90, maxMs: 100 });
});

it('retains counts, UTC groups, and latency after reopening a file database', () => {
  const path = join(directory(), 'analytics.db');
  const first = new AnalyticsStore(path);
  record(first, '2026-10-22T12:00:00Z', 10);
  record(first, '2026-10-22T12:00:00Z', 20, false);
  first.close();
  const reopened = store(path);
  expect(reopened.total()).toBe(2);
  expect(reopened.failed()).toBe(1);
  expect(reopened.requestsByDay()).toEqual([{ day: '2026-10-22', total: 2, failed: 1 }]);
  expect(reopened.latencyStats()).toEqual({ avgMs: 15, p50Ms: 10, p90Ms: 20, maxMs: 20 });
});

it('exposes CONNECTOR_DATA_DIR and defaults to connector/data regardless of cwd', () => {
  expect(loadConfig({ CONNECTOR_API_TOKEN: 'test' }).dataDir).toBe(resolve(import.meta.dirname, '../data'));
  expect(loadConfig({ CONNECTOR_API_TOKEN: 'test', CONNECTOR_DATA_DIR: './custom' }).dataDir).toBe('./custom');
});

function setup(analytics?: AnalyticsStore, dataDir = directory()) {
  const agent = vi.fn(async (_text: string) => 'OK');
  const server = createConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw', dataDir }, agent, analytics);
  cleanup.push(() => server.emit('close'));
  // Exercise the actual HTTP listener without requiring socket binding.
  function request(path = '/analytics', init: RequestInit = {}): Promise<Response> {
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
  return { request, agent, server };
}

it('requires bearer auth and GET and returns exactly the analytics schema', async () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(process, 'uptime').mockReturnValue(10.75);
  const { request } = setup(store());
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    expect((await request('/analytics', { headers })).status).toBe(401);
  }
  const wrongMethod = await request('/analytics', { method: 'POST' });
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toBe('GET');
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toEqual({ ok: true, schemaVersion: 1, commandsTotal: 0, commandsFailed: 0,
    uptimeSeconds: 10, latency: { avgMs: null, p50Ms: null, p90Ms: null, maxMs: null }, requestsByDay: [] });
  vi.mocked(Date.now).mockReturnValue(now + 1250);
  expect((await (await request()).json()).uptimeSeconds).toBe(12);
});

it('limits daily requests to today and the previous 29 UTC days while totals include all rows', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-22T12:00:00Z'));
  const analytics = store();
  for (const day of ['2026-09-22', '2026-09-23', '2026-10-22', '2026-10-23']) record(analytics, `${day}T00:00:00Z`);
  const body = await (await setup(analytics).request()).json();
  expect(body.commandsTotal).toBe(4);
  expect(body.requestsByDay).toEqual([
    { day: '2026-09-23', total: 1, failed: 0 }, { day: '2026-10-22', total: 1, failed: 0 },
  ]);
});

it.each(['/command', '/v1/chat/completions', '/chat/completions'])(
  'records successes and errors once in both stores for %s', async path => {
    const analytics = store();
    const recording = vi.spyOn(analytics, 'record');
    const { request, agent } = setup(analytics);
    const body = path === '/command' ? { text: 'hello' } : { messages: [{ role: 'user', content: 'hello' }], stream: true };
    const post = () => request(path, { method: 'POST', body: JSON.stringify(body) });
    expect((await post()).status).toBe(200);
    agent.mockRejectedValueOnce(new Error('private'));
    expect((await post()).status).toBe(502);
    agent.mockRejectedValueOnce(new AgentError('TIMEOUT', 'Agent request timed out'));
    expect((await post()).status).toBe(504);
    await request(path, { method: 'POST', body: '{}' });
    await request(path, { method: 'POST', headers: {}, body: JSON.stringify(body) });
    const result = await (await request()).json();
    expect(result.commandsTotal).toBe(3);
    expect(result.commandsFailed).toBe(2);
    expect(recording).toHaveBeenCalledTimes(3);
    for (const [entry] of recording.mock.calls) {
      expect(entry.source).toBe(path === '/command' ? 'command' : 'chat');
      expect(entry.ts).toEqual(expect.any(Number));
    }
    expect(result.requestsByDay).toEqual([{ day: new Date().toISOString().slice(0, 10), total: 3, failed: 2 }]);
    expect(result.latency.avgMs).toBeGreaterThanOrEqual(0);
    const metrics = await (await request('/metrics')).json();
    expect(metrics.commandsTotal).toBe(3);
    expect(metrics.commandsFailed).toBe(2);
  },
);

it('creates the directory at startup, opens the DB lazily, and persists across server restart', async () => {
  const dataDir = join(directory(), 'nested');
  const path = join(dataDir, 'analytics.db');
  const first = setup(undefined, dataDir);
  expect(existsSync(dataDir)).toBe(true);
  expect(existsSync(path)).toBe(false);
  await first.request('/command', { method: 'POST', body: '{"text":"hello"}' });
  expect(existsSync(path)).toBe(true);
  first.server.emit('close');
  const second = setup(undefined, dataDir);
  expect((await (await second.request()).json()).commandsTotal).toBe(1);
  expect((await (await second.request('/metrics')).json()).commandsTotal).toBe(0);
});
