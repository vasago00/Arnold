// ─── ARNOLD Coaching Prompts Engine ─────────────────────────────────────────
// Rules-based daily coaching prompts spanning the four pillars:
//   1. RUN / WORKOUT — training load, recovery debt, weekly hours pacing
//   2. NUTRITION    — intake vs target, calibration drift, logging completeness
//   3. RECOVERY     — HRV, sleep, RHR vs personal baselines
//   4. BODY         — weight trend vs prediction, body comp shifts
//
// PRINCIPLES:
//   • Prompts surface ACTION, not data — the dashboards already show data
//   • Top 3 priority shown; rest accessible via expand
//   • Each rule reads canonical helpers (energyBalance, healthSystems, dcy,
//     trainingStress, getGoals) — never recomputes
//   • Severity ladder: critical > warning > info > positive
//   • A rule can return null to signal "no signal here today"

import {
  computeRMR,
  computeTDEE,
  empiricalTDEE,
  weightTrend,
  assessCalibration,
  recommendCalorieTarget,
  getCurrentBodyComp,
  getDynamicCalorieTarget,
  getDynamicMacroTarget,
} from './energyBalance.js';
import { dailyTotals } from './nutrition.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';
import { getAvgWeeklyTrainingHours } from './trainingStress.js';

const SEVERITY_RANK = { critical: 4, warning: 3, info: 2, positive: 1 };

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── Rule helpers ──────────────────────────────────────────────────────────

function prompt({ severity, pillar, id, title, detail, action }) {
  return { severity, pillar, id, title, detail, action: action || null };
}

// ─── Rules: NUTRITION ──────────────────────────────────────────────────────

/** Goal calorie target is below computed RMR — never sustainable. */
function r_nutritionBelowRMR() {
  const goals = getGoals();
  const target = parseFloat(goals.dailyCalorieTarget) || 0;
  if (!target) return null;
  const { rmr } = computeRMR();
  if (target < rmr) {
    return prompt({
      severity: 'critical',
      pillar: 'calibration',
      id: 'cal-below-rmr',
      title: `Goal calories ${target} below RMR ${rmr}`,
      detail: 'Eating below resting metabolic rate triggers metabolic adaptation, lean mass loss, and rebounds. Raise to ≥RMR and use a slower loss rate instead.',
      action: { label: 'Raise to RMR', target: rmr },
    });
  }
  return null;
}

/** Empirical TDEE diverges meaningfully from model — likely under-logging. */
function r_nutritionCalibrationDrift() {
  const cal = assessCalibration({ weeks: 4 });
  if (cal.status === 'no-data' || cal.status === 'aligned') return null;
  if (Math.abs(cal.driftLbs) < 1) return null;
  const isUnder = cal.status === 'under-loss';
  return prompt({
    severity: 'warning',
    pillar: 'calibration',
    id: 'calibration-drift',
    title: isUnder
      ? `Lost ${cal.actualLossLbs.toFixed(1)} lb vs predicted ${cal.predictedLossLbs.toFixed(1)} lb`
      : `Lost ${cal.actualLossLbs.toFixed(1)} lb vs predicted ${cal.predictedLossLbs.toFixed(1)} lb (faster than expected)`,
    detail: isUnder
      ? 'Top causes: Cronometer underlogging (oils/sauces/drinks), Garmin over-crediting activity, NEAT crash. Tighten logs for one week to recalibrate.'
      : 'Likely water/glycogen drop (first 2 wks of any change) or untracked activity. If sustained beyond 3 wks, the deficit is real.',
    action: { label: 'Run audit week', kind: 'log-strict-7d' },
  });
}

/** Logging completeness < 70% — predictions become unreliable. */
function r_nutritionLogCoverage() {
  const cal = assessCalibration({ weeks: 4 });
  if (cal.status === 'no-data') return null;
  if (cal.observedDayPct >= 0.7) return null;
  return prompt({
    severity: 'warning',
    pillar: 'calibration',
    id: 'log-coverage',
    title: `Logging only ${Math.round(cal.observedDayPct * 100)}% of days`,
    detail: 'Calibration needs ≥70% coverage to be trusted. Missing days break the energy-balance math.',
    action: { label: 'Log today', kind: 'open-nutrition' },
  });
}

