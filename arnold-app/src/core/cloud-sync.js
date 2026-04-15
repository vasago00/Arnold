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
const DEBOUNCE_MS = 5_000;
const FOREGROUND_PULL_MS = 5 * 60 * 1000;
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

export async function setPassphrase(passphrase, { remember = true } = {}) {
  if (!passphrase || passphrase.length < 8) throw new Error('passphrase too short (8+ chars)');
  if (remember) {
    try { sessionStorage.setItem(SESSION_PASS, passphrase); } catch {}
  }
  _derivedKey = null; // force re-derive with new pass
  return getDerivedKey();
}

export function hasPassphrase() {
  if (_derivedKey) return true;
  try { return !!sessionStorage.getItem(SESSION_PASS); } catch { return false; }
}

async function getDerivedKey() {
  if (_derivedKey) return _derivedKey;
  const pass = (() => { try { return sessionStorage.getItem(SESSION_PASS); } catch { return null; } })();
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
    keys[fullKey] = { v: val, t: versions[fullKey] || 0 };
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

// Merge an array-of-records by date or id, last-write-wins per element.
function mergeArrays(local, remote) {
  if (!Array.isArray(local)) return remote;
  if (!Array.isArray(remote)) return local;
  // Pick a dedupe field based on the first element
  const sample = remote[0] || local[0] || {};
  const field = ('id' in sample) ? 'id' : ('date' in sample) ? 'date' : null;
  if (!field) return remote; // can't merge — take remote wholesale
  const map = new Map(local.map(r => [r[field], r]));
  for (const r of remote) {
    const k = r?.[field];
    if (k == null) continue;
    map.set(k, { ...(map.get(k) || {}), ...r });
  }
  return [...map.values()].sort((a, b) => String(b[field] || '').localeCompare(String(a[field] || '')));
}

function applySnapshot(remote) {
  if (!remote || remote.schema !== SNAPSHOT_SCHEMA) {
    throw new Error('unsupported snapshot schema');
  }
  const localVersions = getVersions();
  const newVersions = { ...localVersions };
  let applied = 0;
  // Guard: any writes we do during apply should not trigger another push.
  setCloudApplying(true);
  try {
    for (const [fullKey, { v: remoteVal, t: remoteT }] of Object.entries(remote.keys || {})) {
      const localT = localVersions[fullKey] || 0;
      if (remoteT <= localT) continue; // our copy is newer or equal
      const name = REVERSE_KEYS[fullKey];
      if (!name) continue; // unknown key — ignore
      const localVal = storage.get(name);
      const merged = Array.isArray(remoteVal) ? mergeArrays(localVal, remoteVal) : remoteVal;
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
    emit('push:error', { error: err.message });
    return { error: err.message };
  }
}

async function pullNow() {
  const cfg = getPairingConfig();
  if (!cfg.paired) return { skipped: 'not_paired' };
  if (!hasPassphrase()) return { skipped: 'no_passphrase' };

  emit('pull:start', {});
  try {
    const lastEtag = localStorage.getItem(CFG_LAST_REMOTE_ETAG) || '';
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
    const passphrase = sessionStorage.getItem(SESSION_PASS);
    const { json } = await decryptBlob(buf, passphrase);
    const snapshot = JSON.parse(json);
    const applied = applySnapshot(snapshot);
    localStorage.setItem(CFG_LAST_REMOTE_ETAG, updatedAt);
    localStorage.setItem(CFG_LAST_PULL, String(now()));
    emit('pull:ok', { applied, bytes: buf.byteLength, updatedAt });
    return { ok: true, applied, bytes: buf.byteLength };
  } catch (err) {
    emit('pull:error', { error: err.message });
    return { error: err.message };
  }
}

export async function push() { return _inFlight ? _inFlight : (_inFlight = pushNow().finally(() => _inFlight = null)); }
export async function pull() { return pullNow(); }

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
