// Hub core cut 3 — the persistent hub-state container: record checkpoints,
// accumulate across "sessions", and round-trip through (a fake) storage.
//
// Run with:  node arnold-app/tests/hubState.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import {
  createHubState, recordCheckpoint, serializeHubState, deserializeHubState,
  saveHubState, loadHubState, HUB_STATE_KEY, HUB_STATE_VERSION,
} from '../src/core/hub/hubState.js';
import { sensitivityOf } from '../src/core/hub/responseModel.js';
import { getParam } from '../src/core/hub/fitnessModel.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

// A tiny in-memory store standing in for core/storage.js {get,set}.
const fakeStore = () => { const m = new Map(); return { get: k => m.get(k), set: (k, v) => { m.set(k, v); return true; } }; };

const confoundedRace = {
  date: '2026-06-03', verdict: 'underperformed', divergencePct: 0.03, effort: 'hard',
  acute: [
    { factor: 'heat', timescale: 'acute', magnitude: 6, confidence: 0.8 },
    { factor: 'sleep', timescale: 'acute', magnitude: 2, confidence: 0.6 },
  ],
  chronic: [],
};

test('createHubState has both ledgers, an empty log, and the current version', () => {
  const s = createHubState({ fitnessPriors: { thresholdPaceSecPerKm: { value: 250, precision: 10 } } });
  assert.equal(s.version, HUB_STATE_VERSION);
  assert.equal(getParam(s.fitness, 'thresholdPaceSecPerKm').value, 250);
  assert.deepEqual(s.response.factors, {});
  assert.deepEqual(s.log, []);
  assert.equal(s.lastUpdated, null);
});

test('recordCheckpoint updates ledgers, appends a dated log entry, sets lastUpdated', () => {
  const s0 = createHubState({ fitnessPriors: { thresholdPaceSecPerKm: { value: 250, precision: 10 } } });
  const { state, ingest } = recordCheckpoint(s0, confoundedRace, {
    paramObservations: [{ param: 'thresholdPaceSecPerKm', observedValue: 258 }],
    now: '2026-06-03T12:00:00Z',
  });
  assert.ok(sensitivityOf(state.response, 'heat').value > 0, 'response learned heat');
  assert.equal(state.log.length, 1);
  assert.equal(state.log[0].date, '2026-06-03');
  assert.equal(state.log[0].verdict, 'underperformed');
  assert.equal(state.lastUpdated, '2026-06-03T12:00:00Z');
  assert.ok(ingest.summary.length > 0, 'returns the detailed router log');
});

test('accumulates: a second checkpoint grows confidence + log', () => {
  let s = createHubState();
  let r = recordCheckpoint(s, confoundedRace, {});
  const c1 = sensitivityOf(r.state.response, 'heat').confidence;
  r = recordCheckpoint(r.state, confoundedRace, {});
  const c2 = sensitivityOf(r.state.response, 'heat').confidence;
  assert.ok(c2 > c1, 'confidence grows with the second observation');
  assert.equal(r.state.log.length, 2);
});

test('serialize → deserialize is a faithful round-trip', () => {
  const { state } = recordCheckpoint(
    createHubState({ fitnessPriors: { thresholdPaceSecPerKm: { value: 250, precision: 10 } } }),
    confoundedRace,
    { paramObservations: [{ param: 'thresholdPaceSecPerKm', observedValue: 258 }] },
  );
  const restored = deserializeHubState(serializeHubState(state));
  assert.deepEqual(restored.response.factors, state.response.factors);
  assert.deepEqual(restored.fitness.params, state.fitness.params);
  assert.equal(restored.log.length, state.log.length);
});

test('save/load through a store round-trips; empty store → fresh state', () => {
  const store = fakeStore();
  assert.deepEqual(loadHubState(store).response.factors, {}, 'empty store → fresh');

  const { state } = recordCheckpoint(createHubState(), confoundedRace, {});
  saveHubState(state, store);
  assert.ok(store.get(HUB_STATE_KEY), 'persisted under the hub key');
  const reloaded = loadHubState(store);
  assert.ok(sensitivityOf(reloaded.response, 'heat').value > 0, 'survives reload');
});

test('deserialize is robust: junk, corrupt estimates, and future versions', () => {
  assert.deepEqual(deserializeHubState(null).response.factors, {}, 'null → fresh');
  assert.deepEqual(deserializeHubState('nope').response.factors, {}, 'string → fresh');
  assert.deepEqual(deserializeHubState({ version: 999 }).response.factors, {}, 'future version → fresh');

  const dirty = { version: 1, response: { factors: { heat: { value: 0.004, precision: 1 }, bad: { value: 'x' } } }, fitness: { params: {} }, log: [] };
  const cleaned = deserializeHubState(dirty);
  assert.ok(cleaned.response.factors.heat, 'keeps well-formed estimate');
  assert.equal(cleaned.response.factors.bad, undefined, 'drops corrupt estimate');
});

test('the log is bounded (no unbounded growth)', () => {
  let s = createHubState();
  for (let i = 0; i < 205; i++) s = recordCheckpoint(s, { ...confoundedRace, date: `d${i}` }, {}).state;
  assert.equal(s.log.length, 200, 'capped at 200');
  assert.equal(s.log[0].date, 'd5', 'oldest 5 dropped');
  assert.equal(s.log[199].date, 'd204', 'newest kept');
});

console.log(`\nhubState: ${passed} tests passed`);
