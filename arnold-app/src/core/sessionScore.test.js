// Tests for the session execution score (3.2d).
import { describe, it, expect } from 'vitest';
import { scoreSession } from './sessionScore.js';

describe('scoreSession', () => {
  it('nails a long run that hits distance + pace', () => {
    const r = scoreSession({ planned: { type: 'long_run', distanceMi: 20, paceTarget: '8:40' }, actual: { distanceMi: 20, avgPaceRaw: '8:40' } });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.verdict).toBe('nailed');
  });

  it('marks a tempo run down when the pace misses the target', () => {
    const nailed = scoreSession({ planned: { type: 'tempo', distanceMi: 5, paceTarget: '7:00' }, actual: { distanceMi: 5, avgPaceRaw: '7:00' } });
    const missed = scoreSession({ planned: { type: 'tempo', distanceMi: 5, paceTarget: '7:00' }, actual: { distanceMi: 5, avgPaceRaw: '7:45' } });
    expect(nailed.score).toBeGreaterThan(missed.score);
    expect(missed.verdict === 'partial' || missed.verdict === 'off').toBe(true);
  });

  it('penalizes an easy run done too FAST (loss of control), not too slow', () => {
    const controlled = scoreSession({ planned: { type: 'easy_run', distanceMi: 6, paceTarget: '9:30' }, actual: { distanceMi: 6, avgPaceRaw: '9:30' } });
    const tooFast = scoreSession({ planned: { type: 'easy_run', distanceMi: 6, paceTarget: '9:30' }, actual: { distanceMi: 6, avgPaceRaw: '7:45' } });
    const slower = scoreSession({ planned: { type: 'easy_run', distanceMi: 6, paceTarget: '9:30' }, actual: { distanceMi: 6, avgPaceRaw: '10:00' } });
    expect(tooFast.score).toBeLessThan(controlled.score);
    expect(slower.score).toBe(controlled.score);   // slower than easy is fine
  });

  it('marks distance down when the run is cut short', () => {
    const full = scoreSession({ planned: { type: 'long_run', distanceMi: 20, paceTarget: '8:40' }, actual: { distanceMi: 20, avgPaceRaw: '8:40' } });
    const short = scoreSession({ planned: { type: 'long_run', distanceMi: 20, paceTarget: '8:40' }, actual: { distanceMi: 12, avgPaceRaw: '8:40' } });
    expect(short.score).toBeLessThan(full.score);
  });

  it('scores strength on completion when there is no distance/pace', () => {
    const done = scoreSession({ planned: { type: 'strength' }, actual: { durationSecs: 45 * 60 } });
    const skipped = scoreSession({ planned: { type: 'strength' }, actual: { durationSecs: 5 * 60 } });
    expect(done.score).toBe(100);
    expect(skipped.score).toBe(0);
  });

  it('returns null without both inputs', () => {
    expect(scoreSession({ planned: { type: 'easy_run' } })).toBe(null);
  });

  it('judges an easy run on ZONE DISCIPLINE (HR vs the easy ceiling) when available — held vs ran hot', () => {
    const held = scoreSession({ planned: { type: 'easy_run', distanceMi: 6 }, actual: { distanceMi: 6, avgHR: 140 }, zones: { z2Ceiling: 145 } });
    const hot = scoreSession({ planned: { type: 'easy_run', distanceMi: 6 }, actual: { distanceMi: 6, avgHR: 158 }, zones: { z2Ceiling: 145 } });
    expect(held.score).toBeGreaterThan(hot.score);
    expect(held.parts.some(p => p.label === 'zone')).toBe(true);   // easy is graded on the ONE ceiling, not pace
    expect(hot.parts.some(p => p.label === 'zone')).toBe(true);
  });

  it('falls back to pace-control for an easy run when HR / ceiling are absent (unchanged behaviour)', () => {
    const r = scoreSession({ planned: { type: 'easy_run', distanceMi: 6, paceTarget: '9:30' }, actual: { distanceMi: 6, avgPaceRaw: '9:30' } });
    expect(r.parts.some(p => p.label === 'control')).toBe(true);
    expect(r.parts.some(p => p.label === 'zone')).toBe(false);
  });
});
