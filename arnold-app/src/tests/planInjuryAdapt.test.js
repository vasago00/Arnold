// Adaptive plan — the two gaps Emil hit: (1) the multi-week plan didn't re-baseline to
// his ACTUAL (slower, knee-protecting) mileage — it kept climbing from a static goal;
// (2) a logged knee niggle never reached the plan generator. These pin both, at the
// pure generateSeasonBlock layer (the wiring that feeds it actuals + injury lives in
// LivingPlan). Selective per injury.js: a knee eases speed but keeps aerobic long runs.
import { describe, it, expect } from 'vitest';
import { generateSeasonBlock } from '../core/hub/planGenerator.js';

const TODAY = '2026-07-27';
const BASE = { today: TODAY, horizon: 8, availableDays: [0, 1, 2, 3, 4, 5, 6], runDays: 5, strengthDays: 2 };
const countTypes = (blk) => {
  const c = {};
  for (const w of blk.weeks) for (const d of w.days) if (d) c[d.type] = (c[d.type] || 0) + 1;
  return c;
};

describe('adaptive plan — re-baseline to actual mileage', () => {
  it('starts the ramp from ACTUAL recent volume, not a static 30', () => {
    const low = generateSeasonBlock({ ...BASE, weeklyMiles: 18, longestRecentMi: 8 });
    // Seeded from 18 → week 1 sits near there (a ~10% step), NOT a goal-driven ~30.
    expect(low.weeks[0].targetWeeklyMiles).toBeLessThan(26);
    expect(low.weeks[0].targetWeeklyMiles).toBeGreaterThanOrEqual(18);
  });

  it('a healthy plan still prescribes quality + long runs', () => {
    const c = countTypes(generateSeasonBlock({ ...BASE, weeklyMiles: 30, longestRecentMi: 12 }));
    expect((c.tempo || 0) + (c.intervals || 0)).toBeGreaterThan(0);
    expect(c.long_run || 0).toBeGreaterThan(0);
  });
});

describe('adaptive plan — a logged injury reshapes the PLAN (selective per injury.js)', () => {
  it('knee → every speed session eased to aerobic, long runs PRESERVED', () => {
    const knee = generateSeasonBlock({ ...BASE, weeklyMiles: 30, longestRecentMi: 12, injury: 'knee' });
    const c = countTypes(knee);
    expect((c.tempo || 0) + (c.intervals || 0) + (c.hiit || 0)).toBe(0);   // intensity eased
    expect(c.long_run || 0).toBeGreaterThan(0);                            // a knee tolerates aerobic volume
    expect(knee.weeks.some(w => w.injuryProtected)).toBe(true);
    expect(knee.weeks.some(w => /knee/i.test(w.why))).toBe(true);
  });

  it('shin (impact + volume) → impact work eased AND long-run days shortened', () => {
    const shin = generateSeasonBlock({ ...BASE, weeklyMiles: 34, longestRecentMi: 16, injury: 'shin' });
    const c = countTypes(shin);
    expect((c.intervals || 0) + (c.hiit || 0)).toBe(0);   // impact eased
    // long-run day distances are capped for a volume injury
    const longestDay = Math.max(0, ...shin.weeks.flatMap(w => w.days.filter(d => d && d.type === 'long_run').map(d => Number(d.distanceMi) || 0)));
    const baseLongestDay = Math.max(0, ...generateSeasonBlock({ ...BASE, weeklyMiles: 34, longestRecentMi: 16 }).weeks.flatMap(w => w.days.filter(d => d && d.type === 'long_run').map(d => Number(d.distanceMi) || 0)));
    expect(longestDay).toBeLessThan(baseLongestDay);
  });

  it('no injury → nothing is protected, quality intact', () => {
    const healthy = generateSeasonBlock({ ...BASE, weeklyMiles: 30, longestRecentMi: 12 });
    expect(healthy.weeks.some(w => w.injuryProtected)).toBe(false);
  });
});
