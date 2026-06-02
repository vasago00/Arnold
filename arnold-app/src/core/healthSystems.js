// ─── ARNOLD Health Systems Engine ────────────────────────────────────────────
// Maps logged food + taken supplements to 10 body systems, each scored 0-100%
// against widely accepted reference ranges (RDA / AMDR / sports-nutrition norms).
//
// A "system" aggregates several weighted nutrient goals. Each nutrient reports
// what % of its target was met today (food + supplement taken). The system
// score is the weighted average, capped at 100.
//
// Flow:  Food totals  +  Supplement taken-today totals  →  nutrient map
//        → system scores → status (good / focus / deficient) + comment

import { getCatalog, getStack, getTodayTaken } from './supplements.js';
import { getEntriesForDate } from './nutrition.js';
import { storage } from './storage.js';
import { getAvgWeeklyTrainingHours } from './trainingStress.js';
import { getGoals } from './goals.js';
import { localDate, ymd } from './time.js';
import { parseLocalDate } from './dateUtils.js';
// Lazy import — computeUserState is only used by the debug helper and (later)
// the API wiring. Direct import here is safe: intelligence.js doesn't depend
// on healthSystems.js (verified — no circular import risk).
import { computeUserState as _v2ComputeUserState } from './intelligence.js';
import { isInFastingWindow as _isInFastingWindow, getIFProfile as _getIFProfile } from './intermittentFasting.js';

// ─── HS Scoring v2 feature flag ─────────────────────────────────────────────
// FLIPPED ON 2026-05-29 after task #205 sign-off. To roll back, flip to false.
// See docs/HEALTH_SYSTEM_SCORING_V2.md (Tuning log) for the rationale.
const USE_V2_HS_SCORING = true;

// ─── Dynamic Optimal Daily Targets ──────────────────────────────────────────
// Replaces the old static RDA table. Targets auto-calibrate based on:
//   1. Body weight (kg) — many nutrients scale per-kg
//   2. Training load — recent 7-day activity hours/intensity
//   3. Age — absorption efficiency declines, needs increase
//   4. Goals — longevity vs performance emphasis
//
// Base values come from sports-nutrition / functional-medicine literature for
// active adults. Each nutrient has: base (amount), perKg (optional per-kg add),
// trainingMult (multiplier per weekly training hour), ageMult (per decade > 30).

const NUTRIENT_MODELS = {
  // ── Macros ──
  calories:   { base: 2000, perKg: 6,   trainingAdd: 80,  ageAdd: 0 },
  protein:    { base: 60,   perKg: 1.6, trainingAdd: 3,   ageAdd: 0 },   // g — 1.6g/kg for active, +3g per training hr
  carbs:      { base: 150,  perKg: 2.5, trainingAdd: 15,  ageAdd: 0 },   // g
  fat:        { base: 50,   perKg: 0.8, trainingAdd: 0,   ageAdd: 0 },   // g
  fiber:      { base: 30,   perKg: 0,   trainingAdd: 0,   ageAdd: 0 },   // g — flat

  // ── Vitamins ──
  'Vitamin A':      { base: 3000, perKg: 0, trainingAdd: 0,   ageAdd: 0 },    // IU
  'Vitamin C':      { base: 200,  perKg: 0, trainingAdd: 20,  ageAdd: 10 },   // mg — athletes: 200-1000mg
  'Vitamin D3 (cholecalciferol)': { base: 3000, perKg: 0, trainingAdd: 0, ageAdd: 500 }, // IU — functional: 3000-5000
  'Vitamin D':      { alias: 'Vitamin D3 (cholecalciferol)' },
  'Vitamin E':      { base: 30,   perKg: 0, trainingAdd: 5,   ageAdd: 0 },    // IU
  'Vitamin K':      { base: 120,  perKg: 0, trainingAdd: 0,   ageAdd: 10 },   // mcg
  'Thiamin (B1)':   { base: 1.5,  perKg: 0, trainingAdd: 0.2, ageAdd: 0 },    // mg
  'Riboflavin (B2)':{ base: 1.6,  perKg: 0, trainingAdd: 0.2, ageAdd: 0 },    // mg
  'Niacin (B3)':    { base: 18,   perKg: 0, trainingAdd: 1,   ageAdd: 0 },    // mg
  'Vitamin B6':     { base: 2.5,  perKg: 0, trainingAdd: 0.3, ageAdd: 0.2 },  // mg
  'Folate':         { base: 600,  perKg: 0, trainingAdd: 0,   ageAdd: 50 },   // mcg — functional: 600-800
  'Vitamin B12':    { base: 500,  perKg: 0, trainingAdd: 0,   ageAdd: 100 },  // mcg — functional: 500-1000 (absorption drops w/ age)
  'Vitamin B12 (methylcobalamin)': { alias: 'Vitamin B12' },
  'Biotin':         { base: 30,   perKg: 0, trainingAdd: 0,   ageAdd: 0 },    // mcg
  'Pantothenic acid': { base: 7,  perKg: 0, trainingAdd: 0,   ageAdd: 0 },    // mg

  // ── Minerals ──
  'Calcium':        { base: 800,  perKg: 3,   trainingAdd: 0,   ageAdd: 50 },  // mg
  'Iron':           { base: 12,   perKg: 0,   trainingAdd: 2,   ageAdd: 0 },   // mg — runners lose iron via foot-strike hemolysis
  'Magnesium':      { base: 200,  perKg: 4,   trainingAdd: 20,  ageAdd: 10 },  // mg — ~6mg/kg for athletes
  'Elemental Magnesium': { alias: 'Magnesium' },
  'Phosphorus':     { base: 700,  perKg: 0,   trainingAdd: 0,   ageAdd: 0 },   // mg
  'Potassium':      { base: 2500, perKg: 12,  trainingAdd: 100, ageAdd: 0 },   // mg — sweat losses
  'Sodium':         { base: 1500, perKg: 0,   trainingAdd: 200, ageAdd: 0 },   // mg — sweat losses
  'Zinc':           { base: 8,    perKg: 0.05,trainingAdd: 1,   ageAdd: 0.5 }, // mg
  'Copper':         { base: 0.9,  perKg: 0,   trainingAdd: 0,   ageAdd: 0 },   // mg
  'Manganese':      { base: 2.3,  perKg: 0,   trainingAdd: 0,   ageAdd: 0 },   // mg
  'Selenium':       { base: 70,   perKg: 0,   trainingAdd: 5,   ageAdd: 0 },   // mcg — functional: 70-200
  'Chromium':       { base: 35,   perKg: 0,   trainingAdd: 5,   ageAdd: 0 },   // mcg

  // ── Essential fats / bioactives ──
  'EPA':            { base: 750,  perKg: 0, trainingAdd: 50,  ageAdd: 50 },   // mg — anti-inflammatory
  'DHA':            { base: 750,  perKg: 0, trainingAdd: 50,  ageAdd: 50 },   // mg
  'Fish Oil (total)': { base: 2000, perKg: 0, trainingAdd: 0, ageAdd: 0 },    // mg

  // ── Longevity / sports bioactives — functional dose targets ──
  'NMN (Nicotinamide Mononucleotide)': { base: 500,  perKg: 0, trainingAdd: 0, ageAdd: 100 },
  'Trans-Resveratrol': { base: 500, perKg: 0, trainingAdd: 0, ageAdd: 0 },
  'Spermidine (wheat germ extract)': { base: 10, perKg: 0, trainingAdd: 0, ageAdd: 0 },
  'Quercetin':      { base: 500,  perKg: 0, trainingAdd: 0,   ageAdd: 0 },
  'Fisetin':        { base: 500,  perKg: 0, trainingAdd: 0,   ageAdd: 0 },
  'Turmeric (curcumin extract)': { base: 200, perKg: 0, trainingAdd: 50, ageAdd: 0 },
  'Beetroot powder concentrate': { base: 500, perKg: 0, trainingAdd: 100, ageAdd: 0 },
  'Ashwagandha (KSM-66)': { base: 600, perKg: 0, trainingAdd: 0, ageAdd: 0 },
  'Magnesium L-Threonate (Magtein)': { base: 2000, perKg: 0, trainingAdd: 0, ageAdd: 0 },
  'Apigenin':       { base: 50,   perKg: 0, trainingAdd: 0,   ageAdd: 0 },
  'Trimethylglycine (TMG/Betaine anhydrous)': { base: 1000, perKg: 0, trainingAdd: 0, ageAdd: 0 },
  'Shilajit resin': { base: 300,  perKg: 0, trainingAdd: 0,   ageAdd: 0 },
  'Creatine':       { base: 5000, perKg: 0, trainingAdd: 0,   ageAdd: 0 },   // mg (5g)
};

// Cache so we don't recompute every render
let _targetCache = null;
let _targetCacheKey = '';

/**
 * Compute personalized daily targets from profile, goals, and recent activity.
 * @param {string} [dateStr] — optional, used to pull recent 7-day training load
 * @returns {Object} nutrient name → target amount
 */
export function getOptimalTargets(dateStr) {
  const profile = storage.get('profile') || {};
  const goals   = storage.get('goals')   || {};

  // ── Weight (kg) ──
  const weightLbs = parseFloat(profile.weight) || parseFloat(goals.targetWeight) || 175;
  const weightKg  = weightLbs * 0.4536;

  // ── Age (decades above 30) ──
  let age = 0;
  if (profile.birthDate) {
    const bd = new Date(profile.birthDate);
    if (!isNaN(bd)) age = Math.max(0, (new Date().getFullYear() - bd.getFullYear()));
  } else if (profile.age) {
    age = parseInt(profile.age) || 0;
  }
  const decadesOver30 = Math.max(0, (age - 30) / 10);

  // ── Average weekly training hours ──
  // Use the canonical helper from trainingStress.js, which:
  //   • Merges activities + dailyLogs.fitActivities the SAME way computeDailyScore does
  //   • Filters health_connect ghost rows (legacy double-counting source)
  //   • Averages over a 4-week window — stable enough to avoid the single-week
  //     noise that produced unrealistic carb targets (529g) when one heavy
  //     week landed inside the rolling 7-day window
  const refDate = dateStr || localDate();
  const { hoursPerWeek: weeklyTrainingHrs } = getAvgWeeklyTrainingHours(4, refDate);

  // ── User-configured goals (canonical source for macros) ──
  // The Goals UI lets the user set:
  //   • dailyCalorieTarget — total kcal/day (1750 cut, 2200 maintenance, etc)
  //   • proteinPct / carbPct / fatPct — split (default 30/40/30)
  //   • dailyFiberTarget, dailyWaterTarget — explicit
  // getGoals() derives gram targets from those (kcal × pct ÷ kcal_per_gram).
  // We respect the user's explicit goal — model-driven macro targets ignore
  // the calorie ceiling and routinely overshoot it (e.g. 419g carbs alone =
  // 1676 kcal, which leaves no room for protein/fat in a 1750-kcal day).
  const goalsObj = getGoals();
  const goalCalories = parseFloat(goalsObj.dailyCalorieTarget) || 0;
  const goalProtein  = parseFloat(goalsObj.dailyProteinTarget) || 0;
  const goalCarbs    = parseFloat(goalsObj.dailyCarbTarget) || 0;
  const goalFat      = parseFloat(goalsObj.dailyFatTarget) || 0;
  const goalFiber    = parseFloat(goalsObj.dailyFiberTarget) || 0;

  // Cache key to avoid recomputing on every call within the same render cycle
  const cacheKey = `${weightKg.toFixed(1)}|${age}|${weeklyTrainingHrs.toFixed(1)}|${goalCalories}|${goalProtein}|${goalCarbs}|${goalFat}|${goalFiber}`;
  if (_targetCache && _targetCacheKey === cacheKey) return _targetCache;

  // ── Build target map ──
  const targets = {};
  for (const [name, model] of Object.entries(NUTRIENT_MODELS)) {
    if (model.alias) {
      // Will resolve after the loop
      continue;
    }
    let val = model.base;
    val += (model.perKg || 0) * weightKg;
    val += (model.trainingAdd || 0) * weeklyTrainingHrs;
    val += (model.ageAdd || 0) * decadesOver30;
    targets[name] = Math.round(val * 10) / 10;
  }
  // Resolve aliases
  for (const [name, model] of Object.entries(NUTRIENT_MODELS)) {
    if (model.alias) targets[name] = targets[model.alias] || 100;
  }

  // ── Override macros with user-configured goal-derived targets ──
  // SYSTEMS weights reference these exact keys (lowercase): calories, protein,
  // carbs, fat, fiber. The user's calorie split is the authoritative source.
  if (goalCalories > 0) targets.calories = goalCalories;
  if (goalProtein  > 0) targets.protein  = goalProtein;
  if (goalCarbs    > 0) targets.carbs    = goalCarbs;
  if (goalFat      > 0) targets.fat      = goalFat;
  if (goalFiber    > 0) targets.fiber    = goalFiber;

  _targetCache = targets;
  _targetCacheKey = cacheKey;
  return targets;
}

// Backward-compat alias — some code may still reference `RDA`
export const RDA = new Proxy({}, {
  get(_, prop) {
    const t = getOptimalTargets();
    return t[prop];
  },
  has(_, prop) {
    return prop in getOptimalTargets();
  },
});

// ─── Typical contribution of common foods to each nutrient ───────────────────
// This powers the food side. We don't have a nutrient database in the client,
// so we derive nutrient estimates from macros + fiber (already tracked) and
// a lightweight heuristic based on food name keywords. Good enough for a
// directional "good / focus / deficient" call — exact values come from the
// Cronometer import when available.
//
// Keys are lowercase keyword fragments. Value is a partial nutrient map
// per 100 kcal of food (rough, additive across matches).
const FOOD_KEYWORD_NUTRIENTS = {
  salmon:       { EPA: 300, DHA: 300, 'Vitamin D': 200, 'Vitamin B12': 2, protein: 13, 'Potassium': 200 },
  tuna:         { EPA: 120, DHA: 180, 'Vitamin B12': 2, 'Selenium': 30, protein: 16 },
  fish:         { EPA: 120, DHA: 120, 'Vitamin D': 80, protein: 13 },
  egg:          { 'Vitamin D': 40, 'Vitamin B12': 0.5, 'Biotin': 10, protein: 6, 'Vitamin A': 150 },
  chicken:      { 'Niacin (B3)': 6, 'Vitamin B6': 0.3, 'Selenium': 16, protein: 20 },
  beef:         { 'Vitamin B12': 1.5, 'Iron': 2, 'Zinc': 4, 'Niacin (B3)': 4, protein: 15 },
  liver:        { 'Vitamin A': 3000, 'Vitamin B12': 25, 'Iron': 6, 'Folate': 120 },
  yogurt:       { 'Calcium': 180, 'Vitamin B12': 0.5, 'Probiotic': 1, protein: 6 },
  milk:         { 'Calcium': 200, 'Vitamin D': 80, 'Vitamin B12': 0.5, 'Potassium': 180 },
  cheese:       { 'Calcium': 180, 'Vitamin B12': 0.4, protein: 6, 'Phosphorus': 140 },
  kefir:        { 'Calcium': 180, 'Vitamin B12': 0.4, 'Probiotic': 1 },
  sauerkraut:   { 'Vitamin C': 15, 'Vitamin K': 25, 'Probiotic': 1, fiber: 3 },
  kimchi:       { 'Vitamin C': 15, 'Vitamin K': 30, 'Probiotic': 1, fiber: 3 },
  spinach:      { 'Vitamin K': 400, 'Folate': 150, 'Iron': 2, 'Magnesium': 80, 'Vitamin A': 800 },
  kale:         { 'Vitamin K': 500, 'Vitamin C': 90, 'Vitamin A': 700, 'Calcium': 100, fiber: 3 },
  broccoli:     { 'Vitamin C': 80, 'Vitamin K': 100, 'Folate': 60, fiber: 4 },
  avocado:      { 'Potassium': 500, fiber: 7, 'Folate': 80, 'Vitamin E': 2 },
  banana:       { 'Potassium': 400, 'Vitamin B6': 0.4, fiber: 3, carbs: 23 },
  berry:        { 'Vitamin C': 45, 'Quercetin': 40, fiber: 3 },
  berries:      { 'Vitamin C': 45, 'Quercetin': 40, 'Fisetin': 20, fiber: 3 },
  blueberry:    { 'Vitamin C': 35, 'Quercetin': 50, 'Fisetin': 20, fiber: 3 },
  strawberry:   { 'Vitamin C': 150, 'Fisetin': 40, fiber: 2 },
  orange:       { 'Vitamin C': 140, 'Folate': 40, fiber: 3 },
  apple:        { 'Quercetin': 20, fiber: 4, 'Vitamin C': 15 },
  nuts:         { 'Magnesium': 80, 'Vitamin E': 8, 'Selenium': 10, fiber: 4, fat: 14 },
  almond:       { 'Magnesium': 80, 'Vitamin E': 14, 'Calcium': 60, fiber: 3 },
  walnut:       { 'EPA': 50, 'DHA': 0, 'Magnesium': 60, 'Vitamin E': 2 },
  chia:         { 'EPA': 200, fiber: 10, 'Calcium': 60, 'Magnesium': 100 },
  flax:         { 'EPA': 250, fiber: 8, 'Magnesium': 80 },
  oat:          { fiber: 5, 'Magnesium': 60, 'Manganese': 1.5, 'Iron': 1.5 },
  oats:         { fiber: 5, 'Magnesium': 60, 'Manganese': 1.5, 'Iron': 1.5 },
  quinoa:       { fiber: 3, 'Magnesium': 80, 'Iron': 2, 'Folate': 50 },
  rice:         { 'Manganese': 1, 'Selenium': 12, fiber: 1 },
  bean:         { fiber: 6, 'Folate': 80, 'Iron': 2, 'Magnesium': 50, protein: 7 },
  beans:        { fiber: 6, 'Folate': 80, 'Iron': 2, 'Magnesium': 50, protein: 7 },
  lentil:       { fiber: 7, 'Folate': 150, 'Iron': 3, 'Magnesium': 40, protein: 9 },
  tofu:         { 'Calcium': 120, 'Iron': 2, 'Magnesium': 40, protein: 8 },
  turmeric:     { 'Turmeric (curcumin extract)': 30 },
  beet:         { 'Folate': 60, 'Potassium': 200, 'Beetroot powder concentrate': 50 },
  garlic:       { 'Manganese': 0.3, 'Vitamin B6': 0.2, 'Quercetin': 10 },
  tea:          { 'Quercetin': 40, 'Apigenin': 5 },
  coffee:       { 'Magnesium': 4, 'Niacin (B3)': 0.5 },
  chocolate:    { 'Magnesium': 50, 'Iron': 3, 'Manganese': 0.8 }, // dark
  water:        {},
};

