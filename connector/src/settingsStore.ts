export interface Settings {
  voice: {
    sttModel: string;
    language: string;
    inputDevice: string;
    vadEnabled: boolean;
    ttsEnabled: boolean;
    playbackRate: number;
  };
  agent: { model: string; confirmActions: boolean };
  hands: { browserControl: boolean; confirmMode: boolean };
}

// These defaults also define the supported groups, leaf keys, and leaf types.
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  voice: Object.freeze({
    sttModel: '', language: '', inputDevice: '',
    vadEnabled: false, ttsEnabled: false, playbackRate: 1,
  }),
  agent: Object.freeze({ model: '', confirmActions: true }),
  hands: Object.freeze({ browserControl: false, confirmMode: true }),
});

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(input: Record<string, unknown>): string[] {
  const details: string[] = [];
  for (const [group, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, group)) {
      details.push(`Unknown settings group: ${group}`);
      continue;
    }
    if (!isObject(value)) {
      details.push(`${group} must be an object`);
      continue;
    }
    const defaults = DEFAULT_SETTINGS[group as keyof Settings];
    for (const [key, leaf] of Object.entries(value)) {
      if (!Object.hasOwn(defaults, key)) {
        details.push(`Unknown settings field: ${group}.${key}`);
      } else {
        const expected = typeof defaults[key as keyof typeof defaults];
        if (typeof leaf !== expected || (typeof leaf === 'number' && !Number.isFinite(leaf))) {
          details.push(`${group}.${key} must be a ${expected}`);
        }
      }
    }
  }
  return details;
}

export class SettingsStore {
  private revision = 1;
  private appliedRevision = 1;
  private readonly snapshots = new Map<number, Settings>([[1, structuredClone(DEFAULT_SETTINGS)]]);

  private snapshot(revision: number): Settings {
    return structuredClone(this.snapshots.get(revision)!);
  }

  get() {
    return {
      schemaVersion: 1,
      revision: this.revision,
      settings: this.snapshot(this.revision),
      appliedRevision: this.appliedRevision,
      appliedSettings: this.snapshot(this.appliedRevision),
    };
  }

  put(baseRevision: number, input: Record<string, unknown>) {
    if (baseRevision !== this.revision) {
      return { status: 409, body: { ok: false, error: 'CONFLICT', revision: this.revision, settings: this.snapshot(this.revision) } };
    }
    const details = validate(input);
    if (details.length) return { status: 400, body: { ok: false, error: 'VALIDATION', details } };
    // Each PUT is a new configuration over the defaults, not a patch of saved state.
    const settings = structuredClone(DEFAULT_SETTINGS);
    for (const [group, value] of Object.entries(input)) {
      Object.assign(settings[group as keyof Settings], value);
    }
    this.snapshots.set(++this.revision, settings);
    return { status: 200, body: { revision: this.revision, settings: this.snapshot(this.revision) } };
  }

  applied(revision: unknown) {
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) ||
        revision > this.revision || !this.snapshots.has(revision)) {
      return { status: 400, body: { ok: false, error: 'INVALID' } };
    }
    this.appliedRevision = revision;
    return { status: 200, body: { appliedRevision: revision, appliedSettings: this.snapshot(revision) } };
  }
}
