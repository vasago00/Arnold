// Tests for generateAndSaveWeek + mondayKeyOf (planner write).
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAndSaveWeek, mondayKeyOf } from '../src/core/hub/planGenerator.js';

test('mondayKeyOf anchors to the Monday of that week', () => {
  assert.equal(mondayKeyOf('2026-06-07'), '2026-06-01'); // Sun 6/7 → Mon 6/1
  assert.equal(mondayKeyOf('2026-06-01'), '2026-06-01'); // Mon → itself
});

test('generateAndSaveWeek writes the week into the planner store', () => {
  const mem = {};
  const store = { get: k => mem[k], set: (k, v) => { mem[k] = v; } };
  const { plan, key } = generateAndSaveWeek(store, {
    today: '2026-06-07', runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30, longRunDow: 6,
  });
  assert.equal(key, '2026-06-01');
  assert.ok(mem.planner[key].generated);
  assert.equal(mem.planner[key].days.length, 7);
  assert.equal(plan.days.filter(d => d && d.type === 'long_run').length, 1);
  // long run on Sunday (index 6) per longRunDow
  assert.equal(plan.days[6].type, 'long_run');
});

test('preserves other weeks already in the planner', () => {
  const mem = { planner: { '2025-01-06': { days: Array(7).fill(null) } } };
  const store = { get: k => mem[k], set: (k, v) => { mem[k] = v; } };
  generateAndSaveWeek(store, { today: '2026-06-07', runDays: 4, strengthDays: 2, focus: 'base', weeklyMileageTarget: 25 });
  assert.ok(mem.planner['2025-01-06'], 'old week kept');
  assert.ok(mem.planner['2026-06-01'], 'new week added');
});
