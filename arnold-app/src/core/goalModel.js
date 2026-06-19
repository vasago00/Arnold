// ─── Goal model (Phase 4r.intel.18 — Outcome-driven targets) ───────────────
//
// New paradigm: the ONLY thing the user sets is the outcome (target weight
// + target date + race calendar). Every tangible daily metric — calorie
// target, protein floor, training volume, sleep target — is DERIVED from
// the outcome goal and adapted in real time to recovery + body + sleep
// signals.
//
// Why this matters: under the old model the user pinned "1750 kcal/day"
// once at the start of a cut. Sleep crashed, recovery debt accumulated,
// load went up, RMR adapted down — but the target stayed 1750. The math
// drifted from reality, the scale stopped tracking, and the recommendation
// engine started arguing with itself ("FUEL: eat more" vs "GOAL: math is
// wrong"). Targets need to MOVE.
//
// This module owns the derivation. Layer 4 (synthesizer) reads
// getEffectiveTargets() to know what the user is being held accountable to
// today. Every UI surface that used to read profile.dailyCalorieTarget
// should migrate to here over time.
//
// Override policy: user can still pin any metric manually. Overrides
// always win, but the derived shadow value is preserved and surfaced
// alongside ("Pinned 1750 — derived would be 1830"). The user always
// knows where the system disagrees and why.
//
// Adaptive feedback (Layer 5): outcome ledger writes weekly snapshots of
// (derived target, actual outcome). Future work updates trust priors
// from the ledger so the derivation formulas converge to what works for
// this body. Scaffold-only here; no behavior change yet.

import {
  computeRMR,
  computeTDEE,
  recommendCalorieTarget,
  safeCutHeadroom,
  getCurrentBodyComp,
} from './energyBalance.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';
import { localDate, ymd } from './time.js';
import { classifyChronicRecoveryDebt } from './recoveryDebt.js';

const OVERRIDE_KEY = 'arnold:overrides:targets';
const LEDGER_KEY   = 'arnold:outcomeLedger:weekly';
const LEDGER_MAX   = 26; // keep last 26 weeks (~6 months) for adaptive priors

// ═══════════════════════════════════════════════════════════════════════════
// OUTCOME GOAL — the only thing the user actually sets
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the user's outcome goal. This is what they're optimizing FOR;
 * everything tangible (calories, macros, training) is derived from this.
 *
 * @returns {{
 *   targetWeightLbs: number|null,
 *   targetDate: string|null,     // YYYY-MM-DD
 *   weeksRemaining: number|null,
 *   currentWeightLbs: number|null,
 *   lbsToLose: number|null,      // positive = cut, negative = surplus
 *   requiredLossRatePerWeek: number|null,
 *   races: Array,
 * }}
 */
