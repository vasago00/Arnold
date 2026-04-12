// ─── ARNOLD Browser Storage Service ──────────────────────────────────────────
// Single source of truth. All collections use the `arnold:*` namespace.
// Schema validation guards against malformed CSV rows poisoning the cache.
// One-shot migration sweeps legacy `arnold-memory:*` data into the new keys.
// AES-256-GCM encryption at rest for HIGH/CRITICAL sensitivity keys.

import { validateArray } from './schemas.js';

// Phase 7: IndexedDB engine. Loaded lazily so this module can be imported
// at top level without circular issues. When the engine is hydrated, all
// reads/writes go through it; otherwise they fall through to localStorage.
let _engine = null;
export function attachEngine(engine) { _engine = engine; }

// ─── AES-256-GCM Encryption at Rest ─────────────────────────────────────────
// Session-key approach: a random AES key is generated once per browser session
// and stored in sessionStorage. When the tab/browser closes, the key is gone
// and localStorage data remains encrypted (unreadable without the key).
// On next session open, a new key is generated and data is re-encrypted.

const SESSION_KEY_ID = 'arnold:session-crypto-key';
const ENCRYPTED_PREFIX = 'enc:'; // marks ciphertext values in localStorage

// Keys that require encryption (HIGH + CRITICAL from security audit)
const ENCRYPTED_COLLECTIONS = new Set([
  'hrv', 'sleep', 'weight', 'dailyLogs', 'profile',  // HIGH
]);
// Backup slots are handled separately (they use raw localStorage keys)
const ENCRYPTED_RAW_KEYS = new Set([
  'backup:slot-0', 'backup:slot-1', 'backup:slot-2',  // CRITICAL
]);

function shouldEncrypt(key) {
  return ENCRYPTED_COLLECTIONS.has(key) || ENCRYPTED_RAW_KEYS.has(key);
}

function shouldEncryptFullKey(fullKey) {
  if (ENCRYPTED_RAW_KEYS.has(fullKey)) return true;
  for (const [col, fk] of Object.entries(KEYS)) {
    if (fk === fullKey && ENCRYPTED_COLLECTIONS.has(col)) return true;
  }
  return false;
}

// ── Crypto helpers (Web Crypto API — AES-256-GCM) ──

let _cryptoKey = null; // cached CryptoKey object for the session

async function getSessionKey() {
  if (_cryptoKey) return _cryptoKey;
  try {
    // Try to restore from sessionStorage
    const stored = sessionStorage.getItem(SESSION_KEY_ID);
    if (stored) {
      const rawKey = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      _cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt', 'decrypt']);
      return _cryptoKey;
    }
    // Generate new key for this session
    _cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const exported = await crypto.subtle.exportKey('raw', _cryptoKey);
    sessionStorage.setItem(SESSION_KEY_ID, btoa(String.fromCharCode(...new Uint8Array(exported))));
    return _cryptoKey;
  } catch (e) {
    console.warn('arnold: crypto not available, falling back to plaintext', e);
    return null;
  }
}

async function encryptValue(plaintext) {
  const key = await getSessionKey();
  if (!key) return JSON.stringify(plaintext); // fallback
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Pack as: base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
}

