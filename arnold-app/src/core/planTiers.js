// ─── core/planTiers.js — the per-session tier triad, and the ramp rate that makes it real ───
//
// Emil, 2026-07: "We need 3-4 mileage numbers on each run day, that move with the
// session. For example, you need run a long run today — if you are following baseline
// plan you run 10, if you run the reach plan you run 13 and if you want to challenge
// yourself you run 15. And that can be done on each run, so the runner knows what tier
// they are hitting."
//
// ── WHY THE FIRST OBVIOUS IMPLEMENTATION WOULD HAVE PRINTED 15 / 15 / 15 ──────────────
//
// The tier ladder (core/tierFeasibility.js) prices each finish time as a required PEAK
// weekly volume, and generateSeasonBlock takes that peak as `ceilingMiles`. So the
// obvious triad is "generate three blocks at three ceilings". Measured on Emil's real
// numbers (base 14.8 mi/wk, Berlin + NYC + Valencia, 20 weeks — /tmp/rampsweep.mjs):
//
//     ceiling  36   41   42   44   48   51
//     peak     35   35   35   35   35   35        ← at the 10%/wk ramp
//
// Every ceiling delivers 35. The ceiling never binds, so a ceiling-driven triad prints
// the same number three times and the dropdown looks broken — which is exactly the
// complaint that started this ("even after I regenerate the plan under the stretch
// selection I do not see the peak go to 42 miles").
//
// The thing that actually binds is the RAMP STEP. seasonPlan.js climbs at MAX_RAMP_PCT
// = 10%/wk, and after Berlin's race+recovery weeks, NYC's race+recovery weeks, the
// every-4th-week cut-backs and the A-race taper, only ~12 progressing weeks survive in
// a 20-week block. 14.8 × 1.10^12 lands at 35 and stops. Same sweep, ramp varied:
//
//     ceiling  36   41   42   44   48   51
//     10%/wk   35   35   35   35   35   35
//     12%/wk   36   41   42   44   45   45
//     15%/wk   36   41   42   44   48   51        ← every option reached exactly
//
// ── WHY RAISING THE RAMP IS COACHING, NOT CHEATING ────────────────────────────────────
//
// The 10%/week rule is a population heuristic, not a physiological limit. Arnold already
// carries the actual limit: acute:chronic workload ratio, with ACWR_HOT = 1.3 as the
// overreaching line (seasonPlan.js). A ramp that grows geometrically at rate r settles at
// a steady-state ACWR of exactly
//
//     acute / chronic = 1 / [ (1 + (1+r)⁻¹ + (1+r)⁻² + (1+r)⁻³) / 4 ]
//
// because "acute" is this week and "chronic" is the mean of the last four. Evaluated:
//
//     10%/wk → ACWR 1.147      15%/wk → ACWR 1.218      20%/wk → ACWR 1.288
//     12%/wk → ACWR 1.176      18%/wk → ACWR 1.260      22%/wk → ACWR 1.315  ← past the line
//
// So the 10% rule sits at ACWR 1.15, leaving a large, unused, provably-safe band beneath
// the app's own overreaching threshold. Solving for the SMALLEST ramp that reaches each
// option on Emil's ladder (/tmp/solve.mjs) shows how much room that is:
//
//     needs 36 mi/wk → 10.4%/wk (ACWR 1.15)      needs 48 mi/wk → 13.0%/wk (ACWR 1.19)
//     needs 41 mi/wk → 11.5%/wk (ACWR 1.17)      needs 51 mi/wk → 14.0%/wk (ACWR 1.20)
//     needs 44 mi/wk → 11.9%/wk (ACWR 1.17)
//
// EVERY option on the ladder — including the 3:21 ceiling — is reachable at an ACWR below
// 1.21, comfortably inside the sweet zone. This corrects something this codebase told Emil
// in good faith and got wrong: the note in planGenerator.js concluded that racing Berlin
// and New York "costs sixteen mi/wk of peak", measured by deleting the races while holding
// the ramp at 10%. Deleting races buys back progressing WEEKS; that is one way to get more
// compounding, and it is not the only one, and it is the expensive one. He does not have to
// give up a marathon to reach sub-3:40. He has to climb at 11.9% instead of 10%.
//
// ── WHAT THIS MODULE IS ───────────────────────────────────────────────────────────────
//
// A pure solver. NO imports — same convention as core/activityClass.js and for the same
// reason: it is a contract other modules are judged against, so it must be trivially
// testable and impossible to accidentally couple to storage. The block generator is
// INJECTED (`buildBlock(rampPct, ceilingMi) → weeks`), which also keeps core/ from
// depending on core/hub/.
//
//   steadyAcwr(r)                   the arithmetic above, forwards
//   rampForAcwr(a)                  and backwards
//   solveRampForPeak({…})           smallest ramp that actually reaches a target peak
//   buildTierTriad({…})             three rungs: baseline · reach · challenge
//   mergeTriadWeeks(rungs)          one week list, three numbers per session
//   weekBudgetStatus({…})           does a week of per-session picks hold together?
//
// Consumers: LivingPlan (renders the triad) and the promotion loop (walks the rungs).
// Neither recomputes any of it.

// ── The ACWR band the triad lives inside ─────────────────────────────────────────────
// Mirrors seasonPlan.js's ACWR_HOT (1.3) and ACWR_SWEET_LO/HI in hub/promotionLoop.js
// (0.8–1.3). Duplicated as a literal ONLY here, with this note, because importing it
// would cost this module its zero-import property; the harness asserts the two agree.
import { sumRunMiles, sessionRunMiles } from './runMiles.js';   // ROUND 98 — the ONE week-mileage sum

export const ACWR_OVERREACH = 1.3;

// The three rungs, named as Emil named them, each defined by how close to the
// overreaching line its steady-state ACWR is allowed to sit. These are the ONLY
// tunables in the file; everything else is derived.
//   baseline   — the classic 10% rule. What the plan has always drawn.
//   reach      — still unambiguously inside the sweet zone.
//   challenge  — the top of the sweet zone; never at or above the overreaching line.
export const RUNG_ACWR = { baseline: 1.15, reach: 1.19, challenge: 1.25 };
export const RUNG_ORDER = ['baseline', 'reach', 'challenge'];
export const RUNG_LABEL = { baseline: 'Baseline', reach: 'Reach', challenge: 'Challenge' };

