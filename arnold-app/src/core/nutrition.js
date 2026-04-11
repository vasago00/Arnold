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
    date: opts.date || new Date().toISOString().slice(0, 10),
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
// Also merges in Cronometer data if available for backward compat.

export function dailyTotals(dateStr) {
  const entries = getEntriesForDate(dateStr);
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, water: 0, entryCount: entries.length };

  entries.forEach(e => {
    const s = e.servings || 1;
    MACRO_KEYS.forEach(k => { totals[k] += (e.macros?.[k] || 0) * s; });
  });

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
    const ds = d.toISOString().slice(0, 10);
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

// ─── Open Food Facts barcode lookup ─────────────────────────────────────────

export async function lookupBarcode(barcode) {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const nut = p.nutriments || {};
    return {
      name: p.product_name || p.product_name_en || 'Unknown product',
      brand: p.brands || '',
      servingSize: p.serving_size || '',
      imageUrl: p.image_front_small_url || p.image_url || null,
      macros: {
        calories: Math.round(nut['energy-kcal_serving'] || nut['energy-kcal_100g'] || 0),
        protein:  Math.round((nut.proteins_serving || nut.proteins_100g || 0) * 10) / 10,
        carbs:    Math.round((nut.carbohydrates_serving || nut.carbohydrates_100g || 0) * 10) / 10,
        fat:      Math.round((nut.fat_serving || nut.fat_100g || 0) * 10) / 10,
        fiber:    Math.round((nut.fiber_serving || nut.fiber_100g || 0) * 10) / 10,
        sugar:    Math.round((nut.sugars_serving || nut.sugars_100g || 0) * 10) / 10,
        water:    0,
      },
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
