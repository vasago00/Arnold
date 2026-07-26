// Plan-model ACCEPTANCE — the periodization engine held to physiological invariants across
// a POPULATION of athletes / goals / race calendars, not a single hand-picked scenario.
// This is the guarantee Emil asked for (2026-07): "a solid model that will last 10,000+
// variations and produce the desired results, not guess work." Every build re-proves it.
//
// It runs the real generateSeasonBlock (via runPlanSim) over thousands of sampled scenarios
// and checks:
//   HARD invariants (zero tolerance): finite targets, never above the goal/base ceiling,
//     long run ≤~42% of the week, ≤10% build ramp, marathon race weeks taper, and ACWR
//     never enters the genuine injury-danger zone (>1.8).
//   STATISTICAL properties: ≥99% of build weeks in the ACWR sweet spot (≤1.5), 100% ramp
//     smoothness, ≥95% peak attainment on reachable goals.
// Determinism: same seed → same result; a failure reports the seed to reproduce.
import { describe, it, expect } from 'vitest';
import { runPlanSim } from '../core/sim/planSim.js';
import { PLAN_AGG_MARGINS, ACWR_SWEET_MAX } from '../core/sim/planInvariants.js';

describe('plan model — Monte-Carlo acceptance across the athlete/goal/race population', () => {
  // A few independent seeds so the guarantee isn't a single lucky sample.
  for (const seed of [20260706, 424242, 987654]) {
    it(`seed ${seed}: zero hard-invariant violations + all statistical margins met`, () => {
      const r = runPlanSim({ seed, nPlans: 1200 });

      // HARD invariants — zero tolerance. On failure the sample carries the sub-seed + inputs.
      expect(r.hardViolationCount, `hard violations: ${JSON.stringify(r.byInvariant)} — e.g. ${JSON.stringify(r.samples[0] || null)}`).toBe(0);

      // STATISTICAL properties — each an auditable margin.
      const acwr = parseFloat(r.statistical.acwrSweetRate);
      expect(acwr, `ACWR ≤${ACWR_SWEET_MAX} sweet-spot rate ${r.statistical.acwrSweetRate}`).toBeGreaterThanOrEqual(PLAN_AGG_MARGINS.acwrSweetSpotMin * 100);

      const ramp = parseFloat(r.statistical.rampSmoothRate);
      expect(ramp, `ramp-smoothness rate ${r.statistical.rampSmoothRate}`).toBeGreaterThanOrEqual(PLAN_AGG_MARGINS.rampSmoothMin * 100);

      const peak = parseFloat(r.statistical.peakAttainRate);
      expect(peak, `peak-attainment rate ${r.statistical.peakAttainRate}`).toBeGreaterThanOrEqual(PLAN_AGG_MARGINS.peakAttainMin * 100);

      // And the aggregate checker (same margins, engine-side) agrees.
      expect(r.aggregateViolations, JSON.stringify(r.aggregateViolations)).toHaveLength(0);
      expect(r.ok).toBe(true);
    });
  }

  it('the ACWR hard ceiling is never breached (no build week in genuine danger)', () => {
    const r = runPlanSim({ seed: 20260706, nPlans: 2000 });
    // Max ACWR observed stays under the 1.8 hard ceiling (elevated resumes allowed, danger not).
    expect(r.statistical.acwrMax).toBeLessThanOrEqual(1.8);
  });
});
