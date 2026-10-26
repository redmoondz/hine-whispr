import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { AgentError, runAgent } from './agentClient.ts';
import { SessionStore } from './sessionStore.ts';
import { sessionRoute } from './sessionRoutes.ts';
import { readSessionActivity } from './sessionProgress.ts';
import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { isObject, SettingsStore } from './settingsStore.ts';
import { Telemetry } from './telemetry.ts';
import { AnalyticsStore } from './analyticsStore.ts';
import { HandsStore, OPERATION_STATUSES } from './handsStore.ts';
import type { OperationStatus } from './handsStore.ts';

const MAX_BODY_BYTES = 64 * 1024;

function cors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  response.setHeader('vary', 'Origin');
  if (!origin || !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin)) return;
  // URL parsing also rejects invalid port numbers.
  try { new URL(origin); } catch { return; }
  response.setHeader('access-control-allow-origin', origin);
  if (request.method === 'OPTIONS') {
    response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    response.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  }
}

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(request.headers.authorization ?? ''), digest(`Bearer ${token}`));
}

function lastUserText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  // MVP forwards only the final user message, without system or history text.
  const last: unknown = messages.findLast(message =>
    message !== null && typeof message === 'object' && message.role === 'user');
  if (last && typeof last === 'object' && 'content' in last && typeof last.content === 'string') {
    return last.content;
  }
  return undefined;
}

