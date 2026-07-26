// Plan-model invariants — the "genuine tests" the plan acceptance harness evaluates the
// PERIODIZATION engine (generateSeasonBlock) against, across a whole population of
// athletes / goals / race calendars. Same two-tier philosophy as invariants.js:
//
//   HARD invariants (checkPlanCase) — properties that MUST hold for EVERY plan, zero
//     tolerance. A single violation fails the suite and reports the seed to reproduce.
//     These are the physiological CONTRACTS a training plan may never break (never ramp
//     faster than the body adapts, never let acute:chronic reach the injury-danger zone,
//     never prescribe an outsized long run, taper into the goal marathon).
//
//   STATISTICAL properties (PLAN_AGG_MARGINS / checkPlanAggregate) — distribution-level
//     expectations across the population, each an auditable named margin with a rationale
//     (e.g. "≥99% of build weeks sit in the ACWR sweet spot ≤1.5").
//
// The science each margin rests on is cited inline so the acceptance criteria are
// defensible, not magic numbers:
//   • ACWR (acute:chronic workload ratio, Gabbett 2016) — sweet spot ~0.8–1.3, elevated
//     1.3–1.5, high injury risk >1.5. We use a 4-week rolling chronic (classic form).
//   • ~10%/week progression rule — long-standing coaching consensus for injury-safe volume.
//   • Long run ≤ ~40% of weekly volume — Daniels/Pfitzinger guidance; a bigger share
//     concentrates too much load in one session.
//   • Goal→peak volume — volumeModel.recommendedPeakMi (Daniels/Pfitzinger goal-pace scaling).

// ── Named thresholds (auditable) ──
export const RAMP_MAX = 1.12;            // ≤10%/wk + rounding headroom, on build→build weeks
export const LONGRUN_SHARE_MAX = 0.42;   // long run ≤42% of the week (matches volumeModel's 0.42 anchor)
export const LONGRUN_SHARE_TOL = 2;      // mi of rounding slack before it's a violation
export const ACWR_SWEET_MAX = 1.5;       // Gabbett sweet-spot ceiling (statistical target)
export const ACWR_HARD_MAX = 1.8;        // never-exceed hard ceiling — above this is genuine high risk
export const CEILING_TOL = 2;            // mi of slack above the goal/base ceiling
export const TAPER_FACTOR = 0.9;         // a marathon race week must sit below 90% of recent-peak volume
export const MARATHON_MIN_MI = 24;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** weeklyACWR — acute (this week) ÷ chronic (mean of the prior up-to-4 weeks). Gabbett rolling form. */
export function weeklyACWR(series, i) {
  if (i < 1) return null;
  const prev = series.slice(Math.max(0, i - 4), i);
  if (!prev.length) return null;
  const chronic = prev.reduce((s, x) => s + x, 0) / prev.length;
  return chronic > 0 ? series[i] / chronic : null;
}

// A week the plan intends as ordinary progression (not a race, deload, or recovery notch).
const isDipWeek = (w) => !!(w.raceName || w.recoveryAfterRace || w.cutback) || w.phase !== 'build';

/**
 * checkPlanCase — hard invariants for ONE generated plan.
 * @param scenario { weeklyMiles, requiredPeak, races }  the inputs it was built from
 * @param weeks    generateSeasonBlock(...).weeks
 * @returns array of { id, msg } violations (empty = all held)
 */
