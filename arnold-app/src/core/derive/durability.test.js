// Tests for durability (P2 — the fourth pillar). Durability is the marathon-specific "can you hold pace
// late" quality, independent of VO2max. This locks: it reads real decoupling when present, falls back to a
// long-run efficiency TREND from summary data (so the signal exists for everyone), stays honest (no absolute
// fade claim on the proxy, modest confidence), and degrades to null without enough long-run evidence.
import { describe, it, expect } from 'vitest';
import { estimateDurability } from './durability.js';

const T = '2026-07-18';
const long = (date, mi, paceSecPerMi, avgHR, decoup) =>
  ({ date, distanceMi: mi, durationSecs: Math.round(mi * paceSecPerMi), activityType: 'long_run', avgHR, aerobicDecoupling: decoup });

describe('decoupling source (the gold signal, when present)', () => {
  it('low drift on long runs → durable', () => {
    const d = estimateDurability([long('2026-07-05', 16, 9.2 * 60, 150, 4.1), long('2026-07-12', 18, 9.3 * 60, 151, 3.6)], { today: T });
    expect(d.source).toBe('decoupling');
    expect(d.state).toBe('durable');
    expect(d.fadePct).toBeLessThanOrEqual(5);
  });
  it('high drift → fading, and the read names durability as the limiter', () => {
    const d = estimateDurability([long('2026-07-06', 16, 9.5 * 60, 155, 11.5), long('2026-07-13', 18, 9.6 * 60, 156, 12.2)], { today: T });
    expect(d.state).toBe('fading');
    expect(d.label).toMatch(/durability/i);
  });
  it('drift falling over the block → improving trend', () => {
    const d = estimateDurability([
      long('2026-05-20', 16, 9.4 * 60, 152, 8.2), long('2026-06-01', 17, 9.4 * 60, 152, 7.5),
      long('2026-07-10', 18, 9.3 * 60, 151, 4.2), long('2026-07-15', 16, 9.2 * 60, 150, 3.9),
    ], { today: T });
    expect(d.trend).toBe('improving');
  });
});

describe('ef-trend fallback (summary data, no decoupling field)', () => {
  it('faster long runs at the same HR → improving, source ef-trend, modest confidence', () => {
    const old = [long('2026-05-25', 16, 9.7 * 60, 150), long('2026-06-05', 17, 9.7 * 60, 150)];
    const now = [long('2026-07-08', 16, 9.2 * 60, 150), long('2026-07-14', 18, 9.1 * 60, 150)];
    const d = estimateDurability(old.concat(now), { today: T });
    expect(d.source).toBe('ef-trend');
    expect(d.trend).toBe('improving');
    expect(d.state).toBeNull();                 // no absolute fade claim on the proxy — honest
    expect(d.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe('honest guards', () => {
  it('fewer than 2 long runs → null', () => {
    expect(estimateDurability([long('2026-07-10', 16, 9.5 * 60, 150, 5)], { today: T })).toBeNull();
    expect(estimateDurability([], { today: T })).toBeNull();
  });
  it('short runs only (no long runs) → null', () => {
    const shorts = [{ date: '2026-07-10', distanceMi: 4, durationSecs: 1800, activityType: 'run', avgHR: 150 }];
    expect(estimateDurability(shorts, { today: T })).toBeNull();
  });
  it('carries provenance + an as-of date', () => {
    const d = estimateDurability([long('2026-07-05', 16, 9.2 * 60, 150, 4.1), long('2026-07-12', 18, 9.3 * 60, 151, 3.6)], { today: T });
    expect(d.asOf).toBeTruthy();
    expect(Array.isArray(d.basis)).toBe(true);
    expect(d.basis.length).toBeGreaterThan(0);
  });
});
