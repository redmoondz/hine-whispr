import { expect, test } from 'vitest';
import { projectSessionActivity } from '../src/sessionProgress.ts';

test('projects only current-turn public assistant text and tool names', () => {
  expect(projectSessionActivity({ messages: [
    { role: 'assistant', content: [{ type: 'text', text: 'old answer' }] },
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: 'private reasoning' },
      { type: 'text', text: 'Downloading editor' },
      { type: 'toolCall', name: 'exec', arguments: { token: 'secret' } },
    ] },
    { role: 'toolResult', content: [{ type: 'text', text: 'secret output' }] },
  ] })).toEqual(['Downloading editor', 'exec']);
  expect(projectSessionActivity(null)).toEqual([]);
});
