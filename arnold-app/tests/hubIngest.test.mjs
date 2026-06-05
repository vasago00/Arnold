// Hub core cut 2 — fitness ledger (with clamps), checkpoint grading, and the
// ingestCheckpoint router that drives both ledgers from one graded effort.
//
// Run with:  node arnold-app/tests/hubIngest.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { makeFitnessModel, updateFitness, getParam } from '../src/core/hub/fitnessModel.js';
import { makeResponseModel, predictPenalty, sensitivityOf } from '../src/core/hub/responseModel.js';
import { gradeCheckpoint, ingestCheckpoint } from '../src/core/hub/ingestCheckpoint.js';

let passed = 0;
const approx = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

// ── fitness ledger ──────────────────────────────────────────────────────────
test('first observation on a naive param takes the value', () => {
  const m = makeFitnessModel({ thresholdPaceSecPerKm: 250 });
  const r = updateFitness(m, 'thresholdPaceSecPerKm', 248, 1);
  assert.ok(r.log.applied);
  approx(getParam(r.model, 'thresholdPaceSecPerKm').value, 248, 1e-9);
});

test('absolute clamp REJECTS a physiologically impossible value', () => {
  const m = makeFitnessModel({});
  const r = updateFitness(m, 'fatigueExponentK', 1.4, 1); // outside [1.0,1.25]
  assert.equal(r.log.applied, false);
  assert.equal(r.log.rejected, true);
  assert.equal(r.model.params.fatigueExponentK, undefined, 'model unchanged');
});

test('rate clamp bounds an implausibly large weekly shift', () => {
  const m = makeFitnessModel({ thresholdPaceSecPerKm: { value: 240, precision: 5 } });
  const r = updateFitness(m, 'thresholdPaceSecPerKm', 200, 1, { ageWeeks: 1 }); // band ±4
  assert.equal(r.log.clamped, true);
  assert.ok(/rate-clamped/.test(r.log.reason));
  const v = getParam(r.model, 'thresholdPaceSecPerKm').value;
  assert.ok(v > 238 && v < 240, `clamped toward 236 band, got ${v}`);
});

// ── grading ─────────────────────────────────────────────────────────────────
test('grade: clean hard effort = full precision; confounds + easy lower it', () => {
  const clean = gradeCheckpoint({ divergencePct: 0.0, effort: 'hard', acute: [] });
  approx(clean.obsPrecision, 1, 1e-9, 'clean hard');

  const confounded = gradeCheckpoint({ divergencePct: 0.03, effort: 'hard', acute: [
    { factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 },
    { factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 0.6 },
  ] });
  approx(confounded.obsPrecision, 1 / (1 + 1.4), 1e-9, 'confounded hard'); // 0.4167
  assert.ok(confounded.obsPrecision < clean.obsPrecision, 'confounds reduce precision');

  const easy = gradeCheckpoint({ divergencePct: 0.0, effort: 'easy', acute: [] });
  approx(easy.obsPrecision, 0.25, 1e-9, 'easy weighted down');

  const none = gradeCheckpoint({ divergencePct: null, effort: 'hard', acute: [] });
  assert.equal(none.hasExpectation, false, 'no prediction to compare against');
  assert.equal(none.responseable, false, 'no residual to attribute');
  approx(none.obsPrecision, 1, 1e-9, 'but a hard effort is still a full fitness read');
});

// ── router: the two-ledger loop ───────────────────────────────────────────────
test('confounded race: fitness barely moves, residual goes to the response model', () => {
  const state = {
    fitnessModel: makeFitnessModel({ thresholdPaceSecPerKm: { value: 250, precision: 10 } }), // well-established
    responseModel: makeResponseModel(),
  };
  const attribution = {
    verdict: 'underperformed', divergencePct: 0.03, effort: 'hard',
    acute: [
      { factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 },
      { factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 0.6 },
    ],
    chronic: [],
  };
  const out = ingestCheckpoint(state, attribution, {
    paramObservations: [{ param: 'thresholdPaceSecPerKm', observedValue: 258 }], // race "looked" slower
  });

  // Fitness: established prior + low-precision confounded obs → moves <0.5s.
  const v = getParam(out.fitnessModel, 'thresholdPaceSecPerKm').value;
  assert.ok(Math.abs(v - 250) < 0.5, `fitness barely moved, got ${v}`);

  // Response: the 3% residual partitioned to heat + sleep, and reconstructs.
  approx(sensitivityOf(out.responseModel, 'heat').value, 0.004, 1e-9, 'heat sensitivity');
  approx(sensitivityOf(out.responseModel, 'sleep').value, 0.003, 1e-9, 'sleep sensitivity');
  const p = predictPenalty(out.responseModel, [{ factor: 'heat', magnitude: 6 }, { factor: 'sleep', magnitude: 2 }]);
  approx(p.penalty, 0.03, 1e-9, 'reconstructed residual');
  assert.ok(out.log.response.applied && out.log.response.moved.length === 2);
});

test('no-expectation effort still SEEDS fitness from a provided observation (no prediction needed)', () => {
  const state = { fitnessModel: makeFitnessModel({}), responseModel: makeResponseModel() };
  const attribution = { verdict: 'no-expectation', divergencePct: null, effort: 'hard', acute: [], chronic: [] };
  const out = ingestCheckpoint(state, attribution, {
    paramObservations: [{ param: 'thresholdPaceSecPerKm', observedValue: 258 }],
  });
  assert.ok(out.log.fitness[0].applied, 'a first race seeds fitness even with no expectation');
  approx(getParam(out.fitnessModel, 'thresholdPaceSecPerKm').value, 258, 1e-9);
  assert.equal(out.log.response.applied, false, 'no residual → response stays out');
  assert.ok(/no expectation/.test(out.log.response.reason));
});

test('an effort with NO fitness observation (e.g. a hybrid HYROX) moves nothing', () => {
  const state = {
    fitnessModel: makeFitnessModel({ thresholdPaceSecPerKm: { value: 250, precision: 10 } }),
    responseModel: makeResponseModel(),
  };
  const attribution = { verdict: 'no-expectation', divergencePct: null, effort: 'hard',
    acute: [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 }], chronic: [] };
  const out = ingestCheckpoint(state, attribution, { paramObservations: [] });
  assert.equal(out.fitnessModel, state.fitnessModel, 'no fitness obs → untouched (same ref)');
  assert.equal(out.responseModel, state.responseModel, 'no residual → untouched (same ref)');
});

test('overperformance: response ledger stays out of it (it is a fitness signal)', () => {
  const state = {
    fitnessModel: makeFitnessModel({ thresholdPaceSecPerKm: { value: 250, precision: 5 } }),
    responseModel: makeResponseModel(),
  };
  const attribution = { verdict: 'overperformed', divergencePct: -0.02, effort: 'hard',
    acute: [{ factor: 'heat', timescale: 'acute', magnitude: 5, confidence: 0.7 }], chronic: [] };
  const out = ingestCheckpoint(state, attribution, {
    paramObservations: [{ param: 'thresholdPaceSecPerKm', observedValue: 244 }],
  });
  assert.equal(out.log.response.applied, false, 'no response update on overperformance');
  assert.ok(/fitness signal/.test(out.log.response.reason));
  assert.ok(out.log.fitness[0].applied, 'fitness still updates');
  assert.equal(sensitivityOf(out.responseModel, 'heat').value, null, 'heat sensitivity not learned from a beat');
});

console.log(`\nhubIngest: ${passed} tests passed`);
