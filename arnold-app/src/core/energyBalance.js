// ─── ARNOLD Energy Balance Engine ────────────────────────────────────────────
// Deterministic, science-backed model for tracking caloric intake vs total
// daily energy expenditure (TDEE), predicting weight change, and flagging
// when reality diverges from prediction.
//
// SOURCES OF TRUTH (priority order, highest first):
//   • Lean body mass:  DEXA (clinical-tests) → Garmin scale → estimated from weight × default BF%
//   • Body fat %:      DEXA → Garmin scale → profile field → 22% default
//   • Weight:          most recent `arnold:garmin-weight` entry → profile.weight
//   • Activity kcal:   FIT calories field (from Garmin device) → MET fallback
//   • Intake kcal:     nutrition.dailyTotals (Cronometer-live > nutritionLog > legacy)
//
// FORMULAS:
//   • RMR (Katch-McArdle, 1996):  RMR = 370 + 21.6 × LBM_kg
//     - Most accurate when body composition is known
//     - Reference: McArdle WD, Katch FI, Katch VL. Exercise Physiology, 4th ed.
//   • RMR (Mifflin-St Jeor, 1990): fallback when LBM unknown
//     - Male:   RMR = 10×W_kg + 6.25×H_cm − 5×age + 5
//     - Female: RMR = 10×W_kg + 6.25×H_cm − 5×age − 161
//   • TDEE = RMR + Activity_kcal + NEAT + TEF
//     - TEF (thermic effect of food): ~10% of intake (Westerterp 2004)
//     - NEAT estimated from RMR × NEAT_factor in absence of step count
//   • Energy → weight: 3500 kcal ≈ 1 lb fat (Hall 2008 simplified)
//     - Use 7700 kcal/kg in metric; here we use 3500/lb.

import { storage } from './storage.js';
import { dailyTotals } from './nutrition.js';
import { getGoals } from './goals.js';

const LB_PER_KG       = 2.20462;
const KG_PER_LB       = 0.45359;
const KCAL_PER_LB_FAT = 3500;          // simplified Wishnofsky / Hall 2008
const KCAL_PER_KG_FAT = 7700;
const TEF_RATIO       = 0.10;          // 10% of intake (mixed diet, Westerterp)
const NEAT_FACTOR_DEFAULT = 0.13;      // ~13% of RMR for moderately active
const NEAT_FACTOR_MIN     = 0.08;      // sedentary floor
const NEAT_FACTOR_MAX     = 0.25;      // very active ceiling

// Local date helper
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── BODY COMPOSITION SOURCES ───────────────────────────────────────────────

/**
 * Get the most recent body-composition snapshot, prioritizing DEXA over
 * scale measurements over user-entered values.
 *
 * @returns {{
 *   weightLbs: number,
 *   bodyFatPct: number,
 *   leanMassLbs: number,
 *   fatMassLbs: number,
 *   source: 'dexa' | 'garmin-scale' | 'profile' | 'estimate',
 *   sourceDate: string,
 * }}
 */
export function getCurrentBodyComp() {
  const profile = storage.get('profile') || {};
  const goals   = storage.get('goals')   || {};

  // Most recent weight (any source)
  const weights = storage.get('weight') || [];
  const sortedWeights = [...weights].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestWeight = sortedWeights[0];
  const weightLbs =
    parseFloat(latestWeight?.weightLbs)
    || (parseFloat(latestWeight?.weightKg) * LB_PER_KG)
    || parseFloat(profile.weight)
    || parseFloat(goals.targetWeight)
    || 175;

  // Body composition — DEXA wins
  const clinical = storage.get('clinicalTests') || [];
  const dexa = [...clinical]
    .filter(c => /dexa/i.test(c?.testType || c?.type || c?.name || '') && (c.bodyFatPct || c.leanMassLbs))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];

  if (dexa) {
    const bf = parseFloat(dexa.bodyFatPct);
    const lbm = parseFloat(dexa.leanMassLbs) || (weightLbs * (1 - bf / 100));
    return {
      weightLbs,
      bodyFatPct: bf,
      leanMassLbs: lbm,
      fatMassLbs: weightLbs - lbm,
      source: 'dexa',
      sourceDate: dexa.date || null,
    };
  }

  // Garmin scale: latest entry with bodyFatPct + skeletalMuscleMassLbs
  // Scale's "skeletal muscle" is NOT total LBM — it excludes organs, bone,
  // and water-bound mass. We compute LBM from weight × (1 − bodyFatPct).
  const scaleEntry = sortedWeights.find(w => w.bodyFatPct != null);
  if (scaleEntry?.bodyFatPct != null) {
    const bf = parseFloat(scaleEntry.bodyFatPct);
    const lbm = weightLbs * (1 - bf / 100);
    return {
      weightLbs,
      bodyFatPct: bf,
      leanMassLbs: lbm,
      fatMassLbs: weightLbs - lbm,
      source: 'garmin-scale',
      sourceDate: scaleEntry.date || null,
    };
  }

  // Profile field
  if (profile.bodyFatPct != null && parseFloat(profile.bodyFatPct) > 0) {
    const bf = parseFloat(profile.bodyFatPct);
    const lbm = weightLbs * (1 - bf / 100);
    return {
      weightLbs,
      bodyFatPct: bf,
      leanMassLbs: lbm,
      fatMassLbs: weightLbs - lbm,
      source: 'profile',
      sourceDate: null,
    };
  }

  // Last resort estimate: 22% body fat (rough male active baseline)
  const bf = 22;
  const lbm = weightLbs * (1 - bf / 100);
  return {
    weightLbs,
    bodyFatPct: bf,
    leanMassLbs: lbm,
    fatMassLbs: weightLbs - lbm,
    source: 'estimate',
    sourceDate: null,
  };
}

