// ─── ARNOLD Dynamic Conditioning Yield (DCY) ─────────────────────────────────
// Readiness pipeline. See C:\Users\Superuser\Arnold\DCY_SPEC.md for the full
// spec and decision log. Single source of truth for the Big Moon / Small
// Moon readiness render.
//
//   DCY_today = F·N − G·(1.1 − R)
//     F = EWMA(dailyStress, τ=42)  adapted fitness
//     G = EWMA(dailyStress, τ=7)   accumulated fatigue
//     N ∈ [0,1]                    fuel adequacy
//     R ∈ [0,1]                    autonomic recovery
//
// STAGE STATUS:
//   Stage 1 — scaffold .................................. DONE
//   Stage 2 — Activity pillar (in dcyMath.js) ........... DONE
//   Stage 3 — Recovery pillar ........................... DONE
//   Stage 4 — Fuel pillar ............................... DONE
//   Stage 5 — Compose F·N − G·(1.1−R) + limitingFactor .. DONE

import { localDate, startOfWeek, weekDays, addDays, withinHours } from './time.js';
import { computeDailyScore, computeRolling7d } from './trainingStress.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';
import { dailyTotals, nutritionBaseline, partialDayState, forecastTotals } from './nutrition.js';
import { allActivities } from './dcyMath.js';
import {
  fitnessStock, fatigueStock, dailyStress,
  meanSkipNull, clip, geomMeanWeighted, metFor,
  HRV_ACUTE_DAYS, HRV_CHRONIC_DAYS, RHR_ACUTE_DAYS, RHR_CHRONIC_DAYS,
  R_WEIGHT_HRV, R_WEIGHT_RHR, R_WEIGHT_SLEEP,
  DEEP_PCT_TARGET, REM_PCT_TARGET, BODY_LOOKBACK_HOURS,
  TEF_FACTOR, N_WEIGHT_CAL, N_WEIGHT_PROTEIN, N_WEIGHT_HYDRO,
  KG_PER_LB, CM_PER_INCH,
} from './dcyMath.js';

// Re-exports so consumers can import everything from './dcy.js' alone.
export {
  trimp,
  sessionStress,
  dailyStress,
  ewmaSeries,
  fitnessStock,
  fatigueStock,
  buildSessionContext,
  calibrateTonnage,
  TAU_FITNESS,
  TAU_FATIGUE,
  ALPHA_FITNESS,
  ALPHA_FATIGUE,
  TRIMP_K,
  TONNAGE_TO_TSS_K,
  HRV_ACUTE_DAYS,
  HRV_CHRONIC_DAYS,
  RHR_ACUTE_DAYS,
  RHR_CHRONIC_DAYS,
  R_WEIGHT_HRV,
  R_WEIGHT_RHR,
  R_WEIGHT_SLEEP,
  BODY_LOOKBACK_HOURS,
  TEF_FACTOR,
  N_WEIGHT_CAL,
  N_WEIGHT_PROTEIN,
  N_WEIGHT_HYDRO,
  KG_PER_LB,
  MET_TABLE,
  metFor,
  geomMeanWeighted,
} from './dcyMath.js';

// ─── Legacy → DCY scale mapping ─────────────────────────────────────────────
// Kept alive (but no longer rendered) so the `_legacy` diagnostic block in
// dcy() still carries a side-by-side comparison during Stage 5 rollout.
// Will be removed entirely once we've spot-checked the new scale in the wild.
const LEGACY_CENTER = 50;
const LEGACY_SCALE = 0.48;
function legacyToDcy(legacyScore) {
  if (legacyScore == null || isNaN(legacyScore)) return 0;
  return +((legacyScore - LEGACY_CENTER) * LEGACY_SCALE).toFixed(2);
}

