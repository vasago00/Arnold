// Hub core — browser glue + console entry point. Boots the Intelligence Hub from
// the athlete's real stored activities (backfill via the real attribution engine)
// and prints the resulting coaching facts. Read-only: it does NOT persist or
// mutate anything, so it's safe to call anytime from the console:
//
//     window.hubDebug()            // backfill + print fitness predictions + response facts
//     window.hubDebug({ k: 1.12 }) // override the fatigue exponent
//
// Wiring only — no rendering. The testable logic lives in backfill.js / hubFacts.js
// (both node-tested). See docs/HUB_CORE.md.

import { storage } from '../storage.js';
import { attributeOutcome } from '../attribution.js';
import { backfillHub } from './backfill.js';
import { hubFacts } from './hubFacts.js';

// Build a fresh hub from stored history. The attribution engine is the real one;
// each historical race is graded against the hub's own evolving prediction.
export function buildHubFromStorage(opts = {}) {
  const activities = storage.get('activities') || [];
  const attributionFn = (race, { expectedSecs }) =>
    attributeOutcome({ activity: race, expectedSecs, isRaceEffort: true });
  const k = Number.isFinite(opts.k) ? opts.k : 1.06;
  const result = backfillHub(activities, { attributionFn, k, ...opts });
  return { ...result, facts: hubFacts(result.state, { k }) };
}

if (typeof window !== 'undefined') {
  window.hubDebug = (opts = {}) => {
    const { state, trace, count, facts } = buildHubFromStorage(opts);
    console.log(`[hub] backfilled ${count} checkpoint(s) from history`);
    if (facts.refEquivSecs) {
      console.log(`[hub] fitness: 10K-equiv ${facts.refEquivSecs}s (confidence ${facts.fitnessConfidence}) →`,
        facts.predictions.map(p => `${p.dist} ${p.time}`).join('  '));
    } else {
      console.log('[hub] fitness not seeded yet — no qualifying race in history');
    }
    if (facts.responses.length) {
      console.log('[hub] response sensitivities (how conditions cost YOU):');
      facts.responses.forEach(r => console.log('   •', r.text));
    } else {
      console.log('[hub] response model empty — no confounded underperformances to learn from yet');
    }
    return { state, trace, facts };
  };
}