export function createConnectorServer(
  config: Config,
  agent: (text: string, timeoutMs?: number) => Promise<string> = (text, timeoutMs) => runAgent(text, { ...config, timeoutMs: timeoutMs ?? config.timeoutMs }),
  analytics?: AnalyticsStore,
) {
  mkdirSync(config.dataDir, { recursive: true });
  const analyticsStore = analytics ?? new AnalyticsStore(join(config.dataDir, 'analytics.db'));
  const startedAtMs = Date.now() - Math.floor(process.uptime() * 1000);
  const settings = new SettingsStore();
  const telemetry = new Telemetry();
  const hands = new HandsStore();
  function recordCall(text: string, source: 'command' | 'chat', ok: boolean, latencyMs: number): void {
    telemetry.record(text, source, ok, latencyMs);
    analyticsStore.record({ ts: Date.now(), source, ok, latencyMs });
  }
  let serverClosing = false;
  const sessions = new SessionStore(join(config.dataDir, 'sessions.json'), async (text, id, timeoutMs) => {
    // Bound progress polling to one outstanding read per running session.
    const started = performance.now();
    let reading = false;
    let finished = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      void readSessionActivity(config.executable, id)
        .then(activity => { if (!finished) sessions.updateActivity(id, activity); })
        .finally(() => { reading = false; });
    }, 5000);
    timer.unref();
    try {
      const reply = await runAgent(text, { ...config, timeoutMs }, id);
      if (!serverClosing) recordCall(text, 'chat', true, performance.now() - started);
      return reply;
    } catch (error) {
      if (!serverClosing) recordCall(text, 'chat', false, performance.now() - started);
      throw error;
    }
    finally { finished = true; clearInterval(timer); }
  });
  const server = createServer(async (request, response) => {
    cors(request, response);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === '/health' && request.method === 'GET') {
      json(response, 200, { ok: true, agent: 'hina' });
      return;
    }
    if (request.url === '/sessions' || request.url?.startsWith('/sessions/')) {
      if (!authorized(request, config.apiToken)) {
        json(response, 401, { ok: false, error: 'Unauthorized' });
        return;
      }
      await sessionRoute(request, response, sessions);
      return;
    }
    const chatCompletion = request.url === '/v1/chat/completions' || request.url === '/chat/completions';
    const settingsRoute = request.url === '/settings';
    const appliedRoute = request.url === '/settings/applied';
    const metricsRoute = request.url === '/metrics';
    const analyticsRoute = request.url === '/analytics';
    const [pathname, query = ''] = (request.url ?? '').split('?');
    const operationsRoute = pathname === '/hands/operations';
    const allowlistRoute = pathname === '/hands/allowlist';
    const operationRoute = /^\/hands\/operations\/([^/]+)(?:\/(approve|deny))?$/.exec(pathname ?? '');
    const handsRoute = operationsRoute || allowlistRoute || operationRoute !== null;
    if (request.url !== '/command' && !chatCompletion && !settingsRoute && !appliedRoute && !metricsRoute && !analyticsRoute && !handsRoute) {
      json(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!authorized(request, config.apiToken)) {
      json(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const allowedMethods = operationsRoute ? ['GET', 'POST']
      : allowlistRoute || settingsRoute ? ['GET', 'PUT']
      : metricsRoute || analyticsRoute || (operationRoute && !operationRoute[2]) ? ['GET'] : ['POST'];
    if (!allowedMethods.includes(request.method ?? '')) {
      response.setHeader('allow', allowedMethods.join(', '));
      json(response, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    if (operationsRoute && request.method === 'GET') {
      const status = new URLSearchParams(query).get('status');
      if (status !== null && !OPERATION_STATUSES.includes(status as OperationStatus)) {
        json(response, 400, { ok: false, error: 'INVALID' });
        return;
      }
      json(response, 200, { ok: true, operations: hands.list((status ?? undefined) as OperationStatus | undefined) });
      return;
    }
    if (allowlistRoute && request.method === 'GET') {
      json(response, 200, { ok: true, targets: hands.getAllowlist() });
      return;
    }
    if (operationRoute) {
      const id = operationRoute[1]!;
      try {
        const operation = operationRoute[2] === 'approve' ? hands.approve(id)
          : operationRoute[2] === 'deny' ? hands.deny(id) : hands.get(id);
        json(response, operation ? 200 : 404, operation
          ? { ok: true, operation } : { ok: false, error: 'Not found' });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'NOT_PENDING') throw error;
        json(response, 409, { ok: false, error: 'NOT_PENDING' });
      }
      return;
    }
    if (metricsRoute) {
      json(response, 200, telemetry.get());
      return;
    }
    if (analyticsRoute) {
      const now = Date.now();
      const today = new Date(now).toISOString().slice(0, 10);
      const sinceDay = new Date(now - 29 * 86400000).toISOString().slice(0, 10);
      json(response, 200, {
        ok: true,
        schemaVersion: 1,
        commandsTotal: analyticsStore.total(),
        commandsFailed: analyticsStore.failed(),
        uptimeSeconds: Math.floor((now - startedAtMs) / 1000),
        latency: analyticsStore.latencyStats(),
        requestsByDay: analyticsStore.requestsByDay(sinceDay, today),
      });
      return;
    }
    if (settingsRoute && request.method === 'GET') {
      json(response, 200, settings.get());
      return;
    }
    let text: string;
    let stream = false;
    let timeoutMs: number | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          json(response, 413, { ok: false, error: 'Request body exceeds 64 KiB' });
          request.resume();
          return;
        }
        chunks.push(chunk);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (allowlistRoute) {
        if (!isObject(body) || !Array.isArray(body.targets) ||
            !body.targets.every((target: unknown) => typeof target === 'string')) throw new Error();
        json(response, 200, { targets: hands.setAllowlist(body.targets) });
        return;
      }
      if (operationsRoute) {
        if (!isObject(body) || (body.type !== 'browser' && body.type !== 'app' && body.type !== 'shell') ||
            typeof body.target !== 'string' || !body.target.trim() ||
            typeof body.action !== 'string' || !body.action.trim() ||
            (Object.hasOwn(body, 'params') && !isObject(body.params))) throw new Error();
        const operation = hands.createOperation({
          type: body.type, target: body.target, action: body.action,
          ...(isObject(body.params) ? { params: body.params } : {}),
        }, settings.get().settings.hands);
        json(response, 200, { ok: true, operation });
        return;
      }
      if (settingsRoute) {
        if (!isObject(body) || typeof body.baseRevision !== 'number' || !isObject(body.settings)) {
          throw new Error();
        }
        const result = settings.put(body.baseRevision, body.settings);
        json(response, result.status, result.body);
        return;
      }
      if (appliedRoute) {
        const result = settings.applied(isObject(body) ? body.revision : undefined);
        json(response, result.status, result.body);
        return;
      }
      if (!body || typeof body !== 'object') throw new Error();
      if ('timeoutSeconds' in body) {
        const value = body.timeoutSeconds;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3600) throw new Error();
        timeoutMs = value * 1000;
      }
      const input = chatCompletion
        ? lastUserText('messages' in body ? body.messages : undefined)
        : 'text' in body ? body.text : undefined;
      if (typeof input !== 'string' || !input.trim()) {
        throw new Error();
      }
      text = input;
      stream = chatCompletion && 'stream' in body && body.stream === true;
    } catch {
      if (settingsRoute || appliedRoute || handsRoute) {
        json(response, 400, { ok: false, error: 'INVALID' });
        return;
      }
      json(response, 400, { ok: false, error: chatCompletion
        ? 'Expected JSON messages with a nonempty final user content string'
        : 'Expected JSON with a nonempty text string' });
      return;
    }
    const started = performance.now();
    const source = chatCompletion ? 'chat' : 'command';
    let reply: string;
    try {
      reply = timeoutMs === undefined ? await agent(text) : await agent(text, timeoutMs);
    } catch (error) {
      recordCall(text, source, false, performance.now() - started);
      const status = error instanceof AgentError && error.code === 'TIMEOUT' ? 504 : 502;
      json(response, status, { ok: false, error: error instanceof AgentError ? error.message : 'Agent request failed' });
      return;
    }
    recordCall(text, source, true, performance.now() - started);
    if (stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      // The CLI returns a final answer, so send one content event without delay.
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
    } else if (chatCompletion) {
      json(response, 200, { choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] });
    } else {
      json(response, 200, { reply, ok: true });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.on('close', () => { serverClosing = true; analyticsStore.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.OPENCLAW_SHELL === 'exec') {
      throw new Error('Start Connector from a standalone shell without OPENCLAW_SHELL=exec');
    }
    const config = loadConfig();
    const server = createConnectorServer(config);
    server.on('error', () => {
      console.error('Connector could not listen');
      process.exitCode = 1;
    });
    server.listen(config.port, '127.0.0.1', () => {
      console.info(`Hina Connector listening on http://127.0.0.1:${config.port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => {
        server.close();
        server.closeIdleConnections();
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Connector startup failed');
    process.exitCode = 1;
  }
}
