// Tests for the projection layer (Phase 3 of FITNESS_MODEL_ARCHITECTURE.md). The number must be transparent
// and must RESPOND to endurance training: same speed + more long-run volume → a faster marathon (the
// compounding). Short races carry no unproven-distance penalty. The band comes from the state's uncertainty.
import { describe, it, expect } from 'vitest';
import { estimateFitnessState } from './fitnessState.js';
import { projectRace } from './fitnessProjection.js';

const T = '2026-07-18';
const MARA = 42.195;
const OPTS = (activities) => ({ activities, today: T, hrMax: 190 });
const race = (date, mi, totalSec, avgHR = 178) => ({ date, distanceMi: mi, durationSecs: totalSec, activityType: 'running', avgHR });
const long = (date, mi, paceSecPerMi, avgHR = 150, decoup) => ({ date, distanceMi: mi, durationSecs: Math.round(mi * paceSecPerMi), activityType: 'long_run', avgHR, aerobicDecoupling: decoup });

describe('the marathon fade is transparent and reflects endurance readiness', () => {
  const underBuilt = [race('2026-06-20', 6.214, 49 * 60), race('2026-07-08', 13.11, 107 * 60, 176),
    ...['2026-06-25', '2026-07-02', '2026-07-12'].map((d) => long(d, 10.7, 9.3 * 60))];
  const state = estimateFitnessState(underBuilt, OPTS(underBuilt));

  it('projects a plausible, transparent marathon (base × a readiness fade)', () => {
    const p = projectRace(state, MARA, OPTS(underBuilt));
    expect(p.seconds).toBeGreaterThan(13200);   // > 3:40
    expect(p.seconds).toBeLessThan(15300);        // < 4:15
    expect(p.base).toBeLessThan(p.seconds);        // trained base is faster than the penalized projection
    expect(p.fade).toBeGreaterThan(1.0);
  });

  it('same speed + more long-run volume → a FASTER marathon (the compounding)', () => {
    const built = [race('2026-06-20', 6.214, 49 * 60), ...['2026-06-25', '2026-07-05', '2026-07-14'].map((d) => long(d, 20, 9.3 * 60, 150, 4.0))];
    const sBuilt = estimateFitnessState(built, OPTS(built));
    const pBuilt = projectRace(sBuilt, MARA, OPTS(built));
    const pUnder = projectRace(state, MARA, OPTS(underBuilt));
    expect(pBuilt.seconds).toBeLessThan(pUnder.seconds);
    expect(pBuilt.fade).toBeLessThan(pUnder.fade);
  });
});

describe('short races carry no unproven-distance penalty', () => {
  const acts = [race('2026-07-08', 6.214, 49 * 60)];
  it('a 10K projects at the trained base (fade = 1) and ≈ the anchor', () => {
    const s = estimateFitnessState(acts, OPTS(acts));
    const p = projectRace(s, 10, OPTS(acts));
    expect(p.fade).toBe(1);
    expect(Math.abs(p.seconds - 49 * 60)).toBeLessThan(180);
  });
});

describe('band + guards', () => {
  const acts = [race('2026-07-08', 6.214, 49 * 60), race('2026-06-20', 13.11, 107 * 60, 176)];
  it('band brackets the estimate and confidence is set', () => {
    const s = estimateFitnessState(acts, OPTS(acts));
    const p = projectRace(s, MARA, OPTS(acts));
    expect(p.low).toBeLessThan(p.seconds);
    expect(p.seconds).toBeLessThan(p.high);
    expect(p.confidence).toBeGreaterThan(0);
  });
  it('no state → null', () => {
    expect(projectRace(null, MARA, OPTS([]))).toBeNull();
  });
});
