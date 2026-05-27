// ─── Intelligence layer (Phase 4r.intel.17 — Layer 3 + 4) ──────────────────
//
// Holistic, reactive, adaptive model-of-the-user. Replaces a stack of
// independent insight + prompt generators that each emitted their own
// recommendation (and contradicted each other) with a single pipeline:
//
//   sensors → derived state → userState → recommendation plan → cards
//
// Two public functions:
//
//   computeUserState({ activities, sleep, hrv, weight, cronometer, profile })
//       Pure function. Returns the canonical model-of-you:
//         { trust, phase, trajectory, recoveryDebt, burdens, numbers }
//       Reactive via storageVersion in the caller (no internal state).
//
//   synthesizeRecommendations(userState, { rawInsights, rawPrompts })
//       Pure function. Reads userState + the raw evidence streams and
//       returns an ordered list of cards. Every card is a FACET of one
//       coherent plan — contradictions impossible by construction.
//
// Adaptive feedback (Layer 5 — trust scores that update from outcomes)
// is deferred. The trust object below is set deterministically from
// current data; the shape is forward-compatible with Bayesian updates
// when we add the outcome ledger.

import {
  computeRMR,
  computeTDEE,
  dailyActivityCalories,
  empiricalTDEE,
  recommendCalorieTarget,
  safeCutHeadroom,
  weightTrend,
  assessCalibration,
  getCurrentBodyComp,
} from './energyBalance.js';
import { dailyTotals as nutDailyTotals } from './nutrition.js';
import { localDate, ymd } from './time.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';
import { getEffectiveTargets, getOutcomeGoal } from './goalModel.js';
import { classifyChronicRecoveryDebt } from './recoveryDebt.js';
import { todayPlanned, DAY_TYPES } from './planner.js';
// Phase 4r.coach.v1 (2026-05-24) — pattern-detection signals beyond
// today's snapshot. See COACH.md for the full v1/v2/v3 spec.
import { computeCoachSignals } from './coachSignals.js';

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 3 — computeUserState
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the canonical model-of-the-user from current data. Everything
 * downstream (synthesizer, cards) reads only this object — no direct
 * storage access, no scattered recomputation.
 *
 * @param {object} data — { activities, sleep, hrv, weight, cronometer, profile }
 * @returns {object} userState
 */
