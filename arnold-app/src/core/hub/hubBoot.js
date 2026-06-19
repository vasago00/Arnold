// Hub core — boot + persistence lifecycle. Makes the hub LOAD on startup and
// SAVE incrementally, so it accumulates across sessions instead of being rebuilt
// from scratch each time. Dependency-injected store ({get,set}) for testability;
// the app passes the real `storage` from core/storage.js. See docs/HUB_GO_LIVE.md
// (Step 2). Unit-tested in tests/hubBoot.test.mjs.

import { HUB_STATE_KEY, loadHubState, saveHubState } from './hubState.js';
import { backfillHub } from './backfill.js';
import { accumulateTrainingSignals, accumulateBodyAndSweat } from './accumulate.js';
import { recordRace } from './raceFitness.js';

// Ensure a hub exists for this session:
//   • if a persisted state is present (and not forced) → LOAD it (cheap, no rebuild)
//   • otherwise → BACKFILL from history, SAVE, and return it
// opts forwards to backfillHub: { activities, attributionFn, k, force }.
export function ensureHub(store, opts = {}) {
  const raw = store && typeof store.get === 'function' ? store.get(HUB_STATE_KEY) : null;
  if (raw && !opts.force) {
    return { state: loadHubState(store, opts), source: 'loaded', count: null };
  }
  const { state, trace, count } = backfillHub(opts.activities || [], opts);
  // Fresh backfill: also sweep all runs for the training-only signals (heatStrain)
  // before persisting. On a LOAD this is skipped — those already live in the saved
  // response model — so we don't double-count.
  const acc = accumulateTrainingSignals(state, opts.activities || [], opts);
  // ...and replay the weight log into the body + sweat ledgers (fasted trend +
  // post-run sweat-rate observations) before persisting.
  const acc2 = accumulateBodyAndSweat(acc.state, opts.activities || [], opts.weightLog || [], opts);
  saveHubState(acc2.state, store);
  return { state: acc2.state, source: raw ? 'rebuilt' : 'backfilled', trace, count, heatLearned: acc.heatLearned, sweatLearned: acc2.sweatLearned };
}

// Record one real race into the persisted hub (incremental update): load → record
// → save. Returns the recordRace result ({ state, ingest, ... }).
export function recordRaceLive(store, race, attribution, opts = {}) {
  const state = loadHubState(store, opts);
  const res = recordRace(state, race, attribution, opts);
  if (res.state) saveHubState(res.state, store);
  return res;
}
