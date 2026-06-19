// Tests for extrapolation-conservatism penalty in predictFromFitness.
import assert from 'node:assert/strict';
import test from 'node:test';
import { predictFromFitness } from '../src/core/hub/raceFitness.js';

const fit = { params: { ref10kEquivSecs: { value: 2777, precision: 5 } } };

test('no racedKms → no penalty (model stays pure for internal calls)', () => {
  const p = predictFromFitness(fit, 10);
  assert.equal(p.extrapPenalty, 0);
  assert.equal(p.secs, 2777);
});

test('predicting AT a raced distance → no penalty (exact)', () => {
  const p = predictFromFitness(fit, 10, { racedKms: [10] });
  assert.equal(p.extrapPenalty, 0);
  assert.equal(p.secs, 2777);
});

test('predicting FAR from raced distances → time nudged up (more conservative)', () => {
  const base = predictFromFitness(fit, 10).secs;                       // 2777 (raw 10K)
  const cons = predictFromFitness(fit, 10, { racedKms: [21.0975] });   // only raced the half
  assert.ok(cons.extrapPenalty > 0, 'penalty should apply');
  assert.ok(cons.secs > base, `${cons.secs} should exceed ${base}`);
  assert.ok(cons.extrapPenalty <= 0.06, 'capped at 6%');
});

test('penalty grows with the log-distance gap and caps at 6%', () => {
  const tenK = predictFromFitness(fit, 10, { racedKms: [21.0975] }).extrapPenalty;  // ~0.75 gap
  const fiveK = predictFromFitness(fit, 5, { racedKms: [21.0975] }).extrapPenalty;  // ~1.44 gap → cap
  assert.ok(fiveK >= tenK, '5K (further) ≥ 10K penalty');
  assert.equal(fiveK, 0.06);
});

test('nearest raced distance wins when several exist', () => {
  // raced 10K and HM; predicting 10K → 0 penalty (exact match to a raced distance)
  const p = predictFromFitness(fit, 10, { racedKms: [10, 21.0975] });
  assert.equal(p.extrapPenalty, 0);
});
