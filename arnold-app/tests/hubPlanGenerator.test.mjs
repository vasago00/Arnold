// Tests for the plan generator (core/hub/planGenerator.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWeeklyPlan, pacesFromHubFacts } from '../src/core/hub/planGenerator.js';

const runDaysOf = days => days.filter(d => d && d.type !== 'strength').length;
const strengthOf = days => days.filter(d => d && (d.type === 'strength' || d.strength)).length;
const isHard = d => d && (d.type === 'intervals' || d.type === 'tempo' || d.type === 'long_run');

test("Emil's config (5 run / 3 strength / hybrid) → right counts + a rest day", () => {
  const { days, summary } = generateWeeklyPlan({ runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  assert.equal(runDaysOf(days), 5);
  assert.equal(strengthOf(days), 3);
  assert.equal(days.filter(d => d && d.type === 'long_run').length, 1);
  assert.equal(summary.quality, 2);
  assert.ok(days.some(d => d === null), 'should include at least one rest day');
});

test('hard days never stack back-to-back', () => {
  const { days } = generateWeeklyPlan({ runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  for (let i = 0; i < 6; i++) assert.ok(!(isHard(days[i]) && isHard(days[i + 1])), `hard stacked at ${i}`);
});

test('strength never rides a hard or long run day', () => {
  const { days } = generateWeeklyPlan({ runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  for (const d of days) {
    if (d && d.strength && d.type !== 'strength') assert.ok(!isHard(d), `strength on hard day ${d.type}`);
  }
});

test('base focus uses a single quality session', () => {
  const { summary } = generateWeeklyPlan({ runDays: 5, strengthDays: 0, focus: 'base', weeklyMileageTarget: 30 });
  assert.equal(summary.quality, 1);
});

test('distances roughly respect the weekly target (long is the biggest)', () => {
  const { days } = generateWeeklyPlan({ runDays: 5, strengthDays: 2, focus: 'hybrid', weeklyMileageTarget: 40 });
  const long = days.find(d => d && d.type === 'long_run');
  const easies = days.filter(d => d && d.type === 'easy_run');
  assert.ok(long.distanceMi >= easies[0].distanceMi, 'long ≥ easy');
  assert.ok(long.distanceMi >= 10, 'long scales with a 40mi week');
});

test('pacesFromHubFacts derives ordered paces from the 10K prediction', () => {
  const p = pacesFromHubFacts({ predictions: [{ dist: '10K', secs: 2925 }] }); // ~7:51/mi
  assert.ok(p && p.interval < p.tempo && p.tempo < p.long && p.long < p.easy);
  assert.equal(pacesFromHubFacts({ predictions: [] }), null);
});

test('plan carries pace targets when paces supplied', () => {
  const paces = pacesFromHubFacts({ predictions: [{ dist: '10K', secs: 2925 }] });
  const { days } = generateWeeklyPlan({ runDays: 5, strengthDays: 0, focus: 'hybrid', weeklyMileageTarget: 30, paces });
  const tempo = days.find(d => d && d.type === 'tempo');
  assert.ok(tempo.paceTarget && /\d+:\d{2}/.test(tempo.paceTarget));
});
