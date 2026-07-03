// Tests for the plan generator (core/hub/planGenerator.js).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { generateWeeklyPlan, pacesFromHubFacts, generateSeasonBlock, pasteSeasonBlock, clearSeasonBlock } from '../core/hub/planGenerator.js';

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

test('pacesFromHubFacts: your observed easy pace leads; quality (tempo/interval) stays VDOT', () => {
  const facts = { predictions: [{ dist: '10K', secs: 2925 }] };
  const base = pacesFromHubFacts(facts);
  const obsVal = base.easy + 30; // 30s slower than the textbook easy — within the guardrail band
  const withObs = pacesFromHubFacts(facts, { observedEasySecs: obsVal });
  assert.equal(withObs.easy, obsVal, 'prescribes YOUR observed easy pace, not the table');
  assert.equal(withObs.tempo, base.tempo, 'tempo unchanged (effort-anchored, stays VDOT)');
  assert.equal(withObs.interval, base.interval, 'interval unchanged (stays VDOT)');
  assert.notEqual(withObs.long, undefined);
});

test('plan carries pace targets when paces supplied', () => {
  const paces = pacesFromHubFacts({ predictions: [{ dist: '10K', secs: 2925 }] });
  const { days } = generateWeeklyPlan({ runDays: 5, strengthDays: 0, focus: 'hybrid', weeklyMileageTarget: 30, paces });
  const tempo = days.find(d => d && d.type === 'tempo');
  assert.ok(tempo.paceTarget && /\d+:\d{2}/.test(tempo.paceTarget));
});

// ── Season block (2.1 — periodized multi-week) ───────────────────────────────
const RACES = [
  { name: 'Berlin',   date: '2026-09-27', distanceMi: 26.2 },
  { name: 'NYC',      date: '2026-11-01', distanceMi: 26.2 },
  { name: 'Valencia', date: '2026-12-06', distanceMi: 26.2 },
];
const SEASON_BASE = { availableDays: [0,1,2,3,4,5,6], runDays: 5, strengthDays: 2, focus: 'hybrid', weeklyMiles: 31, longestRecentMi: 9, ceilingMiles: 50 };

test('season block: numeric horizon → N build weeks that ramp mileage', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', horizon: 4 });
  assert.equal(weeks.length, 4);
  assert.ok(weeks.every(w => w.phase === 'build'), 'all build weeks in July');
  assert.ok(weeks[1].targetWeeklyMiles >= weeks[0].targetWeeklyMiles, 'mileage ramps');
  assert.ok(weeks[3].targetWeeklyMiles >= weeks[1].targetWeeklyMiles, 'keeps ramping toward ceiling');
  assert.ok(weeks.every(w => w.days.some(d => d && d.type === 'long_run')), 'each build week has a long run');
});

test('season block: next-race horizon ends on Berlin race-week with the race placed', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', horizon: 'next-race' });
  const last = weeks[weeks.length - 1];
  assert.equal(last.phase, 'race-week');
  assert.ok(last.days.some(d => d && d.type === 'race'), 'the marathon is placed on its day');
  assert.ok(!last.days.some(d => d && (d.type === 'intervals' || d.type === 'tempo' || d.type === 'long_run')), 'no quality/long in race week');
});

test('season block: recovery week after a marathon is easy-only', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-09-21', horizon: 3 });
  assert.equal(weeks[0].phase, 'race-week');
  assert.equal(weeks[1].phase, 'recovery');
  assert.ok(weeks[1].days.filter(Boolean).every(d => d.type !== 'intervals' && d.type !== 'tempo'), 'recovery has no quality');
});

test('season block: fill-empty paste protects a hand-edited day', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', horizon: 2 });
  const k0 = weeks[0].weekKey;
  const planner = { [k0]: { days: [{ type: 'strength', label: 'MY strength' }, ...Array(6).fill(null).map(() => ({ type: 'rest' }))] } };
  const store = { get: () => planner, set: (_k, v) => { store._saved = v; } };
  const { written } = pasteSeasonBlock(store, weeks, { mode: 'fill-empty' });
  assert.equal(written, 2);
  assert.equal(store._saved[k0].days[0].label, 'MY strength', 'hand-edited day preserved');
});

test('clearSeasonBlock: removes generated days, keeps hand-edits', () => {
  const key = '2026-07-06';
  const planner = { [key]: { days: [
    { type: 'easy_run', generated: true },
    { type: 'strength', label: 'MINE' },   // hand-edited (no generated flag)
    ...Array(5).fill(null).map(() => ({ type: 'rest' })),
  ] } };
  const store = { get: () => planner, set: (_k, v) => { store._saved = v; } };
  const { cleared } = clearSeasonBlock(store, [key]);
  assert.equal(cleared, 1);
  assert.equal(store._saved[key].days[0].type, 'rest', 'generated day removed');
  assert.equal(store._saved[key].days[1].label, 'MINE', 'hand-edit kept');
});

test('season block: target a race → A-RACE mode (only the goal tapers; other marathons are supported build efforts)', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', targetRaceDate: '2026-12-06' });
  const last = weeks[weeks.length - 1];
  assert.equal(last.phase, 'race-week', 'ends on the A-race week (Valencia)');
  assert.ok(last.isARace, 'last week is flagged as the A-race');
  assert.equal(weeks.filter(w => w.phase === 'race-week').length, 1, 'ONLY the A-race gets a race-week');
  // Berlin (Sep 27) + NYC (Nov 1) still appear as placed races, but inside BUILD weeks.
  const placedInBuild = weeks.filter(w => w.phase === 'build' && w.days.some(d => d && d.type === 'race'));
  assert.ok(placedInBuild.length >= 2, 'Berlin + NYC placed as supported efforts in build weeks');
  // The build keeps climbing toward the goal — a late build week is at least as big as an early one.
  const builds = weeks.filter(w => w.phase === 'build');
  assert.ok(builds[builds.length - 1].targetWeeklyMiles >= builds[0].targetWeeklyMiles, 'volume does not reset after each race');
});

test('season block: default (horizon, no A-race) still tapers EVERY marathon', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-09-21', horizon: 3 });
  assert.equal(weeks[0].phase, 'race-week', 'Berlin still race-week in continuous mode');
});