// ─── RMR (Resting Metabolic Rate) ───────────────────────────────────────────

/**
 * Compute Resting Metabolic Rate.
 *
 * Prefers Katch-McArdle (LBM-based) when body composition is available;
 * falls back to Mifflin-St Jeor (height/weight/age/sex) otherwise.
 *
 * @returns {{ rmr: number, formula: 'katch-mcardle' | 'mifflin-st-jeor' | 'fallback', inputs: object }}
 */
export function computeRMR() {
  const comp = getCurrentBodyComp();
  const profile = storage.get('profile') || {};

  // Katch-McArdle: most accurate when LBM is known
  if (comp.source !== 'estimate' && comp.leanMassLbs > 0) {
    const lbmKg = comp.leanMassLbs * KG_PER_LB;
    const rmr = 370 + 21.6 * lbmKg;
    return {
      rmr: Math.round(rmr),
      formula: 'katch-mcardle',
      inputs: { leanMassLbs: comp.leanMassLbs, leanMassKg: lbmKg, source: comp.source },
    };
  }

  // Mifflin-St Jeor fallback
  const weightKg = comp.weightLbs * KG_PER_LB;
  const heightCm = parseFloat(profile.heightCm)
    || (parseFloat(profile.heightInches) * 2.54)
    || 178;
  const age = (() => {
    if (profile.birthDate) {
      const bd = new Date(profile.birthDate);
      if (!isNaN(bd)) return Math.max(18, new Date().getFullYear() - bd.getFullYear());
    }
    return parseInt(profile.age) || 35;
  })();
  const isMale = (profile.sex || profile.gender || 'male').toLowerCase().startsWith('m');
  const rmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (isMale ? 5 : -161);
  return {
    rmr: Math.round(rmr),
    formula: 'mifflin-st-jeor',
    inputs: { weightKg, heightCm, age, sex: isMale ? 'male' : 'female' },
  };
}

// ─── Activity calories for a given date ─────────────────────────────────────

/**
 * Sum total kcal expended in workouts/runs for a given date. Uses the same
 * merged-and-deduplicated activity list as computeDailyScore — combines
 * arnold:activities and dailyLogs.fitActivities, drops health_connect ghost
 * rows. Each activity's `calories` field comes directly from the Garmin FIT
 * file (totalCalories session field) when available.
 */
export function dailyActivityCalories(dateStr) {
  const date = dateStr || localDate();
  const allActivities = storage.get('activities') || [];
  const dailyLogs     = storage.get('dailyLogs')  || [];

  const fitActs = [];
  for (const l of dailyLogs) {
    if (!l?.date || l.date !== date) continue;
    const fits = Array.isArray(l.fitActivities) && l.fitActivities.length
      ? l.fitActivities
      : (l.fitData ? [l.fitData] : []);
    for (const fd of fits) if (fd) fitActs.push(fd);
  }
  const merged = [
    ...allActivities.filter(a => a.date === date && a.source !== 'health_connect'),
    ...fitActs,
  ];

  let kcal = 0;
  for (const a of merged) {
    const c = parseFloat(a.calories);
    if (c > 0 && c < 5000) kcal += c; // sanity bound — ignore broken values
  }
  return Math.round(kcal);
}

// ─── TDEE — Total Daily Energy Expenditure ──────────────────────────────────

/**
 * @param {string} [dateStr]
 * @param {object} [opts]
 * @param {number} [opts.neatFactor] - override NEAT factor (default 0.13)
 * @returns {{
 *   tdee: number, rmr: number, activityKcal: number, neatKcal: number,
 *   tefKcal: number, intakeKcal: number, neatFactor: number,
 * }}
 */
