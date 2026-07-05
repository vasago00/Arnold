// Goal-model sim invariants (Sprint 3.1d). Pressure-tests buildGoalModel over
// thousands of randomized goal-sets (weights, macros, races with A/B/C priority
// and goal times, deadlines) — asserting the model is ALWAYS well-formed for any
// athlete, not just Emil's. Pure (buildGoalModel + seeded PRNG), runs in the suite.
import { describe, it, expect } from 'vitest';
import { makeRng } from './prng.js';
import { generateAthlete } from './athlete.js';
import { buildGoalModel } from '../goalResolve.js';

const VALID_DIR  = new Set(['cut', 'bulk', 'maintain', 'unknown']);
const VALID_FEAS = new Set(['on-track', 'aggressive', 'unrealistic', 'unknown', 'no-goal']);
const isNumOrNull = (x) => x === null || (typeof x === 'number' && Number.isFinite(x));
const TODAY = '2026-07-03';
const shift = (d) => { const x = new Date(TODAY + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

function synthGoals(rng, a) {
  const cal = rng.int(1600, 3200);
  return {
    weeklyRunDistanceTarget: rng.int(0, 70), weeklyStrengthTarget: rng.int(0, 5),
    weeklyMobilitySessions: rng.int(0, 4), zone2Pct: rng.int(50, 90),
    targetWeight: Math.round(a.weightLbs + rng.uniform(-25, 15)), targetBodyFat: rng.int(8, 30),
    dailyCalorieTarget: cal, dailyProteinTarget: Math.round(cal * 0.3 / 4),
    dailyCarbTarget: Math.round(cal * 0.4 / 4), dailyFatTarget: Math.round(cal * 0.3 / 9),
    dailyFiberTarget: rng.int(20, 40), dailyWaterTarget: rng.int(2, 5),
  };
}
function synthRaces(rng) {
  const n = rng.int(0, 3), out = [], dists = [3.1, 6.2, 13.1, 26.2], pri = ['A', 'B', 'C'];
  for (let i = 0; i < n; i++) {
    out.push({
      name: 'R' + i, date: shift(rng.int(-20, 200)), distanceMi: rng.choice(dists),
      priority: rng.choice(pri), goalTimeSecs: rng.chance(0.5) ? rng.int(1200, 16000) : undefined,
    });
  }
  return out;
}

describe('goal model — sim invariants (3.1d)', () => {
  it('buildGoalModel is well-formed across 5,000 synthetic goal-sets', () => {
    const rng = makeRng(30313);
    const bad = [];
    for (let k = 0; k < 5000; k++) {
      const a = generateAthlete(rng);
      const m = buildGoalModel({
        today: TODAY, goals: synthGoals(rng, a), races: synthRaces(rng),
        currentWeightLbs: a.weightLbs, currentBodyFatPct: a.bodyFatPct,
        effectiveCalories: rng.int(1500, 3000),
        predictedMarathonSecs: rng.chance(0.5) ? rng.int(9000, 18000) : null,
        weeklyMiles: rng.int(0, 70), longestRecentMi: rng.int(0, 22),
        targetWeightDate: rng.chance(0.5) ? shift(rng.int(14, 200)) : null,
        resolutions: {},
      });
      const chk = (cond, id) => { if (!cond && bad.length < 12) bad.push({ k, id }); };

      chk(m && m.race && m.training && m.body && m.nutrition && Array.isArray(m.conflicts) && m.meta, 'shape');
      chk(VALID_DIR.has(m.body.weight.direction), 'direction');
      chk(VALID_FEAS.has(m.race.feasibility), 'feasibility');
      chk(isNumOrNull(m.nutrition.calories.target) && isNumOrNull(m.nutrition.calories.effective), 'nutrition-num');
      chk(isNumOrNull(m.body.weight.rateLbPerWk), 'rate-num');
      chk(isNumOrNull(m.training.weeklyMiles.target), 'training-num');
      if (m.race.aRace) chk(typeof m.race.aRace.date === 'string' && isNumOrNull(m.race.aRace.daysOut), 'aRace');
      for (const c of m.conflicts) {
        chk(Array.isArray(c.options) && c.options.length === 2, 'conflict-options');
        chk(c.options.every(o => o.key && o.label && o.action && o.cost), 'conflict-fields');
        chk(['high', 'medium'].includes(c.severity), 'conflict-severity');
        chk(c.resolution === null || c.options.some(o => o.key === c.resolution), 'conflict-resolution');
      }
    }
    expect(bad, `well-formedness violations (seed 30313): ${JSON.stringify(bad)}`).toEqual([]);
  });
});