export function checkPlanCase(scenario, weeks) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });
  const T = weeks.map((w) => w.targetWeeklyMiles || 0);
  const ceiling = Math.max(scenario.requiredPeak || 0, scenario.weeklyMiles || 0);

  for (let i = 0; i < weeks.length; i++) {
    const w = weeks[i];
    // PP1 — every target finite and non-negative.
    if (!isNum(w.targetWeeklyMiles) || w.targetWeeklyMiles < 0) add('PP1-finite', `wk${i} target ${w.targetWeeklyMiles}`);
    if (!isNum(w.longRunTargetMi) || w.longRunTargetMi < 0) add('PP1-finite', `wk${i} long ${w.longRunTargetMi}`);
    // PP2 — never prescribe above what the goal needs OR the athlete already runs.
    if (w.targetWeeklyMiles > ceiling + CEILING_TOL) add('PP2-ceiling', `wk${i} ${w.targetWeeklyMiles} > ceiling ${ceiling}`);
    // PP4 — long run stays a sane share of the week. Skipped when the long run IS the race:
    // Emil's rule — a race of half-marathon-or-longer becomes that week's long run — means
    // longRunTargetMi is now 13.1 or 26.2 on those weeks where it used to be reported as 0.
    // A 26.2 inside a 39-mile week is 67% of it, and that share is not a prescription the
    // plan made — it is the race the athlete entered. The invariant exists to stop the
    // GENERATOR concentrating too much load in one session it chose; it has no jurisdiction
    // over a race on the calendar. The taper check (PP5) is what governs those weeks.
    if (!w.longRunIsRace && w.targetWeeklyMiles > 0 && w.longRunTargetMi > w.targetWeeklyMiles * LONGRUN_SHARE_MAX + LONGRUN_SHARE_TOL)
      add('PP4-longshare', `wk${i} long ${w.longRunTargetMi} of ${w.targetWeeklyMiles} (>${Math.round(LONGRUN_SHARE_MAX * 100)}%)`);
  }

  for (let i = 1; i < weeks.length; i++) {
    const cDip = isDipWeek(weeks[i]);
    const pDip = isDipWeek(weeks[i - 1]);
    // PP3 — build→build progression never exceeds the ramp rule.
    if (!cDip && !pDip && T[i] > T[i - 1] * RAMP_MAX + 0.6)
      add('PP3-ramp', `wk${i - 1}→${i}: ${T[i - 1]}→${T[i]} (>${RAMP_MAX}x)`);
    // PP6 — no ordinary build week enters the genuine injury-danger ACWR zone (hard ceiling).
    if (!cDip) {
      const a = weeklyACWR(T, i);
      if (a != null && a > ACWR_HARD_MAX) add('PP6-acwr', `wk${i} ACWR ${a.toFixed(2)} > hard ${ACWR_HARD_MAX}`);
    }
  }

  // PP5 — the goal-marathon (and any supported marathon) race week tapers below recent peak.
  for (let i = 1; i < weeks.length; i++) {
    const w = weeks[i];
    if (!w.raceName) continue;
    const rc = (scenario.races || []).find((r) => r.name === w.raceName) || {};
    if ((Number(rc.distanceMi) || 0) < MARATHON_MIN_MI) continue; // tune-ups run through — no taper
    const recentPeak = Math.max(...T.slice(Math.max(0, i - 3), i), 0);
    if (recentPeak > 0 && T[i] >= recentPeak * TAPER_FACTOR)
      add('PP5-taper', `marathon wk${i} no taper (${T[i]} vs recent peak ${recentPeak})`);
  }

  return v;
}

// ── Statistical acceptance margins (auditable; each with a rationale) ──
export const PLAN_AGG_MARGINS = {
  // ACWR sweet spot: the large majority of build weeks should sit at/below Gabbett's 1.5.
  // Not 100% — a resume week after a marathon recovery legitimately runs elevated because
  // the athlete's TRUE chronic fitness (pre-taper) is higher than the depressed 4-week
  // rolling average reflects. We require ≥99% ≤1.5, with the hard ceiling (PP6, ≤1.8)
  // catching anything genuinely dangerous.
  acwrSweetSpotMin: 0.99,
  // Build→build ramp smoothness must be universal — the ≤10% rule is a hard contract, so
  // the population rate is expected at 100% (the margin allows a hair for rounding paths).
  rampSmoothMin: 0.999,
  // Peak attainment: among goals that are physiologically REACHABLE in the weeks available,
  // the plan should get ≥90% of the required peak for the large majority. Not 100% —
  // mid-season marathons legitimately cap the peak (racing NYC 5 wk before the A-race costs
  // the A-race ceiling; the plan surfaces that honestly rather than faking the number).
  peakAttainMin: 0.95,
};

export function checkPlanAggregate(stats) {
  const v = [];
  const add = (id, msg) => v.push({ id, msg });
  const frac = (n, d) => (d > 0 ? n / d : 1);

  const acwrRate = frac(stats.acwrSweet, stats.buildTransitions);
  if (stats.buildTransitions >= 500 && acwrRate < PLAN_AGG_MARGINS.acwrSweetSpotMin)
    add('SP1-acwr-sweet', `only ${(acwrRate * 100).toFixed(2)}% of build weeks ACWR ≤${ACWR_SWEET_MAX} (min ${PLAN_AGG_MARGINS.acwrSweetSpotMin * 100}%)`);

  const rampRate = frac(stats.rampSmooth, stats.rampTransitions);
  if (stats.rampTransitions >= 500 && rampRate < PLAN_AGG_MARGINS.rampSmoothMin)
    add('SP2-ramp-smooth', `only ${(rampRate * 100).toFixed(2)}% of build→build ≤${RAMP_MAX}x (min ${PLAN_AGG_MARGINS.rampSmoothMin * 100}%)`);

  const peakRate = frac(stats.peakHit, stats.peakFeasible);
  if (stats.peakFeasible >= 200 && peakRate < PLAN_AGG_MARGINS.peakAttainMin)
    add('SP3-peak-attain', `only ${(peakRate * 100).toFixed(2)}% of feasible goals reach ≥90% of peak (min ${PLAN_AGG_MARGINS.peakAttainMin * 100}%)`);

  return v;
}