export function computeTDEE(dateStr, opts = {}) {
  const date = dateStr || localDate();
  const { rmr } = computeRMR();
  const activityKcal = dailyActivityCalories(date);
  const neatFactor = Math.max(NEAT_FACTOR_MIN, Math.min(NEAT_FACTOR_MAX, opts.neatFactor ?? NEAT_FACTOR_DEFAULT));
  const neatKcal = Math.round(rmr * neatFactor);

  // TEF requires intake; pull from canonical dailyTotals
  let intakeKcal = 0;
  try {
    intakeKcal = parseFloat(dailyTotals(date)?.calories) || 0;
  } catch { /* ignore */ }
  const tefKcal = Math.round(intakeKcal * TEF_RATIO);

  return {
    tdee: rmr + activityKcal + neatKcal + tefKcal,
    rmr,
    activityKcal,
    neatKcal,
    tefKcal,
    intakeKcal: Math.round(intakeKcal),
    neatFactor,
  };
}

/**
 * Daily energy balance = intake − TDEE.
 * Negative = deficit (losing weight). Positive = surplus (gaining).
 */
export function dailyEnergyBalance(dateStr) {
  const t = computeTDEE(dateStr);
  return {
    date: dateStr || localDate(),
    intake: t.intakeKcal,
    tdee: t.tdee,
    balance: t.intakeKcal - t.tdee,    // negative = deficit
    deficit: t.tdee - t.intakeKcal,    // positive = deficit
    breakdown: t,
  };
}

// ─── Weight trend (rolling average to dampen water/glycogen noise) ──────────

/**
 * Rolling average weight centered on a target date. Weight has 2-4 lb daily
 * noise from water/glycogen/digestion; only multi-week averages reflect
 * actual fat-loss trends.
 *
 * @param {string} [dateStr] - center date (default today)
 * @param {number} [windowDays] - smoothing window (default 7)
 * @returns {{ date: string, lbs: number|null, sampleCount: number }}
 */
export function weightTrend(dateStr, windowDays = 7) {
  const date = dateStr || localDate();
  const center = new Date(date + 'T12:00:00');
  const halfWindow = Math.floor(windowDays / 2);
  const startMs = center.getTime() - halfWindow * 24 * 3600 * 1000;
  const endMs   = center.getTime() + halfWindow * 24 * 3600 * 1000;

  const weights = storage.get('weight') || [];
  const inWindow = weights.filter(w => {
    if (!w.date) return false;
    const wMs = new Date(w.date + 'T12:00:00').getTime();
    return wMs >= startMs && wMs <= endMs;
  });

  if (!inWindow.length) return { date, lbs: null, sampleCount: 0 };
  const sum = inWindow.reduce((s, w) => s + (parseFloat(w.weightLbs) || (parseFloat(w.weightKg) * LB_PER_KG) || 0), 0);
  return { date, lbs: Math.round((sum / inWindow.length) * 10) / 10, sampleCount: inWindow.length };
}

// ─── Predicted vs Actual weight change ──────────────────────────────────────

/**
 * Predict weight change between two dates from cumulative energy balance.
 * Δlbs = (sum of daily deficits) ÷ 3500 kcal/lb
 *
 * Days with NO logged intake are SKIPPED (deficit unknown). The prediction
 * therefore reflects only days where energy balance was observable.
 */
export function predictedWeightChange(startDate, endDate) {
  let cumDeficit = 0;
  let observedDays = 0;
  let totalDays = 0;
  const start = new Date(startDate + 'T12:00:00');
  const end   = new Date(endDate   + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    totalDays++;
    const ds = localDate(d);
    const bal = dailyEnergyBalance(ds);
    if (bal.intake > 0) {
      cumDeficit += bal.deficit;
      observedDays++;
    }
  }
  return {
    startDate, endDate,
    totalDays,
    observedDays,
    cumulativeDeficit: Math.round(cumDeficit),
    predictedLossLbs: Math.round((cumDeficit / KCAL_PER_LB_FAT) * 100) / 100,
  };
}

/**
 * Actual weight change between two dates, using rolling 7-day averages at
 * each endpoint to dampen noise.
 */
export function actualWeightChange(startDate, endDate) {
  const a = weightTrend(startDate);
  const b = weightTrend(endDate);
  if (a.lbs == null || b.lbs == null) {
    return { startDate, endDate, startLbs: a.lbs, endLbs: b.lbs, deltaLbs: null };
  }
  return {
    startDate,
    endDate,
    startLbs: a.lbs,
    endLbs: b.lbs,
    deltaLbs: Math.round((b.lbs - a.lbs) * 100) / 100, // negative = lost weight
  };
}

// ─── Calibration assessment ─────────────────────────────────────────────────

