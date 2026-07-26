// ─── core/tierProgress.js — did you run the tier you were shown? ──────────────
//
// planTiers.js prints three numbers on every run day. planCommitment.js freezes those
// numbers at apply time. This joins the frozen numbers to the runs that actually
// happened and hands the join to planTiers.tierRebaseVerdict, which decides.
//
// Three modules, one job each, and the split is not tidiness — it is the whole reason
// the rebase can be trusted:
//   · planTiers   knows what a rung IS and what the thresholds are   (pure, no storage)
//   · planCommitment knows what was PROMISED, on the day it was promised
//   · this file   knows what HAPPENED, and does nothing but count it
// Nothing here has an opinion. A count is not a verdict.
//
// It is modelled line-for-line on planAdherence.js, including both of its rules about
// which weeks may be counted, because those rules are correct for exactly the same
// reasons here:
//
//   1. The CURRENT week never counts. It is Tuesday; you have not missed Sunday's long
//      run yet. Counting an in-progress week guarantees a shortfall every Monday and
//      trains the athlete to ignore the coach.
//   2. A week with no frozen triad never counts. Before the plan was applied there were
//      no three numbers to hit, so those runs cannot be graded against them — and
//      grading them anyway would be inventing a target retroactively, which is the one
//      thing this whole design exists to prevent.
//
// ── THE SWAP RULE ─────────────────────────────────────────────────────────────────────
// Sessions are matched to logged runs BY DATE first. Anything left over on both sides is
// then paired within the same week, longest run to longest remaining target.
//
// This is deliberate and it is how a coach actually reads a week. The plan says long run
// Sunday; you ran it Saturday because of the weather. Grading strictly by date would call
// that a missed long run AND an enormous easy run — two lies from one honest week, and the
// second one would classify as a challenge session it was never offered. The week is the
// unit the plan periodizes in; which day a session lands on inside it is logistics.
//
// The pairing is greedy-by-size and therefore deterministic — no dates, no randomness, the
// same week always grades the same way. It cannot manufacture a hit: a run is only ever
// matched to a session that was genuinely on the week's card, and the rung it earns still
// comes from classifySessionRung comparing miles to miles.

import { weekKey } from './planner.js';
import { allActivities } from './dcyMath.js';
import { isRun } from './activityClass.js';
import { parseYmd, addDays, localDate } from './time.js';
import {
  triadDayFrom, classifySessionRung, tierRebaseVerdict, REBASE_WEEKS, RUNG_ORDER,
} from './planTiers.js';
import { getCommitment } from './planCommitment.js';

// Week bucketing goes through planner.js#weekKey — the SAME function the calendar keys
// its stored weeks by, and the same one planAdherence uses. A second Monday-finder here,
// however correct, would be a second answer to "which week is this run in", and those two
// answers drift.
const mondayOf = (dateStr) => weekKey(parseYmd(dateStr) || new Date());
const addWeeks = (isoMonday, n) => addDays(isoMonday, n * 7);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * gradeWeek — one week's frozen triad against one week's logged runs.
 *
 * @param {object} o
 *   triad     the packed triad from the commitment
 *   weekKey   'YYYY-MM-DD' Monday
 *   milesByDate Map<'YYYY-MM-DD', number> run miles logged, summed per day
 * @returns {{weekKey, sessions:Array<{dayIndex,type,targetMi,actualMi,rung,short,moved}>}}
 */