// Absolute refusal point. A ramp whose steady-state ACWR is at or past the overreaching
// line is not offered as a tier at any goal, for any athlete, ever — the plan would be
// prescribing the state the coach elsewhere tells you to back off from.
export const RAMP_HARD_MAX = 0.22;   // ≈ ACWR 1.315 — see the table above
export const RAMP_HARD_MIN = 0.02;

const clamp01 = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/**
 * steadyAcwr — the acute:chronic ratio a geometric ramp settles at.
 *
 * acute = this week's load. chronic = the mean of the trailing four weeks. Under a
 * constant weekly growth rate r those are W and W·(1 + (1+r)⁻¹ + (1+r)⁻² + (1+r)⁻³)/4,
 * so the ratio depends on r alone — not on the base, not on the goal, not on the
 * calendar. That independence is the reason this can be the triad's spine.
 *
 * @param {number} r weekly growth rate (0.10 = 10%/wk)
 * @returns {number} steady-state ACWR
 */
export function steadyAcwr(r) {
  const rate = num(r);
  if (rate == null || rate <= -1) return NaN;
  let s = 0;
  for (let k = 0; k < 4; k++) s += Math.pow(1 + rate, -k);
  return 1 / (s / 4);
}

/**
 * rampForAcwr — the inverse. Monotonic in r, so a bisection is exact to any precision
 * we care about and does not need the closed form (which is a quartic).
 * @returns {number} weekly growth rate, clamped into [RAMP_HARD_MIN, RAMP_HARD_MAX]
 */
export function rampForAcwr(targetAcwr) {
  const a = num(targetAcwr);
  if (a == null || !(a > 1)) return RAMP_HARD_MIN;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (steadyAcwr(mid) < a) lo = mid; else hi = mid;
  }
  return clamp01(Math.round(hi * 1000) / 1000, RAMP_HARD_MIN, RAMP_HARD_MAX);
}

/**
 * How to describe a ramp to a human. Bands are the rungs' own ACWR targets, so the
 * words and the numbers can never drift apart.
 */
export function rampBand(rampPct) {
  const a = steadyAcwr(rampPct);
  if (!Number.isFinite(a)) return { band: 'unknown', acwr: null };
  if (a <= RUNG_ACWR.baseline + 0.005) return { band: 'conservative', acwr: a };
  if (a <= RUNG_ACWR.reach + 0.005) return { band: 'normal', acwr: a };
  if (a <= RUNG_ACWR.challenge + 0.005) return { band: 'firm', acwr: a };
  if (a < ACWR_OVERREACH) return { band: 'hard', acwr: a };
  return { band: 'overreaching', acwr: a };
}

/**
 * solveRampForPeak — the smallest weekly ramp step whose generated block actually
 * reaches a target peak, given this athlete's base and this athlete's race calendar.
 *
 * This is the number that was missing. The ladder priced each finish time as a peak;
 * nothing ever asked what it would COST to get there, so every option got the same
 * 10% ramp and therefore the same 35 mi/wk, and the difference between options
 * silently vanished. Here the goal sets the ramp instead of the ramp capping the goal.
 *
 * Bisection, not a formula: the block is full of discrete events (race weeks, recovery
 * weeks, every-4th-week cut-backs, the re-entry cap) so peak(ramp) has steps in it. It
 * is monotone non-decreasing in ramp, which is all bisection needs. ~14 iterations,
 * measured at ~11 ms per solve on the real 20-week Valencia block.
 *
 * @param {object} o
 *   buildBlock   (rampPct, ceilingMi) => weeks[]   — inject generateSeasonBlock(...).weeks
 *   targetPeakMi the peak the chosen finish time demands (tierFeasibility row .peakMi)
 *   maxRamp      refuse above this (default RAMP_HARD_MAX)
 * @returns {{rampPct, acwr, band, reached, peakMi, longestMi, refused, why}}
 */
export function solveRampForPeak({ buildBlock, targetPeakMi, maxRamp = RAMP_HARD_MAX, iters = 14 } = {}) {
  const target = num(targetPeakMi);
  const fail = (why) => ({ rampPct: null, acwr: null, band: 'unknown', reached: false, peakMi: 0, longestMi: 0, refused: true, why });
  if (typeof buildBlock !== 'function') return fail('No block generator supplied.');
  if (!(target > 0)) return fail('No target peak to solve for.');

  const measure = (r) => {
    const weeks = buildBlock(r, target) || [];
    let peakMi = 0, longestMi = 0;
    for (const w of weeks) {
      const t = num(w && w.targetWeeklyMiles) || 0;
      if (t > peakMi) peakMi = t;
      for (const d of (w && w.days) || []) {
        if (d && d.type === 'long_run') { const mi = num(d.distanceMi) || 0; if (mi > longestMi) longestMi = mi; }
      }
    }
    return { peakMi, longestMi, weeks };
  };

  const hiCap = clamp01(num(maxRamp) ?? RAMP_HARD_MAX, RAMP_HARD_MIN, RAMP_HARD_MAX);
  const top = measure(hiCap);
  if (top.peakMi < target) {
    // Not reachable at ANY ramp we are willing to prescribe. This is the honest
    // "no" — and note it is a different sentence from the old one: the limiter is
    // the calendar and the base together, not the finish time being unreasonable.
    const r = rampBand(hiCap);
    return {
      rampPct: hiCap, acwr: r.acwr, band: r.band, reached: false,
      peakMi: top.peakMi, longestMi: top.longestMi, refused: true,
      why: `Even climbing at ${Math.round(hiCap * 100)}%/wk — the steepest ramp that stays under the overreaching line — this block tops out at ${top.peakMi} mi/wk, ${Math.round(target - top.peakMi)} short of the ${target} it needs. The weeks are the limit here, not the willingness.`,
    };
  }

  let lo = RAMP_HARD_MIN, hi = hiCap;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (measure(mid).peakMi >= target) hi = mid; else lo = mid;
  }
  // Round UP, then VERIFY. Rounding the bisection result to a presentable 0.1% can move
  // it back below the threshold it just found — which is how "needs 44" was solved to a
  // ramp that delivered 43, reintroducing the exact shortfall this function exists to
  // eliminate, one mile smaller and much harder to notice. Ceil, re-measure, and step
  // until it genuinely clears; the loop is bounded by the cap and normally runs zero times.
  let rampPct = Math.min(hiCap, Math.ceil(hi * 1000) / 1000);
  let got = measure(rampPct);
  while (got.peakMi < target && rampPct < hiCap) {
    rampPct = Math.min(hiCap, Math.round((rampPct + 0.001) * 1000) / 1000);
    got = measure(rampPct);
  }
  const r = rampBand(rampPct);
  return {
    rampPct, acwr: r.acwr, band: r.band, reached: got.peakMi >= target,
    peakMi: got.peakMi, longestMi: got.longestMi, refused: false,
    why: `Reaching ${target} mi/wk from here needs a ${(rampPct * 100).toFixed(1)}%/wk climb — steady-state load ratio ${r.acwr.toFixed(2)}, ${r.band === 'conservative' ? 'below' : 'inside'} the 0.8–${ACWR_OVERREACH} band.`,
  };
}