/** Today's intake well behind/ahead of activity-adjusted target. */
function r_nutritionPacing() {
  const today = localDate();
  const dyn = getDynamicCalorieTarget(today);
  const target = dyn.dynamicTarget;
  if (!target) return null;
  let intake = 0;
  try { intake = parseFloat(dailyTotals(today)?.calories) || 0; } catch {}
  const hour = new Date().getHours();
  if (hour < 11) return null; // too early to call
  if (intake === 0) {
    return prompt({
      severity: 'info',
      pillar: 'nutrition',
      id: 'intake-not-logged',
      title: 'No food logged yet today',
      detail: dyn.isTrainingDay
        ? `Today's training-day target is ${target} kcal (baseline ${dyn.baseline} + ${dyn.eatBackKcal} from activity). Log a meal to start tracking.`
        : 'Quick log keeps the calibration model accurate and prevents end-of-day guessing.',
      action: { label: 'Log a meal', kind: 'open-nutrition' },
    });
  }
  const wakeHour = 7;
  const sleepHour = 22;
  const dayFraction = Math.max(0, Math.min(1, (hour - wakeHour) / (sleepHour - wakeHour)));
  const expected = target * dayFraction;
  const ratio = intake / Math.max(1, expected);
  if (ratio < 0.5 && hour >= 14) {
    return prompt({
      severity: 'warning',
      pillar: 'nutrition',
      id: 'intake-low-pace',
      title: `Intake ${Math.round(intake)} kcal vs ~${Math.round(expected)} expected`,
      detail: dyn.isTrainingDay
        ? `Training day target is ${target} kcal (earned ${dyn.eatBackKcal} from activity). Low intake risks bonking + evening overshoot.`
        : 'Low intake by mid-day often leads to evening overshooting. Anchor a balanced meal soon.',
      action: { label: 'Log meal', kind: 'open-nutrition' },
    });
  }
  if (ratio > 1.4) {
    return prompt({
      severity: 'warning',
      pillar: 'nutrition',
      id: 'intake-high-pace',
      title: `Intake ${Math.round(intake)} kcal — ahead of pace`,
      detail: `On track to exceed ${target} kcal target${dyn.isTrainingDay ? ' (training day)' : ''}. Lighter dinner protects the deficit.`,
    });
  }
  return null;
}

/** Protein well below today's target by late afternoon. */
function r_nutritionProteinGap() {
  const today = localDate();
  const goals = getGoals();
  const proteinTarget = parseFloat(goals.dailyProteinTarget) || 0;
  if (!proteinTarget) return null;
  let intakeP = 0;
  try { intakeP = parseFloat(dailyTotals(today)?.protein) || 0; } catch {}
  const hour = new Date().getHours();
  if (hour < 16) return null;
  const ratio = intakeP / proteinTarget;
  if (ratio < 0.5) {
    const remaining = Math.round(proteinTarget - intakeP);
    return prompt({
      severity: 'warning',
      pillar: 'nutrition',
      id: 'protein-gap',
      title: `Protein ${Math.round(intakeP)} g of ${proteinTarget} g`,
      detail: `Need ~${remaining} g more by bed. Anchor dinner around a 30-40 g protein source — lean meat, fish, Greek yogurt, cottage cheese, whey.`,
    });
  }
  return null;
}

/**
 * Macro composition guidance — flags when the actual macro split diverges
 * from the target split. Triggers when the user has eaten enough kcal to
 * have a meaningful sample but is over-leaning into one macro at the
 * expense of another. Example: "950 kcal logged with only 60g protein and
 * 30g fat — protein under-represented vs target, anchor next meal there."
 *
 * Logic:
 *   • Wait until intake is ≥30% of dynamic target (otherwise sample is noisy)
 *   • Compute actual kcal split (protein × 4, carbs × 4, fat × 9)
 *   • Compare to target split (proteinPct, carbPct, fatPct from goals)
 *   • If any macro is < 70% of its target share AND another is > 130% of
 *     its target share, flag the imbalance with a remediation suggestion
 */
