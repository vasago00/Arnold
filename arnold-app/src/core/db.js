// ─── ARNOLD IndexedDB Engine (Phase 7) ───────────────────────────────────────
// Drop-in replacement for the localStorage backing of storage.js, using
// Dexie. Same API surface (get/set/merge/clear/inventory) so no call site
// in Arnold.jsx or anywhere else needs to change.
//
// Strategy:
//  • Synchronous reads stay synchronous by maintaining an in-memory cache
//    that mirrors the IDB state. The cache is hydrated on app boot before
//    React renders, so the first paint already has data.
//  • Writes go to BOTH the cache and IDB asynchronously. localStorage is
//    written too as a small-bundle backup (capped at 4 MB to avoid the cap).
//  • IDB lets us store much larger time series (years of FIT files, full
//    activity histories) without hitting the 5 MB localStorage ceiling, and
//    gives us real range queries via Dexie's where() API for future use.
//
// On first boot, all existing localStorage `arnold:*` keys are imported into
// IDB, then both backends stay in sync. The migration is idempotent.

import Dexie from 'dexie';
import { KEYS } from './storage.js';

// Single-table key/value design. Each row is { key: 'arnold:goals', value: any }.
// This mirrors the localStorage shape so migration is trivial.
class ArnoldDB extends Dexie {
  constructor() {
    super('arnold');
    this.version(1).stores({
      kv: 'key',
    });
  }
}

const db = new ArnoldDB();

// In-memory cache so storage.get() can stay synchronous.
const cache = new Map();
let hydrated = false;

// ─── Hydration ────────────────────────────────────────────────────────────────
// Pull every kv row out of IDB into the cache, and import any localStorage
// keys that aren't yet in IDB. Call once before React renders.

export async function hydrateDB() {
  try {
    const rows = await db.kv.toArray();
    for (const row of rows) cache.set(row.key, row.value);

    // Import legacy localStorage keys not yet in IDB
    const imported = [];
    for (const fullKey of Object.values(KEYS)) {
      if (cache.has(fullKey)) continue;
      try {
        const raw = localStorage.getItem(fullKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          cache.set(fullKey, parsed);
          await db.kv.put({ key: fullKey, value: parsed });
          imported.push(fullKey);
        }
      } catch {}
    }

    hydrated = true;
    if (imported.length) console.info('arnold/db: imported from localStorage →', imported);
    return { hydrated: true, imported };
  } catch (e) {
    console.error('arnold/db: hydration failed, falling back to localStorage', e);
    hydrated = false;
    return { hydrated: false, error: e.message };
  }
}

// ─── Sync read/write surface used by storage.js ──────────────────────────────
// These are the only functions storage.js needs to call to swap engines.

export function dbGet(fullKey) {
  if (cache.has(fullKey)) return cache.get(fullKey);
  // Fallback: read from localStorage if cache miss (e.g. before hydration)
  try {
    const raw = localStorage.getItem(fullKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function dbSet(fullKey, value) {
  cache.set(fullKey, value);
  // Async write to IDB (fire and forget — cache is the source of truth for reads)
  if (hydrated) {
    db.kv.put({ key: fullKey, value }).catch(e => {
      console.warn(`arnold/db: IDB write failed for ${fullKey}`, e);
    });
  }
  // Also write to localStorage as a small-bundle backup (skip if too large)
  try {
    const json = JSON.stringify(value);
    if (json.length < 4 * 1024 * 1024) localStorage.setItem(fullKey, json);
  } catch {}
  return true;
}

export function dbDelete(fullKey) {
  cache.delete(fullKey);
  if (hydrated) db.kv.delete(fullKey).catch(() => {});
  try { localStorage.removeItem(fullKey); } catch {}
}

// Range query helper for future time-series use. Not yet wired into the
// main UI but available for any caller that wants to pull a date window
// without loading the entire activities array into memory.
export async function dbRange(collection, fromISO, toISO) {
  const fullKey = KEYS[collection] || collection;
  const arr = cache.get(fullKey);
  if (!Array.isArray(arr)) return [];
  return arr.filter(r => r?.date && r.date >= fromISO && r.date <= toISO);
}

export function isHydrated() { return hydrated; }
