// ─── Cloud Sync Panel ───────────────────────────────────────────────────────
// Pairing UI + status for the Arnold cloud-sync layer. Drop this anywhere in
// the Settings / More tab. It supports three states:
//
//   1. Not paired:   form to enter endpoint + bearer token (+ optional pair id
//                    and salt when adding a second device).
//   2. Paired, locked: prompt for passphrase (required each cold start unless
//                      "remember during session" is checked).
//   3. Paired, unlocked: status + manual Push / Pull buttons, unpair button.
//
// The panel never displays the passphrase or token in plaintext after entry.

import { useEffect, useState } from 'react';
import {
  getPairingConfig,
  setPairingConfig,
  clearPairingConfig,
  setPassphrase,
  hasPassphrase,
  push,
  pull,
  getSyncStatus,
  onCloudSyncEvent,
  selfTest,
} from '../core/cloud-sync.js';

function fmtTime(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
}

function fmtBytes(n) {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function CloudSyncPanel() {
  const [cfg, setCfg] = useState(getPairingConfig());
  const [status, setStatus] = useState(getSyncStatus());
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ endpoint: '', token: '', pairId: '', salt: '' });
  const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    const off = onCloudSyncEvent((evt, payload) => {
      setEvents(es => [{ ts: Date.now(), evt, payload }, ...es].slice(0, 6));
      setStatus(getSyncStatus());
    });
    return off;
  }, []);

  async function handlePair(e) {
    e.preventDefault();
    setBusy('pairing');
    try {
      setPairingConfig({
        endpoint: form.endpoint.trim(),
        token: form.token.trim(),
        pairId: form.pairId.trim() || undefined,
        salt: form.salt.trim() || undefined,
      });
      setCfg(getPairingConfig());
      setStatus(getSyncStatus());
      setForm({ endpoint: '', token: '', pairId: '', salt: '' });
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  }

  async function handleUnlock(e) {
    e.preventDefault();
    setBusy('unlocking');
    try {
      await setPassphrase(pass, { remember });
      setPass('');
      setStatus(getSyncStatus());
      // First unlock triggers a pull to catch up with remote
      await pull();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy('');
    }
  }

  async function handlePush() {
    setBusy('push');
    try { await push(); } finally { setBusy(''); setStatus(getSyncStatus()); }
  }

  async function handlePull() {
    setBusy('pull');
    try { await pull(); } finally { setBusy(''); setStatus(getSyncStatus()); }
  }

  async function handleUnpair() {
    if (!confirm('Unpair this device? Local data stays intact. Remote blob is untouched.')) return;
    clearPairingConfig();
    setCfg(getPairingConfig());
    setStatus(getSyncStatus());
  }

  async function handleSelfTest() {
    setBusy('test');
    try {
      const r = await selfTest();
      alert(r.ok ? `Crypto round-trip OK (${r.bytes} bytes)` : 'Self-test FAILED');
    } finally {
      setBusy('');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const panelStyle = { padding: '16px', border: '1px solid #2a2e38', borderRadius: 8, background: '#141821', color: '#e6e8ec' };
  const labelStyle = { display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 };
  const inputStyle = { width: '100%', padding: '8px 10px', background: '#0b0d12', color: '#e6e8ec', border: '1px solid #2a2e38', borderRadius: 6, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 };
  const btnStyle = { padding: '8px 14px', background: '#1b6feb', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, marginRight: 8 };
  const btnSecondary = { ...btnStyle, background: '#2a2e38' };

  if (!cfg.paired) {
    return (
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Cloud sync — pair this device</h3>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          End-to-end encrypted sync between your desktop and mobile Arnold. The
          relay sees ciphertext only. You'll need your Cloudflare Worker URL,
          bearer token, and a passphrase you can remember.
        </p>
        <form onSubmit={handlePair}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Endpoint URL</label>
            <input style={inputStyle} placeholder="https://arnold-sync.your-sub.workers.dev" value={form.endpoint} onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))} required />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Bearer token</label>
            <input style={inputStyle} type="password" placeholder="paste from `wrangler secret put SYNC_TOKEN`" value={form.token} onChange={e => setForm(f => ({ ...f, token: e.target.value }))} required />
          </div>
          <div style={{ marginBottom: 10 }}>
            <button type="button" style={{ ...btnSecondary, padding: '4px 10px', fontSize: 12 }} onClick={() => setShowAdvanced(s => !s)}>
              {showAdvanced ? '▼' : '▶'} Pairing a second device?
            </button>
          </div>
          {showAdvanced && (
            <div style={{ marginBottom: 10, padding: 10, background: '#0b0d12', borderRadius: 6 }}>
              <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 8px 0' }}>
                Copy these two values from your already-paired device (Cloud Sync panel → status).
                Leave blank on the first device to auto-generate.
              </p>
              <label style={labelStyle}>Pair ID (hex)</label>
              <input style={{ ...inputStyle, marginBottom: 8 }} value={form.pairId} onChange={e => setForm(f => ({ ...f, pairId: e.target.value }))} />
              <label style={labelStyle}>Salt (hex)</label>
              <input style={inputStyle} value={form.salt} onChange={e => setForm(f => ({ ...f, salt: e.target.value }))} />
            </div>
          )}
          <button style={btnStyle} disabled={busy === 'pairing'}>{busy === 'pairing' ? 'Pairing…' : 'Pair device'}</button>
          <button type="button" style={btnSecondary} onClick={handleSelfTest} disabled={busy === 'test'}>Run crypto self-test</button>
        </form>
      </div>
    );
  }

  if (!status.hasPassphrase) {
    return (
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Cloud sync — unlock</h3>
        <p style={{ fontSize: 13, opacity: 0.75 }}>
          This device is paired. Enter your passphrase to derive the encryption key and start syncing.
        </p>
        <form onSubmit={handleUnlock}>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Passphrase</label>
            <input style={inputStyle} type="password" autoFocus value={pass} onChange={e => setPass(e.target.value)} required />
          </div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember during this session
          </label>
          <button style={btnStyle} disabled={busy === 'unlocking'}>{busy === 'unlocking' ? 'Unlocking…' : 'Unlock & pull'}</button>
          <button type="button" style={btnSecondary} onClick={handleUnpair}>Unpair</button>
        </form>
      </div>
    );
  }

  // Paired + unlocked
  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Cloud sync — active</h3>
      <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
        <div>Endpoint: <code>{status.endpoint}</code></div>
        <div>Device ID: <code>{status.deviceId}</code></div>
        <div>Last pull: {fmtTime(status.lastPull)}</div>
        <div>Remote updated: {fmtTime(status.remoteUpdatedAt)}</div>
        <div>Tracked keys: {status.trackedKeys}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <button style={btnStyle} onClick={handlePush} disabled={busy === 'push'}>{busy === 'push' ? 'Pushing…' : 'Push now'}</button>
        <button style={btnStyle} onClick={handlePull} disabled={busy === 'pull'}>{busy === 'pull' ? 'Pulling…' : 'Pull now'}</button>
        <button style={btnSecondary} onClick={handleUnpair}>Unpair</button>
      </div>

      <details style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
        <summary>Pair-a-second-device values (copy these to your other device)</summary>
        <div style={{ marginTop: 8, padding: 8, background: '#0b0d12', borderRadius: 6 }}>
          <div>Pair ID: <code style={{ wordBreak: 'break-all' }}>{status.pairId}</code></div>
          <div>Salt: <code style={{ wordBreak: 'break-all' }}>{status.salt}</code></div>
          <div style={{ marginTop: 6, opacity: 0.7 }}>Use the same bearer token and passphrase.</div>
        </div>
      </details>

      {events.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>Recent events</div>
          <div style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', opacity: 0.85 }}>
            {events.map((e, i) => (
              <div key={i}>
                <span style={{ opacity: 0.6 }}>{new Date(e.ts).toLocaleTimeString()}</span>{' '}
                <span>{e.evt}</span>{' '}
                <span style={{ opacity: 0.6 }}>{e.payload?.bytes ? fmtBytes(e.payload.bytes) : ''}{e.payload?.applied != null ? ` · applied ${e.payload.applied}` : ''}{e.payload?.error ? ` · ${e.payload.error}` : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
