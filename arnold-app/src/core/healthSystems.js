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

// Local date helper — avoids UTC rollover bug with toISOString()
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
      const pick = (...keys) => {
        for (const k of keys) {
          const v = totals[k];
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

  const show = [
    'Vitamin D', 'Vitamin C', 'Vitamin B12', 'Folate', 'Vitamin K',
    'Iron', 'Calcium', 'Magnesium', 'Zinc', 'Selenium', 'Potassium',
    'EPA', 'DHA',
  ];
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

    list.push({
      name,
      value: Math.round(val * 10) / 10,
      target,
      pct: Math.round(pct),
      source,
    });
  }
  return list;
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

// ─── Full report for UI ─────────────────────────────────────────────────────
// Find the most recent date with nutrition data (food or Cronometer)
function findBestNutrientDate(dateStr) {
  // Always use the requested date — no fallback to previous days.
  // If nothing is logged yet today, scores reflect that (supplements only).
  const nutrients = getDailyNutrients(dateStr);
  return { nutrients, dateUsed: dateStr };
}

export function getSystemsReport(dateStr) {
  const { nutrients, dateUsed } = findBestNutrientDate(dateStr);
  const isStale = dateUsed !== dateStr;
  return SYSTEMS.map(sys => {
    const { pct, gaps, wins } = scoreSystem(sys, nutrients, dateUsed);
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

// ─── Detailed breakdown for a single system ────────────────────────────────
// Returns per-nutrient scores, targets, and values for the expanded tile view.
export function getSystemDetail(systemId, dateStr) {
  const sys = SYSTEMS.find(s => s.id === systemId);
  if (!sys) return null;
  const { nutrients, dateUsed } = findBestNutrientDate(dateStr);
  const targets = getOptimalTargets(dateUsed);
  const { pct: systemPct } = scoreSystem(sys, nutrients, dateUsed);
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
  details.sort((a, b) => a.pct - b.pct); // worst first
  return { system: { ...sys, pct: systemPct }, details };
}

// ─── Weekly system scores (last 7 days) ────────────────────────────────────
export function getSystemWeekly(systemId) {
  const sys = SYSTEMS.find(s => s.id === systemId);
  if (!sys) return [];
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const ds = localDate(d);
    const nutrients = getDailyNutrients(ds);
    const { pct } = scoreSystem(sys, nutrients, ds);
    days.push({ date: ds, pct, dayLabel: d.toLocaleDateString('en-US', { weekday: 'short' }) });
  }
  return days;
}


