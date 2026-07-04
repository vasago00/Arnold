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
