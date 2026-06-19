// @vitest-environment node
// CONTROL: "one race number everywhere." The race model (predictFromFitness) is
// configurable, and a caller that passes partial opts gets a different — over-
// optimistic — time. That is exactly the bug where the Coach showed 46:17 while
// every race surface showed 48:49: CoachComment called hubFacts(state, {}) with
// empty opts, skipping the personal fatigue exponent + extrapolation penalty.
// These tests lock the contract so it can't silently drift again.
import { describe, it, expect } from 'vitest';
import { hubFacts } from '../hub/hubFacts.js';
import { predictFromFitness } from '../hub/raceFitness.js';
import { racePredictionOpts } from './tileMetrics.js';

const fit = { params: { ref10kEquivSecs: { value: 2777, precision: 4 } } }; // ~46:17 ref 10K
const state = { fitness: fit, response: { factors: {} } };

describe('race prediction — single source of truth', () => {
  it('Coach (hubFacts) and the race engine agree for identical opts', () => {
    const opts = racePredictionOpts([]);
    const coach10k = hubFacts(state, opts).predictions.find(p => p.dist === '10K').secs;
    const engine10k = predictFromFitness(fit, 10, opts).secs;
    expect(coach10k).toBe(engine10k);
  });

  it('the extrapolation-conservatism penalty is real and material (the bug class)', () => {
    // Old Coach path: empty opts → no racedKms → no penalty (over-optimistic).
    const cheap = predictFromFitness(fit, 10, {}).secs;
    // Calibrated: fitness validated only at the half → 10K is an extrapolation.
    const calibrated = predictFromFitness(fit, 10, { racedKms: [21.0975] }).secs;
    expect(calibrated).toBeGreaterThan(cheap);
    // The gap is the ~5% that separated 46:17 from 48:49 — not a rounding wobble.
    expect((calibrated - cheap) / cheap).toBeGreaterThan(0.03);
  });
});
