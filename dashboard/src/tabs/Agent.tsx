import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, errorMessage } from '../api';
import type { Metrics } from '../api';
import Badge from '../components/Badge';

export default function Agent({ metrics }: { metrics: Metrics | null }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setError(''); setReply('');
    try { setReply((await api.command(text.trim())).reply); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <><section className="panel"><div className="section-heading"><div><h2>Test command</h2><p className="muted">Send a message and see Hina's reply.</p></div><span className="section-symbol" aria-hidden="true">⌘</span></div>
    <form onSubmit={event => void send(event)}><label htmlFor="command">Message</label><div className="command-row"><input id="command" value={text} onChange={event => setText(event.target.value)} placeholder="Ask Hina something…" disabled={busy} required /><button className="button primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send command'}</button></div></form>
    <div aria-live="polite">{reply && <div className="reply"><p className="eyebrow">HINA'S REPLY</p><p>{reply}</p></div>}{error && <p className="notice">{error}</p>}</div>
  </section><section className="panel history-panel"><div className="section-heading"><div><h2>Recent activity</h2><p className="muted">Latest commands handled by the Connector.</p></div><span className="muted">{metrics?.recent?.length ?? '—'} entries</span></div>
    {metrics?.recent?.length ? <ul className="history">{[...metrics.recent].reverse().map(entry => <li key={entry.id}><div className="history-main"><p>{entry.text}</p><div className="history-meta"><span>{entry.source}</span><span>{entry.latencyMs == null ? '—' : `${Math.round(entry.latencyMs)} ms`}</span><time dateTime={new Date(entry.ts).toISOString()}>{new Date(entry.ts).toLocaleString()}</time></div></div><Badge tone={entry.ok ? 'success' : 'danger'}>{entry.ok ? 'Success' : 'Failed'}</Badge></li>)}</ul> : <p className="empty-state">{metrics ? 'No commands yet. Send a test command to get started.' : 'Activity is unavailable until metrics connect.'}</p>}
  </section></>;
}