/**
 * Assess whether the energy-balance model is matching reality. If predicted
 * loss and actual loss diverge by more than a threshold, return diagnostic
 * candidates so the user knows what to investigate.
 *
 * Default window: 4 weeks (28 days). Tolerance: ±1 lb cumulative drift over
 * the window — beyond that, signal is real, not water/measurement noise.
 *
 * @param {object} [opts]
 * @param {number} [opts.weeks=4]
 * @param {number} [opts.tolerancePerWeek=0.25] - lb/week drift considered noise
 * @param {string} [opts.endDate] - default today
 */
export function assessCalibration(opts = {}) {
  const weeks = opts.weeks ?? 4;
  const tolerance = (opts.tolerancePerWeek ?? 0.25) * weeks;
  const endDate = opts.endDate || localDate();
  const startDate = (() => {
    const d = new Date(endDate + 'T12:00:00');
    d.setDate(d.getDate() - weeks * 7);
    return localDate(d);
  })();

  const predicted = predictedWeightChange(startDate, endDate);
  const actual    = actualWeightChange(startDate, endDate);

  // If we don't have actual weight at both endpoints, can't assess
  if (actual.deltaLbs == null) {
    return {
      windowDays: weeks * 7,
      startDate, endDate,
      predictedLossLbs: predicted.predictedLossLbs,
      actualLossLbs: null,
      driftLbs: null,
      status: 'no-data',
      message: 'Need weight measurements at both window endpoints to assess.',
      diagnostics: [],
    };
  }

  // Predicted loss is positive when in deficit; actual delta is negative when
  // weight goes down. Express both as "loss" (positive = lost).
  const predictedLoss = predicted.predictedLossLbs;            // positive in deficit
  const actualLoss    = -actual.deltaLbs;                       // flip sign
  const drift = actualLoss - predictedLoss;                     // > 0 = lost more than expected
  const observedDayPct = predicted.observedDays / predicted.totalDays;

  let status, message;
  const diagnostics = [];

  if (Math.abs(drift) <= tolerance) {
    status = 'aligned';
    message = `Predicted ${predictedLoss.toFixed(1)} lb · actual ${actualLoss.toFixed(1)} lb. Model is calibrated.`;
  } else if (drift < 0) {
    // Lost less than predicted — most common failure mode
    status = 'under-loss';
    message = `Predicted ${predictedLoss.toFixed(1)} lb loss but lost only ${actualLoss.toFixed(1)} lb (drift ${drift.toFixed(1)} lb).`;
    diagnostics.push({
      cause: 'underreported intake',
      detail: 'Cronometer may be missing entries (untracked snacks, drinks, oils, condiments). Each 100 kcal/day under-logged = ~1 lb/month phantom deficit.',
    });
    diagnostics.push({
      cause: 'overestimated activity calories',
      detail: 'Garmin watch tends to over-credit calorie burn by 10-30% for strength + interval work. Real activity kcal may be 70-80% of FIT value.',
    });
    diagnostics.push({
      cause: 'NEAT crash',
      detail: 'Sub-maintenance dieting reduces unconscious movement (fidgeting, walking). NEAT can drop 100-300 kcal/day, eating into your deficit.',
    });
    diagnostics.push({
      cause: 'RMR adapted downward',
      detail: 'Prolonged deficit reduces T3, leptin, and RMR by 5-15%. The current Katch-McArdle estimate may overstate actual RMR — your true RMR may be 5-10% lower.',
    });
    diagnostics.push({
      cause: 'recomp (favorable)',
      detail: 'If lean mass increased over the window (DEXA/scale rising), fat is being lost while muscle is being added. Scale stays flat but composition improves — this is a win, not a failure.',
    });
  } else {
    // Lost more than predicted — usually water/glycogen front-load or under-counted activity
    status = 'over-loss';
    message = `Predicted ${predictedLoss.toFixed(1)} lb loss but lost ${actualLoss.toFixed(1)} lb (drift +${drift.toFixed(1)} lb).`;
    diagnostics.push({
      cause: 'water/glycogen drop',
      detail: 'First 1-2 weeks of any deficit drop 2-4 lb of glycogen + water that have nothing to do with fat. Wait 3+ weeks before treating drift as signal.',
    });
    diagnostics.push({
      cause: 'undercounted activity',
      detail: 'If you had untracked walks, hikes, or chores, real TDEE was higher than computed.',
    });
    diagnostics.push({
      cause: 'over-reported intake',
      detail: 'Cronometer entries occasionally double-count or use larger serving sizes than reality.',
    });
  }

  if (observedDayPct < 0.7) {
    diagnostics.unshift({
      cause: 'sparse intake logging',
      detail: `Only ${predicted.observedDays} of ${predicted.totalDays} days had logged intake. Predictions are weak with <70% logging coverage.`,
    });
  }

  return {
    windowDays: weeks * 7,
    startDate, endDate,
    predictedLossLbs: predictedLoss,
    actualLossLbs: actualLoss,
    driftLbs: Math.round(drift * 100) / 100,
    observedDayPct: Math.round(observedDayPct * 100) / 100,
    status,
    message,
    diagnostics,
  };
}