function r_macroBalance() {
  const today = localDate();
  const dyn = getDynamicCalorieTarget(today);
  const targetKcal = dyn.dynamicTarget;
  if (!targetKcal) return null;

  let totals;
  try { totals = dailyTotals(today); } catch { return null; }
  const intakeKcal = parseFloat(totals?.calories) || 0;
  if (intakeKcal < targetKcal * 0.30) return null; // wait for meaningful sample

  const pG = parseFloat(totals?.protein) || 0;
  const cG = parseFloat(totals?.carbs)   || 0;
  const fG = parseFloat(totals?.fat)     || 0;
  const pK = pG * 4, cK = cG * 4, fK = fG * 9;
  const sumK = pK + cK + fK;
  if (sumK < 100) return null;

  const actual = { protein: pK / sumK, carbs: cK / sumK, fat: fK / sumK };
  const goals = getGoals();
  const target = {
    protein: (parseFloat(goals.proteinPct) || 30) / 100,
    carbs:   (parseFloat(goals.carbPct)    || 40) / 100,
    fat:     (parseFloat(goals.fatPct)     || 30) / 100,
  };

  // Ratio of actual share to target share — <1 = under-represented
  const ratios = {
    protein: actual.protein / target.protein,
    carbs:   actual.carbs   / target.carbs,
    fat:     actual.fat     / target.fat,
  };

  // Find most-under and most-over
  const sorted = Object.entries(ratios).sort((a, b) => a[1] - b[1]);
  const [mostUnder, underRatio] = sorted[0];
  const [mostOver,  overRatio]  = sorted[2];
  if (underRatio >= 0.70 || overRatio <= 1.30) return null;

  const dynMacros = getDynamicMacroTarget(today);
  const remainingKcal = targetKcal - intakeKcal;

  // Compute remaining grams for the under-represented macro
  const macroLabels = {
    protein: { name: 'Protein', kcalPerG: 4, gTarget: dynMacros.proteinG, current: pG, foods: 'chicken, fish, lean beef, Greek yogurt, cottage cheese, whey, tofu, eggs' },
    carbs:   { name: 'Carbs',   kcalPerG: 4, gTarget: dynMacros.carbsG,   current: cG, foods: 'rice, oats, potatoes, fruit, whole-grain bread, pasta' },
    fat:     { name: 'Fat',     kcalPerG: 9, gTarget: dynMacros.fatG,     current: fG, foods: 'avocado, olive oil, nuts, seeds, fatty fish, eggs' },
  };
  const under = macroLabels[mostUnder];
  const over  = macroLabels[mostOver];
  const gNeeded = Math.max(0, Math.round(under.gTarget - under.current));

  // Build a concrete title that mirrors the user's example phrasing
  const title = `${Math.round(intakeKcal)} kcal in: ${Math.round(pG)}g P / ${Math.round(cG)}g C / ${Math.round(fG)}g F — ${under.name.toLowerCase()} short`;
  const detail = `${under.name} is ${Math.round((1 - underRatio) * 100)}% under its target share; ${over.name.toLowerCase()} is ${Math.round((overRatio - 1) * 100)}% over. ` +
    `Need ~${gNeeded}g more ${under.name.toLowerCase()} (${remainingKcal > 0 ? `${remainingKcal} kcal remaining` : 'shift composition'}). ` +
    `Anchor next meal with: ${under.foods}.`;

  return prompt({
    severity: underRatio < 0.5 ? 'warning' : 'info',
    pillar: 'nutrition',
    id: 'macro-imbalance',
    title,
    detail,
  });
}

// ─── Rules: BODY ───────────────────────────────────────────────────────────

