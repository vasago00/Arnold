// ─── Arnold Cloud Sync ──────────────────────────────────────────────────────
// End-to-end encrypted snapshot sync between Arnold instances (desktop ↔
// mobile) via a dumb relay worker. The worker only stores ciphertext.
//
// Security model:
//   - Encryption key = PBKDF2(passphrase, salt, 600k iterations, SHA-256).
//     Passphrase never leaves the device.
//   - Bearer token gates the relay endpoint (stops randos from reading the
//     blob even though the blob is encrypted).
//   - Salt is per-pairing, stored in pairing config AND embedded in the blob
//     header so a fresh-install device can decrypt with passphrase alone.
//   - IV is per-snapshot (random 12 bytes), embedded in the blob header.
//   - Ciphertext padded to 64 KB buckets so observers can't fingerprint
//     how much you've logged from blob size.
//
// Blob format (bytes):
//   magic (8)  = "ARNOLD\x00\x01"
//   salt  (16) = PBKDF2 salt
//   iv    (12) = AES-GCM nonce
//   ct    (*)  = AES-GCM(plaintext || random-padding)
//
// Snapshot format (plaintext JSON):
//   {
//     schema: 1,
//     writtenAt: <epoch ms>,
//     writtenBy: <deviceId>,
//     keys: { [fullKey]: { v: <value>, t: <epoch ms> } }
//   }
//
// Merge policy:
//   - For each key in remote: if remote.t > local.t → apply remote locally.
//   - Arrays merged by identity field when detectable (date / id),
//     otherwise whole-value LWW.

import { KEYS, storage, onStorageChange, setCloudApplying } from './storage.js';

// ── Constants ───────────────────────────────────────────────────────────────
const MAGIC = new Uint8Array([65, 82, 78, 79, 76, 68, 0, 1]); // "ARNOLD\x00\x01"
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 600_000;
// Push debounce: collapses rapid in-progress edits (slider drags, typing)
// into a single push. 1s is plenty for that while keeping sync feel instant.
const DEBOUNCE_MS = 1_000;
// Foreground pull: how often the phone polls the relay for incoming changes
// while visible. 90s trades a little battery for snappier cross-device feel.
const FOREGROUND_PULL_MS = 90 * 1000;
const PAD_BUCKET_BYTES = 64 * 1024;
const SNAPSHOT_SCHEMA = 1;

// Pairing config lives in localStorage (non-sensitive: no crypto key here).
const CFG_PREFIX = 'arnold:cloud-sync:';
const CFG_ENDPOINT = CFG_PREFIX + 'endpoint';
const CFG_DEVICE_ID = CFG_PREFIX + 'device-id';
const CFG_TOKEN = CFG_PREFIX + 'token';
const CFG_PAIR_ID = CFG_PREFIX + 'pair-id';
const CFG_SALT = CFG_PREFIX + 'salt';
const CFG_VERSIONS = CFG_PREFIX + 'versions';
const CFG_LAST_PULL = CFG_PREFIX + 'last-pull';
const CFG_LAST_REMOTE_ETAG = CFG_PREFIX + 'last-remote-etag';

// Passphrase / key cached in sessionStorage (cleared on tab close).
const SESSION_PASS = CFG_PREFIX + 'pass';
let _derivedKey = null;
let _deviceId = null;
let _pushTimer = null;
let _pullTimer = null;
let _inFlight = null;
const _listeners = new Set();

// ── Helpers ─────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

function emit(evt, payload) {
  for (const fn of _listeners) { try { fn(evt, payload); } catch {} }
}

export function onCloudSyncEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function randomHex(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesToHex(b);
}

// Pad plaintext to the next 64 KB multiple (minus the structured overhead).
// We append a JSON-safe padding field so the padded bytes are still a valid
// snapshot after decryption.
function padSnapshot(snapshot) {
  const base = JSON.stringify(snapshot);
  const target = Math.ceil((base.length + 64) / PAD_BUCKET_BYTES) * PAD_BUCKET_BYTES;
  const padLen = Math.max(0, target - base.length - 16); // leave room for ',"_p":"..."}'
  if (padLen <= 0) return base;
  // Build padding without re-stringifying the whole object.
  const pad = '0'.repeat(padLen);
  const withPad = { ...snapshot, _p: pad };
  return JSON.stringify(withPad);
}

// ── Pairing config ──────────────────────────────────────────────────────────

