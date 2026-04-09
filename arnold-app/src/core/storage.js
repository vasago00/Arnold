// ─── ARNOLD Browser Storage Service ──────────────────────────────────────────
// Single source of truth. All collections use the `arnold:*` namespace.
// Schema validation guards against malformed CSV rows poisoning the cache.
// One-shot migration sweeps legacy `arnold-memory:*` data into the new keys.

import { validateArray } from './schemas.js';

// Phase 7: IndexedDB engine. Loaded lazily so this module can be imported
// at top level without circular issues. When the engine is hydrated, all
// reads/writes go through it; otherwise they fall through to localStorage.
let _engine = null;
export function attachEngine(engine) { _engine = engine; }

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
  if (_engine?.dbGet) {
    const v = _engine.dbGet(fullKey);
    if (v !== undefined) return v;
  }
  try {
    const v = localStorage.getItem(fullKey);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

function rawSet(fullKey, data) {
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