// ─── Limiting-factor classification (DCY_SPEC §5.5) ─────────────────────────
// First-match rules — order matters. Returns {factor, message}.
//
// Inputs:
//   F, G   — current fitness / fatigue stocks
//   N, R   — fuel / recovery coefficients already in [0, 1.1]
//   fBrk   — fuelBreakdown object (for sub-score drill-down)
//   rBrk   — recoveryBreakdown object (for sub-score drill-down)
//
// Rules (in order):
//   1. N < 0.8 AND fuel contributes >30% of total drag  → fuel_adequacy
//   2. R < 0.8 AND recovery contributes >30% of drag    → recovery
//   3. G > 1.5 · F                                      → acute_overload
//   4. F < 0.3 · 28d-avg-F  (TODO: needs fitness series) → detraining
//   5. Else                                             → balanced
function classifyLimitingFactor({ F, G, N, R, fBrk, rBrk }) {
  const fuelDrag = F * Math.max(0, 1 - N);            // F·(1−N) when N<1
  const recoveryDrag = G * Math.max(0, 1.1 - R);      // full fatigue term
  const totalDrag = fuelDrag + recoveryDrag;
  const fuelShare = totalDrag > 0 ? fuelDrag / totalDrag : 0;
  const recoveryShare = totalDrag > 0 ? recoveryDrag / totalDrag : 0;

  // Rule 1 — fuel-limited
  if (N < 0.8 && fuelShare > 0.30) {
    // Name the weakest sub-pillar to add texture to the message.
    const subs = fBrk?.sub || {};
    const labels = { cal: 'calorie intake', protein: 'protein', hydro: 'hydration' };
    const weakest = Object.entries(subs)
      .filter(([, v]) => v != null)
      .sort((a, b) => a[1] - b[1])[0];
    const label = weakest ? labels[weakest[0]] : 'fuel';
    const shortfall = weakest ? Math.round((1 - weakest[1]) * 100) : Math.round((1 - N) * 100);
    return {
      factor: 'fuel_adequacy',
      message: `Fuel-limited — ${label} ${shortfall}% below target.`,
    };
  }

  // Rule 2 — recovery-limited
  if (R < 0.8 && recoveryShare > 0.30) {
    // Weakest recovery signal: HRV delta, RHR delta, or sleep sub-score.
    const cands = [];
    if (rBrk?.hrv?.delta != null)  cands.push(['HRV',   rBrk.hrv.delta]);
    if (rBrk?.rhr?.delta != null)  cands.push(['RHR',   rBrk.rhr.delta]);
    if (rBrk?.sleep?.sub != null)  cands.push(['sleep', rBrk.sleep.sub]);
    const weakest = cands.sort((a, b) => a[1] - b[1])[0];
    const label = weakest ? weakest[0] : 'recovery';
    const shortfall = Math.round((1 - R) * 100);
    return {
      factor: 'recovery',
      message: `Recovery-limited — ${label} trailing, ${shortfall}% below baseline.`,
    };
  }

  // Rule 3 — acute overload (fatigue dwarfing fitness)
  if (F > 0 && G > 1.5 * F) {
    const pct = Math.round(((G / F) - 1) * 100);
    return {
      factor: 'acute_overload',
      message: `Overload — fatigue ${pct}% above fitness, back off.`,
    };
  }

  // TODO(rule-4): detraining — needs exported 28d fitness series.
  // Not critical for day-one Stage 5; add when we wire the Plan card.

  return { factor: 'balanced', message: '' };
}

// ─── Fuel pillar (DCY_SPEC §3) ──────────────────────────────────────────────
// Three layered helpers:
//   bmr()             — basal metabolic rate, three-tier priority chain
//   tdee(dateStr)     — total daily energy expenditure for a given date
//   fuelAdequacy(d)   — N ∈ [0, 1.1], geometric mean of cal/protein/hydration
// Each is a pure function over storage reads; nothing here mutates state.

// Module-level cache for the vitals-v4 blob. On web we can read it from
// localStorage synchronously; on mobile (Capacitor Preferences) sync reads
// aren't possible, so Arnold.jsx calls primeVitalsCache() on boot and after
// each save so bmr()'s Tier 1 (clinical RMR) resolves across both platforms.
let _vitalsCache = null;

/** Called by Arnold.jsx after loadData()/saveData() so bmr() can read sync. */
export function primeVitalsCache(blob) {
  _vitalsCache = blob || null;
}