// ─── Dynamic daily calorie target (activity-aware) ─────────────────────────

/**
 * Today's calorie target adjusted for activity. The Stellingwerff "fuel the
 * work required" framework: rest-day baseline + a fraction of training-day
 * activity calories. Same weekly average as a static target if you average
 * across the week, but distributed to support performance + recovery.
 *
 * eatBackPct = 0.75 by default. Garmin tends to over-credit activity by
 * 20-30%, so eating 100% back wipes the deficit. 0.75 keeps the deficit
 * intact while still fuelling the session.
 *
 * @param {string} [dateStr]
 * @param {object} [opts]
 * @param {number} [opts.eatBackPct=0.75]
 * @returns {{
 *   baseline: number,
 *   activityKcal: number,
 *   eatBackKcal: number,
 *   dynamicTarget: number,
 *   eatBackPct: number,
 *   isTrainingDay: boolean,
 * }}
 */
export function getDynamicCalorieTarget(dateStr, opts = {}) {
  const date = dateStr || localDate();
  const eatBackPct = opts.eatBackPct ?? 0.75;

  // Pull baseline from canonical getGoals() — applies user-set values, then
  // profile fallback, then the configured defaults. Never read storage.get
  // directly here because derived macro fields and field defaults won't be
  // present in raw storage.
  let baseline = 2000;
  try {
    const goals = getGoals();
    baseline = parseFloat(goals.dailyCalorieTarget) || 2000;
  } catch { /* ignore */ }

  const activityKcal = dailyActivityCalories(date);
  const eatBackKcal = Math.round(activityKcal * eatBackPct);
  return {
    baseline,
    activityKcal,
    eatBackKcal,
    dynamicTarget: baseline + eatBackKcal,
    eatBackPct,
    isTrainingDay: activityKcal >= 200,  // threshold: anything <200 kcal is incidental movement
  };
}

/**
 * Today's macro target adjusted for activity. Protein and fat stay constant
 * (LBM/hormonal floors don't move with daily training); carbs absorb the
 * activity-driven calorie increase since they're the substrate that needs
 * replacing post-exercise.
 */
export function getDynamicMacroTarget(dateStr, opts = {}) {
  const dyn = getDynamicCalorieTarget(dateStr, opts);
  // Use getGoals() so derived macro grams (dailyProteinTarget/CarbTarget/
  // FatTarget) are computed from calories × split % AND non-derived fields
  // like dailyFiberTarget fall back to their defaults.
  let baseProteinG = 0, baseCarbsG = 0, baseFatG = 0, baseFiberG = 0;
  try {
    const goals = getGoals();
    baseProteinG = parseFloat(goals.dailyProteinTarget) || 0;
    baseCarbsG   = parseFloat(goals.dailyCarbTarget)   || 0;
    baseFatG     = parseFloat(goals.dailyFatTarget)    || 0;
    baseFiberG   = parseFloat(goals.dailyFiberTarget)  || 0;
  } catch { /* ignore */ }

  // Protein + fat unchanged; carbs absorb the eat-back delta (4 kcal/g)
  const carbsG = baseCarbsG + Math.round(dyn.eatBackKcal / 4);
  return {
    ...dyn,
    proteinG: baseProteinG,
    carbsG,
    fatG: baseFatG,
    fiberG: baseFiberG,
    baseProteinG, baseCarbsG, baseFatG,
  };
}

// ─── Empirical TDEE (derived from observed reality) ────────────────────────

/**
 * Back out actual TDEE from observed weight change + logged intake.
 *
 * Your scale knows the truth. If you ate 1750 kcal/day for 28 days and lost
 * 2.1 lbs, your REAL TDEE was:
 *
 *   empirical_TDEE = avg_intake + (loss_lbs × 3500 ÷ days)
 *
 * This bypasses every input source of error: it doesn't matter whether the
 * RMR formula is wrong, whether Garmin over-credits activity, whether NEAT
 * has crashed, or whether Cronometer's underlogging is consistent — the
 * weight trajectory captures the net of all those errors as a single number.
 *
 * Caveats:
 *   • Requires ≥3 weeks and ≥70% intake-logging coverage to be trustworthy.
 *   • First 1-2 weeks of any change include water/glycogen swings; window
 *     should start ≥2 weeks after any major intake change.
 *   • Assumes intake logging is *consistently* off by the same amount; if
 *     you logged carefully one week and sloppily the next, this is noisy.
 *
 * @param {object} [opts]
 * @param {number} [opts.weeks=4]
 * @param {string} [opts.endDate] — default today
 * @returns {{
 *   empiricalTDEE: number|null,
 *   avgIntake: number,
 *   actualLossLbs: number,
 *   weeks: number,
 *   observedDayPct: number,
 *   confidence: 'high' | 'medium' | 'low' | 'insufficient',
 *   note: string,
 * }}
 */
