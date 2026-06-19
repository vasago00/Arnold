// Locks the fuel-for-work engine (Phase 2.2). Pure rules → verifiable without UI.
import { describe, it, expect } from 'vitest';
import { prescribeFuel } from './fuelForWork.js';

// 80 kg athlete, 64 kg FFM (≈20% bf) for the body-scaled numbers.
const BODY = { bodyMassKg: 80, ffmKg: 64 };

describe('prescribeFuel — turns the session into a fuel prescription', () => {
  it('prescribes pre-carbs + PM protein for a hard tempo', () => {
    const r = prescribeFuel(
      { type: 'tempo', intensityClass: 'tempo', durationMin: 50, label: 'Tempo 6mi' },
      { ...BODY, intakeKcal: 2000, activityKcal: 600, dailyCalorieTarget: 2200 }
    );
    expect(r.bracket).toBe('high');
    expect(r.preCarbsG).toBe(120);          // 1.5 g/kg × 80
    expect(r.pmProteinG).toBe(30);          // 0.4 g/kg × 80 (hard)
    expect(r.duringCarbsPerHr).toBe(0);     // <75 min → no during-fuel
    expect(r.summary).toMatch(/carbs pre/);
    expect(r.summary).toMatch(/protein PM/);
  });

  it('adds during-fuel for a long session (≥75 min)', () => {
    const r = prescribeFuel(
      { type: 'long_run', intensityClass: 'easy', durationMin: 120, label: 'Long 14mi' },
      BODY
    );
    expect(r.bracket).toBe('high');         // duration tier 3
    expect(r.duringCarbsPerHr).toBe(40);
  });

  it('scales up fueling for a very long session', () => {
    const r = prescribeFuel({ type: 'long_run', intensityClass: 'easy', durationMin: 180 }, BODY);
    expect(r.bracket).toBe('very-high');
    expect(r.preCarbsG).toBe(200);          // 2.5 g/kg × 80
    expect(r.duringCarbsPerHr).toBe(75);
  });

  it('keeps a rest day on normal meals — no targeted load', () => {
    const r = prescribeFuel({ type: 'rest' }, BODY);
    expect(r.bracket).toBe('none');
    expect(r.preCarbsG).toBe(0);
    expect(r.pmProteinG).toBe(0);
    expect(r.summary).toMatch(/normal meals/);
  });

  it('flags low energy availability (EA <30 kcal/kg FFM)', () => {
    // intake 1600 − 700 exercise = 900 ÷ 64 FFM ≈ 14 kcal/kg → low.
    const r = prescribeFuel(
      { type: 'tempo', intensityClass: 'tempo', durationMin: 50 },
      { ...BODY, intakeKcal: 1600, activityKcal: 700 }
    );
    expect(r.ea.status).toBe('low');
    expect(r.ea.flag).toBe(true);
    expect(r.summary).toMatch(/low energy availability/i);
  });

  it('reads EA as optimal when well-fuelled (≥45)', () => {
    // 3500 − 600 = 2900 ÷ 64 ≈ 45 → optimal.
    const r = prescribeFuel(
      { type: 'easy_run', intensityClass: 'easy', durationMin: 40 },
      { ...BODY, intakeKcal: 3500, activityKcal: 600 }
    );
    expect(r.ea.status).toBe('optimal');
    expect(r.ea.flag).toBe(false);
  });

  it('reports how far under/over today\'s calorie target', () => {
    const r = prescribeFuel(
      { type: 'easy_run', intensityClass: 'easy', durationMin: 40 },
      { ...BODY, intakeKcal: 1500, dailyCalorieTarget: 2200 }
    );
    expect(r.deficitVsTarget).toBe(-700);
    expect(r.summary).toMatch(/~700 under/);
  });

  it('fuels an EASED hard session by its new (easy) intensity, not its original type', () => {
    // adaptSession keeps type:'tempo' but sets intensityClass:'easy' + cuts volume.
    const r = prescribeFuel(
      { type: 'tempo', intensityClass: 'easy', durationMin: 38 },
      BODY
    );
    expect(r.bracket).toBe('light');        // easy + <45 min, NOT high
    expect(r.preCarbsG).toBe(40);           // 0.5 g/kg × 80
  });

  it('degrades gracefully with no body data (no crash, no scaled grams)', () => {
    const r = prescribeFuel({ type: 'tempo', intensityClass: 'tempo', durationMin: 50 }, {});
    expect(r.preCarbsG).toBe(0);
    expect(r.pmProteinG).toBe(0);
    expect(r.ea.status).toBe(null);
    expect(r.bracket).toBe('high');         // bracket still classifies
  });
});