// ─── Derive per-food nutrient estimates ─────────────────────────────────────
function estimateFoodNutrients(entries) {
  const out = {}; // { nutrientName: amount }
  const add = (k, v) => { if (!v) return; out[k] = (out[k] || 0) + v; };

  for (const e of entries) {
    const name = (e.name || '').toLowerCase();
    const cals = (e.macros?.calories || 0) * (e.servings || 1);
    const factor = cals / 100; // per-100-kcal multiplier

    // Direct macros (already in entry)
    const s = e.servings || 1;
    add('calories', (e.macros?.calories || 0) * s);
    add('protein',  (e.macros?.protein  || 0) * s);
    add('carbs',    (e.macros?.carbs    || 0) * s);
    add('fat',      (e.macros?.fat      || 0) * s);
    add('fiber',    (e.macros?.fiber    || 0) * s);

    // Keyword-based micro additions
    let matched = false;
    for (const kw of Object.keys(FOOD_KEYWORD_NUTRIENTS)) {
      if (name.includes(kw)) {
        matched = true;
        const contrib = FOOD_KEYWORD_NUTRIENTS[kw];
        for (const [k, v] of Object.entries(contrib)) {
          if (k === 'protein' || k === 'carbs' || k === 'fat' || k === 'fiber') continue; // already counted
          add(k, v * factor);
        }
      }
    }
    // If nothing matched and this is a significant meal, give it generic trace
    if (!matched && cals > 80) {
      add('Magnesium', 10 * factor);
      add('Potassium', 80 * factor);
      add('Selenium',  3 * factor);
      add('Iron',      0.5 * factor);
    }
  }
  return out;
}

// ─── Nutrient-name normalization ────────────────────────────────────────────
// EdgeIQ's SYSTEMS table keys on specific canonical names — many of which
// INCLUDE parentheses on purpose (e.g. "NMN (Nicotinamide Mononucleotide)",
// "Thiamin (B1)", "Magnesium L-Threonate (Magtein)"). Stripping parens
// blindly would break those matches, so normalization is a 3-pass pipeline:
//   1. Trim + exact alias lookup (handles known mismatches verbatim)
//   2. Strip ONLY label-form qualifiers — "(as X)" and "(from X)" — which
//      always describe the chemical form, never the canonical name
//   3. Re-check alias and exact match
const NUTRIENT_ALIASES = {
  // OMRE TMG + B Complex — verbose label forms
  'Trimethylglycine (TMG)':                          'Trimethylglycine (TMG/Betaine anhydrous)',
  'Vitamin B2':                                      'Riboflavin (B2)',
  'Vitamin B3':                                      'Niacin (B3)',
  'Vitamin B1':                                      'Thiamin (B1)',
  // Momentous Creatine
  'Creatine Monohydrate':                            'Creatine',
  // Generic shorthand variants people sometimes type
  'Methylcobalamin':                                 'Vitamin B12',
  'Cyanocobalamin':                                  'Vitamin B12',
  'Cholecalciferol':                                 'Vitamin D3 (cholecalciferol)',
  'Vitamin D3':                                      'Vitamin D3 (cholecalciferol)',
  'Folic Acid':                                      'Folate',
  'L-5-Methyl Folate':                               'Folate',
  'Methylfolate':                                    'Folate',
  'Pantothenic Acid':                                'Pantothenic acid',
};

function normalizeNutrientName(raw) {
  if (!raw) return raw;
  let s = String(raw).trim();
  // Pass 1: exact alias / canonical match
  if (NUTRIENT_ALIASES[s]) return NUTRIENT_ALIASES[s];
  // Pass 2: strip label-form qualifiers ("(as X)", "(from X)") which describe
  // the chemical form rather than name a different nutrient. Other parens
  // (B1, KSM-66, Magtein, Nicotinamide Mononucleotide, etc.) are preserved.
  // Allow leading whitespace inside the parens — some labels write "( as X)"
  // with a space after the opening paren. Case-insensitive on "as"/"from".
  const stripped = s.replace(/\s*\(\s*(?:as|from)\s+[^)]*\)/gi, '').trim();
  if (stripped !== s) {
    if (NUTRIENT_ALIASES[stripped]) return NUTRIENT_ALIASES[stripped];
    return stripped;
  }
  return s;
}

// ─── Unit conversion ────────────────────────────────────────────────────────
// SYSTEMS targets are denominated in a canonical unit per nutrient (mg, mcg,
// IU, g). Catalog entries can be in any unit ("Creatine Monohydrate" is
// usually labelled in g, B12 in mcg). Without conversion, "5 g of Creatine"
// would land in the totals as 5 against a 5000 mg target. This map declares
// the canonical unit; convertAmount() handles the rescale.
const CANONICAL_UNITS = {
  'Vitamin A': 'IU', 'Vitamin C': 'mg', 'Vitamin D3 (cholecalciferol)': 'IU',
  'Vitamin E': 'IU', 'Vitamin K': 'mcg',
  'Thiamin (B1)': 'mg', 'Riboflavin (B2)': 'mg', 'Niacin (B3)': 'mg',
  'Vitamin B6': 'mg', 'Folate': 'mcg', 'Vitamin B12': 'mcg',
  'Biotin': 'mcg', 'Pantothenic acid': 'mg',
  'Calcium': 'mg', 'Iron': 'mg', 'Magnesium': 'mg', 'Phosphorus': 'mg',
  'Potassium': 'mg', 'Sodium': 'mg', 'Zinc': 'mg', 'Copper': 'mg',
  'Manganese': 'mg', 'Selenium': 'mcg', 'Chromium': 'mcg',
  'EPA': 'mg', 'DHA': 'mg', 'Fish Oil (total)': 'mg',
  'NMN (Nicotinamide Mononucleotide)': 'mg', 'Trans-Resveratrol': 'mg',
  'Spermidine (wheat germ extract)': 'mg', 'Quercetin': 'mg', 'Fisetin': 'mg',
  'Turmeric (curcumin extract)': 'mg', 'Beetroot powder concentrate': 'mg',
  'Ashwagandha (KSM-66)': 'mg', 'Magnesium L-Threonate (Magtein)': 'mg',
  'Apigenin': 'mg', 'Trimethylglycine (TMG/Betaine anhydrous)': 'mg',
  'Shilajit resin': 'mg', 'Creatine': 'mg',
};

const MASS_FACTOR = { g: 1000, mg: 1, mcg: 0.001, ug: 0.001, μg: 0.001 };

function convertAmount(amount, fromUnit, canonicalUnit) {
  if (!amount) return 0;
  const f = (fromUnit || '').toLowerCase().trim();
  const c = (canonicalUnit || '').toLowerCase().trim();
  if (!f || !c || f === c) return amount;
  // Mass scaling — only between mg/mcg/g
  if (MASS_FACTOR[f] != null && MASS_FACTOR[c] != null) {
    return amount * (MASS_FACTOR[f] / MASS_FACTOR[c]);
  }
  // IU vs mass: no clean conversion (depends on form). Pass through; the
  // target is in IU and the catalog should be too for the same nutrient.
  return amount;
}

// ─── Add taken-today supplement nutrients ───────────────────────────────────
function addSupplementNutrients(nutrients, dateStr) {
  const catalog = getCatalog();
  const stack = getStack();
  const taken = getTodayTaken(dateStr);
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));
  const add = (k, v) => { if (!v) return; nutrients[k] = (nutrients[k] || 0) + v; };

  for (const entry of stack) {
    if (!taken[entry.id]) continue; // only count taken
    const sup = byId[entry.supplementId];
    if (!sup) continue;
    const mult = entry.doseMultiplier || 1;
    for (const n of sup.nutrients || []) {
      const canonical = normalizeNutrientName(n.name);
      const targetUnit = CANONICAL_UNITS[canonical] || n.unit;
      const amt = convertAmount((n.amount || 0) * mult, n.unit, targetUnit);
      add(canonical, amt);
    }
  }
}

// ─── Full daily nutrient totals (food + supplements taken) ──────────────────
//
// DATA FLOW:
//   Priority 0 — cronometerLive (live Worker pull cache — FRESHEST, what the
//                Nutrition panel renders). Raw column-name keys. Read this
//                first; it's updated every 5 minutes when the tab is visible.
//   Priority 1 — Legacy `cronometer` storage rows (older CSV imports —
//                normalized field names like vitaminB12, calcium, etc.)
//   Priority 2 — nutritionLog manual entries (macros + keyword micro estimates)
//
// Cronometer data is authoritative when present because it carries 15+
// actual micronutrient values from a curated food database, whereas manual
// nutritionLog entries only have macros and rely on keyword estimation.
//
export function getDailyNutrients(dateStr) {
  const nutrients = {};
  const add = (k, v) => { if (!v) return; nutrients[k] = (nutrients[k] || 0) + v; };

  let hasCronometer = false;

  // ── Step 0: Live Cronometer pull cache (cronometerLive[date].totals) ───
  // This is the freshest source — populated by useCronometerToday on every
  // poll/visibility-change. Keys here are Cronometer's raw column names like
  // "Energy (kcal)", "Calcium (mg)". Map them into Arnold's nutrient buckets.
  try {
    const live = storage.get('cronometerLive') || {};
    const todayLive = live[dateStr];
    const totals = todayLive?.totals;
    if (totals && (parseFloat(totals['Energy (kcal)'] || totals['Energy']) || 0) > 0) {
      hasCronometer = true;
      // Phase 4r.fuel.15 — pick now tries both µg (micro-sign) and mcg
      // spellings, and falls back to a case-insensitive scan that strips
      // trailing unit notation. Cronometer's web/API exports use the µ
      // character ("B12 (µg)"), older CSV exports use "mcg", and the
      // hand-typed Arnold pick previously matched only "mcg" — that
      // silently dropped B12, Folate, Vit K, Selenium, Biotin, Chromium.
      const totalsLower = Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [String(k).toLowerCase().trim(), v])
      );
      const stripUnit = (k) =>
        String(k).toLowerCase().trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
      const totalsStripped = Object.fromEntries(
        Object.entries(totals).map(([k, v]) => [stripUnit(k), v])
      );
      const pick = (...keys) => {
        for (const k of keys) {
          // 1. exact match
          let v = totals[k];
          if (v != null && !Number.isNaN(Number(v))) return Number(v);
          // 2. µg ↔ mcg swap, both directions
          if (/\(mcg\)/i.test(k)) {
            v = totals[k.replace(/\(mcg\)/i, '(µg)')];
            if (v != null && !Number.isNaN(Number(v))) return Number(v);
          }
          if (/\(µg\)/i.test(k)) {
            v = totals[k.replace(/\(µg\)/i, '(mcg)')];
            if (v != null && !Number.isNaN(Number(v))) return Number(v);
          }
          // 3. case-insensitive exact
          v = totalsLower[String(k).toLowerCase().trim()];
          if (v != null && !Number.isNaN(Number(v))) return Number(v);
          // 4. unit-stripped fuzzy (matches across mcg/µg/IU/etc.)
          v = totalsStripped[stripUnit(k)];
          if (v != null && !Number.isNaN(Number(v))) return Number(v);
        }
        return 0;
      };
      // Macros
      add('calories', pick('Energy (kcal)', 'Energy'));
      add('protein',  pick('Protein (g)', 'Protein'));
      add('carbs',    pick('Carbs (g)', 'Carbohydrates (g)', 'Net Carbs (g)'));
      add('fat',      pick('Fat (g)', 'Fat'));
      add('fiber',    pick('Fiber (g)', 'Fiber'));
      // Vitamins
      add('Vitamin A',   pick('Vitamin A (IU)', 'Vitamin A'));
      add('Vitamin C',   pick('Vitamin C (mg)', 'Vitamin C'));
      add('Vitamin D',   pick('Vitamin D (IU)', 'Vitamin D'));
      add('Vitamin E',   pick('Vitamin E (mg)', 'Vitamin E'));
      add('Vitamin K',   pick('Vitamin K (mcg)', 'Vitamin K'));
      add('Thiamin (B1)',    pick('Thiamine (B1) (mg)', 'B1 (mg)', 'Thiamin'));
      add('Riboflavin (B2)', pick('Riboflavin (B2) (mg)', 'B2 (mg)', 'Riboflavin'));
      add('Niacin (B3)',     pick('Niacin (B3) (mg)', 'B3 (mg)', 'Niacin'));
      add('Vitamin B6',  pick('Vitamin B6 (mg)', 'B6 (mg)'));
      add('Folate',      pick('Folate (mcg)', 'Folate, Total (mcg)', 'Folate'));
      add('Vitamin B12', pick('B12 (mcg)', 'Vitamin B12 (mcg)'));
      add('Biotin',      pick('Biotin (mcg)'));
      add('Pantothenic acid', pick('Pantothenic Acid (mg)', 'B5 (mg)'));
      // Minerals
      add('Calcium',   pick('Calcium (mg)', 'Calcium'));
      add('Iron',      pick('Iron (mg)', 'Iron'));
      add('Magnesium', pick('Magnesium (mg)', 'Magnesium'));
      add('Phosphorus',pick('Phosphorus (mg)'));
      add('Potassium', pick('Potassium (mg)', 'Potassium'));
      add('Sodium',    pick('Sodium (mg)', 'Sodium'));
      add('Zinc',      pick('Zinc (mg)', 'Zinc'));
      add('Copper',    pick('Copper (mg)'));
      add('Manganese', pick('Manganese (mg)'));
      add('Selenium',  pick('Selenium (mcg)', 'Selenium'));
      add('Chromium',  pick('Chromium (mcg)'));
      // Fats
      const epa = pick('Omega-3 EPA (g)', 'EPA (g)') * 1000; // g→mg
      const dha = pick('Omega-3 DHA (g)', 'DHA (g)') * 1000;
      const o3total = pick('Omega-3 (g)') * 1000;
      if (epa) add('EPA', epa); else if (o3total) add('EPA', o3total * 0.5);
      if (dha) add('DHA', dha); else if (o3total) add('DHA', o3total * 0.5);
    }
  } catch { /* ignore */ }

  // ── Step 1: Legacy `cronometer` rows (CSV import format) ───────────────
  if (!hasCronometer) {
    try {
      const crono = storage.get('cronometer') || [];
      const dayC = crono.find(c => c.date === dateStr);
      if (dayC && (parseFloat(dayC.calories) || 0) > 0) {
        hasCronometer = true;
        add('calories', parseFloat(dayC.calories) || 0);
        add('protein',  parseFloat(dayC.protein)  || 0);
        add('carbs',    parseFloat(dayC.carbs)    || 0);
        add('fat',      parseFloat(dayC.fat)      || 0);
        add('fiber',    parseFloat(dayC.fiber)    || 0);
        if (dayC.vitaminD)  add('Vitamin D',  parseFloat(dayC.vitaminD)  || 0);
        if (dayC.vitaminC)  add('Vitamin C',  parseFloat(dayC.vitaminC)  || 0);
        if (dayC.vitaminA)  add('Vitamin A',  parseFloat(dayC.vitaminA)  || 0);
        if (dayC.vitaminB12) add('Vitamin B12', parseFloat(dayC.vitaminB12) || 0);
        if (dayC.folate)    add('Folate',     parseFloat(dayC.folate)    || 0);
        if (dayC.calcium)   add('Calcium',    parseFloat(dayC.calcium)   || 0);
        if (dayC.iron)      add('Iron',       parseFloat(dayC.iron)      || 0);
        if (dayC.magnesium) add('Magnesium',  parseFloat(dayC.magnesium) || 0);
        if (dayC.zinc)      add('Zinc',       parseFloat(dayC.zinc)      || 0);
        if (dayC.potassium) add('Potassium',  parseFloat(dayC.potassium) || 0);
        if (dayC.sodium)    add('Sodium',     parseFloat(dayC.sodium)    || 0);
        if (dayC.omega3)    { add('EPA', (parseFloat(dayC.omega3) || 0) * 0.5); add('DHA', (parseFloat(dayC.omega3) || 0) * 0.5); }
        if (dayC.selenium)  add('Selenium',   parseFloat(dayC.selenium)  || 0);
      }
    } catch { /* ignore */ }
  }

  // ── Step 2: Fall back to nutritionLog entries (if no Cronometer) ────────
  if (!hasCronometer) {
    let entries = getEntriesForDate(dateStr);

    // If a full-day summary exists, use ONLY the most recent one (same logic
    // as dailyTotals in nutrition.js — prevents double-counting stale synced
    // entries).
    const fullDay = entries.filter(e => e.meal === 'full-day');
    if (fullDay.length > 0) {
      entries = [fullDay.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]];
    }

    const estimated = estimateFoodNutrients(entries);
    for (const [k, v] of Object.entries(estimated)) add(k, v);
  }

  // ── Step 3: Always add supplements on top ──────────────────────────────
  addSupplementNutrients(nutrients, dateStr);
  return nutrients;
}

