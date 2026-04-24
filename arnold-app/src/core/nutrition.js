// ─── ARNOLD Nutrition Engine ─────────────────────────────────────────────────
// Handles food logging, meal timing, macro aggregation, and goal impact scoring.
// Data flows: Entry → Daily totals → Weekly averages → Training Intelligence.
//
// Storage: arnold:nutrition-log  (array of NutritionEntry)
//
// Each entry = one food item at a specific time. Multiple entries per day.
// Entries tagged with meal timing: pre-workout, during-workout, post-workout,
// breakfast, lunch, dinner, snack.

import { storage } from './storage.js';

// Local date helper — avoids UTC rollover bug with toISOString()
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── Constants ──────────────────────────────────────────────────────────────

export const MEAL_CATEGORIES = [
  { id: 'pre_workout',    label: 'Pre-Workout',    icon: '⚡', color: '#fbbf24', desc: '1–1.5 hrs before' },
  { id: 'during_workout', label: 'During Workout',  icon: '💧', color: '#60a5fa', desc: 'Water & fuel mid-session' },
  { id: 'post_workout',   label: 'Post-Workout',   icon: '🔄', color: '#4ade80', desc: 'Within 1 hr after' },
  { id: 'breakfast',      label: 'Breakfast',       icon: '☀', color: '#f97316', desc: '' },
  { id: 'lunch',          label: 'Lunch',           icon: '◐', color: '#a78bfa', desc: '' },
  { id: 'dinner',         label: 'Dinner',          icon: '◑', color: '#6366f1', desc: '' },
  { id: 'snack',          label: 'Snack',           icon: '◈', color: '#ec4899', desc: '' },
];

export const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'water'];

const STORAGE_KEY = 'nutritionLog'; // KEYS map alias → arnold:nutrition-log

// ─── Entry helpers ──────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/**
 * Create a new nutrition entry.
 * @param {Object} opts
 * @param {string} opts.name       - Food name (e.g. "Chicken breast")
 * @param {string} opts.date       - ISO date YYYY-MM-DD
 * @param {string} opts.time       - HH:MM (optional)
 * @param {string} opts.meal       - Meal category ID (pre_workout, lunch, etc.)
 * @param {string} opts.source     - 'manual' | 'barcode' | 'photo' | 'voice'
 * @param {number} opts.servings   - Number of servings (default 1)
 * @param {Object} opts.macros     - { calories, protein, carbs, fat, fiber, sugar, water }
 * @param {string} opts.barcode    - UPC/EAN if scanned (optional)
 * @param {string} opts.imageUrl   - Photo data URL (optional)
 * @param {Object} opts.rawApiData - Raw API response for debugging (optional)
 */
