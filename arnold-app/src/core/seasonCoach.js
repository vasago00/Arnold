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
import { localDate, startOfWeek, addDays } from './time.js';

const DAY = 86400000;
// Emil's season goal — sub-3:40 marathon. Used when a race carries no explicit
// goalTimeSecs. Configurable per-call.
const DEFAULT_MARATHON_GOAL_SECS = 13200;

/**
 * The app's ONE definition of "what you're actually running right now": trailing 28 days
 * of logged runs, expressed as mi/wk, plus the longest single run in that window.
 * Exported so the plan generator's volume BASE reads the same number the coach panel
 * shows — one formula, one answer, no parallel re-derivation.
 * Returns zeros when there are no logged runs; callers must treat that as "no base",
 * never substitute a target or a constant (a fabricated base ramps the plan to volume
 * that was never run).
 */
export function recentRunStats(activities, today) {
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
 * WHERE A RAMP STARTS — a different question from "what is your 28-day load", and the
 * reason this function exists next to `recentRunStats` instead of replacing it.
 *
 *   `recentRunStats().weeklyMiles` is a trailing-28-day MEAN. That is the correct number
 *   for chronic load (it is what ACWR is defined against) and it must not change.
 *
 *   But a ramp does not start from a mean. It starts from the volume the athlete is
 *   CURRENTLY HOLDING, because next week's safe load is a step up from last week's real
 *   load. A mean answers that badly, and it fails hardest in the exact case that matters:
 *   ONE anomalous week. Emil, 2026-07-25 — his last four complete weeks were
 *   0, 10.6, 19.0, 19.3 mi (one blank week from travel or a gap in the sync). The mean is
 *   12.2. The median is 14.8. He is plainly not a 12-mile-a-week runner, and the cost of
 *   pretending he is compounds for nineteen weeks: a base of 12.2 tops the Valencia build
 *   out at a 29 mi/wk peak, while a base of 19.3 reaches 44 — the difference between
 *   "sub-3:40 is off the table" and "sub-3:40 is exactly on target", decided entirely by
 *   one empty week four weeks ago.
 *
 * So: the MEDIAN of the last four COMPLETE Monday-anchored weeks — RAISED by two
 * recency terms, and capped at demonstrated capacity.
 *
 *   anchor = max( median4, minLast2 )                      ← robust, slow-moving
 *   step   = min( max(weekToDate, lastCompleteWeek), anchor × 1.10 )   ← one week, collared
 *   base   = min( max(anchor, step), demonstratedMi )
 *
 *   - Median of 4, because it is the standard robust estimator against one blank week.
 *   - Capped at demonstrated capacity, because the base may never claim more than the
 *     athlete has actually held. This cap is what makes the two recency terms safe.
 *
 * CORRECTED 2026-07-25 — the median ALONE was wrong, and wrong in a way that only shows
 * up when volume is climbing. Robustness is symmetric: the same statistic that refuses to
 * be dragged down by a zero also refuses to be lifted by a genuine step up. Emil ran a
 * 33-mile week off a [10.6, 19, 19.3] history; the median read 19.2 and the plan
 * prescribed 21 for the following week. Measured over five weeks the gap between
 * prescribed and actual ran −12, −6, −3, −1, 0 — it converged only because the window
 * eventually forgot the old weeks. And for an athlete who OBEYS the low number it does
 * not converge at all: 21 → 23 → 25 → 27 → 28 → 31, i.e. six weeks after running 33 the
 * plan has rebuilt him to below where he already was, because following the low
 * prescription is what keeps the base low. The promotion loop cannot catch this — his
 * delivery ratio is 1.0; he is doing exactly what he was told.
 *
 * Hence the two MAX terms. Both can only ever RAISE the base, never lower it:
 *   - minLast2 — the level the two most recent COMPLETE weeks BOTH support. The MEAN of
 *     those two weeks was the first version of this term and it is wrong: one 60-mile week
 *     against a 19-mile history means a mean of 39.7, and the base leaps to the
 *     demonstrated cap on the strength of a single Sunday (the `rampbase` hero-week case
 *     caught exactly this). The min asks the better question, because two consecutive
 *     elevated weeks are a LEVEL and one is an EVENT — and it is robust by construction in
 *     both directions, since no single week, high or low, can move it at all.
 *   - weekToDate — the CURRENT, still-running week, counted as a floor only. The original
 *     "complete weeks only" rule exists so a partial week cannot DRAG the base down by
 *     however far into the week you happen to be standing; used one-directionally that
 *     concern disappears entirely, while the athlete stops having to wait until Monday
 *     for the miles already in his legs to be worth anything. This is the term that
 *     actually answers Emil's complaint: run 33 on Saturday and the plan knows on Saturday.
 *
 * The demonstrated cap keeps the whole thing honest in the other direction: the base may
 * never claim more than a level the athlete has genuinely sustained for a month.
 * One big week earns credit; it does not earn a new training level.
 *
 * Returns the number AND the weeks it came from, so no surface ever has to present this
 * as a number from nowhere — the UI shows the four weeks and the method underneath it.
 * Zero logged running returns 0 with `weeks: []`; callers must treat that as "no base"
 * and never substitute a target or a constant.
 *
 * @returns {{ baseMi:number, method:string, weeks:{weekKey:string,mi:number}[], mean28Mi:number, medianMi:number, minLast2Mi:number, weekToDateMi:number, cappedBy:number|null }}
 */
export function rampBaseMi(activities, today, { demonstratedMi = null, weeks: nWeeks = 4 } = {}) {
  const runs = (activities || []).filter(a => a && a.date && isRun(a));
  const mean28 = recentRunStats(activities, today).weeklyMiles;

  // The Monday of the week BEFORE the one we are standing in — i.e. the most recent
  // week that is actually finished. startOfWeek/addDays are the local-time helpers from
  // time.js; nothing here touches toISOString (see that file's header on UTC rollover).
  const thisMonday = startOfWeek(today);
  const buckets = [];
  for (let i = nWeeks; i >= 1; i--) {
    const start = addDays(thisMonday, -7 * i);
    const end = addDays(start, 6);
    const mi = runs.reduce((t, a) => {
      const d = String(a.date).slice(0, 10);
      return d >= start && d <= end ? t + (Number(a.distanceMi) || 0) : t;
    }, 0);
    buckets.push({ weekKey: start, mi: Math.round(mi * 10) / 10 });
  }

  if (!runs.length) return { baseMi: 0, method: 'no logged running', weeks: [], mean28Mi: 0, cappedBy: null };

  const sorted = buckets.map(b => b.mi).sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median = sorted.length % 2
    ? sorted[Math.floor(mid)]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  // The two one-directional recency terms (see the header). Both are MAXed in, so neither
  // can ever pull the base below what the robust median already established.
  //
  // MIN of the last two, not their mean. The mean was the obvious choice and it fails the
  // hero-week test outright: one 60-mile week against a 19-mile history gives a mean of
  // 39.7, and the base leaps to the demonstrated cap on the strength of a single Sunday.
  // The min asks a better question — "what level do the last TWO weeks BOTH support?" —
  // and that is the actual definition of a level as opposed to an event. It is robust by
  // construction in both directions: no single week, high or low, can move it at all.
  const tail = buckets.slice(-2).map(b => b.mi);
  const minLast2 = tail.length ? Math.min(...tail) : 0;

  // Week-to-date: thisMonday → today inclusive. `today` is the caller's LOCAL date string
  // (time.js owns that); comparing yyyy-mm-dd slices lexically is date comparison here
  // because the format is fixed-width and zero-padded. Nothing touches toISOString.
  const weekToDate = runs.reduce((t, a) => {
    const d = String(a.date).slice(0, 10);
    return d >= thisMonday && d <= today ? t + (Number(a.distanceMi) || 0) : t;
  }, 0);

  // THE MONDAY CLIFF, and why the single-week term is collared rather than free.
  //
  // A free week-to-date floor is not self-consistent. Run 33 by Saturday off a 19-mile
  // history and the base leaps to the demonstrated cap; then on Monday that week becomes
  // COMPLETE, minLast2 judges it against the 19.3 beside it, and the base falls back to
  // 19.3. The athlete gained a week of evidence and the plan got smaller — which is
  // absurd, and it is exactly the kind of same-thing-computed-two-ways jitter that makes
  // a living plan feel untrustworthy.
  //
  // So ONE rule covers a single week whether it is finished or still running: it may lift
  // the base by at most one safe weekly progression above the robust anchor. Same 10% the
  // rest of the app ramps at (seasonPlan.MAX_RAMP_PCT) — a single week is evidence that
  // you can take a STEP, not evidence of a new training level. Because the collar is a
  // fraction of the anchor and the anchor only ever grows as good weeks accumulate, the
  // number is monotone across the Monday boundary: 19 → 20.9 on Saturday → 21.2 once the
  // week completes. It goes up, then up again. It never claws anything back.
  const SINGLE_WEEK_LIFT = 1.10;
  const anchor = Math.max(median, minLast2);
  const lastComplete = buckets.length ? buckets[buckets.length - 1].mi : 0;
  const singleWeek = Math.min(Math.max(weekToDate, lastComplete), anchor * SINGLE_WEEK_LIFT);
  const raw = Math.max(anchor, singleWeek);
  // Name the term that actually won, so the UI can show its working rather than printing
  // a method line that no longer describes the number sitting next to it. Note the test is
  // `singleWeek > anchor`, NOT `raw === weekToDate`: under the collar the winning number is
  // usually anchor×1.10 rather than the week's own mileage, so an equality test against the
  // raw week would silently stop firing and the card would claim the median every time.
  const singleWeekWon = singleWeek > anchor;
  const method = singleWeekWon
    ? (weekToDate >= lastComplete
        ? 'one step up from the week you are already running'
        : 'one step up from your most recent week')
    : minLast2 > median
      ? 'the level your last 2 complete weeks both support'
      : `median of your last ${nWeeks} complete weeks`;

  const cap = Number(demonstratedMi) > 0 ? Number(demonstratedMi) : null;
  const capped = cap != null && raw > cap;
  return {
    baseMi: Math.round((capped ? cap : raw) * 10) / 10,
    method,
    weeks: buckets,
    mean28Mi: Math.round(mean28 * 10) / 10,
    medianMi: Math.round(median * 10) / 10,
    minLast2Mi: Math.round(minLast2 * 10) / 10,
    weekToDateMi: Math.round(weekToDate * 10) / 10,
    cappedBy: capped ? cap : null,
  };
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
