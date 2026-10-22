import { fileURLToPath } from 'node:url';

export interface Config {
  apiToken: string;
  port: number;
  timeoutMs: number;
  executable: string;
  dataDir: string;
}

function integer(value: string | undefined, fallback: number, name: string, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be a positive integer no greater than ${max}`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiToken = env.CONNECTOR_API_TOKEN;
  if (!apiToken?.trim() || /\s/.test(apiToken)) {
    throw new Error('CONNECTOR_API_TOKEN must be a nonempty token without whitespace');
  }
  return {
    apiToken,
    port: integer(env.CONNECTOR_PORT, 3210, 'CONNECTOR_PORT', 65535),
    timeoutMs: integer(env.CONNECTOR_TIMEOUT_MS, 120000, 'CONNECTOR_TIMEOUT_MS', 2147483647),
    executable: env.OPENCLAW_BIN || 'openclaw',
    dataDir: env.CONNECTOR_DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)),
  };
}
