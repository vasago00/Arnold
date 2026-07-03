// Monte-Carlo property test — runs the real engine (adaptSession + prescribeFuel +
// composeCalorieTarget) over 10,000 synthetic athlete-days and asserts the
// invariants. Seeded, so it's deterministic and any failure is reproducible from
// the reported seed + indices. Fast (pure functions), so it lives in the normal
// `npm test` suite rather than a separate perf gate.
import { describe, it, expect } from 'vitest';
import { runSim } from './runSim.js';

const SEED = 20260702;
const N_ATHLETES = 400;
const DAYS = 25;

describe('engine simulation — Monte-Carlo property test', () => {
  const report = runSim({ seed: SEED, nAthletes: N_ATHLETES, daysPerAthlete: DAYS });

  it(`runs ${N_ATHLETES * DAYS} cases`, () => {
    expect(report.cases).toBe(N_ATHLETES * DAYS);
  });

  it('holds every HARD invariant across all cases (zero tolerance)', () => {
    const sample = [...report.hardViolations, ...report.monotonicViolations].slice(0, 8);
    expect(
      report.hardViolationCount,
      `${report.hardViolationCount} hard violations. Sample (seed ${SEED}):\n${JSON.stringify(sample, null, 2)}`,
    ).toBe(0);
  });

  it('meets the statistical acceptance margins', () => {
    expect(
      report.aggregateViolations,
      `aggregate margin breaches: ${JSON.stringify(report.aggregateViolations)}\nsummary: ${JSON.stringify(report.summary)}`,
    ).toEqual([]);
  });

  it('produces physiologically plausible output distributions', () => {
    // Sanity floor/ceiling on the whole run (transparency: these are the numbers
    // a human would eyeball). Not a tight assertion — just "nothing absurd."
    expect(report.summary.calorieTarget.min).toBeGreaterThanOrEqual(800);
    expect(report.summary.calorieTarget.max).toBeLessThanOrEqual(6000);
  });
});