export function empiricalTDEE(opts = {}) {
  const weeks = opts.weeks ?? 4;
  const endDate = opts.endDate || localDate();
  const startDate = (() => {
    const d = new Date(endDate + 'T12:00:00');
    d.setDate(d.getDate() - weeks * 7);
    return localDate(d);
  })();

  // Sum logged intake across the window — only days with intake count
  let intakeSum = 0;
  let observedDays = 0;
  let totalDays = 0;
  const start = new Date(startDate + 'T12:00:00');
  const end   = new Date(endDate   + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    totalDays++;
    const ds = localDate(d);
    let cal = 0;
    try { cal = parseFloat(dailyTotals(ds)?.calories) || 0; } catch {}
    if (cal > 0) {
      intakeSum += cal;
      observedDays++;
    }
  }

  const observedDayPct = observedDays / totalDays;
  const avgIntake = observedDays > 0 ? Math.round(intakeSum / observedDays) : 0;

  const actual = actualWeightChange(startDate, endDate);
  if (actual.deltaLbs == null || observedDays < 14 || observedDayPct < 0.7) {
    return {
      empiricalTDEE: null,
      avgIntake,
      actualLossLbs: actual.deltaLbs == null ? null : -actual.deltaLbs,
      weeks,
      observedDayPct: Math.round(observedDayPct * 100) / 100,
      confidence: 'insufficient',
      note: 'Need ≥14 days of logged intake AND ≥70% coverage AND weight measurements at both endpoints.',
    };
  }

  const lossLbs = -actual.deltaLbs;            // negative delta = lost weight
  const lossKcal = lossLbs * KCAL_PER_LB_FAT;  // positive when actually lost
  const days = totalDays;

  // empirical TDEE = avg intake + (loss kcal ÷ days)
  // Uses TOTAL window days (rest days are real and consume energy).
  const empirical = Math.round(avgIntake + (lossKcal / days));

  let confidence;
  if (observedDayPct >= 0.9 && weeks >= 4) confidence = 'high';
  else if (observedDayPct >= 0.8 && weeks >= 3) confidence = 'medium';
  else confidence = 'low';

  return {
    empiricalTDEE: empirical,
    avgIntake,
    actualLossLbs: Math.round(lossLbs * 100) / 100,
    weeks,
    observedDayPct: Math.round(observedDayPct * 100) / 100,
    confidence,
    note: `Avg intake ${avgIntake} + loss ${lossLbs.toFixed(1)} lb × 3500 ÷ ${days} d = ${empirical} kcal/day TDEE.`,
  };
}

// ─── Calorie-target recommendation ──────────────────────────────────────────

/**
 * Recommend a sustainable daily calorie target based on:
 *   • Current TDEE (averaged over recent activity)
 *   • Target weight
 *   • Desired loss rate (lb/week, default 0.7 — sustainable consensus)
 *   • RMR floor (never below RMR per Helms/Norton/Aragon consensus)
 *
 * Returns three calorie levels: cut / maintain-current / maintain-target.
 *
 * @param {object} [opts]
 * @param {number} [opts.lossRatePerWeek=0.7]
 * @param {number} [opts.activityFactorOverride] - override default activity factor
 * @returns {{
 *   rmr: number,
 *   tdeeCurrent: number,
 *   tdeeTarget: number,
 *   maintenanceCurrent: number,
 *   maintenanceTarget: number,
 *   cutTarget: number,
 *   cutDeficit: number,
 *   floorRmr: number,
 *   warnings: string[],
 * }}
 */
