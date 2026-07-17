// The canonical A-race resolver — the single source both goalResolve and raceRecipe now share.
import { describe, it, expect } from 'vitest';
import { resolveARace, resolveARaceDate, isMarathon } from './aRace.js';
import { buildGoalModel } from './goalResolve.js';

const TODAY = '2026-07-16';
// The Berlin-vs-Valencia setup: a soonest marathon with NO goal time + a later marathon you set 3:30 on.
const RACES = [
  { name: 'Berlin Marathon', date: '2026-09-28', distanceMi: 26.2 },
  { name: 'Valencia', date: '2026-12-07', distanceMi: 26.2, goalTimeSecs: 12600 },
];

describe('isMarathon', () => {
  it('by distance (mi/km) or name, excluding halves', () => {
    expect(isMarathon({ distanceMi: 26.2 })).toBe(true);
    expect(isMarathon({ distanceKm: 42.2 })).toBe(true);
    expect(isMarathon({ name: 'Berlin Marathon' })).toBe(true);   // name-only, no distance
    expect(isMarathon({ name: 'Brooklyn Half Marathon' })).toBe(false);
    expect(isMarathon({ distanceMi: 13.1 })).toBe(false);
    expect(isMarathon({ name: '10K Turkey Trot' })).toBe(false);
  });
});

describe('resolveARace — the goal race, not the soonest', () => {
  it('the marathon you set a goal time on beats a sooner marathon without one', () => {
    expect(resolveARace(RACES, TODAY).name).toBe('Valencia');
  });
  it('an explicit target date wins outright', () => {
    expect(resolveARace(RACES, TODAY, '2026-09-28').name).toBe('Berlin Marathon');
    expect(resolveARaceDate(RACES, TODAY, '2026-09-28')).toBe('2026-09-28');
  });
  it('falls back: goal-time non-marathon → soonest marathon → priority-A → null', () => {
    expect(resolveARace([{ name: '10k', date: '2026-08-01', distanceMi: 6.2, goalTimeSecs: 1500 }], TODAY).name).toBe('10k');
    expect(resolveARace([{ name: 'M1', date: '2026-08-01', distanceMi: 26.2 }, { name: 'M2', date: '2026-09-01', distanceMi: 26.2 }], TODAY).name).toBe('M1');
    expect(resolveARace([{ name: 'B', date: '2026-08-01', distanceMi: 6.2, priority: 'A' }], TODAY).name).toBe('B');
    expect(resolveARace([], TODAY)).toBe(null);
  });
  it('goalResolve.buildGoalModel now agrees (shares this resolver)', () => {
    expect(buildGoalModel({ races: RACES, goals: {}, today: TODAY }).race.aRace.name).toBe('Valencia');
  });
});
