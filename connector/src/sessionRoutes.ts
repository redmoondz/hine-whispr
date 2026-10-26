import type { IncomingMessage, ServerResponse } from 'node:http';
import { SessionStore } from './sessionStore.ts';

export async function sessionRoute(request: IncomingMessage, response: ServerResponse, store: SessionStore) {
  const match = /^\/sessions(?:\/([a-zA-Z0-9-]{1,80})(?:\/(messages|close))?)?$/.exec(request.url ?? '');
  const reply = (status: number, body: object) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (!match) { reply(404, { ok: false, error: 'Not found' }); return; }
  const [, id, action] = match;
  if (request.method === 'GET' && !action) {
    const session = id ? store.get(id) : undefined;
    reply(id && !session ? 404 : 200, id ? { ok: !!session, session } : { ok: true, sessions: store.list() });
    return;
  }
  if (request.method !== 'POST' || !id || !action) { reply(405, { ok: false, error: 'Method not allowed' }); return; }
  if (action === 'close') { reply(200, { ok: true, session: store.archive(id) }); return; }
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 64000) { request.resume(); reply(413, { ok: false, error: 'Request too large' }); return; }
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof body.text !== 'string' || !body.text.trim() || Buffer.byteLength(body.text) > 48000 ||
        typeof body.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.requestId) ||
        !Number.isInteger(body.timeoutSeconds) || body.timeoutSeconds < 1 || body.timeoutSeconds > 3600) throw new Error();
    reply(202, { ok: true, session: store.send(id, body.requestId, body.text, body.timeoutSeconds * 1000) });
  } catch { reply(400, { ok: false, error: 'Invalid session message' }); }
}
