// Golden tests for the ONE today-status resolver. The named regression: a logged
// indoor-bike on a planned-run (or no-plan) day must read as the RIDE, never as
// "Rest day". Covers on-plan, off-plan, no-plan, rest, and not-done-yet.
import { describe, it, expect } from 'vitest';
import { resolveTodayStatus } from './todayStatus.js';

const T = '2026-06-21';
const bike = { activityType: 'Indoor Cycling', durationSecs: 46 * 60, date: T };
const run  = { activityType: 'Running', durationSecs: 40 * 60, distanceMi: 5, date: T };
const yoga = { activityType: 'Yoga', durationSecs: 30 * 60, date: T };

describe('resolveTodayStatus — the off-plan / no-plan regression', () => {
  it('planned easy run, did a 46-min ride → "Off-plan · Cycling", done', () => {
    const s = resolveTodayStatus({ activities: [bike], planned: { type: 'easy_run' }, today: T });
    expect(s.done).toBe(true);
    expect(s.offPlan).toBe(true);
    expect(s.label).toBe('Off-plan · Cycling');
    expect(s.isRest).toBe(false);
  });
  it('NO plan, did a 46-min ride → "Cycling", done (NOT "Rest day")', () => {
    const s = resolveTodayStatus({ activities: [bike], planned: null, today: T });
    expect(s.done).toBe(true);
    expect(s.label).toBe('Cycling');
    expect(s.isRest).toBe(false);
  });
  it('planned REST, did a ride → "Cycling", done (not "Rest day ✓")', () => {
    const s = resolveTodayStatus({ activities: [bike], planned: { type: 'rest' }, today: T });
    expect(s.label).toBe('Cycling');
    expect(s.done).toBe(true);
  });
});

describe('resolveTodayStatus — on-plan & not-done', () => {
  it('planned easy run, did the run → "Easy run", matchedPlan', () => {
    const s = resolveTodayStatus({ activities: [run], planned: { type: 'easy_run' }, today: T });
    expect(s.matchedPlan).toBe(true);
    expect(s.offPlan).toBe(false);
    expect(s.label).toBe('Easy run');
  });
  it('planned easy run, nothing logged → "Easy run", not done', () => {
    const s = resolveTodayStatus({ activities: [], planned: { type: 'easy_run' }, today: T });
    expect(s.done).toBe(false);
    expect(s.label).toBe('Easy run');
  });
  it('mobility plan + 30-min yoga → "Mobility", done', () => {
    const s = resolveTodayStatus({ activities: [yoga], planned: { type: 'mobility' }, today: T });
    expect(s.matchedPlan).toBe(true);
    expect(s.label).toBe('Mobility');
  });
});

describe('resolveTodayStatus — genuine rest', () => {
  it('rest plan, nothing logged → "Rest day", isRest', () => {
    const s = resolveTodayStatus({ activities: [], planned: { type: 'rest' }, today: T });
    expect(s.isRest).toBe(true);
    expect(s.label).toBe('Rest day');
  });
  it('no plan, nothing logged → "Rest day"', () => {
    expect(resolveTodayStatus({ activities: [], planned: null, today: T }).label).toBe('Rest day');
  });
  it('a sub-20-min walk on a run plan does NOT count as done', () => {
    const s = resolveTodayStatus({ activities: [{ activityType: 'Walking', durationSecs: 10 * 60, date: T }], planned: { type: 'easy_run' }, today: T });
    expect(s.done).toBe(false);
    expect(s.label).toBe('Easy run');
  });
});

describe('resolveTodayStatus — multi-session (two-a-day) view', () => {
  it('a run + a ride same day → multi, both sessions exposed, primary is the longer', () => {
    const s = resolveTodayStatus({ activities: [run, bike], planned: { type: 'easy_run' }, today: T });
    expect(s.sessions).toHaveLength(2);
    expect(s.multi).toBe(true);
    expect(s.primary).toBe(bike);              // 46 min > 40 min
    expect(s.secondaries).toHaveLength(1);
    expect(s.secondaries[0].family).toBe('run');
    expect(s.secondaries[0].label).toBe('Run');
  });
  it('a run + a 30-min yoga → NOT multi (only one meaningful), both still listed', () => {
    const s = resolveTodayStatus({ activities: [run, yoga], planned: { type: 'easy_run' }, today: T });
    expect(s.sessions).toHaveLength(2);
    expect(s.multi).toBe(false);               // yoga is mobility → not meaningful
    expect(s.primary).toBe(run);               // longest non-mobility
    expect(s.secondaries.map(x => x.family)).toContain('mobility');
  });
  it('a single session → not multi, no secondaries', () => {
    const s = resolveTodayStatus({ activities: [bike], planned: null, today: T });
    expect(s.sessions).toHaveLength(1);
    expect(s.multi).toBe(false);
    expect(s.secondaries).toHaveLength(0);
  });
  it('nothing logged → empty sessions, not multi', () => {
    const s = resolveTodayStatus({ activities: [], planned: { type: 'easy_run' }, today: T });
    expect(s.sessions).toHaveLength(0);
    expect(s.multi).toBe(false);
    expect(s.secondaries).toHaveLength(0);
  });
});