export function recommendCalorieTarget(opts = {}) {
  const lossRatePerWeek = opts.lossRatePerWeek ?? 0.7;
  const goals = storage.get('goals') || {};
  const profile = storage.get('profile') || {};
  const comp = getCurrentBodyComp();

  // RMR at current LBM (assuming LBM is preserved during a clean cut)
  const { rmr } = computeRMR();

  // Activity factor — derive from last 4 weeks of activity calories ÷ RMR
  // This is empirical: how many kcal/day does this person actually expend
  // beyond resting? Averaging shields against single-week noise.
  const today = localDate();
  let activityKcalSum = 0;
  let daysCounted = 0;
  for (let i = 0; i < 28; i++) {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() - i);
    const ds = localDate(d);
    const k = dailyActivityCalories(ds);
    if (k > 0) { activityKcalSum += k; daysCounted++; }
  }
  const avgActivityKcal = daysCounted > 0 ? activityKcalSum / 28 : 0; // /28 not /daysCounted: rest days are real
  const neatKcal = rmr * NEAT_FACTOR_DEFAULT;

  // Model-based TDEE (excluding TEF; see comment block below)
  const modelTdee = Math.round(rmr + avgActivityKcal + neatKcal);

  // Empirical TDEE: back out from observed reality. ALWAYS prefer this
  // when we have enough data — it captures every input error (Cronometer
  // underlogging, Garmin activity inflation, NEAT crash, RMR adaptation)
  // as a single ground-truth number.
  const emp = empiricalTDEE();
  const useEmpirical = emp.confidence === 'high' || emp.confidence === 'medium';
  const tdeeCurrent = useEmpirical ? emp.empiricalTDEE : modelTdee;

  // TDEE at target weight: RMR scales with LBM. If LBM stays constant, RMR
  // stays constant, and TDEE only changes if activity scales with weight
  // (small effect — ignore for first-order estimate).
  const tdeeTarget = tdeeCurrent;

  // Cut target: TDEE − deficit. Deficit derives from desired loss rate.
  const dailyDeficit = (lossRatePerWeek * KCAL_PER_LB_FAT) / 7;  // lb/wk × 3500 ÷ 7
  let cutTarget = Math.round(tdeeCurrent - dailyDeficit);

  const warnings = [];
  if (useEmpirical && Math.abs(emp.empiricalTDEE - modelTdee) > 300) {
    warnings.push(
      `Empirical TDEE (${emp.empiricalTDEE}, ${emp.confidence} conf) diverges from model (${modelTdee}) by ${modelTdee - emp.empiricalTDEE} kcal/day. ` +
      'Likely causes: Cronometer underlogging (oils, sauces, drinks), Garmin over-crediting activity, or RMR adaptation. ' +
      'Empirical wins — your scale knows the truth.'
    );
  }
  if (cutTarget < rmr) {
    warnings.push(`Cut target ${cutTarget} is below RMR ${rmr}. Raised to RMR floor; consider a slower loss rate (0.4-0.5 lb/wk) or addressing the empirical-vs-model gap before cutting harder.`);
    cutTarget = rmr;
  }
  if (lossRatePerWeek > 1.0) {
    warnings.push('Loss rate >1 lb/week typically requires sub-RMR intake or unsustainable deficit. Consider 0.5-0.75 lb/week.');
  }

  // Sanity check intake target
  const targetWeight = parseFloat(goals.targetWeight) || comp.weightLbs;
  const currentWeight = comp.weightLbs;
  const lbsToLose = currentWeight - targetWeight;
  const weeksToTarget = lbsToLose > 0 ? Math.ceil(lbsToLose / lossRatePerWeek) : 0;
  const projectedDate = lbsToLose > 0
    ? new Date(Date.now() + weeksToTarget * 7 * 86400000).toISOString().slice(0, 10)
    : null;

  // User-set target date (optional — Goals → Body → "Target weight by")
  const targetDateRaw = goals.targetWeightDate || '';
  let userTargetDate = null;
  let weeksUntilUserDate = null;
  let requiredLossRate = null;
  if (targetDateRaw) {
    // Accept MM-DD-YYYY, MM/DD/YYYY, or YYYY-MM-DD
    let parsed = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw)) parsed = new Date(targetDateRaw + 'T12:00:00');
    else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(targetDateRaw)) {
      const [m, d, y] = targetDateRaw.split(/[-/]/).map(Number);
      parsed = new Date(y, m - 1, d, 12);
    }
    if (parsed && !isNaN(parsed)) {
      userTargetDate = parsed.toISOString().slice(0, 10);
      const daysUntil = Math.max(1, (parsed.getTime() - Date.now()) / 86400000);
      weeksUntilUserDate = daysUntil / 7;
      requiredLossRate = lbsToLose > 0 ? lbsToLose / weeksUntilUserDate : 0;
    }
  }

  return {
    rmr,
    tdeeCurrent,                              // the one used for recommendation
    tdeeModel: modelTdee,                     // RMR + activity + NEAT
    tdeeEmpirical: emp.empiricalTDEE,         // back-calculated from weight change
    tdeeSource: useEmpirical ? `empirical (${emp.confidence} conf)` : 'model',
    tdeeTarget,
    maintenanceCurrent: tdeeCurrent,
    maintenanceTarget: tdeeTarget,
    cutTarget,
    cutDeficit: Math.round(dailyDeficit),
    floorRmr: rmr,
    lossRatePerWeek,
    currentWeight,
    targetWeight,
    lbsToLose: Math.round(lbsToLose * 10) / 10,
    weeksToTarget,
    projectedDate,                        // ETA at the configured loss rate
    userTargetDate,                       // user-set "target weight by" date
    weeksUntilUserDate,                   // weeks remaining until that date
    requiredLossRate,                     // lb/wk needed to hit user date
    avgActivityKcal: Math.round(avgActivityKcal),
    empirical: emp,
    warnings,
  };
}

