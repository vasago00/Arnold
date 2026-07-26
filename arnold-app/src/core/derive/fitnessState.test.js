// Tests for the fitness-state FILTER (Phase 2 of FITNESS_MODEL_ARCHITECTURE.md). These ARE the design
// invariants — the properties that make the number trustworthy. If any of these breaks, the model is wrong.
import { describe, it, expect } from 'vitest';
import { estimateFitnessState, buildTimeDays } from './fitnessState.js';

const T = '2026-07-18';
const OPTS = (today = T) => ({ today, hrMax: 190 });
const race = (date, mi, totalSec, avgHR = 178) => ({ date, distanceMi: mi, durationSecs: totalSec, activityType: 'running', avgHR });
const tempo = (date, mi, paceSecPerMi, avgHR = 168) => ({ date, distanceMi: mi, durationSecs: Math.round(mi * paceSecPerMi), activityType: 'tempo', avgHR });
const easy = (date, mi, paceSecPerMi, avgHR = 145) => ({ date, distanceMi: mi, durationSecs: Math.round(mi * paceSecPerMi), activityType: 'easy_run', avgHR });

describe('anchoring — the estimate exists only when real level evidence does', () => {
  it('easy-only history → null (never a number without an anchor)', () => {
    expect(estimateFitnessState(['2026-07-05', '2026-07-09', '2026-07-13'].map((d) => easy(d, 6, 9.5 * 60)), OPTS())).toBeNull();
  });
  it('a single fresh race → estimate ≈ the race, tight uncertainty', () => {
    const s = estimateFitnessState([race('2026-07-14', 6.214, 49 * 60)], OPTS());
    expect(Math.abs(s.vdot - 41)).toBeLessThanOrEqual(1.0);
    expect(s.sigma).toBeLessThan(1.3);
  });
});

describe('compounding both, weighted by trust', () => {
  it('easy runs do NOT move the level (a race + steady base miles stays at the race)', () => {
    const s = estimateFitnessState([
      race('2026-07-01', 6.214, 49 * 60),
      ...['2026-07-04', '2026-07-07', '2026-07-10', '2026-07-13', '2026-07-16'].map((d) => easy(d, 6, 9.5 * 60)),
    ], OPTS());
    expect(Math.abs(s.vdot - 41)).toBeLessThanOrEqual(1.0);
  });
  it('a faster tempo AFTER a race pulls the estimate up (quality training compounds)', () => {
    const withTempo = estimateFitnessState([race('2026-06-01', 6.214, 50 * 60), tempo('2026-07-12', 4, 470)], OPTS());
    const raceOnly = estimateFitnessState([race('2026-06-01', 6.214, 50 * 60)], OPTS('2026-06-05'));
    expect(withTempo.vdot).toBeGreaterThan(raceOnly.vdot);
  });
  it('two consistent races fuse to a tight estimate', () => {
    const s = estimateFitnessState([race('2026-06-20', 6.214, 49 * 60), race('2026-07-08', 13.11, 107 * 60, 176)], OPTS());
    expect(Math.abs(s.vdot - 41.3)).toBeLessThanOrEqual(1.0);
    expect(s.sigma).toBeLessThan(1.4);
  });
  it('improving tempos over a block → the estimate rises (monotone)', () => {
    const seq = [tempo('2026-06-01', 4, 500), tempo('2026-06-15', 4, 490), tempo('2026-07-01', 4, 480), tempo('2026-07-14', 4, 470)];
    const later = estimateFitnessState(seq, OPTS());
    const earlier = estimateFitnessState(seq.slice(0, 2), OPTS('2026-06-16'));
    expect(later.vdot).toBeGreaterThanOrEqual(earlier.vdot - 0.2);
  });
});

describe('decay — races loosen over time, on a build-time-proportional schedule', () => {
  it('an old race carries a wider band than a fresh one', () => {
    const oldR = estimateFitnessState([race('2026-03-01', 6.214, 49 * 60)], OPTS());   // ~140 d old
    const newR = estimateFitnessState([race('2026-07-14', 6.214, 49 * 60)], OPTS());   // 4 d old
    expect(oldR.sigma).toBeGreaterThan(newR.sigma);
  });
  it('a 5K anchor decays FASTER than a marathon anchor over the same gap (Emil\'s build-time rule)', () => {
    const mar = estimateFitnessState([race('2026-05-19', 26.2, 3 * 3600 + 47 * 60, 172)], OPTS());
    const k5 = estimateFitnessState([race('2026-05-19', 3.107, 21 * 60, 185)], OPTS());
    expect(k5.sigma).toBeGreaterThan(mar.sigma);
    expect(buildTimeDays({ kind: 'race', distanceKm: 42.195 })).toBeGreaterThan(buildTimeDays({ kind: 'race', distanceKm: 5 }));
  });
});

describe('provenance', () => {
  it('reports which observations moved the estimate + an as-of date', () => {
    const s = estimateFitnessState([race('2026-06-20', 6.214, 49 * 60), race('2026-07-08', 13.11, 107 * 60, 176)], OPTS());
    expect(s.asOf).toBe('2026-07-08');
    expect(Array.isArray(s.contributions)).toBe(true);
    expect(s.contributions.every((c) => typeof c.gain === 'number')).toBe(true);
  });
});