export function getOutcomeGoal() {
  const goals = getGoals() || {};
  const comp = (() => { try { return getCurrentBodyComp(); } catch { return null; } })();

  // Phase 4r.dataspine.7 — prefer v2 nested shape
  // (goals.body.weight.targetLbs / targetDate) with v1 flat-field
  // fallback (goals.targetWeight / targetWeightDate) during the
  // compat window. storage.get('goals') retains both shapes after
  // migrateGoalsV1ToV2 runs.
  const goalsRaw = storage.get('goals') || {};
  const v2Body = goalsRaw.body?.weight || null;
  const targetWeightLbs = v2Body?.targetLbs
                       || parseFloat(goals.targetWeight)
                       || null;
  const currentWeightLbs = comp?.weightLbs || null;
  const lbsToLose = (targetWeightLbs != null && currentWeightLbs != null)
    ? currentWeightLbs - targetWeightLbs
    : null;

  // Parse target date in any of: MM-DD-YYYY, MM/DD/YYYY, YYYY-MM-DD
  const targetDateRaw = v2Body?.targetDate || goals.targetWeightDate || '';
  let targetDate = null;
  let weeksRemaining = null;
  if (targetDateRaw) {
    let parsed = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(targetDateRaw)) {
      parsed = new Date(targetDateRaw + 'T12:00:00');
    } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(targetDateRaw)) {
      const [m, d, y] = targetDateRaw.split(/[-/]/).map(Number);
      parsed = new Date(y, m - 1, d, 12);
    }
    if (parsed && !isNaN(parsed)) {
      targetDate = parsed.toISOString().slice(0, 10);
      const daysUntil = Math.max(1, (parsed.getTime() - Date.now()) / 86400000);
      weeksRemaining = Math.round(daysUntil / 7 * 10) / 10;
    }
  }

  const requiredLossRatePerWeek = (lbsToLose != null && lbsToLose > 0 && weeksRemaining)
    ? Math.round((lbsToLose / weeksRemaining) * 100) / 100
    : null;

  const races = (() => {
    try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); }
    catch { return []; }
  })();

  return {
    targetWeightLbs,
    targetDate,
    weeksRemaining,
    currentWeightLbs,
    lbsToLose: lbsToLose != null ? Math.round(lbsToLose * 10) / 10 : null,
    requiredLossRatePerWeek,
    races,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// RACE-PROXIMITY MODIFIER — Phase 4r.dataspine.4
// ═══════════════════════════════════════════════════════════════════════════
//
// Reads the soonest A/B race and returns the eat-back fraction + flat
// kcal bonus to apply to today's calorie target. Implements the race-
// proximity boost table locked in DATAMODEL.md (2026-05-23):
//
//   Days to race | Window      | Eat-back | Flat bonus
//   ─────────────|─────────────|──────────|───────────
//   ≤ 1          | Race-day    | 1.00     | +300
//   2–7          | Race week   | 0.85     | +200
//   8–28         | Race prep   | 0.75     | 0
//   29–56        | Build       | 0.625    | 0
//   > 56 / none  | Base        | 0.50     | 0
//
// Per decision 2 (DATAMODEL.md): any race within 4 weeks is treated as
// effectively P1 regardless of user-set priority. User-set priority
// (A/B/C) becomes the tiebreaker when multiple races are in-window;
// C-priority races get HALF the boost.
//
// Race source: reads legacy `localStorage 'arnold:races'` for v1
// compat. Phase B Turn 4 will migrate to `goals.races` and this helper
// will switch to that source transparently.

function getRaceProximityModifier(refDate) {
  const today = refDate || localDate();
  let races = [];
  try {
    const raw = localStorage.getItem('arnold:races');
    races = raw ? JSON.parse(raw) : [];
  } catch {}
  if (!Array.isArray(races) || races.length === 0) {
    return { eatBackFraction: 0.50, flatBonus: 0, window: 'base', daysToRace: null, race: null };
  }
  // Find soonest future race (or today's race).
  const todayMs = new Date(today + 'T00:00:00').getTime();
  const upcoming = races
    .map(r => {
      if (!r?.date) return null;
      const raceMs = new Date(r.date + 'T00:00:00').getTime();
      const days = Math.round((raceMs - todayMs) / 86400000);
      return days >= 0 ? { ...r, _days: days } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a._days - b._days);
  if (upcoming.length === 0) {
    return { eatBackFraction: 0.50, flatBonus: 0, window: 'base', daysToRace: null, race: null };
  }
  const race = upcoming[0];
  const days = race._days;
  // Pick the table row.
  let window, eatBackFraction, flatBonus;
  if (days <= 1)        { window = 'race-day';   eatBackFraction = 1.00; flatBonus = 300; }
  else if (days <= 7)   { window = 'race-week';  eatBackFraction = 0.85; flatBonus = 200; }
  else if (days <= 28)  { window = 'race-prep';  eatBackFraction = 0.75; flatBonus = 0;   }
  else if (days <= 56)  { window = 'build';      eatBackFraction = 0.625; flatBonus = 0;  }
  else                  { window = 'base';       eatBackFraction = 0.50; flatBonus = 0;   }
  // C-priority races get half the boost above baseline.
  // Priority field may be undefined on legacy races; default to 'A'
  // since the legacy storage was for races the user manually added,
  // which usually means they care about them.
  const priority = (race.priority || 'A').toUpperCase();
  if (priority === 'C' && eatBackFraction > 0.50) {
    eatBackFraction = 0.50 + (eatBackFraction - 0.50) * 0.5;
    flatBonus = Math.round(flatBonus * 0.5);
  }
  return {
    eatBackFraction: +eatBackFraction.toFixed(3),
    flatBonus,
    window,
    daysToRace: days,
    race: { id: race.id || null, name: race.name || null, date: race.date, priority },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY CALORIE TARGET — derived
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive today's calorie target from outcome goal + empirical TDEE +
 * recovery + training load. Replaces the static profile.dailyCalorieTarget.
 *
 * Composition:
 *   base = empirical TDEE − deficit_needed_to_hit_outcome
 *   modulated by:
 *     recovery_modifier   (if recovery debt elevated, raise target — body needs fuel)
 *     training_modifier   (today's eat-back, corrected for burn inflation)
 *     phase_floor         (never below RMR; cap aggressive deficits)
 *
 * Returns the full derivation so callers can show the user WHY the
 * target moved, not just the number.
 */
export function deriveDailyCalorieTarget(opts = {}) {
  const today = opts.date || localDate();
  const outcome = getOutcomeGoal();
  let rec = null,   headroom = null, rmr = null, tdee = null;
  try { rec      = recommendCalorieTarget(); }    catch {}
  try { headroom = safeCutHeadroom(); }           catch {}
  try { rmr      = computeRMR()?.rmr; }           catch {}
  try { tdee     = computeTDEE(today); }          catch {}

  // ── Base target ─────────────────────────────────────────────────────────
  // Start from empirical TDEE when we trust it; fall back to model
  // otherwise. Subtract a deficit sized to hit the outcome.
  // Phase 4r.energy.7 — model fallback uses restingTdee (no workouts); eat-back adds
  // them once below. Old tdee.tdee included activityKcal AND eat-back re-added it.
  const tdeeBase = rec?.tdeeEmpirical
                ?? rec?.tdeeCurrent
                ?? tdee?.restingTdee
                ?? 2000;

  // Deficit needed for the user's actual goal pace, not a generic 0.7 lb/wk.
  // If outcome goal isn't set, fall back to 0.5 lb/wk default.
  const lossRate = outcome.requiredLossRatePerWeek
                ?? rec?.lossRatePerWeek
                ?? 0.5;
  // Cap the deficit lever — never more than 1.0 lb/wk derived (35% of TDEE
  // worst case). If the outcome demands more, the system flags it as
  // 'goal-aggressive' and recommends extending the date instead of cutting
  // unsafely.
  const cappedLossRate = Math.min(1.0, Math.max(0, lossRate));
  const dailyDeficit = (cappedLossRate * 3500) / 7; // kcal/day

  let baseTarget = tdeeBase - dailyDeficit;

  // ── Recovery modifier ──────────────────────────────────────────────────
  // Phase 4r.dataspine.1 — uses the canonical classifyChronicRecoveryDebt
  // from recoveryDebt.js. Was an inline computeRecoveryLoad that diverged
  // from intelligence.js's version. See POSTMORTEMS.md TBD for the bug
  // class this consolidation eliminates.
  const sleep = storage.get('sleep') || [];
  const hrv   = storage.get('hrv')   || [];
  const recovery = classifyChronicRecoveryDebt({ sleep, hrv });
  let recoveryAdj = 0;
  if (recovery.debt >= 3)      recoveryAdj = 200;
  else if (recovery.debt >= 2) recoveryAdj = 100;
  else if (recovery.debt >= 1) recoveryAdj = 50;

  // ── Training modifier (eat-back) ──────────────────────────────────────
  // Honor today's session calories, but CORRECT for burn inflation when
  // empirical math suggests Garmin/model over-credits. A 599 kcal Garmin
  // session at burn-factor 0.7 contributes 419 kcal of eat-back, not 599.
  const reportedBurn = Math.round(tdee?.activityKcal || 0);
  const burnFactor = (rec?.tdeeEmpirical && rec?.tdeeModel && rec.tdeeModel > 0)
    ? Math.max(0.4, Math.min(1.0, rec.tdeeEmpirical / rec.tdeeModel))
    : 1.0;
  const correctedBurn = Math.round(reportedBurn * burnFactor);
  // Phase 4r.dataspine.4 — eat-back fraction now scales with race
  // proximity. Base of 0.5 (conservative deficit preservation); 0.75
  // during race prep (8–28 days out); up to 1.0 on race day. Plus
  // a flat bonus for race week / race day (carb loading + glycogen).
  // See DATAMODEL.md race-proximity boost table.
  const racePrep = getRaceProximityModifier(today);
  const eatBack = Math.round(correctedBurn * racePrep.eatBackFraction);

  // ── Composition ────────────────────────────────────────────────────────
  let derived = Math.round(baseTarget + recoveryAdj + eatBack + racePrep.flatBonus);

  // ── Phase floor ────────────────────────────────────────────────────────
  // NEVER below RMR. If recovery debt is high, lift floor higher.
  const effectiveFloor = (rmr || 1500) + (recovery.debt >= 2 ? 100 : 0);
  let floored = false;
  if (derived < effectiveFloor) {
    derived = effectiveFloor;
    floored = true;
  }

  return {
    derived,
    components: {
      tdeeBase: Math.round(tdeeBase),
      dailyDeficit: Math.round(dailyDeficit),
      recoveryAdj,
      eatBack,
      correctedBurn,
      reportedBurn,
      burnFactor: Math.round(burnFactor * 100) / 100,
      // Phase 4r.dataspine.4 — race-proximity contributions
      racePrepFraction: racePrep.eatBackFraction,
      racePrepFlatBonus: racePrep.flatBonus,
      racePrepWindow: racePrep.window,
      racePrepDaysToRace: racePrep.daysToRace,
      racePrepRaceName: racePrep.race?.name || null,
    },
    floor: effectiveFloor,
    flooredAtRmr: floored,
    lossRateUsed: cappedLossRate,
    goalAggressive: lossRate > 1.0,
    recoveryDebt: recovery.debt,
    asOf: today,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY PROTEIN FLOOR — derived
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Derive today's protein floor from LBM + deficit severity + training load.
 *
 *   base       = 0.8 g/lb of TARGET weight (LBM-protecting floor)
 *   cut_bonus  = +0.1 g/lb when in active deficit (extra LBM protection)
 *   load_bonus = +20g per 500 kcal of corrected training burn
 *
 * Returns components so the UI can explain WHY the floor moved on a hard
 * training day.
 */
export function deriveDailyProteinFloor(opts = {}) {
  const today = opts.date || localDate();
  const outcome = getOutcomeGoal();
  const goals = getGoals() || {};
  let rec = null, tdee = null;
  try { rec  = recommendCalorieTarget(); } catch {}
  try { tdee = computeTDEE(today); }       catch {}

  const targetWeight = outcome.targetWeightLbs
                    ?? outcome.currentWeightLbs
                    ?? parseFloat(goals.targetWeight)
                    ?? 170;

  // Base: 0.8 g/lb of target weight — LBM-protecting floor for an active
  // adult. Athletes in deficit often need more.
  const base = Math.round(targetWeight * 0.8);

  // Cut bonus: +0.1 g/lb when actively cutting. Protects lean mass during
  // a sustained deficit; the harder/longer the cut, the more protein
  // matters.
  const inDeficit = (outcome.lbsToLose || 0) > 0.5;
  const cutBonus = inDeficit ? Math.round(targetWeight * 0.1) : 0;

  // Load bonus: extra protein when today's session was substantial.
  // Use corrected burn so we don't pile on protein for Garmin's inflation.
  const reportedBurn = Math.round(tdee?.activityKcal || 0);
  const burnFactor = (rec?.tdeeEmpirical && rec?.tdeeModel && rec.tdeeModel > 0)
    ? Math.max(0.4, Math.min(1.0, rec.tdeeEmpirical / rec.tdeeModel))
    : 1.0;
  const correctedBurn = Math.round(reportedBurn * burnFactor);
  // 20g per 500 kcal of corrected burn, capped at 40g extra.
  const loadBonus = Math.min(40, Math.round((correctedBurn / 500) * 20));

  const derived = base + cutBonus + loadBonus;

  return {
    derived,
    components: { base, cutBonus, loadBonus, correctedBurn, reportedBurn },
    targetWeightLbs: targetWeight,
    inDeficit,
    asOf: today,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DAILY CARBS / FAT / FIBER — derived (Phase 4r.dataspine.4)
// ═══════════════════════════════════════════════════════════════════════════
//
// Macro split derived from the calorie + protein targets so consumers
// don't read the legacy goals.dailyCarbTarget / dailyFatTarget /
// dailyFiberTarget fields. Outcome-only goals model: the user doesn't
// set macro grams, the system derives them from kcal + protein floor.
//
// Method (deficit-friendly defaults; identical to evidence-based cut
// guidance most coaches use):
//   1. Protein is fixed by deriveDailyProteinFloor (floor that
//      protects LBM through the cut). Already in kcal/g terms.
//   2. Fat target = 27% of total kcal. Range 25-30% is what hormonal
//      health needs through a cut; 27% sits in the middle and lets
//      carbs be the primary lever for energy. Floor at 0.3 g/lb of
//      target weight if 27% would be lower (essential-fat hard floor).
//   3. Carbs absorb the remainder: kcal_remaining / 4.
//   4. Fiber target = 14g per 1000 kcal (FDA/Health Canada standard).
//
// When the calorie target shifts (eat-back, recovery modifier, race
// proximity), carbs absorb the swing — protein floor and fat ratio
// stay sticky. This matches the legacy carbs-only mode semantics that
// coachingPrompts.js was already documenting as the preferred behavior.
export function deriveDailyMacros(opts = {}) {
  const today = opts.date || localDate();
  const cal = opts.calories ?? deriveDailyCalorieTarget({ date: today }).derived;
  const pro = opts.proteinG ?? deriveDailyProteinFloor({ date: today }).derived;
  const targetWeight = (() => {
    try {
      const o = getOutcomeGoal();
      return o.targetWeightLbs ?? o.currentWeightLbs ?? 170;
    } catch { return 170; }
  })();

  // Hormonal-health fat floor: 0.3 g/lb of target weight (≈51g at
  // 170 lb). Caps the "lower fat to free up carbs" temptation.
  const fatFloorG = Math.round(targetWeight * 0.3);

  // Default split: 27% of kcal from fat.
  const fatFromRatio = Math.round((cal * 0.27) / 9);
  const fatG = Math.max(fatFloorG, fatFromRatio);

  // Carbs absorb the remainder. Floor at 50g — below that you're in
  // ketogenic territory which needs different macro logic entirely.
  const proKcal = pro * 4;
  const fatKcal = fatG * 9;
  const carbsKcalRaw = cal - proKcal - fatKcal;
  const carbsG = Math.max(50, Math.round(carbsKcalRaw / 4));

  // Fiber: 14g per 1000 kcal.
  const fiberG = Math.round((cal / 1000) * 14);

  return {
    proteinG: pro,
    carbsG,
    fatG,
    fiberG,
    components: {
      caloriesUsed: cal,
      proteinKcal: proKcal,
      fatKcal,
      fatFloorG,
      fatFromRatio,
      carbsKcalRaw,
    },
    asOf: today,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// OVERRIDE SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Read the user's current overrides. Each entry may carry an `expires`
 * date for one-off overrides ("just today / this week"); expired entries
 * are filtered out on read.
 */
export function getOverrides() {
  const raw = storage.get(OVERRIDE_KEY) || {};
  const today = localDate();
  const out = {};
  for (const k of Object.keys(raw)) {
    const o = raw[k];
    if (!o) continue;
    if (o.expires && o.expires < today) continue;
    out[k] = o;
  }
  return out;
}

/**
 * Pin a metric to a user-chosen value. Overrides always win over
 * derivations. Pass expires=YYYY-MM-DD for a one-off override that auto-
 * clears, or null for an indefinite pin.
 *
 *   setOverride('dailyCalories', 1750)             // indefinite
 *   setOverride('dailyCalories', 1750, '2026-05-22') // today only
 */
export function setOverride(metric, value, expires = null) {
  const current = storage.get(OVERRIDE_KEY) || {};
  current[metric] = {
    value,
    setOn: localDate(),
    expires: expires || null,
  };
  storage.set(OVERRIDE_KEY, current);
  return current[metric];
}

/** Remove a pinned override; derivation takes back over. */
export function clearOverride(metric) {
  const current = storage.get(OVERRIDE_KEY) || {};
  delete current[metric];
  storage.set(OVERRIDE_KEY, current);
}

// ═══════════════════════════════════════════════════════════════════════════
// EFFECTIVE TARGETS — derived + overrides
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The canonical "what is the user accountable to today" object. Every UI
 * surface that used to read profile.dailyCalorieTarget should migrate to
 * this. Each entry exposes:
 *   - effective: the number the UI compares intake against
 *   - derived:   what the model would say absent any override
 *   - override:  null when not pinned, else { value, setOn, expires }
 *   - source:    'derived' | 'override'
 *   - explain:   component breakdown (for the user's "why" view)
 */
export function getEffectiveTargets(opts = {}) {
  const today = opts.date || localDate();
  const overrides = getOverrides();
  const cal = deriveDailyCalorieTarget({ date: today });
  const pro = deriveDailyProteinFloor({ date: today });

  const calOv = overrides.dailyCalories;
  const proOv = overrides.dailyProtein;

  const calEff = calOv ? calOv.value : cal.derived;
  const proEff = proOv ? proOv.value : pro.derived;

  // Phase 4r.dataspine.4 — macros derived from effective kcal +
  // effective protein so overrides (pinned calorie/protein targets)
  // propagate through carbs/fat/fiber consistently. Was: legacy
  // getDynamicMacroTarget read goals.dailyCarbTarget /
  // dailyFatTarget directly, which broke down once the outcome-only
  // Goals UI stopped writing those fields.
  const macros = deriveDailyMacros({ date: today, calories: calEff, proteinG: proEff });

  return {
    dailyCalories: {
      effective: calEff,
      derived: cal.derived,
      override: calOv || null,
      source: calOv ? 'override' : 'derived',
      explain: cal,
    },
    dailyProtein: {
      effective: proEff,
      derived: pro.derived,
      override: proOv || null,
      source: proOv ? 'override' : 'derived',
      explain: pro,
    },
    // Phase 4r.dataspine.4 — derived macros (no override system for
    // these yet; the override on dailyCalories cascades through).
    dailyCarbs:  { effective: macros.carbsG,  derived: macros.carbsG,  override: null, source: 'derived', explain: macros },
    dailyFat:    { effective: macros.fatG,    derived: macros.fatG,    override: null, source: 'derived', explain: macros },
    dailyFiber:  { effective: macros.fiberG,  derived: macros.fiberG,  override: null, source: 'derived', explain: macros },
    asOf: today,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// (Phase 4r.dataspine.1) — inline computeRecoveryLoad removed. Use
// classifyChronicRecoveryDebt from ./recoveryDebt.js. See AUDIT.md
// Batch 3 for the migration rationale.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// OUTCOME LEDGER (Layer 5 scaffold — storage only, no behavior change yet)
// ═══════════════════════════════════════════════════════════════════════════
//
// Weekly snapshots of (predicted, actual) outcomes. The data shape here is
// what Layer 5's Bayesian trust updates will consume; for now we just
// write and read. No derivation formula consults the ledger yet.

/** Read the ledger (oldest → newest). */
export function readOutcomeLedger() {
  const raw = storage.get(LEDGER_KEY);
  return Array.isArray(raw) ? raw : [];
}

/**
 * Append a weekly snapshot. Idempotent on weekEnding — if a row already
 * exists for that week, it's replaced (so repeated calls during the same
 * week converge to the latest numbers).
 *
 * Caller decides when to call this; typical place: Sunday end-of-week
 * roll-up, or whenever Garmin sync completes for the most-recent week.
 */
export function appendOutcomeLedger(snapshot) {
  if (!snapshot || !snapshot.weekEnding) return;
  const arr = readOutcomeLedger().filter(r => r.weekEnding !== snapshot.weekEnding);
  arr.push(snapshot);
  // Keep newest LEDGER_MAX rows
  arr.sort((a, b) => (a.weekEnding || '').localeCompare(b.weekEnding || ''));
  while (arr.length > LEDGER_MAX) arr.shift();
  storage.set(LEDGER_KEY, arr);
}

/**
 * Build a snapshot from current data for the week ending on `dateStr`.
 * Pure read — caller decides whether to persist via appendOutcomeLedger.
 */
export function buildOutcomeSnapshot(dateStr) {
  const today = dateStr || localDate();
  // Compute Sunday of the week containing `today`
  const d = new Date(today + 'T12:00:00');
  const dow = d.getDay(); // 0=Sun..6=Sat
  const sunOffset = (7 - dow) % 7;
  d.setDate(d.getDate() + sunOffset);
  const weekEnding = ymd(d);

  // 7-day window ending at weekEnding
  const start = new Date(weekEnding + 'T12:00:00');
  start.setDate(start.getDate() - 6);

  // Pull weights in window
  const weights = (storage.get('weight') || [])
    .filter(w => w?.date && w.date >= ymd(start) && w.date <= weekEnding)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const actualLossLbs = (weights.length >= 2)
    ? Math.round((weights[0].weightLbs - weights[weights.length - 1].weightLbs) * 100) / 100
    : null;

  // Predicted loss from the goal model at the start of the week
  const outcome = getOutcomeGoal();
  const predictedLossLbs = outcome.requiredLossRatePerWeek != null
    ? Math.round(outcome.requiredLossRatePerWeek * 100) / 100
    : null;

  // Avg intake / burn / sleep / recovery in the window
  let intakeSum = 0, intakeDays = 0;
  let burnSum = 0,   burnDays = 0;
  let sleepSum = 0,  sleepDays = 0;
  let debtSum = 0,   debtDays = 0;
  const sleep = storage.get('sleep') || [];
  const hrv   = storage.get('hrv') || [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i);
    const ds = ymd(day);
    // Read intake from nutritionLog full-day entries (synchronous).
    // Avoids importing dailyTotals() dynamically inside a non-async fn.
    const nutLog = storage.get('nutritionLog') || [];
    const fullDay = nutLog
      .filter(e => e?.date === ds && e?.meal === 'full-day')
      .sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''))[0];
    const kcal = Number(fullDay?.calories) || Number(fullDay?.extended?.calories) || 0;
    if (kcal > 0) { intakeSum += kcal; intakeDays++; }

    // Sleep
    const sleepRow = sleep.find(s => s?.date === ds);
    if (sleepRow?.durationMinutes) {
      sleepSum += sleepRow.durationMinutes / 60;
      sleepDays++;
    }
    // Recovery debt for this day
    const recentSleep = sleep
      .filter(s => s?.date && s.date <= ds)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 3);
    let debt = 0;
    for (const s of recentSleep) {
      const h = (Number(s.durationMinutes) || 0) / 60;
      if (h > 0 && h < 6) debt += 1;
    }
    debtSum += debt; debtDays++;
  }

  return {
    weekEnding,
    predictedLossLbs,
    actualLossLbs,
    intakeAvg:        intakeDays ? Math.round(intakeSum / intakeDays) : null,
    sleepAvgHrs:      sleepDays ? Math.round((sleepSum / sleepDays) * 10) / 10 : null,
    recoveryDebtAvg:  debtDays ? Math.round((debtSum / debtDays) * 10) / 10 : null,
    // Trust scores snapshot at week close (Layer 5 will compare predicted
    // vs actual to update these over time)
    trustGarminBurn:  null, // filled in by Layer 5 update job
    trustIntakeLog:   null,
    trustRmrModel:    null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG
// ═══════════════════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-undef
  window.goalModelDebug = function goalModelDebug() {
    const out = getOutcomeGoal();
    const targets = getEffectiveTargets();
    const cal = targets.dailyCalories;
    const pro = targets.dailyProtein;
    console.log('%c=== GOAL MODEL DEBUG ===', 'background:#3a1f3f;color:#e0c0e0;padding:2px 6px;font-weight:700');
    console.log('%cOutcome goal:', 'color:#9ece6a;font-weight:700', out);
    console.log('%cCalories — effective ' + cal.effective + ' (' + cal.source + ')',
      'color:#e0af68;font-weight:700');
    console.log('  derived:', cal.derived);
    if (cal.override) console.log('  OVERRIDE:', cal.override);
    console.log('  components:', cal.explain.components);
    console.log('  floor:', cal.explain.floor, '· flooredAtRmr:', cal.explain.flooredAtRmr);
    console.log('%cProtein — effective ' + pro.effective + 'g (' + pro.source + ')',
      'color:#e0af68;font-weight:700');
    console.log('  derived:', pro.derived);
    if (pro.override) console.log('  OVERRIDE:', pro.override);
    console.log('  components:', pro.explain.components);
    console.log('%cOverrides currently set:', 'color:#7dcfff;font-weight:700', getOverrides());
    console.log('%cOutcome ledger (last 5):', 'color:#7dcfff;font-weight:700',
      readOutcomeLedger().slice(-5));
    return { outcome: out, targets, overrides: getOverrides(), ledger: readOutcomeLedger() };
  };
}

// ── Console diagnostic: how today's calorie target is assembled ──────────────
// Run `window.calorieTargetDebug()` (or pass a 'YYYY-MM-DD') in the app's
// devtools. Prints a top-to-bottom breakdown so the target is auditable:
// tdeeBase (resting TDEE = RMR + steps-NEAT + TEF, or empirical) − cut deficit
// + recovery adj + workout eat-back + race bonus, with the RMR floor shown.
if (typeof window !== 'undefined') {
  window.calorieTargetDebug = function calorieTargetDebug(date) {
    const r = deriveDailyCalorieTarget(date ? { date } : {});
    const c = r.components || {};
    let rmrOnly = null;
    try { rmrOnly = computeRMR()?.rmr; } catch {}
    console.log(`%cCalorie target — ${r.asOf}`, 'font-weight:bold;font-size:13px');
    console.table([
      { component: 'tdeeBase (resting TDEE / empirical)', kcal: c.tdeeBase },
      { component: 'cut deficit', kcal: c.dailyDeficit != null ? -c.dailyDeficit : 0 },
      { component: 'recovery adj', kcal: c.recoveryAdj },
      { component: `eat-back (burn ${c.reportedBurn}→${c.correctedBurn} ×${c.burnFactor}, frac ${c.racePrepFraction})`, kcal: c.eatBack },
      { component: 'race flat bonus', kcal: c.racePrepFlatBonus },
      { component: '= TARGET', kcal: r.derived },
      { component: `RMR (resting only)`, kcal: rmrOnly },
      { component: `RMR floor (${r.flooredAtRmr ? 'APPLIED — target was below RMR' : 'not hit'})`, kcal: r.floor },
    ]);
    console.log(`loss rate used: ${r.lossRateUsed} lb/wk${r.goalAggressive ? '  ⚠ goal flagged aggressive' : ''}  ·  recovery debt: ${r.recoveryDebt}`);
    console.log('Full object:', r);
    return r;
  };
}