export function createEntry(opts) {
  return {
    id: genId(),
    name: opts.name || 'Unknown food',
    date: opts.date || localDate(),
    time: opts.time || new Date().toTimeString().slice(0, 5),
    meal: opts.meal || 'snack',
    source: opts.source || 'manual',
    servings: opts.servings ?? 1,
    macros: {
      calories: opts.macros?.calories ?? 0,
      protein:  opts.macros?.protein  ?? 0,
      carbs:    opts.macros?.carbs    ?? 0,
      fat:      opts.macros?.fat      ?? 0,
      fiber:    opts.macros?.fiber    ?? 0,
      sugar:    opts.macros?.sugar    ?? 0,
      water:    opts.macros?.water    ?? 0, // ml
    },
    barcode:    opts.barcode || null,
    imageUrl:   opts.imageUrl || null,
    rawApiData: opts.rawApiData || null,
    createdAt:  new Date().toISOString(),
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function getAllEntries() {
  try {
    return storage.get(STORAGE_KEY) || [];
  } catch { return []; }
}

export function saveEntry(entry) {
  const all = getAllEntries();
  const idx = all.findIndex(e => e.id === entry.id);
  if (idx >= 0) all[idx] = entry; else all.unshift(entry);
  storage.set(STORAGE_KEY, all, { skipValidation: true });
  return entry;
}

export function deleteEntry(id) {
  const all = getAllEntries().filter(e => e.id !== id);
  storage.set(STORAGE_KEY, all, { skipValidation: true });
}

export function getEntriesForDate(dateStr) {
  return getAllEntries().filter(e => e.date === dateStr);
}

// ─── Daily Aggregation ──────────────────────────────────────────────────────
// Sums all entries for a given date into a single macro totals object.
//
// DATA-SOURCE PRECEDENCE (highest wins):
//   1. Cronometer live pull — creates a `meal: 'full-day'` entry in
//      `nutritionLog` with id `cronometer-live:${date}`. createdAt is
//      refreshed on every pull so it always beats older full-day entries.
//   2. Manual / barcode / photo entries — individual `nutritionLog` rows
//      for a day. Only summed when no full-day entry exists.
//   3. `cronometer` collection — legacy CSV imports (Cronometer export →
//      parser). Fallback only when nutritionLog has zero entries for the day.
//   4. HC syncNutrition — DISABLED in hc-sync.js (see comment there). Left
//      out of the precedence chain on purpose; Cronometer live pull is the
//      single authoritative source.

export function dailyTotals(dateStr) {
  const entries = getEntriesForDate(dateStr);
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, water: 0, entryCount: entries.length };

  // If a full-day summary exists (Cronometer import), use ONLY the most recent
  // one — it already includes all food for the day. Other entries alongside it
  // would be stale duplicates (e.g. from a previous import that sync didn't delete).
  const fullDay = entries.filter(e => e.meal === 'full-day');
  if (fullDay.length > 0) {
    // Take the most recently created one (by createdAt timestamp)
    const fd = fullDay.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    const s = fd.servings || 1;
    MACRO_KEYS.forEach(k => { totals[k] += (fd.macros?.[k] || 0) * s; });
  } else {
    entries.forEach(e => {
      const s = e.servings || 1;
      MACRO_KEYS.forEach(k => { totals[k] += (e.macros?.[k] || 0) * s; });
    });
  }

  // Merge Cronometer data for the same date (backward compat)
  try {
    const crono = storage.get('cronometer') || [];
    const dayC = crono.find(c => c.date === dateStr);
    if (dayC && entries.length === 0) {
      // Only use Cronometer if no manual entries exist for the day
      totals.calories = parseFloat(dayC.calories) || 0;
      totals.protein  = parseFloat(dayC.protein)  || 0;
      totals.carbs    = parseFloat(dayC.carbs)    || 0;
      totals.fat      = parseFloat(dayC.fat)      || 0;
      totals.fiber    = parseFloat(dayC.fiber)    || 0;
      totals.sugar    = parseFloat(dayC.sugar)    || 0;
      totals.water    = parseFloat(dayC.water)    || 0;
      totals.source   = 'cronometer';
    }
  } catch {}

  return totals;
}

// ─── Weekly Aggregation ─────────────────────────────────────────────────────
// Averages daily totals over the last 7 days.

export function weeklyAverages(refDate = new Date()) {
  const avgs = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, water: 0, daysWithData: 0 };
  for (let i = 0; i < 7; i++) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    const ds = localDate(d);
    const t = dailyTotals(ds);
    if (t.calories > 0 || t.protein > 0 || t.entryCount > 0) {
      avgs.daysWithData++;
      MACRO_KEYS.forEach(k => { avgs[k] += t[k]; });
    }
  }
  if (avgs.daysWithData > 0) {
    MACRO_KEYS.forEach(k => { avgs[k] = Math.round(avgs[k] / avgs.daysWithData); });
  }
  return avgs;
}