export function getPairingConfig() {
  const endpoint = localStorage.getItem(CFG_ENDPOINT);
  const token = localStorage.getItem(CFG_TOKEN);
  const deviceId = localStorage.getItem(CFG_DEVICE_ID);
  const pairId = localStorage.getItem(CFG_PAIR_ID);
  const salt = localStorage.getItem(CFG_SALT);
  return {
    endpoint: endpoint || '',
    token: token || '',
    deviceId: deviceId || '',
    pairId: pairId || '',
    salt: salt || '',
    paired: !!(endpoint && token && pairId && salt),
  };
}

/**
 * First-time pairing on a device.
 *   - endpoint:    https://arnold-sync.<sub>.workers.dev
 *   - token:       bearer token from `wrangler secret put SYNC_TOKEN`
 *   - pairId:      shared identifier across devices (auto if omitted on first
 *                  pair; subsequent devices must pass the same value)
 *   - salt:        hex salt (auto on first pair; subsequent devices pass the
 *                  same salt — can be read from an already-paired device's
 *                  pairing config)
 */
export function setPairingConfig({ endpoint, token, pairId, salt }) {
  if (!endpoint || !token) throw new Error('endpoint and token required');
  localStorage.setItem(CFG_ENDPOINT, endpoint.replace(/\/$/, ''));
  localStorage.setItem(CFG_TOKEN, token);
  if (!localStorage.getItem(CFG_DEVICE_ID)) {
    localStorage.setItem(CFG_DEVICE_ID, randomHex(8));
  }
  localStorage.setItem(CFG_PAIR_ID, pairId || randomHex(32));
  localStorage.setItem(CFG_SALT, salt || randomHex(SALT_BYTES));
}

export function clearPairingConfig() {
  [CFG_ENDPOINT, CFG_TOKEN, CFG_DEVICE_ID, CFG_PAIR_ID, CFG_SALT,
   CFG_VERSIONS, CFG_LAST_PULL, CFG_LAST_REMOTE_ETAG].forEach(k => localStorage.removeItem(k));
  try { sessionStorage.removeItem(SESSION_PASS); } catch {}
  _derivedKey = null;
}

// ── Passphrase / key derivation ─────────────────────────────────────────────

// In-memory fallback for environments where sessionStorage doesn't persist
// across WebView reloads (Capacitor on Android can be flaky).
let _passInMem = null;

export async function setPassphrase(passphrase, { remember = true } = {}) {
  if (!passphrase || passphrase.length < 8) throw new Error('passphrase too short (8+ chars)');
  _passInMem = passphrase;
  if (remember) {
    try { sessionStorage.setItem(SESSION_PASS, passphrase); } catch {}
  }
  // Derive immediately so the key is cached even if sessionStorage gets evicted.
  _derivedKey = null;
  const cfg = getPairingConfig();
  if (!cfg.salt) throw new Error('not paired');
  _derivedKey = await deriveKey(passphrase, hexToBytes(cfg.salt));
  return _derivedKey;
}

function _readPass() {
  if (_passInMem) return _passInMem;
  try { return sessionStorage.getItem(SESSION_PASS); } catch { return null; }
}

export function hasPassphrase() {
  if (_derivedKey) return true;
  return !!_readPass();
}

async function getDerivedKey() {
  if (_derivedKey) return _derivedKey;
  const pass = _readPass();
  if (!pass) throw new Error('passphrase not set');
  const cfg = getPairingConfig();
  if (!cfg.salt) throw new Error('not paired');
  _derivedKey = await deriveKey(pass, hexToBytes(cfg.salt));
  return _derivedKey;
}

async function deriveKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Encrypt / decrypt blob ──────────────────────────────────────────────────

async function encryptBlob(plaintext, key, saltBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(MAGIC.length + SALT_BYTES + IV_BYTES + ct.length);
  out.set(MAGIC, 0);
  out.set(saltBytes, MAGIC.length);
  out.set(iv, MAGIC.length + SALT_BYTES);
  out.set(ct, MAGIC.length + SALT_BYTES + IV_BYTES);
  return out;
}