/**
 * buildTierTriad — three coherent plans, not three numbers glued together.
 *
 * The rungs are the committed option and the next two FASTER options on the ladder
 * (falling back down the ladder when the commitment is already near the top, so there
 * are always three unless the ladder itself is shorter). Each rung is generated by the
 * SAME generator, from the SAME base, over the SAME race calendar; the only difference
 * between them is the solved ramp step and the ceiling it climbs to. That is what makes
 * "reach the long run" a real week rather than a bigger number on one day.
 *
 * @param {object} o
 *   rows         tierFeasibility rows, slowest → fastest by finish time
 *   committedKey the tier key the athlete has committed to (rows[i].key)
 *   buildBlock   (rampPct, ceilingMi) => weeks[]
 * @returns {{rungs:Array, committedKey, ladderTopped:boolean}}
 */
export function buildTierTriad({ rows = [], committedKey = null, buildBlock } = {}) {
  const list = (rows || []).filter((r) => r && num(r.goalSecs) > 0 && num(r.peakMi) > 0);
  if (!list.length || typeof buildBlock !== 'function') return { rungs: [], committedKey, ladderTopped: false };

  // Rows arrive slowest → fastest, so "faster" is a HIGHER index.
  let at = committedKey ? list.findIndex((r) => r.key === committedKey) : -1;
  if (at < 0) at = 0;
  // Three consecutive rows with the commitment as the slowest of them where possible;
  // slide down only when the ladder runs out above.
  let start = at;
  if (start + 3 > list.length) start = Math.max(0, list.length - 3);
  const picked = list.slice(start, start + 3);
  const ladderTopped = at + 3 > list.length;

  const rungs = picked.map((row, i) => {
    const rungKey = RUNG_ORDER[i] || `rung${i}`;
    const solved = solveRampForPeak({ buildBlock, targetPeakMi: row.peakMi });
    const weeks = solved.rampPct != null ? (buildBlock(solved.rampPct, row.peakMi) || []) : [];
    return {
      rung: rungKey,
      rungLabel: RUNG_LABEL[rungKey] || rungKey,
      tierKey: row.key,
      tierLabel: row.label,
      goalSecs: row.goalSecs,
      needsPeakMi: row.peakMi,
      needsLongRunMi: row.longRunMi,
      rampPct: solved.rampPct,
      acwr: solved.acwr,
      band: solved.band,
      reached: solved.reached,
      refused: solved.refused,
      deliversPeakMi: solved.peakMi,
      deliversLongestMi: solved.longestMi,
      why: solved.why,
      weeks,
    };
  });
  return { rungs, committedKey: picked[0] ? picked[0].key : committedKey, ladderTopped };
}

// Session types whose distance is the thing the triad varies. A strength day or a
// mobility day has no mileage to offer three of, and a RACE is a fixed distance that
// no tier may inflate — showing "26.2 / 30 / 33" for Berlin would be absurd, and the
// fact that it would be absurd is why the list is explicit rather than "anything with
// a distanceMi".
const TIERABLE = new Set(['easy_run', 'long_run', 'tempo', 'intervals']);
// The sessions a week can only carry so many hard versions of, regardless of miles.
const QUALITY = new Set(['long_run', 'tempo', 'intervals']);

/**
 * mergeTriadWeeks — align the three blocks into ONE week list carrying three numbers
 * per run day.
 *
 * Aligned by week key and day index, because all three come from the same generator
 * over the same calendar. Where the rungs prescribe the same session TYPE, the day
 * carries a triad of distances. Where they prescribe DIFFERENT types — the quality
 * cap in generateWeeklyPlan flips at 26 mi/wk, so a rung can turn an easy run into a
 * tempo — the day is marked `typeSplit` and the UI must say the session changed
 * rather than quietly print three distances for what look like the same run. Hiding a
 * change of kind behind a change of number is precisely the class of bug this whole
 * exercise exists to remove.
 *
 * @returns {Array<{weekKey, phase, days:Array, budgetMi:{baseline,reach,challenge}, ...}>}
 */
