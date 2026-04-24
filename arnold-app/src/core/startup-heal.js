// ─── Startup Self-Heal ──────────────────────────────────────────────────────
// Runs once on app boot, BEFORE React first paints the empty state. If Tier C
// is missing from localStorage (e.g. the user just cleared site data), we
// walk the durability layers in order and restore whatever we can find:
//
//   1. IndexedDB cache (already loaded via db.js/hydrateDB at this point)
//   2. OPFS mirror (survives localStorage.clear, survives some site clears)
//   3. Cloud-sync pull (survives everything, requires pairing + passphrase)
//
// The UI should only show "No training data yet" if all three fail AND the
// user hasn't dropped any source files yet.
//
// Self-heal is non-destructive: it only WRITES to localStorage, never
// overwrites non-empty collections. So a partially-surviving state isn't
// clobbered by a lower-priority layer.

import { storage, KEYS } from './storage.js';
import { fullKeysInTier, tierOfFullKey } from './storage-tiers.js';
import { opfsReadAll, isAvailable as opfsAvailable } from './persist-opfs.js';

const HEAL_LOG_KEY = 'arnold:self-heal:last';

// Reverse-lookup for converting fullKey → collection name (so storage.set
// reaches the right path).
const _reverseKeys = (() => {
  const m = {};
  for (const [col, fk] of Object.entries(KEYS)) m[fk] = col;
  return m;
})();
function fullKeyToCollection(fullKey) { return _reverseKeys[fullKey] || fullKey; }

// Check: is a given Tier C collection currently empty?
function isEmpty(fullKey) {
  const col = fullKeyToCollection(fullKey);
  const v = storage.get(col);
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function missingTierCKeys() {
  return fullKeysInTier('C').filter(isEmpty);
}

// Write a { fullKey: value } map into storage via the collection API, but only
// for keys that are currently empty. Returns how many were actually restored.
function restoreMap(sourceLabel, map) {
  let restored = 0;
  const restoredKeys = [];
  for (const [fullKey, value] of Object.entries(map)) {
    if (tierOfFullKey(fullKey) !== 'C') continue;
    if (!isEmpty(fullKey)) continue;
    if (value == null) continue;
    try {
      const col = fullKeyToCollection(fullKey);
      storage.set(col, value, { skipValidation: true });
      restored++;
      restoredKeys.push(fullKey);
    } catch (e) {
      console.warn('[self-heal] restore failed from', sourceLabel, 'for', fullKey, e);
    }
  }
  if (restored) {
    console.info(`[self-heal] restored ${restored} key(s) from ${sourceLabel}:`, restoredKeys);
  }
  return { restored, restoredKeys };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function runSelfHeal() {
  const started = Date.now();
  const report = {
    startedAt: new Date().toISOString(),
    missingBefore: missingTierCKeys(),
    layers: [],
    restoredTotal: 0,
  };

  if (report.missingBefore.length === 0) {
    // Everything is present already — either a normal boot or IDB already
    // rehydrated localStorage. Nothing to do.
    report.status = 'intact';
    report.durationMs = Date.now() - started;
    localStorage.setItem(HEAL_LOG_KEY, JSON.stringify(report));
    return report;
  }

  // Layer 1: IndexedDB is already drained into the synchronous cache by
  // hydrateDB() before this runs, so `isEmpty` readings already reflect IDB
  // state. If anything survived there, it's already in place — log and move
  // on to the next layer for the rest.
  report.layers.push({ layer: 'idb', note: 'already hydrated via db.js' });

  // Layer 2: OPFS — independent file system, often survives beyond IDB.
  try {
    if (await opfsAvailable()) {
      const opfsMap = await opfsReadAll();
      const { restored, restoredKeys } = restoreMap('OPFS', opfsMap);
      report.layers.push({ layer: 'opfs', restored, keys: restoredKeys });
      report.restoredTotal += restored;
    } else {
      report.layers.push({ layer: 'opfs', skipped: 'unavailable' });
    }
  } catch (e) {
    report.layers.push({ layer: 'opfs', error: e.message });
  }

  // Layer 3: Cloud-sync. We don't trigger a pull here automatically because
  // it requires the passphrase (held in sessionStorage, which was also cleared
  // if site-data was wiped). Instead we surface the need to re-unlock.
  const stillMissing = missingTierCKeys();
  if (stillMissing.length > 0) {
    const cfg = readCloudPairing();
    report.layers.push({
      layer: 'cloud-sync',
      pairingPresent: cfg.paired,
      note: cfg.paired
        ? 'Paired but locked. User must unlock in Cloud Sync panel to pull.'
        : 'Not paired. Re-pair in Cloud Sync panel to recover.',
    });
  }

  report.missingAfter = missingTierCKeys();
  report.status = report.missingAfter.length === 0
    ? 'healed'
    : (report.restoredTotal > 0 ? 'partial' : 'missing');
  report.durationMs = Date.now() - started;

  localStorage.setItem(HEAL_LOG_KEY, JSON.stringify(report));
  return report;
}

// Read cloud-sync pairing flags directly, without importing the whole module
// (which starts its own side effects). This is a read-only probe.
function readCloudPairing() {
  try {
    const endpoint = localStorage.getItem('arnold:cloud-sync:endpoint');
    const token = localStorage.getItem('arnold:cloud-sync:token');
    const pairId = localStorage.getItem('arnold:cloud-sync:pair-id');
    return {
      paired: !!(endpoint && token && pairId),
      endpoint,
    };
  } catch {
    return { paired: false };
  }
}

// For the Backup Status panel: return the last heal report (if any).
export function getLastHealReport() {
  try {
    const raw = localStorage.getItem(HEAL_LOG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
