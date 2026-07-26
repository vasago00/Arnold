// ─── core/tierFeasibility.js — the ONE answer to "can I actually get there?" ───
//
// The race outlook already produces a LADDER of finish times for the A-race
// (current · target · stretch · goal · ceiling — core/derive/raceOutlookLive.js),
// and volumeModel already produces what each of those times DEMANDS in training
// (peak mi/wk, longest run, threshold weeks). What was missing is the join: given
// the athlete's real base and the calendar in front of them, WHICH options are
// actually reachable, and what stops the others.
//
// This module is that join and nothing else. It derives no new times and no new
// volume requirements — it reads the ladder from getRaceOutlook() and the demands
// from goalRequirements(), so there is exactly one place each number is computed.
// Its only original judgement is the reachability verdict, and that judgement is
// anchored on DEMONSTRATED capacity: the best four-week block the athlete has
// actually logged, not on what a chart can be made to draw.
//
// Why demonstrated capacity is the gate. A ramp generator will happily climb to
// any ceiling you hand it — feed it 51 and it draws 51. That number is real on
// screen and fictional in the legs. The literature-consistent, coach-consistent
// rule is that a single season adds roughly a quarter to a third to a peak you
// have already held; asking for half again more is how builds end in an MRI.
// So the verdict compares REQUIRED peak against BEST HELD peak, and says so out
// loud.
//
//   demonstratedVolume(activities, {today})  → what you have actually held
//   tierFeasibility({ladder, ...})           → one row per option, with the limiter
//
// Consumers: the plan generator's tier selector (LivingPlan) and the coach's
// recalibration card. Both read these rows; neither recomputes them.

import { isRun } from './activityClass.js';
import { goalRequirements } from './volumeModel.js';
import { fmtFinish } from './time.js';   // the ONE finish-time formatter — see its comment

const DAY = 86400000;

// The options, slowest → fastest. Mirrors the ladder object shape from
// raceOutlookLive.js. 'ceiling' is the physiological headroom read (VO2max-derived),
// which is why it sits above 'goal' even when the athlete's own goal is ambitious.
export const TIER_ORDER = ['current', 'target', 'stretch', 'goal', 'ceiling'];

export const TIER_LABEL = {
  current: 'Current', target: 'Target', stretch: 'Stretch', goal: 'Goal', ceiling: 'Ceiling',
  // The athlete's OWN typed finish time (Emil, 2026-07: "A 19 week plan is pretty standard for
  // marathon training, so I can try to get to sub 3:40 in Valencia" — 3:40 sat between Stretch
  // 3:46 and Goal 3:30 and therefore did not exist as a choice). It is priced by exactly the same
  // goalRequirements() call as every published option and judged by exactly the same evidence, so
  // it is an extra CHOICE, not an extra model.
  custom: 'Your time',
};

// Ratio of REQUIRED peak weekly volume to the best 4-week block actually held.
// Bands are deliberately conservative and deliberately few:
//   ≤ 1.15  you have essentially been here — it is a consolidation, not a build
//   ≤ 1.35  a real build, the normal ask of a well-run season
//   ≤ 1.50  aggressive: possible, but it is the injury band and it needs everything
//           else (sleep, fuelling, no missed weeks) to go right
//   > 1.50  not credible inside one block — offered, but never as a plan
export const RATIO_BANDS = { comfortable: 1.15, reachable: 1.35, aggressive: 1.50 };

// The plan generator caps any single long run at this share of the week's volume
// (planGenerator.js — a 20-miler inside a 39-mi week is >50% of the load and the
// plan-acceptance harness flagged it across the population). Mirrored here so the
// feasibility read agrees with what the generator will actually be able to build.
const LONG_RUN_SHARE = 0.42;

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

function mondayKeyOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * demonstratedVolume — the most weekly volume the athlete has PROVED they can hold.
 *
 * Not a peak single week (anyone can have one big week) and not the trailing
 * average (that is the current base, a different question). The best contiguous
 * four-week mean is the standard read of held capacity, because four weeks is
 * the window over which chronic load actually accrues.
 *
 * Weeks with no logged run count as zero inside a block — a gap is a gap, and
 * pretending otherwise would flatter the number, which is precisely the failure
 * mode this module exists to prevent.
 *
 * @param {Array} activities  logged activities (runs are filtered out internally)
 * @param {object} [o] today ('YYYY-MM-DD'), lookbackDays (default 365)
 * @returns {{bestBlockMi:number, bestWeekMi:number, atWeek:string|null, weeksLogged:number}}
 */