export function mergeTriadWeeks(rungs = []) {
  const live = (rungs || []).filter((r) => r && Array.isArray(r.weeks) && r.weeks.length);
  if (!live.length) return [];
  const spine = live[0];
  const byKey = live.map((r) => {
    const m = new Map();
    for (const w of r.weeks) m.set(w.weekKey, w);
    return m;
  });

  return spine.weeks.map((w0) => {
    const wks = byKey.map((m) => m.get(w0.weekKey) || null);

    // budgetMi is the SUM OF THAT RUNG'S PRESCRIBED DAYS, not its targetWeeklyMiles.
    // generateWeeklyPlan has per-session floors (a long run is never 4 mi, an easy day
    // is never 1), so at low volume the sessions it writes can add up to a mile or two
    // ABOVE the week's target — it tolerates up to target × 1.05 internally. If the
    // budget were the target, a week where the athlete picked baseline on EVERY session
    // would be reported as over budget: the plan would be accusing you of overreaching
    // for running exactly what it told you to run. The budget has to be the thing the
    // picks are summed against, which is the prescription itself. targetMi is kept
    // beside it because that is the number the generator reasoned with and the one the
    // ramp/ACWR arithmetic refers to; they are close but they are not the same number
    // and collapsing them is how a second, quietly different idea of "the week" starts.
    const budgetMi = {};
    const targetMi = {};
    const rungMeta = {};
    live.forEach((r, i) => {
      const w = wks[i];
      targetMi[r.rung] = num(w && w.targetWeeklyMiles) || 0;
      // ROUND 98: was an inline re-implementation of planGenerator's sumDayMiles. Both
      // ignored `sessions[]` and both counted any day with a distance as running, so a
      // rung's budget and the header above it could disagree on the same week. One sum now.
      budgetMi[r.rung] = sumRunMiles((w && w.days) || []);
      // Why a rung's week looks the way it does. A faster rung climbs faster, so it
      // reaches its every-4th-build-week cut-back at a DIFFERENT build index than the
      // slower rungs — which means in that one calendar week the challenge plan can
      // legitimately prescribe FEWER miles than baseline. That is not a bug to smooth
      // over; it is the plans being genuinely out of phase, and the UI has to be able
      // to say "Challenge is on a cut-back week here" instead of printing 10 / 11 / 10.
      rungMeta[r.rung] = {
        phase: (w && w.phase) || null,
        cutback: !!(w && (w.cutback || w.isCutback)),
        deepDip: !!(w && (w.deepDip || w.isDeepDip)),
        targetMi: targetMi[r.rung],
        totalMi: budgetMi[r.rung],
      };
    });
    // True when the three rungs agree on what KIND of week this is. When false, the
    // triad's numbers are not comparable within this week and must not be read as a
    // ladder — see rungMeta for what each rung is actually doing.
    const phasesAligned = RUNG_ORDER.every((k) => !rungMeta[k]
      || (rungMeta[k].phase === rungMeta[RUNG_ORDER[0]].phase
        && rungMeta[k].cutback === rungMeta[RUNG_ORDER[0]].cutback));
    const budgetMonotone = RUNG_ORDER
      .map((k) => budgetMi[k]).filter((v) => v > 0)
      .every((v, i, a) => i === 0 || v >= a[i - 1] - 0.05);

    const days = (w0.days || []).map((d0, di) => {
      if (!d0) return d0;
      const tiers = {};
      let typeSplit = false;
      live.forEach((r, i) => {
        const d = wks[i] && wks[i].days ? wks[i].days[di] : null;
        if (!d) return;
        if (d.type !== d0.type) typeSplit = true;
        tiers[r.rung] = {
          type: d.type,
          label: d.label,
          distanceMi: num(d.distanceMi) || null,
          paceTarget: d.paceTarget || null,
        };
      });
      const tierable = TIERABLE.has(d0.type) && !typeSplit;
      // Three identical numbers are not a triad — they are noise pretending to be a
      // choice. Say so explicitly so the UI can collapse to a single number instead of
      // printing 15 / 15 / 15 and making the tiers look broken all over again.
      const vals = RUNG_ORDER.map((k) => tiers[k] && tiers[k].distanceMi).filter((v) => v > 0);
      const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0;
      // What each rung actually costs you over baseline, ON THIS DAY. A rung whose
      // delta is 0 or negative is not an upgrade here and the UI must not offer it as
      // one — "reach" that saves you a mile is the plan lying about its own ladder.
      const baseMi = num(tiers.baseline && tiers.baseline.distanceMi) || 0;
      const deltaMi = {};
      RUNG_ORDER.forEach((k) => {
        const v = num(tiers[k] && tiers[k].distanceMi);
        deltaMi[k] = (v != null && baseMi > 0) ? Math.round((v - baseMi) * 10) / 10 : 0;
      });
      const monotone = RUNG_ORDER
        .map((k) => num(tiers[k] && tiers[k].distanceMi)).filter((v) => v != null)
        .every((v, i, a) => i === 0 || v >= a[i - 1] - 0.05);
      return {
        ...d0, tiers, tierable, typeSplit,
        tierSpreadMi: Math.round(spread * 10) / 10,
        tierDeltaMi: deltaMi,
        tierMonotone: monotone,
      };
    });

    return { ...w0, days, budgetMi, targetMi, rungMeta, phasesAligned, budgetMonotone };
  });
}

// A week may exceed its own rung's volume by this much before the budget objects —
// rounding a handful of sessions to whole miles moves a week by a mile or two and a
// coach who flags that is a coach you stop reading.
export const BUDGET_TOLERANCE = 0.04;
// How many quality sessions may be taken above baseline in one week. Two hard sessions
// is the week's structure; taking BOTH up a rung and the long run as well is the
// "week no coach would write" — it is not a mileage problem, so miles cannot catch it.
export const MAX_ELEVATED_QUALITY = 1;

/**
 * weekBudgetStatus — is a week of per-session picks a week, or just a pile of choices?
 *
 * Emil's design makes every session independently choosable, which is right for the
 * athlete and wrong for the week: nothing stops you taking challenge on the long run
 * AND the tempo AND the midweek, which is not the challenge plan, it is three
 * different plans' hardest days stacked. Two independent guards, because there are two
 * independent ways to break a week:
 *
 *   VOLUME — the total has to land inside SOME rung's weekly target. Landing inside
 *            the reach rung's number is fine; that IS the reach week. Landing above
 *            the challenge rung's number is a week no rung prescribes.
 *   QUALITY — how many HARD sessions were taken up a rung, which miles cannot see. A
 *            reach long run plus a reach tempo is the same mileage as one challenge
 *            long run and a very different week.
 *
 * @param {object} o
 *   week   a merged week (from mergeTriadWeeks)
 *   picks  {dayIndex: rungKey} — omitted days are baseline
 * @returns {{totalMi, onRung, over, overMi, elevatedQuality, ok, note, trimCandidates}}
 */
