// Tests for goal-driven volume (3.2c follow-up). Locks the anchor (3:30 → ~48),
// the pace scaling (faster goal → more volume), the amateur clamp, and the
// marathon-only gate.
import { describe, it, expect } from 'vitest';
import { recommendedPeakMi, volumeReadout, goalRequirements } from './volumeModel.js';

describe('goalRequirements', () => {
  it('derives peak + long-run + threshold-weeks from a marathon goal', () => {
    const r = goalRequirements(3.5 * 3600, 26.2);   // sub-3:30
    expect(r.peakMi).toBe(48);
    expect(r.longRunMi).toBe(20);
    expect(r.thresholdWeeks).toBe(10);
  });
  it('long run and threshold scale within evidence bands', () => {
    expect(goalRequirements(3 * 3600).longRunMi).toBe(22);      // faster → longer long run (capped 22)
    expect(goalRequirements(4.5 * 3600).longRunMi).toBe(18);    // slower → floor 18
  });
  it('marathon-only', () => {
    expect(goalRequirements(90 * 60, 13.1)).toBe(null);
    expect(goalRequirements(null)).toBe(null);
  });
});

describe('recommendedPeakMi', () => {
  it('anchors sub-3:30 at ~48 mi/wk', () => {
    expect(recommendedPeakMi(3.5 * 3600, 26.2)).toBe(48);
  });
  it('scales up for faster goals, down for slower', () => {
    expect(recommendedPeakMi(3 * 3600, 26.2)).toBeGreaterThan(48);   // ~58
    expect(recommendedPeakMi(4 * 3600, 26.2)).toBeLessThan(48);      // ~38
    expect(recommendedPeakMi(3 * 3600)).toBeGreaterThan(recommendedPeakMi(4 * 3600));
  });
  it('clamps to a sane amateur band', () => {
    expect(recommendedPeakMi(2 * 3600, 26.2)).toBeLessThanOrEqual(70);
    expect(recommendedPeakMi(6 * 3600, 26.2)).toBeGreaterThanOrEqual(30);
  });
  it('is marathon-only (null for short races or no goal)', () => {
    expect(recommendedPeakMi(90 * 60, 13.1)).toBe(null);   // half
    expect(recommendedPeakMi(null, 26.2)).toBe(null);
  });
});

describe('volumeReadout', () => {
  it('flags behind when current base is well under the peak, with a goal note', () => {
    const r = volumeReadout({ goalTimeSecs: 3.5 * 3600, distanceMi: 26.2, currentWeeklyMi: 30 });
    expect(r.peakMi).toBe(48);
    expect(r.gapMi).toBe(18);
    expect(r.behind).toBe(true);
    // ROUND 98 — asserts the DEMAND side never opens with the bare word "peak", which
    // the delivered-peak stat tile owns. If someone renames it back, this fails.
    expect(r.note).toMatch(/^Needs 48 mi\/wk at peak — what a 3:30 marathon demands\.$/);
    expect(r.note).not.toMatch(/^Peak /);
  });
  it('not behind when already near peak', () => {
    const r = volumeReadout({ goalTimeSecs: 3.5 * 3600, currentWeeklyMi: 46 });
    expect(r.behind).toBe(false);
  });
});
