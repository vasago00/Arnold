// Unit tests for the extracted calorie-target composition — the exact formula the
// app uses (goalModel delegates here), so these lock the 2026-07-01 fix directly.
import { describe, it, expect } from 'vitest';
import { composeCalorieTarget } from './calorieTargetMath.js';

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
