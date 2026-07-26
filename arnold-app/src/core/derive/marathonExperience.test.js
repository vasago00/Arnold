// Tests for the career-durability signal. Guarantees: only RUN marathons count (a ski is not experience);
// experience saturates with count and fades with recency; and it's a clean [0,1] factor the fade can trust.
import { describe, it, expect } from 'vitest';
import { marathonExperience } from './marathonExperience.js';

const T = '2026-07-19';
const mar = (date, mi = 26.3) => ({ date, distanceMi: mi, durationSecs: 3 * 3600 + 50 * 60, activityType: 'running', isRun: true });

describe('only run marathons count', () => {
  it('a 45 km resort ski is NOT marathon experience', () => {
    const e = marathonExperience([{ date: '2026-02-13', distanceMi: 27.9, durationSecs: 21437, activityType: 'Resort Skiing', isRun: false }], { today: T });
    expect(e.finishes).toBe(0);
    expect(e.expFactor).toBe(0);
  });
  it('a long ride / swim of marathon-ish distance is excluded', () => {
    expect(marathonExperience([{ date: '2026-05-01', distanceMi: 40, durationSecs: 8000, activityType: 'Cycling', isRun: false }], { today: T }).finishes).toBe(0);
  });
  it('a sub-marathon run (half) is not a marathon finish', () => {
    expect(marathonExperience([mar('2026-05-01', 13.1)], { today: T }).finishes).toBe(0);
  });
});

describe('count saturates, recency fades', () => {
  it('no marathons → expFactor 0', () => {
    expect(marathonExperience([], { today: T }).expFactor).toBe(0);
  });
  it('3+ recent marathons → fully proven (expFactor ~1)', () => {
    const e = marathonExperience([mar('2025-11-02'), mar('2025-10-12'), mar('2025-08-31')], { today: T });
    expect(e.finishes).toBe(3);
    expect(e.expFactor).toBeGreaterThanOrEqual(0.95);
  });
  it('one marathon carries less weight than three (count matters)', () => {
    const one = marathonExperience([mar('2026-05-01')], { today: T }).expFactor;
    const three = marathonExperience([mar('2026-05-01'), mar('2026-03-01'), mar('2026-01-01')], { today: T }).expFactor;
    expect(one).toBeLessThan(three);
  });
  it('a proven history that is now years stale fades toward a residual', () => {
    const recent = marathonExperience([mar('2026-04-01'), mar('2026-02-01'), mar('2025-12-01')], { today: T }).expFactor;
    const old = marathonExperience([mar('2022-04-01'), mar('2022-02-01'), mar('2021-12-01')], { today: T }).expFactor;
    expect(old).toBeLessThan(recent);
    expect(old).toBeLessThanOrEqual(0.2);   // >3 yr → only a small residual
  });
  it('reports the most-recent gap and the longest proven distance', () => {
    const e = marathonExperience([mar('2025-11-02'), mar('2024-09-29', 26.6)], { today: T });
    expect(e.lastDaysAgo).toBeGreaterThan(250);
    expect(e.lastDaysAgo).toBeLessThan(270);
    expect(e.provenKm).toBeGreaterThan(42);
  });
});
