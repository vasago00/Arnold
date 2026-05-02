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

import React, { useEffect, useState } from 'react';
import {
  getPairingConfig,
  setPairingConfig,
  clearPairingConfig,
  setPassphrase,
  hasPassphrase,
  push,
  pull,
  forcePull,
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
  getGarminAuth,
  setGarminAuth,
  clearGarminAuth,
  fetchGarminToday,
  isGarminConfigured,
  getGarminWellnessMeta,
  backfillRecentBlanks,
} from '../core/garmin-client.js';
import { syncRecentActivities, enrichRecentActivitiesWithDetails } from '../core/garmin-activities-client.js';
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

// Small row for displaying a sensitive pairing value with a Copy button.
// Bypasses the swipe-nav touchstart handler that was eating long-press
// selection on the phone.
function PairValueRow({ label, value }) {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value || '');
      } else {
        // Fallback for older WebViews without async clipboard
        const ta = document.createElement('textarea');
        ta.value = value || ''; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn('copy failed', err);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span style={{ flexShrink: 0, opacity: 0.8 }}>{label}:</span>
      <code
        style={{
          flex: 1,
          minWidth: 0,
          wordBreak: 'break-all',
          userSelect: 'all',
          WebkitUserSelect: 'all',
          fontSize: 11,
        }}
      >
        {value || '—'}
      </code>
      <button
        onClick={onCopy}
        style={{
          flexShrink: 0,
          padding: '3px 8px',
          fontSize: 11,
          borderRadius: 4,
          border: '1px solid rgba(255,255,255,0.15)',
          background: copied ? 'rgba(107,207,154,0.18)' : 'rgba(255,255,255,0.06)',
          color: copied ? '#6BCF9A' : '#e2e8f0',
          cursor: 'pointer',
        }}
      >
        {copied ? '✓ copied' : 'Copy'}
      </button>
    </div>
  );
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

  async function handleForcePull() {
    if (!confirm(
      'FORCE PULL — overwrite local data with remote\n\n' +
      'This bypasses the normal "newest wins" merge. Whatever is in the cloud ' +
      'becomes the truth on this device for every collection. Use this when ' +
      'devices have drifted (e.g., a bad migration on this device, or your phone ' +
      'has stale local state that\'s blocking remote updates).\n\n' +
      'Local-only changes that haven\'t been pushed will be LOST.\n\n' +
      'A backup snapshot is created automatically before the overwrite. Continue?'
    )) return;
    setBusy('forcepull');
    try { snapshotBeforeOp('cloud-force-pull'); } catch (e) { console.warn('pre-op snapshot failed', e); }
    try {
      const r = await forcePull();
      if (r?.ok) {
        showToast?.(`Force pulled · applied ${r.applied} keys · ${(r.bytes / 1024).toFixed(1)} KB`);
      } else if (r?.empty) {
        showToast?.('Cloud has no data');
      } else if (r?.error) {
        showToast?.(`Force pull failed: ${r.error}`);
      }
    } finally {
      setBusy('');
      setStatus(getSyncStatus());
    }
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
        <button
          style={{
            ...btnSecondary,
            color: '#fbbf24',
            borderColor: '#fbbf24',
          }}
          onClick={handleForcePull}
          disabled={busy === 'forcepull'}
          title="Bypass LWW — overwrite local data with whatever's in the cloud. Use when this device has drifted from remote (bad migration, stale state, etc).">
          {busy === 'forcepull' ? 'Force pulling…' : '⚠ Force pull'}
        </button>
        <button style={btnSecondary} onClick={handleUnpair}>Unpair</button>
      </div>

      <CronometerAuthSection />
      <GarminAuthSection />

      <HealthConnectStatusSection />

      <details style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
        <summary>Pair-a-second-device values (copy these to your other device)</summary>
        {/* Mobile note: long-press text-selection on the values below conflicts
            with the global swipe-nav handler in Arnold.jsx (which captures every
            touchstart on <main>). Explicit Copy buttons sidestep the gesture
            collision entirely — and userSelect:'all' single-tap-selects the
            value on devices where long-press still works. */}
        <div style={{ marginTop: 8, padding: 8, background: '#0b0d12', borderRadius: 6 }}>
          <PairValueRow label="Pair ID" value={status.pairId} />
          <PairValueRow label="Salt" value={status.salt} />
          <PairValueRow label="Endpoint" value={status.endpoint} />
          <div style={{ marginTop: 6, opacity: 0.7 }}>Bearer token and passphrase are not displayed for security — use the same ones from your other device.</div>
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

// ─── Garmin Wellness Section (Phase 4c) ─────────────────────────────────────
// Same pattern as Cronometer auth: email + password stored in encrypted blob,
// pulled by the Cloud Sync Worker via /garmin/all. Unlocks the values Health
// Connect doesn't expose: composite Sleep Score, Body Battery, Stress,
// Training Readiness, daily summary.

function GarminAuthSection() {
  const existing = getGarminAuth();
  const [editing, setEditing] = useState(!existing);
  const [form, setForm]       = useState({ user: existing?.user || '', pass: '' });
  const [busy, setBusy]       = useState('');
  const [msg, setMsg]         = useState(null); // { kind: 'ok'|'err', text }
  const [meta, setMeta]       = useState(() => getGarminWellnessMeta());

  // Manual VO2Max override — Garmin's API doesn't reliably expose VO2Max
  // for all accounts (we tried 5 endpoints; activity DTOs may also miss it).
  // This input lets the user type the value their watch shows. Persists to
  // profile.watchVO2Max and is read with highest priority by the Start panel.
  const [vo2State, setVo2State] = useState(() => {
    try {
      const profile = storage.get('profile') || {};
      return {
        value: profile.watchVO2Max != null ? String(profile.watchVO2Max) : '',
        savedAt: profile.watchVO2MaxAt || null,
      };
    } catch { return { value: '', savedAt: null }; }
  });
  function saveVO2() {
    const num = parseFloat(vo2State.value);
    if (!Number.isFinite(num) || num < 15 || num > 95) {
      setMsg({ kind: 'err', text: 'Enter a VO₂Max value between 15 and 95 ml/kg/min' });
      return;
    }
    const profile = storage.get('profile') || {};
    const ts = Date.now();
    storage.set('profile', { ...profile, watchVO2Max: num, watchVO2MaxAt: ts }, { skipValidation: true });
    setVo2State({ value: String(num), savedAt: ts });
    setMsg({ kind: 'ok', text: `Saved Watch VO₂Max = ${num} ml/kg/min` });
  }

  function refreshMeta() { setMeta(getGarminWellnessMeta()); }

  function handleSave(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const pass = form.pass || existing?.pass;
      if (!form.user || !pass) throw new Error('email + password required');
      setGarminAuth({ user: form.user.trim(), pass });
      setMsg({ kind: 'ok', text: 'Saved. Will sync to other paired devices on next push.' });
      setEditing(false);
      setForm({ user: form.user.trim(), pass: '' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || String(err) });
    }
  }

  async function handleTest() {
    setBusy('test');
    setMsg(null);
    try {
      const r = await fetchGarminToday();
      if (r.ok) {
        const score = r.sleep?.sleepScore;
        const bb = r.bb?.bbCharged;
        const tr = r.readiness?.trainingReadiness;
        const parts = [];
        if (score != null) parts.push(`Sleep ${score}`);
        if (bb != null)    parts.push(`BB +${bb}`);
        if (tr != null)    parts.push(`Readiness ${tr}`);
        parts.push(r.cached ? 'cached' : 'fresh');
        setMsg({ kind: 'ok', text: `✓ ${parts.join(' · ')}` });
        refreshMeta();
      } else {
        setMsg({ kind: 'err', text: `Failed: ${r.error}${r.detail ? ' (' + r.detail + ')' : ''}` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: String(err?.message || err) });
    } finally {
      setBusy('');
    }
  }

  async function handleBackfill(force = false) {
    setBusy(force ? 'force' : 'backfill');
    setMsg(null);
    try {
      const r = await backfillRecentBlanks({ daysBack: 14, force });
      if (!r.ok) {
        setMsg({ kind: 'err', text: `Failed: ${r.error}` });
        return;
      }
      const filledSleep = r.results.filter(x => x.ok && x.sleepScore != null).length;
      const filledBB    = r.results.filter(x => x.ok && x.bodyBatteryStart != null).length;
      const filledTR    = r.results.filter(x => x.ok && x.trainingReadiness != null).length;
      setMsg({
        kind: 'ok',
        text: `Backfill: ${r.attempted} attempted · ${filledSleep} sleep · ${filledBB} body battery · ${filledTR} readiness. Reload the page to see new tiles in Goals.`,
      });
      refreshMeta();
    } catch (err) {
      setMsg({ kind: 'err', text: String(err?.message || err) });
    } finally {
      setBusy('');
    }
  }

  async function handleEnrichActivities() {
    setBusy('enrich');
    setMsg(null);
    try {
      const r = await enrichRecentActivitiesWithDetails({ daysBack: 30, force: false });
      if (!r.ok) {
        setMsg({ kind: 'err', text: `Enrich failed: ${r.error}` });
        return;
      }
      setMsg({
        kind: 'ok',
        text: `Enriched ${r.enriched} of ${r.attempted} activities with HR zones + EPOC. Reload to see updated tiles.`,
      });
    } catch (err) {
      setMsg({ kind: 'err', text: String(err?.message || err) });
    } finally {
      setBusy('');
    }
  }

  async function handleSyncActivities() {
    setBusy('activities');
    setMsg(null);
    try {
      const r = await syncRecentActivities({ daysBack: 14, limit: 30 });
      if (!r.ok) {
        setMsg({ kind: 'err', text: `Activity sync failed: ${r.error}${r.detail ? ' (' + r.detail + ')' : ''}` });
        return;
      }
      const types = {};
      for (const x of r.results.filter(x => x.ok)) {
        types[x.type] = (types[x.type] || 0) + 1;
      }
      const breakdown = Object.entries(types).map(([t, n]) => `${n} ${t}`).join(', ') || 'none';
      setMsg({
        kind: 'ok',
        text: `Activities: ${r.candidates} found · ${r.skipped} already imported · ${r.successful} new (${breakdown})${r.failed ? ' · ' + r.failed + ' failed' : ''}. Reload to see them.`,
      });
      refreshMeta();
    } catch (err) {
      setMsg({ kind: 'err', text: String(err?.message || err) });
    } finally {
      setBusy('');
    }
  }

  function handleClear() {
    if (!confirm('Remove Garmin credentials from Arnold (on this device and all paired devices)?')) return;
    clearGarminAuth();
    setForm({ user: '', pass: '' });
    setEditing(true);
    setMsg({ kind: 'ok', text: 'Credentials cleared.' });
  }

  const configured = isGarminConfigured();
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

  const lastSyncTxt = meta.lastSyncAt
    ? new Date(meta.lastSyncAt).toLocaleString()
    : 'never';
  const lastScore = meta.lastSleepScore;

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 14 }}>⌚ Garmin Wellness sync</h4>
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
        Pulls Garmin's composite Sleep Score, Body Battery, Stress, and Training
        Readiness — the values Health Connect doesn't expose. Garmin 2FA must be
        OFF for this to work; the Worker bearer token + cloud-sync encryption
        remain the security boundary.
      </div>

      {editing || !existing ? (
        <form onSubmit={handleSave}>
          <label style={labelStyle}>Garmin email</label>
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
            Garmin password {existing && <span style={{ opacity: 0.6 }}>(leave blank to keep current)</span>}
          </label>
          <input
            style={inputStyle}
            type="password"
            autoComplete="new-password"
            value={form.pass}
            onChange={e => setForm(f => ({ ...f, pass: e.target.value }))}
            placeholder={existing ? '••••••••' : 'your Garmin Connect password'}
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
          <div style={{ marginBottom: 6 }}>
            Signed in as <code>{existing.user}</code>
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
            Last sync: {lastSyncTxt}
            {lastScore != null && <> · score {lastScore}</>}
            {meta.lastError && <span style={{ color: '#ffd4d4' }}> · last error: {meta.lastError}</span>}
          </div>
          <button style={btn} type="button" onClick={handleTest} disabled={busy === 'test'}>
            {busy === 'test' ? 'Testing…' : 'Test pull'}
          </button>
          <button style={btnSec} type="button" onClick={() => handleBackfill(false)} disabled={busy === 'backfill' || busy === 'force'}>
            {busy === 'backfill' ? 'Backfilling…' : 'Backfill 14 days'}
          </button>
          <button style={btnSec} type="button" onClick={() => handleBackfill(true)} disabled={busy === 'backfill' || busy === 'force'}
                  title="Re-pull every day in the window even if it appears covered. Use this once after the wellness-collection fix to refill Body Battery / Stress / Readiness on dates the first backfill missed.">
            {busy === 'force' ? 'Force refilling…' : 'Force refill'}
          </button>
          <button style={btnSec} type="button" onClick={handleSyncActivities} disabled={busy === 'activities'}
                  title="Pull recent Run / Strength / etc. activities from Garmin and parse them into Arnold. Skips activities you already imported manually.">
            {busy === 'activities' ? 'Syncing activities…' : 'Sync activities'}
          </button>
          <button style={btnSec} type="button" onClick={handleEnrichActivities} disabled={busy === 'enrich'}
                  title="For each activity in the last 30 days that's missing HR zones or training load, fetch Garmin's server-computed details. Unlocks Z2 Weekly / EPOC / Pace:HR tiles when FIT files don't include zone data.">
            {busy === 'enrich' ? 'Enriching…' : 'Enrich activity data'}
          </button>
          {/* Watch VO2Max manual override — Garmin's API doesn't return vO2MaxValue
              for all accounts (confirmed via 5 endpoints + activity DTO). Until/if
              that changes, the user types the value their watch shows here. */}
          <div style={{
            marginTop: 12, padding: '8px 10px',
            background: 'rgba(96,165,250,0.06)', borderRadius: 6,
            borderWidth: '0.5px', borderStyle: 'solid', borderColor: 'rgba(96,165,250,0.25)',
          }}>
            <div style={{ fontSize: 11, color: '#a0c0e8', marginBottom: 6, fontWeight: 600 }}>
              Watch VO₂Max (manual entry)
            </div>
            <div style={{ fontSize: 10, color: '#8a9bb0', marginBottom: 8, lineHeight: 1.4 }}>
              Garmin's API doesn't expose VO₂Max for this account. Type the number your
              watch shows (Connect → My Day → VO₂Max). Updates whenever you check.
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                step="0.1"
                min="15"
                max="95"
                value={vo2State.value}
                onChange={e => setVo2State(s => ({ ...s, value: e.target.value }))}
                placeholder="46"
                style={{
                  width: 80, padding: '4px 8px',
                  background: '#0b0d12', color: '#e6e8ec',
                  borderWidth: '0.5px', borderStyle: 'solid', borderColor: '#2a2e38',
                  borderRadius: 4, fontSize: 12,
                }}
              />
              <span style={{ fontSize: 10, color: '#8a9bb0' }}>ml/kg/min</span>
              <button onClick={saveVO2} style={{
                padding: '4px 10px', fontSize: 11,
                background: '#60a5fa', color: '#0b0d12', fontWeight: 500,
                borderWidth: '0.5px', borderStyle: 'solid', borderColor: '#60a5fa',
                borderRadius: 4, cursor: 'pointer',
              }}>Save</button>
              {vo2State.savedAt && (
                <span style={{ fontSize: 10, color: '#8a9bb0', marginLeft: 6 }}>
                  Saved {new Date(vo2State.savedAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
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

  // Today's wellness preview from hcDailyEnergy — what syncDailyEnergy wrote.
  // (Moved out of dailyLogs in the Phase 4a bug fix.)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayRow = (() => {
    try {
      const rows = storage.get('hcDailyEnergy') || [];
      return rows.find(r => r && r.date === todayStr) || null;
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