export function weekBudgetStatus({ week, picks = {} } = {}) {
  if (!week || !Array.isArray(week.days)) {
    return { totalMi: 0, onRung: 'baseline', over: false, overMi: 0, elevatedQuality: 0, ok: true, note: '', trimCandidates: [] };
  }
  let totalMi = 0, elevatedQuality = 0;
  const elevatedNames = [];
  const trimCandidates = [];
  week.days.forEach((d, i) => {
    if (!d) return;
    const rung = RUNG_ORDER.includes(picks[i]) ? picks[i] : 'baseline';
    const t = d.tiers && d.tiers[rung];
    const baseT = d.tiers && d.tiers.baseline;
    // ROUND 98: the THIRD copy of this sum, and the one the athlete sees as the big
    // number on the WEEK BUDGET strip. It now filters by run type through the same
    // helper as everything else, so a strength or cross-training day carrying a stray
    // distance can no longer inflate the strip past the header. The tier variant `t`
    // carries the miles but not always the type, so the TYPE is read off the day.
    const mi = sessionRunMiles({ type: d.type, distanceMi: num(t && t.distanceMi) || num(d.distanceMi) || 0 });
    totalMi += mi;
    if (rung !== 'baseline' && QUALITY.has(d.type)) {
      elevatedQuality++;
      elevatedNames.push(d.label || d.type);
    }
    // Only a pick that actually costs miles is something you can give back. On a week
    // where the rungs are out of phase a "higher" rung can prescribe the same run or a
    // shorter one; offering to trim it would tell the athlete to fix an overage by
    // changing a session that is not causing it.
    if (rung !== 'baseline' && baseT && num(baseT.distanceMi) > 0 && mi > num(baseT.distanceMi)) {
      trimCandidates.push({ index: i, label: d.label || d.type, rung, backToMi: num(baseT.distanceMi), savesMi: Math.round((mi - num(baseT.distanceMi)) * 10) / 10 });
    }
  });
  totalMi = Math.round(totalMi * 10) / 10;

  const budgets = week.budgetMi || {};
  // Which rung's week did this actually turn out to be?
  let onRung = 'baseline';
  for (const k of RUNG_ORDER) {
    const b = num(budgets[k]) || 0;
    if (b > 0 && totalMi <= b * (1 + BUDGET_TOLERANCE)) { onRung = k; break; }
    onRung = k;   // fell through every rung — hold the top one and let `over` catch it
  }
  // The ceiling is the LARGEST week any rung prescribes, not the challenge rung's — on
  // a week where challenge is cutting back and baseline is not, challenge is the small
  // number and measuring against it would flag a perfectly ordinary baseline week.
  const topBudget = RUNG_ORDER.reduce((m, k) => Math.max(m, num(budgets[k]) || 0), 0);
  const over = topBudget > 0 && totalMi > topBudget * (1 + BUDGET_TOLERANCE);
  const overMi = over ? Math.round((totalMi - topBudget) * 10) / 10 : 0;
  const qualityBust = elevatedQuality > MAX_ELEVATED_QUALITY;

  // Biggest saving first — the athlete wants the one change that fixes it, not a list.
  trimCandidates.sort((a, b) => b.savesMi - a.savesMi);

  let note = '';
  if (over && qualityBust) {
    note = `${totalMi} mi is ${overMi} over the ${topBudget} this week can carry, and ${elevatedQuality} hard sessions are up a tier (${elevatedNames.join(', ')}). Take ${trimCandidates[0] ? `${trimCandidates[0].label} back to ${trimCandidates[0].backToMi} mi` : 'one of them back to baseline'} and the week works.`;
  } else if (over) {
    note = `${totalMi} mi is ${overMi} over the ${topBudget} mi this week's hardest tier prescribes. Reaching up on one session means coming down on another — ${trimCandidates[0] ? `dropping ${trimCandidates[0].label} back to ${trimCandidates[0].backToMi} mi covers it` : 'bring one session back to baseline'}.`;
  } else if (qualityBust) {
    note = `The miles fit, but ${elevatedQuality} hard sessions are up a tier (${elevatedNames.join(', ')}). That is not the ${RUNG_LABEL[onRung] || onRung} week — it is two plans' hardest days in one week. Keep one elevated and run the other at baseline.`;
  } else if (onRung !== 'baseline') {
    note = `${totalMi} mi — a ${RUNG_LABEL[onRung] || onRung} week, inside the ${num(budgets[onRung])} mi it prescribes.`;
  }
  // Said last so it never replaces a real objection, and said at all because a week
  // where the tiers disagree about what week it is cannot be read as a ladder.
  if (week.phasesAligned === false) {
    const parts = RUNG_ORDER
      .filter((k) => week.rungMeta && week.rungMeta[k])
      .map((k) => `${RUNG_LABEL[k] || k} ${week.rungMeta[k].cutback ? 'cuts back' : week.rungMeta[k].phase || 'builds'}`);
    note = `${note ? `${note} ` : ''}Heads up: the tiers are out of phase this week (${parts.join(', ')}), so the three numbers are not a ladder here — the faster tier reached its cut-back sooner.`;
  }

  return {
    totalMi, onRung, over, overMi, elevatedQuality,
    ok: !over && !qualityBust,
    phasesAligned: week.phasesAligned !== false,
    note, trimCandidates,
  };
}

/**
 * packTriad — freeze the triad small enough to store beside the commitment.
 *
 * WHY IT MUST BE FROZEN RATHER THAN RECOMPUTED. The rebase rule below asks "did you hit
 * Reach on 70% of sessions over the last four weeks", and the last four weeks are in the
 * PAST. The live triad is built forward from today, so it cannot answer a question about
 * a week that has already happened; recomputing one for a past week would mean rebuilding
 * a block from a base that has since moved, and grading old runs against numbers the
 * athlete was never shown. That is a second, quietly different idea of what "Reach" meant
 * that week — precisely the parallel-systems failure this codebase refuses.
 *
 * So it is written ONCE, at apply time, for the same reason and in the same place as the
 * rest of the commitment: what you agreed to is a fact about that moment.
 *
 * Only tierable days are kept — a rest day and a race have nothing to record — which on a
 * 20-week block is a few dozen small arrays, not a second plan.
 *
 * FLAT DAYS ARE KEPT TOO (2026-07-26). They used to be dropped on the grounds that three
 * identical numbers are not a choice. That is true of DISPLAY and false of RECORD, and
 * conflating the two cost Emil a whole feature: on his near-term weeks every rung honestly
 * prescribes the same 4 mi, so nothing was frozen, so the calendar had nothing to read back,
 * so his tiles were blank and he reported the tier options as simply missing. The freeze is
 * the answer to "what was this day asked of me", and "all three roads asked 4 mi" is a real
 * answer to that question — it is also what classifySessionRung needs in order to grade the
 * day at all. Deciding that 4/4/4 renders as one chip rather than three is the UI's job, and
 * both surfaces now do exactly that.
 *
 * @returns {{v:number, rungs:Array, weeks:Object}} plain JSON, safe to persist
 */
export const TRIAD_PACK_V = 2;   // bumped 2026-07-26 when flat days started being kept (see above)