// ─── Micronutrient summary for UI (combines food + supplements) ─────────────
// Returns an ordered list for the Micronutrients panel.
export function getMicronutrientSummary(dateStr) {
  const nutrients = getDailyNutrients(dateStr);
  const taken = getTodayTaken(dateStr);
  const stack = getStack();
  const catalog = getCatalog();
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));

  // Build a map of which supplements contributed to which nutrient
  const contribMap = {}; // name → 'food' | 'food + supp' | 'supp'
  const supplementNutrients = new Set();
  for (const entry of stack) {
    if (!taken[entry.id]) continue;
    const sup = byId[entry.supplementId];
    if (!sup) continue;
    for (const n of sup.nutrients || []) {
      supplementNutrients.add(n.name);
    }
  }

  // Phase 4r.fuel.3 — expanded essentials. Vitamins + minerals + EFAs that have
  // published RDAs / functional-medicine targets. Bioactives (NMN, Quercetin,
  // Resv, TMG, etc.) live in a separate panel — they don't have % targets.
  const show = [
    // Vitamins
    'Vitamin A', 'Vitamin C', 'Vitamin D', 'Vitamin E', 'Vitamin K',
    'Thiamin (B1)', 'Riboflavin (B2)', 'Niacin (B3)', 'Vitamin B6',
    'Folate', 'Vitamin B12',
    // Minerals
    'Calcium', 'Iron', 'Magnesium', 'Zinc', 'Selenium', 'Potassium', 'Copper',
    // Essential fats
    'EPA', 'DHA',
  ];
  // 2-letter abbreviations + group classification for the dense grid.
  const ABBR = {
    'Vitamin A': 'VA', 'Vitamin C': 'VC', 'Vitamin D': 'VD',
    'Vitamin E': 'VE', 'Vitamin K': 'VK',
    'Thiamin (B1)': 'B1', 'Riboflavin (B2)': 'B2', 'Niacin (B3)': 'B3',
    'Vitamin B6': 'B6', 'Folate': 'Fo', 'Vitamin B12': 'B12',
    'Calcium': 'Ca', 'Iron': 'Fe', 'Magnesium': 'Mg', 'Zinc': 'Zn',
    'Selenium': 'Se', 'Potassium': 'K', 'Copper': 'Cu',
    'EPA': 'EPA', 'DHA': 'DHA',
  };
  // Phase 4r.fuel.4 — group tag used by UI to render Vitamins / Minerals /
  // Essential Fats sections with gentle subheaders.
  const GROUP = {
    'Vitamin A': 'vitamins', 'Vitamin C': 'vitamins', 'Vitamin D': 'vitamins',
    'Vitamin E': 'vitamins', 'Vitamin K': 'vitamins',
    'Thiamin (B1)': 'vitamins', 'Riboflavin (B2)': 'vitamins', 'Niacin (B3)': 'vitamins',
    'Vitamin B6': 'vitamins', 'Folate': 'vitamins', 'Vitamin B12': 'vitamins',
    'Calcium': 'minerals', 'Iron': 'minerals', 'Magnesium': 'minerals',
    'Zinc': 'minerals', 'Selenium': 'minerals', 'Potassium': 'minerals', 'Copper': 'minerals',
    'EPA': 'fats', 'DHA': 'fats',
  };
  const list = [];
  for (const name of show) {
    // Look up value: allow aliases (e.g. "Vitamin D3 (cholecalciferol)" counts for "Vitamin D")
    let val = nutrients[name] || 0;
    if (name === 'Vitamin D')    val += nutrients['Vitamin D3 (cholecalciferol)'] || 0;
    if (name === 'Vitamin B12')  val += nutrients['Vitamin B12 (methylcobalamin)'] || 0;
    if (name === 'Magnesium')    val += (nutrients['Elemental Magnesium'] || 0);
    const targets = getOptimalTargets(dateStr);
    const target = targets[name] || 100;
    const pct = target ? (val / target) * 100 : 0;

    let source;
    const fromSupp = supplementNutrients.has(name)
      || (name === 'Vitamin D' && supplementNutrients.has('Vitamin D3 (cholecalciferol)'))
      || (name === 'Vitamin B12' && supplementNutrients.has('Vitamin B12 (methylcobalamin)'))
      || (name === 'Magnesium' && (supplementNutrients.has('Elemental Magnesium') || supplementNutrients.has('Magnesium')));
    // Determine source: check if food contributed this nutrient.
    // Use getDailyNutrients (already called above) minus supplements to see
    // food contribution, rather than calling estimateFoodNutrients directly
    // (which would bypass full-day entry dedup and cronometer priority).
    const foodVal = nutrients[name] - (fromSupp ? (() => {
      let sv = 0;
      for (const entry of stack) {
        if (!taken[entry.id]) continue;
        const sup = byId[entry.supplementId];
        if (!sup) continue;
        for (const n of sup.nutrients || []) {
          if (n.name === name) sv += (n.amount || 0) * (entry.doseMultiplier || 1);
        }
      }
      return sv;
    })() : 0);
    if (val === 0) source = '—';
    else if (fromSupp && foodVal > 0) source = 'food + supp';
    else if (fromSupp) source = 'supp';
    else source = 'food';
    contribMap[name] = source;

    // Phase 4r.fuel.2 — split foodPct vs suppPct so the ring can show
    // where food alone got you vs how much the supplement added.
    const foodPct = target ? Math.round((foodVal / target) * 100) : 0;
    const suppPct = Math.max(0, Math.round(pct) - foodPct);

    list.push({
      name,
      abbr: ABBR[name] || name.slice(0, 2),
      group: GROUP[name] || 'other',
      value: Math.round(val * 10) / 10,
      target,
      pct: Math.round(pct),
      foodPct,
      suppPct,
      source,
    });
  }
  return list;
}

// ─── Bioactive Stack Summary — Phase 4r.fuel.3 ──────────────────────────────
// Longevity & sports bioactives (NMN, Quercetin, Resv, TMG, Apigenin, Spermidine,
// Fisetin, Mg Threonate, Ashwagandha, Curcumin, Beetroot, Shilajit, Creatine,
// Fish Oil). These don't have RDAs — we surface them as "taken / not taken
// today" + dose against the user's protocol target.
export function getBioactiveStack(dateStr) {
  const taken = getTodayTaken(dateStr);
  const stack = getStack();
  const catalog = getCatalog();
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));

  // Phase 4r.fuel.bio.match.1 — pattern-based bioactive detection.
  // Previously: strict Set of canonical names. Failed silently when the
  // user added a custom catalog entry whose nutrient name varied (e.g.
  // "TMG" alone instead of "Trimethylglycine (TMG/Betaine anhydrous)"; or
  // "Creatine Monohydrate" instead of "Creatine"). Now we match by
  // substring patterns so any reasonable variant resolves to the right
  // compound. The CANONICAL field preserves the legacy display name so
  // downstream consumers (HS panels' bioactive hex section in particular)
  // that key by canonical name keep working.
  const BIO_PATTERNS = [
    { re: /\bnmn\b|nicotinamide mononucleotide/i,         canonical: 'NMN (Nicotinamide Mononucleotide)',           label: 'NMN',          group: 'nad' },
    { re: /trans-?resveratrol|\bresveratrol\b/i,          canonical: 'Trans-Resveratrol',                            label: 'Resveratrol',  group: 'nad' },
    { re: /spermidine/i,                                   canonical: 'Spermidine (wheat germ extract)',              label: 'Spermidine',   group: 'nad' },
    { re: /\btmg\b|trimethylglycine|betaine/i,            canonical: 'Trimethylglycine (TMG/Betaine anhydrous)',     label: 'TMG',          group: 'nad' },
    { re: /apigenin/i,                                     canonical: 'Apigenin',                                     label: 'Apigenin',     group: 'nad' },
    { re: /quercetin/i,                                    canonical: 'Quercetin',                                    label: 'Quercetin',    group: 'senolytic' },
    { re: /fisetin/i,                                      canonical: 'Fisetin',                                      label: 'Fisetin',      group: 'senolytic' },
    { re: /turmeric|curcumin/i,                            canonical: 'Turmeric (curcumin extract)',                  label: 'Curcumin',     group: 'anti-inflammatory' },
    { re: /fish oil|^omega-?3/i,                           canonical: 'Fish Oil (total)',                             label: 'Fish Oil',     group: 'anti-inflammatory' },
    { re: /ashwagandha|ksm-?66/i,                          canonical: 'Ashwagandha (KSM-66)',                         label: 'Ashwagandha',  group: 'performance' },
    { re: /beetroot|superbeets/i,                          canonical: 'Beetroot powder concentrate',                  label: 'Beetroot',     group: 'performance' },
    { re: /\bcreatine\b/i,                                 canonical: 'Creatine',                                     label: 'Creatine',     group: 'performance' },
    { re: /magnesium l-?threonate|magtein|mg threonate/i,  canonical: 'Magnesium L-Threonate (Magtein)',              label: 'Mg Threonate', group: 'other' },
    { re: /shilajit/i,                                     canonical: 'Shilajit resin',                               label: 'Shilajit',     group: 'other' },
  ];
  const matchBioactive = (nutrientName) => {
    const s = String(nutrientName || '');
    for (const p of BIO_PATTERNS) {
      if (p.re.test(s)) return p;
    }
    return null;
  };

  // Walk the user's stack; for each entry that contains a bioactive, sum
  // the dose taken today and produce one row per compound. Keyed by the
  // canonical name so multiple catalog products that contain the same
  // compound (e.g. "OMRE TMG + B-Complex" and "PartiQlar TMG" if both were
  // taken) sum into one bioactive row.
  const byCompound = {};
  for (const entry of stack) {
    const sup = byId[entry.supplementId];
    if (!sup) continue;
    const isTaken = !!taken[entry.id];
    const mult = entry.doseMultiplier || 1;
    for (const n of sup.nutrients || []) {
      const match = matchBioactive(n.name);
      if (!match) continue;
      const amt = (n.amount || 0) * mult;
      const key = match.canonical;
      if (!byCompound[key]) {
        byCompound[key] = {
          name: key,
          _label: match.label,
          _group: match.group,
          doseTaken: 0, doseTarget: 0, taken: false,
          unit: n.unit || 'mg',
        };
      }
      byCompound[key].doseTarget += amt;
      if (isTaken) {
        byCompound[key].doseTaken += amt;
        byCompound[key].taken = true;
      }
    }
  }

  // Phase 4r.fuel.4 — return with label, group, and a deterministic group sort
  // so the UI can render NAD+ → Senolytics → Anti-inflam → Performance → Other.
  const GROUP_ORDER = { 'nad': 0, 'senolytic': 1, 'anti-inflammatory': 2, 'performance': 3, 'other': 4 };
  return Object.values(byCompound)
    .map(c => ({ ...c, label: c._label, group: c._group }))
    .sort((a, b) => {
      const g = (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9);
      if (g !== 0) return g;
      return a.label.localeCompare(b.label);
    });
}

// ─── 10 Health Systems ──────────────────────────────────────────────────────
// Each system averages contributing nutrients against their RDA.
// weights[n] = importance 0-1 (not strict; higher = counts more).
export const SYSTEMS = [
  {
    id: 'brain',
    name: 'Brain & Cognition',
    color: '#60a5fa',
    weights: {
      'EPA': 1, 'DHA': 1, 'Vitamin B12': 1, 'Folate': 0.8,
      'Vitamin B6': 0.7, 'Magnesium': 0.7,
      'Quercetin': 0.5, 'Apigenin': 0.3,
      'Vitamin D': 0.6,
    },
  },
  {
    id: 'heart',
    name: 'Heart & Blood',
    color: '#f87171',
    weights: {
      'EPA': 1, 'DHA': 1, 'fiber': 0.9, 'Potassium': 0.9,
      'Magnesium': 0.7, 'Folate': 0.6,
      'Beetroot powder concentrate': 0.5,
      'Trimethylglycine (TMG/Betaine anhydrous)': 0.3,
    },
  },
  {
    id: 'bones',
    name: 'Bones & Muscles',
    color: '#fbbf24',
    weights: {
      'Calcium': 1, 'Vitamin D': 1, 'Magnesium': 0.8,
      'Vitamin K': 0.7, 'protein': 0.8, 'Phosphorus': 0.5,
      'Creatine': 0.4,
    },
  },
  {
    id: 'gut',
    name: 'Gut & Digestion',
    color: '#fb923c',
    weights: {
      'fiber': 1, 'Probiotic': 0.8, 'Vitamin A': 0.4,
      'Zinc': 0.5, 'Turmeric (curcumin extract)': 0.3,
    },
  },
  {
    id: 'immune',
    name: 'Immune System',
    color: '#4ade80',
    weights: {
      'Vitamin C': 1, 'Vitamin D': 1, 'Zinc': 1,
      'Selenium': 0.6, 'Vitamin A': 0.5,
      'Quercetin': 0.4, 'Fisetin': 0.3,
    },
  },
  {
    id: 'energy',
    name: 'Energy & Strength',
    color: '#fb923c',
    weights: {
      'Iron': 1, 'Vitamin B12': 0.9, 'carbs': 0.8,
      'Creatine': 0.7, 'Magnesium': 0.6,
      'Shilajit resin': 0.3, 'NMN (Nicotinamide Mononucleotide)': 0.3,
    },
  },
  {
    id: 'longevity',
    name: 'Longevity',
    color: '#a78bfa',
    weights: {
      'NMN (Nicotinamide Mononucleotide)': 0.9,
      'Trans-Resveratrol': 0.8,
      'Spermidine (wheat germ extract)': 0.7,
      'Quercetin': 0.7, 'Fisetin': 0.7,
      'EPA': 0.5, 'DHA': 0.5, 'fiber': 0.5,
      'Apigenin': 0.3,
    },
  },
  {
    id: 'sleep',
    name: 'Sleep & Rest',
    color: '#f87171',
    weights: {
      'Magnesium': 1,
      'Magnesium L-Threonate (Magtein)': 0.8,
      'Ashwagandha (KSM-66)': 0.7,
      'Apigenin': 0.7, 'Glycine': 0.4,
    },
  },
  {
    id: 'metabolism',
    name: 'Metabolism',
    color: '#22d3ee',
    weights: {
      'fiber': 0.9, 'Vitamin B6': 0.7, 'Thiamin (B1)': 0.6,
      'Riboflavin (B2)': 0.6, 'Niacin (B3)': 0.7,
      'Chromium': 0.5, 'Magnesium': 0.6,
    },
  },
  {
    id: 'endurance',
    name: 'Endurance',
    color: '#2dd4bf',
    weights: {
      'carbs': 1, 'Iron': 1, 'Vitamin B12': 0.8,
      'Sodium': 0.6, 'Potassium': 0.7,
      'Beetroot powder concentrate': 0.5, 'EPA': 0.4, 'DHA': 0.4,
    },
  },
];

