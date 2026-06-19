// Locks the readiness score extracted from PlannedWorkoutTile.readinessVerdict
// (Phase 2.1). Pure → guarantees the weekly surface scores readiness identically
// to the daily tile.
import { describe, it, expect } from 'vitest';
import { readinessScoreFrom } from './todayAdaptation.js';

describe('readinessScoreFrom — sleep + HRV → 0..100 (matches the tile)', () => {
  it('peaks at 100 with great sleep + rising HRV', () => {
    expect(readinessScoreFrom({ sleepHrs: 8, hrvDelta: 10 })).toBe(100); // 50+25+25
  });
  it('80 for solid sleep + slightly-up HRV', () => {
    expect(readinessScoreFrom({ sleepHrs: 7.2, hrvDelta: 2 })).toBe(80); // 50+15+15
  });
  it('55 for ok sleep + flat HRV', () => {
    expect(readinessScoreFrom({ sleepHrs: 6.5, hrvDelta: -3 })).toBe(55); // 50+5+0
  });
  it('floors low on poor sleep + suppressed HRV', () => {
    expect(readinessScoreFrom({ sleepHrs: 5, hrvDelta: -10 })).toBe(15); // 50-15-20
  });
  it('falls back to absolute HRV when no baseline delta', () => {
    expect(readinessScoreFrom({ sleepHrs: null, hrvNow: 55 })).toBe(65); // 50+0+15
  });
  it('returns the neutral 50 with no signals', () => {
    expect(readinessScoreFrom({})).toBe(50);
  });
});
