import { randomUUID } from 'node:crypto';

const STARTED_AT_MS = Date.now() - Math.floor(process.uptime() * 1000);

interface RecentCommand {
  id: string;
  ts: number;
  text: string;
  source: 'command' | 'chat';
  ok: boolean;
  latencyMs: number;
}

export class Telemetry {
  private readonly startedAtMs = STARTED_AT_MS;
  private commandsTotal = 0;
  private commandsFailed = 0;
  private lastLatencyMs: number | null = null;
  private lastLatencyAtMs: number | null = null;
  private readonly recent: RecentCommand[] = [];

  record(text: string, source: RecentCommand['source'], ok: boolean, latencyMs: number): void {
    const ts = Date.now();
    this.commandsTotal++;
    if (ok) {
      this.lastLatencyMs = latencyMs;
      this.lastLatencyAtMs = ts;
    } else {
      this.commandsFailed++;
    }
    this.recent.push({ id: randomUUID(), ts, text: text.slice(0, 200), source, ok, latencyMs });
    if (this.recent.length > 20) this.recent.shift();
  }

  get() {
    return {
      ok: true,
      startedAtMs: this.startedAtMs,
      commandsTotal: this.commandsTotal,
      commandsFailed: this.commandsFailed,
      lastLatencyMs: this.lastLatencyMs,
      lastLatencyAtMs: this.lastLatencyAtMs,
      recent: this.recent.map(entry => ({ ...entry })),
    };
  }
}
