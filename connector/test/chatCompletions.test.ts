import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { AgentError } from '../src/agentClient.ts';
import { createConnectorServer } from '../src/server.ts';

const routes = ['/v1/chat/completions', '/chat/completions'];
const headers = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
const messages = [{ role: 'user', content: 'Hello' }];

// Exercise the real request listener without binding a socket in the sandbox.
async function setup(route: string) {
  const agent = vi.fn(async (_text: string) => 'Hello\n"world"! 日本語');
  const server = createConnectorServer({ apiToken: 'test-token', port: 0, timeoutMs: 100, executable: 'openclaw' }, agent);
  function request(init: RequestInit = {}): Promise<Response> {
    return new Promise(resolve => {
      const incoming = new IncomingMessage(new Socket());
      incoming.url = route;
      incoming.method = init.method ?? 'GET';
      incoming.headers = Object.fromEntries(new Headers(init.headers));
      if (init.body) incoming.push(Buffer.from(String(init.body)));
      incoming.push(null);
      const outgoingHeaders = new Headers();
      let status = 200;
      const outgoing = {
        setHeader(name: string, value: string) { outgoingHeaders.set(name, value); },
        writeHead(code: number, values: Record<string, string>) {
          status = code;
          for (const [name, value] of Object.entries(values)) outgoingHeaders.set(name, value);
        },
        end(body: string) { resolve(new Response(body, { status, headers: outgoingHeaders })); },
      };
      server.emit('request', incoming, outgoing);
    });
  }
  return { request, agent };
}

it.each(routes)('returns the non-streaming contract and forwards only the last user text: %s', async route => {
  const { request, agent } = await setup(route);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({
    model: 'ignored-model', temperature: 0.5,
    messages: [
      { role: 'system', content: 'System instructions' },
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Earlier response' },
      { role: 'user', content: '  Final request\nwith newlines  ' },
      { role: 'assistant', content: 'Do not forward this' },
    ],
  }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ choices: [{
    message: { role: 'assistant', content: 'Hello\n"world"! 日本語' }, finish_reason: 'stop',
  }] });
  expect(agent).toHaveBeenCalledExactlyOnceWith('  Final request\nwith newlines  ');
});

it.each(routes)('streams a JSON content delta followed by the DONE event: %s', async route => {
  const { request, agent } = await setup(route);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({ messages, stream: true }) });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const body = await response.text();
  const events = body.split('\n\n');
  expect(events).toHaveLength(3);
  expect(events[0]).toMatch(/^data: /);
  expect(JSON.parse(events[0]!.slice(6))).toEqual({ choices: [{ delta: { content: 'Hello\n"world"! 日本語' } }] });
  expect(events.slice(1)).toEqual(['data: [DONE]', '']);
  expect(agent).toHaveBeenCalledExactlyOnceWith('Hello');
});

it('supports an explicit stream:false', async () => {
  const { request } = await setup(routes[0]!);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({ messages, stream: false }) });
  expect(response.status).toBe(200);
  expect((await response.json()).choices[0].message.role).toBe('assistant');
});

it.each(routes.flatMap(route => [undefined, 'Bearer wrong', 'Basic test-token'].map(authorization => ({ route, authorization }))))(
  'rejects unauthorized chat requests: $route / $authorization', async ({ route, authorization }) => {
    const { request, agent } = await setup(route);
    const response = await request({ method: 'POST', headers: authorization ? { authorization } : {}, body: JSON.stringify({ messages }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized' });
    expect(agent).not.toHaveBeenCalled();
  },
);

it.each([
  'bad', 'null', '[]', '{}', '{"messages":null}', '{"messages":{}}',
  '{"messages":[]}', '{"messages":[{"role":"system","content":"instructions"}]}',
  '{"messages":[{"role":"user","content":42}]}',
  '{"messages":[{"role":"user","content":" "}]}',
  '{"messages":[{"role":"user","content":"earlier"},{"role":"user","content":null}]}',
])('rejects malformed or missing final user text: %s', async body => {
  const { request, agent } = await setup(routes[0]!);
  const response = await request({ method: 'POST', headers, body });
  expect(response.status).toBe(400);
  expect(agent).not.toHaveBeenCalled();
});

it('ignores non-user entries when finding the last user text', async () => {
  const { request, agent } = await setup(routes[0]!);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({ messages: [null, 42, ...messages, null] }) });
  expect(response.status).toBe(200);
  expect(agent).toHaveBeenCalledExactlyOnceWith('Hello');
});

it.each(routes)('rejects unsupported methods: %s', async route => {
  const { request, agent } = await setup(route);
  const response = await request({ headers });
  expect(response.status).toBe(405);
  expect(response.headers.get('allow')).toBe('POST');
  expect(agent).not.toHaveBeenCalled();
});

it('applies the existing body size limit', async () => {
  const { request, agent } = await setup(routes[0]!);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(65536) }] }) });
  expect(response.status).toBe(413);
  expect(agent).not.toHaveBeenCalled();
});

it.each([
  { error: new AgentError('TIMEOUT', 'Agent request timed out'), status: 504, message: 'Agent request timed out' },
  { error: new AgentError('INVALID_REPLY', 'Agent returned an invalid or empty reply'), status: 502, message: 'Agent returned an invalid or empty reply' },
  { error: new Error('private stdout or credentials'), status: 502, message: 'Agent request failed' },
])('returns a safe JSON error before starting SSE: $status / $message', async ({ error, status, message }) => {
  const { request, agent } = await setup(routes[0]!);
  agent.mockRejectedValue(error);
  const response = await request({ method: 'POST', headers, body: JSON.stringify({ messages, stream: true }) });
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(await response.json()).toEqual({ ok: false, error: message });
});
