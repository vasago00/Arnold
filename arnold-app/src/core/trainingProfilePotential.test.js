// Guards the aerobic-ceiling MARKER on the training profile: it attaches to finish.now as a SEPARATE field
// (never replacing the anchored finish), and only when the gap is actually worth showing. buildTrainingProfile
// is pure, so we inject both the finish predictor and the gap function.
import { describe, it, expect } from 'vitest';
import { buildTrainingProfile } from './trainingProfile.js';

const acts = [{ date: '2026-06-20', distanceMi: 6.214, durationSecs: 49 * 60, activityType: 'running', avgHR: 178, maxHR: 188 }];
const predict = () => ({ seconds: 3 * 3600 + 55 * 60, source: 'fitness-state', low: 14000, high: 14600, confidence: 0.9, asOf: '2026-06-20' });
const races = [{ name: 'Marathon', distanceMi: 26.2, date: '2026-11-01', goalTimeSecs: 3 * 3600 + 40 * 60 }];
const base = { today: '2026-07-19', activities: acts, races, aRaceDate: '2026-11-01', predictFinishSecs: predict };

const gapOf = (magnitude, over = {}) => () => ({ measuredVo2: 47, gapVdot: 6, magnitude, lever: 'economy+threshold', ceilingStr: '3:30:27', reachStr: '3:46:12', source: 'api', confidence: 0.7, ...over });

describe('aerobic-ceiling marker attaches beside — never as — the anchored finish', () => {
  it('a large gap attaches now.potential without changing now.str', () => {
    const p = buildTrainingProfile({ ...base, potentialGapFor: gapOf('large') });
    expect(p.finish.now).toBeTruthy();
    expect(p.finish.now.potential).toBeTruthy();
    expect(p.finish.now.potential.ceilingStr).toBe('3:30:27');
    // the ceiling is faster than the shown finish, and the finish is unchanged by the marker
    expect(p.finish.now.secs).toBe(3 * 3600 + 55 * 60);
    expect(p.finish.now.str).not.toBe(p.finish.now.potential.ceilingStr);
  });
  it('a moderate gap also attaches', () => {
    const p = buildTrainingProfile({ ...base, potentialGapFor: gapOf('moderate') });
    expect(p.finish.now.potential).toBeTruthy();
  });
  it('a small / at-ceiling gap attaches NOTHING (no daily clutter)', () => {
    expect(buildTrainingProfile({ ...base, potentialGapFor: gapOf('small') }).finish.now.potential).toBeUndefined();
    expect(buildTrainingProfile({ ...base, potentialGapFor: gapOf('none') }).finish.now.potential).toBeUndefined();
  });
  it('no gap function → no marker, finish still present', () => {
    const p = buildTrainingProfile(base);
    expect(p.finish.now).toBeTruthy();
    expect(p.finish.now.potential).toBeUndefined();
  });
});