// ─── Rolling Baseline (Phase 4b — Cronometer partial-day forecast prior) ────
// Returns a typical-day macro profile drawn from fully-logged recent history.
// Used as the prior in fuelAdequacy's baseline-blend forecast: mid-day, when
// live Cronometer totals only cover breakfast, we project the day as
//   projected_intake = α × (live_intake / fraction_of_day_elapsed)
//                    + (1-α) × baseline
// where baseline is this function's output and α grows from dawn → bedtime.
//
// Inputs:
//   refDate       — anchor date (default today). Always excluded from the
//                   baseline so in-progress data doesn't contaminate the prior.
//   lookbackDays  — how far back to look (default 14).
//
// A day counts as "fully logged" only if its calories are at or above
// MIN_LOGGED_KCAL — this filters out skip-days (user forgot to log) and
// empty-morning days (logged breakfast only). 500 kcal is conservative;
// below that, a day is almost certainly incomplete rather than a true fast.
// Callers that want to include fasts can pass lookbackDays with a matching
// minKcal override.
//
// Return shape matches weeklyAverages() for interop: macros + daysWithData.
// daysWithData lets callers judge confidence (e.g., if < 3 days, fall back
// to a static prior instead of blending).

const MIN_LOGGED_KCAL = 500;

export function nutritionBaseline(refDate = new Date(), lookbackDays = 14, { minKcal = MIN_LOGGED_KCAL } = {}) {
  const anchor = refDate instanceof Date ? refDate : new Date(refDate);
  const anchorStr = localDate(anchor);
  const agg = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, water: 0, daysWithData: 0 };

  // Walk back day-by-day, skipping the anchor itself so today's partial data
  // never bleeds into its own prior.
  for (let i = 1; i <= lookbackDays; i++) {
    const d = new Date(anchor);
    d.setDate(d.getDate() - i);
    const ds = localDate(d);
    if (ds === anchorStr) continue;
    const t = dailyTotals(ds);
    if ((t.calories || 0) < minKcal) continue; // skip partial / empty days
    agg.daysWithData++;
    MACRO_KEYS.forEach(k => { agg[k] += (t[k] || 0); });
  }

  if (agg.daysWithData > 0) {
    MACRO_KEYS.forEach(k => { agg[k] = Math.round(agg[k] / agg.daysWithData); });
  }
  return agg;
}

// ─── Meal breakdown for a day ───────────────────────────────────────────────

export function mealBreakdown(dateStr) {
  const entries = getEntriesForDate(dateStr);
  const breakdown = {};
  MEAL_CATEGORIES.forEach(m => {
    const mealEntries = entries.filter(e => e.meal === m.id);
    const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    mealEntries.forEach(e => {
      const s = e.servings || 1;
      Object.keys(totals).forEach(k => { totals[k] += (e.macros?.[k] || 0) * s; });
    });
    breakdown[m.id] = { ...totals, entries: mealEntries };
  });
  return breakdown;
}

// ─── Goal Impact Scoring ────────────────────────────────────────────────────
// Returns a -1 to +1 score indicating if a food entry helps or hurts goals.
// Positive = helping, negative = hurting.

export function goalImpact(entry, goals = {}) {
  if (!entry?.macros) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;
  const s = entry.servings || 1;
  const cal = (entry.macros.calories || 0) * s;
  const pro = (entry.macros.protein || 0) * s;

  // Protein target (daily)
  const proTarget = parseFloat(goals.dailyProteinTarget) || 150;
  if (pro >= 20) {
    score += 0.3;
    reasons.push({ text: `+${Math.round(pro)}g protein toward ${proTarget}g goal`, type: 'positive' });
  }

  // Calorie budget
  const calTarget = parseFloat(goals.dailyCalorieTarget) || 2200;
  if (cal > calTarget * 0.4) {
    score -= 0.2;
    reasons.push({ text: `${cal} cal is ${Math.round(cal/calTarget*100)}% of daily budget in one meal`, type: 'negative' });
  }

  // Workout timing bonus
  if (entry.meal === 'pre_workout' && (entry.macros.carbs || 0) * s >= 20) {
    score += 0.2;
    reasons.push({ text: 'Good pre-workout carb loading', type: 'positive' });
  }
  if (entry.meal === 'post_workout' && pro >= 15) {
    score += 0.2;
    reasons.push({ text: 'Good post-workout protein for recovery', type: 'positive' });
  }

  // Weight goal
  if (goals.targetWeight && goals.currentWeight) {
    const needsLoss = goals.currentWeight > goals.targetWeight;
    if (needsLoss && cal < 400) {
      score += 0.1;
      reasons.push({ text: 'Low-cal choice supports weight goal', type: 'positive' });
    }
  }

  return { score: Math.max(-1, Math.min(1, score)), reasons };
}

