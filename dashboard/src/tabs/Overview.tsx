import type { Health, Metrics } from '../api';
import StatCard from '../components/StatCard';
import Badge from '../components/Badge';

function uptime(startedAtMs?: number) {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - startedAtMs) / 60000));
  return `${Math.floor(minutes / 1440)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
}
export default function Overview({ health, metrics, updated }: { health: Health | null; metrics: Metrics | null; updated: number | null }) {
  return <>
    <section className="hero panel"><div><p className="eyebrow">YOUR ASSISTANT</p><h2>{health?.agent ?? '—'}<span className="hero-spark" aria-hidden="true">✳</span></h2>
      <p className="muted">A live view of your agent and the commands it handles.</p></div><div className="hero-status"><Badge tone={health?.ok ? 'success' : 'neutral'}>{health?.ok ? 'Connected' : 'Awaiting connection'}</Badge><span className="muted">Process uptime <strong>{uptime(metrics?.startedAtMs)}</strong></span></div></section>
    <section className="stat-grid" aria-label="Command metrics">
      <StatCard label="COMMANDS HANDLED" value={metrics?.commandsTotal ?? '—'} detail="Total since process start" />
      <StatCard label="FAILED COMMANDS" value={metrics?.commandsFailed ?? '—'} detail="Commands that returned an error" />
      <StatCard label="LAST LATENCY" value={metrics?.lastLatencyMs == null ? '—' : <>{Math.round(metrics.lastLatencyMs)}<span className="stat-unit">ms</span></>} detail="Most recent successful command" />
    </section>
    <section className="panel overview-details"><div className="section-heading"><div><h2>At a glance</h2><p className="muted">Live data, directly from your Connector.</p></div><span className="section-symbol" aria-hidden="true">◈</span></div>
      <dl className="detail-list"><div><dt>Agent</dt><dd>{health?.agent ?? '—'}</dd></div><div><dt>Process uptime</dt><dd>{uptime(metrics?.startedAtMs)}</dd></div><div><dt>Last metrics refresh</dt><dd>{updated ? new Date(updated).toLocaleTimeString() : '—'}</dd></div></dl>
    </section>
  </>;
}