export function computeUserState(data = {}) {
  const today = localDate();
  const profile = data.profile || { ...(storage.get('profile') || {}), ...getGoals() };

  // ── Pull derived state from existing helpers ─────────────────────────────
  // Every one of these is already a pure function elsewhere in core/. We
  // just bundle them into a single snapshot so synthesizer code doesn't
  // touch storage or recompute.
  let rec = null,    headroom = null,  emp = null;
  let tdee = null,   intake = null,    weighIn = null,   cal = null;
  let comp = null,   rmr = null;
  let derivedTargets = null, outcome = null;
  try { rec      = recommendCalorieTarget(); }     catch {}
  try { headroom = safeCutHeadroom(); }            catch {}
  try { emp      = empiricalTDEE(); }              catch {}
  try { tdee     = computeTDEE(today); }           catch {}
  try { intake   = nutDailyTotals(today); }        catch {}
  try { weighIn  = weightTrend(today); }           catch {}
  try { cal      = assessCalibration({ weeks: 4 }); } catch {}
  try { comp     = getCurrentBodyComp(); }         catch {}
  try { rmr      = computeRMR()?.rmr; }            catch {}
  try { derivedTargets = getEffectiveTargets(); }  catch {}
  try { outcome  = getOutcomeGoal(); }             catch {}

  // ── Trust scores ────────────────────────────────────────────────────────
  // Each one answers: "does the scale validate what this source says?"
  // For now these are deterministic from the calibration window; Layer 5
  // will replace them with Bayesian posteriors that update weekly.
  const trust = {
    // Garmin (or whatever computes activity calories) over-credits burn
    // when empirical TDEE is materially below model TDEE.
    garminBurn:
      headroom?.burnLikelyOverstated ? 'over' :
      (emp?.empiricalTDEE != null && rec?.tdeeModel != null
        && (emp.empiricalTDEE - rec.tdeeModel) > 300) ? 'under' :
      'aligned',
    // Intake log accuracy — "loose" when calibration drift is large AND
    // burn is NOT overstated (so the gap must be intake side). "Tight"
    // when burn IS overstated (scale gap explained without blaming logs)
    // OR when calibration is aligned.
    intakeLog:
      (cal?.status === 'under-loss' && headroom?.burnLikelyOverstated) ? 'tight' :
      (cal?.status === 'under-loss') ? 'loose' :
      'tight',
    // RMR model — flag adapted-down when empirical TDEE - estimated
    // activity is well below computed RMR. Treat as 'aligned' for now;
    // adapted-down detection needs more nuanced signal (4+ weeks of
    // stable intake at a known target before we can isolate RMR vs NEAT
    // adaptation). Placeholder for Layer 5.
    rmrModel: 'aligned',
  };

  // ── Phase ───────────────────────────────────────────────────────────────
  // Where in the cut/maintenance/surplus continuum, factoring deficit
  // headroom above RMR. Athletes care about cut-thin vs cut-at-floor
  // because the lever is different (intake vs activity/date).
  const goals = getGoals();
  const distanceToTarget = (comp?.weightLbs != null && goals.targetWeight)
    ? comp.weightLbs - parseFloat(goals.targetWeight)
    : null;
  let phase;
  if (distanceToTarget != null && distanceToTarget > 0.5) {
    // User is configured to cut. Bin by headroom above RMR.
    if (headroom?.phase === 'at-floor')   phase = 'cut-at-floor';
    else if (headroom?.phase === 'thin')  phase = 'cut-thin';
    else                                   phase = 'cut-plenty';
  } else if (distanceToTarget != null && distanceToTarget < -0.5) {
    phase = 'surplus';
  } else {
    phase = 'maintenance';
  }

  // ── Trajectory ──────────────────────────────────────────────────────────
  // Are we hitting the configured loss rate?
  const actualLossRate = (() => {
    // Use weightTrend over 28 days for stable signal
    // (weightTrend returns lbs for the window centered on dateStr)
    if (!Array.isArray(data.weight) || data.weight.length < 14) return null;
    const sorted = [...data.weight].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const recent = sorted.slice(-28);
    if (recent.length < 14) return null;
    const first = recent[0]?.weightLbs;
    const last  = recent[recent.length - 1]?.weightLbs;
    if (first == null || last == null) return null;
    const days = (new Date(recent[recent.length - 1].date) - new Date(recent[0].date)) / 86400000;
    if (days < 7) return null;
    return ((last - first) / days) * 7; // lbs/week
  })();
  const targetLossRate = rec?.lossRatePerWeek != null ? -Math.abs(rec.lossRatePerWeek) : -0.7;
  let trajectory;
  if (phase === 'maintenance' || phase === 'surplus' || actualLossRate == null) {
    trajectory = 'on-pace';
  } else if (Math.abs(actualLossRate) < Math.abs(targetLossRate) * 0.2) {
    trajectory = 'stalled';
  } else if (actualLossRate > targetLossRate * 0.5) {
    // Losing slower than half the target rate (target is negative; comparison flipped)
    trajectory = 'behind';
  } else if (actualLossRate < targetLossRate * 1.5) {
    trajectory = 'ahead';
  } else {
    trajectory = 'on-pace';
  }

  // ── Recovery debt ───────────────────────────────────────────────────────
  // Phase 4r.dataspine.1 — canonical classifier from recoveryDebt.js.
  // The previous inline version was missing the HRV-depression signal
  // that goalModel.js's version had. As a result, intelligence's burdens
  // could say "recovery fine" while goalModel said "debt" for the same
  // user/day. This consolidation makes them agree — and importantly, the
  // 'recovery-debt' burden now fires when HRV is suppressed even if
  // sleep alone wouldn't have triggered it.
  const recoveryDebt = (() => {
    if (!Array.isArray(data.sleep) || !data.sleep.length) return 0;
    try {
      return classifyChronicRecoveryDebt({ sleep: data.sleep, hrv: data.hrv || [] }).debt;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[intelligence] classifyChronicRecoveryDebt threw:', e?.message || e);
      return 0;
    }
  })();

  // ── Numbers ─────────────────────────────────────────────────────────────
  // Single source of truth for any value a card will display. Cards never
  // recompute these — they read them.
  const todayBurnReported = Math.round(tdee?.activityKcal || 0);
  // Burn correction factor: if empirical TDEE is below model, scale
  // today's reported activity calories by the same ratio so the FUEL
  // card can compare today's intake against a credible deficit, not an
  // inflated training-day target.
  const burnCorrectionFactor = (rec?.tdeeEmpirical != null && rec?.tdeeModel != null && rec.tdeeModel > 0)
    ? Math.max(0.4, Math.min(1.0, rec.tdeeEmpirical / rec.tdeeModel))
    : 1.0;
  const todayBurnCorrected = Math.round(todayBurnReported * burnCorrectionFactor);
  const targetWeight = parseFloat(goals.targetWeight) || comp?.weightLbs || 170;
  const proteinFloor = Math.round(targetWeight * 0.8); // 0.8 g/lb of target weight

  // Weeks at current pace to hit target weight
  const weeksAtCurrentPace = (actualLossRate != null && actualLossRate < -0.02 && distanceToTarget > 0)
    ? Math.ceil(distanceToTarget / -actualLossRate)
    : null;
  // Weeks needed to extend goal date if we lock to current pace
  const weeksExtendIfRecal = (rec?.userTargetDate && actualLossRate != null && actualLossRate < -0.02)
    ? Math.max(0, (weeksAtCurrentPace || 0) - (rec.weeksUntilUserDate || 0))
    : null;
  // Recommended new target: the empirical TDEE minus an honest deficit
  // (0.5 lb/wk = -250 kcal/day), floored at RMR.
  const recommendedTarget = (rec?.tdeeEmpirical && rmr)
    ? Math.max(rmr, Math.round((rec.tdeeEmpirical - 250) / 10) * 10)
    : null;

  // Derived targets from goalModel — these are the "what's the user
  // accountable to today" numbers. They MOVE day to day based on
  // recovery + training. If the user pinned a manual override, that
  // wins via `derivedTargets.dailyCalories.effective`, but we keep the
  // derived shadow so cards can show "OVERRIDE 1750 (derived would be
  // 1830)".
  const calDerivedEffective  = derivedTargets?.dailyCalories?.effective ?? headroom?.goalTarget ?? null;
  const calDerivedShadow     = derivedTargets?.dailyCalories?.derived ?? null;
  const calOverride          = derivedTargets?.dailyCalories?.override || null;
  const calSource            = derivedTargets?.dailyCalories?.source || 'derived';
  const proDerivedEffective  = derivedTargets?.dailyProtein?.effective ?? proteinFloor;
  const proDerivedShadow     = derivedTargets?.dailyProtein?.derived ?? proteinFloor;
  const proOverride          = derivedTargets?.dailyProtein?.override || null;
  const proSource            = derivedTargets?.dailyProtein?.source || 'derived';

  const numbers = {
    rmr:                 rmr || null,
    tdeeEmpirical:       rec?.tdeeEmpirical ?? null,
    tdeeModel:           rec?.tdeeModel ?? null,
    tdeeCurrent:         rec?.tdeeCurrent ?? null,
    // Effective target = derived OR user-override (override wins).
    // goalTarget kept for back-compat with code reading the old name.
    goalTarget:          calDerivedEffective,
    calorieTargetDerived:  calDerivedShadow,
    calorieTargetOverride: calOverride,
    calorieTargetSource:   calSource,
    proteinTarget:         proDerivedEffective,
    proteinTargetDerived:  proDerivedShadow,
    proteinTargetOverride: proOverride,
    proteinTargetSource:   proSource,
    headroomKcal:        (calDerivedEffective != null && rmr != null) ? Math.max(0, calDerivedEffective - rmr) : null,
    recommendedTarget,
    actualLossRate:      actualLossRate != null ? Math.round(actualLossRate * 100) / 100 : null,
    targetLossRate:      Math.round(targetLossRate * 100) / 100,
    weeksAtCurrentPace,
    weeksExtendIfRecal,
    userTargetDate:      rec?.userTargetDate || null,
    projectedDate:       rec?.projectedDate || null,
    driftLbs:            cal?.driftLbs ?? null,
    distanceToTarget:    distanceToTarget != null ? Math.round(distanceToTarget * 10) / 10 : null,
    todayIntake:         Math.round(intake?.calories || 0),
    todayProtein:        Math.round(intake?.protein || 0),
    todayBurnReported,
    todayBurnCorrected,
    burnCorrectionFactor: Math.round(burnCorrectionFactor * 100) / 100,
    proteinFloor:        proDerivedEffective, // alias for back-compat in card builders
    calStatus:           cal?.status || 'no-data',
    empiricalConfidence: emp?.confidence || 'insufficient',
    // Goal-aggression flag from outcome goal (helps cards explain
    // when goal demands an unrealistic pace)
    requiredLossRatePerWeek: outcome?.requiredLossRatePerWeek ?? null,
  };

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4r.intel.20 — Extended burden catalog (Phase C1)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Compute the aggregate signals needed by the expanded burden set.
  // These are inlined here (rather than extracted to recoveryDebt.js)
  // because they're tightly coupled to userState construction and
  // multiple burdens read the same values. If a 3rd consumer ever
  // needs them, extract to a shared module.

  // ── Sleep aggregates (7/14/21-day rolling averages) ─────────────────
  const sleepRowsAll = (data.sleep || [])
    .filter(s => s?.date)
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const sleepHoursInWindow = (days) => {
    const cutoff = new Date(today + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - days);
    const hrs = [];
    for (const s of sleepRowsAll) {
      if (!s.date) continue;
      const sd = new Date(s.date + 'T00:00:00');
      if (sd < cutoff) break; // sorted desc — older than cutoff, done
      const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
      if (Number.isFinite(mins) && mins > 0) hrs.push(mins / 60);
    }
    if (!hrs.length) return null;
    return hrs.reduce((a, b) => a + b, 0) / hrs.length;
  };
  const sleepAvg7d  = sleepHoursInWindow(7);
  const sleepAvg14d = sleepHoursInWindow(14);
  const sleepAvg21d = sleepHoursInWindow(21);
  // Sleep goal: outcome goal first, then profile fallback, then conservative 7.5h
  const sleepGoalHrs = (() => {
    try {
      const goals = storage.get('goals') || {};
      if (goals.schemaVersion === 2) return goals.recovery?.sleepHoursMin?.value || 7.5;
      return parseFloat(goals.targetSleepHours) || parseFloat(profile?.targetSleepHours) || 7.5;
    } catch { return 7.5; }
  })();

  // ── HRV signals (latest vs 14-day baseline + consecutive suppression) ──
  // Merge HRV from sleep rows (preferred) + hrv collection (fallback).
  const hrvByDate = new Map();
  for (const h of (data.hrv || [])) {
    if (h?.date && h.overnightHRV != null) hrvByDate.set(h.date, Number(h.overnightHRV));
  }
  for (const s of sleepRowsAll) {
    if (s.date && s.overnightHRV != null) hrvByDate.set(s.date, Number(s.overnightHRV));
  }
  const hrvEntriesDesc = [...hrvByDate.entries()]
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[0].localeCompare(a[0]));
  const hrvLatest = hrvEntriesDesc[0]?.[1] ?? null;
  const hrvBaseline14d = (() => {
    // Use days 2-15 (exclude today/latest) for the baseline so the
    // depression test compares latest against an independent window.
    const window = hrvEntriesDesc.slice(1, 15).map(e => e[1]).filter(v => v > 0);
    if (window.length < 5) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  })();
  const hrvSuppressedDays = (() => {
    if (!hrvBaseline14d) return 0;
    const threshold = hrvBaseline14d * 0.7;
    let count = 0;
    for (const [_, v] of hrvEntriesDesc) {
      if (v < threshold) count++;
      else break;
    }
    return count;
  })();

  // ── RHR signals (latest vs 14-day baseline + consecutive elevation) ──
  const rhrByDate = new Map();
  for (const s of sleepRowsAll) {
    if (s.date && s.restingHR != null) rhrByDate.set(s.date, Number(s.restingHR));
  }
  const rhrEntriesDesc = [...rhrByDate.entries()]
    .filter(([_, v]) => v > 0)
    .sort((a, b) => b[0].localeCompare(a[0]));
  const rhrLatest = rhrEntriesDesc[0]?.[1] ?? null;
  const rhrBaseline14d = (() => {
    const window = rhrEntriesDesc.slice(1, 15).map(e => e[1]).filter(v => v > 0);
    if (window.length < 5) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  })();
  const rhrElevatedDays = (() => {
    if (!rhrBaseline14d) return 0;
    const threshold = rhrBaseline14d + 5;
    let count = 0;
    for (const [_, v] of rhrEntriesDesc) {
      if (v > threshold) count++;
      else break;
    }
    return count;
  })();

  // ── Protein 7-day average ───────────────────────────────────────────
  const proteinAvg7d = (() => {
    let sum = 0, n = 0;
    const nutLog = storage.get('nutritionLog') || [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - i);
      const ds = ymd(d);
      let p = 0;
      // Prefer full-day Cronometer entry; fall back to per-day totals helper
      const fd = nutLog.find(e => e?.date === ds && e?.meal === 'full-day');
      if (fd?.protein) p = Number(fd.protein);
      else { try { p = Number(nutDailyTotals(ds)?.protein) || 0; } catch {} }
      if (p > 0) { sum += p; n++; }
    }
    return n > 0 ? sum / n : null;
  })();

  // ── Days since last activity ────────────────────────────────────────
  const daysSinceLastActivity = (() => {
    if (!Array.isArray(data.activities) || !data.activities.length) return null;
    const sortedActs = [...data.activities]
      .filter(a => a?.date)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!sortedActs.length) return null;
    const lastMs = new Date(sortedActs[0].date + 'T00:00:00').getTime();
    const todayMs = new Date(today + 'T00:00:00').getTime();
    return Math.max(0, Math.round((todayMs - lastMs) / 86400000));
  })();

  // Stash new aggregates onto numbers so the UI / debug surface can see them
  numbers.sleepAvg7d           = sleepAvg7d != null ? +sleepAvg7d.toFixed(2) : null;
  numbers.sleepAvg14d          = sleepAvg14d != null ? +sleepAvg14d.toFixed(2) : null;
  numbers.sleepAvg21d          = sleepAvg21d != null ? +sleepAvg21d.toFixed(2) : null;
  numbers.sleepGoalHrs         = sleepGoalHrs;
  numbers.hrvLatest            = hrvLatest;
  numbers.hrvBaseline14d       = hrvBaseline14d != null ? +hrvBaseline14d.toFixed(1) : null;
  numbers.hrvSuppressedDays    = hrvSuppressedDays;
  numbers.rhrLatest            = rhrLatest;
  numbers.rhrBaseline14d       = rhrBaseline14d != null ? +rhrBaseline14d.toFixed(1) : null;
  numbers.rhrElevatedDays      = rhrElevatedDays;
  numbers.proteinAvg7d         = proteinAvg7d != null ? Math.round(proteinAvg7d) : null;
  numbers.daysSinceLastActivity = daysSinceLastActivity;

  // ── Today's planned session ──────────────────────────────────────────────
  // Phase 4r.intel.27 — Surface the planned-session label so the TRAIN
  // status card can distinguish "you have a session on the calendar
  // but haven't logged it yet" from "you have no session planned (rest
  // day)" from "you logged a session". Previously the card only knew
  // about logged activities, which mis-reported reality when a session
  // was planned but not yet started.
  numbers.plannedToday = (() => {
    try {
      const plan = todayPlanned(new Date());
      if (!plan || !plan.type) return null;
      const dayType = DAY_TYPES.find(d => d.id === plan.type) || null;
      const label = dayType?.label || plan.type;
      const distance = plan.distanceMi ? ` · ${plan.distanceMi} mi` : '';
      return {
        type:     plan.type,
        label,
        distanceMi: plan.distanceMi || null,
        // Pre-formatted human-readable string for direct use in card titles.
        display:  `${label}${distance}`,
        // 'rest' is the planner's default for unset days — treat it as
        // "no session planned" rather than a positive rest prescription
        // unless the user has actually chosen it.
        isRest:   plan.type === 'rest',
      };
    } catch (e) {
      return null;
    }
  })();

  // ── Burdens ─────────────────────────────────────────────────────────────
  // Diagnostic flags. Mostly orthogonal — multiple can fire. Synthesizer
  // matches against combinations.
  const burdens = [];

  // — Energy / weight burdens (existing) —
  if (trust.garminBurn === 'over')                          burdens.push('burn-inflated');
  if (phase === 'cut-at-floor')                             burdens.push('cut-at-floor');
  if (phase === 'cut-thin')                                 burdens.push('cut-thin');
  if (phase === 'cut-plenty')                               burdens.push('cut-plenty');
  if (trajectory === 'stalled')                             burdens.push('stalled');
  if (trajectory === 'behind')                              burdens.push('behind-on-pace');
  if (trajectory === 'ahead')                               burdens.push('losing-too-fast');
  if (rec?.requiredLossRate != null && rec.requiredLossRate > 1.0) burdens.push('goal-aggressive');
  if (recoveryDebt >= 2)                                    burdens.push('recovery-debt');
  if (numbers.todayProtein > 0 && numbers.todayProtein < proteinFloor * 0.6) burdens.push('protein-low-today');
  if (Array.isArray(data.activities)) {
    const todayActs = data.activities.filter(a => a?.date === today);
    if (todayActs.length > 0)                               burdens.push('trained-today');
  }
  if (cal?.observedDayPct != null && cal.observedDayPct < 0.5) burdens.push('logging-spotty');
  if (calOverride && calDerivedShadow != null && Math.abs(calOverride.value - calDerivedShadow) > 100) {
    burdens.push('calorie-override-divergent');
  }
  if (proOverride && proDerivedShadow != null && Math.abs(proOverride.value - proDerivedShadow) > 15) {
    burdens.push('protein-override-divergent');
  }

  // — Sleep burdens (Phase C1) —
  // sleep-debt fires when 7-day average is below goal by ≥1h, OR
  // 14-day average is below 6.5h regardless of goal (objective floor).
  if (
    (sleepAvg7d  != null && sleepAvg7d  < sleepGoalHrs - 1.0) ||
    (sleepAvg14d != null && sleepAvg14d < 6.5)
  ) {
    burdens.push('sleep-debt');
  }
  // chronic-sleep-debt is the severe variant — 21-day < 6.5h. Triggers
  // synthesizer patterns that pause cuts and prioritize recovery.
  if (sleepAvg21d != null && sleepAvg21d < 6.5) {
    burdens.push('chronic-sleep-debt');
  }

  // — Cardiovascular suppression burdens (Phase C1) —
  // HRV suppressed for 3+ consecutive days below 70% of baseline.
  // RHR elevated for 3+ consecutive days above baseline + 5 bpm.
  // Either is a strong cortisol / illness / overtraining signal.
  if (hrvSuppressedDays >= 3) burdens.push('hrv-suppressed');
  if (rhrElevatedDays   >= 3) burdens.push('rhr-elevated');

  // — Cortisol water-retention pattern (Phase C1) —
  // Combination burden — the synthesizer cares about this combo because
  // it explains the "weight not dropping despite deficit" paradox via
  // sleep / cortisol rather than burn / intake mismatch alone. This is
  // the burden that would have caught the 2026-05-22 sleep-insight miss.
  if (
    burdens.includes('sleep-debt') &&
    (trajectory === 'stalled' || trajectory === 'behind')
  ) {
    burdens.push('cortisol-water-retention');
  }

  // — Protein 7-day burden (chronic, vs the existing per-today version) —
  if (proteinAvg7d != null && proteinAvg7d < proteinFloor * 0.85) {
    burdens.push('protein-low');
  }

  // — Activity gap burden —
  if (daysSinceLastActivity != null && daysSinceLastActivity >= 3) {
    burdens.push('untrained-3d');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Phase 4r.intel.21 — Goal-conflict detector (Phase C2)
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Burdens describe single states ("sleep is bad"). Conflicts describe
  // COMBINATIONS of goals + states that mathematically can't all be
  // served at once. Each conflict has a named id, severity, and a
  // recommendation theme that Phase C3's synthesizer will consume to
  // pick the right plan.
  //
  // The detector reads goal kinds from goals.v2 schema directly (this
  // is the only place in intelligence.js that touches goals v2 — the
  // rest goes through getOutcomeGoal()). If goals.v2 isn't set yet,
  // we fall back to outcome.lbsToLose to detect weight-cut intent.

  let goalsV2 = null;
  try { goalsV2 = storage.get('goals') || null; } catch {}

  // Active goal kinds — used to detect cross-domain conflicts.
  const hasWeightCutGoal = outcome?.lbsToLose != null && outcome.lbsToLose > 0.5;
  const hasStrengthGoal = !!(goalsV2?.performance?.customStrength || []).some(
    s => s && (s.priority || 3) <= 2 && (s.targetDate || null)
  );
  const hasEnduranceGoal = goalsV2?.performance && ['run5K','run10K','halfMarathon','marathon']
    .some(k => {
      const g = goalsV2.performance[k];
      return g && (g.priority || 3) <= 2 && g.targetDate;
    });

  // Soonest future race + countdown (for race-related conflicts)
  const daysToNextRace = (() => {
    const races = outcome?.races || [];
    if (!Array.isArray(races) || !races.length) return null;
    const todayMs = new Date(today + 'T00:00:00').getTime();
    const upcoming = races
      .map(r => {
        if (!r?.date) return null;
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
        if (!iso) return null;
        const days = Math.round((new Date(iso + 'T00:00:00').getTime() - todayMs) / 86400000);
        return days >= 0 ? { ...r, _days: days, _priority: (r.priority || 'A').toUpperCase() } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a._days - b._days);
    return upcoming[0] ? { days: upcoming[0]._days, race: upcoming[0] } : null;
  })();
  const racePeakWindow = daysToNextRace && daysToNextRace.days <= 56;
  const racePrepWindow = daysToNextRace && daysToNextRace.days <= 28;

  const burdenSet = new Set(burdens);
  const burdenHas = (b) => burdenSet.has(b);

  const goalConflicts = [];

  // Phase 4r.intel.22 — Conflict declaration order matters for the
  // multi-hypothesis synthesizer's stable-sort tiebreaker. Most-
  // explanatory conflicts come FIRST so they win when severities tie.
  // cortisol-water-retention subsumes cut-and-sleep-debt (requires the
  // same inputs PLUS the trajectory signal) so it ranks ahead.

  // — cut-and-cortisol-water-retention (the user's actual case) —
  if (burdenHas('cortisol-water-retention')) {
    goalConflicts.push({
      id: 'cut-and-cortisol-water-retention',
      severity: 'concern',
      title: 'Cortisol stall — cut + sleep-debt + stalled scale',
      detail: 'All three present: a cut goal, sleep deficit, stalled weight trajectory. The math says the deficit is real; the scale is hiding it under cortisol-driven water retention.',
      recommendation: 'Hold cut targets. Add 1h sleep nightly for 5 nights. Re-weigh. Drop typically arrives 1-2 lb fast (water release).',
      primaryGoal: 'body.weight',
      secondaryBurden: 'cortisol-water-retention',
      evidence: { actualLossRate: numbers.actualLossRate, sleepAvg7d: numbers.sleepAvg7d },
    });
  }

  // — cut-and-race-peak —
  if (hasWeightCutGoal && racePrepWindow) {
    // Phase 4r.intel.25 — Use the normalized `_priority` (uppercased,
    // defaulted to 'A' if unset). Previously read `.priority` directly
    // which produced the literal string "undefined" in the title when
    // the race had no priority field — visible to the user as
    // "Weight cut + race in 10 days (undefined priority)".
    const racePrio = daysToNextRace.race._priority || 'A';
    goalConflicts.push({
      id: 'cut-and-race-peak',
      severity: 'concern',
      title: `Weight cut + race in ${daysToNextRace.days} days (${racePrio} priority)`,
      detail: 'Race prep needs full glycogen + recovery. Cut deficit blunts both. Cutting through peak week → below-potential race performance.',
      recommendation: 'Pause cut 7-10 days before race. Maintenance calories from race week onwards. Resume cut post-race.',
      primaryGoal: 'body.weight',
      secondaryGoal: 'races[next]',
      evidence: { daysToRace: daysToNextRace.days, racePriority: racePrio },
    });
  }

  // — cut-and-sleep-debt (subsumed by cortisol when both present; still
  //   fires when sleep-debt is on but trajectory isn't stalled yet) —
  if (hasWeightCutGoal && burdenHas('sleep-debt') && !burdenHas('cortisol-water-retention')) {
    goalConflicts.push({
      id: 'cut-and-sleep-debt',
      severity: 'concern',
      title: 'Weight cut blocked by sleep deficit',
      detail: `Chronic <6.5h sleep elevates cortisol → water retention masks real fat loss + reduced fat oxidation. Cutting harder = same scale weight + LBM loss.`,
      recommendation: 'Restore sleep first. Re-measure after 7 nights of 7.5h+. Don\'t touch intake until then.',
      primaryGoal: 'body.weight',
      secondaryBurden: 'sleep-debt',
      evidence: { sleepAvg7d: numbers.sleepAvg7d, sleepGoal: numbers.sleepGoalHrs },
    });
  }

  // — cut-and-strength-gain —
  if (hasWeightCutGoal && hasStrengthGoal) {
    goalConflicts.push({
      id: 'cut-and-strength-gain',
      severity: 'attention',
      title: 'Weight cut + strength gain simultaneously',
      detail: 'Body recomp (gain strength while cutting) is possible but slow. Aggressive cut + meaningful PRs need one as the priority — both at once means neither.',
      recommendation: 'Pick one as P1: cut hard for 6-8 weeks and maintain strength, OR pause cut and push PRs.',
      primaryGoal: 'body.weight',
      secondaryGoal: 'performance.strength',
    });
  }

  // — aggressive-and-recovery-debt —
  if (burdenHas('goal-aggressive') && burdenHas('recovery-debt')) {
    goalConflicts.push({
      id: 'aggressive-and-recovery-debt',
      severity: 'concern',
      title: 'Aggressive goal + recovery debt = overcooked',
      detail: 'Goal requires >1 lb/wk loss; recovery is already in debt. This combination plateaus then reverses within 2-3 weeks.',
      recommendation: 'Extend goal date by 4-6 weeks. Drop cut rate to 0.5 lb/wk. Recovery-first this week.',
      primaryBurden: 'goal-aggressive',
      secondaryBurden: 'recovery-debt',
    });
  }

  // — cut-at-floor-and-burn-inflated —
  if (burdenHas('cut-at-floor') && burdenHas('burn-inflated')) {
    goalConflicts.push({
      id: 'cut-at-floor-and-burn-inflated',
      severity: 'attention',
      title: 'Target at RMR + burn over-credited = false deficit',
      detail: 'Your goal target sits at the RMR floor AND Garmin\'s activity calories appear inflated. The deficit you think you have is partially fictional.',
      recommendation: `Lower goal target to empirical TDEE minus 250 (≈${numbers.recommendedTarget || '—'} kcal). Don't cut intake further — already at floor.`,
      primaryBurden: 'cut-at-floor',
      secondaryBurden: 'burn-inflated',
    });
  }

  // — race-prep-and-untrained —
  if (racePrepWindow && burdenHas('untrained-3d')) {
    goalConflicts.push({
      id: 'race-prep-and-untrained',
      severity: 'attention',
      title: `Race in ${daysToNextRace.days}d + no training for ${numbers.daysSinceLastActivity}d`,
      detail: 'Training gap during peak prep risks deconditioning and missing key sessions.',
      recommendation: 'Resume today with 60 min zone-2. If illness or injury, prioritize recovery and adjust race expectations.',
      primaryGoal: 'races[next]',
      secondaryBurden: 'untrained-3d',
    });
  }

  // — strength-and-protein-low —
  if (hasStrengthGoal && burdenHas('protein-low')) {
    goalConflicts.push({
      id: 'strength-and-protein-low',
      severity: 'attention',
      title: 'Strength goals + chronic low protein',
      detail: `Strength gains require ≥0.8 g/lb LBM protein consistently. 7-day average (${numbers.proteinAvg7d}g) is below 85% of floor (${Math.round((numbers.proteinFloor || 0) * 0.85)}g).`,
      recommendation: 'Raise protein floor to 1.0 g/lb target weight. Anchor each meal with 30-40g protein.',
      primaryGoal: 'performance.strength',
      secondaryBurden: 'protein-low',
    });
  }

  // ── Coach Engine v1 — pattern-detection signals ────────────────────────
  // Phase 4r.coach.v1. Six derivable signals that watch each variable
  // across day/week/month windows. UI consumption deferred; engine-only
  // for now. Surfaced via window.coachSignalsDebug() for inspection.
  // See COACH.md for full v1/v2/v3 spec.
  // Phase 4r.signals.2 — compute the two empirical TDEE windows used by
  // computeTdeeDrift. Recent = last 4 weeks; baseline = the 4-week window
  // immediately before that. Each call returns its own confidence label so
  // computeTdeeDrift can mark the drift 'insufficient' when either side
  // lacks logged days. Wrapped in try/catch — empiricalTDEE reads storage
  // and can throw on first-boot when there's no data yet.
  let tdeeRecent4w = null, tdeeBaseline4w = null;
  try {
    tdeeRecent4w = empiricalTDEE({ weeks: 4, endDate: today });
  } catch (e) { /* leave null */ }
  try {
    const baselineEnd = (() => {
      const d = new Date(today + 'T12:00:00');
      d.setDate(d.getDate() - 28);
      return d.toISOString().slice(0, 10);
    })();
    tdeeBaseline4w = empiricalTDEE({ weeks: 4, endDate: baselineEnd });
  } catch (e) { /* leave null */ }

  const coachSignals = (() => {
    try {
      return computeCoachSignals({
        today,
        sleep: sleepRowsAll,
        hrv: data.hrv,
        activities: data.activities,
        // Phase 4r.signals.4 — glycogen estimator needs per-meal nutritionLog
        // rows (timestamped) to estimate 24h carb supply. Read fresh from
        // storage if the caller didn't pass it in.
        nutritionLog: data.nutritionLog || storage.get('nutritionLog') || [],
        // Phase 4r.signals.8 — wellness rows carry Garmin's trainingReadiness
        // score + factor breakdown. Same read-fresh-if-missing pattern as
        // nutritionLog so any caller (Arnold.jsx, CoachBeta debug helpers)
        // gets the data without having to pass it.
        wellness: data.wellness || storage.get('wellness') || [],
        // Phase 4r.narrative.2.2 — planner gives the coach forward-looking
        // context ("intervals tomorrow"). Read fresh if the caller didn't
        // pass it. Empty plan is fine — computeUpcomingPlan handles it.
        planner:  data.planner  || storage.get('planner')  || null,
        // Phase 4r.narrative.2.3 — goal progress reads weight history +
        // the resolved outcome goal. `outcome` is already computed at
        // line ~82 above; reuse rather than re-call getOutcomeGoal().
        weight:   data.weight   || storage.get('weight')   || [],
        outcomeGoal: outcome || null,
        sleepGoalHrs,
        todayIntakeKcal:   numbers.todayIntake || 0,
        todayExerciseKcal: numbers.todayBurnReported || 0,
        lbmLbs: comp?.leanMassLbs || null,
        tdeeRecent4w,
        tdeeBaseline4w,
        // Phase 4r.signals.7 — deficit↔HRV correlation needs intake +
        // TDEE for each historical day. Provide as callbacks so the
        // signal module stays storage-free. nutDailyTotals reads any
        // configured nutrition source (Cronometer / nutritionLog);
        // computeTDEE estimates each day's burn from activities + RMR.
        intakeByDate: (ds) => {
          try { return Number(nutDailyTotals(ds)?.calories) || 0; } catch { return 0; }
        },
        tdeeByDate: (ds) => {
          try {
            const t = computeTDEE(ds);
            return Number(t?.kcal || t?.tdee || 0) || 0;
          } catch { return 0; }
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[computeUserState] computeCoachSignals threw:', e?.message || e);
      return null;
    }
  })();

  return {
    asOf: today,
    trust,
    phase,
    trajectory,
    recoveryDebt,
    burdens,
    goalConflicts,
    activeGoalKinds: {
      weightCut: hasWeightCutGoal,
      strength:  hasStrengthGoal,
      endurance: hasEnduranceGoal,
      racePeak:  racePeakWindow,
      racePrep:  racePrepWindow,
    },
    numbers,
    coachSignals,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LAYER 4 — synthesizeRecommendations
// ═══════════════════════════════════════════════════════════════════════════

// Card builder. Every card returned by the synthesizer has this shape.
// `evidence` (n / p / period) is optional — only insights carry it.
function card({ pillar, severity, title, detail, recommendation, evidence = null, action = null, key }) {
  return { key, pillar, severity, title, detail, recommendation, evidence, action };
}

// Severity ordering used to slot cards into the 2×2 grid.
const SEVERITY_RANK = { concern: 4, critical: 4, attention: 3, warning: 3, info: 2, positive: 1 };

/**
 * Map userState (+ optional raw insight/prompt evidence) onto an ordered
 * list of cards. Layer 4 owns ALL recommendation text — insights and
 * prompts contribute facts and severity, but never their own copy.
 *
 * @param {object} userState — output of computeUserState
 * @param {object} ctx       — { rawInsights, rawPrompts } (currently used
 *                             only to surface evidence chips for stat-
 *                             gated insights; not for their text)
 * @returns {Array<object>} ordered list of cards (max 4)
 */
export function synthesizeRecommendations(userState, ctx = {}) {
  const u = userState || {};
  const n = u.numbers || {};
  const burdens = new Set(u.burdens || []);

  // Helpful guards
  const has  = (b) => burdens.has(b);
  const hasAny = (...bs) => bs.some(b => burdens.has(b));
  const hasAll = (...bs) => bs.every(b => burdens.has(b));

  // Find an evidence chip from rawInsights if a matching id was used in
  // the diagnosis (so the synthesizer can keep the statistical proof).
  const evidenceFor = (insightId) => {
    const found = (ctx.rawInsights || []).find(i => i?.id === insightId);
    return found?.evidence || null;
  };

  // ─── MULTI-HYPOTHESIS PATH (Phase C3 — Phase 4r.intel.22) ─────────────
  // If any concern-level conflict fires, the synthesizer assembles cards
  // from MULTIPLE hypotheses across pillars instead of picking a single
  // pattern. The earlier single-pattern approach hid alternative causes
  // (the 2026-05-22 weight-loss missed-sleep bug is the canonical
  // failure mode). With multi-hypothesis: every concern conflict
  // surfaces in its own card, status fillers cover the remaining pillars,
  // and the user can see ALL the relevant levers at a glance.
  //
  // Falls through to the existing single-pattern map below when no
  // concern conflict is present — small / clean cases still get the
  // coherent single-pattern narrative.

  const conflicts = u.goalConflicts || [];
  const hasConcernConflict = conflicts.some(c => c.severity === 'concern');
  if (hasConcernConflict) {
    return buildMultiHypothesisPlan(u, n, conflicts, ctx);
  }

  // ─── PATTERN MAP ─────────────────────────────────────────────────────────
  // Each branch returns its own card array. We pick the first matching
  // primary pattern; secondary patterns get appended only if their slots
  // aren't already used.

  // PRIMARY 0 (Phase C1): sleep-blocks-cut
  //   cortisol-water-retention is the combination burden that fires when
  //   sleep-debt is paired with a stalled-or-behind trajectory. It's the
  //   pattern that explains "weight not dropping despite a real deficit"
  //   via the cortisol / water-retention axis rather than the burn /
  //   intake math axis. Takes precedence over recalibrate-math because
  //   if BOTH fire, the sleep angle is usually the higher-leverage
  //   intervention (you can adjust the math, but if cortisol is up the
  //   adjustment won't move the scale).
  //   This is the exact pattern that would have caught the 2026-05-22
  //   missed sleep insight in the weight-loss conversation.
  if (has('cortisol-water-retention') ||
      (has('sleep-debt') && hasAny('stalled', 'behind-on-pace') && !has('burn-inflated'))) {
    return buildSleepBlocksCutPlan(u, n, evidenceFor);
  }

  // PRIMARY 1: recalibrate-math
  //   burn-inflated + cut-at-floor (or cut-thin) + (behind-on-pace OR stalled)
  //   → math is wrong, not intake; lowering target is the only safe lever
  if (hasAll('burn-inflated') && hasAny('cut-at-floor', 'cut-thin')
      && hasAny('behind-on-pace', 'stalled')) {
    return buildRecalibrateMathPlan(u, n, evidenceFor);
  }

  // PRIMARY 2: tighten-deficit
  //   cut-plenty + (behind-on-pace OR stalled) + burn-aligned (or no burn signal)
  //   → safe to cut, math is working; suggest modest intake cut
  if (has('cut-plenty') && hasAny('behind-on-pace', 'stalled')
      && !has('burn-inflated')) {
    return buildTightenDeficitPlan(u, n, evidenceFor);
  }

  // PRIMARY 3: slow-the-cut
  //   losing-too-fast → LBM risk, hormonal, RMR adaptation incoming
  if (has('losing-too-fast')) {
    return buildSlowTheCutPlan(u, n, evidenceFor);
  }

  // PRIMARY 4: recovery-overreach
  //   recovery-debt + trained-today + cut-thin/at-floor
  //   → fuelling + sleep are the priorities; everything else waits
  if (has('recovery-debt') && hasAny('cut-at-floor', 'cut-thin')) {
    return buildRecoveryFirstPlan(u, n, evidenceFor);
  }

  // PRIMARY 5: on-pace-maintain
  //   No burdens that suggest a problem
  if (!burdens.size || (burdens.size === 1 && has('trained-today'))) {
    return buildOnPacePlan(u, n, evidenceFor);
  }

  // FALLBACK: generic plan — still better than nothing, uses the numbers
  // we already computed.
  return buildGenericPlan(u, n, evidenceFor);
}

// ─── Pattern builders ───────────────────────────────────────────────────────
// Each builder returns up to 4 cards. Every card is a facet of the same
// underlying plan — they don't contradict because they share a numbers
// object and a primary diagnosis.

// ─── Multi-hypothesis plan (Phase C3 / Phase 4r.intel.22) ─────────────────
//
// Assembles a 4-card grid from ranked conflicts + status fillers. Each
// conflict claims its "preferred pillar" (Recover for sleep/cortisol,
// Goal for cut + math + race, Fuel for protein, Train for activity-gap).
// First-come-first-served per pillar. Remaining pillar slots fill with
// status cards (today's intake, today's training, etc.) so all 4 cells
// always render and the user sees today's context alongside the
// strategic hypothesis cards.

function buildMultiHypothesisPlan(u, n, conflicts, ctx) {
  const cards = [];
  const sevRank = { concern: 3, attention: 2, info: 1 };

  // Map a conflict id to the card pillar it best belongs in. Conflicts
  // about sleep / cortisol / recovery go to Recover; race + goal-pace +
  // recalibration go to Goal; protein / fuel go to Fuel; training-gap
  // / over-reach go to Train.
  const pillarFor = (id) => {
    if (id.includes('cortisol') || id.includes('sleep') || id.includes('recovery'))
      return 'Recover';
    if (id.includes('protein') || id.includes('fuel'))
      return 'Fuel';
    if (id.includes('untrained') || id.includes('over-reach') || id.includes('under-load'))
      return 'Train';
    // race / cut / goal-aggressive / cut-at-floor / strength-and-* all → Goal
    return 'Goal';
  };

  // Rank conflicts by severity (stable on declaration order — see
  // detector ordering note). Walk and assign each to its pillar; skip
  // when that pillar already holds a card.
  const ranked = [...conflicts].sort((a, b) =>
    (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0)
  );
  const usedPillars = new Set();
  for (const c of ranked) {
    if (cards.length >= 4) break;
    const pillar = pillarFor(c.id);
    if (usedPillars.has(pillar)) continue;
    cards.push(card({
      key: `c:${c.id}`,
      pillar,
      severity: c.severity,
      title: c.title,
      detail: c.detail,
      recommendation: c.recommendation,
      evidence: null,
      action: null,
    }));
    usedPillars.add(pillar);
  }

  // Fill remaining pillar slots with status cards in a fixed priority
  // order. Fuel + Train are always valuable as "today's context";
  // Goal/Recover/Body fallbacks pad if needed.
  const fillerOrder = ['Fuel', 'Train', 'Body', 'Goal', 'Recover'];
  for (const p of fillerOrder) {
    if (cards.length >= 4) break;
    if (usedPillars.has(p)) continue;
    const filler = buildStatusCard(p, u, n);
    if (filler) {
      cards.push(filler);
      usedPillars.add(p);
    }
  }

  return cards.slice(0, 4);
}

// ─── TRAIN status helper (Phase 4r.intel.27) ──────────────────────────────
// One canonical place to compute "what should the TRAIN card say right
// now?" Reads logged-activity burden + the planned session for today
// (n.plannedToday, set in computeUserState). Returns {severity, title,
// recommendation}. Caller can override severity if the surrounding plan
// has a stronger opinion (e.g. recovery-first wants 'attention' even
// when nothing is logged).
//
// The previous implementation hard-coded "No session today" whenever
// nothing was logged, even when the user had a session scheduled —
// users reported this as confusing ("does it mean I haven't done it,
// or that I should skip?"). Now:
//   - trained today          → "Session logged · X kcal credited"
//   - planned + not logged   → "Planned: <type> · <distance>"
//   - no plan, gap ≥ 3 days  → "No training for Nd"
//   - no plan, recent        → "Rest day"
//   - planned 'rest'         → "Rest day (planned)"
function trainStatus(u, n) {
  const trained    = u.burdens?.includes('trained-today');
  const untrained3 = u.burdens?.includes('untrained-3d');
  const planned    = n.plannedToday || null;
  const proteinPct25 = Math.round((n.proteinFloor || 140) * 0.25);

  if (trained) {
    return {
      severity: 'positive',
      title: `Session logged · ${n.todayBurnReported || 0} kcal credited`,
      recommendation: `${proteinPct25}g+ protein within 60 min · 7.5h+ sleep tonight.`,
    };
  }
  if (planned && !planned.isRest) {
    return {
      severity: 'info',
      title: `Planned: ${planned.display}`,
      recommendation: `On the calendar — fuel before, ${proteinPct25}g+ protein within 60 min after.`,
    };
  }
  if (planned && planned.isRest) {
    return {
      severity: 'info',
      title: `Rest day (planned)`,
      recommendation: `Recovery is part of the program. Floor protein, prioritize sleep.`,
    };
  }
  if (untrained3) {
    return {
      severity: 'attention',
      title: `No training for ${n.daysSinceLastActivity}d`,
      recommendation: `Resume with 30-45 min zone-2 today. Long gap risks decondition.`,
    };
  }
  // No plan, no recent gap — neutral rest day.
  return {
    severity: 'info',
    title: `Rest day`,
    recommendation: `Optional 20-30 min zone-2 walk for circulation + sleep benefits.`,
  };
}

// Status filler cards — neutral pillar-appropriate context for the
// "today" view when no hypothesis directly addresses that pillar.

function buildStatusCard(pillar, u, n) {
  if (pillar === 'Fuel') {
    const proteinTarget = n.proteinTarget || n.proteinFloor || 0;
    const proteinShort = Math.max(0, proteinTarget - (n.todayProtein || 0));
    const calRemaining = Math.max(0, (n.goalTarget || 0) - (n.todayIntake || 0));
    return card({
      key: 'fuel-status',
      pillar: 'Fuel',
      severity: 'info',
      title: `Today ${n.todayIntake || 0} of ${n.goalTarget || '—'} kcal`,
      detail: `Empirical TDEE ${n.tdeeEmpirical || '—'} · derived target reflects ${n.calorieTargetSource || 'derivation'}.`,
      recommendation: proteinShort > 5
        ? `Add ${proteinShort}g+ more protein to hit ${proteinTarget}g floor.${calRemaining > 100 ? ` ${calRemaining} kcal remaining.` : ''}`
        : calRemaining > 100
          ? `${calRemaining} kcal remaining · protein floor hit ✓`
          : `On target ✓`,
    });
  }
  if (pillar === 'Train') {
    // Phase 4r.intel.27 — Title + recommendation centralised in
    // trainStatus(); the status card just adds pillar/key/detail.
    const ts = trainStatus(u, n);
    return card({
      key: 'train-status',
      pillar: 'Train',
      severity: ts.severity,
      title: ts.title,
      detail: `Recovery debt ${u.recoveryDebt || 0}/3${n.hrvLatest ? ` · HRV ${n.hrvLatest}ms (base ${n.hrvBaseline14d || '—'})` : ''}.`,
      recommendation: ts.recommendation,
    });
  }
  if (pillar === 'Body') {
    const trajStr = n.actualLossRate != null
      ? `${n.actualLossRate > 0 ? '+' : ''}${n.actualLossRate} lb/wk vs goal ${n.targetLossRate || '—'}`
      : 'no recent trend';
    return card({
      key: 'body-status',
      pillar: 'Body',
      severity: 'info',
      title: `Trajectory: ${trajStr}`,
      detail: n.weeksAtCurrentPace
        ? `${n.weeksAtCurrentPace} weeks to target at current pace.`
        : `Insufficient weight history for projection.`,
      recommendation: `${n.proteinFloor || 140}g protein floor protects LBM through the cut.`,
    });
  }
  if (pillar === 'Goal') {
    return card({
      key: 'goal-status',
      pillar: 'Goal',
      severity: 'info',
      title: `Goal target ${n.goalTarget || '—'} kcal · RMR ${n.rmr || '—'}`,
      detail: `${n.headroomKcal != null ? n.headroomKcal + ' kcal headroom above RMR' : 'No headroom data'} · ${u.phase || '—'}.`,
      recommendation: 'Review in Plan tab.',
      action: { label: 'open Goals' },
    });
  }
  if (pillar === 'Recover') {
    return card({
      key: 'recover-status',
      pillar: 'Recover',
      severity: u.recoveryDebt >= 2 ? 'attention' : 'info',
      title: `Recovery debt ${u.recoveryDebt || 0}/3`,
      detail: `Sleep 7d=${n.sleepAvg7d || '—'}h · 14d=${n.sleepAvg14d || '—'}h · goal ${n.sleepGoalHrs || '—'}h.`,
      recommendation: u.recoveryDebt >= 2
        ? `Sleep is the highest-leverage lever this week.`
        : `Recovery markers in line.`,
    });
  }
  return null;
}

// ─── Pattern builder: sleep-blocks-cut (Phase C1) ──────────────────────────
//
// The "your weight isn't moving and the answer is sleep, not math" plan.
// Fires when sleep-debt + stalled/behind trajectory is detected. Surfaces
// sleep as the leverage point, frames the cortisol / water-retention
// mechanism, and explicitly de-prioritizes intake tightening (which is
// what the previous logic would have done — wrongly — based on burn-
// inflated alone).

function buildSleepBlocksCutPlan(u, n, evidenceFor) {
  const cards = [];
  const sleepShortHrs = (n.sleepGoalHrs && n.sleepAvg7d != null)
    ? Math.max(0, +(n.sleepGoalHrs - n.sleepAvg7d).toFixed(1)) : null;
  const chronic = u.burdens?.includes('chronic-sleep-debt');
  const hrvBad  = u.burdens?.includes('hrv-suppressed');
  const rhrBad  = u.burdens?.includes('rhr-elevated');

  // ① RECOVER — primary action: fix sleep before anything else
  const sleepDetail = [
    n.sleepAvg7d != null ? `7-day avg ${n.sleepAvg7d}h` : null,
    n.sleepAvg14d != null ? `14-day ${n.sleepAvg14d}h` : null,
    chronic && n.sleepAvg21d != null ? `21-day ${n.sleepAvg21d}h — chronic` : null,
    hrvBad ? `HRV suppressed ${n.hrvSuppressedDays}d` : null,
    rhrBad ? `RHR elevated ${n.rhrElevatedDays}d` : null,
  ].filter(Boolean).join(' · ');

  cards.push(card({
    key: 'recover',
    pillar: 'Recover',
    severity: chronic ? 'concern' : 'attention',
    title: chronic
      ? `Chronic sleep deficit — body is in cortisol mode`
      : `Sleep is the bottleneck, not the deficit`,
    detail: sleepDetail || 'Recent sleep below goal floor.',
    recommendation: chronic
      ? `Hard reset: 8.5h+ for 5 nights this week. Skip morning workouts if needed. The scale won't move under chronic cortisol — fixing this is the unblock.`
      : `Add ${sleepShortHrs || 1}h+ tonight + tomorrow. Move tomorrow's hard session to a recovered day. Re-weigh in 7 nights.`,
  }));

  // ② BODY — explain the cortisol → water-retention mechanism
  const trajStr = n.actualLossRate != null
    ? `${n.actualLossRate > 0 ? '+' : ''}${n.actualLossRate} lb/wk vs goal ${n.targetLossRate} lb/wk`
    : 'scale stalled';
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'info',
    title: `Scale won't move under cortisol — ${trajStr}`,
    detail: `Chronic sleep < 6.5h elevates cortisol → water retention up to 2-3 lb + reduced fat oxidation. The deficit IS real; the scale is hiding it.`,
    recommendation: `Don't change intake yet. Re-measure 7 days after sleep recovers; weight typically drops 1-2 lb fast (water release).`,
  }));

  // ③ FUEL — explicit "don't tighten" instruction
  const proteinShort = Math.max(0, (n.proteinTarget || n.proteinFloor) - n.todayProtein);
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} of ${n.goalTarget} kcal — HOLD`,
    detail: `Cutting further while sleep-debted accelerates cortisol + LBM loss. Current target is sized correctly for your goal; sleep is the missing input.`,
    recommendation: proteinShort > 5
      ? `Hold calories at target. Anchor ${proteinShort}g+ more protein (protects LBM through the recovery phase).`
      : `Hold calories at target. Protein floor hit ✓ — focus is sleep tonight.`,
  }));

  // ④ TRAIN — recovery-conscious training prescription
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: u.burdens?.includes('trained-today') ? 'attention' : 'info',
    title: u.burdens?.includes('trained-today')
      ? `Trained today on a debt night — recovery debt compounds`
      : `Easy / recovery focus this week`,
    detail: chronic
      ? `Recovery debt is chronic. Hard sessions on top of this are net negative.`
      : `Body wants the brake. Zone 2 + mobility only until sleep recovers 5+ nights.`,
    recommendation: u.burdens?.includes('trained-today')
      ? `30-40g protein within 60min · magnesium + glycine pre-bed · cap intensity tomorrow at zone 2.`
      : `Shift any planned hard session this week to the day AFTER a 7.5h+ night. Otherwise stick to zone 2.`,
  }));

  return cards;
}

function buildRecalibrateMathPlan(u, n, evidenceFor) {
  // The dominant story: empirical TDEE is significantly below model,
  // and the goal target is already at (or near) the RMR floor. Cutting
  // further isn't safe; the fix is to lower the goal target to what the
  // scale actually validates.
  const cards = [];

  // ① GOAL — primary action (lower target OR extend date)
  const weeksExtend = n.weeksExtendIfRecal != null ? Math.max(2, n.weeksExtendIfRecal) : 14;
  cards.push(card({
    key: 'goal',
    pillar: 'Goal',
    severity: 'attention',
    title: `Recalibrate: target ${n.goalTarget} sits at RMR floor`,
    detail: `Empirical TDEE ${n.tdeeEmpirical} vs model ${n.tdeeModel} · ${Math.round((1 - n.burnCorrectionFactor) * 100)}% burn inflation in the math. Scale-validated truth.`,
    recommendation: n.recommendedTarget
      ? `Lower goal calorie target from ${n.goalTarget} → ${n.recommendedTarget} kcal/day. OR extend goal date by ~${weeksExtend} weeks at current sustainable pace. Cutting further isn't safe — you're at RMR.`
      : `Lower goal calorie target to match what the scale validates. OR extend goal date by ~${weeksExtend} weeks.`,
    action: { label: 'open Goals' },
  }));

  // ② BODY — complementary, focuses on time/pace (since GOAL owns intake change)
  const lossRateStr = n.actualLossRate != null
    ? `${n.actualLossRate > 0 ? '+' : ''}${n.actualLossRate} lb/wk`
    : '—';
  const weeksAt = n.weeksAtCurrentPace || '—';
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'info',
    title: `Trajectory ${lossRateStr} — ${weeksAt} wks to ${(n.tdeeEmpirical && n.recommendedTarget) ? 'target at sustainable pace' : 'target'}`,
    detail: `Current pace vs goal pace ${n.targetLossRate} lb/wk. The math is the bottleneck, not effort.`,
    recommendation: `No additional intake action — covered by Goal card. Anchor ${n.proteinFloor}g+ protein/day to protect LBM through the recalibration.`,
  }));

  // ③ FUEL — RE-FRAMED to use derived target (model-aware), not the user-
  // pinned static target that was built on inflated burn. This is the
  // contradiction-killer: instead of "eat 1173 more to hit the inflated
  // training-day target", we tell the user what the model actually
  // derives for today given empirical TDEE + recovery + training load.
  const proteinShort = Math.max(0, (n.proteinTarget || n.proteinFloor) - n.todayProtein);
  const calRemain = Math.max(0, (n.goalTarget || n.calorieTargetDerived || 0) - n.todayIntake);
  const fuelTitle = n.goalTarget
    ? `Today ${n.todayIntake} of ${n.goalTarget} kcal target`
    : `Today ${n.todayIntake} kcal`;
  let fuelDetail;
  let fuelRec;
  // Surface the derivation breakdown so the user sees WHERE the target
  // came from when it differs from what they expected (e.g. raised by
  // recovery debt, lowered by burn correction).
  if (n.calorieTargetSource === 'override' && n.calorieTargetDerived != null) {
    fuelDetail = `PINNED ${n.goalTarget} kcal · derived target would be ${n.calorieTargetDerived} (empirical TDEE ${n.tdeeEmpirical || '—'}). System sees these diverging.`;
  } else if (n.tdeeEmpirical && n.todayBurnReported > 0 && n.burnCorrectionFactor < 0.85) {
    fuelDetail = `Derived target ${n.goalTarget}: empirical TDEE ${n.tdeeEmpirical} − deficit, +${n.todayBurnCorrected} eat-back (Garmin reported ${n.todayBurnReported}, corrected ${Math.round((1 - n.burnCorrectionFactor) * 100)}%).`;
  } else {
    fuelDetail = `Derived target ${n.goalTarget}: empirical TDEE ${n.tdeeEmpirical || '—'} adjusted for today's recovery + load.`;
  }
  if (proteinShort > 5 && calRemain > 100) {
    fuelRec = `Add ~${calRemain} kcal more (priority: ${proteinShort}g+ protein) — anchor at next meal.`;
  } else if (proteinShort > 5) {
    fuelRec = `Protein still ${proteinShort}g short of ${n.proteinTarget}g floor. Calories near target.`;
  } else if (calRemain > 100) {
    fuelRec = `Protein floor hit ✓ · ${calRemain} kcal still to go to derived target.`;
  } else {
    fuelRec = `On target ✓ · ${n.todayIntake} kcal · ${n.todayProtein}g protein.`;
  }
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: fuelTitle,
    detail: fuelDetail,
    recommendation: fuelRec,
    // Override badge in the chip slot when user has pinned divergently
    action: n.calorieTargetSource === 'override' ? { label: 'PINNED' } : null,
  }));

  // ④ TRAIN — positive callout if a session was logged, else recovery prompt
  if (u.burdens?.includes('trained-today')) {
    cards.push(card({
      key: 'train',
      pillar: 'Train',
      severity: 'positive',
      title: `Session logged · ${n.todayBurnReported} kcal credited`,
      detail: u.recoveryDebt >= 2
        ? `Recovery debt elevated (${u.recoveryDebt}/3) — load is real, recovery is the bottleneck.`
        : `Recovery markers in line.`,
      recommendation: u.recoveryDebt >= 2
        ? `Prioritize 7.5h+ sleep tonight + ${Math.round(n.proteinFloor * 0.25)}g protein within 60 min. Skip extras tomorrow.`
        : `${Math.round(n.proteinFloor * 0.25)}g protein within 60 min, ≥500ml water with electrolytes, 7.5h+ sleep tonight.`,
    }));
  } else {
    // Phase 4r.intel.27 — Title now reads "Planned: <type>" when a
    // session is on the calendar but not logged yet, instead of the
    // previous flat "No session today" which mis-reported reality
    // for users who had a session planned. Plan-specific
    // recommendation kept as-is (recalibrate-math wants zone-2
    // walks for clean deficit widening).
    cards.push(card({
      key: 'train',
      pillar: 'Train',
      severity: 'info',
      title: trainStatus(u, n).title,
      detail: `Recovery debt ${u.recoveryDebt}/3 · zone-2 walks are the cleanest lever to widen deficit without recovery cost.`,
      recommendation: u.phase === 'cut-at-floor'
        ? `30-45 min easy walk adds ~200 kcal real burn — doesn't compete with intake.`
        : `Optional: 30 min easy zone-2 to anchor weekly volume.`,
    }));
  }

  return cards;
}

