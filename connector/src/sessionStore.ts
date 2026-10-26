import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

export interface SessionTurn {
  id: string;
  text: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'unknown';
  startedAt: number;
  timeoutMs: number;
  reply?: string;
}
export interface AssistantSession {
  id: string;
  title: string;
  closed: boolean;
  updatedAt: number;
  messages: SessionTurn[];
  activity: string[];
  progressAvailable: boolean;
}
export type SessionAgent = (text: string, sessionId: string, timeoutMs: number) => Promise<string>;

export class SessionStore {
  private sessions = new Map<string, AssistantSession>();
  private active = new Set<string>();
  constructor(private path: string, private agent: SessionAgent) {
    if (existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8')) as AssistantSession[];
      for (const session of saved) {
        // Never replay potentially destructive actions after a Connector restart.
        for (const turn of session.messages) {
          if (turn.status === 'running' || turn.status === 'queued') turn.status = 'unknown';
        }
        this.sessions.set(session.id, session);
      }
      this.persist();
    }
  }
  private persist() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify([...this.sessions.values()]), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
  list() { return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt); }
  get(id: string) { return this.sessions.get(id); }
  archive(id: string) {
    const session = this.get(id);
    if (session) { session.closed = true; this.persist(); }
    return session;
  }
  updateActivity(id: string, activity: string[] | null) {
    const session = this.get(id);
    if (!session) return;
    session.progressAvailable = activity !== null;
    if (activity !== null) session.activity = activity;
    this.persist();
  }
  send(id: string, requestId: string, text: string, timeoutMs: number) {
    let session = this.get(id);
    if (!session) {
      session = { id, title: text.slice(0, 70), closed: false, updatedAt: Date.now(), messages: [], activity: [], progressAvailable: false };
      this.sessions.set(id, session);
    }
    if (session.messages.some(turn => turn.id === requestId)) return session;
    session.messages.push({ id: requestId, text, status: 'queued', timeoutMs, startedAt: Date.now() });
    session.updatedAt = Date.now();
    this.persist();
    void this.drain(id);
    return session;
  }
  private async drain(id: string) {
    if (this.active.has(id) || this.active.size >= 4) return;
    const session = this.get(id)!;
    this.active.add(id);
    try {
      for (const turn of session.messages) {
        if (turn.status !== 'queued') continue;
        turn.status = 'running';
        session.activity = [];
        session.progressAvailable = false;
        this.persist();
        try {
          turn.reply = await this.agent(turn.text, id, turn.timeoutMs);
          turn.status = 'completed';
        } catch {
          turn.status = 'failed';
        }
        session.updatedAt = Date.now();
        this.persist();
      }
    } finally {
      this.active.delete(id);
      for (const pending of this.sessions.values()) {
        if (pending.messages.some(turn => turn.status === 'queued')) void this.drain(pending.id);
      }
    }
  }
}
