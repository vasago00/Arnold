// ─── core/planTrace.js — the ONE read of "what am I committed to, and how is it going" ───
//
// Emil, 2026-07: "I need all data to sync and talk to each other. The Training Profile needs
// to sync with the plan when selected and trace it."
//
// Before this file, the answer to "which option is the plan built on" existed in exactly one
// place — inside LivingPlan.jsx, as component state. `getCommitment()` was imported by that
// component and by nothing else in the shipped app. So the Training Profile card rendered the
// live ladder (Current → Target → Stretch → Ceiling → Goal) with no idea which of those five
// the athlete had actually chosen, and the coach could talk about a goal the calendar was not
// building toward. Two surfaces, two answers, no way to tell which one was lying.
//
// This is the shared read. It is deliberately THIN: it does not compute a ladder, a volume
// target, or a feasibility verdict — those already have single owners (raceOutlookLive.js,
// volumeModel.js, tierFeasibility.js) and duplicating any of them here would create exactly
// the parallel system this file exists to remove. All it does is join three things that
// already exist:
//
//   1. the frozen commitment            (planCommitment.js — what was agreed to, and when)
//   2. the calendar that came from it   (planner weeks, via planAdherence.js)
//   3. the clock                        (how far into the block we are)
//
// and return one object every surface can render. If a surface needs a number that is not
// here, the fix is to add it here, not to derive it locally.
//
// Returns null when there is nothing to trace. Callers must render nothing in that case and
// must never substitute the live ladder for a commitment — "what you could do" and "what you
// agreed to do" are different sentences and conflating them is how a plan stops being
// accountable.

import { getCommitment, commitmentAppliesTo } from './planCommitment.js';
import { planAdherence } from './planAdherence.js';
import { localDate, startOfWeek, addDays } from './time.js';

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);

/**
 * @param {object} [o]
 *   today      'YYYY-MM-DD'
 *   aRaceDate  the race the CALLING SURFACE is showing. A commitment made for Berlin says
 *              nothing about how Valencia is going, so a mismatch returns `appliesHere:false`
 *              and the surface shows the commitment as belonging to another race rather than
 *              silently attributing it to this one.
 *   adherence  injectable for tests; defaults to the live planAdherence() read.
 * @returns {{
 *   commitment:object, appliesHere:boolean,
 *   tier:string, label:string, goalSecs:number,
 *   wantsPeakMi:number|null, deliversPeakMi:number|null, shortfallMi:number|null,
 *   weeksTotal:number|null, weeksElapsed:number|null, weeksLeft:number|null,
 *   committedOn:string|null, daysSinceCommit:number|null,
 *   actualMi:number, plannedMi:number, ratio:number|null, weeksShort:number,
 *   status:'on-plan'|'slipping'|'off-plan'|'too-early', headline:string
 * } | null}
 */
export function planTrace({ today = null, aRaceDate = null, adherence = null } = {}) {
  const iso = today || localDate();
  const c = getCommitment();
  if (!c) return null;

  const appliesHere = aRaceDate ? commitmentAppliesTo(c, aRaceDate) : true;

  // How far into the block are we? Anchor on the block's OWN first week, not on the day the
  // athlete pressed apply. Those are usually different — a plan applied on a Saturday for a
  // block that starts the following Monday is zero weeks in, not one — and the commit
  // timestamp is only the fallback for records written before the keys were stored.
  const committedOn = typeof c.committedAt === 'string' ? c.committedAt.slice(0, 10) : null;
  const weeksTotal = Number(c.weeks) > 0 ? Number(c.weeks) : null;
  const anchor = c.firstWeekKey || committedOn;
  let weeksElapsed = null, daysSinceCommit = null;
  if (anchor) {
    const a = startOfWeek(anchor), b = startOfWeek(iso);
    let n = 0;
    // Walk forward rather than dividing epoch millis: addDays/startOfWeek are the local-time
    // helpers, and a DST boundary inside the block makes the division answer off-by-one.
    // (Emil's block spans Europe's 25 Oct clock change, so this is not hypothetical.)
    for (let k = a; k < b && n < 400; k = addDays(k, 7)) n++;
    weeksElapsed = n;
  }
  if (committedOn) {
    daysSinceCommit = Math.max(0, Math.round(
      (new Date(`${iso}T12:00:00`) - new Date(`${committedOn}T12:00:00`)) / 86400000));
  }
  const weeksLeft = (weeksTotal != null && weeksElapsed != null)
    ? Math.max(0, weeksTotal - weeksElapsed) : null;
  // Has the block started at all? A plan applied today for a block starting Monday must not
  // be reported as "week 0 of 20, on plan" — it has not begun.
  const startsOn = c.firstWeekKey || null;
  const notStarted = !!(startsOn && startOfWeek(iso) < startOfWeek(startsOn));

  const adh = adherence || (() => { try { return planAdherence({ today: iso }); } catch { return null; } })();
  const ratio = adh && adh.ratio != null ? adh.ratio : null;
  const weeksShort = adh ? (adh.weeksShort || 0) : 0;

  // The status ladder, in the order it is checked. `too-early` exists so a plan applied
  // yesterday is never accused of anything — an adherence read over zero completed weeks is
  // not evidence of drift, it is an absence of evidence, and those must not render the same.
  let status = 'too-early';
  if (!notStarted && adh && adh.countedWeeks > 0 && ratio != null) {
    if (weeksShort >= 3 || ratio < 0.7) status = 'off-plan';
    else if (weeksShort >= 1 || ratio < 0.85) status = 'slipping';
    else status = 'on-plan';
  }

  const wantsPeakMi = Number(c.peakMi) > 0 ? Number(c.peakMi) : null;
  const deliversPeakMi = Number(c.deliversPeakMi) > 0 ? Number(c.deliversPeakMi) : null;

  const HEAD = {
    'too-early': 'just committed — no completed weeks to judge yet',
    'on-plan': 'you are running the plan you committed to',
    'slipping': 'running under the plan you committed to',
    'off-plan': 'the calendar and the running have come apart',
  };

  return {
    commitment: c, appliesHere, notStarted, startsOn,
    tier: c.tier, label: c.tierLabel || c.tier, goalSecs: Number(c.goalSecs) || 0,
    wantsPeakMi, deliversPeakMi,
    shortfallMi: (wantsPeakMi != null && deliversPeakMi != null)
      ? Math.max(0, wantsPeakMi - deliversPeakMi) : null,
    // Why the shortfall exists, carried straight through from the commit record. planTrace
    // does NOT recompute it — LivingPlan measured it once against the real generator and
    // froze it; re-deriving it here is exactly the second opinion this module exists to
    // prevent.
    soloPeakMi: Number(c.soloPeakMi) > 0 ? Number(c.soloPeakMi) : null,
    raceCostMi: Number(c.raceCostMi) > 0 ? Number(c.raceCostMi) : null,
    costlyRaces: Array.isArray(c.costlyRaces) ? c.costlyRaces : null,
    aRaceDate: c.aRaceDate || null, aRaceName: c.aRaceName || null,
    baseAtCommit: Number(c.baseAtCommit) > 0 ? Number(c.baseAtCommit) : null,
    weeksTotal, weeksElapsed, weeksLeft, committedOn, daysSinceCommit,
    actualMi: r1(adh?.actualMi) || 0,
    plannedMi: r1(adh?.plannedMi) || 0,
    ratio, weeksShort, countedWeeks: adh ? (adh.countedWeeks || 0) : 0,
    status, headline: HEAD[status],
  };
}

export default planTrace;