function buildTightenDeficitPlan(u, n, evidenceFor) {
  const cards = [];
  const cut = Math.min(200, Math.max(100, Math.round((n.headroomKcal || 0) / 2 / 50) * 50));
  cards.push(card({
    key: 'goal',
    pillar: 'Goal',
    severity: 'attention',
    title: `Cut pace ${n.actualLossRate} vs goal ${n.targetLossRate} lb/wk — modest tighten OK`,
    detail: `${n.headroomKcal} kcal headroom above RMR ${n.rmr}. Burn math validated — deficit lever is intake.`,
    recommendation: `Drop intake ${cut} kcal/day for 14 days · re-measure. Still ${(n.headroomKcal || 0) - cut} kcal above RMR.`,
    action: { label: 'open Goals' },
  }));
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'info',
    title: `${n.actualLossRate} lb/wk · ${n.weeksAtCurrentPace || '—'} wks to target`,
    detail: `Tightening should pull pace to ~${n.targetLossRate} lb/wk if logging is honest.`,
    recommendation: `Hit ${n.proteinFloor}g+ protein/day. Re-audit weigh-ins next Saturday before any further changes.`,
  }));
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} of ${n.goalTarget - cut} kcal (new target)`,
    detail: `Cut applies starting tomorrow; today: hold protein floor.`,
    recommendation: `${Math.max(0, n.proteinFloor - n.todayProtein)}g protein still needed today.`,
  }));
  // Phase 4r.intel.27 — Title via trainStatus() so "Planned: Easy run"
  // surfaces when the session is on the calendar but not yet logged.
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: u.burdens?.includes('trained-today') ? 'positive' : 'info',
    title: trainStatus(u, n).title,
    detail: `Recovery debt ${u.recoveryDebt}/3.`,
    recommendation: u.burdens?.includes('trained-today')
      ? `${Math.round(n.proteinFloor * 0.25)}g protein within 60 min + 7.5h+ sleep.`
      : `Optional: 30-45 min zone-2 walk for stress + sleep dividends.`,
  }));
  return cards;
}

function buildSlowTheCutPlan(u, n, evidenceFor) {
  const cards = [];
  cards.push(card({
    key: 'goal',
    pillar: 'Goal',
    severity: 'concern',
    title: `Losing too fast (${n.actualLossRate} lb/wk) — LBM at risk`,
    detail: `>1.0 lb/wk sustained signals RMR adaptation + LBM loss + hormonal hit. Diet diminishing returns.`,
    recommendation: `Add 150-250 kcal/day (carbs around training). Target -0.5 to -1.0 lb/wk for sustainable.`,
    action: { label: 'open Goals' },
  }));
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'attention',
    title: `${n.actualLossRate} lb/wk · ${n.weeksAtCurrentPace || '—'} wks to target`,
    detail: `Slowing pace adds resilience; "faster" cut destroys later.`,
    recommendation: `Re-measure next Saturday. Floor protein at ${n.proteinFloor}g/day.`,
  }));
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} of ${n.goalTarget} kcal`,
    detail: `Tonight: add 200 kcal carbs to anchor recovery — overdue.`,
    recommendation: `Rice/oats + lean protein at next meal. ${Math.max(0, n.proteinFloor - n.todayProtein)}g protein remaining.`,
  }));
  // Phase 4r.intel.27 — Title via trainStatus().
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: 'info',
    title: trainStatus(u, n).title,
    detail: `Heavy deficit + heavy load = recovery debt compounds.`,
    recommendation: `Cap intensity until pace slows. Zone-2 only this week.`,
  }));
  return cards;
}

