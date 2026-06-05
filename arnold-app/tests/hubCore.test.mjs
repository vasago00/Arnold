// Hub core — unit tests for the Bayesian Estimate primitive and the Response
// model (the two-ledger math). Pure logic, no fixtures needed.
//
// Run with:  node arnold-app/tests/hubCore.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import {
  makeEstimate, updateEstimate, decayPrecision, confidence,
} from '../src/core/hub/estimate.js';
import {
  makeResponseModel, observeOutcome, predictPenalty, sensitivityOf,
} from '../src/core/hub/responseModel.js';

let passed = 0;
const approx = (a, b, tol = 1e-9, msg = '') => {
  assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
};
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

// ── Estimate primitive ──────────────────────────────────────────────────────
test('naive prior takes the observation', () => {
  const e = updateEstimate(makeEstimate(0, 0), 20, 2);
  approx(e.value, 20, 1e-9, 'value');
  approx(e.precision, 2, 1e-9, 'precision');
});

test('established prior barely moves; naive prior moves a lot', () => {
  const strong = updateEstimate(makeEstimate(10, 100), 20, 1); // 1020/101
  approx(strong.value, 1020 / 101, 1e-9, 'strong prior');
  assert.ok(strong.value < 10.2, 'strong prior should move <0.2');

  const weak = updateEstimate(makeEstimate(10, 1), 20, 1); // (10+20)/2
  approx(weak.value, 15, 1e-9, 'weak prior');
});

test('precision accumulates across observations', () => {
  let e = makeEstimate(0, 0);
  e = updateEstimate(e, 5, 1);
  e = updateEstimate(e, 5, 1);
  e = updateEstimate(e, 5, 2);
  approx(e.precision, 4, 1e-9, 'precision sum');
  approx(e.value, 5, 1e-9, 'consistent obs → stable value');
});

test('decayPrecision halves precision each half-life, leaves value', () => {
  const e = decayPrecision(makeEstimate(5, 8), 4, 4); // one half-life
  approx(e.precision, 4, 1e-9, 'precision halved');
  approx(e.value, 5, 1e-9, 'value untouched');
  const e2 = decayPrecision(makeEstimate(5, 8), 8, 4); // two half-lives
  approx(e2.precision, 2, 1e-9, 'precision quartered');
});

test('confidence is saturating and monotonic', () => {
  approx(confidence(makeEstimate(0, 1), 1), 0.5, 1e-9, 'p=k0 → 0.5');
  assert.ok(confidence(makeEstimate(0, 10), 1) > confidence(makeEstimate(0, 1), 1), 'more precision → more confidence');
  assert.ok(confidence(makeEstimate(0, 0), 1) === 0, 'no info → 0');
});

test('updateEstimate ignores junk observations', () => {
  const e0 = makeEstimate(3, 5);
  assert.deepEqual(updateEstimate(e0, NaN, 1), e0, 'NaN obs ignored');
  assert.deepEqual(updateEstimate(e0, 7, 0), e0, 'zero precision ignored');
});

// ── Response model ──────────────────────────────────────────────────────────
test('single acute factor: sensitivity = residual / magnitude', () => {
  // ran 3% slow, all attributable to 6°C of excess heat, fully confident
  const m = observeOutcome(makeResponseModel(), 0.03,
    [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 1 }]);
  const s = sensitivityOf(m, 'heat');
  approx(s.value, 0.03 / 6, 1e-9, 'per-°C sensitivity'); // 0.005
  // predicting the same 6°C reconstructs the 3% penalty
  const p = predictPenalty(m, [{ factor: 'heat', magnitude: 6 }]);
  approx(p.penalty, 0.03, 1e-9, 'reconstructed penalty');
});

test('two acute factors partition the residual by magnitude·confidence', () => {
  // residual 0.04 split across heat(mag4,conf1,w4) and sleep(mag2,conf1,w2); Σw=6
  const m = observeOutcome(makeResponseModel(), 0.04, [
    { factor: 'heat',  timescale: 'acute', magnitude: 4, confidence: 1 },
    { factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 1 },
  ]);
  // predicting today's same conditions should reconstruct the full residual,
  // and no more (shares sum to ≤ divergence — no double counting)
  const p = predictPenalty(m, [
    { factor: 'heat', magnitude: 4 },
    { factor: 'sleep', magnitude: 2 },
  ]);
  approx(p.penalty, 0.04, 1e-9, 'partition reconstructs residual');
  assert.ok(p.byFactor.heat.contrib > p.byFactor.sleep.contrib, 'bigger insult owns more blame');
});

test('chronic factors and empty/zero inputs do not move the response model', () => {
  const base = makeResponseModel();
  const onlyChronic = observeOutcome(base, 0.05,
    [{ factor: 'acwr', timescale: 'chronic', magnitude: 0.3, confidence: 1 }]);
  assert.deepEqual(onlyChronic, base, 'chronic ignored');
  assert.deepEqual(observeOutcome(base, 0, [{ factor: 'heat', timescale: 'acute', magnitude: 4, confidence: 1 }]), base, 'zero divergence');
  assert.deepEqual(observeOutcome(base, 0.03, []), base, 'no factors');
});

test('repeated consistent observations converge and grow confidence', () => {
  let m = makeResponseModel();
  const obs = [{ factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 1 }];
  m = observeOutcome(m, 0.02, obs); // sensitivity 0.01/unit
  const c1 = sensitivityOf(m, 'sleep').confidence;
  for (let i = 0; i < 5; i++) m = observeOutcome(m, 0.02, obs);
  const s = sensitivityOf(m, 'sleep');
  approx(s.value, 0.01, 1e-9, 'converged sensitivity');
  assert.ok(s.confidence > c1, 'confidence grows with evidence');
});

test('predictPenalty hedges (low confidence) before evidence accumulates', () => {
  const m = observeOutcome(makeResponseModel(), 0.02,
    [{ factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 0.4 }]);
  const p = predictPenalty(m, [{ factor: 'sleep', magnitude: 2 }]);
  assert.ok(p.confidence < 0.5, 'one weak obs → low confidence');
  // unknown factor contributes nothing
  const p2 = predictPenalty(m, [{ factor: 'unseen', magnitude: 5 }]);
  approx(p2.penalty, 0, 1e-9, 'unknown factor → no penalty');
});

console.log(`\nhubCore: ${passed} tests passed`);