/** Weight trend is off-pace vs the configured loss-rate goal. */
function r_bodyTrendOffPace() {
  const goals = getGoals();
  const targetWeight = parseFloat(goals.targetWeight) || 0;
  if (!targetWeight) return null;
  const comp = getCurrentBodyComp();
  if (!comp.weightLbs) return null;
  // Need ≥4 weeks of weight data to compare trend to target rate
  const today = localDate();
  const fourWeeksAgo = (() => {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - 28); return localDate(d);
  })();
  const trendNow = weightTrend(today);
  const trendThen = weightTrend(fourWeeksAgo);
  if (trendNow.lbs == null || trendThen.lbs == null) return null;
  const actualWeeklyDelta = (trendNow.lbs - trendThen.lbs) / 4;
  const distanceToTarget = comp.weightLbs - targetWeight;
  const direction = distanceToTarget > 0 ? 'cut' : (distanceToTarget < 0 ? 'gain' : 'maintain');
  if (direction === 'maintain') return null;

  // Cut expected: -0.5 to -0.7 lb/wk healthy; if losing slower, off-pace
  if (direction === 'cut' && actualWeeklyDelta > -0.2) {
    const weeksAtThisRate = actualWeeklyDelta < 0 ? Math.ceil(distanceToTarget / -actualWeeklyDelta) : null;
    return prompt({
      severity: actualWeeklyDelta >= 0 ? 'warning' : 'info',
      pillar: 'body',
      id: 'cut-pace-slow',
      title: actualWeeklyDelta >= 0
        ? `Weight stalled (+${(actualWeeklyDelta * 4).toFixed(1)} lb / 4 wk)`
        : `Cutting at ${actualWeeklyDelta.toFixed(2)} lb/wk — slow`,
      detail: weeksAtThisRate
        ? `At this rate, target ${targetWeight} lb in ~${weeksAtThisRate} weeks. Tighten logging or open a small additional deficit (50-100 kcal).`
        : 'Re-audit logging completeness before increasing deficit; the gap is usually intake, not metabolism.',
    });
  }

  // Cut expected, losing too fast (>1.2 lb/wk sustained = LBM risk)
  if (direction === 'cut' && actualWeeklyDelta < -1.2) {
    return prompt({
      severity: 'warning',
      pillar: 'body',
      id: 'cut-pace-fast',
      title: `Losing fast: ${actualWeeklyDelta.toFixed(2)} lb/wk`,
      detail: '>1.2 lb/wk sustained risks LBM loss + RMR adaptation. Add ~150-250 kcal/day until rate slows to 0.7-1.0 lb/wk.',
    });
  }

  // Cutting at healthy pace — positive callout
  if (direction === 'cut' && actualWeeklyDelta <= -0.5 && actualWeeklyDelta >= -1.0) {
    return prompt({
      severity: 'positive',
      pillar: 'body',
      id: 'cut-pace-good',
      title: `On-pace: ${actualWeeklyDelta.toFixed(2)} lb/wk`,
      detail: `Sustainable rate. ~${Math.ceil(distanceToTarget / -actualWeeklyDelta)} weeks to target ${targetWeight} lb.`,
    });
  }
  return null;
}

/** No weight measurement in last 5 days — calibration drifts blind. */
function r_bodyMissingWeighIns() {
  const weights = storage.get('weight') || [];
  if (!weights.length) return null;
  const sorted = [...weights].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const lastDate = sorted[0]?.date;
  if (!lastDate) return null;
  const ageDays = Math.floor((Date.now() - new Date(lastDate + 'T12:00:00').getTime()) / 86400000);
  if (ageDays < 5) return null;
  return prompt({
    severity: 'warning',
    pillar: 'body',
    id: 'no-weighin',
    title: `No weigh-in in ${ageDays} days`,
    detail: 'Trend math needs at least 1-2 morning weigh-ins per week to lock in. Step on the scale — same time, same conditions.',
    action: { label: 'Log weight', kind: 'open-weight' },
  });
}

// ─── Rules: RECOVERY ───────────────────────────────────────────────────────

/** HRV markedly below 30-day baseline — likely needing easier day. */
function r_recoveryHrvLow() {
  const hrv = storage.get('hrv') || [];
  if (hrv.length < 14) return null;
  const sorted = [...hrv].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const today = sorted[0];
  if (!today?.value) return null;
  const window30 = sorted.slice(0, 30).map(h => parseFloat(h.value)).filter(v => v > 0);
  if (window30.length < 14) return null;
  const baseline = window30.reduce((a, b) => a + b, 0) / window30.length;
  const todayVal = parseFloat(today.value);
  const dropPct = (baseline - todayVal) / baseline;
  if (dropPct < 0.10) return null;
  return prompt({
    severity: dropPct > 0.2 ? 'warning' : 'info',
    pillar: 'recovery',
    id: 'hrv-low',
    title: `HRV ${todayVal.toFixed(0)} ms (${Math.round(dropPct * 100)}% below 30d baseline ${Math.round(baseline)} ms)`,
    detail: 'Significant HRV drop signals incomplete recovery. Today, prioritize Z2 / mobility / rest over intensity.',
  });
}

/** Sleep score well under target. */
function r_recoverySleepLow() {
  const sleep = storage.get('sleep') || [];
  if (!sleep.length) return null;
  const sorted = [...sleep].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const today = sorted[0];
  if (!today) return null;
  const score = parseFloat(today.sleepScore) || 0;
  const goals = getGoals();
  const target = parseFloat(goals.targetSleepScore) || 85;
  if (!score || score >= target * 0.85) return null;
  return prompt({
    severity: score < target * 0.7 ? 'warning' : 'info',
    pillar: 'recovery',
    id: 'sleep-low',
    title: `Sleep ${score} (target ${target})`,
    detail: 'Poor sleep tanks recovery and inflates appetite/hunger hormones. Earlier bedtime, dim lights 60 min before, no screens in bed.',
  });
}

// ─── Rules: RUN / WORKOUT ──────────────────────────────────────────────────