export function packTriad({ rungs = [], weeks = [] } = {}) {
  const out = { v: TRIAD_PACK_V, rungs: [], weeks: {} };
  out.rungs = (rungs || []).filter(Boolean).map((r) => ({
    rung: r.rung, tierKey: r.tierKey, tierLabel: r.tierLabel, goalSecs: r.goalSecs,
    needsPeakMi: r.needsPeakMi, rampPct: r.rampPct, acwr: r.acwr,
    deliversPeakMi: r.deliversPeakMi, reached: !!r.reached,
  }));
  for (const w of weeks || []) {
    if (!w || !w.weekKey || !Array.isArray(w.days)) continue;
    const dm = {};
    w.days.forEach((d, i) => {
      // tierMonotone is a HARD gate here, not a display hint. The three rungs are three
      // independently generated blocks climbing at three different rates, so they hit their
      // every-4th cut-back weeks at different build indices — and in that one calendar week
      // the faster plan can honestly prescribe FEWER miles than the slower one (7 / 6 / 7 is
      // a real row this generator produces). That day is not a ladder and must never be
      // frozen as one: grading a run against it would say "you hit Reach" for a day where
      // Reach asked for LESS than baseline, which would promote an athlete for going easy.
      // NOTE the absent spread gate — see the flat-day paragraph in the docblock. A zero-spread
      // day is recorded exactly like any other; only its rendering differs.
      if (!d || !d.tierable || !d.tierMonotone || !d.tiers) return;
      const mi = RUNG_ORDER.map((k) => num(d.tiers[k] && d.tiers[k].distanceMi));
      if (mi.some((v) => !(v > 0))) return;
      dm[i] = { t: d.type, mi };
    });
    if (Object.keys(dm).length) out.weeks[w.weekKey] = dm;
  }
  return out;
}

/**
 * triadDayFrom — read one frozen day back in the shape classifySessionRung expects.
 * @returns {{type, tiers}|null}
 */
export function triadDayFrom(packed, weekKey, dayIndex) {
  const wk = packed && packed.weeks ? packed.weeks[weekKey] : null;
  const d = wk ? wk[dayIndex] != null ? wk[dayIndex] : wk[String(dayIndex)] : null;
  if (!d || !Array.isArray(d.mi)) return null;
  const tiers = {};
  RUNG_ORDER.forEach((k, i) => { if (d.mi[i] > 0) tiers[k] = { distanceMi: d.mi[i] }; });
  return { type: d.t || null, tiers };
}

/**
 * refreshTriadForward — the frozen triad has to move with the calendar, but only ahead of today.
 *
 * Emil, 2026-07-26, on a rebuilt app: *"I still do not see anything on the daily tabs on the
 * calendar."* The pack gate had been fixed, the tiles had been taught to draw a flat day, every
 * harness was green — and his calendar was still blank, because THE FREEZE IS FROZEN. His
 * commitment record was written weeks earlier by the old packer, which dropped every zero-spread
 * day; rebuilding the app does not rewrite storage. A fix that only takes effect if the athlete
 * re-applies his plan is not a fix for a man who said, in as many words, that he does not want to
 * touch the plan again if it is truly a living plan.
 *
 * There is a second and better reason to do this than the migration. LivingPlan already
 * re-baselines the FORWARD days on the calendar every time it recomputes (pasteSeasonBlock in
 * 'refresh' mode) — that is what makes the plan living. If the calendar's Tuesday moves to 6 mi
 * and the frozen triad still says the three roads asked 4 / 4 / 4, the same tile is printing two
 * different ideas of the same day. So the triad must be re-cut on exactly the same beat, from
 * exactly the same block, or it becomes the parallel system this codebase exists to avoid.
 *
 * The line between the two halves is TODAY, not the week boundary, because that is where
 * pasteSeasonBlock draws it:
 *
 *   • A day BEFORE today keeps whatever was frozen for it, always. This is the whole argument in
 *     the packTriad docblock: the rebase rule grades the last four weeks against the numbers the
 *     athlete was actually shown, and re-cutting a past day from a base that has since moved
 *     would grade his old runs against a plan he never saw.
 *   • A day TODAY or LATER is taken from the fresh block, including its ABSENCES — if a day has
 *     stopped being a ladder, the stale row must go rather than linger as a contradiction. But
 *     only within the weeks the fresh block actually covers; beyond its horizon the frozen record
 *     is all there is, and dropping it would silently shorten the plan.
 *
 * Pure and storage-free, like the rest of this file — the caller decides whether to persist.
 *
 * @param {object|null} frozen  the packed triad currently on the commitment (may be null/legacy)
 * @param {object|null} fresh   a packTriad() of the block just generated
 * @param {string} todayStr     'YYYY-MM-DD' local today
 * @returns {{v:number, rungs:Array, weeks:Object}|null}
 */
export function refreshTriadForward(frozen, fresh, todayStr) {
  const fz = (frozen && frozen.weeks) ? frozen : null;
  const fr = (fresh && fresh.weeks) ? fresh : null;
  if (!fz) return fr;
  if (!fr) return fz;
  // Date of day `i` of the Monday-keyed week, computed in UTC so a DST boundary inside the block
  // cannot shift a day onto its neighbour and hand it the wrong three numbers.
  const dateOf = (weekKeyStr, i) => {
    const p = String(weekKeyStr).split('-').map(Number);
    if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return null;
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + i));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  };
  const today = typeof todayStr === 'string' && todayStr.length === 10 ? todayStr : null;
  const out = { v: TRIAD_PACK_V, rungs: (fr.rungs && fr.rungs.length) ? fr.rungs : (fz.rungs || []), weeks: {} };
  const keys = new Set([...Object.keys(fz.weeks || {}), ...Object.keys(fr.weeks || {})]);
  for (const wk of keys) {
    const fzWk = (fz.weeks || {})[wk] || null;
    const frWk = (fr.weeks || {})[wk] || null;
    const dm = {};
    for (let i = 0; i < 7; i++) {
      const ds = dateOf(wk, i);
      const past = !!(today && ds && ds < today);
      // `frWk` present = the fresh block covers this week, so it is authoritative from today on
      // (an absence there is a real statement that the day is no longer a ladder). `frWk` absent
      // = beyond the fresh horizon, so the frozen record stands.
      const src = past ? fzWk : (frWk || fzWk);
      const d = src ? (src[i] != null ? src[i] : src[String(i)]) : null;
      if (d) dm[i] = d;
    }
    if (Object.keys(dm).length) out.weeks[wk] = dm;
  }
  return out;
}

