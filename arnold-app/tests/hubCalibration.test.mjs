// Hub go-live Step 1 — calibration: a real race effort should DOMINATE the
// fitness prediction (best-anchor), not be diluted toward the slow average of
// easy long runs. And with only long runs, the prediction stays conservative.
//
// Run with:  node arnold-app/tests/hubCalibration.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { backfillHub } from '../src/core/hub/backfill.js';
import { predictFromFitness } from '../src/core/hub/raceFitness.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const secsOf = a => Number(a.actualSecs ?? a.durationSecs);
const fakeAttribution = (race, { expectedSecs }) => {
  const actual = secsOf(race);
  const div = expectedSecs ? (actual - expectedSecs) / expectedSecs : null;
  return {
    verdict: div == null ? 'no-expectation' : div > 0.02 ? 'underperformed' : div < -0.02 ? 'overperformed' : 'as-expected',
    divergencePct: div, effort: null, acute: [], chronic: [],
  };
};

// Six easy long runs (17km @ 5:18/km = 5400s; pace 317.6 s/km) spanning weeks,
// plus ONE fast 10K race effort (2400s = 4:00/km). The fast 10K's pace (240) is
// well under 92% of the median long pace (≈292), so it tiers as 'race'.
const easyLongs = [
  { date: '2026-02-01', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
  { date: '2026-02-08', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
  { date: '2026-02-15', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
  { date: '2026-03-08', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
  { date: '2026-03-22', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
  { date: '2026-04-05', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
];
const fast10k = { date: '2026-03-15', activityType: 'running', name: '10K', distanceKm: 10, durationSecs: 2400 };

// What an easy long run alone projects to at 10K (the conservative number).
const longRun10kEquiv = Math.round(5400 * Math.pow(10 / 17, 1.06)); // ≈ 3055s

test('a race effort dominates: prediction tracks the fast 10K, not the long-run average', () => {
  const { state, count } = backfillHub([...easyLongs, fast10k], { attributionFn: fakeAttribution, k: 1.06 });
  assert.equal(count, 7, 'all 7 are checkpoints (6 long + 1 race)');
  const p = predictFromFitness(state.fitness, 10, { k: 1.06 });
  assert.ok(p && Math.abs(p.secs - 2400) < 80, `10K prediction tracks the race effort (~2400), got ${p && p.secs}`);
  assert.ok(p.secs < 2700, 'NOT diluted toward the ~3055s long-run projection');
});

test('with only long runs, the prediction is the conservative fallback', () => {
  const { state } = backfillHub(easyLongs, { attributionFn: fakeAttribution, k: 1.06 });
  const p = predictFromFitness(state.fitness, 10, { k: 1.06 });
  assert.ok(Math.abs(p.secs - longRun10kEquiv) < 60, `falls back to the long-run projection (~${longRun10kEquiv}), got ${p.secs}`);
  assert.ok(p.secs > 2900, 'honestly conservative when no race effort exists');
});

test('the two regimes differ by a lot — calibration is doing real work', () => {
  const withRace = predictFromFitness(backfillHub([...easyLongs, fast10k], { attributionFn: fakeAttribution }).state.fitness, 10, {});
  const longOnly = predictFromFitness(backfillHub(easyLongs, { attributionFn: fakeAttribution }).state.fitness, 10, {});
  assert.ok(longOnly.secs - withRace.secs > 400, `race anchor is far faster than the long-run floor (Δ ${longOnly.secs - withRace.secs}s)`);
});

console.log(`\nhubCalibration: ${passed} tests passed`);
