import { execFile } from 'node:child_process';

// Only display public assistant text and tool names, never thinking, tool
// arguments, environment variables, or raw tool results.
export function projectSessionActivity(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !('messages' in value) || !Array.isArray(value.messages)) return [];
  const messages = value.messages;
  const lastUser = messages.findLastIndex(message => message?.role === 'user');
  return messages.slice(lastUser + 1).flatMap(message => {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) return [];
    return message.content.flatMap((block: { type?: string; text?: string; name?: string }) => {
      if (block.type === 'text' && typeof block.text === 'string') return [block.text.slice(0, 8000)];
      if ((block.type === 'toolCall' || block.type === 'tool_use') && typeof block.name === 'string') return [block.name];
      return [];
    });
  }).slice(-40);
}

export function readSessionActivity(executable: string, id: string): Promise<string[] | null> {
  return new Promise(resolve => {
    execFile(executable, ['gateway', 'call', 'chat.history', '--params', JSON.stringify({ sessionKey: `agent:hina:desktop:${id}`, limit: 100 }), '--json', '--timeout', '4000'], {
      encoding: 'utf8', timeout: 6000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    }, (error, stdout) => {
      if (error) { resolve(null); return; }
      try { resolve(projectSessionActivity(JSON.parse(stdout))); } catch { resolve(null); }
    });
  });
}
