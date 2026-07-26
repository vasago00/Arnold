// Regression for the "1:04 at 3:30" bug: the training profile must PROJECT the same distance the GOAL belongs
// to. Before the fix, a short tune-up A-race was projected (~1:04) while the goal fell back to the marathon
// performance target (3:30) → a short-race time compared against a marathon goal. buildTrainingProfile is pure,
// so we inject a predictor that ENCODES the distance it was asked for and assert projection distance ≡ goal.
import { describe, it, expect } from 'vitest';
import { buildTrainingProfile } from './trainingProfile.js';

const FUTURE = '2026-08-15';
const acts = [{ date: '2026-06-20', distanceMi: 6.21, durationSecs: 49 * 60, activityType: 'running', avgHR: 178, maxHR: 190 }];
// predictor records the km it's called with; returns a distance-encoded time so we can read back the distance.
const spyPredict = () => { const calls = []; const fn = (km) => { calls.push(km); return { seconds: Math.round(km * 300), source: 'fitness-state', low: Math.round(km * 290), high: Math.round(km * 310), confidence: 0.9, asOf: '2026-06-20' }; }; fn.calls = calls; return fn; };
const lastKm = (fn) => fn.calls[fn.calls.length - 1];

describe('the projected distance is always the goal’s distance', () => {
  it('short tune-up A-race + marathon performance goal → projects the MARATHON (not the tune-up)', () => {
    const predict = spyPredict();
    const p = buildTrainingProfile({ today: '2026-07-19', activities: acts, races: [{ name: 'Tune-up Half', date: FUTURE, distanceMi: 13.1 }], aRaceDate: FUTURE, predictFinishSecs: predict, goalSecsFallback: 12600 });
    expect(lastKm(predict)).toBeGreaterThan(41);          // ~42.195 km, NOT 21.1
    expect(p.finish.goalStr).toBe('3:30');
    // finish and goal now share the marathon distance → the gap is meaningful, not a 2.5h illusion
    expect(p.finish.now.secs).toBeGreaterThan(3 * 3600);   // a marathon-scale projection, not ~1:04
  });

  it('a marathon A-race with its OWN goal projects the marathon vs that goal', () => {
    const predict = spyPredict();
    const p = buildTrainingProfile({ today: '2026-07-19', activities: acts, races: [{ name: 'Berlin Marathon', date: FUTURE, distanceMi: 26.2, goalTimeSecs: 3 * 3600 + 35 * 60 }], aRaceDate: FUTURE, predictFinishSecs: predict, goalSecsFallback: 12600 });
    expect(lastKm(predict)).toBeGreaterThan(41);
    expect(p.finish.goalStr).toBe('3:35');
  });

  it('a half A-race with its OWN goal projects the HALF vs that goal (consistent, short is fine when paired)', () => {
    const predict = spyPredict();
    const p = buildTrainingProfile({ today: '2026-07-19', activities: acts, races: [{ name: 'City Half', date: FUTURE, distanceMi: 13.1, goalTimeSecs: 105 * 60 }], aRaceDate: FUTURE, predictFinishSecs: predict, goalSecsFallback: 12600 });
    expect(lastKm(predict)).toBeGreaterThan(20);
    expect(lastKm(predict)).toBeLessThan(23);              // ~21.1 km — projection matches the half goal
    expect(p.finish.goalStr).toBe('1:45');
  });
});
