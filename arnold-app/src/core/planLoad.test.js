// @vitest-environment node
// Coach's calendar read. Key invariants (Emil 2026-06-17): a week UNDER the
// mileage goal is never "heavy"; mobility/walk days are recovery, not "no rest".
import { describe, it, expect } from 'vitest';
import { analyzePlannedWeek, classifySession } from './planLoad.js';

const wk = days => ({ days });

describe('plan-load read', () => {
  it('under goal + mobility days = LIGHT, never heavy (the bug)', () => {
    const r = analyzePlannedWeek(wk([
      { sessions: [{ type: 'easy_run', distanceMi: 5 }] }, { sessions: [{ type: 'mobility' }] },
      { sessions: [{ type: 'easy_run', distanceMi: 5 }] }, { sessions: [{ type: 'mobility' }] },
      { type: 'rest' }, { sessions: [{ type: 'easy_run', distanceMi: 6 }] }, { sessions: [{ type: 'mobility' }] },
    ]), { weeklyRunMilesGoal: 30 });
    expect(r.verdict).toBe('light');
    expect(r.flags).not.toContain('low-recovery');
    expect(r.totalRecovery).toBeGreaterThanOrEqual(4); // 3 mobility + 1 rest
  });

  it('flags a genuinely heavy week (4 hard days, stacked)', () => {
    const r = analyzePlannedWeek(wk([
      { sessions: [{ type: 'intervals', distanceMi: 6 }] }, { sessions: [{ type: 'tempo', distanceMi: 5 }] },
      { sessions: [{ type: 'long_run', distanceMi: 12 }] }, { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
      { sessions: [{ type: 'strength' }] }, { sessions: [{ type: 'hiit' }] }, { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
    ]), { weeklyRunMilesGoal: 30 });
    expect(r.verdict).toBe('heavy');
  });

  it('mobility between two hard days is NOT stacking', () => {
    const r = analyzePlannedWeek(wk([
      { sessions: [{ type: 'tempo', distanceMi: 5 }] }, { sessions: [{ type: 'mobility' }] },
      { sessions: [{ type: 'intervals', distanceMi: 5 }] }, { type: 'rest' }, { type: 'rest' }, { type: 'rest' }, { type: 'rest' },
    ]), { weeklyRunMilesGoal: 30 });
    expect(r.stacked).toBe(0);
  });

  it('calls a sane week balanced', () => {
    const r = analyzePlannedWeek(wk([
      { sessions: [{ type: 'easy_run', distanceMi: 5 }] }, { sessions: [{ type: 'strength' }] },
      { sessions: [{ type: 'tempo', distanceMi: 5 }] }, { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
      { type: 'rest' }, { sessions: [{ type: 'long_run', distanceMi: 10 }] }, { sessions: [{ type: 'easy_run', distanceMi: 3 }] },
    ]), { weeklyRunMilesGoal: 30 });
    expect(r.verdict).toBe('balanced');
  });

  it('all-easy at goal = imbalanced (no quality)', () => {
    const r = analyzePlannedWeek(wk([
      { sessions: [{ type: 'easy_run', distanceMi: 4 }] }, { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
      { sessions: [{ type: 'easy_run', distanceMi: 4 }] }, { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
      { type: 'rest' }, { type: 'rest' }, { type: 'rest' },
    ]), { weeklyRunMilesGoal: 16 });
    expect(r.flags).toContain('no-quality');
    expect(r.verdict).toBe('imbalanced');
  });

  it('reads legacy single-session days', () => {
    expect(classifySession('mobility')).toBe('recovery');
    expect(classifySession('tempo')).toBe('quality');
    expect(analyzePlannedWeek(wk([{ type: 'tempo', distanceMi: 5 }, { type: 'rest' }]), {}).sessions).toBe(1);
  });
});

import { analyzeSeason } from './planLoad.js';
describe('season read', () => {
  const weeks = [
    { start: '2026-06-01', end: '2026-06-07', actual: 13.4, planned: 0 },
    { start: '2026-06-08', end: '2026-06-14', actual: 13.4, planned: 0 },
    { start: '2026-06-15', end: '2026-06-21', actual: 23.7, planned: 5 },
    { start: '2026-06-22', end: '2026-06-28', actual: 0, planned: 0 },
    { start: '2026-06-29', end: '2026-07-05', actual: 0, planned: 0 },
  ];
  it('flags missed-goal streak + empty weeks ahead + next race', () => {
    const r = analyzeSeason(weeks, { weeklyRunMilesGoal: 30, today: '2026-06-17', races: [{ name: 'NYRR Queens 10K', date: '2026-06-20' }] });
    expect(r.behind).toBe(true);
    expect(r.missedStreak).toBeGreaterThanOrEqual(3);
    expect(r.emptyAhead).toBeGreaterThanOrEqual(2);
    expect(r.nextRace.name).toBe('NYRR Queens 10K');
    expect(r.message).toMatch(/taper/);
    expect(r.message).not.toMatch(/deeper base|add (running )?volume now/);
    expect(r.mode).toBe('taper');
  });
  it('returns null without a goal', () => {
    expect(analyzeSeason(weeks, { today: '2026-06-17' })).toBeNull();
  });
});
