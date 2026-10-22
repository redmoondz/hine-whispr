import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../api';
import type { SettingsSnapshot, VoiceSettings } from '../api';
import Switch from '../components/Switch';
import Badge from '../components/Badge';

export default function Voice() {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [draft, setDraft] = useState<VoiceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const data = await api.settings(signal);
      if (signal?.aborted) return;
      setSnapshot(data); setDraft({ ...data.settings.voice }); setConflict(false); setMessage('');
    } catch (error) { if (!signal?.aborted) setMessage(errorMessage(error)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  function update<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setMessage('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !draft || saving) return;
    setSaving(true); setMessage(''); setConflict(false);
    try {
      const saved = await api.save(snapshot.revision, { ...snapshot.settings, voice: draft });
      const next = { ...snapshot, ...saved };
      setSnapshot(next); setDraft({ ...saved.settings.voice });
      try {
        const applied = await api.apply(saved.revision);
        setSnapshot({ ...next, ...applied });
        setMessage('Voice settings saved and applied.');
      } catch (error) { setMessage(`Saved revision ${saved.revision}; apply failed: ${errorMessage(error)}. Reload to check status.`); }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else setMessage(errorMessage(error));
    } finally { setSaving(false); }
  }
  return <section className="panel"><div className="section-heading"><div><h2>Voice preferences</h2><p className="muted">Speech recognition, input, and playback.</p></div><Badge>Voice</Badge></div>
    {loading ? <p className="empty-state" role="status">Loading voice settings…</p> : draft && snapshot ? <form onSubmit={event => void save(event)}>
      <fieldset disabled={saving || loading}><div className="form-grid">
        <label>Speech recognition model<input value={draft.sttModel} onChange={event => update('sttModel', event.target.value)} placeholder="Default model" /><span className="field-hint">Connector STT model identifier</span></label>
        <label>Language<input value={draft.language} onChange={event => update('language', event.target.value)} placeholder="Automatic" /><span className="field-hint">Language code, for example en or fr</span></label>
        <label>Input device<input value={draft.inputDevice} onChange={event => update('inputDevice', event.target.value)} placeholder="System default" /><span className="field-hint">Microphone name or device identifier</span></label>
        <label>Playback rate<input type="number" step="any" required value={draft.playbackRate} onChange={event => update('playbackRate', event.target.valueAsNumber)} /><span className="field-hint">1 is normal speed</span></label>
      </div><div className="switches"><Switch label="Voice activity detection" description="Detect speech with VAD." checked={draft.vadEnabled} onChange={value => update('vadEnabled', value)} />
        <Switch label="Spoken responses" description="Enable text-to-speech playback." checked={draft.ttsEnabled} onChange={value => update('ttsEnabled', value)} /></div></fieldset>
      <div className="form-footer"><span className="muted">Revision {snapshot.revision} <span className="separator">/</span> Applied revision {snapshot.appliedRevision}</span><div className="button-group"><button type="button" className="button secondary" disabled={saving || loading} onClick={() => void load()}>Reload</button><button className="button primary" disabled={saving || loading}>{saving ? 'Saving…' : 'Save settings'}</button></div></div>
    </form> : <div className="empty-state"><p>Voice settings are unavailable.</p><button className="button secondary" onClick={() => void load()}>Retry</button></div>}
    {conflict && <div className="notice" role="status">Conflict — reload to get the latest revision. Your edits have been kept. Reload replaces them with saved settings. <button className="text-button" disabled={saving || loading} onClick={() => void load()}>Reload settings</button></div>}
    {message && <p className="notice" role="status">{message}</p>}
  </section>;
}