export function demonstratedVolume(activities, { today = null, lookbackDays = 365 } = {}) {
  const runs = (activities || []).filter((a) => a && a.date && isRun(a));
  const empty = { bestBlockMi: 0, bestWeekMi: 0, atWeek: null, weeksLogged: 0 };
  if (!runs.length) return empty;

  const cutoff = today ? new Date(`${today}T12:00:00`).getTime() - lookbackDays * DAY : null;
  const byWeek = new Map();
  for (const a of runs) {
    if (cutoff != null) {
      const t = new Date(`${a.date}T12:00:00`).getTime();
      if (!(t >= cutoff)) continue;
    }
    const k = mondayKeyOf(a.date);
    byWeek.set(k, (byWeek.get(k) || 0) + (Number(a.distanceMi) || 0));
  }
  if (!byWeek.size) return empty;

  const keys = [...byWeek.keys()].sort();
  // Walk calendar weeks (not just weeks that happen to have runs) so a missed
  // week correctly drags the four-week mean down instead of being skipped over.
  const first = new Date(`${keys[0]}T12:00:00`).getTime();
  const last = new Date(`${keys[keys.length - 1]}T12:00:00`).getTime();
  const series = [];
  for (let t = first; t <= last; t += 7 * DAY) {
    const k = new Date(t).toISOString().slice(0, 10);
    series.push([k, byWeek.get(k) || 0]);
  }

  let bestBlockMi = 0, atWeek = null;
  for (let i = 0; i + 4 <= series.length; i++) {
    const mean = (series[i][1] + series[i + 1][1] + series[i + 2][1] + series[i + 3][1]) / 4;
    if (mean > bestBlockMi) { bestBlockMi = mean; atWeek = series[i][0]; }
  }
  // Fewer than four weeks on record: the best single week is all the evidence there is.
  const bestWeekMi = Math.max(...series.map((s) => s[1]));
  if (!bestBlockMi) bestBlockMi = bestWeekMi;

  return {
    bestBlockMi: Math.round(bestBlockMi * 10) / 10,
    bestWeekMi: Math.round(bestWeekMi * 10) / 10,
    atWeek,
    weeksLogged: byWeek.size,
  };
}

/**
 * Build weeks genuinely available for progression between now and the A-race.
 * Every marathon that is NOT the A-race costs the build two weeks — the race week
 * itself (volume trimmed ~40%) and the recovery week after it — during which the
 * generator freezes the ramp. That freeze is correct; it is also the single
 * biggest reason a fast option goes out of reach, so it is reported explicitly
 * rather than left as an unexplained shortfall.
 */
export function buildWeeksAvailable({ races = [], today, aRaceDate, weeksToRace }) {
  const wk = num(weeksToRace) || 0;
  if (!(wk > 0)) return { total: 0, lostToRaces: 0, progression: 0, blockingRaces: [] };
  // Only marathons that fall INSIDE this build cost it anything. A marathon after
  // the A-race is next season's problem; counting it here silently stole two weeks
  // from every option and named the wrong race as the reason.
  const blocking = (races || []).filter((r) => r && r.date && (Number(r.distanceMi) || 0) >= 24
    && r.date > (today || '') && r.date !== aRaceDate
    && (!aRaceDate || r.date < aRaceDate));
  const lost = blocking.length * 2;
  return {
    total: wk,
    lostToRaces: lost,
    // −1 for the A-race week itself, which is a taper, not progression.
    progression: Math.max(0, wk - lost - 1),
    blockingRaces: blocking.map((r) => r.name || 'race'),
  };
}

/**
 * tierFeasibility — one row per ladder option: what it costs and whether it is real.
 *
 * @param {object} o
 *   ladder        {current,target,stretch,goal,ceiling} finish seconds (from getRaceOutlook)
 *   baseMi        current trailing-28d volume, mi/wk (from recentRunStats — never a target)
 *   demonstratedMi best 4-week block ever held (from demonstratedVolume)
 *   weeksToRace   whole weeks from this week's Monday to the A-race week, inclusive
 *   races         the race calendar (for the marathons-in-the-way read)
 *   customSecs    an arbitrary finish time the athlete typed in, priced like any other option
 *   today, aRaceDate, distanceMi
 * @returns {Array<{key,label,goalSecs,peakMi,longRunMi,thresholdWeeks,ratio,verdict,
 *                  selectable,advised,limiter,why,longRunGapMi,weekly}>}
 *   Ordered slowest → fastest by finish time. Rows are NEVER filtered out and — since
 *   2026-07 — never disabled either.
 *
 *   WHY EVERY OPTION IS SELECTABLE (Emil: "The Goal and the Ceiling are not available as
 *   options"). The first cut of this module disabled anything it judged unrealistic, which
 *   quietly turned a coach into a gate. That is the wrong instinct twice over: the athlete
 *   asked for OPTIONS, and a goal you are forbidden to name is a goal you cannot work toward.
 *   So the verdict now warns and prices; it does not block. `advised` carries the coach's own
 *   opinion for defaults and for copy — but the choice belongs to the athlete, every time.
 */
