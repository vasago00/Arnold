// Multi-sport battle-test — the single-sport marathon sample only ever exercised
// running templates. This runs the SAME real engine (adaptSession / prescribeFuel /
// composeCalorieTarget) over runner, triathlete, cyclist and hybrid athletes, whose
// day-streams add long bike/swim/row burns the runner never produces, and asserts
// the invariants hold for EACH discipline — not just in aggregate. Deterministic.
import { describe, it, expect } from 'vitest';
import { runSim } from './runSim.js';

const SEED = 20260723;
const N_ATHLETES = 600;   // enough that every discipline gets a healthy sample
const DAYS = 30;

describe('multi-sport simulation — every discipline battle-tested', () => {
  const report = runSim({ seed: SEED, nAthletes: N_ATHLETES, daysPerAthlete: DAYS });
  const DISCIPLINES = ['runner', 'triathlete', 'cyclist', 'hybrid'];

  it('exercises all four disciplines with a real sample each', () => {
    for (const d of DISCIPLINES) {
      expect(report.byDiscipline[d], `discipline ${d} was never generated`).toBeTruthy();
      expect(report.byDiscipline[d].cases, `discipline ${d} got too few cases`).toBeGreaterThan(200);
    }
  });

  it('holds every HARD invariant for EACH discipline (zero tolerance, per sport)', () => {
    const offenders = DISCIPLINES
      .map(d => ({ d, v: report.byDiscipline[d]?.hardViolations || 0 }))
      .filter(x => x.v > 0);
    const sample = [...report.hardViolations, ...report.monotonicViolations].slice(0, 8);
    expect(
      offenders,
      `per-discipline hard violations (seed ${SEED}): ${JSON.stringify(offenders)}\nsample:\n${JSON.stringify(sample, null, 2)}`,
    ).toEqual([]);
  });

  it('meets the statistical acceptance margins across the mixed population', () => {
    expect(report.aggregateViolations, JSON.stringify(report.aggregateViolations)).toEqual([]);
  });

  it('keeps calorie targets physiological even on big bike/tri burn days', () => {
    // The point of adding long rides: verify the eat-back stacking never produces an
    // absurd target. Stays inside the same [800, 6000] human band the runner sample did.
    expect(report.summary.calorieTarget.min).toBeGreaterThanOrEqual(800);
    expect(report.summary.calorieTarget.max).toBeLessThanOrEqual(6000);
  });
});
