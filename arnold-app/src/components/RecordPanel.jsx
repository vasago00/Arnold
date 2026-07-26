// RecordPanel — the "Data Memory" status card for the System of Record. Shows whether the durable record is
// live, where it writes, how much it holds, and offers the one-time folder grant + a manual snapshot/sync. It's
// a thin face over window.__arnoldRecord (installed by core/record/recordService.js) — all logic lives there.
import { useEffect, useState, useCallback } from 'react';

const card = { background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '14px 16px 12px', minWidth: 0, color: 'var(--text-primary)' };
const T3 = 'var(--text-muted, #8a8f98)';
const T2 = 'var(--text-secondary, #b7bcc4)';
const TEAL = '#5eead4';
const btn = (accent) => ({ fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', background: accent ? 'rgba(94,234,212,0.10)' : 'transparent', color: accent ? TEAL : T2, border: `0.5px solid ${accent ? 'rgba(94,234,212,0.30)' : 'rgba(255,255,255,0.12)'}` });

export default function RecordPanel() {
  const [sum, setSum] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    try { const r = window.__arnoldRecord; if (r && r.summary) setSum(r.summary()); } catch { /* not ready */ }
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]);

  const act = async (fn, label) => {
    setBusy(true); setMsg(null);
    try { const res = await window.__arnoldRecord[fn](); setMsg(typeof res === 'string' ? res : label + ' ✓'); refresh(); }
    catch (e) { setMsg('✗ ' + String((e && e.message) || e)); }
    finally { setBusy(false); }
  };

  const active = sum && sum.active;
  const sinkLabel = !sum ? '…' : sum.sink === 'fsa' ? 'writing to your folder' : sum.sink === 'capacitor' ? 'writing to app storage' : sum.sink === 'memory' ? 'not yet writing to disk' : sum.sink;

  // The categories worth surfacing as a health readout (biggest streams first).
  const topCats = sum ? Object.entries(sum.counts || {}).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: active ? TEAL : '#f0a020', display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', color: TEAL }}>DATA MEMORY</span>
        </div>
        <span style={{ fontSize: 9, color: T3 }}>Durable · inspectable · yours</span>
      </div>
      <div style={{ fontSize: 11, color: T3, marginBottom: 10 }}>
        A permanent, append-only record of everything Arnold learns — {active ? sinkLabel : 'grant a folder to switch it on'}.
      </div>

      {sum && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: T2, marginBottom: 10 }}>
          <span><b style={{ color: 'var(--text-primary)' }}>{sum.rows.toLocaleString()}</b> records</span>
          <span><b style={{ color: 'var(--text-primary)' }}>{sum.categories}</b> streams</span>
          {topCats.map(([k, n]) => <span key={k} style={{ color: T3 }}>{k} <b style={{ color: T2 }}>{n}</b></span>)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
        <button disabled={busy} style={btn(!active)} onClick={() => act('grant', 'folder granted')}>{active ? 'Change folder' : 'Grant folder'}</button>
        <button disabled={busy} style={btn(false)} onClick={() => act('flushNow', 'synced')}>Sync now</button>
        <button disabled={busy} style={btn(false)} onClick={() => act('exportNow', 'exported')}>Download snapshot</button>
        {msg && <span style={{ fontSize: 10.5, color: msg.startsWith('✗') ? '#f87171' : T3, marginLeft: 2 }}>{msg}</span>}
      </div>
    </div>
  );
}
