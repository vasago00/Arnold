// Hub core cut 5 — backfill: chronological replay of history seeds both ledgers.
//
// Run with:  node arnold-app/tests/hubBackfill.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { backfillHub, defaultSelectCheckpoints } from '../src/core/hub/backfill.js';
import { getParam } from '../src/core/hub/fitnessModel.js';
import { sensitivityOf } from '../src/core/hub/responseModel.js';
import { RACE_FITNESS_PARAM, predictFromFitness } from '../src/core/hub/raceFitness.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const secsOf = a => Number(a.actualSecs ?? a.durationSecs);
const fakeAttribution = (race, { expectedSecs }) => {
  const actual = secsOf(race);
  const div = expectedSecs ? (actual - expectedSecs) / expectedSecs : null;
  return {
    verdict: div == null ? 'no-expectation' : div > 0.02 ? 'underperformed' : div < -0.02 ? 'overperformed' : 'as-expected',
    divergencePct: div,
    effort: 'hard',
    acute: race.hot ? [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 }] : [],
    chronic: [],
  };
};

test('defaultSelectCheckpoints: races, pace-detected efforts, and long runs — not easy/HYROX', () => {
  const acts = [
    { date: '2026-02-01', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5100 },
    { date: '2026-03-01', activityType: 'running', name: '10K', distanceKm: 10, durationSecs: 2700 },
    { date: '2026-03-15', activityType: 'running', name: '10K', distanceKm: 10, durationSecs: 3000 },
    { date: '2026-03-20', activityType: 'running', name: 'Morning Run', distanceMi: 4.2, durationSecs: 2400 },
    { date: '2026-03-25', type: 'hyrox', name: 'HYROX', distanceKm: 0, durationSecs: 5000 },
  ];
  const sel = defaultSelectCheckpoints(acts);
  const picked = sel.map(c => c.run.date);
  assert.ok(picked.includes('2026-02-01'), 'long run kept');
  assert.ok(picked.includes('2026-03-01'), 'fast 10K kept');
  assert.ok(!picked.includes('2026-03-15'), 'training-pace 10K dropped');
  assert.ok(!picked.includes('2026-03-20'), 'easy run dropped');
  assert.ok(!picked.includes('2026-03-25'), 'HYROX dropped');
  assert.equal(sel.find(c => c.run.date === '2026-03-01').tier, 'race', 'fast 10K tiered race');
  assert.equal(sel.find(c => c.run.date === '2026-02-01').tier, 'long', 'long run tiered long');
});

test('replays chronologically: first race seeds fitness, a later hot+slow race teaches heat', () => {
  const activities = [
    { date: '2026-05-01', activityType: 'running', type: 'race', name: 'HM', distanceMi: 13.1, durationSecs: 5600, hot: true },
    { date: '2026-03-01', activityType: 'running', type: 'race', name: '10K', distanceKm: 10, durationSecs: 2400 },
    { date: '2026-04-01', activityType: 'running', type: 'race', name: '10K', distanceKm: 10, durationSecs: 2400 },
  ];
  const { state, trace, count } = backfillHub(activities, { attributionFn: fakeAttribution, k: 1.06 });
  assert.equal(count, 3);
  assert.equal(trace[0].date, '2026-03-01', 'processed oldest first');
  const fit = getParam(state.fitness, RACE_FITNESS_PARAM).value;
  assert.ok(Math.abs(fit - 2400) < 120, `fitness seeded near 2400, got ${fit}`);
  assert.ok(sensitivityOf(state.response, 'heat').value > 0, 'heat learned from the confounded HM');
  assert.ok(predictFromFitness(state.fitness, 10, { k: 1.06 }).secs > 0, 'hub predicts a 10K');
});

test('a single race with no history just seeds fitness (no response, no crash)', () => {
  const { state, count } = backfillHub(
    [{ date: '2026-03-01', activityType: 'running', type: 'race', distanceKm: 10, durationSecs: 2400 }],
    { attributionFn: fakeAttribution },
  );
  assert.equal(count, 1);
  assert.ok(getParam(state.fitness, RACE_FITNESS_PARAM).value > 0, 'fitness seeded');
  assert.deepEqual(state.response.factors, {}, 'no residual to attribute yet');
});

test('empty / no-checkpoint history → a clean empty hub', () => {
  const { state, count } = backfillHub(
    [{ date: '2026-01-01', activityType: 'running', name: 'easy', distanceMi: 4, durationSecs: 2400 }],
    { attributionFn: fakeAttribution },
  );
  assert.equal(count, 0);
  assert.deepEqual(state.fitness.params, {});
  assert.deepEqual(state.response.factors, {});
});

test('throws clearly if no attributionFn is supplied', () => {
  assert.throws(() => backfillHub([], {}), /requires opts.attributionFn/);
});

console.log(`\nhubBackfill: ${passed} tests passed`);
