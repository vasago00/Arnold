// Tests for accumulateBodyAndSweat (weight log → body + sweat ledgers).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHubState } from '../src/core/hub/hubState.js';
import { accumulateBodyAndSweat } from '../src/core/hub/accumulate.js';
import { predictSweatRate } from '../src/core/hub/sweatModel.js';
import { bodyWeight } from '../src/core/hub/bodyModel.js';

test('fasted-morning weigh-ins feed the body trend', () => {
  const weightLog = [
    { date: '2026-06-01', time: '07:00', weightLbs: 186 },
    { date: '2026-06-03', time: '07:10', weightLbs: 185 },
    { date: '2026-06-05', time: '06:50', weightLbs: 184.5 },
  ];
  const { state, bodyLearned } = accumulateBodyAndSweat(createHubState(), [], weightLog);
  assert.ok(bodyLearned >= 3, `learned ${bodyLearned}`);
  assert.ok(bodyWeight(state.body).value > 0);
});

test("a post-run weigh-in becomes a sweat observation (Emil's hot run)", () => {
  const day = '2026-06-06';
  const activities = [{ date: day, durationSecs: 4320, avgTemperature: 31 }]; // 1.2h run @31°C
  const weightLog = [
    { date: day, time: '07:00', weightLbs: 184.8 },  // fasted morning → body
    { date: day, time: '11:00', weightLbs: 182.9 },  // post-run → sweat (net 1.9 lb)
  ];
  const { state, sweatLearned } = accumulateBodyAndSweat(createHubState(), activities, weightLog);
  assert.equal(sweatLearned, 1);
  const p = predictSweatRate(state.sweat, 31);
  assert.ok(p.rateLhr > 0, `got ${p.rateLhr}`);
  assert.ok(p.n === 1);
});

test('fluidInL raises the gross sweat rate', () => {
  const day = '2026-06-06';
  const activities = [{ date: day, durationSecs: 3600, avgTemperature: 30 }];
  const wl = [{ date: day, time: '07:00', weightLbs: 184 }, { date: day, time: '10:00', weightLbs: 182 }];
  const dry = accumulateBodyAndSweat(createHubState(), activities, wl);
  const wet = accumulateBodyAndSweat(createHubState(), activities, wl, { fluidInL: 1 });
  assert.ok(predictSweatRate(wet.state.sweat, 30).rateLhr > predictSweatRate(dry.state.sweat, 30).rateLhr);
});

test('no post-run weigh-in → sweat stays empty', () => {
  const wl = [{ date: '2026-06-06', time: '07:00', weightLbs: 184 }]; // only morning
  const { state, sweatLearned } = accumulateBodyAndSweat(createHubState(), [{ date: '2026-06-06', durationSecs: 3600, avgTemperature: 30 }], wl);
  assert.equal(sweatLearned, 0);
  assert.equal(predictSweatRate(state.sweat, 30).n, 0);
});
