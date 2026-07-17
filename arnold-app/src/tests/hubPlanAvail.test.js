// Tests for availableDays handling in the plan generator.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { generateWeeklyPlan } from '../core/hub/planGenerator.js';

test('TRAINING lands ONLY on available days; off-days are Recovery (not rest gaps)', () => {
  const { days } = generateWeeklyPlan({ availableDays: [4, 5, 6], runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  const TRAINING = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit', 'strength']);
  // Unavailable days (Mon-Thu) carry NO training session — but they are now filled with
  // Recovery/mobility (the unified-Recovery model: a day you can't train IS a recovery
  // day), so the plan reads as a complete week instead of leaving blank rest gaps.
  for (let i = 0; i < 4; i++) {
    const d = days[i];
    assert.ok(!(d && (TRAINING.has(d.type) || d.strength)), `no training on unavailable day (idx ${i})`);
    assert.ok(d == null || d.type === 'mobility', `unavailable day is Recovery or rest, not a workout (idx ${i})`);
  }
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