// ─── Score a single system ──────────────────────────────────────────────────
function scoreSystem(system, nutrients, dateStr) {
  const targets = getOptimalTargets(dateStr);
  let totalWeight = 0;
  let weightedSum = 0;
  const gaps = []; // nutrients below 50%
  const wins = []; // nutrients above 80%
  for (const [nutr, w] of Object.entries(system.weights)) {
    // Allow aliases
    let value = nutrients[nutr] || 0;
    if (nutr === 'Vitamin D')    value += nutrients['Vitamin D3 (cholecalciferol)'] || 0;
    if (nutr === 'Vitamin B12')  value += nutrients['Vitamin B12 (methylcobalamin)'] || 0;
    if (nutr === 'Magnesium')    value += nutrients['Elemental Magnesium'] || 0;
    const target = targets[nutr] || 100;
    const pct = Math.max(0, Math.min(value / target, 1.2)); // cap slight over
    weightedSum += pct * w;
    totalWeight += w;
    if (pct < 0.5) gaps.push({ nutr, pct });
    if (pct >= 0.8) wins.push({ nutr, pct });
  }
  const rawScore = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
  const pct = Math.round(Math.min(rawScore, 1) * 100);
  gaps.sort((a, b) => a.pct - b.pct);
  return { pct, gaps, wins };
}

// ─── Generate a short human comment for a system ────────────────────────────
function makeComment(pct, gaps, wins) {
  if (pct >= 80) {
    if (wins.length >= 2) return `Great — ${shortName(wins[0].nutr)} & ${shortName(wins[1].nutr)} on point`;
    if (wins.length === 1) return `Solid — ${shortName(wins[0].nutr)} in target`;
    return 'On track — keep it up';
  }
  if (pct >= 50) {
    if (gaps.length >= 1) return `Focus — add ${shortName(gaps[0].nutr)}`;
    return 'Doing ok — one nutrient borderline';
  }
  // Deficient
  if (gaps.length >= 1) return `Low — take ${shortName(gaps[0].nutr)}`;
  return 'Needs attention';
}

function shortName(n) {
  const map = {
    'Vitamin B12': 'B12',
    'Vitamin B12 (methylcobalamin)': 'B12',
    'Vitamin D': 'Vit D',
    'Vitamin D3 (cholecalciferol)': 'Vit D',
    'Vitamin C': 'Vit C',
    'Vitamin K': 'Vit K',
    'Vitamin A': 'Vit A',
    'Vitamin B6': 'B6',
    'Vitamin E': 'Vit E',
    'Magnesium': 'Mg',
    'Elemental Magnesium': 'Mg',
    'Magnesium L-Threonate (Magtein)': 'Mg-L',
    'Calcium': 'Ca',
    'Iron': 'Fe',
    'Zinc': 'Zn',
    'Selenium': 'Se',
    'Potassium': 'K',
    'Sodium': 'Na',
    'Phosphorus': 'P',
    'Chromium': 'Cr',
    'EPA': 'EPA',
    'DHA': 'DHA',
    'Fish Oil (total)': 'fish oil',
    'Folate': 'folate',
    'Biotin': 'biotin',
    'Niacin (B3)': 'B3',
    'Thiamin (B1)': 'B1',
    'Riboflavin (B2)': 'B2',
    'Pantothenic acid': 'B5',
    'Manganese': 'Mn',
    'Copper': 'Cu',
    'NMN (Nicotinamide Mononucleotide)': 'NMN',
    'Trans-Resveratrol': 'resveratrol',
    'Spermidine (wheat germ extract)': 'spermidine',
    'Quercetin': 'quercetin',
    'Fisetin': 'fisetin',
    'Turmeric (curcumin extract)': 'curcumin',
    'Beetroot powder concentrate': 'beetroot',
    'Ashwagandha (KSM-66)': 'ashwagandha',
    'Apigenin': 'apigenin',
    'Trimethylglycine (TMG/Betaine anhydrous)': 'TMG',
    'Shilajit resin': 'shilajit',
    'Creatine': 'creatine',
    'Probiotic': 'probiotic',
    'fiber': 'fiber',
    'protein': 'protein',
    'carbs': 'carbs',
    'fat': 'fat',
  };
  return map[n] || n;
}

// ═══════════════════════════════════════════════════════════════════════════
// HS Scoring v2 — Outcome + Coach + Nutrition blend
// ═══════════════════════════════════════════════════════════════════════════
// Design doc: docs/HEALTH_SYSTEM_SCORING_V2.md
// This block is self-contained. Nothing in v1 above this point calls into v2;
// nothing in v2 mutates v1 state. The flag at the top of the file selects
// which path getSystemsReport / getSystemDetail take.

// Per-system component weights + outcome resolver list. Defaults to 50/30/20;
// each entry overrides only the fields it cares about.
const SYSTEMS_V2_CONFIG = {
  brain:      { weights: { outcome: 0.40, coach: 0.40, nutrition: 0.20 }, outcome: ['recentSleepScore', 'hrvVsBaseline'] },
  heart:      { weights: { outcome: 0.50, coach: 0.30, nutrition: 0.20 }, outcome: ['rhrVsBaseline', 'hrvVsBaseline'] },
  bones:      { weights: { outcome: 0.50, coach: 0.20, nutrition: 0.30 }, outcome: ['weeklyStrengthSessions', 'leanMassVsTarget'] },
  gut:        { weights: { outcome: 0.30, coach: 0.30, nutrition: 0.40 }, outcome: [] },
  immune:     { weights: { outcome: 0.40, coach: 0.30, nutrition: 0.30 }, outcome: ['recentSleepScore', 'hrvVsBaseline'] },
  energy:     { weights: { outcome: 0.50, coach: 0.30, nutrition: 0.20 }, outcome: ['bodyBatteryAvg', 'recoveryTrend'] },
  longevity:  { weights: { outcome: 0.30, coach: 0.40, nutrition: 0.30 }, outcome: ['monotonyHealth', 'weeklyVolume'] },
  sleep:      { weights: { outcome: 0.60, coach: 0.30, nutrition: 0.10 }, outcome: ['recentSleepDuration', 'recentSleepScore', 'hrvVsBaseline'] },
  metabolism: { weights: { outcome: 0.50, coach: 0.30, nutrition: 0.20 }, outcome: ['weightVsTarget', 'bodyFatVsTarget'] },
  endurance:  { weights: { outcome: 0.80, coach: 0.15, nutrition: 0.05 }, outcome: ['weeklyMileage', 'weeklyVolume'] },
};

// Coach signal status → 0-100 score contribution. Mirrors the design doc §4.2.
// Status words come from coachSignals.js (sig.status).
const COACH_STATUS_TO_SCORE = {
  // Strong positive
  positive: 100, paid: 100, stable: 100, recovered: 100,
  // Mild / mixed
  mild: 70, rising: 70, mixed: 70, adapting: 70, hot: 70,
  // Moderate concern
  moderate: 50, warning: 50, attention: 50, impaired: 50,
  slowing: 50, depleted: 50, 'grey-zone': 50, low: 50, 'sparse-easy': 50,
  // Strong concern
  severe: 20, concerning: 20, concern: 20,
  // Drop these — they're informational without a directional read
  // info: undefined → dropped
};

// Linear interpolation between two (x, y) anchor points, clamped to [0, 100].
function _lerpClip(x, x0, y0, x1, y1) {
  if (x1 === x0) return y0;
  const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  return Math.max(0, Math.min(100, y));
}

// ─── Rolling-median helper for noisy body composition signals ─────────────
// Withings (and most BIA scales) report weight/body-fat with ±2 lb / ±3-4%
// day-to-day fluctuation driven by hydration, glycogen state, time-of-day
// of the weigh-in. A single most-recent reading drags the score on noise
// rather than real change. The median over the last N days is robust to
// single outliers — one dehydrated morning reading can't move it more than
// one slot in the sorted order. Use this for body composition fields where
// the underlying physiology moves slowly but the sensor is jittery.
//
// MORNING-FASTED FILTER (Phase 4r.weight.filter.1) — when a weight row
// carries a `time` field (HH:MM local), prefer morning readings (< 10am)
// for body composition. Post-workout readings lose 1-2 lb of sweat +
// glycogen and pull the median artificially low. For each date, the
// helper picks the row closest to morning-fasted state and ignores
// duplicate readings later in the day. Falls back to "earliest of date"
// when no morning reading exists.
const _MORNING_CUTOFF_HOUR = 10;

function _morningPreferredRows(rows) {
  if (!rows || !rows.length) return [];
  const byDate = {};
  for (const r of rows) {
    if (!r?.date) continue;
    const t = (r.time || '').match(/^(\d{1,2}):(\d{2})$/);
    const hour = t ? parseInt(t[1], 10) : null;
    const minute = t ? parseInt(t[2], 10) : 0;
    const minutesOfDay = hour != null ? hour * 60 + minute : 9999;
    const existing = byDate[r.date];
    if (!existing) { byDate[r.date] = { row: r, minutesOfDay }; continue; }
    const exMorning = existing.minutesOfDay < _MORNING_CUTOFF_HOUR * 60;
    const newMorning = minutesOfDay < _MORNING_CUTOFF_HOUR * 60;
    if (newMorning && !exMorning) byDate[r.date] = { row: r, minutesOfDay };
    else if (newMorning === exMorning && minutesOfDay < existing.minutesOfDay) byDate[r.date] = { row: r, minutesOfDay };
  }
  return Object.values(byDate).map(v => v.row);
}

function _recentMedian(rows, accessor, daysBack = 7) {
  if (!rows || rows.length === 0) return null;
  // Apply the morning-fasted filter to deduplicate same-day readings to one
  // per date. Safe for any row schema: rows without a `time` field still
  // get one-per-date with the original ordering preserved.
  const filteredRows = _morningPreferredRows(rows);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const vals = filteredRows
    .filter(r => r?.date && parseLocalDate(r.date) >= cutoff)
    .map(r => Number(accessor(r)))
    .filter(v => Number.isFinite(v) && v > 0);
  if (vals.length === 0) return null;
  if (vals.length === 1) return vals[0];
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── Trajectory helper (used by weight/body-fat outcome resolvers) ─────────
// Linear regression over the last `daysBack` of {date, value} rows. Returns
// rate-of-change PER WEEK in the direction TOWARD the target — positive means
// the user is moving the right way, negative means drifting further. Returns
// null when there aren't enough points to fit a meaningful slope.
//
// rowsAccessor pulls a single number out of each row (so the same helper works
// for weight rows reading weightLbs, body fat reading bodyFatPct, etc.).
function _trajectoryTowardTarget(rows, target, rowsAccessor, daysBack = 28) {
  if (!Number.isFinite(target)) return null;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - daysBack);
  const pts = (rows || [])
    .map(r => ({ date: r?.date ? parseLocalDate(r.date) : null, v: rowsAccessor(r) }))
    .filter(p => p.date && p.date >= cutoff && Number.isFinite(p.v) && p.v > 0)
    .map(p => ({ d: p.date.getTime() / 86400000, v: p.v }))
    .sort((a, b) => a.d - b.d);
  if (pts.length < 4) return null;            // need enough data for a real slope
  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p.d, 0);
  const sumY = pts.reduce((s, p) => s + p.v, 0);
  const sumXY = pts.reduce((s, p) => s + p.d * p.v, 0);
  const sumXX = pts.reduce((s, p) => s + p.d * p.d, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slopePerDay = (n * sumXY - sumX * sumY) / denom;
  const perWeek = slopePerDay * 7;            // rate, in the unit's natural per-week
  const current = pts[pts.length - 1].v;
  const dirSign = Math.sign(target - current); // +1 if user needs to increase to reach target
  if (dirSign === 0) return 0;                 // already at target — no direction
  // Multiply by direction: positive number = moving correct way.
  return perWeek * dirSign;
}

// Build the per-day storage snapshot the resolvers need. Memoized per
// dateStr inside scoreSystemV2 so each report run touches storage once.
function _buildOutcomeContext(dateStr) {
  return {
    today: dateStr || localDate(),
    sleep:      storage.get('sleep')      || [],
    hrv:        storage.get('hrv')        || [],
    weight:     storage.get('weight')     || [],
    activities: storage.get('activities') || [],
    goals:      getGoals() || {},
  };
}

// ─── Outcome resolvers ──────────────────────────────────────────────────────
// Each returns 0-100 when it has data, or null when it doesn't. Null causes
// the resolver to drop out of the outcome component's average.
//
// All resolvers read from `ctx` (the storage snapshot) and `coachSignals`
// (the userState.coachSignals object). Resolvers that need coachSignals but
// don't get them return null — they degrade gracefully.

