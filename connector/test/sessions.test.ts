import { expect, test } from 'vitest';
import { SessionStore } from '../src/sessionStore.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const path = () => join(mkdtempSync(join(tmpdir(), 'hina-sessions-test-')), 'sessions.json');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));

test('follow-ups queue on the same session, and retries do not execute twice', async () => {
  const calls: string[] = [];
  let finish!: (value: string) => void;
  const store = new SessionStore(path(), async (text, id) => {
    calls.push(`${id}:${text}`);
    return text === 'first' ? new Promise<string>(resolve => { finish = resolve; }) : 'second answer';
  });
  store.send('session-1', 'request-1', 'first', 300000);
  store.send('session-1', 'request-1', 'first', 300000);
  store.send('session-1', 'request-2', 'second', 300000);
  expect(calls).toEqual(['session-1:first']);
  finish('first answer');
  await tick();
  expect(calls).toEqual(['session-1:first', 'session-1:second']);
  expect(store.get('session-1')?.messages.map(message => message.status)).toEqual(['completed', 'completed']);
});

test('closing archives without cancelling work; another session is independent', async () => {
  let finish!: (value: string) => void;
  const filename = path();
  const store = new SessionStore(filename, async () => new Promise<string>(resolve => { finish = resolve; }));
  store.send('session-1', 'request-1', 'install editor', 300000);
  store.archive('session-1');
  expect(store.get('session-1')?.closed).toBe(true);
  expect(store.get('session-1')?.messages[0]?.status).toBe('running');
  finish('installed');
  await tick();
  const restored = new SessionStore(filename, async () => { throw new Error('must not replay'); });
  expect(restored.get('session-1')?.messages[0]?.reply).toBe('installed');
});

test('restart marks unfinished work unknown and never repeats external actions', () => {
  const filename = path();
  const store = new SessionStore(filename, async () => new Promise<string>(() => {}));
  store.send('session-1', 'request-1', 'install editor', 300000);
  const restored = new SessionStore(filename, async () => { throw new Error('must not replay'); });
  expect(restored.get('session-1')?.messages[0]?.status).toBe('unknown');
});

test('errors preserve history and allow later messages', async () => {
  const store = new SessionStore(path(), async () => { throw new Error('private error'); });
  store.send('session-1', 'request-1', 'hello', 300000);
  await tick();
  expect(store.get('session-1')?.messages[0]?.status).toBe('failed');
  expect(JSON.stringify(store.list())).not.toContain('private error');
});

test('bounds concurrent conversations and starts a queued session when a slot opens', async () => {
  const started: string[] = [];
  const finish: (() => void)[] = [];
  const store = new SessionStore(path(), async (_text, id) => {
    started.push(id);
    return new Promise<string>(resolve => finish.push(() => resolve('done')));
  });
  for (let index = 0; index < 5; index++) store.send(`session-${index}`, 'request', 'hello', 300000);
  expect(started).toHaveLength(4);
  expect(store.get('session-4')?.messages[0]?.status).toBe('queued');
  finish[0]!();
  await tick();
  expect(started).toHaveLength(5);
  for (const complete of finish) complete();
  await tick();
});
