import { timingSafeEqual, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { pathToFileURL } from 'node:url';
import { AgentError, runAgent } from './agentClient.ts';
import { loadConfig } from './config.ts';
import type { Config } from './config.ts';

const MAX_BODY_BYTES = 64 * 1024;

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

export function createConnectorServer(config: Config, agent: (text: string) => Promise<string> = text => runAgent(text, config)) {
  const server = createServer(async (request, response) => {
    if (request.url === '/health' && request.method === 'GET') {
      json(response, 200, { ok: true, agent: 'hina' });
      return;
    }
    const chatCompletion = request.url === '/v1/chat/completions' || request.url === '/chat/completions';
    if (request.url !== '/command' && !chatCompletion) {
      json(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!authorized(request, config.apiToken)) {
      json(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('allow', 'POST');
      json(response, 405, { ok: false, error: 'Method not allowed' });
      return;
    }
    let text: string;
    let stream = false;
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
      if (!body || typeof body !== 'object') throw new Error();
      const input = chatCompletion
        ? lastUserText('messages' in body ? body.messages : undefined)
        : 'text' in body ? body.text : undefined;
      if (typeof input !== 'string' || !input.trim()) {
        throw new Error();
      }
      text = input;
      stream = chatCompletion && 'stream' in body && body.stream === true;
    } catch {
      json(response, 400, { ok: false, error: chatCompletion
        ? 'Expected JSON messages with a nonempty final user content string'
        : 'Expected JSON with a nonempty text string' });
      return;
    }
    try {
      const reply = await agent(text);
      if (stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
        // The CLI returns a final answer, so send one content event without delay.
        response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n`);
      } else if (chatCompletion) {
        json(response, 200, { choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] });
      } else {
        json(response, 200, { reply, ok: true });
      }
    } catch (error) {
      const status = error instanceof AgentError && error.code === 'TIMEOUT' ? 504 : 502;
      json(response, status, { ok: false, error: error instanceof AgentError ? error.message : 'Agent request failed' });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
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
