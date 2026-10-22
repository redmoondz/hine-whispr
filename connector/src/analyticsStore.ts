import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface AnalyticsRecord {
  ts: number;
  source: 'command' | 'chat';
  ok: boolean;
  latencyMs: number;
}

export class AnalyticsStore {
  private database: DatabaseSync | undefined;
  private closed = false;
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  private db(): DatabaseSync {
    if (this.closed) throw new Error('Analytics store is closed');
    if (!this.database) {
      const database = new DatabaseSync(this.path);
      try {
        database.exec(`CREATE TABLE IF NOT EXISTS commands (
          id TEXT PRIMARY KEY,
          ts INTEGER NOT NULL,
          day TEXT NOT NULL,
          source TEXT NOT NULL,
          ok INTEGER NOT NULL,
          latency_ms REAL NOT NULL
        )`);
      } catch (error) {
        database.close();
        throw error;
      }
      this.database = database;
    }
    return this.database;
  }

  record({ ts, source, ok, latencyMs }: AnalyticsRecord): void {
    this.db().prepare('INSERT INTO commands (id, ts, day, source, ok, latency_ms) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), ts, new Date(ts).toISOString().slice(0, 10), source, Number(ok), latencyMs);
  }

  requestsByDay(sinceDay?: string, untilDay?: string) {
    return this.db().prepare(`SELECT day, COUNT(*) AS total, SUM(1 - ok) AS failed
      FROM commands WHERE (? IS NULL OR day >= ?) AND (? IS NULL OR day <= ?)
      GROUP BY day ORDER BY day ASC`)
      .all(sinceDay ?? null, sinceDay ?? null, untilDay ?? null, untilDay ?? null)
      .map(row => ({ day: String(row.day), total: Number(row.total), failed: Number(row.failed) }));
  }

  latencyStats(): { avgMs: number | null; p50Ms: number | null; p90Ms: number | null; maxMs: number | null } {
    const db = this.db();
    const stats = db.prepare('SELECT COUNT(*) AS total, AVG(latency_ms) AS avg, MAX(latency_ms) AS max FROM commands').get()!;
    const total = Number(stats.total);
    if (total < 2) return { avgMs: null, p50Ms: null, p90Ms: null, maxMs: null };
    // Nearest-rank discrete percentiles include both successful and failed calls.
    const percentile = db.prepare('SELECT latency_ms FROM commands ORDER BY latency_ms LIMIT 1 OFFSET ?');
    return {
      avgMs: Number(stats.avg),
      p50Ms: Number(percentile.get(Math.ceil(total * 0.5) - 1)!.latency_ms),
      p90Ms: Number(percentile.get(Math.ceil(total * 0.9) - 1)!.latency_ms),
      maxMs: Number(stats.max),
    };
  }

  total(): number {
    return Number(this.db().prepare('SELECT COUNT(*) AS total FROM commands').get()!.total);
  }

  failed(): number {
    return Number(this.db().prepare('SELECT COUNT(*) AS total FROM commands WHERE ok = 0').get()!.total);
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.closed = true;
  }
}
