// Unit tests for the unified goal-model assembler (Sprint 3.1a). Pure function,
// so we can assert the full shape from known inputs.
import { describe, it, expect } from 'vitest';
import { buildGoalModel } from './goalResolve.js';

const TODAY = '2026-07-01';
const shift = (days) => {
  const d = new Date(TODAY + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const baseGoals = {
  weeklyRunDistanceTarget: 40, weeklyStrengthTarget: 3, weeklyMobilitySessions: 2, zone2Pct: 80,
  targetWeight: 170, targetBodyFat: 12,
  dailyCalorieTarget: 2400, dailyProteinTarget: 180, dailyCarbTarget: 250, dailyFatTarget: 70,
  dailyFiberTarget: 35, dailyWaterTarget: 3,
};

describe('buildGoalModel', () => {
  it('returns all four dimensions + meta + conflicts scaffold', () => {
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races: [] });
    expect(Object.keys(m)).toEqual(expect.arrayContaining(['race', 'training', 'body', 'nutrition', 'conflicts', 'meta']));
    expect(m.conflicts).toEqual([]);           // 3.1b fills this
    expect(m.meta.dimensions).toEqual(['race', 'training', 'body', 'nutrition']);
    expect(m.meta.asOf).toBe(TODAY);
  });

  it('assembles the A-race with days-out and lists tune-ups separately', () => {
    const races = [
      { name: 'Valencia', date: shift(70), distanceMi: 26.2, goalTimeSecs: 3 * 3600 },
      { name: 'Local 10K', date: shift(20), distanceMi: 6.2 },
    ];
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races, aRaceDate: shift(70) });
    expect(m.race.aRace.name).toBe('Valencia');
    expect(m.race.aRace.daysOut).toBe(70);
    expect(m.race.aRace.goalTimeSecs).toBe(10800);
    expect(m.race.tuneUps.map(t => t.name)).toContain('Local 10K');
    expect(m.race.tuneUps.some(t => t.name === 'Valencia')).toBe(false);
    expect(m.meta.horizonDays).toBe(70);       // anchored to the A-race
  });

  it('designates the priority-A race as the A-race (no explicit date needed)', () => {
    const races = [
      { name: 'Goal Half', date: shift(30), distanceMi: 13.1, priority: 'A' },
      { name: 'Tune 10K',  date: shift(10), distanceMi: 6.2,  priority: 'B' },
    ];
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races });
    expect(m.race.aRace.name).toBe('Goal Half');   // priority A wins even though the 10K is sooner
    expect(m.race.tuneUps.map(t => t.name)).toContain('Tune 10K');
  });

  it('no races → aRace null, feasibility no-goal', () => {
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races: [] });
    expect(m.race.aRace).toBe(null);
    expect(m.race.feasibility).toBe('no-goal');
  });

  it('derives body direction + loss rate from a deadline', () => {
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races: [], currentWeightLbs: 180, targetWeightDate: shift(70) });
    expect(m.body.weight.direction).toBe('cut');       // 180 → 170
    expect(m.body.weight.rateLbPerWk).toBe(1);         // 10 lb / 10 wk
    expect(m.body.weight.horizon).toBe('deadline');
    expect(m.body.weight.daysOut).toBe(70);
  });

  it('classifies bulk and maintain', () => {
    expect(buildGoalModel({ today: TODAY, goals: baseGoals, races: [], currentWeightLbs: 160 }).body.weight.direction).toBe('bulk');   // 160 → 170
    expect(buildGoalModel({ today: TODAY, goals: { ...baseGoals, targetWeight: 180 }, races: [], currentWeightLbs: 180 }).body.weight.direction).toBe('maintain');
  });

  it('carries training targets (ongoing horizon) + current where provided', () => {
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races: [], weeklyMiles: 32 });
    expect(m.training.weeklyMiles).toEqual({ target: 40, current: 32, horizon: 'ongoing' });
    expect(m.training.weeklyStrength.target).toBe(3);
    expect(m.training.zone2Pct.horizon).toBe('ongoing');
  });

  it('carries nutrition targets, effective calories, and the EA guardrail', () => {
    const m = buildGoalModel({ today: TODAY, goals: baseGoals, races: [], effectiveCalories: 2200 });
    expect(m.nutrition.calories).toEqual({ target: 2400, effective: 2200, horizon: 'ongoing' });
    expect(m.nutrition.protein.target).toBe(180);
    expect(m.nutrition.eaFloor).toBe(30);
  });

  it('handles empty input without throwing (all-null, no crash)', () => {
    const m = buildGoalModel({});
    expect(m.race.aRace).toBe(null);
    expect(m.body.weight.direction).toBe('unknown');
    expect(m.nutrition.calories.target).toBe(null);
  });
});

