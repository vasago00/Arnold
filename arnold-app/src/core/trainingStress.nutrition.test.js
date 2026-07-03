// Golden failure-matrix for the trainingStress nutrition domain (DATA_INTEGRITY
// Phase 3). nutritionScore is the PURE core of computeDailyScore's nutrition
// block. Inputs arrive pre-gated: "no food logged" → protein/calories/waterL are
// null. This is the second site of the "Nutrition 92 with no food" bug.
import { describe, it, expect } from 'vitest';
import { nutritionScore } from './trainingStress.js';

const T = { targetProtein: 170, targetCals: 2200, targetWaterL: 3 };

describe('nutritionScore — the named regression', () => {
  it('{no food, water logged, tracker}: domain is no-data (NOT a number from water)', () => {
    // foodLogged=false upstream → macros null; only waterL would survive — must NOT score.
    const r = nutritionScore({ nutProtein: null, nutCalories: null, waterL: 2.5, tracksNutrition: true, ...T });
    expect(r.domain.status).toBe('no-data');
    expect(r.domain.value).toBe(null);
  });
  it('{nothing, tracker}: no-data', () => {
    const r = nutritionScore({ tracksNutrition: true, ...T });
    expect(r.domain.status).toBe('no-data');
  });
});

describe('nutritionScore — honest when food IS logged', () => {
  it('full on-target day scores high', () => {
    const r = nutritionScore({ nutProtein: 165, nutCalories: 2150, waterL: 2.8, tracksNutrition: true, ...T });
    expect(r.domain.status).toBe('ok');
    expect(r.domain.value).toBeGreaterThan(0.85);
  });
  it('food logged but 0 protein: protein scored LOW, not dropped', () => {
    const r = nutritionScore({ nutProtein: 0, nutCalories: 2150, waterL: 2.5, tracksNutrition: true, ...T });
    expect(r.domain.status).toBe('ok');
    expect(r.proR.status).toBe('ok');     // the real 0 was scored, not skipped
    expect(r.proR.value).toBe(0);
    expect(r.domain.value).toBeLessThan(0.8);
  });
});

describe('nutritionScore — not a tracker', () => {
  it('{nothing, not tracked}: no-data, factors marked not-tracked', () => {
    const r = nutritionScore({ tracksNutrition: false, ...T });
    expect(r.domain.status).toBe('no-data');
    expect(r.proR.status).toBe('not-tracked');
    expect(r.calR.status).toBe('not-tracked');
  });
});