// ─── Portion size conversion ────────────────────────────────────────────────
// Standard unit → grams conversion factors
const UNIT_TO_GRAMS = {
  g:    1,
  oz:   28.3495,
  ml:   1,        // approximate for water-density foods; adjusted by density if known
  cup:  240,      // US cup = ~240ml ≈ 240g for liquids, varies for solids
  tbsp: 15,       // US tablespoon
  tsp:  5,        // US teaspoon
};

// Parse a serving size string like "30g", "1 cup (240ml)", "2 tbsp (30g)"
function parseServingWeight(servingStr) {
  if (!servingStr) return null;
  // Try to find grams directly: "30g", "30 g", "(30g)"
  const gMatch = servingStr.match(/(\d+(?:\.\d+)?)\s*g(?:\b|$)/i);
  if (gMatch) return parseFloat(gMatch[1]);
  // Try ml: "240ml"
  const mlMatch = servingStr.match(/(\d+(?:\.\d+)?)\s*ml/i);
  if (mlMatch) return parseFloat(mlMatch[1]); // ~1:1 for liquids
  // Try oz: "1 oz", "1.5oz"
  const ozMatch = servingStr.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * UNIT_TO_GRAMS.oz;
  return null;
}

// Calculate macros for a given portion from per-100g data
export function calculatePortion(per100g, amount, unit) {
  if (!per100g || !amount) return per100g || {};
  const grams = amount * (UNIT_TO_GRAMS[unit] || 1);
  const factor = grams / 100;
  return {
    calories: Math.round((per100g.calories || 0) * factor),
    protein:  Math.round(((per100g.protein || 0) * factor) * 10) / 10,
    carbs:    Math.round(((per100g.carbs || 0) * factor) * 10) / 10,
    fat:      Math.round(((per100g.fat || 0) * factor) * 10) / 10,
    fiber:    Math.round(((per100g.fiber || 0) * factor) * 10) / 10,
    sugar:    Math.round(((per100g.sugar || 0) * factor) * 10) / 10,
    water:    Math.round(((per100g.water || 0) * factor) * 10) / 10,
  };
}

// ─── Open Food Facts barcode lookup ─────────────────────────────────────────

export async function lookupBarcode(barcode) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const nut = p.nutriments || {};
    const servingWeightG = parseServingWeight(p.serving_size) ||
      (nut.serving_quantity ? parseFloat(nut.serving_quantity) : null);
    // Per-100g macros (canonical base for portion calculations)
    const per100g = {
      calories: Math.round(nut['energy-kcal_100g'] || 0),
      protein:  Math.round((nut.proteins_100g || 0) * 10) / 10,
      carbs:    Math.round((nut.carbohydrates_100g || 0) * 10) / 10,
      fat:      Math.round((nut.fat_100g || 0) * 10) / 10,
      fiber:    Math.round((nut.fiber_100g || 0) * 10) / 10,
      sugar:    Math.round((nut.sugars_100g || 0) * 10) / 10,
      water:    0,
    };
    // Per-serving macros (for display default)
    const macros = servingWeightG
      ? calculatePortion(per100g, servingWeightG, 'g')
      : {
          calories: Math.round(nut['energy-kcal_serving'] || per100g.calories),
          protein:  Math.round((nut.proteins_serving || per100g.protein) * 10) / 10,
          carbs:    Math.round((nut.carbohydrates_serving || per100g.carbs) * 10) / 10,
          fat:      Math.round((nut.fat_serving || per100g.fat) * 10) / 10,
          fiber:    Math.round((nut.fiber_serving || per100g.fiber) * 10) / 10,
          sugar:    Math.round((nut.sugars_serving || per100g.sugar) * 10) / 10,
          water:    0,
        };
    return {
      name: p.product_name || p.product_name_en || 'Unknown product',
      brand: p.brands || '',
      servingSize: p.serving_size || '',
      servingWeightG,
      per100g,
      imageUrl: p.image_front_small_url || p.image_url || null,
      macros,
      barcode,
      rawApiData: { product_name: p.product_name, brands: p.brands, serving_size: p.serving_size, nutriments: nut },
    };
  } catch (e) {
    console.warn('Barcode lookup failed:', e);
    return null;
  }
}