// ─── THE REBASE LOOP ──────────────────────────────────────────────────────────────────
//
// Emil, 2026-07: "As they progress the Peak adapts and rebases, and so do the race times.
// If you consistently (70% of the time for 4 weeks) hit reach plan targets, that becomes
// baseline, and then everything recalibrates upward."
//
// Two amendments to that, both of which he approved, and both of which are the difference
// between a loop that coaches and a loop that just counts:
//
//   (1) ABSORPTION GATES PROMOTION. Hitting the numbers is the ASK; absorbing them is the
//       ANSWER. An athlete can hit reach four weeks running with a rising ACWR, falling
//       readiness and degrading pace-at-HR — that is not a fitness gain waiting to be
//       banked, it is the front half of an overreach, and promoting on the hit rate alone
//       would have the coach accelerate into it. The signals already exist and are already
//       trusted elsewhere in this app (hub/promotionLoop.js). So the rule is: hit reach 70%
//       of the time for four weeks AND absorb it → rebase. Hit it without absorbing it →
//       HOLD, and say plainly which half is missing, because "you did the work and your
//       body has not signed off yet" is a completely different sentence from "not yet".
//
//   (2) DEMOTION IS SYMMETRIC. recalibrationVerdict only ever walks an ask DOWN by advice,
//       and only on volume. A ladder that can only be climbed by evidence but descended by
//       nagging is not a ladder. The same window, the same absorption signals and the same
//       one-tap rebuild fire in both directions here.
//
// What it is NOT: automatic in the sense of silent. Nothing in this module writes a plan.
// The verdict is computed automatically and symmetrically; the calendar still only moves
// when the athlete applies it, which is the rule every other path in this codebase obeys.
//
// Absorption is INJECTED (the {score, n} object from hub/promotionLoop.assessAbsorption)
// rather than imported, for the same zero-import reason as the rest of the file. The
// thresholds below are duplicated as literals WITH this note, and the harness asserts they
// still agree with promotionLoop's — a silent drift between them would mean two modules
// disagreeing about whether the same athlete is coping, which is the exact failure class
// this whole file exists to remove.
export const REBASE_HIT_RATE = 0.70;     // Emil's number, verbatim
export const REBASE_WEEKS = 4;           // Emil's window, verbatim
export const DEMOTE_HIT_RATE = 0.50;     // below half of your own baseline sessions = not this plan
export const ABSORB_GOOD_MIN = 0.4;      // === promotionLoop.ABSORB_GOOD
export const ABSORB_BAD_MAX = -0.3;      // === promotionLoop.ABSORB_BAD
export const ACWR_DANGER_LINE = 1.5;     // === promotionLoop.ACWR_DANGER

/**
 * classifySessionRung — which tier did the run you ACTUALLY LOGGED hit?
 *
 * This is the load-bearing piece of Emil's "so the runner knows what tier they are
 * hitting", and the reason the picks in the UI are not persisted: what tier you hit is
 * decided by the run, not by the number you tapped. Arnold derives; it does not ask.
 *
 * The highest rung whose prescribed distance you met, within a tolerance. The tolerance
 * is deliberately generous and absolute-floored: a 10-mile long run logged at 9.8 by a
 * watch that lost a corner of GPS is a 10-mile long run, and a coach who calls it a miss
 * is a coach you stop believing. It is NOT generous enough to promote 11 into 13.
 *
 * @param {object} o
 *   tiers    a merged day's .tiers ({baseline:{distanceMi},…})
 *   actualMi what was logged that day
 * @returns {{rung:string|null, short:boolean, targetMi:number|null, actualMi:number|null}}
 *          rung null + short true  = ran, but under baseline
 *          rung null + short false = nothing to judge (no log, or no tiers)
 */
export function classifySessionRung({ tiers, actualMi } = {}) {
  const a = num(actualMi);
  const none = { rung: null, short: false, targetMi: null, actualMi: a };
  if (!tiers || a == null || !(a > 0)) return none;
  const base = num(tiers.baseline && tiers.baseline.distanceMi);
  if (!(base > 0)) return none;
  const tol = (t) => Math.max(0.3, t * 0.04);
  let hit = null, hitMi = null;
  for (const k of RUNG_ORDER) {
    const t = num(tiers[k] && tiers[k].distanceMi);
    if (!(t > 0)) continue;
    if (a >= t - tol(t)) { hit = k; hitMi = t; }
  }
  if (!hit) return { rung: null, short: true, targetMi: base, actualMi: a };
  return { rung: hit, short: false, targetMi: hitMi, actualMi: a };
}

/**
 * tierHitRate — how often, over a window of weeks, did the logged runs land at or above
 * a given rung?
 *
 * Counted per SESSION, not per week, because Emil's rule is about sessions ("70% of the
 * time"). Only tierable sessions with something logged are in the denominator: a rest day
 * is not a miss, and a week you were on holiday is not evidence of anything. A week with
 * too little in it to judge is excluded and SAID to be excluded — a hit rate quietly
 * computed over one session is a number with the authority of four weeks and the evidence
 * of one.
 *
 * @param {object} o
 *   weeks    [{weekKey, sessions:[{rung, short, tiersMi?:[b,r,c]}]}] oldest → newest
 *   atLeast  the rung to count as a hit (default 'reach')
 *   window   how many trailing weeks to read (default REBASE_WEEKS)
 *   minSessions a week needs this many judged sessions to count at all
 * @returns {{rate:number|null, hits:number, judged:number, weeksCounted:number,
 *            weeksSkipped:number, flat:number, perWeek:Array}}
 *
 * ── THE DISCRIMINATION RULE ─────────────────────────────────────────────────────────
 * A session only counts toward a floor ABOVE baseline if that rung actually asked for
 * more miles than baseline did on that day. Early in a block, and on every recovery week,
 * the three plans converge — an easy day reads 3 / 3 / 4, where Reach prescribes exactly
 * what Baseline does. Running that 3 is not evidence you reached; there was nothing to
 * reach for. Counting it as a hit would let an athlete who ran the baseline plan
 * faithfully accumulate a 100% "Reach" rate off convergent easy days and get promoted for
 * doing precisely what they were told. The session is not a miss either — it is silent,
 * so it leaves both halves of the fraction. The BASELINE floor still counts every session,
 * because delivery is about doing the plan at all, and every day is evidence of that.
 *
 * Sessions without tiersMi (hand-built, or from an older record) are always counted — the
 * rule can only exclude what it can positively see is flat.
 */
