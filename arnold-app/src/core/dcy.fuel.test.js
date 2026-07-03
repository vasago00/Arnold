// Golden failure-matrix for the DCY fuel scorer (DATA_INTEGRITY_PLAN Phase 3).
// fuelScore is the PURE core of fuelResult (IO stripped out) so the exact
// "Fuel 92% with no food" regression is locked behind a unit test. N stays
// numeric (the DCY formula needs it); status carries the honesty.
import { describe, it, expect } from 'vitest';
import { fuelScore } from './dcy.js';

const TDEE = 2077, PRO = 170, WATER = 3; // representative targets

describe('fuelScore — the named regression', () => {
  it('{food=0, water logged, tracker}: NO fabricated %, returns no-data (N=0)', () => {
    const r = fuelScore({ intakeCal: 0, intakeProtein: 0, intakeWaterL: 2.5, isTracker: true, tdee: TDEE, proteinGoal: PRO, waterGoalL: WATER });
    expect(r.status).toBe('no-data');     // not 'ok'
    expect(r.N).toBe(0);                  // never ~0.92
  });
  it('{nothing at all, tracker}: no-data', () => {
    const r = fuelScore({ isTracker: true, tdee: TDEE, proteinGoal: PRO, waterGoalL: WATER });
    expect(r.status).toBe('no-data');
    expect(r.N).toBe(0);
  });
});

describe('fuelScore — honest scoring when food IS logged', () => {
  it('a full on-target day scores high', () => {
    const r = fuelScore({ intakeCal: 2050, intakeProtein: 165, intakeWaterL: 2.8, isTracker: true, tdee: TDEE, proteinGoal: PRO, waterGoalL: WATER });
    expect(r.status).toBe('ok');
    expect(r.N).toBeGreaterThan(0.9);
  });
  it('food logged but 0 protein: protein scored LOW (not dropped), N drops below full', () => {
    const r = fuelScore({ intakeCal: 1900, intakeProtein: 0, intakeWaterL: 2.5, isTracker: true, tdee: TDEE, proteinGoal: PRO, waterGoalL: WATER });
    expect(r.status).toBe('ok');
    expect(r.N).toBeLessThan(0.8);        // the 0-protein factor pulls it down
    expect(r.N).toBeGreaterThan(0);
  });
});

describe('fuelScore — user does not track nutrition', () => {
  it('{nothing, NOT a tracker}: neutral N=1, not-tracked (never penalizes)', () => {
    const r = fuelScore({ isTracker: false, tdee: TDEE, proteinGoal: PRO, waterGoalL: WATER });
    expect(r.status).toBe('not-tracked');
    expect(r.N).toBe(1);
  });
});
