// @vitest-environment node
// True-body-weight selector: post-workout / intraday readings must never become
// the body-weight value (Emil 2026-06-17 — a post-strength weigh-in showed as his
// weight). Morning-fasted only, with activity correlation so a reading after a
// workout is excluded even for an early-morning session. Tests pass activities
// explicitly so they don't depend on app storage.
import { describe, it, expect } from 'vitest';
import { currentTrueWeightLbs, morningWeightRows, isFastedWeight } from './bodyWeight.js';

const NO_ACT = { activities: [] };

describe('true body weight = morning-fasted only', () => {
  it('picks the morning reading over a same-day post-workout reading', () => {
    const rows = [
      { date: '2026-06-17', time: '06:50', weightLbs: 180 },
      { date: '2026-06-17', time: '18:10', weightLbs: 178, source: 'manual' },
    ];
    expect(currentTrueWeightLbs(rows, NO_ACT)).toBe(180);
  });

  it('falls back to the last fasted day when today is post-workout only', () => {
    const rows = [
      { date: '2026-06-16', time: '07:30', weightLbs: 181 },
      { date: '2026-06-17', time: '19:00', weightLbs: 177, source: 'post-run' },
    ];
    expect(currentTrueWeightLbs(rows, NO_ACT)).toBe(181);
  });

  it('excludes a reading that lands after a workout that day (even before 10am)', () => {
    const rows = [
      { date: '2026-06-16', time: '07:30', weightLbs: 181 },
      { date: '2026-06-17', time: '08:10', weightLbs: 184.1, source: 'garmin-scale' },
    ];
    const acts = [{ date: '2026-06-17', startTimeLocal: '2026-06-17T07:00:00' }]; // 7am session
    expect(currentTrueWeightLbs(rows, { activities: acts })).toBe(181); // NOT 184.1
  });

  it('excludes explicit post-workout sources entirely', () => {
    expect(isFastedWeight({ date: '2026-06-17', time: '06:00', weightLbs: 180, source: 'post-run' })).toBe(false);
    expect(isFastedWeight({ date: '2026-06-17', time: '08:00', weightLbs: 180, source: 'manual' })).toBe(true);
  });

  it('treats an untimed reading as fasted (manual morning weigh-in)', () => {
    const rows = [{ date: '2026-06-17', weightLbs: 179 }];
    expect(currentTrueWeightLbs(rows, NO_ACT)).toBe(179);
    expect(morningWeightRows(rows, NO_ACT)).toHaveLength(1);
  });

  it('returns null when there is no fasted reading at all', () => {
    expect(currentTrueWeightLbs([{ date: '2026-06-17', time: '20:00', weightLbs: 175, source: 'post-run' }], NO_ACT)).toBeNull();
  });
});