/** Weekly training hours significantly under goal. */
function r_trainingHoursUnder() {
  const goals = getGoals();
  const targetHrs = parseFloat(goals.weeklyTimeTargetHrs) || 0;
  if (!targetHrs) return null;
  const { hoursPerWeek } = getAvgWeeklyTrainingHours(4);
  const ratio = hoursPerWeek / targetHrs;
  if (ratio >= 0.85) return null;
  const gap = targetHrs - hoursPerWeek;
  return prompt({
    severity: ratio < 0.5 ? 'warning' : 'info',
    pillar: 'run',
    id: 'training-hours-under',
    title: `Training ${hoursPerWeek.toFixed(1)} hr/wk vs ${targetHrs} target`,
    detail: `~${gap.toFixed(1)} hr gap. Adding 1-2 easy Z2 sessions/week is the lowest-stress way to close it.`,
  });
}

/** Positive callout: you trained today — acknowledge and reinforce. */
function r_trainingDone() {
  const today = localDate();
  const tdee = computeTDEE(today);
  const activityKcal = tdee.activityKcal || 0;
  if (activityKcal < 200) return null; // not a real session
  // Check recovery is solid — only emit positive if HRV/sleep aren't flagging
  const hrv = storage.get('hrv') || [];
  const sleep = storage.get('sleep') || [];
  const todaySleep = sleep.find(s => s.date === today);
  const sleepScore = parseFloat(todaySleep?.sleepScore) || 0;
  const goals = getGoals();
  const sleepTarget = parseFloat(goals.targetSleepScore) || 85;
  const sleepOk = sleepScore === 0 || sleepScore >= sleepTarget * 0.85;
  // We don't fire if recovery rules are about to fire — that's their job
  if (!sleepOk) return null;
  // Estimate session intensity from kcal burn rate
  const minutes = (tdee.activityKcal && tdee.activityKcal > 0)
    ? Math.max(15, Math.round(activityKcal / 10))  // ~10 kcal/min moderate
    : 30;
  const intensity = activityKcal >= 600 ? 'High-volume' :
                    activityKcal >= 350 ? 'Solid' :
                                          'Light';
  return prompt({
    severity: 'positive',
    pillar: 'run',
    id: 'training-done',
    title: `${intensity} session logged · ${activityKcal} kcal`,
    detail: 'Recovery markers look in line. Hydrate, anchor protein at the next meal, prioritize sleep tonight.',
  });
}

/**
 * On a hard-training day, fire late in the day if intake is well under the
 * activity-adjusted TARGET (the user's planned eat-back number). NOT TDEE
 * — TDEE is maintenance, while the target already includes the user's cut
 * deficit by design. Comparing to TDEE made every cutting day look like
 * "under-fuelling".
 *
 * Only fires after 6pm so mid-day pacing isn't flagged. By dinner time, if
 * you're still 25%+ short of target on a day with real activity calories,
 * the recovery risk is real (glycogen, LBM).
 */
function r_underFuelling() {
  const today = localDate();
  const hour = new Date().getHours();
  if (hour < 18) return null; // too early in the day to call
  let intake = 0;
  try { intake = parseFloat(dailyTotals(today)?.calories) || 0; } catch {}
  const tdee = computeTDEE(today);
  if (!tdee.activityKcal || tdee.activityKcal < 300) return null; // not a real session
  const dyn = getDynamicCalorieTarget(today);
  const target = dyn.dynamicTarget;
  if (!target) return null;
  if (!intake || intake >= target * 0.85) return null; // 85%+ of target = on track
  const remaining = target - intake;
  return prompt({
    severity: 'warning',
    pillar: 'nutrition',
    id: 'under-fuel-hard-day',
    title: `Behind on training-day target · ${intake} of ${target} kcal`,
    detail: `Earned ${dyn.eatBackKcal} kcal from today's session. Need ~${remaining} more by bed to fuel recovery — anchor protein + carbs at the next meal.`,
  });
}

// ─── CALIBRATION META — recommended phase ──────────────────────────────────