async function decryptBlob(buf, passphrase) {
  const bytes = new Uint8Array(buf);
  if (bytes.length < MAGIC.length + SALT_BYTES + IV_BYTES + 16) {
    throw new Error('blob too short');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('bad magic');
  }
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = bytes.slice(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  const ct = bytes.slice(MAGIC.length + SALT_BYTES + IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return { json: new TextDecoder().decode(ptBuf), salt: bytesToHex(salt) };
}

// ── Snapshot build / apply ──────────────────────────────────────────────────

function getVersions() {
  try { return JSON.parse(localStorage.getItem(CFG_VERSIONS) || '{}'); } catch { return {}; }
}

function setVersions(v) {
  try { localStorage.setItem(CFG_VERSIONS, JSON.stringify(v)); } catch {}
}

function bumpVersion(fullKey, t = now()) {
  const v = getVersions();
  v[fullKey] = t;
  setVersions(v);
}

function buildSnapshot() {
  const versions = getVersions();
  const keys = {};
  for (const [name, fullKey] of Object.entries(KEYS)) {
    const val = storage.get(name);
    if (val === null || val === undefined) continue;
    // Use current time for keys that pre-date Cloud Sync pairing, so the
    // receiving device sees them as newer than its default (0) and applies them.
    keys[fullKey] = { v: val, t: versions[fullKey] || now() };
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    writtenAt: now(),
    writtenBy: _deviceId || localStorage.getItem(CFG_DEVICE_ID) || 'unknown',
    keys,
  };
}

// Map a fullKey back to the collection name in KEYS.
const REVERSE_KEYS = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [v, k]));

// ── Array merge: Last-Write-Wins (LWW) ────────────────────────────────────
//
// DATA FLOW PROTOCOL:
//   1. Each device is a standalone solution with its own complete data copy.
//   2. On every local write, the key's version timestamp is bumped and a push
//      is debounced (5 s).
//   3. On pull, for each key: if remote.t > local.t the remote value wins.
//   4. For arrays this means FULL REPLACEMENT — the remote array overwrites
//      the local array entirely.  No element-level merge, no union, no ghosts.
//   5. The only exception: local entries with a `createdAt` timestamp AFTER
//      the remote snapshot was written are preserved (they're genuinely new
//      local data the remote hasn't seen yet).  This prevents data loss when
//      both devices edit between sync cycles.
//
// Why full replacement?  Element-level merge (union by id/date) can never
// propagate deletions — if device A deletes an entry, device B's copy still
// has it and the union merge resurrects it.  LWW is simple and predictable:
// "last save wins" across the board.
//
function mergeArrays(local, remote, remoteWrittenAt = 0) {
  if (!Array.isArray(local))  return remote;
  if (!Array.isArray(remote)) return local;

  // Start from the remote array (authoritative).
  // Preserve local-only records created AFTER the remote snapshot was built,
  // so we don't discard genuinely new local data that hasn't pushed yet.
  const remoteIds = new Set();
  const remoteDates = new Set();
  for (const r of remote) {
    if (r.id)   remoteIds.add(r.id);
    if (r.date) remoteDates.add(r.date);
  }

  const extras = [];
  for (const r of local) {
    // Already in remote — skip (remote version wins)
    if (r.id && remoteIds.has(r.id))     continue;
    if (!r.id && r.date && remoteDates.has(r.date)) continue;

    // Local-only: keep only if created after the remote snapshot
    const ct = r.createdAt ? new Date(r.createdAt).getTime() : 0;
    if (ct > remoteWrittenAt) {
      extras.push(r);
    }
    // Otherwise it was deleted / replaced on the remote — drop it.
  }

  const merged = [...remote, ...extras];
  // Sort newest-first by whatever key makes sense
  const sample = merged[0] || {};
  const sortKey = ('id' in sample) ? 'id' : ('date' in sample) ? 'date' : null;
  if (sortKey) {
    merged.sort((a, b) => String(b[sortKey] || '').localeCompare(String(a[sortKey] || '')));
  }
  return merged;
}