export function tierHitRate({ weeks = [], atLeast = 'reach', window = REBASE_WEEKS, minSessions = 2 } = {}) {
  const floor = Math.max(0, RUNG_ORDER.indexOf(atLeast));
  const win = (weeks || []).slice(-Math.max(1, window));
  let hits = 0, judged = 0, weeksCounted = 0, weeksSkipped = 0, flat = 0;
  const perWeek = [];
  const discriminates = (s) => {
    if (floor === 0) return true;
    if (!Array.isArray(s.tiersMi)) return true;
    return num(s.tiersMi[floor]) > num(s.tiersMi[0]);
  };
  for (const w of win) {
    const all = (w && Array.isArray(w.sessions) ? w.sessions : []).filter((s) => s && (s.rung || s.short));
    const sess = all.filter(discriminates);
    flat += all.length - sess.length;
    if (sess.length < minSessions) { weeksSkipped++; perWeek.push({ weekKey: w && w.weekKey, judged: sess.length, flat: all.length - sess.length, hits: 0, counted: false }); continue; }
    const h = sess.filter((s) => s.rung && RUNG_ORDER.indexOf(s.rung) >= floor).length;
    hits += h; judged += sess.length; weeksCounted++;
    perWeek.push({ weekKey: w && w.weekKey, judged: sess.length, flat: all.length - sess.length, hits: h, counted: true, rate: Math.round((h / sess.length) * 100) / 100 });
  }
  return { rate: judged ? Math.round((hits / judged) * 100) / 100 : null, hits, judged, weeksCounted, weeksSkipped, flat, perWeek };
}

/**
 * tierRebaseVerdict — climb, hold, or come down. Symmetric, evidence-gated, and never
 * silent about which of the two tests decided it.
 *
 * @param {object} o
 *   weeks       [{weekKey, sessions:[{rung, short}]}] oldest → newest
 *   absorption  {score:-1..+1, n} from hub/promotionLoop.assessAbsorption — INJECTED
 *   acwr        current acute:chronic ratio
 *   injuryActive
 *   atRung      which rung the athlete is currently committed to (for naming)
 * @returns {{verdict:'promote'|'hold'|'demote', gate:string, reason:string,
 *            reachRate, baseRate, weeksCounted, absorbed:boolean|null, ready:boolean}}
 */
export function tierRebaseVerdict({ weeks = [], absorption = null, acwr = null, injuryActive = false } = {}) {
  const reach = tierHitRate({ weeks, atLeast: 'reach' });
  const base = tierHitRate({ weeks, atLeast: 'baseline' });
  const score = absorption && num(absorption.score) != null ? num(absorption.score) : null;
  const a = num(acwr);
  const out = (verdict, gate, reason, extra = {}) => ({
    verdict, gate, reason,
    reachRate: reach.rate, baseRate: base.rate,
    weeksCounted: reach.weeksCounted, weeksNeeded: REBASE_WEEKS,
    judged: reach.judged, perWeek: reach.perWeek,
    // How many sessions were SILENT rather than judged — days where Reach prescribed
    // exactly what Baseline did. Surfaced because a card that says "8 of 11 sessions at
    // Reach" while quietly dropping five convergent easy days is reporting a fraction the
    // athlete cannot reconstruct, and an unreconstructable fraction is not evidence.
    flat: reach.flat,
    absorbed: score == null ? null : score >= ABSORB_GOOD_MIN,
    absorptionScore: score, acwr: a,
    ready: reach.weeksCounted >= REBASE_WEEKS,
    ...extra,
  });

  // ── The pull always wins, exactly as it does in hub/promotionLoop. Stated first so no
  //    amount of hitting the numbers can talk over it. ──
  if (injuryActive) return out('demote', 'safety', 'There is an active niggle. Nothing gets promoted while something hurts — protect it, then explore.');
  if (a != null && a > ACWR_DANGER_LINE) {
    return out('demote', 'safety', `Your acute:chronic load ratio is ${a.toFixed(2)}, past the ${ACWR_DANGER_LINE} danger line. This is the week to come down, whatever the plan says.`);
  }

  // ── Not enough evidence yet. Said as a countdown, not as a refusal — the athlete
  //    should be able to see the rebase coming. ──
  if (reach.weeksCounted < REBASE_WEEKS) {
    const left = REBASE_WEEKS - reach.weeksCounted;
    return out('hold', 'evidence', `${reach.weeksCounted} of ${REBASE_WEEKS} weeks logged with enough in them to judge${reach.weeksSkipped ? ` (${reach.weeksSkipped} too light to count)` : ''}. ${left} more and this decides itself.`);
  }

  // ── DEMOTE — you are not running the plan you are on. Note the test is against
  //    BASELINE, not against reach: falling short of a stretch is normal and is not
  //    evidence of anything. Falling short of your own baseline half the time is. ──
  if (base.rate != null && base.rate < DEMOTE_HIT_RATE) {
    return out('demote', 'delivery', `Over the last ${reach.weeksCounted} weeks you hit the baseline session ${Math.round(base.rate * 100)}% of the time. That is not this plan being missed at the edges — it is a different plan. Rebasing down is not giving up the goal; it is stopping the plan from lying about where you are.`);
  }
  if (score != null && score <= ABSORB_BAD_MAX) {
    return out('demote', 'absorption', `The mileage is arriving but the signals underneath it are not — load ratio, readiness and pace-at-heart-rate together score ${score.toFixed(2)}. Easing now costs you a week; not easing costs you the block.`);
  }

  // ── PROMOTE — Emil's rule, with the absorption gate on it. ──
  if (reach.rate != null && reach.rate >= REBASE_HIT_RATE) {
    if (score == null) {
      return out('hold', 'absorption-unknown', `You hit Reach on ${Math.round(reach.rate * 100)}% of sessions across ${reach.weeksCounted} weeks — that is the ask, cleared. What is missing is the other half of the test: there is not enough readiness or efficiency data yet to tell whether you ABSORBED it. Keep logging and this promotes itself.`);
    }
    if (score < ABSORB_GOOD_MIN) {
      return out('hold', 'absorption', `You hit Reach on ${Math.round(reach.rate * 100)}% of sessions across ${reach.weeksCounted} weeks — the work is done. Your body has not signed off yet: load ratio, readiness and pace-at-heart-rate together score ${score.toFixed(2)}, under the ${ABSORB_GOOD_MIN} that says you are banking it rather than borrowing it. This is a hold, not a no — hitting the numbers is the ask, absorbing them is the answer.`);
    }
    return out('promote', 'earned', `${Math.round(reach.rate * 100)}% of sessions at Reach or above across ${reach.weeksCounted} weeks, and you absorbed it (${score.toFixed(2)}${a != null ? `, load ratio ${a.toFixed(2)}` : ''}). Reach becomes your baseline and everything above it moves up with it — this is the rebase you earned, not a target being raised on you.`);
  }

  // ── HOLD — the ordinary state, and it should read like one. ──
  return out('hold', 'steady', `${Math.round((reach.rate || 0) * 100)}% of sessions at Reach over ${reach.weeksCounted} weeks — ${REBASE_HIT_RATE * 100}% is the line. On plan, nothing to change.`);
}

export default buildTierTriad;