/** Empirical TDEE shows user is at maintenance — surface phase guidance. */
function r_phaseInsight() {
  const rec = recommendCalorieTarget();
  if (!rec.empirical || rec.empirical.confidence === 'insufficient') return null;
  const goals = getGoals();
  const goalCal = parseFloat(goals.dailyCalorieTarget) || 0;
  if (!goalCal) return null;
  const empirical = rec.tdeeEmpirical;
  if (empirical == null) return null;
  const goalToTdee = goalCal - empirical;
  // If goal is within 100 kcal of empirical, user is at maintenance not deficit
  if (Math.abs(goalToTdee) <= 100) {
    return prompt({
      severity: 'info',
      pillar: 'calibration',
      id: 'at-maintenance',
      title: `Goal ${goalCal} ≈ empirical TDEE ${empirical}`,
      detail: 'You are at maintenance, not deficit. To lose weight: tighten logging (closes the gap) OR raise activity ~250 kcal/day OR drop intake 200 kcal (if still above RMR).',
    });
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Return all coaching prompts that fired today, sorted by severity.
 * Each rule reads canonical state and returns either a prompt or null.
 */
export function getDailyCoachingPrompts() {
  const rules = [
    r_nutritionBelowRMR,
    r_nutritionCalibrationDrift,
    r_nutritionLogCoverage,
    r_nutritionPacing,
    r_nutritionProteinGap,
    r_macroBalance,
    r_underFuelling,
    r_bodyTrendOffPace,
    r_bodyMissingWeighIns,
    r_recoveryHrvLow,
    r_recoverySleepLow,
    r_trainingHoursUnder,
    r_trainingDone,
    r_phaseInsight,
  ];
  const fired = [];
  for (const rule of rules) {
    try {
      const p = rule();
      if (p) fired.push(p);
    } catch (e) {
      // Rule errors should never break the panel
      console.warn('[coachingPrompts] rule error:', rule.name, e);
    }
  }
  fired.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return fired;
}

/** Top N most critical prompts — for compact UI surfaces. */
export function getTopCoachingPrompts(limit = 3) {
  return getDailyCoachingPrompts().slice(0, limit);
}

/**
 * Filter prompts by pillar(s). Pass a single string or an array.
 *   getPromptsByPillar('nutrition')                  // Fuel tab
 *   getPromptsByPillar(['run', 'recovery'])           // Play tab
 *   getPromptsByPillar(['calibration', 'body'])       // EdgeIQ panel
 */
export function getPromptsByPillar(pillars, limit = Infinity) {
  const wanted = Array.isArray(pillars) ? pillars : [pillars];
  return getDailyCoachingPrompts()
    .filter(p => wanted.includes(p.pillar))
    .slice(0, limit);
}

/**
 * Tri-pillar status synthesis for the Start screen headline.
 * Returns one short status per area: training, nutrition, recovery.
 * Each status has the highest-severity prompt for that area, OR a
 * "clean" message when nothing's firing.
 *
 * Usage on Start:
 *   const { training, nutrition, recovery } = getPillarSummary();
 */
export function getPillarSummary() {
  const all = getDailyCoachingPrompts();
  const byArea = {
    training: all.filter(p => p.pillar === 'run'),
    nutrition: all.filter(p => p.pillar === 'nutrition'),
    recovery: all.filter(p => p.pillar === 'recovery'),
  };
  const synthesize = (prompts, defaults) => {
    if (!prompts.length) {
      return { severity: 'positive', title: defaults.title, detail: defaults.detail };
    }
    const top = prompts[0];
    return { severity: top.severity, title: top.title, detail: top.detail };
  };
  return {
    training:  synthesize(byArea.training,  { title: 'On track',     detail: 'Weekly hours and sessions in line with goal.' }),
    nutrition: synthesize(byArea.nutrition, { title: 'Eating clean', detail: 'Pacing, macros, and protein all on target.' }),
    recovery:  synthesize(byArea.recovery,  { title: 'Recovered',    detail: 'HRV and sleep both within personal baseline.' }),
  };
}

// ─── Window debug helper ────────────────────────────────────────────────────

export function coachingDebug() {
  const all = getDailyCoachingPrompts();
  console.log('%c=== COACHING PROMPTS · ' + localDate() + ' ===', 'color:#6fd4e4;font-weight:700');
  if (!all.length) {
    console.log('  (no prompts firing today — clean slate)');
    return all;
  }
  for (const p of all) {
    const color =
      p.severity === 'critical' ? '#f87171' :
      p.severity === 'warning' ? '#e0b45e' :
      p.severity === 'positive' ? '#9ece6a' :
      '#6fd4e4';
    console.log(`%c[${p.severity.toUpperCase()}] ${p.pillar} · ${p.title}`, `color:${color};font-weight:700`);
    console.log(`  ${p.detail}`);
    if (p.action) console.log(`  → action: ${p.action.label}`);
  }
  return all;
}
if (typeof window !== 'undefined') window.coachingDebug = coachingDebug;