// ── Union merge for append-only medical records ─────────────────────────────
// Lab snapshots and clinical tests are append-only history: a blood panel
// dated 2024-06-21 should NEVER be silently erased by a sync round. The
// generic mergeArrays() above does LWW-with-remote-wins — fine for activity
// logs and FIT files where deletions need to propagate, catastrophic for
// medical records.
//
// This merge unions by date (and type for clinical tests). For overlapping
// dates we union the markers/metrics — so if device A has glucose recorded
// for 2025-12-06 and device B has cholesterol for the same date, the merged
// snapshot has both.  No data is ever dropped.
//
// The cost of this semantic: deletions can't propagate across devices for
// these collections. Acceptable trade — the user can re-edit on every device
// they care about, and the alternative (losing real lab history to an
// empty remote blob) is unacceptable. This was the root cause of the
// "labs disappear and reappear" cycle on 2026-04-26.
function unionLabSnapshots(local, remote) {
  if (!Array.isArray(local))  local = [];
  if (!Array.isArray(remote)) remote = [];
  const byDate = new Map();
  for (const r of remote) { if (r?.date) byDate.set(r.date, { ...r }); }
  for (const l of local) {
    if (!l?.date) continue;
    const existing = byDate.get(l.date);
    if (!existing) {
      byDate.set(l.date, { ...l });
    } else {
      // Union markers — both panels' values survive
      byDate.set(l.date, {
        ...existing,
        ...l,
        markers: { ...(existing.markers || {}), ...(l.markers || {}) },
      });
    }
  }
  return [...byDate.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function unionClinicalTests(local, remote) {
  if (!Array.isArray(local))  local = [];
  if (!Array.isArray(remote)) remote = [];
  const byKey = new Map();
  const k = t => `${t?.date || ''}|${t?.type || ''}`;
  for (const r of remote) { if (r?.date && r?.type) byKey.set(k(r), { ...r }); }
  for (const l of local) {
    if (!l?.date || !l?.type) continue;
    const existing = byKey.get(k(l));
    if (!existing) {
      byKey.set(k(l), { ...l });
    } else {
      byKey.set(k(l), {
        ...existing,
        ...l,
        metrics: { ...(existing.metrics || {}), ...(l.metrics || {}) },
      });
    }
  }
  return [...byKey.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// supplementsLog is an OBJECT keyed by date, with each date holding an
// object of {stackEntryId: timestamp}. Default LWW would have each device
// completely replace the other's day record on push — so if you tap "taken"
// for fish-oil on web and creatine on the phone before either syncs, the
// later push wipes the earlier one's mark.
//
// Union merge handles this: for each date, union both devices' entry sets
// and pick the LATEST timestamp on conflicts. This means tapping "taken" on
// either device propagates to the other; the only thing that doesn't
// propagate is an explicit untoggle (deletion) — same trade-off as labs.
function unionSupplementsLog(local, remote) {
  if (!local  || typeof local  !== 'object' || Array.isArray(local))  local  = {};
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) remote = {};
  const merged = {};
  const allDates = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const date of allDates) {
    const l = local[date]  || {};
    const r = remote[date] || {};
    const day = {};
    const allEntries = new Set([...Object.keys(l), ...Object.keys(r)]);
    for (const id of allEntries) {
      const lt = l[id] || 0;
      const rt = r[id] || 0;
      // Latest timestamp wins. If neither device has the entry it isn't here.
      day[id] = Math.max(lt, rt);
    }
    if (Object.keys(day).length > 0) merged[date] = day;
  }
  return merged;
}

// dailyLogs are mostly LWW-safe (sleep/HRV/weight overwrites are fine), BUT
// dailyLogs[date].fitActivities is append-only — a FIT file uploaded on one
// device must never be silently dropped because the other device wrote HC
// data 5 seconds later. This merger is LWW for the per-day record fields
// AND union-by-id for fitActivities, so every uploaded run survives.
function mergeDailyLogs(local, remote) {
  if (!Array.isArray(local))  local = [];
  if (!Array.isArray(remote)) remote = [];
  const byDate = new Map();
  for (const r of remote) { if (r?.date) byDate.set(r.date, { ...r }); }
  for (const l of local) {
    if (!l?.date) continue;
    const remoteEntry = byDate.get(l.date);
    if (!remoteEntry) {
      byDate.set(l.date, { ...l });
      continue;
    }
    // Both have an entry for this date — LWW for scalar fields, union for
    // fitActivities by activity id (or startTime+type fallback).
    const fitKey = a => a?.id || `${a?.startTime || ''}|${a?.activityType || ''}`;
    const fitMap = new Map();
    (remoteEntry.fitActivities || []).forEach(a => { if (a) fitMap.set(fitKey(a), a); });
    (l.fitActivities || []).forEach(a => {
      if (!a) return;
      const k = fitKey(a);
      if (!fitMap.has(k)) fitMap.set(k, a);
    });
    byDate.set(l.date, {
      ...remoteEntry,
      fitActivities: [...fitMap.values()],
    });
  }
  return [...byDate.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// Collections that should be union-merged instead of LWW. Names must match
// the collection name in storage.js KEYS (not the full key).
const UNION_MERGERS = {
  labSnapshots:    unionLabSnapshots,
  clinicalTests:   unionClinicalTests,
  dailyLogs:       mergeDailyLogs,
  supplementsLog:  unionSupplementsLog,  // object-shaped; see merger comment
};

function applySnapshot(remote, opts = {}) {
  if (!remote || remote.schema !== SNAPSHOT_SCHEMA) {
    throw new Error('unsupported snapshot schema');
  }
  // Force mode: bypass LWW + array merge entirely. Remote becomes the truth
  // for every key. Used when local data has drifted and we need to reset
  // to remote (e.g., bad migration on one device, or a phone whose HC
  // rewrites bumped local timestamps past a meaningful web push).
  const force = !!opts.force;
  const localVersions = getVersions();
  const newVersions = { ...localVersions };
  let applied = 0;
  // Guard: any writes we do during apply should not trigger another push.
  setCloudApplying(true);
  try {
    for (const [fullKey, { v: remoteVal, t: remoteT }] of Object.entries(remote.keys || {})) {
      const name = REVERSE_KEYS[fullKey];
      if (!name) continue; // unknown key — ignore
      const localVal = storage.get(name);
      const localT = localVersions[fullKey] || 0;

      if (force) {
        // Direct overwrite — no LWW, no union merge. Whatever's in remote
        // wins, full stop. This is what the "Force pull" UI button uses.
        storage.set(name, remoteVal, { skipValidation: true });
        newVersions[fullKey] = remoteT;
        applied++;
        continue;
      }

      // Union-mergers (labs/clinicalTests/dailyLogs/supplementsLog): always
      // reconcile so an empty-remote can never erase local entries. Bypass
      // the LWW gate. Each merger validates its own input shape (array vs
      // object) — we just delegate.
      const unionMerge = UNION_MERGERS[name];
      if (unionMerge && (localVal != null || remoteVal != null)) {
        const merged = unionMerge(localVal, remoteVal);
        // Skip the storage.set if nothing changed — avoid pointless writes
        // and onStorageChange fires that bump versions for no reason.
        if (JSON.stringify(merged) !== JSON.stringify(localVal)) {
          storage.set(name, merged, { skipValidation: true });
          applied++;
        }
        // Always advance the version pointer so we don't re-process the same
        // remote snapshot. Use max(localT, remoteT) — version is just a
        // bookkeeping number for "we've seen this state".
        newVersions[fullKey] = Math.max(localT, remoteT);
        continue;
      }

      // Default LWW path for everything else
      if (remoteT <= localT) continue;
      const merged = Array.isArray(remoteVal) ? mergeArrays(localVal, remoteVal, remoteT) : remoteVal;
      storage.set(name, merged, { skipValidation: true });
      newVersions[fullKey] = remoteT;
      applied++;
    }
  } finally {
    setCloudApplying(false);
  }
  setVersions(newVersions);
  return applied;
}

// ── Network: push / pull ────────────────────────────────────────────────────

async function pushNow() {
  const cfg = getPairingConfig();
  if (!cfg.paired) return { skipped: 'not_paired' };
  if (!hasPassphrase()) return { skipped: 'no_passphrase' };

  emit('push:start', {});
  try {
    const key = await getDerivedKey();
    const snapshot = buildSnapshot();
    const padded = padSnapshot(snapshot);
    const blob = await encryptBlob(padded, key, hexToBytes(cfg.salt));

    const res = await fetch(`${cfg.endpoint}/s/${cfg.pairId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: blob,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`push failed: ${res.status} ${body.slice(0, 120)}`);
    }
    const payload = await res.json().catch(() => ({}));
    localStorage.setItem(CFG_LAST_REMOTE_ETAG, String(payload.updatedAt || ''));
    emit('push:ok', { bytes: blob.byteLength, updatedAt: payload.updatedAt });
    return { ok: true, bytes: blob.byteLength, updatedAt: payload.updatedAt };
  } catch (err) {
    const msg = (err && (err.message || err.name || String(err))) || 'unknown';
    console.error('[cloud-sync] push failed:', err);
    emit('push:error', { error: msg });
    return { error: msg };
  }
}

async function pullNow(opts = {}) {
  const cfg = getPairingConfig();
  if (!cfg.paired) return { skipped: 'not_paired' };
  if (!hasPassphrase()) return { skipped: 'no_passphrase' };

  const force = !!opts.force;
  emit('pull:start', force ? { force: true } : {});
  try {
    // For force pulls, deliberately skip the If-None-Match header so the
    // server always returns the body — we want to overwrite local even when
    // ETag suggests "no change since last pull".
    const lastEtag = force ? '' : (localStorage.getItem(CFG_LAST_REMOTE_ETAG) || '');
    const res = await fetch(`${cfg.endpoint}/s/${cfg.pairId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        ...(lastEtag ? { 'If-None-Match': `"${lastEtag}"` } : {}),
      },
    });
    if (res.status === 304) {
      emit('pull:unchanged', {});
      return { unchanged: true };
    }
    if (res.status === 404) {
      emit('pull:empty', {});
      return { empty: true };
    }
    if (!res.ok) {
      throw new Error(`pull failed: ${res.status}`);
    }
    const updatedAt = res.headers.get('X-Updated-At') || '';
    const buf = await res.arrayBuffer();
    const passphrase = _readPass();
    if (!passphrase) throw new Error('passphrase not set');
    const { json } = await decryptBlob(buf, passphrase);
    const snapshot = JSON.parse(json);
    const applied = applySnapshot(snapshot, { force });
    localStorage.setItem(CFG_LAST_REMOTE_ETAG, updatedAt);
    localStorage.setItem(CFG_LAST_PULL, String(now()));
    emit('pull:ok', { applied, bytes: buf.byteLength, updatedAt, force });
    return { ok: true, applied, bytes: buf.byteLength, force };
  } catch (err) {
    const msg = (err && (err.message || err.name || String(err))) || 'unknown';
    console.error('[cloud-sync] pull failed:', err);
    emit('pull:error', { error: msg });
    return { error: msg };
  }
}

export async function push() { return _inFlight ? _inFlight : (_inFlight = pushNow().finally(() => _inFlight = null)); }
export async function pull() { return pullNow(); }
// Force pull — bypasses LWW, overwrites local entirely with remote.
// Use when devices have drifted and you want to reset one to match remote.
export async function forcePull() { return pullNow({ force: true }); }

// ── Debounced push on local writes ──────────────────────────────────────────

function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { _pushTimer = null; push(); }, DEBOUNCE_MS);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

let _started = false;

export async function startCloudSync() {
  if (_started) return;
  _started = true;

  const cfg = getPairingConfig();
  _deviceId = cfg.deviceId || null;
  if (!cfg.paired) return { skipped: 'not_paired' };

  // Bump version on every local write, then debounce-push.
  onStorageChange((fullKey) => {
    bumpVersion(fullKey, now());
    if (hasPassphrase()) schedulePush();
  });

  // Foreground visibility → pull
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && hasPassphrase()) pull();
    });
  }

  // Periodic pull
  _pullTimer = setInterval(() => {
    if (document?.visibilityState === 'visible' && hasPassphrase()) pull();
  }, FOREGROUND_PULL_MS);

  // Initial pull if passphrase cached from a previous session
  if (hasPassphrase()) {
    await pull().catch(() => {});
  }
}