const _OUTCOME_RESOLVERS = {
  // Last 7 days of sleep duration, ramped against the user's target (default 8h).
  // 0% at 5h or below; 100% at target or above.
  recentSleepDuration(ctx) {
    const target = parseFloat(ctx.goals?.targetSleepHours) || 8;
    const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
    cutoff.setDate(cutoff.getDate() - 7);
    const hours = ctx.sleep
      .filter(s => s?.date && parseLocalDate(s.date) >= cutoff && parseLocalDate(s.date) <= parseLocalDate(ctx.today))
      .map(s => Number(s.totalSleepHours) || (Number(s.totalSleepSecs) ? s.totalSleepSecs / 3600 : null))
      .filter(h => h != null && h > 0);
    if (hours.length === 0) return null;
    const avg = hours.reduce((s, h) => s + h, 0) / hours.length;
    return _lerpClip(avg, 5, 0, target, 100);
  },

  // Last 3 days of Garmin sleep score, averaged. Sleep score is already 0-100.
  recentSleepScore(ctx) {
    const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
    cutoff.setDate(cutoff.getDate() - 3);
    const scores = ctx.sleep
      .filter(s => s?.date && parseLocalDate(s.date) >= cutoff && parseLocalDate(s.date) <= parseLocalDate(ctx.today))
      .map(s => Number(s.sleepScore))
      .filter(v => Number.isFinite(v) && v > 0);
    if (scores.length === 0) return null;
    return scores.reduce((s, v) => s + v, 0) / scores.length;
  },

  // HRV vs baseline — acute 7d / chronic 28d ratio. 0.85 ratio → 0, 0.95 → 50,
  // 1.05+ → 100. Sleep-row HRV preferred (Garmin overnight); HRV table as backup.
  hrvVsBaseline(ctx) {
    const _hrvFor = (daysBack) => {
      const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
      cutoff.setDate(cutoff.getDate() - daysBack);
      const today = parseLocalDate(ctx.today);
      const fromSleep = ctx.sleep
        .filter(s => s?.date && parseLocalDate(s.date) >= cutoff && parseLocalDate(s.date) <= today)
        .map(s => Number(s.overnightHRV)).filter(v => Number.isFinite(v) && v > 0);
      const fromHrv = ctx.hrv
        .filter(h => h?.date && parseLocalDate(h.date) >= cutoff && parseLocalDate(h.date) <= today)
        .map(h => Number(h.overnightHRV)).filter(v => Number.isFinite(v) && v > 0);
      const all = [...fromSleep, ...fromHrv];
      if (all.length === 0) return null;
      return all.reduce((s, v) => s + v, 0) / all.length;
    };
    const acute = _hrvFor(7);
    const chronic = _hrvFor(28);
    if (acute == null || chronic == null || chronic === 0) return null;
    const ratio = acute / chronic;
    // 0.85 → 0%, 0.95 → 50%, 1.05+ → 100%
    if (ratio >= 1.05) return 100;
    if (ratio >= 0.95) return _lerpClip(ratio, 0.95, 50, 1.05, 100);
    return _lerpClip(ratio, 0.85, 0, 0.95, 50);
  },

  // RHR vs baseline — chronic / acute (inverted: lower acute = better fitness).
  rhrVsBaseline(ctx) {
    const _rhrFor = (daysBack) => {
      const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
      cutoff.setDate(cutoff.getDate() - daysBack);
      const today = parseLocalDate(ctx.today);
      const vals = ctx.sleep
        .filter(s => s?.date && parseLocalDate(s.date) >= cutoff && parseLocalDate(s.date) <= today)
        .map(s => Number(s.restingHR)).filter(v => Number.isFinite(v) && v > 0);
      if (vals.length === 0) return null;
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    };
    const acute = _rhrFor(7);
    const chronic = _rhrFor(28);
    if (acute == null || chronic == null || acute === 0) return null;
    const ratio = chronic / acute;  // inverted — lower acute lifts the ratio
    if (ratio >= 1.05) return 100;
    if (ratio >= 0.95) return _lerpClip(ratio, 0.95, 50, 1.05, 100);
    return _lerpClip(ratio, 0.85, 0, 0.95, 50);
  },

  // Weekly volume (hours/wk) vs target. 70% of target → 50, 90%+ → 100.
  weeklyVolume(ctx) {
    const target = parseFloat(ctx.goals?.weeklyTimeTargetHrs) || null;
    if (!target) return null;
    const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
    cutoff.setDate(cutoff.getDate() - 7);
    const today = parseLocalDate(ctx.today);
    const totalSecs = ctx.activities
      .filter(a => a?.date && parseLocalDate(a.date) >= cutoff && parseLocalDate(a.date) <= today)
      .reduce((s, a) => s + (Number(a.durationSecs) || 0), 0);
    const hours = totalSecs / 3600;
    const pct = hours / target;
    if (pct >= 0.9) return 100;
    if (pct >= 0.7) return _lerpClip(pct, 0.7, 50, 0.9, 100);
    return _lerpClip(pct, 0, 0, 0.7, 50);
  },

  // Weekly running mileage vs target.
  weeklyMileage(ctx) {
    const target = parseFloat(ctx.goals?.weeklyRunDistanceTarget) || null;
    if (!target) return null;
    const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
    cutoff.setDate(cutoff.getDate() - 7);
    const today = parseLocalDate(ctx.today);
    const isRunish = (a) => {
      const t = (a?.garminTypeKey || a?.activityType || '').toLowerCase();
      return /run|treadmill/.test(t);
    };
    const miles = ctx.activities
      .filter(a => a?.date && parseLocalDate(a.date) >= cutoff && parseLocalDate(a.date) <= today && isRunish(a))
      .reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
    const pct = miles / target;
    if (pct >= 0.9) return 100;
    if (pct >= 0.7) return _lerpClip(pct, 0.7, 50, 0.9, 100);
    return _lerpClip(pct, 0, 0, 0.7, 50);
  },

  // Weekly strength sessions vs target.
  weeklyStrengthSessions(ctx) {
    const target = parseFloat(ctx.goals?.weeklyStrengthTarget) || null;
    if (!target) return null;
    const cutoff = parseLocalDate(ctx.today); if (!cutoff) return null;
    cutoff.setDate(cutoff.getDate() - 7);
    const today = parseLocalDate(ctx.today);
    const isStrength = (a) => /strength|weight|gym/i.test(a?.activityType || '');
    const n = ctx.activities
      .filter(a => a?.date && parseLocalDate(a.date) >= cutoff && parseLocalDate(a.date) <= today && isStrength(a))
      .length;
    const pct = n / target;
    if (pct >= 1.0) return 100;
    if (pct >= 0.5) return _lerpClip(pct, 0.5, 50, 1.0, 100);
    return _lerpClip(pct, 0, 0, 0.5, 50);
  },

  // Weight delta from target — ±2% → 100, ±5% → 80, ±10% → 40, beyond → 0.
  // Trajectory lift: if user is moving toward target over the last 28d,
  // add up to +15 to the score. 0.5 lb/wk = +5, 1.0 = +10, 1.5+ = +15.
  // Means a user 8% above target but losing 1 lb/wk scores ~61 instead of 51.
  // Uses 7-day median of weighLbs (not single most-recent) so daily BIA
  // hydration noise doesn't swing the score.
  weightVsTarget(ctx) {
    const target = parseFloat(ctx.goals?.targetWeight) || null;
    if (!target) return null;
    const val = _recentMedian(ctx.weight, (r) => Number(r?.weightLbs), 7);
    if (val == null) return null;
    const drift = Math.abs(val - target) / target;
    let base;
    if (drift <= 0.02) base = 100;
    else if (drift <= 0.05) base = _lerpClip(drift, 0.02, 100, 0.05, 80);
    else if (drift <= 0.10) base = _lerpClip(drift, 0.05, 80, 0.10, 40);
    else base = _lerpClip(drift, 0.10, 40, 0.20, 0);
    // Phase 4r.hs.trajPenalty (#19) — ASYMMETRIC trajectory adjustment.
    // trajPerWk is direction-signed: + = moving toward target, − = away.
    // Reward moving the right way (up to +15) AND penalize moving the wrong
    // way, but GENTLER (down to −8). Rationale: a wrong-way trend is real
    // negative signal (so we penalize), but the base `drift` ramp already
    // drops as you move away from target — a full symmetric penalty would
    // double-count and over-react to noisy scale/BIA weeks. Smaller downside
    // acknowledges backsliding without amplifying noise.
    const trajPerWk = _trajectoryTowardTarget(ctx.weight, target, (r) => Number(r?.weightLbs), 28);
    if (trajPerWk != null && trajPerWk !== 0) {
      const raw = trajPerWk * 10;                          // ±0.5 lb/wk → ±5, 1.5 → 15
      const adj = Math.max(-8, Math.min(15, raw));         // reward to +15, penalize to −8
      base = Math.max(0, Math.min(100, base + adj));
    }
    return base;
  },

  // Body Fat % vs target — softer ramp than weight because body fat moves
  // slower and the standard healthy range is wider. ≤5% drift → 100→80,
  // ≤15% → 80→40, ≤30% → 40→0. Trajectory: 0.25%/wk → +5, 0.75%+ → +15.
  // Same 7-day median smoothing as weight — BIA body fat is even noisier
  // than weight (one bad-hydration morning can read 3-4% high).
  bodyFatVsTarget(ctx) {
    const target = parseFloat(ctx.goals?.targetBodyFat) || null;
    if (!target) return null;
    const val = _recentMedian(ctx.weight, (r) => Number(r?.bodyFatPct), 7);
    if (val == null) return null;
    const drift = Math.abs(val - target) / target;
    let base;
    if (drift <= 0.05) base = 100;
    else if (drift <= 0.15) base = _lerpClip(drift, 0.05, 100, 0.15, 80);
    else if (drift <= 0.30) base = _lerpClip(drift, 0.15, 80, 0.30, 40);
    else base = _lerpClip(drift, 0.30, 40, 0.50, 0);
    // Phase 4r.hs.trajPenalty (#19) — asymmetric (see weightVsTarget).
    // Body fat (BIA) is the noisiest signal, so the gentler downside matters
    // most here. Reward to +15, penalize only to −8.
    const trajPerWk = _trajectoryTowardTarget(ctx.weight, target, (r) => Number(r?.bodyFatPct), 28);
    if (trajPerWk != null && trajPerWk !== 0) {
      const raw = trajPerWk * 20;                          // ±0.25%/wk → ±5, 0.75 → 15
      const adj = Math.max(-8, Math.min(15, raw));         // reward to +15, penalize to −8
      base = Math.max(0, Math.min(100, base + adj));
    }
    return base;
  },

  // Lean mass vs target — field-aware. Some scales/sources report total lean
  // mass (everything that isn't fat); others report skeletal muscle mass
  // (a smaller subset, typically 40-42% of body weight in athletic adults).
  // The derived target has to match the source: total lean uses (1-BF%),
  // skeletal muscle uses ~0.42×targetWeight. Without this distinction we
  // were comparing 72 lb skeletal muscle to a 139 lb total-lean target and
  // tanking the score to 0 — even when the user was already at target.
  leanMassVsTarget(ctx) {
    let target = parseFloat(ctx.goals?.targetLeanMass) || null;
    // Detect which lean-mass field exists in the most recent row (some
    // sources provide totalLeanMass; Withings reports skeletalMuscleMassLbs).
    const mostRecent = [...ctx.weight].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .find(w => Number(w?.totalLeanMass) > 0
              || Number(w?.leanMassLbs)   > 0
              || Number(w?.skeletalMuscleMassLbs) > 0);
    if (!mostRecent) return null;
    const hasTotalLean = Number(mostRecent?.totalLeanMass) > 0 || Number(mostRecent?.leanMassLbs) > 0;
    // 7-day median over the same field type — BIA muscle mass swings too.
    const accessor = hasTotalLean
      ? (r) => Number(r?.totalLeanMass || r?.leanMassLbs)
      : (r) => Number(r?.skeletalMuscleMassLbs);
    const val = _recentMedian(ctx.weight, accessor, 7);
    if (!Number.isFinite(val) || val <= 0) return null;
    if (!target) {
      const tw  = parseFloat(ctx.goals?.targetWeight) || null;
      const tbf = parseFloat(ctx.goals?.targetBodyFat) || null;
      if (tw && tbf != null) {
        // Total lean = targetWeight × (1 - BF%). Skeletal muscle ≈ 42% of
        // body weight in athletic males (~38% for females). Single ratio for
        // now; can split by sex when profile carries that field reliably.
        target = hasTotalLean ? tw * (1 - tbf / 100) : tw * 0.42;
      }
    }
    if (!target) return null;
    const pct = val / target;
    if (pct >= 1.0) return 100;
    return _lerpClip(pct, 0.7, 0, 1.0, 100);
  },

  // Average Body Battery over last 3 sleep rows. Already 0-100.
  bodyBatteryAvg(ctx) {
    const recent = [...ctx.sleep].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .filter(s => Number(s?.bodyBatteryHigh) > 0).slice(0, 3);
    if (recent.length === 0) return null;
    const avg = recent.reduce((s, r) => s + Number(r.bodyBatteryHigh), 0) / recent.length;
    return Math.max(0, Math.min(100, avg));
  },

  // Monotony from Coach engine — low monotony is healthy training.
  // monotonyStrain signal carries .ratio (training load CV); we invert.
  monotonyHealth(_ctx, coachSignals) {
    const sig = coachSignals?.monotonyStrain;
    if (!sig) return null;
    // Use status as the primary signal — direct mapping. The numeric ratio
    // is in sig.monotonyRatio when present, but status already encodes it.
    if (sig.status == null) return null;
    return COACH_STATUS_TO_SCORE[sig.status] ?? null;
  },

  // Recovery velocity from Coach — direction × magnitude rolled up to status.
  recoveryTrend(_ctx, coachSignals) {
    const sig = coachSignals?.recoveryVelocity;
    if (!sig || sig.status == null) return null;
    return COACH_STATUS_TO_SCORE[sig.status] ?? null;
  },
};

// Compute the Outcome component for one system: run each declared resolver,
// drop nulls, average the rest. Returns { score, breakdown } where breakdown
// is { resolverName: scoreOrNull } for debug/inspection.
function _computeOutcomeComponent(systemId, ctx, coachSignals) {
  const cfg = SYSTEMS_V2_CONFIG[systemId];
  const names = cfg?.outcome || [];
  const breakdown = {};
  let sum = 0, n = 0;
  for (const name of names) {
    const fn = _OUTCOME_RESOLVERS[name];
    if (!fn) { breakdown[name] = null; continue; }
    let v;
    try { v = fn(ctx, coachSignals); } catch (e) { v = null; }
    breakdown[name] = v;
    if (v != null && Number.isFinite(v)) { sum += v; n += 1; }
  }
  return { score: n > 0 ? sum / n : null, breakdown };
}

// Compute the Coach component for one system from SYSTEM_COACH_SIGNALS map
// + the live coachSignals object. Drops signals with no usable status.
function _computeCoachComponent(systemId, coachSignals) {
  if (!coachSignals) return { score: null, breakdown: {} };
  const keys = SYSTEM_COACH_SIGNALS[systemId] || [];
  const breakdown = {};
  let sum = 0, n = 0;
  for (const key of keys) {
    const sig = coachSignals[key];
    const score = sig?.status != null ? COACH_STATUS_TO_SCORE[sig.status] : null;
    breakdown[key] = score != null ? score : null;
    if (score != null) { sum += score; n += 1; }
  }
  return { score: n > 0 ? sum / n : null, breakdown };
}

// Renormalize the present components and produce the final blended score.
function _blendComponents(systemId, outcome, coach, nutrition) {
  const weights = SYSTEMS_V2_CONFIG[systemId]?.weights || { outcome: 0.50, coach: 0.30, nutrition: 0.20 };
  const parts = [];
  if (outcome.score   != null) parts.push({ w: weights.outcome,   v: outcome.score });
  if (coach.score     != null) parts.push({ w: weights.coach,     v: coach.score });
  if (nutrition.score != null) parts.push({ w: weights.nutrition, v: nutrition.score });
  if (parts.length === 0) return null;
  const wSum = parts.reduce((s, p) => s + p.w, 0);
  const final = parts.reduce((s, p) => s + (p.w / wSum) * p.v, 0);
  return Math.round(Math.max(0, Math.min(100, final)));
}

// v2 system scorer. Returns the same { pct, gaps, wins } shape v1 does, plus
// an optional _debug payload (consumed only by window.hsScoreDebug).
function scoreSystemV2(system, nutrients, dateStr, coachSignals, ctxIn) {
  // Nutrition component reuses v1's exact math, demoted to one input.
  const v1 = scoreSystem(system, nutrients, dateStr);  // { pct, gaps, wins }
  let nutritionScore = v1.pct;
  let ifFallback = false;

  // IF morning fallback — Phase 4r.if.1. When today's nutrition is sparse
  // because the user is in their fasting window (not because they forgot to
  // log), evaluating against zero-intake today is misleading. Fall back to
  // yesterday's nutrition score so the system reads the user's TYPICAL
  // nutritional state rather than "0% protein because it's 9am."
  // Only fires for the TODAY scoring path — historical days score against
  // their own complete data as usual.
  if (dateStr === localDate()) {
    const todayCal = Number(nutrients?.calories) || 0;
    if (todayCal < 200 && _isInFastingWindow()) {
      try {
        const y = parseLocalDate(dateStr); y.setDate(y.getDate() - 1);
        const yesterday = ymd(y);
        const yNutrients = getDailyNutrients(yesterday);
        const yScore = scoreSystem(system, yNutrients, yesterday);
        if (yScore?.pct != null) {
          nutritionScore = yScore.pct;
          ifFallback = true;
        }
      } catch (e) { /* swallow — keep v1.pct as fallback */ }
    }
  }
  const nutritionComp = {
    score: nutritionScore,
    breakdown: ifFallback ? { v1Pct: v1.pct, ifFallback: nutritionScore } : { v1Pct: v1.pct },
  };

  const ctx = ctxIn || _buildOutcomeContext(dateStr);
  const outcomeComp = _computeOutcomeComponent(system.id, ctx, coachSignals);
  const coachComp   = _computeCoachComponent(system.id, coachSignals);

  const blended = _blendComponents(system.id, outcomeComp, coachComp, nutritionComp);
  const finalPct = blended != null ? blended : v1.pct; // null-safe fallback to v1

  return {
    pct: finalPct,
    gaps: v1.gaps,   // gaps/wins still come from nutrition — that's what they mean
    wins: v1.wins,
    _debug: {
      v1Pct: v1.pct,
      outcome: outcomeComp,
      coach: coachComp,
      nutrition: nutritionComp,
      weights: SYSTEMS_V2_CONFIG[system.id]?.weights || null,
      ifFallback,
      finalPct,
    },
  };
}