function readVitalsBlob() {
  // Cache takes precedence — it's always the freshest (mobile + web).
  if (_vitalsCache) return _vitalsCache;
  // Fallback for pages that render before Arnold primes the cache, or for
  // web users whose data is already in localStorage.
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('vitals-v4');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// Pull most recent clinical RMR (from a clinicalTests array of `{type:'rmr',
// date, metrics:{rmr}}`). Returns the kcal value or null.
function clinicalRMR() {
  const blob = readVitalsBlob();
  const tests = Array.isArray(blob?.clinicalTests) ? blob.clinicalTests : [];
  if (tests.length === 0) return null;
  const rmrs = tests
    .filter((t) => t?.type === 'rmr' && t.metrics && Number(t.metrics.rmr) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rmrs.length > 0 ? Number(rmrs[0].metrics.rmr) : null;
}

// Pull lean body mass (kg) from the most recent weight row that carries
// either skeletalMuscleMassKg or (weightKg + bodyFatPct). LBM is the input
// to Katch-McArdle. Returns kg or null.
function latestLBMKg() {
  // LBM (Lean Body Mass) = everything that isn't fat ≈ 75–85% of body weight.
  // This is what the Katch-McArdle formula expects.
  // IMPORTANT: Skeletal Muscle Mass (SMM) from body-comp scales is NOT LBM —
  // it's just skeletal muscle tissue, typically ~45% of body weight. Feeding
  // SMM into Katch as if it were LBM under-estimates BMR by ~700 kcal/day.
  // So we only use weight × (1 − bodyFatPct/100). If neither is present we
  // return null and the caller falls through to Mifflin-St Jeor.
  const rows = storage.get('weight') || [];
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  for (const r of sorted) {
    const wKg = Number(r.weightKg);
    const bf = Number(r.bodyFatPct);
    if (wKg > 0 && bf > 0 && bf < 100) return wKg * (1 - bf / 100);
  }
  return null;
}

/**
 * Basal Metabolic Rate (kcal/day). DCY_SPEC §3.2 priority chain:
 *   1. Lab-measured RMR from clinicalTests (most accurate)
 *   2. Katch-McArdle from LBM (best when body comp is known)
 *   3. Mifflin-St Jeor from profile (sex, weight, height, age)
 *   4. 1700 kcal floor (last-ditch — never returns null so tdee is always safe)
 */
export function bmr() {
  return bmrWithTier().value;
}

// Same chain as bmr() but also reports which tier produced the number and
// the inputs it used. Useful for diagnostics panels so the BMR source is
// never a black box.
export function bmrWithTier() {
  // ── Tier 1: lab RMR ──
  const lab = clinicalRMR();
  if (lab && lab > 0) return { value: Math.round(lab), tier: 'lab', inputs: { rmr: lab } };

  // ── Tier 2: Katch-McArdle (370 + 21.6 · LBM_kg) ──
  const lbmKg = latestLBMKg();
  if (lbmKg && lbmKg > 0) {
    return { value: Math.round(370 + 21.6 * lbmKg), tier: 'katch', inputs: { lbmKg: +lbmKg.toFixed(1) } };
  }

  // ── Tier 3: Mifflin-St Jeor ──
  const profile = storage.get('profile') || {};
  const goals = getGoals();
  const wLb = Number(profile.weight) || Number(goals.targetWeight);
  const wKg = wLb > 0 ? wLb * KG_PER_LB : null;
  // Height: profile.height stored as inches in this app (see hc-sync.js)
  const hIn = Number(profile.heightInches) || Number(profile.height);
  const hCm = hIn > 0 ? hIn * CM_PER_INCH : null;
  const age = Number(profile.age);
  const sexAdj = profile.sex === 'F' ? -161 : 5; // +5 male, -161 female
  if (wKg && hCm && age > 0) {
    return {
      value: Math.round(10 * wKg + 6.25 * hCm - 5 * age + sexAdj),
      tier: 'mifflin',
      inputs: { wKg: +wKg.toFixed(1), hCm: +hCm.toFixed(0), age, sex: profile.sex || 'M' },
    };
  }

  // ── Floor ──
  return { value: 1700, tier: 'floor', inputs: {} };
}

// Per-activity calorie burn for a single date. Prefers `calories` /
// `activeCalories` already on the row (Garmin, Health Connect); falls back to
// MET·kg·hours when missing. Returns total kcal across all activities for the
// date.
function activityBurnFor(dateStr) {
  const acts = allActivities().filter((a) => a.date === dateStr);
  if (acts.length === 0) return 0;
  const profile = storage.get('profile') || {};
  const goals = getGoals();
  const wLb = Number(profile.weight) || Number(goals.targetWeight) || 175;
  const wKg = wLb * KG_PER_LB;
  let total = 0;
  for (const a of acts) {
    const direct = Number(a.calories) || Number(a.activeCalories);
    if (direct > 0) { total += direct; continue; }
    const dSecs = Number(a.durationSecs) || (Number(a.durationMins) ? a.durationMins * 60 : 0);
    if (dSecs <= 0) continue;
    const met = metFor(a.activityType, a.activityName);
    total += met * wKg * (dSecs / 3600);
  }
  return Math.round(total);
}

// NEAT coefficient — kcal per step per kg body mass. Tudor-Locke /
// Bassett calibration; accurate to ±20% vs DLW-validated NEAT.
const NEAT_KCAL_PER_STEP_PER_KG = 0.04;

// Body mass in kg with the same fallback chain activityBurnFor() uses so
// both functions stay consistent on a day the profile weight is missing.
function bodyMassKg() {
  const profile = storage.get('profile') || {};
  const goals = getGoals();
  const wLb = Number(profile.weight) || Number(goals.targetWeight) || 175;
  return wLb * KG_PER_LB;
}

// Pull the HC daily-energy row for a date. syncDailyEnergy writes here
// exclusively (Phase 4a bug fix moved it out of dailyLogs to dodge the
// LWW race between phone HC writes and desktop FIT uploads). If nothing
// has synced yet the row is absent and the tier-chain falls through.
function dailyLogFor(dateStr) {
  const rows = storage.get('hcDailyEnergy') || [];
  return rows.find(r => r && r.date === dateStr) || null;
}

/**
 * Total Daily Energy Expenditure for a specific date — 3-tier priority chain.
 *
 *   Tier 1 — Device daily total (Garmin → Health Connect).
 *            dailyLogs[date].totalCalories, if present, already integrates
 *            BMR + all structured workouts + ambient NEAT as the watch
 *            measured it 24/7. We use it directly and skip activityBurnFor
 *            to avoid double-counting FIT uploads that the watch also
 *            captured. TEF (food-derived) is still added on top.
 *   Tier 2 — Steps-derived NEAT + logged activities.
 *            If we have dailyLogs[date].steps but no total, we synthesize:
 *               BMR + (steps × 0.04 × bodyMassKg) + activityBurn + TEF
 *            This covers step-only data sources (Fitbit-only users, manual
 *            step entry, future integrations).
 *   Tier 3 — Legacy formula.
 *            BMR + activityBurn + TEF. Fires only when neither a wellness
 *            total nor a step count are available — the pre-Phase-4a
 *            behavior, preserved for backward compat.
 *
 * Floor: bmr() already guarantees ≥ 1700, so TDEE never returns below
 * BMR + TEF (the absolute-minimum-expenditure envelope).
 *
 * TEF = 0.10 · intake_calories  (DCY_SPEC §3.3) — added in every tier.
 */
export function tdee(dateStr) {
  return tdeeWithTier(dateStr).value;
}

/**
 * Full TDEE breakdown. Mirrors bmrWithTier()'s shape so DCY Details can
 * display which tier fired and what inputs went in.
 * @returns {{ value: number, tier: 1|2|3, inputs: Object }}
 */
export function tdeeWithTier(dateStr) {
  const date = dateStr || localDate();
  const base = bmr();
  const intake = Number(dailyTotals(date)?.calories) || 0;
  const tef = TEF_FACTOR * intake;
  const log = dailyLogFor(date);
  const totalKcal = Number(log?.totalCalories) || 0;
  const activeKcal = Number(log?.activeCalories) || 0;
  const steps = Number(log?.steps) || 0;

  // Tier 1 — Device daily total wins when present.
  if (totalKcal > 0) {
    return {
      value: Math.round(totalKcal + tef),
      tier: 1,
      inputs: {
        source: log?.wellnessSource || 'health_connect',
        totalKcal,
        activeKcal,  // shown for context; not part of the sum
        steps,       // shown for context
        tef: Math.round(tef),
      },
    };
  }

  // Tier 2 — Steps-based NEAT + per-activity burn.
  if (steps > 0) {
    const kg = bodyMassKg();
    const neat = Math.round(steps * NEAT_KCAL_PER_STEP_PER_KG * kg);
    const burn = activityBurnFor(date);
    return {
      value: Math.round(base + neat + burn + tef),
      tier: 2,
      inputs: {
        bmr: base,
        steps,
        bodyMassKg: +kg.toFixed(1),
        neat,
        activityBurn: burn,
        tef: Math.round(tef),
      },
    };
  }

  // Tier 3 — Legacy formula.
  const burn = activityBurnFor(date);
  return {
    value: Math.round(base + burn + tef),
    tier: 3,
    inputs: {
      bmr: base,
      activityBurn: burn,
      tef: Math.round(tef),
    },
  };
}

/**
 * Fuel adequacy N ∈ [0, 1.1] — DCY_SPEC §3.4.
 *   N_cal     = clip(intake_kcal / tdee,           0, 1.1)
 *   N_protein = clip(intake_g    / dailyProteinTgt,0, 1.1)
 *   N_hydro   = clip(intake_L    / dailyWaterTgt,  0, 1.1)
 *   N         = geomMean({N_cal: 0.50, N_protein: 0.35, N_hydro: 0.15})
 *
 * Pre-data fallback: if NO macro is logged (intake totals all zero), returns
 * 1 so dcy() collapses to F − 0.1·G — the "assume normal" posture.
 */
// Resolve the macro numerator for N. On a finished day (historical, or after
// bedtime today), that's just the live totals from dailyTotals(). On a day
// still in progress, we project: α × (live / fractionElapsed) + (1-α) × baseline.
// When baseline history is thin (< 3 logged days), we skip the forecast and
// use live totals so a new user doesn't see an unreliable projection.
// Shared by fuelAdequacy() and fuelBreakdown() so both sides see the same math.
function effectiveIntake(dateStr) {
  const date = dateStr || localDate();
  const liveTotals = dailyTotals(date) || {};
  const state = partialDayState(date);
  const baseline = state.isPartial ? nutritionBaseline(date) : null;
  const hasBaseline = !!baseline && (baseline.daysWithData || 0) >= 3;
  if (state.isPartial && hasBaseline) {
    return {
      date,
      intake:        forecastTotals(liveTotals, baseline, state),
      live:          liveTotals,
      forecastMode:  'projected',
      forecastState: state,
      baseline,
    };
  }
  return {
    date,
    intake:        liveTotals,
    live:          liveTotals,
    forecastMode:  'final',
    forecastState: state,
    baseline,
  };
}

export function fuelAdequacy(dateStr) {
  const { intake: totals, date } = effectiveIntake(dateStr);
  const intakeCal = Number(totals.calories) || 0;
  const intakeProtein = Number(totals.protein) || 0;
  // dailyTotals.water is in mL — convert to L for goal comparison.
  const intakeWaterL = (Number(totals.water) || 0) / 1000;

  // Nothing logged AND no baseline to forecast from → pre-data fallback.
  if (intakeCal === 0 && intakeProtein === 0 && intakeWaterL === 0) return 1;

  const goals = getGoals();
  const proteinGoal = Number(goals.dailyProteinTarget) || 0;
  const waterGoalL = Number(goals.dailyWaterTarget) || 0;
  const totalTdee = tdee(date) || 0;

  const nCal = totalTdee > 0 ? clip(intakeCal / totalTdee, 0, 1.1) : null;
  const nPro = proteinGoal > 0 ? clip(intakeProtein / proteinGoal, 0, 1.1) : null;
  const nHyd = waterGoalL > 0 ? clip(intakeWaterL / waterGoalL, 0, 1.1) : null;

  const N = geomMeanWeighted([
    { w: N_WEIGHT_CAL,     v: nCal },
    { w: N_WEIGHT_PROTEIN, v: nPro },
    { w: N_WEIGHT_HYDRO,   v: nHyd },
  ]);
  // If every input was null/zero we still want a sane default.
  if (N == null) return 1;
  return +N.toFixed(3);
}

// Diagnostic — full breakdown for the dcy() sources block and the
// Limiting-Factor line. Never mutates; safe to call multiple times.
export function fuelBreakdown(dateStr) {
  const date = dateStr || localDate();
  const eff = effectiveIntake(date);
  const totals = eff.intake;             // projected or live depending on day state
  const goals = getGoals();
  const tdeeInfo = tdeeWithTier(date);
  const totalTdee = tdeeInfo.value;
  const bmrInfo = bmrWithTier();
  const baseBmr = bmrInfo.value;
  const burn = activityBurnFor(date);
  const intakeCal = Number(totals.calories) || 0;
  const intakeProtein = Number(totals.protein) || 0;
  const intakeWaterL = (Number(totals.water) || 0) / 1000;
  const proteinGoal = Number(goals.dailyProteinTarget) || 0;
  const waterGoalL = Number(goals.dailyWaterTarget) || 0;
  const tef = TEF_FACTOR * intakeCal;

  const nCal = totalTdee > 0 ? clip(intakeCal / totalTdee, 0, 1.1) : null;
  const nPro = proteinGoal > 0 ? clip(intakeProtein / proteinGoal, 0, 1.1) : null;
  const nHyd = waterGoalL > 0 ? clip(intakeWaterL / waterGoalL, 0, 1.1) : null;

  // Live (pre-forecast) numbers for diagnostics — lets the UI show
  // "1240 kcal logged, 2180 kcal projected" side by side when useful.
  const liveCal     = Number(eff.live.calories) || 0;
  const liveProtein = Number(eff.live.protein)  || 0;
  const liveWaterL  = (Number(eff.live.water)   || 0) / 1000;

  return {
    bmr: baseBmr,
    bmrTier: bmrInfo.tier,
    bmrInputs: bmrInfo.inputs,
    tdee: totalTdee,
    tdeeTier: tdeeInfo.tier,
    tdeeInputs: tdeeInfo.inputs,
    activityBurn: burn,  // shown for context; NOT part of TDEE when tdeeTier === 1
    tef: Math.round(tef),
    intake: {
      calories: Math.round(intakeCal),
      protein:  Math.round(intakeProtein),
      waterL:   +intakeWaterL.toFixed(2),
    },
    live: {  // raw live totals BEFORE any forecast blending
      calories: Math.round(liveCal),
      protein:  Math.round(liveProtein),
      waterL:   +liveWaterL.toFixed(2),
    },
    targets: {
      calories: totalTdee,
      protein: proteinGoal,
      waterL: waterGoalL,
    },
    sub: {
      cal: nCal != null ? +nCal.toFixed(3) : null,
      protein: nPro != null ? +nPro.toFixed(3) : null,
      hydro: nHyd != null ? +nHyd.toFixed(3) : null,
    },
    // Forecast metadata — UI uses this to show a "Projected" badge and
    // display the α / fractionElapsed the forecast is operating at.
    forecastMode:    eff.forecastMode,       // 'projected' | 'final'
    forecastAlpha:   +(eff.forecastState.alpha || 0).toFixed(3),
    forecastElapsed: +(eff.forecastState.fractionElapsed || 0).toFixed(3),
    baselineDays:    eff.baseline?.daysWithData || 0,
    N: fuelAdequacy(date),
  };
}

// ─── Recovery pillar (DCY_SPEC §4) ──────────────────────────────────────────
// All three helpers read storage directly so callers can invoke them with
// just a date — matches the §7 signatures.

// Map a list of dated rows into a `{date, value}` stream filtered by window.
// Rows at a date beyond `refDate` are skipped (no peeking into the future).
function windowedValues(rows, valueKey, refDate, days) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const end = refDate;
  // Start = refDate − (days-1) so "last 7 days inclusive" actually spans 7 days.
  const start = addDays(refDate, -(days - 1));
  const out = [];
  for (const r of rows) {
    if (!r || !r.date) continue;
    if (r.date < start || r.date > end) continue;
    const v = r[valueKey];
    if (v == null) continue;
    const num = Number(v);
    if (isNaN(num)) continue;
    out.push(num);
  }
  return out;
}

/**
 * Mean overnightHRV over last `days` days (today-inclusive), nulls skipped.
 * Returns null when no readings fall inside the window.
 */
export function hrvBaseline(refDate, days) {
  const ref = refDate || localDate();
  const n = Number(days) || HRV_ACUTE_DAYS;
  // HRV sources merged by date with worker > csv priority:
  //   - sleep collection (Phase 4c Garmin Worker): each night's row has overnightHRV
  //   - hrv collection (manual Garmin CSV imports): per-day observations
  // Same merge pattern as the Overnight HRV tile, ensures the recovery
  // coefficient sees Worker-pulled HRV instead of treating it as "no data".
  const sleepRows = storage.get('sleep') || [];
  const hrvRows   = storage.get('hrv')   || [];
  const byDate = new Map();
  for (const h of hrvRows) {
    if (h?.date && h.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
      byDate.set(h.date, { date: h.date, overnightHRV: Number(h.overnightHRV) });
    }
  }
  for (const s of sleepRows) {
    if (s?.date && s.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
      byDate.set(s.date, { date: s.date, overnightHRV: Number(s.overnightHRV) });
    }
  }
  const merged = [...byDate.values()];
  const vals = windowedValues(merged, 'overnightHRV', ref, n);
  return meanSkipNull(vals);
}

/**
 * Mean restingHR over last `days` days (today-inclusive), nulls skipped.
 * Pulls from the sleep array, where Garmin writes nightly RHR. Falls back to
 * profile.restingHR *only* when there is literally no sleep-row data —
 * because a static profile value can't drift, so using it inside a delta
 * would spuriously read as "at baseline" every day.
 */
export function rhrBaseline(refDate, days) {
  const ref = refDate || localDate();
  const n = Number(days) || RHR_ACUTE_DAYS;
  const rows = storage.get('sleep') || [];
  const vals = windowedValues(rows, 'restingHR', ref, n);
  if (vals.length > 0) return meanSkipNull(vals);
  // No sleep RHR rows anywhere in the window — this is the seed phase.
  // Return null so recoveryCoef can fall back rather than degrade R falsely.
  return null;
}

// ─── Sleep-stage sub-score (DCY_SPEC §4.2) ──────────────────────────────────
// Accepts either Secs (spec) or Minutes (hc-sync.js already writes Minutes).
// Returns { sub, hasStages } so the caller can know whether stages were used.
function stageSubFromRow(row) {
  if (!row) return { sub: null, hasStages: false };
  const deepMin  = Number(row.deepSleepMinutes  ?? (row.deepSleepSecs  ? row.deepSleepSecs  / 60 : null));
  const remMin   = Number(row.remSleepMinutes   ?? (row.remSleepSecs   ? row.remSleepSecs   / 60 : null));
  const lightMin = Number(row.lightSleepMinutes ?? (row.lightSleepSecs ? row.lightSleepSecs / 60 : null));
  // sleepScore missing-check: was previously `isNaN(Number(row.sleepScore))`
  // which only catches undefined/garbage, NOT null. After the 2026-04-28
  // migration cleared HC-computed scores to `null`, Number(null) is 0 and
  // the composite formula was treating "score missing" as "score=0",
  // collapsing recovery drastically. Use a strict null/undefined check
  // so missing scores fall through to the stageSub-only path.
  const scoreRaw = row.sleepScore;
  const scoreMissing = scoreRaw == null || isNaN(Number(scoreRaw));
  const score = scoreMissing ? NaN : Number(scoreRaw);
  const hasStages = [deepMin, remMin, lightMin].every((v) => !isNaN(v) && v > 0);
  if (!hasStages) {
    // Fallback: sleepScore alone (DCY_SPEC section 4.2 last paragraph).
    if (scoreMissing) return { sub: null, hasStages: false };
    return { sub: Math.max(0, Math.min(score / 100, 1.1)), hasStages: false };
  }
  const total = deepMin + remMin + lightMin;
  if (total <= 0) {
    if (scoreMissing) return { sub: null, hasStages: false };
    return { sub: Math.max(0, Math.min(score / 100, 1.1)), hasStages: false };
  }
  const deepPct = deepMin / total;
  const remPct = remMin / total;
  const stageSub = Math.max(0, Math.min(
    (deepPct / DEEP_PCT_TARGET) * 0.5 + (remPct / REM_PCT_TARGET) * 0.5,
    1.1
  ));
  // Composite: 60% Garmin score + 40% stage bonus.
  if (scoreMissing) return { sub: stageSub, hasStages: true };
  const composite = 0.6 * (score / 100) + 0.4 * stageSub;
  return { sub: Math.max(0, Math.min(composite, 1.1)), hasStages: true };
}

// Pick the most recent sleep row within the sleep-specific lookback from
// refDate. Sleep sessions are dated by startTime (see hc-sync.js), so last
// night's sleep (which started at e.g. 23:00 yesterday) sits ~48h from
// today's end-of-day — wider than the 36h body-signal window. Bumping sleep
// to 48h catches the prior calendar day without picking up 2-night-old data.
const SLEEP_LOOKBACK_HOURS = 48;
function latestFreshSleep(refDate) {
  const rows = storage.get('sleep') || [];
  if (rows.length === 0) return null;
  // Newest-first sort, with source tie-breaking when two rows share a date:
  //   garmin-worker > csv-import (no source field) > hc
  // This makes the Worker's authoritative Sleep Score win on dates where HC
  // and Worker both wrote (HC writes a stage-only row with sleepScore=null
  // post the Phase 4b migration; Worker fills in the real composite score).
  const sourceRank = (r) => {
    const s = r?.source || '';
    if (s === 'garmin-worker') return 0;
    if (s === 'hc')            return 2;
    return 1; // csv import or anything else
  };
  const sorted = [...rows].sort((a, b) => {
    const dateCmp = (b.date || '').localeCompare(a.date || '');
    if (dateCmp !== 0) return dateCmp;
    return sourceRank(a) - sourceRank(b);
  });
  for (const r of sorted) {
    if (!r?.date) continue;
    if (withinHours(r.date, refDate, SLEEP_LOOKBACK_HOURS)) return r;
  }
  return null;
}

/**
 * Autonomic Recovery coefficient — R ∈ [0, 1.1] per DCY_SPEC §4.3.
 *
 * R = 0.45·clip(HRV_delta, 0, 1.1)
 *   + 0.30·clip(RHR_delta, 0, 1.1)
 *   + 0.25·clip(sleepSub,  0, 1.1)
 *
 * When an input is missing, its weight is redistributed over whatever's
 * available. If *nothing* is available, returns 1 so dcy() falls back to
 * F·N·1 − G·0.1 = F·N − 0.1·G — the pre-signal "assume normal" posture.
 */
export function recoveryCoef(refDate) {
  const ref = refDate || localDate();

  // HRV delta: acute (7d) / chronic (28d)
  const hrvAcute = hrvBaseline(ref, HRV_ACUTE_DAYS);
  const hrvChronic = hrvBaseline(ref, HRV_CHRONIC_DAYS);
  const hrvDelta = (hrvAcute != null && hrvChronic && hrvChronic !== 0)
    ? hrvAcute / hrvChronic : null;

  // RHR delta: chronic / acute (inverted so higher = better)
  const rhrAcute = rhrBaseline(ref, RHR_ACUTE_DAYS);
  const rhrChronic = rhrBaseline(ref, RHR_CHRONIC_DAYS);
  const rhrDelta = (rhrAcute != null && rhrChronic != null && rhrAcute !== 0)
    ? rhrChronic / rhrAcute : null;

  // Sleep sub-score from the latest fresh-within-36h sleep row.
  const sleepRow = latestFreshSleep(ref);
  const { sub: sleepSub } = stageSubFromRow(sleepRow);

  // Clip each to [0, 1.1] so bad readings can't drag R negative or explode it.
  const hrvC = clip(hrvDelta, 0, 1.1);
  const rhrC = clip(rhrDelta, 0, 1.1);
  const slpC = clip(sleepSub, 0, 1.1);

  // Re-normalize weights over available inputs so missing signals don't
  // silently zero-weight into R — they just drop out of the blend.
  const parts = [];
  if (hrvC != null) parts.push({ w: R_WEIGHT_HRV, v: hrvC });
  if (rhrC != null) parts.push({ w: R_WEIGHT_RHR, v: rhrC });
  if (slpC != null) parts.push({ w: R_WEIGHT_SLEEP, v: slpC });
  if (parts.length === 0) return 1; // pre-signal fallback
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const R = parts.reduce((s, p) => s + (p.w / wSum) * p.v, 0);
  return +R.toFixed(3);
}

// Diagnostic helper — returns the full breakdown dcy() needs to populate
// `sources` and the Limiting-Factor block. Separate from recoveryCoef so
// the scalar caller isn't forced to pay for the object allocation.
export function recoveryBreakdown(refDate) {
  const ref = refDate || localDate();
  const hrvAcute = hrvBaseline(ref, HRV_ACUTE_DAYS);
  const hrvChronic = hrvBaseline(ref, HRV_CHRONIC_DAYS);
  const hrvDelta = (hrvAcute != null && hrvChronic && hrvChronic !== 0)
    ? hrvAcute / hrvChronic : null;

  const rhrAcute = rhrBaseline(ref, RHR_ACUTE_DAYS);
  const rhrChronic = rhrBaseline(ref, RHR_CHRONIC_DAYS);
  const rhrDelta = (rhrAcute != null && rhrChronic != null && rhrAcute !== 0)
    ? rhrChronic / rhrAcute : null;

  const sleepRow = latestFreshSleep(ref);
  const { sub: sleepSub, hasStages } = stageSubFromRow(sleepRow);

  // Also expose the most-recent sleep row regardless of freshness, so the
  // diagnostics panel can explain *why* sleep was dropped from R (staleness
  // vs missing data).
  const allSleepRows = storage.get('sleep') || [];
  const newest = allSleepRows.length
    ? [...allSleepRows].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
    : null;
  const sleepLatest = newest ? {
    date: newest.date,
    score: newest.sleepScore ?? null,
    stale: sleepRow == null,
  } : null;

  return {
    hrv: hrvAcute == null ? null : {
      acute: +hrvAcute.toFixed(2),
      chronic: hrvChronic != null ? +hrvChronic.toFixed(2) : null,
      delta: hrvDelta != null ? +hrvDelta.toFixed(3) : null,
    },
    rhr: rhrAcute == null ? null : {
      acute: +rhrAcute.toFixed(2),
      chronic: rhrChronic != null ? +rhrChronic.toFixed(2) : null,
      delta: rhrDelta != null ? +rhrDelta.toFixed(3) : null,
    },
    sleep: sleepRow == null ? null : {
      date: sleepRow.date,
      score: sleepRow.sleepScore ?? null,
      sub: sleepSub != null ? +sleepSub.toFixed(3) : null,
      hasStages,
    },
    sleepLatest,
    R: recoveryCoef(ref),
  };
}

// ─── DCY composition (DCY_SPEC §2) ──────────────────────────────────────────
// DCY_today = F·N − G·(1.1 − R)
//   F  — adapted fitness (τ=42 EWMA of dailyStress)
//   G  — accumulated fatigue (τ=7)
//   N  — fuel adequacy ∈ [0, 1.1]
//   R  — autonomic recovery ∈ [0, 1.1]
//
// Typical range ≈ −30 to +25 once dailyStress is calibrated. State thresholds
// (see stateFor below) bucket this into absorb / neutral / deplete / warning.
export function dcy(dateStr) {
  const date = dateStr || localDate();
  const F = fitnessStock(date);
  const G = fatigueStock(date);
  const stressToday = dailyStress(date);
  const N = fuelAdequacy(date);
  const R = recoveryCoef(date);
  const rBreak = recoveryBreakdown(date);
  const fBreak = fuelBreakdown(date);

  // ── Real composition ──
  const rawValue = F * N - G * (1.1 - R);
  const value = +rawValue.toFixed(2);

  // ── Limiting factor ──
  const { factor, message } = classifyLimitingFactor({
    F, G, N, R, fBrk: fBreak, rBrk: rBreak,
  });

  // ── Legacy diagnostic (kept temporarily for side-by-side comparison) ──
  const legacy = computeDailyScore(date) || {};
  const legacyScore = typeof legacy.score === 'number' ? legacy.score : 0;
  const legacyMapped = legacyToDcy(legacyScore);

  return {
    date,
    dcy: value,
    state: stateFor(value),
    F, G, N, R,
    contributions: {
      // What the F·N − G·(1.1−R) formula evaluates to in each term.
      fitness: +(F * N).toFixed(2),
      fatigue: +(G * (1.1 - R)).toFixed(2),
      // Drags vs the best case (N=1, R=1.1) — useful for explainers.
      fuelDrag: +(F * Math.max(0, 1 - N)).toFixed(2),
      recoveryDrag: +(G * Math.max(0, 1.1 - R)).toFixed(2),
    },
    sources: {
      hrv: rBreak.hrv,
      rhr: rBreak.rhr,
      sleep: rBreak.sleep,
      sleepLatest: rBreak.sleepLatest,
      nutritionIntake: {
        bmr: fBreak.bmr,
        bmrTier: fBreak.bmrTier,
        bmrInputs: fBreak.bmrInputs,
        tdee: fBreak.tdee,
        tdeeTier: fBreak.tdeeTier,
        tdeeInputs: fBreak.tdeeInputs,
        activityBurn: fBreak.activityBurn,
        tef: fBreak.tef,
        intake: fBreak.intake,
        live:   fBreak.live,              // pre-forecast raw totals
        targets: fBreak.targets,
        sub: fBreak.sub,
        // Phase 4b forecast metadata — UI shows "Projected" badge when 'projected'
        forecastMode:    fBreak.forecastMode,
        forecastAlpha:   fBreak.forecastAlpha,
        forecastElapsed: fBreak.forecastElapsed,
        baselineDays:    fBreak.baselineDays,
      },
      stressToday,
    },
    limitingFactor: factor,
    limitingMessage: message,
    _legacy: {
      score: legacyScore,
      mapped: legacyMapped,
      source: 'computeDailyScore',
    },
  };
}

// Weekly DCY — mean of the 7 daily DCY values across Mon–Sun of the week
// containing `refDate` (R1 per DCY_SPEC §6). Days in the future are skipped;
// days with no data still compute but fall back to F·1 − G·0.1 via pre-signal
// defaults, which is the correct "assume normal" posture.
export function dcyWeekly(refDate) {
  const ref = refDate || localDate();
  const weekStart = startOfWeek(ref);
  const today = localDate();

  const days = weekDays(ref).map((d) => {
    // Don't reach into the future — weeks that span past "today" leave those
    // days as null so they can be rendered as placeholders.
    if (d > today) return { date: d, dcy: null };
    const daily = dcy(d);
    return { date: d, dcy: daily.dcy, state: daily.state };
  });

  const realValues = days.map((d) => d.dcy).filter((v) => v != null && !isNaN(v));
  const mean = realValues.length
    ? realValues.reduce((s, v) => s + v, 0) / realValues.length
    : 0;
  const value = +mean.toFixed(2);

  // Kept for diagnostic alongside the new value during rollout.
  const legacy = computeRolling7d(ref) || {};
  const legacyScore = typeof legacy.score === 'number' ? legacy.score : 0;

  return {
    date: ref,
    weekStart,
    dcy: value,
    state: stateFor(value),
    days,
    _legacy: {
      score: legacyScore,
      mapped: legacyToDcy(legacyScore),
      source: 'computeRolling7d',
    },
  };
}

// ─── Display helpers (DCY_SPEC §6) ──────────────────────────────────────────
export function stateFor(value) {
  if (value == null || isNaN(value)) return 'neutral';
  if (value <= -20) return 'warning';
  if (value <= -10) return 'depleting-strong';
  if (value <= -3) return 'depleting';
  if (value < 3) return 'neutral';
  if (value < 10) return 'absorbing';
  return 'absorbing-strong';
}

export function glyphFor(value) {
  switch (stateFor(value)) {
    case 'absorbing-strong': return '↑↑';
    case 'absorbing':        return '↑';
    case 'neutral':          return '·';
    case 'depleting':        return '↓';
    case 'depleting-strong': return '↓↓';
    case 'warning':          return '✕';
    default:                 return '·';
  }
}

export function formatDcy(value) {
  if (value == null || isNaN(value)) return '— ·';
  const n = Math.round(value);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}${Math.abs(n)} ${glyphFor(value)}`;
}