export function stopCloudSync() {
  if (_pushTimer) clearTimeout(_pushTimer);
  if (_pullTimer) clearInterval(_pullTimer);
  _pushTimer = null;
  _pullTimer = null;
  _started = false;
}

// ── Status snapshot for UI ──────────────────────────────────────────────────

export function getSyncStatus() {
  const cfg = getPairingConfig();
  const versions = getVersions();
  const lastPull = parseInt(localStorage.getItem(CFG_LAST_PULL) || '0', 10);
  const etag = localStorage.getItem(CFG_LAST_REMOTE_ETAG) || '';
  return {
    paired: cfg.paired,
    hasPassphrase: hasPassphrase(),
    endpoint: cfg.endpoint,
    deviceId: cfg.deviceId,
    pairId: cfg.pairId,
    salt: cfg.salt,
    trackedKeys: Object.keys(versions).length,
    lastPull,
    remoteUpdatedAt: etag ? parseInt(etag, 10) : 0,
  };
}

// ── Self-test (call from console / init) ────────────────────────────────────
export async function selfTest() {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey('test-passphrase-1234', salt);
  const ct = await encryptBlob(JSON.stringify({ hello: 'world' }), key, salt);
  const { json } = await decryptBlob(ct, 'test-passphrase-1234');
  const ok = JSON.parse(json).hello === 'world';
  return { ok, bytes: ct.length };
}
