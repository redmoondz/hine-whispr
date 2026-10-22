import { useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import type { Health, Metrics } from './api';
import Badge from './components/Badge';
import Overview from './tabs/Overview';
import Voice from './tabs/Voice';
import Agent from './tabs/Agent';

const tabs = ['Overview', 'Voice', 'Agent'] as const;
export default function App() {
  const [tab, setTab] = useState<typeof tabs[number]>('Overview');
  const [health, setHealth] = useState<Health | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [healthError, setHealthError] = useState('');
  const [metricsError, setMetricsError] = useState('');
  const [updated, setUpdated] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      await Promise.all([
        api.health(controller.signal).then(data => {
          if (!controller.signal.aborted) { setHealth(data); setHealthError(''); }
        }).catch(error => {
          if (!controller.signal.aborted) { setHealth(null); setHealthError(errorMessage(error)); }
        }),
        api.metrics(controller.signal).then(data => {
          if (!controller.signal.aborted) { setMetrics(data); setMetricsError(''); setUpdated(Date.now()); }
        }).catch(error => {
          if (!controller.signal.aborted) { setMetrics(null); setMetricsError(errorMessage(error)); }
        }),
      ]);
      pending = false;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, []);

  const connected = health?.ok === true;
  const error = [healthError && `Health: ${healthError}`, metricsError && `Metrics: ${metricsError}`].filter(Boolean).join(' · ');
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Hina home"><span className="brand-mark">h</span><span>hina<span className="brand-period">.</span></span></a>
      <p className="sidebar-label">WORKSPACE</p>
      <nav aria-label="Dashboard tabs">{tabs.map((name, index) => <button key={name} type="button"
        aria-current={tab === name ? 'page' : undefined} className={`nav-item ${tab === name ? 'active' : ''}`}
        onClick={() => setTab(name)}><span aria-hidden="true" className="nav-icon">{['◫', '≋', '⌘'][index]}</span>{name}</button>)}</nav>
      <div className="sidebar-bottom"><span className="mini-mark">h</span><div>Hina Desktop<p className="muted">Your personal workspace</p></div></div>
    </aside>
    <main>
      <header className="topbar"><span>Workspace <span className="breadcrumb">/</span> <strong>{tab}</strong></span>
        <Badge tone={connected ? 'success' : healthError || health ? 'danger' : 'neutral'}>{connected ? 'Connector online' : healthError || health ? 'Connector unavailable' : 'Connecting'}</Badge></header>
      <div className="page-content"><div className="page-heading"><div><p className="eyebrow">HINA DASHBOARD</p><h1>{tab}</h1>
        <p className="subtitle">{tab === 'Overview' ? 'A little clarity on everything Hina is doing.' : tab === 'Voice' ? 'Make every conversation feel like you.' : 'A direct line to your assistant.'}</p></div>
        {tab !== 'Voice' && <span className="refresh-note">↻ Refreshes every 5s</span>}</div>
        {error && <div className="notice" role="status">{error}. Retrying automatically.</div>}
        {tab === 'Overview' && <Overview health={health} metrics={metrics} updated={updated} />}
        {tab === 'Voice' && <Voice />}
        {tab === 'Agent' && <Agent metrics={metrics} />}
        <footer>Hina Desktop <span>Built for your flow.</span></footer>
      </div>
    </main>
  </div>;
}
