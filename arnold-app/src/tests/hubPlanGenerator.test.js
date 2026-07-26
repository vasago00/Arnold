// Tests for the plan generator (core/hub/planGenerator.js).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { generateWeeklyPlan, pacesFromHubFacts, generateSeasonBlock, pasteSeasonBlock, clearSeasonBlock } from '../core/hub/planGenerator.js';

const runDaysOf = days => days.filter(d => d && d.type !== 'strength' && d.type !== 'mobility').length;
const strengthOf = days => days.filter(d => d && (d.type === 'strength' || d.strength)).length;
const isHard = d => d && (d.type === 'intervals' || d.type === 'tempo' || d.type === 'long_run');

test("Emil's config (5 run / 3 strength / hybrid) → right counts + a rest day", () => {
  const { days, summary } = generateWeeklyPlan({ runDays: 5, strengthDays: 3, focus: 'hybrid', weeklyMileageTarget: 30 });
  assert.equal(runDaysOf(days), 5);
  assert.equal(strengthOf(days), 3);
  assert.equal(days.filter(d => d && d.type === 'long_run').length, 1);
  assert.equal(summary.quality, 2);
  assert.ok(days.some(d => d === null || d?.type === 'mobility'), 'should include at least one recovery day (rest or mobility)');
});

test('open days become mobility (recovery) so mobility runs through the whole plan', () => {
  const { days } = generateWeeklyPlan({ runDays: 4, strengthDays: 1, focus: 'hybrid', weeklyMileageTarget: 25 });
  assert.ok(days.some(d => d && d.type === 'mobility'), 'a light week schedules mobility on the open days');
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

// ── De-linearize (3.2c): cut-back weeks + rotating quality ──
test('de-linearize: a sustained build gets cut-back weeks (saw-tooth) while the ramp keeps climbing', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', targetRaceDate: '2026-12-06' });
  const cutbacks = weeks.filter(w => w.cutback);
  assert.ok(cutbacks.length >= 1, 'a long build has at least one cut-back week');
  for (const wc of cutbacks) {
    assert.equal(wc.phase, 'build', 'cut-back keeps phase=build (downstream phase logic unchanged)');
    const idx = weeks.indexOf(wc);
    assert.ok(idx > 0 && wc.targetWeeklyMiles < weeks[idx - 1].targetWeeklyMiles, 'cut-back week steps DOWN vs the prior week');
  }
  const builds = weeks.filter(w => w.phase === 'build' && !w.cutback);
  assert.ok(builds[builds.length - 1].targetWeeklyMiles >= builds[0].targetWeeklyMiles, 'the underlying ramp still climbs across the build');
});

test('de-linearize: short blocks (<8 wk) get NO cut-back (pure ramp preserved)', () => {
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, races: RACES, today: '2026-07-06', horizon: 4 });
  assert.ok(weeks.every(w => !w.cutback), 'no cut-back weeks in a 4-week block');
});

test('day prefs: honors pinned strength days (strengthDows)', () => {
  const { days } = generateWeeklyPlan({ availableDays: [0,1,2,3,4,5,6], runDays: 5, strengthDays: 2, focus: 'hybrid', weeklyMileageTarget: 35, strengthDows: [1, 3] });
  assert.ok(days[1] && (days[1].type === 'strength' || days[1].strength), 'Tue has strength');
  assert.ok(days[3] && (days[3].type === 'strength' || days[3].strength), 'Thu has strength');
});

test('day prefs: honors the pinned long-run day (longRunDow)', () => {
  const { days } = generateWeeklyPlan({ availableDays: [0,1,2,3,4,5,6], runDays: 5, strengthDays: 2, focus: 'hybrid', weeklyMileageTarget: 35, longRunDow: 2 });
  assert.equal(days[2]?.type, 'long_run', 'Wed is the long run');
});

test('de-linearize: qualityLead rotates the leading hard session', () => {
  // focus base → 1 quality day, so the LEAD type is the only quality type placed.
  const d1 = generateWeeklyPlan({ runDays: 5, strengthDays: 0, focus: 'base', weeklyMileageTarget: 35, qualityLead: 'intervals' }).days;
  const d2 = generateWeeklyPlan({ runDays: 5, strengthDays: 0, focus: 'base', weeklyMileageTarget: 35, qualityLead: 'tempo' }).days;
  assert.ok(d1.some(d => d && d.type === 'intervals') && !d1.some(d => d && d.type === 'tempo'), 'intervals-led week');
  assert.ok(d2.some(d => d && d.type === 'tempo') && !d2.some(d => d && d.type === 'intervals'), 'tempo-led week');
});

