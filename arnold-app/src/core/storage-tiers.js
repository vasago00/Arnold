// ─── Arnold Storage Tiers ────────────────────────────────────────────────────
// Single source of truth for how every persisted key is classified. The tier
// dictates:
//   • How many durability layers the write goes to (Tier C > B > A).
//   • What a given "clear" operation actually wipes.
//   • Whether the startup self-heal treats missing data as a recoverable
//     disaster vs. a normal first-run state.
//
// Tiers:
//
//   A (ephemeral):  pure runtime cache. Fine to lose on any clear, any day.
//                   Lives only in localStorage; no OPFS mirror, no cloud push.
//                   Examples: aiCache, events, diagnostics, importHistory.
//
//   B (rebuildable): data that was imported from a source file the user owns.
//                   Losing it is annoying but recoverable by re-dropping the
//                   CSV / FIT. Mirrored to IndexedDB + cloud-sync; NOT
//                   auto-exported (user can re-generate).
//                   Examples: activities, hrv, sleep, weight, cronometer.
//
//   C (critical):   user-typed config or logs that has no other source on
//                   earth. MUST NEVER BE LOST to a cache clear, a browser
//                   reset, or a site-data wipe.
//                   Durability: localStorage + IndexedDB + OPFS + auto-
//                   download to Downloads + cloud-sync (if paired).
//                   Startup self-heal checks every layer; empty state shown
//                   only when ALL layers report empty.
//                   Examples: profile, goals, races, dailyLogs, workouts,
//                   strengthTemplates, supplementsStack, supplementsLog,
//                   supplementsCatalog, nutritionLog, planner, logs.

import { KEYS } from './storage.js';

// ── Tier assignments, by collection name (the key in KEYS map) ──────────────
// Anything added to KEYS but not listed here is treated as Tier C by default,
// on the principle that "when in doubt, keep it safe."

export const TIER_A = new Set([
  'events',
  'diagnostics',
  'importHistory',
  'aiCache',
]);

export const TIER_B = new Set([
  'activities',
  'hrv',
  'sleep',
  'weight',
  'cronometer',
]);

export const TIER_C = new Set([
  'profile',
  'goals',
  'races',
  'dailyLogs',
  'workouts',
  'strengthTemplates',
  'supplementsStack',
  'supplementsLog',
  'supplementsCatalog',
  'nutritionLog',
  'planner',
  'logs',
]);

// ── Public classifier ────────────────────────────────────────────────────────

export function tierOf(collection) {
  if (TIER_A.has(collection)) return 'A';
  if (TIER_B.has(collection)) return 'B';
  if (TIER_C.has(collection)) return 'C';
  // Default: if it's persisted but not explicitly classified, treat as C.
  return 'C';
}

// Resolve a full storage key (e.g. 'arnold:goals') back to its tier.
// Useful for storage-layer hooks that see the full key, not the collection.
const _fullKeyTier = new Map();
for (const [col, fullKey] of Object.entries(KEYS)) {
  _fullKeyTier.set(fullKey, tierOf(col));
}
export function tierOfFullKey(fullKey) {
  return _fullKeyTier.get(fullKey) || 'C';
}

// Collections by tier, for bulk operations (export, clear, heal).
export function collectionsInTier(tier) {
  if (tier === 'A') return [...TIER_A];
  if (tier === 'B') return [...TIER_B];
  if (tier === 'C') return [...TIER_C];
  return [];
}

export function fullKeysInTier(tier) {
  return collectionsInTier(tier)
    .map(col => KEYS[col])
    .filter(Boolean);
}

// Snapshot of a tier — returns { [fullKey]: value } for every key in that tier
// that currently has data. Used by exporters and the self-heal writer.
export function snapshotTier(tier, getter) {
  const out = {};
  for (const fullKey of fullKeysInTier(tier)) {
    const v = getter(fullKey);
    if (v != null) out[fullKey] = v;
  }
  return out;
}

// Expose the inverse too, for diagnostics displays.
export function describeTier(tier) {
  const map = {
    A: {
      label: 'Ephemeral cache',
      durability: 'localStorage only',
      recovery: 'Regenerates on next use',
      color: '#6b7280',
    },
    B: {
      label: 'Imported data',
      durability: 'localStorage + IndexedDB + cloud-sync',
      recovery: 'Re-drop source CSV/FIT files',
      color: '#60a5fa',
    },
    C: {
      label: 'Critical user config',
      durability: 'localStorage + IndexedDB + OPFS + auto-download + cloud-sync',
      recovery: 'Self-heal on boot from any surviving layer',
      color: '#f59e0b',
    },
  };
  return map[tier] || map.C;
}
