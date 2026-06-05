// Hub core cut 4 — race ↔ fitness inversion: fold a real race into the fitness
// ledger and predict any distance back out, consistent with Riegel.
//
// Run with:  node arnold-app/tests/hubRaceFitness.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import {
  raceEquivSecs, observationsFromRace, predictFromFitness, recordRace,
  RACE_FITNESS_PARAM, REF_KM,
} from '../src/core/hub/raceFitness.js';
import { createHubState } from '../src/core/hub/hubState.js';
import { getParam } from '../src/core/hub/fitnessModel.js';
import { sensitivityOf } from '../src/core/hub/responseModel.js';

let passed = 0;
const approx = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const K = 1.06;

test('raceEquivSecs: identity at the reference distance, Riegel-normalized elsewhere', () => {
  approx(raceEquivSecs(REF_KM, 2400, K), 2400, 1e-9, '10K → itself');
  // a 1:30 half (21.1km, 5400s) normalizes to a faster 10K-equiv
  const eq = raceEquivSecs(21.1, 5400, K);
  assert.ok(eq < 5400 && eq > 2000, `HM→10K equiv in range, got ${eq}`);
  approx(eq, 5400 * Math.pow(REF_KM / 21.1, K), 1e-9, 'matches the formula');
});

test('observationsFromRace: accepts mi or km, rejects non-races', () => {
  const fromKm = observationsFromRace({ distanceKm: 10, durationSecs: 2400 }, { k: K });
  approx(fromKm.paramObservations[0].observedValue, 2400, 1e-9);
  assert.equal(fromKm.paramObservations[0].param, RACE_FITNESS_PARAM);

  const fromMi = observationsFromRace({ distanceMi: 6.2137, durationSecs: 2400 }, { k: K }); // ≈10km
  approx(fromMi.meta.distanceKm, 10, 1e-3, 'mi→km');

  assert.equal(observationsFromRace({ distanceKm: 0.5, durationSecs: 200 }), null, 'too short');
  assert.equal(observationsFromRace({ durationSecs: 2400 }), null, 'no distance');
  assert.equal(observationsFromRace(null), null, 'null');
});

test('predict round-trips: a logged 10K predicts itself, and unfolds to other distances', () => {
  // seed fitness with a clean 40:00 10K (no confounders, race-graded)
  const race = { distanceKm: 10, durationSecs: 2400 };
  const attribution = { verdict: 'as-expected', divergencePct: 0.0, effort: 'hard', acute: [], chronic: [] };
  const { state } = recordRace(createHubState(), race, attribution, { k: K });

  approx(getParam(state.fitness, RACE_FITNESS_PARAM).value, 2400, 1e-9, 'fitness seeded to the 10K equiv');

  const p10 = predictFromFitness(state.fitness, 10, { k: K });
  approx(p10.secs, 2400, 0.5, 'predicts the 10K back');

  const pHM = predictFromFitness(state.fitness, 21.1, { k: K });
  approx(pHM.secs, Math.round(2400 * Math.pow(21.1 / 10, K)), 1, 'unfolds to the half');
  assert.ok(pHM.secs > 2400, 'longer distance → slower time');
});

test('recordRace folds a CONFOUNDED race into both ledgers', () => {
  // hot, under-slept HM run 3% slower than the prior fitness implied
  const race = { distanceMi: 13.1, durationSecs: 5562 };
  const attribution = {
    verdict: 'underperformed', divergencePct: 0.03, effort: 'hard',
    acute: [
      { factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 },
      { factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 0.6 },
    ],
    chronic: [],
  };
  const seeded = createHubState({ fitnessPriors: { [RACE_FITNESS_PARAM]: { value: 2400, precision: 10 } } });
  const { state, ingest, fitnessObs } = recordRace(seeded, race, attribution, { k: K });

  assert.ok(fitnessObs.equivSecs > 2400, 'the hot race normalized to a slower-than-true equiv');
  // fitness barely moves (established prior + confound-damped precision)
  assert.ok(Math.abs(getParam(state.fitness, RACE_FITNESS_PARAM).value - 2400) < 30, 'fitness held against the confounded read');
  // the 3% residual went to the response model
  assert.ok(sensitivityOf(state.response, 'heat').value > 0, 'heat sensitivity learned');
  assert.ok(ingest.response.applied, 'response ledger engaged');
});

test('recordRace skips a non-running result (e.g. HYROX with no distance/time pair)', () => {
  const out = recordRace(createHubState(), { type: 'hyrox' }, { verdict: 'no-expectation', divergencePct: null, acute: [] });
  assert.equal(out.ingest, null);
  assert.ok(/not a usable running result/.test(out.skipped));
  assert.deepEqual(out.state.fitness.params, {}, 'nothing seeded');
});

console.log(`\nhubRaceFitness: ${passed} tests passed`);