function buildRecoveryFirstPlan(u, n, evidenceFor) {
  const cards = [];
  cards.push(card({
    key: 'goal',
    pillar: 'Recover',
    severity: 'attention',
    title: `Recovery debt ${u.recoveryDebt}/3 — deficit + load colliding`,
    detail: `Cut-${u.phase.replace('cut-', '')} state amplifies under-recovery. Adaptation suffers, plateau follows.`,
    recommendation: `2-3 maintenance days this week (${n.tdeeEmpirical || n.goalTarget + 250} kcal/day). Move hard sessions to recovered days.`,
  }));
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'info',
    title: `${n.actualLossRate || '—'} lb/wk — pause adjustments`,
    detail: `Recovery debt clouds the scale read. Re-measure after a recovered week.`,
    recommendation: `Hold target weight goal date; don't recalibrate until rested.`,
  }));
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} kcal · floor protein`,
    detail: `Carbs around training; floor protein at ${n.proteinFloor}g.`,
    recommendation: `${Math.max(0, n.proteinFloor - n.todayProtein)}g protein remaining. Magnesium + glycine before bed.`,
  }));
  // Phase 4r.intel.27 — Recovery-first plan keeps the 'attention'
  // severity (body wants the brake) but the title now reads "Planned:
  // Easy run · recovery elevated" when the user has a session on
  // calendar, surfacing the *tension* between the plan and the body's
  // signal rather than mis-stating that there's no session.
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: 'attention',
    title: u.burdens?.includes('trained-today')
      ? `Session logged · recovery elevated`
      : trainStatus(u, n).title,
    detail: `Body wants the brake. HRV / sleep flagging chronic.`,
    recommendation: `7.5h+ sleep tonight. Skip / shift tomorrow's hard session.`,
  }));
  return cards;
}