export function tierFeasibility({
  ladder = {}, baseMi = 0, demonstratedMi = 0, weeksToRace = 0,
  races = [], today = null, aRaceDate = null, distanceMi = 26.2, customSecs = null,
} = {}) {
  const base = num(baseMi) || 0;
  // Never let a low demonstrated read make everything look impossible: what you are
  // running RIGHT NOW is also demonstrated capacity, by definition.
  const held = Math.max(num(demonstratedMi) || 0, base);
  const weeks = buildWeeksAvailable({ races, today, aRaceDate, weeksToRace });

  const custom = num(customSecs);
  const keys = [...TIER_ORDER];
  const source = { ...ladder };
  // A typed time within half a minute of a published option IS that option — showing both would
  // put two rows on the ladder that mean the same thing and disagree about their own label.
  if (custom > 0 && !TIER_ORDER.some((k) => num(ladder[k]) > 0 && Math.abs(num(ladder[k]) - custom) <= 30)) {
    keys.push('custom');
    source.custom = custom;
  }

  const rows = [];
  for (const key of keys) {
    const goalSecs = num(source[key]);
    if (!(goalSecs > 0)) continue;
    const req = goalRequirements(goalSecs, distanceMi);
    if (!req) continue;

    const ratio = held > 0 ? req.peakMi / held : Infinity;
    // What the generator's long-run share cap will actually permit at that peak.
    const affordableLong = Math.round(req.peakMi * LONG_RUN_SHARE);
    const longRunGapMi = Math.max(0, req.longRunMi - affordableLong);

    let verdict, limiter = null, why = '';
    if (!(held > 0)) {
      // Nothing logged to build from. Every option is unknown rather than impossible,
      // and saying "Infinity% above your best block" would be both wrong and unkind.
      verdict = 'unknown'; limiter = 'volume';
      why = `${req.peakMi} mi/wk at peak. There is no logged running yet to measure that against — run a few weeks first and this will sharpen.`;
    } else if (ratio <= RATIO_BANDS.comfortable) {
      verdict = 'comfortable';
      why = `${req.peakMi} mi/wk — at or below the ${Math.round(held)} mi/wk you have already held.`;
    } else if (ratio <= RATIO_BANDS.reachable) {
      verdict = 'reachable';
      why = `${req.peakMi} mi/wk — ${Math.round((ratio - 1) * 100)}% above your best four-week block. A normal season's build.`;
    } else if (ratio <= RATIO_BANDS.aggressive) {
      verdict = 'aggressive'; limiter = 'volume';
      why = `${req.peakMi} mi/wk — ${Math.round((ratio - 1) * 100)}% above anything you have held. Possible, but it is the injury band: it needs every week to land.`;
    } else {
      verdict = 'unrealistic'; limiter = 'volume';
      // Selectable anyway (see the header). So the copy has to do the work the disabled
      // attribute used to do: say plainly that one block will not get there, and name the
      // number that would — a figure the athlete can actually watch move.
      why = `${req.peakMi} mi/wk — ${Math.round((ratio - 1) * 100)}% above your best four-week block of ${Math.round(held)} mi/wk. One training block does not close that; you would need to be holding around ${Math.round(req.peakMi / RATIO_BANDS.reachable)} mi/wk before this is a plan rather than a wish. You can still build toward it — the plan will draw the fastest honest curve it can and tell you where it lands.`;
    }

    // Weeks can bind before volume does. Threshold weeks are the quality weeks the
    // goal needs; if the calendar cannot supply them the option is out of reach no
    // matter how willing the athlete is.
    if (weeks.progression > 0 && weeks.progression < req.thresholdWeeks) {
      limiter = weeks.lostToRaces > 0 ? 'races' : 'weeks';
      if (verdict === 'comfortable' || verdict === 'reachable') verdict = 'aggressive';
      why += weeks.lostToRaces > 0
        ? ` Only ${weeks.progression} progression weeks remain — ${weeks.blockingRaces.join(' and ')} cost ${weeks.lostToRaces} of them — against the ${req.thresholdWeeks} quality weeks this needs.`
        : ` Only ${weeks.progression} progression weeks remain against the ${req.thresholdWeeks} this needs.`;
    }

    if (longRunGapMi > 0) {
      if (!limiter) limiter = 'longrun';
      why += ` Longest run tops out near ${affordableLong} mi at this volume, ${longRunGapMi} short of the ${req.longRunMi} mi it wants.`;
    }

    rows.push({
      key, label: TIER_LABEL[key] || key, goalSecs,
      peakMi: req.peakMi, longRunMi: req.longRunMi, thresholdWeeks: req.thresholdWeeks,
      // null, not Infinity: JSON.stringify turns Infinity into null anyway, and a
      // consumer that reads it back would render "Infinity×". No data means no ratio.
      ratio: Number.isFinite(ratio) ? Math.round(ratio * 100) / 100 : null,
      verdict, limiter, why,
      longRunGapMi, affordableLongMi: affordableLong,
      gapMi: Math.max(0, req.peakMi - base),
      // Always true. Kept as a field because several surfaces read it, and because a
      // hard-coded `true` in one place is easier to find than a deleted concept.
      selectable: true,
      // The coach's own opinion, which is a different thing from permission.
      advised: verdict !== 'unrealistic',
      weeks,
    });
  }
  // Slowest → fastest by finish time. The published ladder is USUALLY already in this order,
  // but `goal` is whatever the athlete set (it can be slower than Target) and `custom` is
  // whatever they just typed. Sorting here means the order is a property of the times, not of
  // an assumption — which matters because recalibrationVerdict walks these rows by INDEX to
  // guarantee it never advises a faster goal than the one committed to.
  rows.sort((a, b) => b.goalSecs - a.goalSecs);
  return rows;
}

