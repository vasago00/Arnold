// Hub go-live Step 1b — distance-aware exponent (kFor): each conversion uses the
// fatigue exponent of its OWN distance span, so a long race no longer folds to an
// over-fast 10K under a single marathon-fade k.
//
// Run with:  node arnold-app/tests/hubKfor.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { observationsFromRace, predictFromFitness, RACE_FITNESS_PARAM } from '../src/core/hub/raceFitness.js';
import { makeFitnessModel } from '../src/core/hub/fitnessModel.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

test('kFor overrides constant k and is applied per span when predicting', () => {
  const fm = makeFitnessModel({ [RACE_FITNESS_PARAM]: { value: 2700, precision: 5 } }); // 45:00 10K-equiv
  const constK = predictFromFitness(fm, 42.195, { k: 1.06 });
  const aware = predictFromFitness(fm, 42.195, { kFor: () => 1.15 });
  assert.equal(aware.k, 1.15, 'used the distance-aware exponent');
  assert.ok(aware.secs > constK.secs, 'steeper marathon exponent → slower (more realistic) marathon');
});

test('gentle fold keeps a long race honest: HM->10K is more conservative than a steep k', () => {
  const hm = { distanceKm: 21.0975, durationSecs: 5400 }; // 1:30 half
  const gentle = observationsFromRace(hm, { kFor: () => 1.07 }); // 10<->HM span exponent
  const steep = observationsFromRace(hm, { k: 1.146 });          // marathon-fade k (the old bug)
  // folding DOWN to 10K with a gentler exponent yields a SLOWER (larger) 10K-equiv
  assert.ok(gentle.meta.equivSecs > steep.meta.equivSecs,
    `gentle fold (${gentle.meta.equivSecs}s) > steep fold (${steep.meta.equivSecs}s) — steep over-states 10K fitness`);
  assert.equal(gentle.meta.k, 1.07, 'fold recorded the span exponent');
});

test('constant-k path still works when no kFor given (back-compat)', () => {
  const o = observationsFromRace({ distanceKm: 10, durationSecs: 2400 }, { k: 1.06 });
  assert.equal(o.meta.equivSecs, 2400, '10K at the reference folds to itself');
  assert.equal(o.meta.k, 1.06);
});

console.log(`\nhubKfor: ${passed} tests passed`);