// Debug helper — call window.hsScoreDebug('sleep') in the console to see
// v1 vs v2 side-by-side with full component breakdown for the current day.
if (typeof window !== 'undefined') {
  window.hsScoreDebug = (systemId, dateStr) => {
    const sys = SYSTEMS.find(s => s.id === systemId);
    if (!sys) return { error: `no system "${systemId}"`, valid: SYSTEMS.map(s => s.id) };
    const day = dateStr || localDate();
    const { nutrients } = findBestNutrientDate(day);
    let coachSignals = null;
    try {
      const us = _v2ComputeUserState({
        activities:   storage.get('activities')   || [],
        sleep:        storage.get('sleep')        || [],
        hrv:          storage.get('hrv')          || [],
        weight:       storage.get('weight')       || [],
        nutritionLog: storage.get('nutritionLog') || [],
        wellness:     storage.get('wellness')     || [],
        planner:      storage.get('planner')      || null,
        profile:      { ...(storage.get('profile') || {}), ...getGoals() },
      });
      coachSignals = us?.coachSignals || null;
    } catch (e) { /* fallback: no coach signals → v2 still works */ }
    const v1 = scoreSystem(sys, nutrients, day);
    const v2 = scoreSystemV2(sys, nutrients, day, coachSignals);
    return {
      systemId, day,
      v1Pct: v1.pct, v2Pct: v2.pct, delta: v2.pct - v1.pct,
      components: v2._debug,
      flagOn: USE_V2_HS_SCORING,
    };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HS Scoring v2 — Validation harness (task #207)
// ═══════════════════════════════════════════════════════════════════════════
// Design doc §11. Runs v2 scoring against the last N days, pairs each day's
// score with a per-system "ground truth" signal (what actually happened),
// computes Spearman ρ / Pearson r / R² / residual SD / direction-agreement,
// plus a component-decomposition that asks "which component alone predicts
// best." Output is keyed by system and saved to storage.hsValidationHistory
// so 3-month trends are visible. Call via window.hsValidationReport(['sleep'])
// or window.hsValidationReport() for everything.

// ─── Statistical helpers ────────────────────────────────────────────────────
// Self-contained — no external stats lib needed. All return null when the
// input is too short or degenerate (e.g., all values identical).

function _mean(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

function _pearson(xs, ys) {
  if (!xs || !ys || xs.length !== ys.length || xs.length < 3) return null;
  const xm = _mean(xs), ym = _mean(ys);
  let num = 0, denx = 0, deny = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - xm, dy = ys[i] - ym;
    num += dx * dy; denx += dx * dx; deny += dy * dy;
  }
  if (denx === 0 || deny === 0) return null;
  return num / Math.sqrt(denx * deny);
}

// Convert to ranks with average-rank tie-breaking. Returns same-length array.
function _ranks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function _spearman(xs, ys) {
  return _pearson(_ranks(xs), _ranks(ys));
}

function _linRegR2(xs, ys) {
  const r = _pearson(xs, ys);
  return r != null ? r * r : null;
}

function _residualSD(xs, ys) {
  if (!xs || xs.length !== ys.length || xs.length < 3) return null;
  const xm = _mean(xs), ym = _mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - xm) * (ys[i] - ym);
    sxx += (xs[i] - xm) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = ym - slope * xm;
  let ssr = 0;
  for (let i = 0; i < xs.length; i++) {
    const pred = slope * xs[i] + intercept;
    ssr += (ys[i] - pred) ** 2;
  }
  return Math.sqrt(ssr / xs.length);
}

// Day-over-day direction agreement: of consecutive day pairs where both moved,
// how often did the score and the ground truth move in the same direction?
function _dirAgreement(xs, ys) {
  if (!xs || xs.length !== ys.length || xs.length < 2) return null;
  let agree = 0, total = 0;
  for (let i = 1; i < xs.length; i++) {
    const dx = Math.sign(xs[i] - xs[i-1]);
    const dy = Math.sign(ys[i] - ys[i-1]);
    if (dx === 0 || dy === 0) continue;
    total++;
    if (dx === dy) agree++;
  }
  return total > 0 ? agree / total : null;
}

// ─── Ground-truth resolvers per system ──────────────────────────────────────
// See design doc §11.2 for the rationale. Each resolver receives (dateStr,
// ctx) — the date the score was computed for, and the storage snapshot.
// Returns a numeric "what actually happened" value, or null when no usable
// truth is available (gut has no ground-truth signal yet).

function _nextDateStr(dateStr, daysAhead) {
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  d.setDate(d.getDate() + daysAhead);
  return ymd(d);
}

// Helper — average a numeric field across rows whose date sits in
// [start, end]. Returns null when fewer than `minN` rows have data.
function _avgFieldInWindow(rows, fieldOrFn, start, end, minN = 3) {
  if (!start || !end) return null;
  const accessor = typeof fieldOrFn === 'function' ? fieldOrFn : (r) => Number(r?.[fieldOrFn]);
  const vals = (rows || [])
    .filter(r => { const d = parseLocalDate(r?.date); return d && d >= start && d <= end; })
    .map(accessor)
    .filter(v => Number.isFinite(v) && v > 0);
  return vals.length >= minN ? _mean(vals) : null;
}

// HS Scoring v2 validation v1.1 — concurrent ground truths.
// Reframed from "does the score predict tomorrow?" (mostly no, that's
// random) to "does the score reflect the current state of the system?"
// Each ground truth uses concurrent (trailing or surrounding) data and
// chooses fields with at least PARTIAL independence from the score's
// own inputs — fully independent isn't possible without subjective
// signals (RPE, sick-day logs, etc.) which we don't yet collect.
const GROUND_TRUTH_RESOLVERS = {
  // Sleep — concurrent 7d Body Battery average preferred (sleep + stress
  // composite). Body Battery isn't always populated on backfilled rows,
  // so fall back to 7d sleep-score average when BB has < 3 valid points
  // in the window. Less ideal (more circular with score inputs) but keeps
  // the system measurable on accounts with sparse BB history.
  sleep(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 6);
    return _avgFieldInWindow(ctx.sleep, 'bodyBatteryHigh', start, end, 3)
        ?? _avgFieldInWindow(ctx.sleep, 'sleepScore',      start, end, 3);
  },
  // Heart — average HR during runs in the trailing 7d. Lower avg HR at
  // a given pace = better cardiac fitness. Independent of the HRV / RHR
  // baselines the score uses.
  heart(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 7);
    const runs = (ctx.activities || []).filter(a => {
      const d = parseLocalDate(a?.date);
      const t = (a?.garminTypeKey || a?.activityType || '').toLowerCase();
      return d && d > start && d <= end && /run|treadmill/.test(t);
    });
    const hrs = runs.map(r => Number(r?.avgHR)).filter(v => Number.isFinite(v) && v > 0);
    if (hrs.length < 3) return null;
    // Invert: lower avg HR = "higher" cardiac quality. Maps to a 0-100 scale
    // anchored at 120-180 bpm so the correlation reads naturally (positive
    // when both heart score and inverted HR are high).
    const avgHR = _mean(hrs);
    return Math.max(0, Math.min(100, 100 - (avgHR - 120) * (100 / 60)));
  },
  // Metabolism — trailing 14d weight median delta from target. Concurrent
  // state of "how close to weight goal" — uses the same weight field as
  // the score but a different window (score uses 7d median, truth uses
  // 14d median, so partial independence by smoothing).
  metabolism(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 14);
    const med = _recentMedian(
      (ctx.weight || []).filter(w => { const d = parseLocalDate(w?.date); return d && d >= start && d <= end; }),
      (r) => Number(r?.weightLbs), 14
    );
    if (med == null) return null;
    const target = parseFloat(ctx.goals?.targetWeight) || null;
    if (!target) return null;
    // 0-100 scaled by drift — same shape as weightVsTarget but at 14d window.
    const drift = Math.abs(med - target) / target;
    if (drift <= 0.02) return 100;
    if (drift <= 0.05) return 100 - (drift - 0.02) / 0.03 * 20;
    if (drift <= 0.10) return 80  - (drift - 0.05) / 0.05 * 40;
    return Math.max(0, 40 - (drift - 0.10) / 0.10 * 40);
  },
  // Endurance — hours completed in rolling 7d. Concurrent and direct.
  endurance(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 7);
    const secs = (ctx.activities || [])
      .filter(a => { const d = parseLocalDate(a?.date); return d && d > start && d <= end; })
      .reduce((s, a) => s + (Number(a?.durationSecs) || 0), 0);
    return secs > 0 ? secs / 3600 : null;
  },
  // Energy — trailing 3d Body Battery preferred, sleep score fallback.
  // 3 points in 3 days is tight; widen the fallback window to 7d so
  // sparse BB still leaves us a measurable ground truth.
  energy(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start3 = new Date(end); start3.setDate(start3.getDate() - 3);
    const start7 = new Date(end); start7.setDate(start7.getDate() - 7);
    return _avgFieldInWindow(ctx.sleep, 'bodyBatteryHigh', start3, end, 2)
        ?? _avgFieldInWindow(ctx.sleep, 'sleepScore',      start7, end, 3);
  },
  // Bones — strength sessions in trailing 14d (wider window for low
  // cardinality data — typical user does 1-3 sessions/wk, 14d gives
  // 2-6 data points instead of 0-2).
  bones(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 14);
    return (ctx.activities || []).filter(a => {
      const d = parseLocalDate(a?.date);
      return d && d > start && d <= end && /strength|weight|gym/i.test(a?.activityType || '');
    }).length;
  },
  // Brain — 7d Body Battery (cognition proxy via recovery state, since
  // we don't measure cognition directly). Better than next-night sleep
  // score which is too noisy.
  brain(dateStr, ctx) { return GROUND_TRUTH_RESOLVERS.sleep(dateStr, ctx); },
  // Immune — trailing 7d HRV mean. Concurrent recovery state. Uses HRV
  // from the sleep rows directly (mostly indep of score's RHR component).
  immune(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 7);
    return _avgFieldInWindow(ctx.sleep, 'overnightHRV', start, end);
  },
  // Longevity — distinct training days in rolling 30d. Concurrent
  // consistency measure. Unchanged from v1.
  longevity(dateStr, ctx) {
    const end = parseLocalDate(dateStr); if (!end) return null;
    const start = new Date(end); start.setDate(start.getDate() - 30);
    const days = new Set();
    (ctx.activities || []).forEach(a => {
      const d = parseLocalDate(a?.date);
      if (d && d > start && d <= end) days.add(a.date);
    });
    return days.size;
  },
  // Gut — still no usable ground truth (needs subjective inputs).
  gut: () => null,
};

// Per-system window override — slow-moving signals (bones, longevity)
// need a wider window for statistical power; daily-frequency signals
// (sleep, energy) can use the default 14.
const VALIDATION_WINDOW = {
  bones: 30,
  longevity: 30,
  metabolism: 21,  // weight moves slowly — give 3 weeks
};

// ─── Main report function ──────────────────────────────────────────────────
// daysBack: trailing window (default 14, per design doc §11.1).
// systemIds: optional filter — restrict to specific systems.
export function runValidationReport(daysBack = 14, systemIds = null) {
  const today = localDate();
  const ctx = _buildOutcomeContext(today);
  const coachSignals = _v2ResolveCoachSignals();

  const allSystems = systemIds
    ? SYSTEMS.filter(s => systemIds.includes(s.id))
    : SYSTEMS;
  const results = {};

  for (const sys of allSystems) {
    const dates = [];
    const scores = [];
    const groundTruths = [];
    const outcomeArr = [];
    const coachArr = [];
    const nutritionArr = [];

    // Per-system window override — slow-moving signals (bones, longevity,
    // metabolism) need wider windows for statistical power. Defaults to
    // the caller-supplied daysBack otherwise.
    const sysWindow = VALIDATION_WINDOW[sys.id] || daysBack;

    // Walk D=sysWindow..1 (oldest → newest, skipping today itself —
    // some ground truths still need today+future days to settle).
    for (let i = sysWindow; i >= 1; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = ymd(d);
      const dayCtx = _buildOutcomeContext(dateStr);
      const { nutrients } = findBestNutrientDate(dateStr);
      const result = scoreSystemV2(sys, nutrients, dateStr, coachSignals, dayCtx);
      const gt = GROUND_TRUTH_RESOLVERS[sys.id]?.(dateStr, ctx);
      if (result?.pct == null || gt == null) continue;
      dates.push(dateStr);
      scores.push(result.pct);
      groundTruths.push(gt);
      outcomeArr.push(result._debug?.outcome?.score ?? null);
      coachArr.push(result._debug?.coach?.score ?? null);
      nutritionArr.push(result._debug?.nutrition?.score ?? null);
    }

    if (scores.length < 5) {
      results[sys.id] = { n: scores.length, error: 'insufficient_data' };
      continue;
    }

    const ρ = _spearman(scores, groundTruths);
    const r = _pearson(scores, groundTruths);
    const r2 = _linRegR2(scores, groundTruths);
    const resSD = _residualSD(scores, groundTruths);
    const dirAgree = _dirAgreement(scores, groundTruths);

    // Component decomposition — drop nulls and check each component's
    // standalone predictive power. The one that wins tells us which way
    // to shift weights if the blended ρ is weak.
    const _filterPairs = (compArr) => {
      const xs = [], ys = [];
      for (let i = 0; i < compArr.length; i++) {
        if (compArr[i] != null) { xs.push(compArr[i]); ys.push(groundTruths[i]); }
      }
      return { xs, ys };
    };
    const oPair = _filterPairs(outcomeArr);
    const cPair = _filterPairs(coachArr);
    const nPair = _filterPairs(nutritionArr);
    // Variance check (v1.1) — components with near-zero variance get a
    // spuriously high "best" ranking because any noise in the ground truth
    // looks correlated with them. Compute the SD of each component over
    // its window; if SD is < 5 score points, exclude from best-component
    // selection. Stops the "nutrition wins because it swings hard" artifact.
    const _sd = (arr) => {
      if (!arr || arr.length < 2) return 0;
      const m = _mean(arr);
      const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
      return Math.sqrt(v);
    };
    const sdMin = 5;
    const componentρ = {
      outcome:   oPair.xs.length >= 3 && _sd(oPair.xs) >= sdMin ? _spearman(oPair.xs, oPair.ys) : null,
      coach:     cPair.xs.length >= 3 && _sd(cPair.xs) >= sdMin ? _spearman(cPair.xs, cPair.ys) : null,
      nutrition: nPair.xs.length >= 3 && _sd(nPair.xs) >= sdMin ? _spearman(nPair.xs, nPair.ys) : null,
    };
    // Component-SD also reported so the user can see why a "best" came
    // back null (component was too flat over the window).
    const componentSD = {
      outcome:   +(_sd(oPair.xs)).toFixed(1),
      coach:     +(_sd(cPair.xs)).toFixed(1),
      nutrition: +(_sd(nPair.xs)).toFixed(1),
    };
    let bestComponent = null;
    let bestRho = -Infinity;
    for (const [k, v] of Object.entries(componentρ)) {
      if (v != null && v > bestRho) { bestComponent = k; bestRho = v; }
    }

    // Decision rule from design doc §11.4.
    let recommendation;
    if (ρ == null) {
      recommendation = 'insufficient signal';
    } else if (ρ >= 0.5 && dirAgree != null && dirAgree >= 0.65) {
      recommendation = 'keep weights';
    } else if (ρ >= 0.3) {
      recommendation = bestComponent ? `investigate — try shifting weight toward ${bestComponent}` : 'investigate';
    } else if (ρ >= 0) {
      recommendation = bestComponent ? `re-tune — ${bestComponent} carries the predictive signal` : 're-tune';
    } else {
      recommendation = 'flag for redesign — score predicts inversely to ground truth';
    }

    results[sys.id] = {
      n: scores.length,
      window: sysWindow,
      spearman:   ρ        != null ? +ρ.toFixed(3)    : null,
      pearson:    r        != null ? +r.toFixed(3)    : null,
      r2:         r2       != null ? +r2.toFixed(3)   : null,
      residualSD: resSD    != null ? +resSD.toFixed(2): null,
      dirAgree:   dirAgree != null ? +(dirAgree).toFixed(2) : null,
      componentRho: componentρ,
      componentSD,                      // v1.1: how flat each component was
      bestComponent,
      recommendation,
    };
  }

  // Persist history so 3-month trends are visible.
  try {
    const history = storage.get('hsValidationHistory') || [];
    history.push({ ranAt: Date.now(), daysBack, results });
    while (history.length > 50) history.shift();
    storage.set('hsValidationHistory', history, { skipValidation: true });
  } catch (e) { /* non-fatal */ }

  return results;
}

