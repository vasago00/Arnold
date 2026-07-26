// runPlanSim — the plan-model Monte-Carlo orchestrator. Samples N synthetic training
// SCENARIOS (athlete base fitness + a marathon goal + a race calendar), builds the plan
// with the REAL engine (generateSeasonBlock — imported, not re-implemented), and checks
// every plan against the plan invariants. Returns a structured, transparent report:
// hard-invariant violations (with the seed to reproduce), and the statistical rates vs
// their margins. Deterministic: same seed → same run.
//
// This is the periodization analogue of runSim.js (which pressure-tests the day-to-day
// adaptation/fuel/calorie engine). Together they hold the whole coaching stack to
// acceptance criteria across a population, not a single hand-picked athlete.

import { makeRng } from './prng.js';
import { generateSeasonBlock } from '../hub/planGenerator.js';
import { recommendedPeakMi } from '../volumeModel.js';
import { checkPlanCase, checkPlanAggregate, weeklyACWR, ACWR_SWEET_MAX, RAMP_MAX } from './planInvariants.js';

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const mondayOf = (s) => { const d = new Date(s + 'T12:00:00'); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d.getTime()); };
const addDays = (s, n) => iso(new Date(s + 'T12:00:00').getTime() + n * DAY);

// Fixed start Monday keeps the run reproducible (generateSeasonBlock is pure given `today`).
const START = '2026-07-06';

// Sample a plausible training scenario: a body's base fitness, a marathon goal, and a race
// calendar (the A-race + 0–2 intermediate races, marathons or tune-ups) over the build.
export function sampleScenario(rng) {
  const fitness = rng.choice(['rec', 'rec', 'trained', 'trained', 'elite']);
  const baseWk = fitness === 'rec' ? rng.uniform(8, 24) : fitness === 'trained' ? rng.uniform(22, 42) : rng.uniform(40, 66);
  const weeklyMiles = Math.round(baseWk * 10) / 10;
  const longestRecentMi = Math.round(Math.max(4, weeklyMiles * rng.uniform(0.30, 0.45)));
  const goalSecs = Math.round(rng.uniform(10800, 16200));   // 3:00–4:30 marathon
  const requiredPeak = recommendedPeakMi(goalSecs, 26.2);
  const aWeeksOut = rng.int(14, 22);
  const aDateMon = mondayOf(addDays(START, aWeeksOut * 7 + 5));
  const races = [{ name: 'A', date: addDays(aDateMon, 5), distanceMi: 26.2, goalTimeSecs: goalSecs, priority: 'A' }];
  const nInter = rng.int(0, 2);
  for (let i = 0; i < nInter; i++) {
    const wOut = rng.int(5, Math.max(6, aWeeksOut - 3));
    const dist = rng.choice([26.2, 26.2, 13.1, 6.2, 10]);   // marathons + tune-ups
    races.push({ name: 'R' + i, date: addDays(mondayOf(addDays(START, wOut * 7)), 5), distanceMi: dist });
  }
  races.sort((a, b) => a.date.localeCompare(b.date));
  return { fitness, weeklyMiles, longestRecentMi, goalSecs, requiredPeak, aDate: races[races.length - 1].date, races };
}

function buildPlan(sc) {
  return generateSeasonBlock({
    races: sc.races, today: START,
    weeklyMiles: sc.weeklyMiles, longestRecentMi: sc.longestRecentMi,
    ceilingMiles: sc.requiredPeak,
    aRaceDate: sc.aDate, targetRaceDate: sc.aDate,
    runDays: 5, strengthDays: 2, availableDays: [0, 1, 2, 3, 4, 5, 6],
  }).weeks;
}

const isDip = (w) => !!(w.raceName || w.recoveryAfterRace || w.cutback) || w.phase !== 'build';

export function runPlanSim({ seed = 20260706, nPlans = 1500, maxStoredViolations = 25 } = {}) {
  const rng = makeRng(seed);
  const stats = {
    plans: 0,
    buildTransitions: 0, acwrSweet: 0, acwrMax: 0,
    rampTransitions: 0, rampSmooth: 0,
    peakFeasible: 0, peakHit: 0,
    acwrHist: {},
  };
  const byInvariant = {};
  const samples = [];
  let hardViolationCount = 0;

  for (let n = 0; n < nPlans; n++) {
    const sc = sampleScenario(rng);
    if (sc.requiredPeak == null) continue;
    const weeks = buildPlan(sc);
    stats.plans++;
    const T = weeks.map((w) => w.targetWeeklyMiles || 0);

    for (const vio of checkPlanCase(sc, weeks)) {
      hardViolationCount++;
      byInvariant[vio.id] = (byInvariant[vio.id] || 0) + 1;
      if (samples.length < maxStoredViolations) samples.push({ seed: n, base: sc.weeklyMiles, peak: sc.requiredPeak, ...vio });
    }

    for (let i = 1; i < weeks.length; i++) {
      const cDip = isDip(weeks[i]), pDip = isDip(weeks[i - 1]);
      if (!cDip) {
        const a = weeklyACWR(T, i);
        if (a != null) {
          stats.buildTransitions++;
          if (a <= ACWR_SWEET_MAX) stats.acwrSweet++;
          stats.acwrMax = Math.max(stats.acwrMax, a);
          const b = (Math.floor(a * 10) / 10).toFixed(1);
          stats.acwrHist[b] = (stats.acwrHist[b] || 0) + 1;
        }
      }
      if (!cDip && !pDip) {
        stats.rampTransitions++;
        if (T[i] <= T[i - 1] * RAMP_MAX + 0.6) stats.rampSmooth++;
      }
    }

    const peak = Math.max(...T);
    const nBuild = weeks.filter((w) => w.phase === 'build' && !w.raceName && !w.recoveryAfterRace && !w.cutback).length;
    const reachable = sc.weeklyMiles < sc.requiredPeak && sc.weeklyMiles * Math.pow(1.1, nBuild) >= sc.requiredPeak * 0.98;
    if (reachable) { stats.peakFeasible++; if (peak >= sc.requiredPeak * 0.9) stats.peakHit++; }
  }

  const aggregateViolations = checkPlanAggregate(stats);
  const pct = (nn, d) => (d > 0 ? `${((nn / d) * 100).toFixed(2)}%` : 'n/a');

  return {
    seed, plans: stats.plans,
    hardViolationCount, byInvariant, samples, aggregateViolations,
    ok: hardViolationCount === 0 && aggregateViolations.length === 0,
    statistical: {
      acwrSweetRate: pct(stats.acwrSweet, stats.buildTransitions),
      acwrMax: Math.round(stats.acwrMax * 100) / 100,
      rampSmoothRate: pct(stats.rampSmooth, stats.rampTransitions),
      peakAttainRate: pct(stats.peakHit, stats.peakFeasible),
      buildTransitions: stats.buildTransitions,
      rampTransitions: stats.rampTransitions,
      peakFeasible: stats.peakFeasible,
      acwrHist: stats.acwrHist,
    },
  };
}

export default runPlanSim;
