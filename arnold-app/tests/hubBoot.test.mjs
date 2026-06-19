// Hub go-live Step 2 — boot/persist lifecycle: load-or-backfill on boot, and
// incremental persisted record. Fake in-memory store stands in for storage.js.
//
// Run with:  node arnold-app/tests/hubBoot.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { ensureHub, recordRaceLive } from '../src/core/hub/hubBoot.js';
import { HUB_STATE_KEY } from '../src/core/hub/hubState.js';
import { getParam } from '../src/core/hub/fitnessModel.js';
import { sensitivityOf } from '../src/core/hub/responseModel.js';
import { RACE_FITNESS_PARAM } from '../src/core/hub/raceFitness.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
const fakeStore = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => { m.set(k, v); return true; }, _map: m }; };

const secsOf = a => Number(a.actualSecs ?? a.durationSecs);
const fakeAttribution = (race, { expectedSecs }) => {
  const actual = secsOf(race);
  const div = expectedSecs ? (actual - expectedSecs) / expectedSecs : null;
  return {
    verdict: div == null ? 'no-expectation' : div > 0.02 ? 'underperformed' : 'as-expected',
    divergencePct: div, effort: null,
    acute: race.hot ? [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 }] : [],
    chronic: [],
  };
};

const history = [
  { date: '2026-03-01', activityType: 'running', type: 'race', name: '10K', distanceKm: 10, durationSecs: 2400 },
  { date: '2026-02-01', activityType: 'running', name: 'Long', distanceKm: 17, durationSecs: 5400 },
];

test('ensureHub on an empty store backfills, persists, and seeds fitness', () => {
  const store = fakeStore();
  const { state, source } = ensureHub(store, { activities: history, attributionFn: fakeAttribution, k: 1.06 });
  assert.equal(source, 'backfilled');
  assert.ok(getParam(state.fitness, RACE_FITNESS_PARAM).value > 0, 'fitness seeded');
  assert.ok(store.get(HUB_STATE_KEY), 'persisted under the hub key');
});

test('ensureHub on a populated store LOADS (no rebuild)', () => {
  const store = fakeStore();
  ensureHub(store, { activities: history, attributionFn: fakeAttribution });
  // second call: even with NO activities/attributionFn, it should load the saved one
  const { state, source } = ensureHub(store, {});
  assert.equal(source, 'loaded');
  assert.ok(getParam(state.fitness, RACE_FITNESS_PARAM).value > 0, 'loaded the persisted fitness');
});

test('ensureHub with force re-backfills even when a state exists', () => {
  const store = fakeStore();
  ensureHub(store, { activities: history, attributionFn: fakeAttribution });
  const { source } = ensureHub(store, { activities: history, attributionFn: fakeAttribution, force: true });
  assert.equal(source, 'rebuilt');
});

test('recordRaceLive persists an incremental update that survives reload', () => {
  const store = fakeStore();
  ensureHub(store, { activities: history, attributionFn: fakeAttribution });
  // a new hot, slow race logged live → should teach the response model and persist
  const race = { date: '2026-05-01', activityType: 'running', type: 'race', distanceMi: 13.1, durationSecs: 5600 };
  const attribution = {
    verdict: 'underperformed', divergencePct: 0.05, effort: 'hard',
    acute: [{ factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 }], chronic: [],
  };
  recordRaceLive(store, race, attribution, { k: 1.06 });
  // reload fresh from the store → the heat sensitivity is there
  const { state } = ensureHub(store, {});
  assert.ok(sensitivityOf(state.response, 'heat').value > 0, 'response update persisted across reload');
});

console.log(`\nhubBoot: ${passed} tests passed`);
