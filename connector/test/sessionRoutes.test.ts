import { expect, test } from 'vitest';
import { SessionStore } from '../src/sessionStore.ts';
import { sessionRoute } from '../src/sessionRoutes.ts';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('accepted task survives response disconnect, archives and retains final result', async () => {
  let finish!: (text: string) => void;
  const ids: string[] = [];
  const store = new SessionStore(join(mkdtempSync(join(tmpdir(), 'hina-route-')), 'sessions.json'), async (_text, id) => {
    ids.push(id);
    return new Promise<string>(resolve => { finish = resolve; });
  });
  const server = createServer((request, response) => { void sessionRoute(request, response, store); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const submit = () => fetch(`${base}/sessions/one/messages`, { method: 'POST', body: JSON.stringify({ requestId: 'request-one', text: 'install', timeoutSeconds: 30 }) });
    expect((await submit()).status).toBe(202);
    expect((await submit()).status).toBe(202);
    await fetch(`${base}/sessions/one/close`, { method: 'POST' });
    expect(store.get('one')?.messages[0]?.status).toBe('running');
    finish('done');
    await new Promise(resolve => setTimeout(resolve, 10));
    const response = await (await fetch(`${base}/sessions`)).json();
    expect(response.sessions[0].messages[0].reply).toBe('done');
    expect(response.sessions[0].closed).toBe(true);
    expect(ids).toEqual(['one']);
    expect((await fetch(`${base}/sessions/one/messages`, { method: 'POST', body: JSON.stringify({ text: 'bad' }) })).status).toBe(400);
    expect((await fetch(`${base}/sessions/../bad`)).status).toBe(404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
