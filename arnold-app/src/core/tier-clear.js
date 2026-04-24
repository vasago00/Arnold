// ─── Tier-Aware Clear Operations ────────────────────────────────────────────
// Three scoped clear actions that replace the old "nuke everything" flow:
//
//   clearTierA()   → drop ephemeral cache (events, diagnostics, AI cache).
//                    Never asks, never warns — these are fine to lose.
//
//   clearTierAB()  → drop cache AND imported data (activities, hrv, sleep,
//                    weight, cronometer). User re-imports from source files.
//                    Profile, goals, etc. untouched.
//
//   factoryReset() → drop EVERYTHING including Tier C. Double-confirm at the
//                    call site; also wipes the OPFS mirror so it can't self-
//                    heal back into life.
//
// Chrome's DevTools "Clear site data" is still nuclear and we can't intercept
// it, but now every in-app button is tier-scoped and safe by default.

import { KEYS, storage } from './storage.js';
import { collectionsInTier, fullKeysInTier } from './storage-tiers.js';
import { opfsDelete, opfsWipe } from './persist-opfs.js';

function clearFullKey(fullKey) {
  try { localStorage.removeItem(fullKey); } catch {}
  try { localStorage.removeItem(fullKey + ':plain'); } catch {}
}

export function clearTierA() {
  const cleared = [];
  for (const col of collectionsInTier('A')) {
    const fullKey = KEYS[col];
    if (!fullKey) continue;
    clearFullKey(fullKey);
    cleared.push(col);
  }
  return { tier: 'A', cleared };
}

export function clearTierAB() {
  const cleared = [];
  for (const col of [...collectionsInTier('A'), ...collectionsInTier('B')]) {
    const fullKey = KEYS[col];
    if (!fullKey) continue;
    clearFullKey(fullKey);
    cleared.push(col);
  }
  return { tier: 'A+B', cleared };
}

// Factory reset: also wipes OPFS so the self-heal won't rescue it.
export async function factoryReset() {
  const cleared = [];
  for (const col of Object.keys(KEYS)) {
    const fullKey = KEYS[col];
    if (!fullKey) continue;
    clearFullKey(fullKey);
    cleared.push(col);
  }
  // Tier C also has an OPFS mirror — wipe it.
  try { await opfsWipe(); } catch {}
  // Session crypto key (for encrypted collections) is in sessionStorage
  try { sessionStorage.removeItem('arnold:session-crypto-key'); } catch {}
  return { tier: 'ALL', cleared };
}

// Selective OPFS-aware Tier C wipe (used when someone wants to abandon a
// specific collection cleanly, e.g. from a debug tool). Keeps the OPFS and
// localStorage states in sync so the next boot's self-heal doesn't resurrect
// stale data.
export async function clearCollection(collectionName) {
  const fullKey = KEYS[collectionName];
  if (!fullKey) return { cleared: false, reason: 'unknown collection' };
  clearFullKey(fullKey);
  if (fullKeysInTier('C').includes(fullKey)) {
    try { await opfsDelete(fullKey); } catch {}
  }
  return { cleared: true, collection: collectionName };
}
