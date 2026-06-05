// Hub core cut 5 — hubFacts: render hub state as human-readable coaching facts.
//
// Run with:  node arnold-app/tests/hubFacts.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { hubFacts, fmtTime } from '../src/core/hub/hubFacts.js';
import { backfillHub } from '../src/core/hub/backfill.js';
import { createHubState } from '../src/core/hub/hubState.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const secsOf = a => Number(a.actualSecs ?? a.durationSecs);
const fakeAttribution = (race, { expectedSecs }) => {
  const actual = secsOf(race);
  const div = expectedSecs ? (actual - expectedSecs) / expectedSecs : null;
  return {
    verdict: div == null ? 'no-expectation' : div > 0.02 ? 'underperformed' : 'as-expected',
    divergencePct: div, effort: 'hard',
    acute: race.hot ? [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 }] : [],
    chronic: [],
  };
};

test('fmtTime formats m:ss and h:mm:ss', () => {
  assert.equal(fmtTime(2400), '40:00');
  assert.equal(fmtTime(5400), '1:30:00');
  assert.equal(fmtTime(0), '—');
  assert.equal(fmtTime(null), '—');
});

test('facts from a seeded hub: predictions for all standard distances + response text', () => {
  const activities = [
    { date: '2026-03-01', activityType: 'running', type: 'race', distanceKm: 10, durationSecs: 2400 },
    { date: '2026-04-01', activityType: 'running', type: 'race', distanceMi: 13.1, durationSecs: 5600, hot: true },
  ];
  const { state } = backfillHub(activities, { attributionFn: fakeAttribution, k: 1.06 });
  const f = hubFacts(state, { k: 1.06 });

  assert.ok(f.refEquivSecs > 0, 'fitness seeded');
  assert.equal(f.predictions.length, 4, '5K/10K/HM/M');
  assert.deepEqual(f.predictions.map(p => p.dist), ['5K', '10K', 'HM', 'M']);
  f.predictions.forEach(p => assert.ok(/\d/.test(p.time), `${p.dist} has a time`));
  const secs = f.predictions.map(p => p.secs);
  assert.ok(secs[0] < secs[1] && secs[1] < secs[2] && secs[2] < secs[3], 'longer = slower');

  const heat = f.responses.find(r => r.factor === 'heat');
  assert.ok(heat && heat.perUnitPct > 0, 'heat sensitivity surfaced');
  assert.ok(/heat ≈ .*%\/°C \(confidence/.test(heat.text), 'human-readable text');
});

test('facts from an empty hub are clean and safe', () => {
  const f = hubFacts(createHubState(), {});
  assert.equal(f.refEquivSecs, null);
  assert.deepEqual(f.predictions, []);
  assert.deepEqual(f.responses, []);
  assert.equal(f.fitnessConfidence, 0);
});

console.log(`\nhubFacts: ${passed} tests passed`);