function buildOnPacePlan(u, n, evidenceFor) {
  const cards = [];
  cards.push(card({
    key: 'goal',
    pillar: 'Goal',
    severity: 'positive',
    title: `On pace${n.actualLossRate ? ` · ${n.actualLossRate} lb/wk` : ''}`,
    detail: `Empirical math + scale align. Goal target ${n.goalTarget} working.`,
    recommendation: `Hold current intake + training. Re-check next Saturday.`,
  }));
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'positive',
    title: `${n.actualLossRate || '—'} lb/wk · ${n.weeksAtCurrentPace || '—'} wks remain`,
    detail: `Sustainable pace; LBM protected by ${n.proteinFloor}g protein floor.`,
    recommendation: `Maintain protein, maintain training volume.`,
  }));
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} of ${n.goalTarget} kcal`,
    detail: `Pacing on track.`,
    recommendation: `${Math.max(0, n.proteinFloor - n.todayProtein)}g protein still needed today.`,
  }));
  // Phase 4r.intel.27 — Title via trainStatus().
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: u.burdens?.includes('trained-today') ? 'positive' : 'info',
    title: trainStatus(u, n).title,
    detail: `Recovery debt ${u.recoveryDebt}/3.`,
    recommendation: u.burdens?.includes('trained-today')
      ? `${Math.round(n.proteinFloor * 0.25)}g protein within 60 min + 7.5h sleep.`
      : `Optional: 30 min zone-2 walk.`,
  }));
  return cards;
}

function buildGenericPlan(u, n, evidenceFor) {
  const cards = [];
  cards.push(card({
    key: 'goal',
    pillar: 'Goal',
    severity: 'info',
    title: `Status: ${u.phase} · ${u.trajectory}`,
    detail: `Goal target ${n.goalTarget || '—'} · RMR ${n.rmr || '—'} · ${n.headroomKcal || 0} kcal headroom.`,
    recommendation: `Open Goals to review target weight + date.`,
    action: { label: 'open Goals' },
  }));
  cards.push(card({
    key: 'body',
    pillar: 'Body',
    severity: 'info',
    title: `${n.actualLossRate || '—'} lb/wk`,
    detail: `Pace check.`,
    recommendation: `Protein floor ${n.proteinFloor}g/day.`,
  }));
  cards.push(card({
    key: 'fuel',
    pillar: 'Fuel',
    severity: 'info',
    title: `Today ${n.todayIntake} kcal`,
    detail: `Empirical TDEE ${n.tdeeEmpirical || '—'}.`,
    recommendation: `${Math.max(0, n.proteinFloor - n.todayProtein)}g protein remaining.`,
  }));
  // Phase 4r.intel.27 — Title via trainStatus().
  cards.push(card({
    key: 'train',
    pillar: 'Train',
    severity: u.burdens?.includes('trained-today') ? 'positive' : 'info',
    title: trainStatus(u, n).title,
    detail: `Recovery debt ${u.recoveryDebt}/3.`,
    recommendation: u.burdens?.includes('trained-today')
      ? `Protein + hydration + 7.5h sleep.`
      : `Optional zone-2.`,
  }));
  return cards;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG — call from console: window.intelligenceDebug()
// ═══════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-undef
  window.intelligenceDebug = function intelligenceDebug() {
    const data = {
      activities: storage.get('activities') || [],
      sleep:      storage.get('sleep') || [],
      hrv:        storage.get('hrv') || [],
      weight:     storage.get('weight') || [],
      cronometer: storage.get('cronometer') || [],
      profile:    { ...(storage.get('profile') || {}), ...getGoals() },
    };
    const state = computeUserState(data);
    const cards = synthesizeRecommendations(state, { rawInsights: [], rawPrompts: [] });
    console.log('%c=== INTELLIGENCE DEBUG ===', 'background:#1f3a3f;color:#a0e0d0;padding:2px 6px;font-weight:700');
    console.log('%cuserState:', 'color:#9ece6a;font-weight:700', state);
    console.log('%cburdens:',   'color:#f7768e;font-weight:700', state.burdens);
    console.log('%cphase:',     'color:#7dcfff;font-weight:700', state.phase);
    console.log('%ctrajectory:','color:#7dcfff;font-weight:700', state.trajectory);
    console.log('%ctrust:',     'color:#7dcfff;font-weight:700', state.trust);
    console.log('%cactiveGoalKinds:', 'color:#7dcfff;font-weight:700', state.activeGoalKinds);
    console.log('%c--- GOAL CONFLICTS ---', 'color:#f7768e;font-weight:700');
    if (Array.isArray(state.goalConflicts) && state.goalConflicts.length) {
      state.goalConflicts.forEach((c, i) => {
        console.log(`%c${i + 1}. [${c.severity}] ${c.id}`, 'color:#f7768e;font-weight:600');
        console.log('   ' + c.title);
        console.log('   detail:', c.detail);
        console.log('   →', c.recommendation);
      });
    } else {
      console.log('   (no active conflicts)');
    }
    console.log('%cnumbers:',   'color:#7dcfff;font-weight:700', state.numbers);
    // Phase 4r.coach.v1 — coach signals printed inline so the same call
    // (`intelligenceDebug()`) covers both the userState layer and the
    // pattern-detection signals.
    if (state.coachSignals) {
      console.log('%c--- COACH SIGNALS (v1) ---', 'color:#5eead4;font-weight:700');
      console.log('%csleepDebt:',          'color:#5eead4', state.coachSignals.sleepDebt);
      console.log('%chrvDepression:',      'color:#5eead4', state.coachSignals.hrvDepression);
      console.log('%crhrDrift:',           'color:#5eead4', state.coachSignals.rhrDrift);
      console.log('%cenergyAvailability:', 'color:#5eead4', state.coachSignals.energyAvailability);
      console.log('%cmonotonyStrain:',     'color:#5eead4', state.coachSignals.monotonyStrain);
      console.log('%csleepHrvCorrelation:','color:#5eead4', state.coachSignals.sleepHrvCorrelation);
    }
    console.log('%c--- SYNTHESIZED CARDS ---', 'color:#bb9af7;font-weight:700');
    cards.forEach((c, i) => {
      console.log(`%c${i + 1}. [${c.severity}] ${c.pillar} — ${c.title}`, 'color:#e0af68;font-weight:600');
      console.log('   detail:', c.detail);
      console.log('   →', c.recommendation);
    });
    return { state, cards };
  };

  // Phase 4r.coach.v1 — dedicated coach-signals debug helper.
  // Prints only the pattern-detection signals (statuses + raw numbers)
  // for focused inspection. Use this when iterating on signal thresholds
  // without the userState noise.
  // eslint-disable-next-line no-undef
  window.coachSignalsDebug = function coachSignalsDebug() {
    const data = {
      activities: storage.get('activities') || [],
      sleep:      storage.get('sleep') || [],
      hrv:        storage.get('hrv') || [],
      weight:     storage.get('weight') || [],
      cronometer: storage.get('cronometer') || [],
      profile:    { ...(storage.get('profile') || {}), ...getGoals() },
    };
    const state = computeUserState(data);
    const cs = state?.coachSignals;
    console.log('%c=== COACH SIGNALS v1 ===', 'background:#0f3a3a;color:#5eead4;padding:2px 6px;font-weight:700');
    if (!cs) {
      console.log('%cno signals computed (computeUserState returned null/empty)', 'color:#f7768e');
      return null;
    }
    const summary = {
      sleep:    `${cs.sleepDebt?.status || '—'} · debt7d=${cs.sleepDebt?.debt7d ?? '—'}h · avg7d=${cs.sleepDebt?.avgHours7d ?? '—'}h`,
      hrv:      `${cs.hrvDepression?.status || '—'} · latest=${cs.hrvDepression?.latest ?? '—'}ms · baseline=${cs.hrvDepression?.baseline28d ?? '—'}ms · depressed ${cs.hrvDepression?.consecutiveDepressedDays ?? 0}d`,
      rhr:      `${cs.rhrDrift?.status || '—'} · latest=${cs.rhrDrift?.latest ?? '—'}bpm · slope=${cs.rhrDrift?.slopeBpmPerWeek ?? '—'}bpm/wk`,
      energy:   `${cs.energyAvailability?.status || '—'} · ${cs.energyAvailability?.eaKcalPerKgLBM ?? '—'} kcal/kg LBM`,
      training: `${cs.monotonyStrain?.status || '—'} · monotony=${cs.monotonyStrain?.monotony ?? '—'} · strain=${cs.monotonyStrain?.strain ?? '—'} · weekly=${cs.monotonyStrain?.weeklyLoad ?? '—'}kcal`,
      sleepHrv: `${cs.sleepHrvCorrelation?.status || '—'} · n=${cs.sleepHrvCorrelation?.n ?? 0} · r=${cs.sleepHrvCorrelation?.r ?? '—'}${cs.sleepHrvCorrelation?.insight ? ` · ${cs.sleepHrvCorrelation.insight}` : ''}`,
    };
    console.table(summary);
    console.log('%cFull objects:', 'color:#5eead4;font-weight:700', cs);
    return cs;
  };
}