describe('buildGoalModel — conflicts (3.1b, user-decided)', () => {
  const cutNearRace = {
    today: TODAY, goals: { ...baseGoals, targetWeight: 170 },
    races: [{ name: 'City Marathon', date: shift(14), distanceMi: 26.2 }],
    aRaceDate: shift(14), currentWeightLbs: 180, targetWeightDate: shift(90),
  };

  it('flags cut-vs-race with both trade-off directions, unresolved by default', () => {
    const m = buildGoalModel(cutNearRace);
    const c = m.conflicts.find(x => x.id === 'cut-vs-race');
    expect(c).toBeTruthy();
    expect(c.between).toEqual(['body', 'race']);
    expect(c.options.map(o => o.key)).toEqual(['race', 'body']);   // both directions offered
    expect(c.options.every(o => o.action && o.cost)).toBe(true);
    expect(c.resolution).toBe(null);
    expect(c.resolved).toBe(false);
  });

  it('stamps the user resolution when provided (coach reflects, never picks)', () => {
    const m = buildGoalModel({ ...cutNearRace, resolutions: { 'cut-vs-race': 'race' } });
    const c = m.conflicts.find(x => x.id === 'cut-vs-race');
    expect(c.resolution).toBe('race');
    expect(c.resolved).toBe(true);
  });

  it('no cut-vs-race when maintaining, or when the race is far out', () => {
    const maintain = buildGoalModel({ ...cutNearRace, currentWeightLbs: 170 });   // 170 → 170
    expect(maintain.conflicts.some(c => c.id === 'cut-vs-race')).toBe(false);
    const farRace = buildGoalModel({ ...cutNearRace, races: [{ name: 'M', date: shift(60), distanceMi: 26.2 }], aRaceDate: shift(60) });
    expect(farRace.conflicts.some(c => c.id === 'cut-vs-race')).toBe(false);
  });

  it('flags an aggressive cut against a high training volume', () => {
    const m = buildGoalModel({
      today: TODAY, goals: { ...baseGoals, targetWeight: 175, weeklyRunDistanceTarget: 40 },
      races: [], currentWeightLbs: 190, targetWeightDate: shift(42),   // 15 lb / 6 wk = 2.5 lb/wk
    });
    const c = m.conflicts.find(x => x.id === 'cut-vs-training');
    expect(c).toBeTruthy();
    expect(c.severity).toBe('high');   // rate > 2
    expect(c.between).toEqual(['body', 'training']);
  });

  it('flags goal-time vs current fitness when the projection is off', () => {
    const m = buildGoalModel({
      today: TODAY, goals: baseGoals,
      races: [{ name: 'Berlin', date: shift(90), distanceMi: 26.2, goalTimeSecs: 3 * 3600 }],
      aRaceDate: shift(90), predictedMarathonSecs: 15000,   // ~4:10 vs a 3:00 goal → unrealistic
      weeklyMiles: 20, longestRecentMi: 10,
    });
    expect(['unrealistic', 'aggressive']).toContain(m.race.feasibility);
    const c = m.conflicts.find(x => x.id === 'goaltime-vs-fitness');
    expect(c).toBeTruthy();
    expect(c.options.map(o => o.key)).toEqual(['goal', 'adjust']);
  });
});