// ─── Console-friendly helper ──────────────────────────────────────────────
// Call window.hsValidationReport() in DevTools to see the report as a table.
// Pass an array of system ids to filter — e.g. hsValidationReport(['sleep']).
if (typeof window !== 'undefined') {
  window.hsValidationReport = (systemIds = null) => {
    const r = runValidationReport(14, systemIds);
    const rows = Object.entries(r).map(([id, x]) => ({
      id,
      n: x.n,
      ρ: x.spearman,
      r: x.pearson,
      'R²': x.r2,
      residSD: x.residualSD,
      'dir%': x.dirAgree != null ? Math.round(x.dirAgree * 100) + '%' : null,
      best: x.bestComponent,
      'best ρ': x.componentRho?.[x.bestComponent] != null
        ? +x.componentRho[x.bestComponent].toFixed(3) : null,
      rec: x.recommendation || x.error,
    }));
    console.table(rows);
    return r;
  };
  // Read back saved history (last 50 runs).
  window.hsValidationHistory = () => storage.get('hsValidationHistory') || [];
}

// ─── Auto-run on boot if last validation was > 14 days ago ─────────────────
// Biweekly cadence from design doc §11.1. Module-load fires once per app
// session; the TTL gate keeps it from re-running on repeat opens within the
// same 14-day window. The 5s deferred timer lets cloud-sync land first so
// the validation sees the freshest data, not whatever was in IndexedDB
// from yesterday.
if (typeof window !== 'undefined' && typeof setTimeout !== 'undefined') {
  setTimeout(() => {
    try {
      const history = storage.get('hsValidationHistory') || [];
      const last = history[history.length - 1];
      const FOURTEEN_DAYS_MS = 14 * 86400000;
      if (!last || (Date.now() - last.ranAt) > FOURTEEN_DAYS_MS) {
        if (typeof console !== 'undefined') {
          console.log('[HS v2 validation] Running biweekly validation report…');
        }
        const r = runValidationReport(14);
        // Surface anything that wants tuning. Silent on "keep weights" runs.
        const flagged = Object.entries(r).filter(([, x]) =>
          x?.recommendation && /(re-tune|redesign|investigate)/.test(x.recommendation));
        if (typeof console !== 'undefined') {
          if (flagged.length > 0) {
            console.warn(
              '[HS v2 validation] Systems flagged for tuning attention:',
              flagged.map(([id, x]) => `${id} (${x.recommendation})`).join('; '),
              '— call window.hsValidationReport() for the full table.'
            );
          } else {
            console.log('[HS v2 validation] All systems within healthy correlation thresholds.');
          }
        }
      }
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[HS v2 validation] auto-run failed:', e?.message || e);
    }
  }, 5000);
}

// ═══════════════════════════════════════════════════════════════════════════
// End HS Scoring v2
// ═══════════════════════════════════════════════════════════════════════════

// ─── Full report for UI ─────────────────────────────────────────────────────
// Find the most recent date with nutrition data (food or Cronometer)
function findBestNutrientDate(dateStr) {
  // Always use the requested date — no fallback to previous days.
  // If nothing is logged yet today, scores reflect that (supplements only).
  const nutrients = getDailyNutrients(dateStr);
  return { nutrients, dateUsed: dateStr };
}

export function getSystemsReport(dateStr, opts = {}) {
  const { nutrients, dateUsed } = findBestNutrientDate(dateStr);
  const isStale = dateUsed !== dateStr;
  // v2 wiring: caller can pass coachSignals to skip the redundant compute.
  // When the flag is on and no coachSignals provided, we compute once here
  // and reuse across all 10 systems (single computeUserState call, not 10).
  const coachSignals = USE_V2_HS_SCORING
    ? (opts.coachSignals ?? _v2ResolveCoachSignals())
    : null;
  const ctx = USE_V2_HS_SCORING ? _buildOutcomeContext(dateUsed) : null;
  return SYSTEMS.map(sys => {
    const { pct, gaps, wins } = USE_V2_HS_SCORING
      ? scoreSystemV2(sys, nutrients, dateUsed, coachSignals, ctx)
      : scoreSystem(sys, nutrients, dateUsed);
    let status;
    if (pct >= 80) status = 'good';
    else if (pct >= 50) status = 'focus';
    else status = 'def';
    return {
      id: sys.id,
      name: sys.name,
      color: sys.color,
      pct,
      status,
      comment: isStale ? `Based on ${dateUsed}` : makeComment(pct, gaps, wins),
      dateUsed,
    };
  });
}

// Internal helper: build coachSignals from userState when the API caller
// didn't pass them. Failure-safe — returns null on any error so v2 falls
// through to its Coach-component-null branch instead of crashing.
function _v2ResolveCoachSignals() {
  try {
    const us = _v2ComputeUserState({
      activities:   storage.get('activities')   || [],
      sleep:        storage.get('sleep')        || [],
      hrv:          storage.get('hrv')          || [],
      weight:       storage.get('weight')       || [],
      nutritionLog: storage.get('nutritionLog') || [],
      wellness:     storage.get('wellness')     || [],
      planner:      storage.get('planner')      || null,
      profile:      { ...(storage.get('profile') || {}), ...getGoals() },
    });
    return us?.coachSignals || null;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[HSv2] coach signal resolve failed:', e?.message || e);
    return null;
  }
}

// ─── Detailed breakdown for a single system ────────────────────────────────
// Returns per-nutrient scores, targets, and values for the expanded tile view.
export function getSystemDetail(systemId, dateStr, opts = {}) {
  const sys = SYSTEMS.find(s => s.id === systemId);
  if (!sys) return null;
  const { nutrients, dateUsed } = findBestNutrientDate(dateStr);
  const targets = getOptimalTargets(dateUsed);
  // v2: same shape as v1, but the pct comes from the blended score. The
  // details[] array below is unchanged — still nutrient breakdown — because
  // that's what the panel's Nutrient/Bioactive sections render.
  const coachSignals = USE_V2_HS_SCORING
    ? (opts.coachSignals ?? _v2ResolveCoachSignals())
    : null;
  const ctx = USE_V2_HS_SCORING ? _buildOutcomeContext(dateUsed) : null;
  const { pct: systemPct } = USE_V2_HS_SCORING
    ? scoreSystemV2(sys, nutrients, dateUsed, coachSignals, ctx)
    : scoreSystem(sys, nutrients, dateUsed);
  const details = [];
  for (const [nutr, weight] of Object.entries(sys.weights)) {
    let value = nutrients[nutr] || 0;
    if (nutr === 'Vitamin D')    value += nutrients['Vitamin D3 (cholecalciferol)'] || 0;
    if (nutr === 'Vitamin B12')  value += nutrients['Vitamin B12 (methylcobalamin)'] || 0;
    if (nutr === 'Magnesium')    value += nutrients['Elemental Magnesium'] || 0;
    const target = targets[nutr] || 100;
    const pct = Math.round(Math.min(value / target, 1.2) * 100);
    details.push({ nutrient: nutr, short: shortName(nutr), value: Math.round(value), target: Math.round(target), pct, weight });
  }
  details.sort((a, b) => a.pct - b.pct);
  return { system: { ...sys, pct: systemPct }, details };
}

// ─── Coach Read for a Health System — Phase 4r.intel.upgrade.1 ─────────────
// Maps each Health System to the Coach engine signals most relevant to it,
// then composes a "mechanism + action" read from the userState. Used by the
// upgraded SystemDetail panel so clicking a system tile shows the Coach's
// view of WHY it's at the current score, not just what nutrients fed it.
//
// Each entry lists the coachSignal keys (from intelligence.js userState.
// coachSignals) that drive this system. Tiles are rendered in declaration
// order. Signals without data are filtered out at render time.
export const SYSTEM_COACH_SIGNALS = {
  sleep:      ['sleepDebt', 'sleepQuality', 'hrvDepression', 'rhrDrift', 'sleepHrvCorrelation', 'recoveryVelocity'],
  heart:      ['hrvDepression', 'rhrDrift', 'recoveryVelocity'],
  energy:     ['energyAvailability', 'glycogen', 'tdeeDrift', 'monotonyStrain', 'prefuel'],
  endurance:  ['polarization', 'monotonyStrain', 'dowPatterns', 'recoveryVelocity', 'prefuel'],
  bones:      ['monotonyStrain', 'recoveryVelocity', 'goalProgress'],
  immune:     ['sleepDebt', 'monotonyStrain', 'hrvDepression', 'recoveryVelocity'],
  brain:      ['sleepDebt', 'sleepQuality', 'hrvDepression', 'sleepHrvCorrelation'],
  metabolism: ['tdeeDrift', 'energyAvailability', 'glycogen', 'goalProgress'],
  // Gut/Digestion: the engine's gut-specific signals (fiber rhythm, meal-
  // timing variability, hydration patterns) aren't computed yet, so we use
  // adjacent signals that touch gut function via the inflammation /
  // recovery / fueling axis. Real gut signals are a future build.
  gut:        ['glycogen', 'energyAvailability', 'tdeeDrift', 'monotonyStrain'],
  longevity:  ['polarization', 'goalProgress', 'raceHorizon'],
};

// Status → display color (mirrors Coach voice's dot colors).
const SIG_STATE_COLOR = {
  severe: '#f87171', concerning: '#f87171', concern: '#f87171',
  moderate: '#fbbf24', warning: '#fbbf24', attention: '#fbbf24', impaired: '#fbbf24',
  slowing: '#fbbf24', adapting: '#fbbf24', depleted: '#fbbf24', 'grey-zone': '#fbbf24',
  mild: '#fbbf24', rising: '#fbbf24', mixed: '#fbbf24', hot: '#fbbf24', low: '#fbbf24',
  positive: '#4ade80', paid: '#4ade80', stable: '#4ade80', recovered: '#4ade80',
  'sparse-easy': '#fbbf24', info: 'var(--text-secondary)',
};

