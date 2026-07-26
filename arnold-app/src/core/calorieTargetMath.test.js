// Unit tests for the extracted calorie-target composition — the exact formula the
// app uses (goalModel delegates here), so these lock the 2026-07-01 fix directly.
import { describe, it, expect } from 'vitest';
import { composeCalorieTarget, describeEatBack } from './calorieTargetMath.js';

describe('composeCalorieTarget', () => {
  it('never returns below the RMR floor', () => {
    // Deep deficit pushes maintenance under RMR → floored at RMR.
    const r = composeCalorieTarget({ baseTarget: 1300, recoveryAdj: 0, eatBack: 0, flatBonus: 0, rmr: 1880, debt: 0 });
    expect(r.derived).toBe(1880);
    expect(r.floored).toBe(true);
  });

  it('stacks eat-back ON TOP of the floor (the 2026-07-01 bug)', () => {
    // base below floor → floored to RMR, then eat-back added: 1880 + 163.
    const r = composeCalorieTarget({ baseTarget: 1334, recoveryAdj: 0, eatBack: 163, flatBonus: 0, rmr: 1880, debt: 0 });
    expect(r.derived).toBe(2043);
  });

  it('eat-back always raises the target vs the same day with none', () => {
    const args = { baseTarget: 1334, recoveryAdj: 0, flatBonus: 0, rmr: 1880, debt: 0 };
    const withEB = composeCalorieTarget({ ...args, eatBack: 163 }).derived;
    const noEB = composeCalorieTarget({ ...args, eatBack: 0 }).derived;
    expect(withEB).toBeGreaterThan(noEB);
  });

  it('uses maintenance when it is above the floor (no flooring)', () => {
    const r = composeCalorieTarget({ baseTarget: 2400, recoveryAdj: 50, eatBack: 0, flatBonus: 0, rmr: 1880, debt: 0 });
    expect(r.derived).toBe(2450);
    expect(r.floored).toBe(false);
  });

  it('lifts the floor by 100 when chronic recovery debt is high', () => {
    const r = composeCalorieTarget({ baseTarget: 1300, recoveryAdj: 0, eatBack: 0, flatBonus: 0, rmr: 1880, debt: 2 });
    expect(r.effectiveFloor).toBe(1980);
    expect(r.derived).toBe(1980);
  });
});

describe('composeCalorieTarget — upper safety guard (relative cap, ~2.5× RMR)', () => {
  it('caps a runaway eat-back at 2.5× RMR (glitch protection — the sim finding)', () => {
    // Phantom huge burn: 4000 eat-back stacked on maintenance would give 6600.
    const r = composeCalorieTarget({ baseTarget: 2600, recoveryAdj: 0, eatBack: 4000, flatBonus: 0, rmr: 2000, debt: 0 });
    expect(r.ceiling).toBe(5000);        // 2.5 × 2000
    expect(r.capped).toBe(true);
    expect(r.derived).toBe(5000);        // clamped down from 6600
  });

  it('does NOT cap a legitimate big day under the ceiling', () => {
    const r = composeCalorieTarget({ baseTarget: 2600, recoveryAdj: 0, eatBack: 1500, flatBonus: 0, rmr: 2000, debt: 0 });
    expect(r.capped).toBe(false);
    expect(r.derived).toBe(4100);        // a real 4h-ride day, untouched
  });

  it('the cap never drops below the RMR floor', () => {
    const r = composeCalorieTarget({ baseTarget: 5000, recoveryAdj: 0, eatBack: 5000, flatBonus: 0, rmr: 1500, debt: 0 });
    expect(r.derived).toBe(3750);        // 2.5 × 1500
    expect(r.derived).toBeGreaterThanOrEqual(r.effectiveFloor);
  });
});

describe('describeEatBack — burned→earned relationship (Fix #5)', () => {
  it('ties earned back to the burn base as a percentage', () => {
    // Emil's screenshot: 715 burned, 401 earned → 56%.
    const d = describeEatBack({ reportedBurn: 715, correctedBurn: 643, eatBack: 401, burnFactor: 0.9, racePrepFraction: 0.625, racePrepWindow: 'build' });
    expect(d.burned).toBe(715);
    expect(d.earned).toBe(401);
    expect(d.pct).toBe(56);            // 401/715
    expect(d.text).toMatch(/401 kcal/);
    expect(d.text).toMatch(/56% of the 715/);
    expect(d.text).toMatch(/×0.9 for tracker inflation/);
    expect(d.text).toMatch(/build window/);
  });

  it('omits the tracker-inflation clause when burnFactor is 1 (no correction)', () => {
    const d = describeEatBack({ reportedBurn: 600, correctedBurn: 600, eatBack: 300, burnFactor: 1.0, racePrepFraction: 0.5, racePrepWindow: 'base' });
    expect(d.pct).toBe(50);
    expect(d.text).not.toMatch(/tracker inflation/);
    expect(d.text).toMatch(/×0.5 eaten back/);
  });

  it('returns null text on a rest day (no burn / no eat-back)', () => {
    const d = describeEatBack({ reportedBurn: 0, correctedBurn: 0, eatBack: 0 });
    expect(d.text).toBe(null);
    expect(d.pct).toBe(null);
  });

  it('is defensive against a missing components object', () => {
    const d = describeEatBack();
    expect(d.earned).toBe(0);
    expect(d.text).toBe(null);
  });
});
