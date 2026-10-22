import { tmpdir } from 'node:os';
import { afterEach } from 'vitest';
import { AnalyticsStore } from '../src/analyticsStore.ts';
import type { Config } from '../src/config.ts';
import { createConnectorServer } from '../src/server.ts';

const stores: AnalyticsStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

// Existing route tests use isolated in-memory analytics instead of writing production data.
export function createTestConnectorServer(config: Omit<Config, 'dataDir'>, agent: (text: string) => Promise<string>) {
  const analytics = new AnalyticsStore(':memory:');
  stores.push(analytics);
  return createConnectorServer({ ...config, dataDir: tmpdir() }, agent, analytics);
}
