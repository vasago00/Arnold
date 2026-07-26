// Tests for ambient signal accumulation (core/hub/accumulate.js) + hubState v2.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createHubState, serializeHubState, deserializeHubState, HUB_STATE_VERSION } from '../core/hub/hubState.js';
import { usualRunHR, accumulateTrainingSignals, accumulateBodyAndSweat } from '../core/hub/accumulate.js';
import { predictSweatRate } from '../core/hub/sweatModel.js';
import { sensitivityOf } from '../core/hub/responseModel.js';

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

test('accumulateTrainingSignals learns heatStrain from hot runs (regression on temp)', () => {
  const acts = [
    { isRun: true, avgHR: 140, date: '2026-05-01' }, { isRun: true, avgHR: 140, date: '2026-05-02' },
    { isRun: true, avgHR: 140, date: '2026-05-03' }, { isRun: true, avgHR: 140, date: '2026-05-04' },
    { isRun: true, avgHR: 150, avgTemperature: 28, date: '2026-06-01' },   // ≥3 hot runs, spread of temp
    { isRun: true, avgHR: 154, avgTemperature: 31, date: '2026-06-05' },
    { isRun: true, avgHR: 158, avgTemperature: 34, date: '2026-06-10' },
  ];
  const { state, heatLearned } = accumulateTrainingSignals(createHubState(), acts);
  assert.ok(heatLearned >= 1, `learned ${heatLearned}`);
  assert.ok(sensitivityOf(state.response, 'heatStrain').value > 0);
});

test('no usable HR baseline → nothing learned', () => {
  const { heatLearned } = accumulateTrainingSignals(createHubState(), [{ isRun: true, avgHR: 150, avgTemperature: 30, date: '2026-06-01' }]);
  assert.equal(heatLearned, 0);
});

test('accumulateTrainingSignals learns HUMIDITY from humid runs (regression, no temp)', () => {
  const acts = [
    { isRun: true, avgHR: 140, date: '2026-05-01' }, { isRun: true, avgHR: 140, date: '2026-05-02' },
    { isRun: true, avgHR: 140, date: '2026-05-03' }, { isRun: true, avgHR: 140, date: '2026-05-04' },
    { isRun: true, avgHR: 148, avgHumidity: 70, date: '2026-06-01' },   // ≥3 humid runs, spread of RH
    { isRun: true, avgHR: 152, avgHumidity: 82, date: '2026-06-05' },
    { isRun: true, avgHR: 150, avgHumidity: 76, date: '2026-06-10' },
  ];
  const { state, humidityLearned } = accumulateTrainingSignals(createHubState(), acts);
  assert.ok(humidityLearned >= 1, `learned ${humidityLearned}`);
  assert.ok(sensitivityOf(state.response, 'humidity').value > 0);
});

test('accumulateTrainingSignals learns ELEVATION by grade (regression)', () => {
  const acts = [
    { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-01' }, { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-02' },
    { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-03' }, { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-04' },
    { isRun: true, avgHR: 150, distanceMi: 6, totalAscentM: 360, date: '2026-06-01' },   // 60 m/mi
    { isRun: true, avgHR: 154, distanceMi: 6, totalAscentM: 480, date: '2026-06-05' },   // 80 m/mi
    { isRun: true, avgHR: 152, distanceMi: 6, totalAscentM: 420, date: '2026-06-10' },   // 70 m/mi
  ];
  const { state, elevationLearned } = accumulateTrainingSignals(createHubState(), acts);
  assert.ok(elevationLearned >= 1, `learned ${elevationLearned}`);
  assert.ok(sensitivityOf(state.response, 'elevation').value > 0);
});

test('a flat long run does NOT read as hilly (grade gate, not total gain)', () => {
  const acts = [
    { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-01' }, { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-02' }, { isRun: true, avgHR: 140, distanceMi: 6, date: '2026-05-03' },
    { isRun: true, avgHR: 150, distanceMi: 20, totalAscentM: 200, date: '2026-06-01' },  // 200 m over 20 mi = 10 m/mi = flat
  ];
  const { elevationLearned } = accumulateTrainingSignals(createHubState(), acts);
  assert.equal(elevationLearned, 0);
});

test('a post-run weigh-in with logged fluid feeds GROSS sweat into the model', () => {
  const run = { isRun: true, date: '2026-06-20', durationSecs: 3600, avgTemperature: 25 };
  const weightLog = [
    { date: '2026-06-20', time: '07:00', weightLbs: 160 },              // fasted-am reference
    { date: '2026-06-20', time: '12:00', weightLbs: 157, fluidInL: 1 }, // post-run, drank 1 L
  ];
  const { state, sweatLearned } = accumulateBodyAndSweat(createHubState(), [run], weightLog, {});
  assert.equal(sweatLearned, 1);
  // gross = 3 lb × 0.4536 + 1 L = 2.36 L over 1 hr ≈ 2.36 L/hr — well above the 1.36 floor.
  assert.ok(predictSweatRate(state.sweat, 25).rateLhr > 2.0, 'logged fluid should lift the rate above the net-only floor');
});

test('per-entry fluid beats the net-only floor (the wiring 1.6 fixes)', () => {
  const run = { isRun: true, date: '2026-06-20', durationSecs: 3600, avgTemperature: 25 };
  const morning = { date: '2026-06-20', time: '07:00', weightLbs: 160 };
  const post = { date: '2026-06-20', time: '12:00', weightLbs: 157 };
  const floor = predictSweatRate(accumulateBodyAndSweat(createHubState(), [run], [morning, post], {}).state.sweat, 25).rateLhr;
  const withFluid = predictSweatRate(accumulateBodyAndSweat(createHubState(), [run], [morning, { ...post, fluidInL: 1 }], {}).state.sweat, 25).rateLhr;
  assert.ok(withFluid > floor, `with-fluid ${withFluid} should exceed net-only floor ${floor}`);
});
