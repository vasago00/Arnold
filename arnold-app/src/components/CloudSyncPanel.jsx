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
import { snapshotBeforeOp } from '../core/backup.js';
import {
  getCronometerAuth,
  setCronometerAuth,
  clearCronometerAuth,
  fetchCronometerToday,
  isConfigured as isCronometerConfigured,
} from '../core/cronometer-client.js';
import {
  syncAll as hcSyncAll,
  getSyncStatus as getHcSyncStatus,
} from '../core/hc-sync.js';
import { isNativePlatform } from '../core/hc-bridge.js';
import { storage } from '../core/storage.js';

// Deterministic emoji from the first 4 hex chars of a pair ID.
// Both devices on the same slot show the SAME emoji — a one-glance "are we
// paired to the same relay slot?" check. 12 emojis keeps collisions unlikely
// among the 2-3 devices a typical user pairs.
const SLOT_EMOJIS = ['🐢','🦊','🐙','🐝','🦉','🐬','🦋','🐿','🦄','🐧','🦜','🦆'];
function slotEmoji(pairId) {
  if (!pairId || pairId.length < 4) return '·';
  const idx = parseInt(pairId.slice(0, 4), 16);
  if (Number.isNaN(idx)) return '·';
  return SLOT_EMOJIS[idx % SLOT_EMOJIS.length];
}
function slotFingerprint(pairId) {
  if (!pairId) return '—';
  return `${slotEmoji(pairId)} ${pairId.slice(0, 8)}…`;
}

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
    // Guard: leaving Pair ID + Salt blank auto-generates a fresh slot. That's
    // correct for the FIRST device, but if the user is trying to add a second
    // device they almost certainly meant to paste the existing pair's values.
    // Silent auto-generate is what silently orphaned the web→mobile pairing
    // during the April 2026 recovery. Force an explicit confirm.
    const pairIdTrim = form.pairId.trim();
    const saltTrim = form.salt.trim();
    if (!pairIdTrim && !saltTrim) {
      const proceed = window.confirm(
        '⚠ No Pair ID / Salt entered.\n\n' +
        'This creates a NEW, empty relay slot. Your OTHER devices will NOT see this one — they stay on their existing slot.\n\n' +
        'To JOIN an existing pairing, CANCEL and paste the Pair ID + Salt from your already-paired device\'s "Pair-a-second-device values" section.\n\n' +
        'Create a new slot anyway?'
      );
      if (!proceed) return;
    }
    setBusy('pairing');
    try {
      setPairingConfig({
        endpoint: form.endpoint.trim(),
        token: form.token.trim(),
        pairId: pairIdTrim || undefined,
        salt: saltTrim || undefined,
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
      // First unlock triggers a pull to catch up with remote. The pull CAN
      // overwrite local keys whose remote.t > local.t, so snapshot first.
      try { snapshotBeforeOp('cloud-unlock-pull'); } catch (e) { console.warn('pre-op snapshot failed', e); }
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
    // Same risk as unlock-pull: remote wins per-key where remote.t > local.t.
    try { snapshotBeforeOp('cloud-pull'); } catch (e) { console.warn('pre-op snapshot failed', e); }
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
        {/* Alarming banner: paired-but-locked is a silent failure mode —
            the user thinks they're backed up but no push/pull is running. */}
        <div style={{
          background: '#5c1f1f', border: '1px solid #8a2f2f', color: '#ffd4d4',
          padding: '10px 12px', borderRadius: 6, marginBottom: 12,
          fontSize: 13, fontWeight: 600, lineHeight: 1.4,
        }}>
          ⚠ Cloud sync is NOT running on this device.
          <div style={{ fontWeight: 400, fontSize: 12, marginTop: 4, opacity: 0.85 }}>
            Your data changes are not being pushed to the relay until you unlock with your passphrase.
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 10 }}>
          Paired slot: <code>{slotFingerprint(status.pairId)}</code>
        </div>
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
        {/* Pair slot fingerprint: emoji + 8-char prefix. Compare to your
            other devices — if the emoji matches, you are on the same slot. */}
        <div>Paired slot: <code style={{ fontSize: 14 }}>{slotFingerprint(status.pairId)}</code> <span style={{ opacity: 0.6, fontSize: 11 }}>(matches other device?)</span></div>
        <div>Last pull: {fmtTime(status.lastPull)}</div>
        <div>Remote updated: {fmtTime(status.remoteUpdatedAt)}</div>
        <div>Tracked keys: {status.trackedKeys}</div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <button style={btnStyle} onClick={handlePush} disabled={busy === 'push'}>{busy === 'push' ? 'Pushing…' : 'Push now'}</button>
        <button style={btnStyle} onClick={handlePull} disabled={busy === 'pull'}>{busy === 'pull' ? 'Pulling…' : 'Pull now'}</button>
        <button style={btnSecondary} onClick={handleUnpair}>Unpair</button>
      </div>

      <CronometerAuthSection />

      <HealthConnectStatusSection />

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

// ─── Cronometer Auth Section ────────────────────────────────────────────────
// Drops into the paired+unlocked Cloud Sync card. Credentials land in
// storage('cronometerAuth') — AES-GCM encrypted at rest, and ride along in
// the Cloud Sync blob so every paired device gets them automatically. No
// new crypto required.

function CronometerAuthSection() {
  const existing = getCronometerAuth();
  const [editing, setEditing] = useState(!existing);
  const [form, setForm]       = useState({ user: existing?.user || '', pass: '' });
  const [busy, setBusy]       = useState('');
  const [msg, setMsg]         = useState(null); // { kind: 'ok'|'err', text }

  function handleSave(e) {
    e.preventDefault();
    setMsg(null);
    try {
      // Preserve existing password when user edits only the email
      const pass = form.pass || existing?.pass;
      if (!form.user || !pass) throw new Error('email + password required');
      setCronometerAuth({ user: form.user.trim(), pass });
      setMsg({ kind: 'ok', text: 'Saved. Will sync to other paired devices on next push.' });
      setEditing(false);
      setForm({ user: form.user.trim(), pass: '' }); // clear pass field from DOM
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || String(err) });
    }
  }

  async function handleTest() {
    setBusy('test');
    setMsg(null);
    try {
      const r = await fetchCronometerToday();
      if (r.ok) {
        const cal = r.macros?.calories ?? 0;
        const pro = r.macros?.protein ?? 0;
        setMsg({
          kind: 'ok',
          text: `Fetched ${r.rowCount ?? 0} entries · ${cal} kcal · ${pro.toFixed?.(1) ?? pro}g protein · ${r.cached ? 'cached' : 'fresh'}`,
        });
      } else {
        setMsg({ kind: 'err', text: `Failed: ${r.error}${r.detail ? ' (' + r.detail + ')' : ''}` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: String(err?.message || err) });
    } finally {
      setBusy('');
    }
  }

  function handleClear() {
    if (!confirm('Remove Cronometer credentials from Arnold (on this device and all paired devices)?')) return;
    clearCronometerAuth();
    setForm({ user: '', pass: '' });
    setEditing(true);
    setMsg({ kind: 'ok', text: 'Credentials cleared.' });
  }

  const configured = isCronometerConfigured();
  const sectionStyle = {
    marginTop: 16, padding: 12, border: '1px solid #2a2e38', borderRadius: 8, background: '#0f1218',
  };
  const labelStyle = { display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 4 };
  const inputStyle = {
    width: '100%', padding: '8px 10px', background: '#0b0d12', color: '#e6e8ec',
    border: '1px solid #2a2e38', borderRadius: 6,
    fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13, marginBottom: 8,
  };
  const btn = {
    padding: '6px 12px', background: '#1b6feb', color: 'white', border: 'none',
    borderRadius: 6, cursor: 'pointer', fontSize: 12, marginRight: 6,
  };
  const btnSec = { ...btn, background: '#2a2e38' };
  const btnDanger = { ...btn, background: '#8a2f2f' };

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>🥗 Cronometer sync</h4>
        <span style={{
          fontSize: 11, padding: '2px 8px', borderRadius: 10,
          background: configured ? '#1f3a1f' : '#3a1f1f',
          color: configured ? '#a0e0a0' : '#e0a0a0',
          border: `1px solid ${configured ? '#2f5a2f' : '#5a2f2f'}`,
        }}>
          {configured ? '✓ configured' : existing ? 'needs worker' : 'not set'}
        </span>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10, lineHeight: 1.4 }}>
        Enter your Cronometer email + password once. Arnold pulls today's macros
        through your Cloud Sync Worker (encrypted in transit, never logged). Your
        password is stored inside the encrypted Cloud Sync blob and syncs to every
        paired device.
      </div>

      {editing || !existing ? (
        <form onSubmit={handleSave}>
          <label style={labelStyle}>Cronometer email</label>
          <input
            style={inputStyle}
            type="email"
            autoComplete="off"
            value={form.user}
            onChange={e => setForm(f => ({ ...f, user: e.target.value }))}
            placeholder="you@example.com"
            required
          />
          <label style={labelStyle}>
            Cronometer password {existing && <span style={{ opacity: 0.6 }}>(leave blank to keep current)</span>}
          </label>
          <input
            style={inputStyle}
            type="password"
            autoComplete="new-password"
            value={form.pass}
            onChange={e => setForm(f => ({ ...f, pass: e.target.value }))}
            placeholder={existing ? '••••••••' : 'your Cronometer password'}
          />
          <div>
            <button style={btn} type="submit">Save</button>
            {existing && (
              <button type="button" style={btnSec} onClick={() => { setEditing(false); setForm({ user: existing.user, pass: '' }); setMsg(null); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div style={{ fontSize: 13 }}>
          <div style={{ marginBottom: 8 }}>
            Signed in as <code>{existing.user}</code>
          </div>
          <button style={btn} type="button" onClick={handleTest} disabled={busy === 'test'}>
            {busy === 'test' ? 'Testing…' : 'Test pull'}
          </button>
          <button style={btnSec} type="button" onClick={() => { setEditing(true); setForm({ user: existing.user, pass: '' }); setMsg(null); }}>
            Edit
          </button>
          <button style={btnDanger} type="button" onClick={handleClear}>Clear</button>
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 10, padding: '6px 10px', borderRadius: 6, fontSize: 12,
          background: msg.kind === 'ok' ? '#1f3a1f' : '#3a1f1f',
          color: msg.kind === 'ok' ? '#c8e6c9' : '#ffd4d4',
          border: `1px solid ${msg.kind === 'ok' ? '#2f5a2f' : '#5a2f2f'}`,
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}

// ─── Health Connect Status Section (Phase 4a) ───────────────────────────────
// Shows HC sync state inside the paired+unlocked Cloud Sync card. Reads data
// ride Cloud Sync to paired devices automatically — this card is just a
// control/observability surface for the Android phone that actually captures.
//
// On non-Android platforms the card collapses to an informational hint so
// web/desktop users understand the data is populated by the mobile build.

function HealthConnectStatusSection() {
  const native = isNativePlatform();
  const [status, setStatus] = useState(() => getHcSyncStatus());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }

  // Today's wellness preview from dailyLogs — what syncDailyEnergy wrote.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayRow = (() => {
    try {
      const logs = storage.get('dailyLogs') || [];
      return logs.find(e => e && e.date === todayStr) || null;
    } catch { return null; }
  })();
  const steps = Number(todayRow?.steps) || 0;
  const activeKcal = Number(todayRow?.activeCalories) || 0;
  const totalKcal = Number(todayRow?.totalCalories) || 0;
  const hasData = steps > 0 || totalKcal > 0;

  async function handleSyncNow() {
    setMsg(null);
    // On web, clicking this button has nothing to sync — HC reads run
    // natively on the Android build. Surface a clear explanation rather
    // than calling hcSyncAll() and getting a cryptic "skipped" back.
    if (!native) {
      setMsg({
        kind: 'ok',
        text: 'Health Connect runs on your Android phone. Use "Pull now" at the top of this panel to refresh this device with the latest data your phone has synced.',
      });
      return;
    }
    setBusy(true);
    try {
      const result = await hcSyncAll();
      setStatus(getHcSyncStatus());
      if (result?.permissionDenied) {
        setMsg({ kind: 'err', text: `Health Connect permissions missing: ${(result.denied || []).slice(0, 3).join(', ')}${(result.denied || []).length > 3 ? '…' : ''}` });
      } else if (result?.totalSynced > 0) {
        setMsg({ kind: 'ok', text: `Synced ${result.totalSynced} records.` });
      } else if (result?.skipped) {
        setMsg({ kind: 'err', text: `Skipped: ${result.reason || 'already syncing'}` });
      } else {
        setMsg({ kind: 'ok', text: 'Already up-to-date.' });
      }
    } catch (e) {
      setMsg({ kind: 'err', text: String(e?.message || e) });
    } finally {
      setBusy(false);
    }
  }

  function fmtRel(iso) {
    if (!iso) return '—';
    try {
      const t = new Date(iso).getTime();
      const diffMs = Date.now() - t;
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    } catch { return '—'; }
  }

  const streams = [
    { key: 'dailyEnergy', label: 'Daily energy' },
    { key: 'sleep',       label: 'Sleep' },
    { key: 'heartRate',   label: 'Heart rate' },
    { key: 'weight',      label: 'Weight' },
    // Nutrition intentionally not synced via HC — Cronometer live pull is
    // the authoritative source. Listed here with a "disabled" marker so the
    // panel makes the choice visible rather than silently hidden.
    { key: 'nutrition',   label: 'Nutrition', disabled: true, disabledReason: 'via Cronometer' },
  ];

  return (
    <div style={{ marginTop: 16, padding: 12, border: '1px solid #2a2f3a', borderRadius: 8, background: '#12151c' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Health Connect</div>
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 6,
          background: native ? '#1f3a1f' : '#3a2f1f',
          color: native ? '#c8e6c9' : '#ffe0a6',
          border: `1px solid ${native ? '#2f5a2f' : '#5a4a2f'}`,
        }}>
          {native ? 'Android · live' : 'Web · via Cloud Sync'}
        </span>
      </div>

      {!native && (
        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
          Movement data is captured on your Android phone and arrives here via Cloud Sync.
        </div>
      )}

      {/* Today preview */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <div style={{ flex: 1, background: '#0b0d12', padding: '8px 6px', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasData ? '#60a5fa' : '#666' }}>{hasData ? steps.toLocaleString() : '—'}</div>
          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2 }}>steps today</div>
        </div>
        <div style={{ flex: 1, background: '#0b0d12', padding: '8px 6px', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasData ? '#fbbf24' : '#666' }}>{hasData ? Math.round(activeKcal) : '—'}</div>
          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2 }}>active kcal</div>
        </div>
        <div style={{ flex: 1, background: '#0b0d12', padding: '8px 6px', borderRadius: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasData ? '#4ade80' : '#666' }}>{hasData ? Math.round(totalKcal) : '—'}</div>
          <div style={{ fontSize: 9, opacity: 0.6, marginTop: 2 }}>total kcal</div>
        </div>
      </div>

      {/* Per-stream last sync */}
      <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 8 }}>
        {streams.map(s => (
          <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span style={{ opacity: s.disabled ? 0.5 : 1 }}>{s.label}</span>
            <span style={{ opacity: 0.6, fontStyle: s.disabled ? 'italic' : 'normal' }}>
              {s.disabled ? (s.disabledReason || 'disabled') : fmtRel(status?.lastSync?.[s.key])}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={handleSyncNow}
        disabled={busy}
        title={native ? 'Pull fresh data from Health Connect on this device' : 'Health Connect reads run on the Android build — use Pull now above to refresh this device with data synced from your phone'}
        style={{
          width: '100%', padding: '8px 10px', borderRadius: 6, fontSize: 12,
          background: busy ? '#2a2a2a' : (native ? '#1f2a3a' : '#2a2a2a'),
          color: native ? '#e0e8f0' : '#9aa0a6',
          border: `1px solid ${native ? '#2f4a6f' : '#3a3a3a'}`,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Syncing…' : (native ? 'Sync now' : 'Sync now (Android only — tap for info)')}
      </button>

      {msg && (
        <div style={{
          marginTop: 10, padding: '6px 10px', borderRadius: 6, fontSize: 12,
          background: msg.kind === 'ok' ? '#1f3a1f' : '#3a1f1f',
          color: msg.kind === 'ok' ? '#c8e6c9' : '#ffd4d4',
          border: `1px solid ${msg.kind === 'ok' ? '#2f5a2f' : '#5a2f2f'}`,
        }}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