test('ramp PAUSES across race + recovery — no invisible snap-back past the trained peak (Emil 2026-07)', () => {
  // Full Valencia season from a real slow base. The bug was the ramp climbing UNDER the
  // race dips, so the week after a recovery snapped to a line never actually trained
  // (22 → 36 → 48). With the ramp frozen on non-build weeks, the resume after a race
  // recovery must be ONE ~10% step over the volume held BEFORE that race, not a leap.
  const base = 13.6;
  const { weeks } = generateSeasonBlock({ ...SEASON_BASE, weeklyMiles: base, longestRecentMi: 12, ceilingMiles: 48, races: RACES, today: '2026-07-24', targetRaceDate: '2026-12-06' });
  const T = weeks.map(w => w.targetWeeklyMiles || 0);
  const acwr = (i) => { const p = T.slice(Math.max(0, i - 4), i); const c = p.reduce((s, x) => s + x, 0) / p.length; return c > 0 ? T[i] / c : 0; };
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks[i - 1], cur = weeks[i];
    // Only check a pure build week that FOLLOWS a race or post-race recovery (the resume).
    const resume = cur.phase === 'build' && !cur.cutback && !cur.raceName && !cur.recoveryAfterRace
      && (prev.recoveryAfterRace || prev.raceName);
    if (!resume) continue;
    // The resume must be a RAMPED return, not a leap onto an untrained line: capped step
    // over the dip week, and the acute:chronic ratio stays out of the injury-danger zone
    // (the old snap produced ~+64% jumps and ACWR spikes).
    assert.ok(cur.targetWeeklyMiles <= Math.round(prev.targetWeeklyMiles * 1.4) + 1, 'resume is a capped ramp, not a leap');
    assert.ok(acwr(i) <= 1.8, `resume ACWR in-band, got ${acwr(i).toFixed(2)}`);
  }
  // The peak is HONESTLY reached: it climbs meaningfully above the slow base but never
  // fabricates the theoretical 48 — pausing through two mid-season marathons genuinely
  // caps it (the plan surfaces that instead of faking the ceiling).
  const peak = Math.max(...T);
  assert.ok(peak > base * 1.5 && peak <= 48, `peak honestly above base, under ceiling, got ${peak}`);
});

test("refresh paste re-baselines FUTURE machine days but never rewrites the past or a knee cross-swap", () => {
  const today = '2026-07-27';   // a Monday
  const planner = {
    '2026-07-20': { days: [   // entirely in the PAST vs today
      { type: 'easy_run', distanceMi: 3, generated: true },
      { type: 'strength', generated: false },                 // past hand-edit
      ...Array(5).fill(null).map(() => ({ type: 'rest' })),
    ] },
    '2026-07-27': { days: [   // Mon = today, rest future
      { type: 'easy_run', distanceMi: 8, generated: true },   // today, generated → re-baseline
      { type: 'tempo', distanceMi: 7, generated: false },     // FUTURE hand-edited run → re-baseline (living)
      { type: 'bike', generated: false },                     // FUTURE cross-swap → PRESERVE (knee)
      ...Array(4).fill(null).map(() => ({ type: 'rest' })),
    ] },
  };
  const fresh = [
    { weekKey: '2026-07-20', phase: 'build', days: Array(7).fill(null).map(() => ({ type: 'easy_run', distanceMi: 2 })) },
    { weekKey: '2026-07-27', phase: 'build', days: Array(7).fill(null).map(() => ({ type: 'easy_run', distanceMi: 3 })) },
  ];
  const store = { get: () => planner, set: (_k, v) => { store._saved = v; } };
  const { resynced } = pasteSeasonBlock(store, fresh, { mode: 'refresh', today });
  const past = store._saved['2026-07-20'].days;
  const cur = store._saved['2026-07-27'].days;
  assert.equal(past[1].type, 'strength', 'past hand-edit untouched');
  assert.ok(!past[0].generated || past[0].distanceMi === 3, 'past week not re-baselined (history is history)');
  assert.equal(cur[0].distanceMi, 3, 'today generated day re-baselined to the fresh road');
  assert.equal(cur[1].distanceMi, 3, 'future hand-edited RUN re-baselined (living plan wins)');
  assert.equal(cur[2].type, 'bike', 'future cross-train swap preserved (knee choice)');
  assert.ok(resynced >= 1, 'counts the stale future hand-edit it re-baselined');
});
