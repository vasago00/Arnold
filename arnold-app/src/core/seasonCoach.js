// ─── core/seasonCoach.js — runtime wrapper that makes the season coach LIVE ─────
// The pure engine lives in seasonPlan.js. This file is the ONLY place that touches
// storage: it pulls Emil's real data (recent mileage, longest run, ACWR, predicted
// marathon from the empirical race anchor), runs the engine, and returns a single
// "what to do this week + are we on track" read.
//
//   getSeasonCoach()          → { plan, feasibility, inputs }   (for the Coach panel)
//   window.seasonCoachDebug() → logs the same + returns it      (inspect it live now)
//
// Wired at boot via an import in Arnold.jsx so the debug hook is always available.

import { storage } from './storage.js';
import { resolveSeasonPlan, marathonFeasibility, goalPaceSecs } from './seasonPlan.js';
import { isRun } from './activityClass.js';
import { computeAcuteChronicRatio, getEffectiveMaxHR } from './trainingStress.js';
import { findEmpiricalRaceAnchor, riegelPredictFromRun } from './derive/tileMetrics.js';
import { localDate } from './time.js';

const DAY = 86400000;
// Emil's season goal — sub-3:40 marathon. Used when a race carries no explicit
// goalTimeSecs. Configurable per-call.
const DEFAULT_MARATHON_GOAL_SECS = 13200;

function recentRunStats(activities, today) {
  const now = new Date(today + 'T12:00:00').getTime();
  const runs = (activities || []).filter(a => a && a.date && isRun(a));
  const last28 = runs.filter(a => {
    const d = new Date(a.date + 'T12:00:00').getTime();
    return d <= now && (now - d) <= 28 * DAY;
  });
  const miles28 = last28.reduce((t, a) => t + (Number(a.distanceMi) || 0), 0);
  const longest = last28.reduce((m, a) => Math.max(m, Number(a.distanceMi) || 0), 0);
  return { weeklyMiles: miles28 / 4, longestRecentMi: longest, runsLast28d: last28.length };
}

/**
 * Live season-coach read for today. Pure-engine output + the real inputs it used.
 * @param {object} [o]
 *   today, goalSecs (default sub-3:40), ceilingMiles (optional override)
 */
export function getSeasonCoach({ today = localDate(), goalSecs = DEFAULT_MARATHON_GOAL_SECS, ceilingMiles } = {}) {
  const activities = storage.get('activities') || [];
  const goals = storage.get('goals') || {};
  const races = (storage.get('races') || []).filter(r => r && r.date);

  const { weeklyMiles, longestRecentMi, runsLast28d } = recentRunStats(activities, today);

  // ACWR — best-effort (engine tolerates null).
  let acwr = null;
  try {
    const ftpPace = goals.functionalThresholdPace || '8:30';
    const maxHR = getEffectiveMaxHR(goals, activities);
    acwr = computeAcuteChronicRatio(activities, today, ftpPace, maxHR);
  } catch { acwr = null; }

  // Predicted marathon time from the empirical race anchor (Riegel projection).
  let predictedMarathonSecs = null, anchorLabel = null;
  try {
    const anchor = findEmpiricalRaceAnchor(activities);
    if (anchor && anchor.run) {
      predictedMarathonSecs = riegelPredictFromRun(anchor.run, 'tM');
      anchorLabel = anchor.label;
    }
  } catch { predictedMarathonSecs = null; }

  const plan = resolveSeasonPlan({
    races, today, weeklyMiles, longestRecentMi, acwr,
    ...(ceilingMiles ? { ceilingMiles } : {}),
  });

  // Per-race feasibility against the next race's goal (its own, or the season default).
  const raceGoal = plan.nextRace
    ? ((races.find(r => r.name === plan.nextRace.name) || {}).goalTimeSecs ?? goalSecs)
    : goalSecs;
  const feasibility = marathonFeasibility({ predictedMarathonSecs, goalSecs: raceGoal, weeklyMiles, longestRecentMi });

  return {
    plan,
    feasibility,
    inputs: {
      weeklyMiles: Math.round(weeklyMiles * 10) / 10,
      longestRecentMi,
      runsLast28d,
      acwr: acwr && acwr.ratio != null ? acwr.ratio : null,
      predictedMarathonSecs,
      anchorLabel,
      goalSecs: raceGoal,
      goalPaceSecs: goalPaceSecs(raceGoal),
    },
  };
}

if (typeof window !== 'undefined') {
  window.seasonCoachDebug = function (opts) {
    const r = getSeasonCoach(opts || {});
    console.log('=== SEASON COACH (live) ===');
    console.log('phase / verdict:', r.plan.phase, '/', r.plan.verdict);
    console.log('this week →', `target ${r.plan.targetWeeklyMiles} mi · long run ${r.plan.longRunTargetMi} mi`);
    console.log('why:', r.plan.why);
    console.log('next race:', r.plan.nextRace);
    console.log('feasibility:', r.feasibility.verdict,
      r.feasibility.limiter ? `(limiter: ${r.feasibility.limiter})` : '', '—', r.feasibility.note);
    console.log('inputs:', r.inputs);
    return r;
  };
}