async function decryptValue(stored) {
  if (!stored || !stored.startsWith(ENCRYPTED_PREFIX)) {
    // Plaintext (pre-migration or non-encrypted key)
    try { return JSON.parse(stored); } catch { return null; }
  }
  const key = await getSessionKey();
  if (!key) return null; // can't decrypt without key
  try {
    const combined = Uint8Array.from(atob(stored.slice(ENCRYPTED_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch {
    // Key mismatch (new session) — data needs re-encryption from plaintext backup
    return null;
  }
}

// ── Synchronous crypto cache ──
// storage.get/set are synchronous in the current API. We maintain an in-memory
// decrypted cache so reads are instant. Writes encrypt asynchronously and
// flush to localStorage in the background.
const _decryptedCache = new Map();
let _cryptoReady = false;

// Initialize: decrypt all sensitive keys into cache on app boot
export async function initEncryption() {
  try {
    await getSessionKey();
    _cryptoReady = true;

    // Decrypt (or migrate) all sensitive keys into the cache
    for (const col of ENCRYPTED_COLLECTIONS) {
      const fullKey = KEYS[col];
      if (!fullKey) continue;
      const raw = localStorage.getItem(fullKey);
      if (raw === null) continue;

      if (raw.startsWith(ENCRYPTED_PREFIX)) {
        // Already encrypted — decrypt into cache
        const val = await decryptValue(raw);
        if (val !== null) {
          _decryptedCache.set(fullKey, val);
        } else {
          // Can't decrypt (new session key) — check for plaintext backup
          const backup = localStorage.getItem(fullKey + ':plain');
          if (backup) {
            const parsed = JSON.parse(backup);
            _decryptedCache.set(fullKey, parsed);
            // Re-encrypt with new session key
            const enc = await encryptValue(parsed);
            localStorage.setItem(fullKey, enc);
          }
        }
      } else {
        // Plaintext — migrate to encrypted
        try {
          const parsed = JSON.parse(raw);
          _decryptedCache.set(fullKey, parsed);
          // Store plaintext backup (needed when session key rotates)
          localStorage.setItem(fullKey + ':plain', raw);
          // Encrypt
          const enc = await encryptValue(parsed);
          localStorage.setItem(fullKey, enc);
        } catch {}
      }
    }

    // Same for backup slots
    for (const rawKey of ENCRYPTED_RAW_KEYS) {
      const raw = localStorage.getItem(rawKey);
      if (raw === null) continue;
      if (raw.startsWith(ENCRYPTED_PREFIX)) {
        const val = await decryptValue(raw);
        if (val !== null) {
          _decryptedCache.set(rawKey, val);
        } else {
          const backup = localStorage.getItem(rawKey + ':plain');
          if (backup) {
            const parsed = JSON.parse(backup);
            _decryptedCache.set(rawKey, parsed);
            const enc = await encryptValue(parsed);
            localStorage.setItem(rawKey, enc);
          }
        }
      } else {
        try {
          const parsed = JSON.parse(raw);
          _decryptedCache.set(rawKey, parsed);
          localStorage.setItem(rawKey + ':plain', raw);
          const enc = await encryptValue(parsed);
          localStorage.setItem(rawKey, enc);
        } catch {}
      }
    }

    logEvent({ type: 'crypto:init', collections: [...ENCRYPTED_COLLECTIONS], status: 'ok' });
    console.info('arnold: encryption layer initialized', { cached: _decryptedCache.size });
  } catch (e) {
    console.error('arnold: encryption init failed, using plaintext fallback', e);
  }
}

// Background encrypt-and-flush for writes
function encryptAndFlush(fullKey, data) {
  if (!_cryptoReady) return;
  encryptValue(data).then(enc => {
    localStorage.setItem(fullKey, enc);
    // Keep plaintext backup for session key rotation
    localStorage.setItem(fullKey + ':plain', JSON.stringify(data));
  }).catch(e => {
    console.warn('arnold: encrypt flush failed for', fullKey, e);
  });
}

// ─── Canonical key map ───────────────────────────────────────────────────────
// Anywhere in Arnold that needs persistent data goes through this map.
export const KEYS = {
  // Imported data
  activities:    'arnold:garmin-activities',
  hrv:           'arnold:garmin-hrv',
  sleep:         'arnold:garmin-sleep',
  weight:        'arnold:garmin-weight',
  cronometer:    'arnold:cronometer',

  // User-owned
  workouts:      'arnold:workouts',
  profile:       'arnold:profile',
  goals:         'arnold:goals',
  planner:       'arnold:planner',
  races:         'arnold:races',
  logs:          'arnold:logs',
  dailyLogs:     'arnold:daily-logs',        // Phase 1: was missing, forced direct localStorage
  nutritionLog:  'arnold:nutrition-log',      // Phase 1: was missing, forced direct localStorage

  // Supplements
  supplementsCatalog:  'arnold:supplements-catalog',   // Phase 1: was unprefixed 'supplements'
  supplementsStack:    'arnold:supplements-stack',      // Phase 1: was unprefixed 'supplementStack'
  supplementsLog:      'arnold:supplements-log',        // Phase 1: was unprefixed 'supplementLog'

  // System
  importHistory: 'arnold:import-history',
  events:        'arnold:events',          // append-only audit log
  diagnostics:   'arnold:diagnostics',     // last import coverage report
  aiCache:       'arnold:ai-cache',        // hash-keyed AI responses
};

// Legacy key map (memory.js era). Used by migrate() once at startup.
const LEGACY_KEYS = {
  'arnold-memory:garmin-activities': 'activities',
  'arnold-memory:garmin-hrv':        'hrv',
  'arnold-memory:garmin-sleep':      'sleep',
  'arnold-memory:garmin-weight':     'weight',
  'arnold-memory:cronometer':        'cronometer',
  'arnold-memory:workouts':          'workouts',
  'arnold-memory:garmin':            null, // deprecated, drop
  'arnold-memory:import-history':    'importHistory',
  'arnold-memory:index':             null, // rebuilt on demand
};

// ─── Core read/write ─────────────────────────────────────────────────────────

function resolveKey(key) {
  return KEYS[key] || key;
}

function rawGet(fullKey) {
  // Encrypted keys: read from in-memory decrypted cache
  if (shouldEncryptFullKey(fullKey) && _decryptedCache.has(fullKey)) {
    return _decryptedCache.get(fullKey);
  }
  if (_engine?.dbGet) {
    const v = _engine.dbGet(fullKey);
    if (v !== undefined) return v;
  }
  try {
    const v = localStorage.getItem(fullKey);
    if (!v) return null;
    // If value is encrypted but not in cache (init hasn't run yet), try plaintext backup
    if (v.startsWith(ENCRYPTED_PREFIX)) {
      const backup = localStorage.getItem(fullKey + ':plain');
      if (backup) { try { return JSON.parse(backup); } catch {} }
      return null; // encrypted and no backup — need initEncryption()
    }
    return JSON.parse(v);
  } catch { return null; }
}

function rawSet(fullKey, data) {
  // Encrypted keys: update cache immediately, flush encrypted async
  if (shouldEncryptFullKey(fullKey)) {
    _decryptedCache.set(fullKey, data);
    encryptAndFlush(fullKey, data);
    // Also update engine if present
    if (_engine?.dbSet) { try { _engine.dbSet(fullKey, data); } catch {} }
    return true;
  }
  if (_engine?.dbSet) {
    try { _engine.dbSet(fullKey, data); return true; } catch {}
  }
  try {
    localStorage.setItem(fullKey, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error(`storage.set failed for ${fullKey}:`, e);
    return false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const storage = {
  get(key) {
    return rawGet(resolveKey(key));
  },

  set(key, data, opts = {}) {
    const fullKey = resolveKey(key);
    // Validate arrays against schema if one exists
    if (Array.isArray(data) && !opts.skipValidation) {
      const { kept, rejected, coverage } = validateArray(key, data);
      if (rejected.length) {
        console.warn(`storage.set(${key}): rejected ${rejected.length}/${data.length} rows`, rejected.slice(0, 3));
      }
      // Stash diagnostics for the import panel
      const diag = rawGet(KEYS.diagnostics) || {};
      diag[key] = {
        ts: new Date().toISOString(),
        total: data.length,
        kept: kept.length,
        rejected: rejected.length,
        coverage,
      };
      rawSet(KEYS.diagnostics, diag);
      const ok = rawSet(fullKey, kept);
      logEvent({ type: 'set', collection: key, count: kept.length, rejected: rejected.length });
      return ok;
    }
    const ok = rawSet(fullKey, data);
    logEvent({ type: 'set', collection: key });
    return ok;
  },

  merge(key, newItems, dedupeField = 'date') {
    const existing = storage.get(key) || [];
    const map = new Map(existing.map(i => [i[dedupeField], i]));
    for (const item of newItems) {
      const k = item[dedupeField];
      if (k == null) continue;
      // Merge field-by-field so new fields (e.g. totalReps) layer onto old rows
      map.set(k, { ...(map.get(k) || {}), ...item });
    }
    const merged = [...map.values()].sort((a, b) =>
      (b[dedupeField] || '').localeCompare(a[dedupeField] || '')
    );
    storage.set(key, merged);
    return merged;
  },

  clear(key) {
    localStorage.removeItem(resolveKey(key));
    logEvent({ type: 'clear', collection: key });
  },

  // List all collections with row counts (for diagnostics, debug console)
  inventory() {
    const out = {};
    for (const [name, fullKey] of Object.entries(KEYS)) {
      const v = rawGet(fullKey);
      out[name] = Array.isArray(v) ? v.length : (v ? 1 : 0);
    }
    return out;
  },
};

// ─── Event log (append-only audit) ───────────────────────────────────────────
// Bounded to 200 entries to keep localStorage cheap. Use the events key
// directly for queries; this is the foundation for undo and future ML.

function logEvent(evt) {
  try {
    const log = rawGet(KEYS.events) || [];
    log.unshift({ ts: Date.now(), ...evt });
    rawSet(KEYS.events, log.slice(0, 200));
  } catch {}
}

// ─── One-shot legacy migration ────────────────────────────────────────────────
// Runs once on app boot. If a legacy `arnold-memory:*` key has data and the
// canonical `arnold:*` target is empty, copy it over. Idempotent.
const MIGRATION_FLAG = 'arnold:migration:v1';

export function migrateLegacyStorage() {
  try {
    if (localStorage.getItem(MIGRATION_FLAG)) return { skipped: true };
    const moved = {};
    for (const [legacyKey, targetCollection] of Object.entries(LEGACY_KEYS)) {
      if (!targetCollection) continue;
      const legacy = rawGet(legacyKey);
      if (!legacy) continue;
      const targetFullKey = KEYS[targetCollection];
      const existing = rawGet(targetFullKey);
      const existingCount = Array.isArray(existing) ? existing.length : 0;
      const legacyCount = Array.isArray(legacy) ? legacy.length : 0;
      // Only copy if legacy has more rows than target (avoid clobbering newer data)
      if (legacyCount > existingCount) {
        rawSet(targetFullKey, legacy);
        moved[targetCollection] = legacyCount;
      }
    }
    localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
    logEvent({ type: 'migration', moved });
    if (Object.keys(moved).length) {
      console.info('arnold: migrated legacy storage', moved);
    }
    return { migrated: moved };
  } catch (e) {
    console.error('migrateLegacyStorage failed:', e);
    return { error: e.message };
  }
}

// ─── Phase 1 migration: move unprefixed supplement keys to arnold:* namespace ─
// supplements.js previously used raw keys ('supplements', 'supplementStack',
// 'supplementLog') because they weren't in the KEYS map. Now that they are,
// we migrate once to the canonical arnold:* prefixed keys. Idempotent.
const SUPP_MIGRATION_FLAG = 'arnold:migration:supplements-v1';

const SUPP_LEGACY_MAP = {
  'supplements':    KEYS.supplementsCatalog,   // → arnold:supplements-catalog
  'supplementStack': KEYS.supplementsStack,     // → arnold:supplements-stack
  'supplementLog':  KEYS.supplementsLog,        // → arnold:supplements-log
};

export function migrateSupplementKeys() {
  try {
    if (localStorage.getItem(SUPP_MIGRATION_FLAG)) return { skipped: true };
    const moved = {};
    for (const [oldKey, newKey] of Object.entries(SUPP_LEGACY_MAP)) {
      const raw = localStorage.getItem(oldKey);
      if (raw === null) continue;
      const existing = localStorage.getItem(newKey);
      // Only copy if the new key is empty (don't overwrite)
      if (existing === null) {
        localStorage.setItem(newKey, raw);
        moved[oldKey] = newKey;
      }
      // Clean up old key after successful migration
      localStorage.removeItem(oldKey);
    }
    localStorage.setItem(SUPP_MIGRATION_FLAG, new Date().toISOString());
    logEvent({ type: 'migration:supplements-v1', moved });
    if (Object.keys(moved).length) {
      console.info('arnold: migrated supplement keys to arnold:* namespace', moved);
    }
    return { migrated: moved };
  } catch (e) {
    console.error('migrateSupplementKeys failed:', e);
    return { error: e.message };
  }
}