// ─── Open Food Facts text search ────────────────────────────────────────────

export async function searchFood(query, page = 1) {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&json=1&page=${page}&page_size=10`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.products || []).map(p => {
      const nut = p.nutriments || {};
      return {
        name: p.product_name || 'Unknown',
        brand: p.brands || '',
        servingSize: p.serving_size || '100g',
        imageUrl: p.image_front_small_url || null,
        macros: {
          calories: Math.round(nut['energy-kcal_serving'] || nut['energy-kcal_100g'] || 0),
          protein:  Math.round((nut.proteins_serving || nut.proteins_100g || 0) * 10) / 10,
          carbs:    Math.round((nut.carbohydrates_serving || nut.carbohydrates_100g || 0) * 10) / 10,
          fat:      Math.round((nut.fat_serving || nut.fat_100g || 0) * 10) / 10,
          fiber:    Math.round((nut.fiber_serving || nut.fiber_100g || 0) * 10) / 10,
          sugar:    Math.round((nut.sugars_serving || nut.sugars_100g || 0) * 10) / 10,
          water:    0,
        },
        barcode: p.code || null,
      };
    });
  } catch (e) {
    console.warn('Food search failed:', e);
    return [];
  }
}

// ─── AI Food Recognition (Claude Vision) ───────────────────────────────────
// Takes a base64-encoded image and asks Claude to identify the food and macros.

export async function recognizeFoodPhoto(imageBase64, mediaType = 'image/jpeg') {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY || '';
  if (!apiKey) return { error: 'API key not configured — add VITE_ANTHROPIC_API_KEY to .env' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: `You are a nutrition analysis assistant. When shown a photo of food, identify the dish or product and estimate its nutritional content. Respond with ONLY valid JSON in this exact format (no markdown, no backticks):
{"name":"Dish name","items":[{"ingredient":"Name","estimatedGrams":100}],"servingSize":"estimated portion description","macros":{"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"sugar":0,"water":0},"confidence":"high|medium|low","notes":"any relevant notes about the estimate"}
For packaged products, read the label if visible. For home-cooked or restaurant meals, estimate based on visible portion size. All macro values should be numbers (grams except calories in kcal). Be as accurate as possible.`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Identify this food and estimate its nutritional content per the visible portion.' },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: `API error ${res.status}: ${err.error?.message || 'Unknown'}` };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON response — handle possible markdown wrapping
    const jsonStr = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return {
      name: parsed.name || 'Unknown food',
      items: parsed.items || [],
      servingSize: parsed.servingSize || 'estimated portion',
      macros: {
        calories: Math.round(parsed.macros?.calories || 0),
        protein:  Math.round((parsed.macros?.protein || 0) * 10) / 10,
        carbs:    Math.round((parsed.macros?.carbs || 0) * 10) / 10,
        fat:      Math.round((parsed.macros?.fat || 0) * 10) / 10,
        fiber:    Math.round((parsed.macros?.fiber || 0) * 10) / 10,
        sugar:    Math.round((parsed.macros?.sugar || 0) * 10) / 10,
        water:    Math.round((parsed.macros?.water || 0) * 10) / 10,
      },
      confidence: parsed.confidence || 'medium',
      notes: parsed.notes || '',
    };
  } catch (e) {
    console.warn('Food recognition failed:', e);
    return { error: `Recognition failed: ${e.message}` };
  }
}
