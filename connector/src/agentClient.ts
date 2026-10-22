import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';

export type AgentErrorCode = 'INVALID_REPLY' | 'CLI_FAILED' | 'TIMEOUT';

export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

export function parseReply(stdout: string): string {
  try {
    const envelope = JSON.parse(stdout);
    if (!envelope || envelope.ok === false || !Array.isArray(envelope.result?.payloads)) {
      throw new Error();
    }
    const reply = envelope.result.payloads
      .filter((payload: unknown): payload is { text: string } =>
        typeof payload === 'object' && payload !== null &&
        'text' in payload && typeof payload.text === 'string' && payload.text.trim().length > 0)
      .map((payload: { text: string }) => payload.text)
      .join('\n');
    if (!reply.trim()) throw new Error();
    return reply;
  } catch {
    throw new AgentError('INVALID_REPLY', 'Agent returned an invalid or empty reply');
  }
}

export async function runAgent(text: string, config: Pick<Config, 'timeoutMs' | 'executable'>): Promise<string> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'hina-connector-'));
    const messagePath = join(directory, 'message.txt');
    await writeFile(messagePath, text, { encoding: 'utf8', mode: 0o600 });
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(config.executable, ['agent', '--agent', 'hina', '--message-file', messagePath, '--json', '--timeout', String(Math.ceil(config.timeoutMs / 1000))], {
        encoding: 'utf8',
        shell: false,
        timeout: Math.min(config.timeoutMs + 5000, 2147483647),
        killSignal: 'SIGKILL',
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }, (error, stdout) => {
        if (error) {
          reject(new AgentError(error.killed ? 'TIMEOUT' : 'CLI_FAILED',
            error.killed ? 'Agent request timed out' : 'Agent request failed'));
        } else resolve(stdout);
      });
    });
    return parseReply(stdout);
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('CLI_FAILED', 'Agent request failed');
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
