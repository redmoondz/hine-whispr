export interface Health { ok: boolean; agent?: string }
export interface RecentCommand {
  id: string; ts: number; text: string; source: string; ok: boolean; latencyMs?: number;
}
export interface Metrics {
  startedAtMs?: number;
  commandsTotal?: number;
  commandsFailed?: number;
  lastLatencyMs?: number | null;
  recent?: RecentCommand[];
}
export interface VoiceSettings {
  sttModel: string; language: string; inputDevice: string;
  vadEnabled: boolean; ttsEnabled: boolean; playbackRate: number;
}
export interface Settings {
  voice: VoiceSettings;
  agent: { model: string; confirmActions: boolean };
  hands: { browserControl: boolean; confirmMode: boolean };
}
export interface SettingsSnapshot {
  revision: number; settings: Settings;
  appliedRevision: number; appliedSettings: Settings;
}
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type ApiPath = '/api/health' | '/api/metrics' | '/api/settings' | '/api/settings/applied' | '/api/command';
async function request<T>(path: ApiPath, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data as T;
}
export const api = {
  health: (signal?: AbortSignal) => request<Health>('/api/health', 'GET', undefined, signal),
  metrics: (signal?: AbortSignal) => request<Metrics>('/api/metrics', 'GET', undefined, signal),
  settings: (signal?: AbortSignal) => request<SettingsSnapshot>('/api/settings', 'GET', undefined, signal),
  save: (baseRevision: number, settings: Settings) => request<Pick<SettingsSnapshot, 'revision' | 'settings'>>('/api/settings', 'PUT', { baseRevision, settings }),
  apply: (revision: number) => request<Pick<SettingsSnapshot, 'appliedRevision' | 'appliedSettings'>>('/api/settings/applied', 'POST', { revision }),
  command: (text: string) => request<{ ok: boolean; reply: string }>('/api/command', 'POST', { text }),
};
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Request failed';
