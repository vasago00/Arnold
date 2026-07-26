// ─── core/planAdherence.js — what you PLANNED against what you RAN ────────────
//
// The plan writes weekly targets onto the calendar. The watch writes what actually
// happened. Nothing until now put those two columns side by side over a window, so
// the only adherence read the app had was per-day ("missed a tempo"), which is too
// noisy to act on and too short to see a build coming apart.
//
// This is that read, and only that read. It makes no judgement — a ratio is not a
// verdict — because the judgement belongs to core/tierFeasibility.js#recalibrationVerdict,
// which owns the thresholds. Two modules, one thing each: this one counts, that one decides.
//
// Two deliberate rules about which weeks count:
//
//   1. The CURRENT week never counts. It is Tuesday; you have not missed Sunday's long
//      run yet. Counting an in-progress week guarantees a shortfall every Monday and
//      trains the athlete to ignore the coach.
//   2. A week with NO plan on it never counts. Zero planned miles is not 100% adherence
//      and it is not 0% either — it is a week the plan had no opinion about, and
//      averaging it in either direction would fabricate a number.

import { getPlannerWeek, weekKey, dayRunMiles } from './planner.js';
import { allActivities } from './dcyMath.js';
import { isRun } from './activityClass.js';
import { parseYmd, addDays, localDate } from './time.js';

// Week bucketing goes through planner.js#weekKey — the SAME function the calendar
// keys its stored weeks by. A second Monday-finder here, however correct, would be
// a second answer to "which week is this run in", and those two answers drift.
const mondayOf = (dateStr) => weekKey(parseYmd(dateStr) || new Date());
const addWeeks = (isoMonday, n) => addDays(isoMonday, n * 7);

/**
 * planAdherence — planned vs actual run miles per week, over a trailing window.
 *
 * @param {object} [o]
 *   today    'YYYY-MM-DD' (defaults to the real today)
 *   lookback how many COMPLETED weeks to examine (default 8)
 *   window   how many completed weeks the headline ratio averages over (default 4)
 *   activities / plannerWeek — injectable for testing; both default to storage
 * @returns {{
 *   weeks: Array<{weekKey,plannedMi,actualMi,ratio,short,counted}>,
 *   plannedMi:number, actualMi:number, ratio:number|null,
 *   weeksShort:number, countedWeeks:number
 * }}
 *   plannedMi / actualMi are MI PER WEEK averaged over the counted weeks in `window`
 *   — the same units recentRunStats reports, so the two can be compared directly.
 *   weeksShort counts CONSECUTIVE counted weeks, most recent backwards, that came in
 *   under the ratio floor. It stops at the first week that met it — a run of misses
 *   is the signal; a scatter of them is life.
 */
export function planAdherence({
  today = null, lookback = 8, window = 4, shortfallRatio = 0.85,
  activities = null, plannerWeek = null,
} = {}) {
  const todayIso = today || localDate();
  const readWeek = plannerWeek || ((k) => { try { return getPlannerWeek(k); } catch { return null; } });
  const acts = activities || (() => { try { return allActivities(); } catch { return []; } })();

  const thisMonday = mondayOf(todayIso);
  // Actual run miles per Monday-anchored week.
  const ran = new Map();
  for (const a of acts) {
    if (!a || !a.date || !isRun(a)) continue;
    const k = mondayOf(a.date);
    ran.set(k, (ran.get(k) || 0) + (Number(a.distanceMi) || 0));
  }

  const weeks = [];
  // Oldest → newest, ending with the last COMPLETED week (never the current one).
  for (let i = lookback; i >= 1; i--) {
    const k = addWeeks(thisMonday, -i);
    const wk = readWeek(k);
    const plannedMi = (wk?.days || []).reduce((s, d) => s + (dayRunMiles(d) || 0), 0);
    const actualMi = ran.get(k) || 0;
    const counted = plannedMi > 0;   // no plan on the week → the week has no opinion
    weeks.push({
      weekKey: k,
      plannedMi: Math.round(plannedMi * 10) / 10,
      actualMi: Math.round(actualMi * 10) / 10,
      ratio: counted ? Math.round((actualMi / plannedMi) * 100) / 100 : null,
      short: counted ? (actualMi / plannedMi) < shortfallRatio : false,
      counted,
    });
  }

  const countedWeeks = weeks.filter((w) => w.counted);
  const recent = countedWeeks.slice(-window);
  const plannedSum = recent.reduce((s, w) => s + w.plannedMi, 0);
  const actualSum = recent.reduce((s, w) => s + w.actualMi, 0);

  // Consecutive misses, newest backwards. Uncounted weeks are transparent: they
  // neither break a run nor extend it, because they carry no information.
  let weeksShort = 0;
  for (let i = countedWeeks.length - 1; i >= 0; i--) {
    if (countedWeeks[i].short) weeksShort++; else break;
  }

  return {
    weeks,
    plannedMi: recent.length ? Math.round((plannedSum / recent.length) * 10) / 10 : 0,
    actualMi: recent.length ? Math.round((actualSum / recent.length) * 10) / 10 : 0,
    ratio: plannedSum > 0 ? Math.round((actualSum / plannedSum) * 100) / 100 : null,
    weeksShort,
    countedWeeks: countedWeeks.length,
  };
}

export default planAdherence;
