// Tests for the quality-session structure generator (task #35).
import { describe, it, expect } from 'vitest';
import { buildQualityStructure } from './workoutStructure.js';

const paces = { tempo: 420, interval: 380 };   // 7:00 and 6:20 /mi

describe('buildQualityStructure', () => {
  it('returns null for non-quality sessions', () => {
    expect(buildQualityStructure({ type: 'easy_run' })).toBe(null);
    expect(buildQualityStructure({ type: 'long_run' })).toBe(null);
    expect(buildQualityStructure({ type: 'rest' })).toBe(null);
  });

  it('tempo → cruise with the tempo pace in the shorthand', () => {
    const s = buildQualityStructure({ type: 'tempo', phase: 'build', paces, seed: 0 });
    expect(s.tag).toBe('3×2mi');
    expect(s.shape).toBe('cruise');
    expect(s.shorthand).toMatch(/3 × 2 mi @ 6:55.7:05/);   // tempo 7:00 ±5s → a target RANGE
    // profile: wu + 3 reps + 2 recoveries + cd = 7 segments
    expect(s.profile.length).toBe(7);
    expect(s.profile[0][1]).toBeLessThan(0.4);     // warm-up is low effort
    expect(s.profile[1][1]).toBeGreaterThan(0.7);  // first rep is high effort
  });

  it('intervals seed 0 → pyramid; profile rises then falls by rep duration', () => {
    const s = buildQualityStructure({ type: 'intervals', phase: 'build', paces, seed: 0 });
    expect(s.tag).toBe('1-2-3-2-1');
    expect(s.shape).toBe('pyramid');
    // rep durations (odd-indexed work segments, skipping wu[0]) go 1,2,3,2,1
    const reps = s.profile.slice(1, -1).filter((_, i) => i % 2 === 0).map(p => p[0]);
    expect(reps).toEqual([1, 2, 3, 2, 1]);
    expect(s.shorthand).toMatch(/6:14.6:26/);   // interval 6:20 ±6s → a target RANGE
  });

  it('rotates the shape across weeks (seed)', () => {
    const tags = [0, 1, 2].map(seed => buildQualityStructure({ type: 'tempo', paces, seed }).tag);
    expect(new Set(tags).size).toBe(3);   // three distinct sessions
  });

  it('taper week → a short sharpener, not a big block', () => {
    const s = buildQualityStructure({ type: 'tempo', phase: 'mini-taper', paces, seed: 0 });
    expect(s.tag).toBe('3×1mi');
  });

  it('works without paces (falls back to effort words)', () => {
    const s = buildQualityStructure({ type: 'intervals', seed: 0 });
    expect(s.shorthand).toMatch(/5K pace/);
  });
});