export function gradeWeek({ triad, weekKey: wk, milesByDate } = {}) {
  const sessions = [];
  if (!triad || !wk) return { weekKey: wk || null, sessions };

  // The week's card: every frozen tierable day, with the date it was prescribed for.
  const card = [];
  for (let i = 0; i < 7; i++) {
    const d = triadDayFrom(triad, wk, i);
    if (!d || !d.tiers || !(num(d.tiers.baseline && d.tiers.baseline.distanceMi) > 0)) continue;
    card.push({ dayIndex: i, date: addDays(wk, i), type: d.type || null, tiers: d.tiers });
  }
  if (!card.length) return { weekKey: wk, sessions };

  // What was run, per day of THIS week only.
  const ran = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(wk, i);
    const mi = num(milesByDate && milesByDate.get ? milesByDate.get(date) : null);
    if (mi > 0) ran.push({ date, mi });
  }

  // Pass 1 — by date. The ordinary case, and the only one that needs no explaining.
  const usedDates = new Set();
  const matched = new Map();   // dayIndex → {mi, moved}
  for (const c of card) {
    const hit = ran.find((r) => r.date === c.date && !usedDates.has(r.date));
    if (hit) { usedDates.add(hit.date); matched.set(c.dayIndex, { mi: hit.mi, moved: false }); }
  }

  // Pass 2 — the swap rule. Leftovers on both sides, paired longest-to-longest.
  const spare = ran.filter((r) => !usedDates.has(r.date)).sort((a, b) => b.mi - a.mi);
  const open = card
    .filter((c) => !matched.has(c.dayIndex))
    .sort((a, b) => num(b.tiers.baseline.distanceMi) - num(a.tiers.baseline.distanceMi));
  for (let i = 0; i < Math.min(spare.length, open.length); i++) {
    matched.set(open[i].dayIndex, { mi: spare[i].mi, moved: true });
  }

  for (const c of card) {
    const m = matched.get(c.dayIndex) || null;
    const cls = classifySessionRung({ tiers: c.tiers, actualMi: m ? m.mi : null });
    sessions.push({
      dayIndex: c.dayIndex,
      date: c.date,
      type: c.type,
      targetMi: num(c.tiers.baseline.distanceMi),
      // The three frozen numbers, carried through so tierHitRate can apply its
      // discrimination rule: a day where Reach asked for exactly what Baseline asked for
      // is not evidence about reaching, and must leave the fraction rather than pad it.
      tiersMi: RUNG_ORDER.map((k) => num(c.tiers[k] && c.tiers[k].distanceMi)),
      actualMi: m ? Math.round(m.mi * 10) / 10 : null,
      rung: cls.rung,
      // A session with nothing logged against it anywhere in the week is a MISS, not an
      // absence: the plan had an opinion about it and the opinion went unanswered. That is
      // what `short` means to tierHitRate, and it is the difference between "you did not
      // run" and "there was nothing to run" — the second of which is a rest day, and rest
      // days never reach this loop because they were never tierable.
      short: m ? cls.short : true,
      moved: m ? m.moved : false,
    });
  }
  sessions.sort((a, b) => a.dayIndex - b.dayIndex);
  return { weekKey: wk, sessions };
}

/**
 * tierProgressWeeks — the trailing window of graded weeks, oldest → newest.
 *
 * @param {object} [o]
 *   commitment  defaults to the stored one
 *   today       'YYYY-MM-DD' (defaults to the real today)
 *   lookback    how many COMPLETED weeks to grade (default REBASE_WEEKS + 2, so the card
 *               can show a little history either side of the decision window)
 *   activities  injectable for testing; defaults to storage
 * @returns {Array<{weekKey, sessions}>}
 */
export function tierProgressWeeks({
  commitment = undefined, today = null, lookback = REBASE_WEEKS + 2, activities = null,
} = {}) {
  const c = commitment === undefined ? getCommitment() : commitment;
  const triad = c && c.triad && c.triad.weeks ? c.triad : null;
  if (!triad) return [];

  const todayIso = today || localDate();
  const acts = activities || (() => { try { return allActivities(); } catch { return []; } })();

  // Run miles summed per calendar day. Summed, not maxed: a double day is one day's load,
  // and the long run you split around lunch is still the long run.
  const milesByDate = new Map();
  for (const a of acts) {
    if (!a || !a.date || !isRun(a)) continue;
    const d = String(a.date).slice(0, 10);
    milesByDate.set(d, (milesByDate.get(d) || 0) + (num(a.distanceMi) || 0));
  }

  const thisMonday = mondayOf(todayIso);
  const out = [];
  for (let i = lookback; i >= 1; i--) {
    const k = addWeeks(thisMonday, -i);
    if (!triad.weeks[k]) continue;                 // no plan that week → no opinion
    out.push(gradeWeek({ triad, weekKey: k, milesByDate }));
  }
  return out.filter((w) => w.sessions.length);
}