// ─── Window debug helper ────────────────────────────────────────────────────

/**
 * One-shot snapshot for the console.
 *   energyBalanceDebug()                    // today + 4-week calibration
 *   energyBalanceDebug({ weeks: 8 })        // 8-week window
 *   energyBalanceDebug({ date: '2026-04-30' })
 */
export function energyBalanceDebug(opts = {}) {
  const date = opts.date || localDate();
  const weeks = opts.weeks ?? 4;

  const comp = getCurrentBodyComp();
  const rmrR = computeRMR();
  const tdee = computeTDEE(date);
  const bal  = dailyEnergyBalance(date);
  const trend = weightTrend(date);
  const cal = assessCalibration({ weeks });
  const rec = recommendCalorieTarget();

  console.log('%c=== ENERGY BALANCE DEBUG · ' + date + ' ===', 'color:#6fd4e4;font-weight:700');
  console.log('%cBody composition:', 'color:#9ece6a;font-weight:700');
  console.table([{
    weightLbs:   comp.weightLbs,
    bodyFatPct:  comp.bodyFatPct,
    leanMassLbs: Math.round(comp.leanMassLbs * 10) / 10,
    fatMassLbs:  Math.round(comp.fatMassLbs * 10) / 10,
    source:      comp.source,
    sourceDate:  comp.sourceDate,
  }]);

  console.log('%cRMR (' + rmrR.formula + '):', 'color:#9ece6a;font-weight:700', rmrR.rmr, 'kcal');
  console.log('  inputs:', rmrR.inputs);

  console.log('%cToday\'s energy balance:', 'color:#9ece6a;font-weight:700');
  console.table([{
    intake_kcal:   tdee.intakeKcal,
    rmr:           tdee.rmr,
    activity_kcal: tdee.activityKcal,
    neat_kcal:     tdee.neatKcal,
    tef_kcal:      tdee.tefKcal,
    tdee:          tdee.tdee,
    balance:       bal.balance,
    deficit:       bal.deficit,
  }]);

  console.log('%cWeight trend (7d centered):', 'color:#9ece6a;font-weight:700', trend.lbs, 'lbs (' + trend.sampleCount + ' samples)');

  console.log('%cCalibration check (' + weeks + ' weeks):', 'color:#9ece6a;font-weight:700');
  console.log('  status:', cal.status);
  console.log('  ' + cal.message);
  console.log('  predictedLossLbs:', cal.predictedLossLbs, ' actualLossLbs:', cal.actualLossLbs, ' driftLbs:', cal.driftLbs);
  console.log('  observed-day coverage:', Math.round(cal.observedDayPct * 100) + '%');
  if (cal.diagnostics?.length) {
    console.log('%c  Likely causes (in order of probability):', 'color:#e0b45e');
    for (const d of cal.diagnostics) console.log(`    • ${d.cause} — ${d.detail}`);
  }

  console.log('%cTDEE — model vs empirical:', 'color:#9ece6a;font-weight:700');
  console.table([{
    model_tdee:     rec.tdeeModel,
    empirical_tdee: rec.tdeeEmpirical,
    confidence:     rec.empirical?.confidence,
    avg_intake:     rec.empirical?.avgIntake,
    actual_loss_lb: rec.empirical?.actualLossLbs,
    diff:           rec.tdeeEmpirical != null ? (rec.tdeeModel - rec.tdeeEmpirical) : null,
    used_in_rec:    rec.tdeeSource,
  }]);

  console.log('%cRecommended calorie targets (using ' + rec.tdeeSource + '):', 'color:#9ece6a;font-weight:700');
  console.table([{
    RMR_floor:           rec.floorRmr,
    cut_target:          rec.cutTarget,
    maintain_current:    rec.maintenanceCurrent,
    maintain_target_wt:  rec.maintenanceTarget,
    cut_deficit_per_day: rec.cutDeficit,
    loss_rate_lb_per_wk: rec.lossRatePerWeek,
    lbs_to_lose:         rec.lbsToLose,
    weeks_to_target:     rec.weeksToTarget,
    avg_activity_kcal:   rec.avgActivityKcal,
  }]);
  if (rec.warnings.length) {
    console.log('%cWarnings:', 'color:#f87171;font-weight:700');
    for (const w of rec.warnings) console.log('  ⚠', w);
  }

  return { comp, rmr: rmrR, tdee, balance: bal, trend, calibration: cal, recommendation: rec };
}

if (typeof window !== 'undefined') window.energyBalanceDebug = energyBalanceDebug;