/**
 * The option the coach would pick unprompted: the fastest one that is not merely
 * aggressive. This is the honest default for the selector — ambitious enough to
 * be worth training for, not so ambitious that the plan is a work of fiction.
 * It is a DEFAULT, not a limit: every option in the list can be chosen.
 */
export function recommendedTier(rows) {
  const ok = (rows || []).filter((r) => r.verdict === 'reachable' || r.verdict === 'comfortable');
  return ok.length ? ok[ok.length - 1] : ((rows || []).find((r) => r.advised) || (rows || [])[0] || null);
}

/**
 * recalibrationVerdict — are you actually tracking the option you committed to?
 *
 * Compares what you have RUN over the trailing window against what the committed
 * plan PRESCRIBED over the same window. Deliberately blunt: one ratio, one
 * threshold, a run of consecutive misses before it says anything. A coach who
 * flinches at every light week is noise; a coach who never flinches is useless.
 *
 * @param {object} o
 *   actualMi   trailing-28d actual (mi/wk) — recentRunStats
 *   plannedMi  trailing-28d prescribed by the committed block (mi/wk)
 *   weeksShort how many consecutive weeks have already come in under threshold
 *   rows       tierFeasibility rows, for naming the option actually being tracked
 *   committedTier the key that was committed
 * @returns {{onTrack:boolean, ratio:number|null, adviseTier:object|null, note:string}}
 */
export const RECALIBRATE_RATIO = 0.85;
export const RECALIBRATE_WEEKS = 3;

export function recalibrationVerdict({ actualMi, plannedMi, weeksShort = 0, rows = [], committedTier = null } = {}) {
  const a = num(actualMi), p = num(plannedMi);
  if (!(a >= 0) || !(p > 0)) return { onTrack: true, ratio: null, adviseTier: null, note: '' };
  const ratio = Math.round((a / p) * 100) / 100;
  if (ratio >= RECALIBRATE_RATIO || weeksShort < RECALIBRATE_WEEKS) {
    return { onTrack: true, ratio, adviseTier: null, note: '' };
  }
  // Which option does the volume you are ACTUALLY running support? The actual is a
  // BASE, not a peak, so it is judged by the same build ratio the rows use — the
  // fastest option whose required peak is a normal season's climb from here.
  // Never advises an option faster than the one committed to: this path exists to
  // walk an ask back, and "you are behind, aim higher" is not a sentence a coach says.
  const list = rows || [];
  const capIdx = committedTier ? list.findIndex((r) => r.key === committedTier) : -1;
  const eligible = capIdx >= 0 ? list.slice(0, capIdx + 1) : list;
  const supported = eligible.filter((r) => r.peakMi <= a * RATIO_BANDS.reachable);
  const adviseTier = supported.length ? supported[supported.length - 1] : eligible[0] || null;
  const same = adviseTier && committedTier && adviseTier.key === committedTier;
  return {
    onTrack: false, ratio, adviseTier: same ? null : adviseTier,
    note: same
      ? `You have been ${Math.round((1 - ratio) * 100)}% under the plan for ${weeksShort} weeks. The goal still fits — the weeks do not. Something in the week needs to give before the volume can.`
      : `You have been ${Math.round((1 - ratio) * 100)}% under the plan for ${weeksShort} weeks running. On what you are actually doing, you are training for ${adviseTier ? `${adviseTier.label} (${fmtFinish(adviseTier.goalSecs)})` : 'a slower finish time'}, not the goal you committed to.`,
  };
}

export default tierFeasibility;
