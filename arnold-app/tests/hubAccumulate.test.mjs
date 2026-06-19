// Tests for ambient signal accumulation (core/hub/accumulate.js) + hubState v2.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHubState, serializeHubState, deserializeHubState, HUB_STATE_VERSION } from '../src/core/hub/hubState.js';
import { usualRunHR, accumulateTrainingSignals } from '../src/core/hub/accumulate.js';
import { sensitivityOf } from '../src/core/hub/responseModel.js';

test('hub state v2 carries body + sweat and round-trips', () => {
  assert.equal(HUB_STATE_VERSION, 2);
  const s = createHubState();
  assert.ok(s.body && Array.isArray(s.body.fasted));
  assert.ok(s.sweat && Array.isArray(s.sweat.obs));
  const round = deserializeHubState(serializeHubState(s));
  assert.ok(round.body && round.sweat);
});

test('a persisted v1 state migrates (gains empty body + sweat)', () => {
  const v1 = { version: 1, fitness: { params: {} }, response: { factors: {} }, log: [], lastUpdated: null };
  const s = deserializeHubState(v1);
  assert.equal(s.version, 2);
  assert.deepEqual(s.body.fasted, []);
  assert.deepEqual(s.sweat.obs, []);
});

test('usualRunHR is the median of non-race run HRs (needs ≥3)', () => {
  assert.equal(usualRunHR([{ isRun: true, avgHR: 140 }, { isRun: true, avgHR: 150 }]), null);
  const hr = usualRunHR([
    { isRun: true, avgHR: 138 }, { isRun: true, avgHR: 142 }, { isRun: true, avgHR: 146 },
  ]);
  assert.equal(hr, 142);
});

test('accumulateTrainingSignals learns heatStrain from hot runs', () => {
  const acts = [
    { isRun: true, avgHR: 140, date: '2026-05-01' },                          // baseline-ish
    { isRun: true, avgHR: 140, date: '2026-05-02' },
    { isRun: true, avgHR: 140, date: '2026-05-03' },
    { isRun: true, avgHR: 152, avgTemperature: 30, date: '2026-06-01' },      // hot + elevated
    { isRun: true, avgHR: 156, avgTemperature: 33, date: '2026-06-10' },
  ];
  const { state, heatLearned } = accumulateTrainingSignals(createHubState(), acts);
  assert.ok(heatLearned >= 1, `learned ${heatLearned}`);
  assert.ok(sensitivityOf(state.response, 'heatStrain').value > 0);
});

test('no usable HR baseline → nothing learned', () => {
  const { heatLearned } = accumulateTrainingSignals(createHubState(), [{ isRun: true, avgHR: 150, avgTemperature: 30, date: '2026-06-01' }]);
  assert.equal(heatLearned, 0);
});