// Display formatter — turns the raw signal object into { label, value, unit,
// state, headline, color }. Returns null when the signal has no usable data
// (so the renderer can hide the tile entirely).
function formatCoachSignalTile(key, sig) {
  if (!sig) return null;
  const colorFor = (s) => SIG_STATE_COLOR[s] || 'var(--text-secondary)';

  switch (key) {
    case 'sleepDebt': {
      const debt = sig.debt7d ?? sig.debt;
      const avg = sig.avgHours7d ?? sig.avgHours;
      if (debt == null && avg == null) return null;
      return {
        label: 'Sleep debt',
        value: debt != null ? debt.toFixed(1) : '—',
        unit: 'h short',
        state: sig.status,
        color: colorFor(sig.status),
        headline: avg != null ? `${avg.toFixed(1)}h avg vs ${sig.targetHours || 8}h target` : null,
      };
    }
    case 'sleepQuality': {
      if (sig.status == null || sig.status === 'insufficient-data') return null;
      return {
        label: 'Sleep quality',
        value: sig.score != null ? Math.round(sig.score) : '—',
        unit: '/100',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'hrvDepression': {
      if (sig.latest == null) return null;
      return {
        label: 'HRV vs baseline',
        value: sig.latest != null ? Math.round(sig.latest) : '—',
        unit: 'ms',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.depressionPct != null
          ? `${Math.round(Math.abs(sig.depressionPct))}% ${sig.depressionPct < 0 ? 'below' : 'above'} 28d baseline (${sig.baseline28d?.toFixed?.(1) || sig.baseline28d})`
          : null,
      };
    }
    case 'rhrDrift': {
      if (sig.latest == null) return null;
      const slope = sig.slopeBpmPerWeek;
      return {
        label: 'RHR trend',
        value: sig.latest != null ? Math.round(sig.latest) : '—',
        unit: 'bpm',
        state: sig.status,
        color: colorFor(sig.status),
        headline: slope != null
          ? `${slope > 0 ? '+' : ''}${slope.toFixed(1)} bpm/wk over baseline ${sig.baseline28d?.toFixed?.(0) || sig.baseline28d}`
          : null,
      };
    }
    case 'sleepHrvCorrelation': {
      if (sig.r == null || sig.status === 'insufficient-data') return null;
      return {
        label: 'Sleep → HRV',
        value: sig.r.toFixed(2),
        unit: 'r',
        state: sig.status,
        color: colorFor(sig.status),
        headline: `Personal correlation (n=${sig.n})${sig.surfaceable ? ' · reliable' : ''}`,
      };
    }
    case 'recoveryVelocity': {
      if (sig.status == null || sig.status === 'insufficient-data') return null;
      return {
        label: 'Recovery velocity',
        value: sig.daysToBaseline != null ? sig.daysToBaseline.toFixed(1) : '—',
        unit: 'days',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || (sig.daysToBaseline != null ? `Avg days to baseline after hard sessions` : null),
      };
    }
    case 'energyAvailability': {
      if (sig.eaKcalPerKgLbm == null) return null;
      return {
        label: 'Energy availability',
        value: sig.eaKcalPerKgLbm != null ? sig.eaKcalPerKgLbm.toFixed(0) : '—',
        unit: 'kcal/kg LBM',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'glycogen': {
      if (sig.estimatedStores == null && sig.status == null) return null;
      return {
        label: 'Glycogen',
        value: sig.estimatedStores != null ? Math.round(sig.estimatedStores) : '—',
        unit: '%',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'tdeeDrift': {
      if (sig.driftPct == null) return null;
      return {
        label: 'TDEE drift',
        value: sig.driftPct != null ? `${sig.driftPct > 0 ? '+' : ''}${sig.driftPct.toFixed(0)}` : '—',
        unit: '%',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'monotonyStrain': {
      if (sig.monotony == null) return null;
      // Phase 4r.coach.monotony.fix.1 — drop the cryptic "Strain 5102" prefix
      // from the headline. The raw Foster strain number (monotony × weekly
      // training load in kcal) is meaningless without context; the status word
      // ('hot' / 'rising' / 'stable' / etc.) already carries the actionable
      // interpretation. Keep sig.note (the actionable advice) and translate
      // the status into a human phrase. Raw strain is still available in
      // the underlying signal object for debug / advanced views.
      const statusPhrase =
        sig.status === 'hot'        ? 'high strain'    :
        sig.status === 'rising'     ? 'strain rising'  :
        sig.status === 'concerning' ? 'strain high'    :
        sig.status === 'attention'  ? 'strain rising'  :
        sig.status === 'moderate'   ? 'moderate strain':
        sig.status === 'mild'       ? 'mild strain'    :
        sig.status === 'positive'   ? 'strain healthy' :
        sig.status === 'stable'     ? 'strain steady'  : null;
      const parts = [statusPhrase, sig.note].filter(Boolean);
      return {
        label: 'Training monotony',
        value: sig.monotony != null ? sig.monotony.toFixed(2) : '—',
        unit: '',
        state: sig.status,
        color: colorFor(sig.status),
        headline: parts.length ? parts.join(' · ') : null,
      };
    }
    case 'polarization': {
      if (sig.index == null) return null;
      return {
        label: 'Polarization',
        value: sig.index != null ? sig.index.toFixed(2) : '—',
        unit: '',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'dowPatterns': {
      if (!sig.weakestDay && !sig.note) return null;
      return {
        label: 'Day-of-week pattern',
        value: sig.weakestDay || '—',
        unit: '',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'goalProgress': {
      if (!sig.status) return null;
      return {
        label: 'Goal progress',
        value: sig.deltaLbs != null ? `${sig.deltaLbs > 0 ? '+' : ''}${sig.deltaLbs.toFixed(1)}` : '—',
        unit: 'lb vs plan',
        state: sig.status,
        color: colorFor(sig.status),
        headline: sig.note || null,
      };
    }
    case 'raceHorizon': {
      if (!sig.race || sig.daysOut == null) return null;
      return {
        label: 'Race horizon',
        value: sig.daysOut === 0 ? 'today' : sig.daysOut < 0 ? `${-sig.daysOut}d ago` : `T-${sig.daysOut}`,
        unit: '',
        state: sig.phase === 'race-week' ? 'concerning' : sig.phase === 'recovery' ? 'positive' : 'info',
        color: colorFor(sig.phase === 'race-week' ? 'attention' : 'info'),
        headline: `${sig.race.name || 'Race'} · ${sig.phaseLabel || sig.phase}`,
      };
    }
    case 'prefuel': {
      if (!sig.status || sig.status === 'no-data' || sig.status === 'rest-day') return null;
      // Status maps to severity colors:
      //   sufficient → positive, low → attention, inadequate → concerning
      const stateMap = {
        sufficient: 'positive',
        low:        'attention',
        inadequate: 'concerning',
      };
      const state = stateMap[sig.status] || 'info';
      return {
        label: 'Prefuel',
        value: sig.todayCarbsG != null ? `${sig.todayCarbsG}g` : '—',
        unit: sig.targetCarbsG ? `/ ${sig.targetCarbsG}g` : '',
        state,
        color: colorFor(state),
        headline: sig.note || null,
      };
    }
    default:
      return null;
  }
}

/**
 * Compose the Coach's read of a system. Returns:
 *   {
 *     systemId,
 *     signals: [ {label, value, unit, state, color, headline}, ... ],
 *     coachLine: string|null,   // ONE concise Coach-voice sentence
 *     tone: 'gentle'|'positive'|'neutral',
 *   }
 * or null if no signals have data for this system yet. The line is rendered
 * with the Coach sigil — no colored container — so there's a single voice
 * per panel, not multiple bordered boxes competing for attention.
 */
export function getSystemCoachRead(systemId, coachSignals) {
  // Strict filter — drop tiles that have no real primary value (a "—"
  // placeholder is just visual noise, even when the signal's status is
  // computed). A tile must carry a meaningful number/string to render.
  const keys = coachSignals ? (SYSTEM_COACH_SIGNALS[systemId] || []) : [];
  const tiles = keys
    .map(k => formatCoachSignalTile(k, coachSignals[k]))
    .filter(t => t && t.value != null && t.value !== '—' && t.value !== '');

  // Fallback voice — when no Coach signals fire for this system today, we
  // still give the Coach a presence rather than going silent. The line is
  // honest about what the engine knows + what drives the system from the
  // user's daily inputs (which the panel surfaces below in nutrients +
  // bioactives). Each system gets a tailored fallback so the voice doesn't
  // feel generic. Returns no signals, so the tile grid simply doesn't
  // render — the sigil + line stand on their own.
  if (tiles.length === 0) {
    const FALLBACK = {
      sleep:      `No acute sleep signals firing — consistency is the lever; the daily rhythm builds the score over time.`,
      heart:      `No acute cardiovascular signals firing — recovery and aerobic base both work in your favor here.`,
      energy:     `Energy systems quiet — keep fueling with the training, that's what makes the gauge needle move.`,
      endurance:  `No acute training signals — the work you already log is what builds this, week over week.`,
      bones:      `No acute load signals — strength frequency + protein + Vit D are the daily levers here.`,
      immune:     `Immune system quiet — that's the goal. Sleep and recovery do the unseen work.`,
      brain:      `No acute cognition signals — sleep, omega-3s, and physical activity carry this system.`,
      metabolism: `Metabolism running steady — calorie consistency + protein adequacy + training stack to drive this.`,
      gut:        `Gut signals are thin in the engine today — fiber, fermented foods, regular meal timing, and hydration are the daily inputs that drive this system. Real gut-specific signals (fiber rhythm, meal cadence) are a future build.`,
      longevity:  `Long arc looks like the daily pattern — bioactives + polarization + steady macros compound over months, not days.`,
    };
    const coachLine = FALLBACK[systemId] || `${systemId} sits quietly today — daily inputs (nutrients + supplements + training) are the levers.`;
    return { systemId, signals: [], coachLine, tone: 'neutral' };
  }

  // Lead signal — the most pressing one drives the voice.
  const SEVERITY_RANK = { severe: 4, concerning: 4, concern: 4, moderate: 3, warning: 3,
                          attention: 3, slowing: 3, depleted: 3, rising: 3, 'grey-zone': 3,
                          mild: 2, mixed: 2, info: 1, positive: 0, paid: 0, stable: 0 };
  const leadTile = [...tiles].sort((a, b) =>
    (SEVERITY_RANK[b.state] ?? 1) - (SEVERITY_RANK[a.state] ?? 1)
  )[0];

  // Tone for the sigil dot — drives subtle colour only on the icon, not on a
  // container around the text.
  const tone = (SEVERITY_RANK[leadTile.state] ?? 1) >= 3 ? 'gentle'
             : (SEVERITY_RANK[leadTile.state] ?? 1) === 0 ? 'positive'
             : 'neutral';

  // Single concise sentence. Pattern: {what's happening} — {what to do}.
  // Per-system actions are tuned so the second clause is specific, not
  // generic. The first clause leans on the lead signal's headline for
  // numbers, so the voice always grounds itself in real data.
  // Phase 4r.intel.upgrade.4 — preserve natural casing on label + headline
  // so acronyms (HRV, RHR, EPA, DHA, TDEE, etc.) stay uppercase. The label
  // already opens with a capital ("Sleep debt" / "HRV vs baseline"), so
  // the line is properly sentence-cased without any lowercasing.
  const hl = leadTile.headline || '';
  const ctx = hl ? `${leadTile.label} — ${hl}` : `${leadTile.label} is the active read`;

  const act = (() => {
    const state = leadTile.state;
    const severe = state === 'severe' || state === 'concerning' || state === 'concern';
    const positive = state === 'positive' || state === 'paid' || state === 'stable';

    switch (systemId) {
      case 'sleep':
        return severe   ? `bank tonight's sleep, it's the highest-yield change this week`
             : positive ? `keep the rhythm, recovery window is open`
             :            `protect the next two nights to rebuild the pattern`;
      case 'heart':
      case 'immune':
        return severe   ? `ease the load until HRV and RHR re-stabilize`
             : positive ? `cardiovascular signal is calm, capacity is there`
             :            `watch the trend through the next hard day`;
      case 'energy':
      case 'metabolism':
        return severe   ? `tighten fueling around training, protect protein and carbs`
             : positive ? `fueling pattern is supporting the work`
             :            `keep the macro skew tilted toward what the training asks for`;
      case 'endurance':
        return severe   ? `polarize the week — clearer easy days vs clearer hard days`
             : positive ? `aerobic engine is responding, hold the structure`
             :            `look at the time-in-zone mix this week`;
      case 'brain':
        return severe   ? `cognition tracks sleep — tonight is the lever`
             : positive ? `sleep + HRV are supporting clarity`
             :            `protect a wind-down window tonight`;
      case 'longevity':
        return positive ? `long-arc pattern is holding`
             :            `the long arc looks like the daily pattern, keep showing up`;
      case 'bones':
        return severe   ? `recovery between strength sessions matters more than load right now`
             :            `keep loading + recovery balanced across the week`;
      case 'gut':
        return severe   ? `regular fueling rhythm restores this faster than supplements`
             :            `steady meal timing keeps this stable`;
      default:
        return positive ? `pattern is supporting the goals` : `another data point will sharpen the read`;
    }
  })();

  // Capitalize the first character so the Coach voice always starts with a
  // capital letter — same convention as every other Coach surface (digest,
  // EdgeIQ leverage, Play/Fuel state).
  const raw = `${ctx} — ${act}.`;
  const coachLine = raw.charAt(0).toUpperCase() + raw.slice(1);

  return { systemId, signals: tiles, coachLine, tone };
}

// ─── EdgeIQ debug helper (window.edgeIQDebug) ──────────────────────────────
// Prints the full per-system per-nutrient breakdown so you can see exactly
// which nutrient is dragging a system score down — including raw value,
// target, pct, and where the value came from. Call from the browser console:
//   edgeIQDebug()
// or for a specific date:
//   edgeIQDebug('2026-04-30')
export function edgeIQDebug(dateStr) {
  const d = new Date();
  const today = dateStr || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const { nutrients } = findBestNutrientDate(today);
  const targets = getOptimalTargets(today);
  console.log('%c=== EdgeIQ DEBUG · ' + today + ' ===', 'color:#6fd4e4;font-weight:700');
  console.log('Daily nutrients (food + supplements taken):', nutrients);
  for (const sys of SYSTEMS) {
    const { pct } = scoreSystem(sys, nutrients, today);
    console.log(`%c${sys.name} — ${pct}%`, 'color:#9ece6a;font-weight:700');
    const rows = [];
    for (const [nutr, w] of Object.entries(sys.weights)) {
      let value = nutrients[nutr] || 0;
      if (nutr === 'Vitamin D')   value += nutrients['Vitamin D3 (cholecalciferol)'] || 0;
      if (nutr === 'Vitamin B12') value += nutrients['Vitamin B12 (methylcobalamin)'] || 0;
      if (nutr === 'Magnesium')   value += nutrients['Elemental Magnesium'] || 0;
      const target = targets[nutr] || 100;
      const npct = Math.round(Math.min(value / target, 1.2) * 100);
      rows.push({ nutrient: nutr, value: Math.round(value*100)/100, target: Math.round(target), pct: npct, weight: w });
    }
    console.table(rows);
  }
  // Surface ALL nutrient keys that are NON-ZERO but NOT referenced by any
  // SYSTEMS weight — these are orphan keys (catalog name didn't normalize
  // to a SYSTEMS canonical key).
  const referenced = new Set();
  for (const sys of SYSTEMS) for (const k of Object.keys(sys.weights)) referenced.add(k);
  // Implicit aliases scoreSystem checks
  referenced.add('Vitamin D3 (cholecalciferol)');
  referenced.add('Vitamin B12 (methylcobalamin)');
  referenced.add('Elemental Magnesium');
  const orphans = Object.entries(nutrients)
    .filter(([k, v]) => v > 0 && !referenced.has(k))
    .map(([k, v]) => ({ name: k, value: Math.round(v*100)/100 }));
  if (orphans.length) {
    console.log('%cORPHAN nutrients (have value but no SYSTEMS weight references them):', 'color:#f87171;font-weight:700');
    console.table(orphans);
  }
}
if (typeof window !== 'undefined') window.edgeIQDebug = edgeIQDebug;

// ─── Per-micronutrient source breakdown — window.microsDebug ───────────────
// Prints exactly where the displayed value for a single nutrient comes from:
// what Cronometer's live cache reports, what food estimation contributes,
// and which supplements (with amounts) add to it. Use to reconcile against
// Cronometer when a tile's % feels off.
//   microsDebug('Vitamin B12')        // today
//   microsDebug('Vitamin B12', '2026-05-27')
//   microsDebug()                     // dump for all micros + cronometer key map
export function microsDebug(name, dateStr) {
  // Phase 4r.fuel.16 — if no date specified, prefer the most recent date with
  // ANY logged data (food or supps). Defaulting to "today" before Cronometer
  // syncs or any supps are ticked gave a misleading "all zeros" output that
  // looked like a bug when it was just no-data-yet.
  let today = dateStr;
  if (!today) {
    try {
      const best = findBestNutrientDate(localDate());
      today = best?.dateUsed || localDate();
    } catch {
      today = localDate();
    }
  }
  // 1. Cronometer raw totals — show ALL keys so the actual Cronometer column
  //    names are visible (this is where µg-vs-mcg mismatches surface).
  let cronoTotals = null;
  try {
    const live = storage.get('cronometerLive') || {};
    cronoTotals = live[today]?.totals || null;
  } catch {}
  console.log('%c=== microsDebug · ' + today + (dateStr ? '' : ' (auto: most recent with data)') + ' ===', 'color:#22d3ee;font-weight:700');
  if (cronoTotals) {
    const microKeys = Object.keys(cronoTotals).filter(k => /b12|cobalamin|folate|selenium|vit|magnesium|iron|zinc|calcium|chromium|biotin|potassium|sodium|epa|dha|omega/i.test(k));
    console.log('%cCronometer raw keys (micro-relevant):', 'color:#9b8ec4;font-weight:600');
    console.table(microKeys.map(k => ({ key: k, value: cronoTotals[k] })));
  } else {
    console.log('%cNo cronometerLive cache for today.', 'color:#fbbf24');
  }

  // 2. What getDailyNutrients sums up (food + supps merged)
  const nutrients = getDailyNutrients(today);
  const targets = getOptimalTargets(today);

  // 3. Stack contribution (per-supplement, per-nutrient)
  const taken = getTodayTaken(today);
  const stack = getStack();
  const catalog = getCatalog();
  const byId = Object.fromEntries(catalog.map(s => [s.id, s]));
  const suppBreakdown = [];
  for (const entry of stack) {
    if (!taken[entry.id]) continue;
    const sup = byId[entry.supplementId];
    if (!sup) continue;
    for (const n of sup.nutrients || []) {
      suppBreakdown.push({
        supplement: sup.name,
        nutrient: n.name,
        amount: (n.amount || 0) * (entry.doseMultiplier || 1),
        unit: n.unit || '—',
      });
    }
  }

  const printOne = (nm) => {
    const food = nutrients[nm] || 0;
    const alt = nm === 'Vitamin B12' ? (nutrients['Vitamin B12 (methylcobalamin)'] || 0)
               : nm === 'Vitamin D'   ? (nutrients['Vitamin D3 (cholecalciferol)'] || 0)
               : nm === 'Magnesium'   ? (nutrients['Elemental Magnesium'] || 0)
               : 0;
      const total = food + alt;
    const target = targets[nm] || 0;
    const pct = target ? Math.round((total / target) * 100) : 0;
    console.log(`%c${nm}: ${Math.round(total*100)/100} (target ${target}, ${pct}%)`, 'color:#5eead4;font-weight:600');
    const supps = suppBreakdown.filter(r => r.nutrient === nm || (nm === 'Vitamin B12' && /B12|cobalamin/i.test(r.nutrient)) || (nm === 'Vitamin D' && /Vitamin D/i.test(r.nutrient)) || (nm === 'Magnesium' && /Magnesium/i.test(r.nutrient)));
    if (supps.length) {
      console.table(supps);
    } else {
      console.log('  no supplement contribution detected');
    }
  };

  if (name) {
    printOne(name);
  } else {
    const all = [
      'Vitamin A','Vitamin C','Vitamin D','Vitamin E','Vitamin K',
      'Thiamin (B1)','Riboflavin (B2)','Niacin (B3)','Vitamin B6','Folate','Vitamin B12',
      'Calcium','Iron','Magnesium','Zinc','Selenium','Potassium','Copper','EPA','DHA',
    ];
    for (const n of all) printOne(n);
  }
  return { date: today, nutrients, suppBreakdown };
}
if (typeof window !== 'undefined') window.microsDebug = microsDebug;

export function getSystemWeekly(systemId) {
  const sys = SYSTEMS.find(s => s.id === systemId);
  if (!sys) return [];
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = ymd(d);
    const nutrients = getDailyNutrients(ds);
    const { pct } = scoreSystem(sys, nutrients, ds);
    days.push({ date: ds, pct, dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }) });
  }
  return days;
}


