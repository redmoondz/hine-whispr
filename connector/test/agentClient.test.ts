import { readFile, stat, access } from 'node:fs/promises';
import { vi, expect, it, beforeEach } from 'vitest';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
import { AgentError, parseReply, runAgent } from '../src/agentClient.ts';

beforeEach(() => vi.resetAllMocks());

it('joins text payloads from the verified envelope', () => {
  expect(parseReply(JSON.stringify({ ok: true, result: { payloads: [
    { text: 'Hello', mediaUrl: null }, { mediaUrl: 'image' }, { text: 'world' },
  ] } }))).toBe('Hello\nworld');
});

it.each(['invalid', '{}', '{"ok":false}', '{"result":{}}',
  '{"result":{"payloads":[]}}', '{"result":{"payloads":[{"text":" "}]}}',
  '{"ok":false,"result":{"payloads":[{"text":"private"}]}}',
  '{"result":{"payloads":[null,42]}}',
])('rejects malformed or empty replies safely: %s', (stdout) => {
  expect(() => parseReply(stdout)).toThrow(AgentError);
  expect(() => parseReply(stdout)).not.toThrow('private');
});

it('passes a private message file to the existing agent and cleans up', async () => {
  let messagePath = '';
  execFile.mockImplementation((_bin, args, options, callback) => {
    messagePath = args[4];
    void (async () => {
      expect(args).toEqual(['agent', '--agent', 'hina', '--message-file', messagePath, '--json']);
      expect(await readFile(messagePath, 'utf8')).toBe('literal $(text)\nmessage');
      expect((await stat(messagePath)).mode & 0o777).toBe(0o600);
      expect(options.shell).toBe(false);
      expect(options.timeout).toBe(1234);
      callback(null, '{"ok":true,"result":{"payloads":[{"text":"OK"}]}}', '');
    })().catch(callback);
  });
  expect(await runAgent('literal $(text)\nmessage', { timeoutMs: 1234, executable: 'openclaw' })).toBe('OK');
  await expect(access(messagePath)).rejects.toThrow();
});

it.each([new Error('private stderr'), Object.assign(new Error('private'), { killed: true })])(
  'sanitizes CLI errors and removes message files', async (error) => {
    let messagePath = '';
    execFile.mockImplementation((_bin, args, _options, callback) => {
      messagePath = args[4];
      callback(error, 'private stdout', 'private stderr');
    });
    await expect(runAgent('secret', { timeoutMs: 10, executable: 'openclaw' })).rejects.toBeInstanceOf(AgentError);
    await expect(access(messagePath)).rejects.toThrow();
  },
);