/**
 * tierProgress — the whole read: evidence, then verdict.
 *
 * The absorption signals are INJECTED, not computed here, and that is the point. They are
 * already assembled exactly once, in derive/raceOutlookLive.js, from getPromotionState —
 * so the surface that renders the rebase card passes `promotion.absorption` and
 * `promotion.inputs.acwr` straight through. Recomputing them here from the same activities
 * would be a second answer to "is this athlete coping", and two modules disagreeing about
 * that is precisely the failure this file's whole neighbourhood is built to avoid.
 *
 * @param {object} [o]
 *   absorption   {score,n} from hub/promotionLoop.assessAbsorption (via the live outlook)
 *   acwr         current acute:chronic ratio
 *   injuryActive
 *   commitment / today / activities — as above, injectable
 * @returns {{
 *   ok:boolean, reason?:string,
 *   commitment:object|null, weeks:Array, verdict:object|null,
 *   fromRung:string, toRung:string|null, sessions:number, moved:number
 * }|null}
 */
export function tierProgress({
  absorption = null, acwr = null, injuryActive = false,
  commitment = undefined, today = null, activities = null,
} = {}) {
  const c = commitment === undefined ? getCommitment() : commitment;
  if (!c) return { ok: false, reason: 'no-commitment', commitment: null, weeks: [], verdict: null, fromRung: 'baseline', toRung: null, sessions: 0, moved: 0 };
  if (!c.triad || !c.triad.weeks) {
    // A commitment made before the triad existed. Honest about it rather than silently
    // grading against nothing: the athlete needs to re-apply once to start the loop.
    return { ok: false, reason: 'no-triad', commitment: c, weeks: [], verdict: null, fromRung: 'baseline', toRung: null, sessions: 0, moved: 0 };
  }

  const weeks = tierProgressWeeks({ commitment: c, today, activities });
  const verdict = tierRebaseVerdict({ weeks, absorption, acwr, injuryActive });

  // Where a promotion would LAND. Reach becoming baseline is Emil's rule verbatim; the
  // rung above it is what the ladder then offers as the new reach, which is why the frozen
  // rungs are packed alongside the days — the target of a promotion is a tier that was
  // priced at commit time, not one invented at rebase time.
  const toRung = verdict.verdict === 'promote' ? 'reach'
    : verdict.verdict === 'demote' ? 'baseline' : null;

  let sessions = 0, moved = 0;
  for (const w of weeks) for (const s of w.sessions) { sessions++; if (s.moved) moved++; }

  return {
    ok: true,
    commitment: c,
    weeks,
    verdict,
    fromRung: 'baseline',
    toRung,
    sessions,
    moved,
    // The frozen rung rows, so the card can say what promoting actually BUYS ("Reach
    // becomes baseline: 3:46, peak 42") without re-pricing the ladder live and quoting a
    // number the athlete never agreed to.
    rungs: Array.isArray(c.triad.rungs) ? c.triad.rungs : [],
  };
}

/**
 * rungAfter — the rung one step up (or down) the fixed order. Exported because two
 * surfaces need it and neither should hard-code the sequence.
 */
export function rungAfter(rung, step = 1) {
  const i = RUNG_ORDER.indexOf(rung);
  if (i < 0) return null;
  const j = i + step;
  return j >= 0 && j < RUNG_ORDER.length ? RUNG_ORDER[j] : null;
}

export default tierProgress;
