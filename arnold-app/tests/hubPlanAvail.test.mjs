// Tests for availableDays handling in the plan generator.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWeeklyPlan } from '../src/core/hub/planGenerator.js';

test('sessions land ONLY on available days', () => {
  const { days } = generateWeeklyPlan({ availableDays: [4, 5, 6], runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  for (let i = 0; i < 4; i++) assert.equal(days[i], null, `Mon-Thu should be rest (idx ${i})`);
  assert.ok(days[4] && days[5] && days[6], 'Fri/Sat/Sun have sessions');
});

test('Fri/Sat/Sun fits a long run + caps runs to the 3 days, flags compressed', () => {
  const { days, summary } = generateWeeklyPlan({ availableDays: [4, 5, 6], runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  assert.equal(summary.runDaysPlaced, 3);
  assert.equal(summary.runDaysWanted, 5);
  assert.ok(summary.compressed, 'should flag compressed (5 wanted, 3 days)');
  assert.equal(days.filter(d => d && d.type === 'long_run').length, 1);
  assert.equal(days[6].type, 'long_run'); // long on the latest weekend day available (Sun)
});

test('long run prefers a weekend available day', () => {
  const { days } = generateWeeklyPlan({ availableDays: [0, 1, 5], runDays: 3, strengthDays: 0, focus: 'base', weeklyMileageTarget: 25 });
  assert.equal(days[5].type, 'long_run'); // Sat is the only weekend day available
});

test('strength fills empty available days before doubling', () => {
  // 5 avail days, 2 runs wanted, 2 strength → strength should take empty days, not double
  const { days } = generateWeeklyPlan({ availableDays: [0, 1, 2, 3, 4], runDays: 2, strengthDays: 2, focus: 'maintain', weeklyMileageTarget: 20 });
  const pureStrength = days.filter(d => d && d.type === 'strength').length;
  assert.ok(pureStrength >= 1, 'at least one pure strength day when days are free');
});

test('default (no availableDays) still spans the week', () => {
  const { days, summary } = generateWeeklyPlan({ runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  assert.equal(summary.runDaysPlaced, 5);
  assert.ok(!summary.compressed);
});
