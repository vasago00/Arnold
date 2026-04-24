// ─── Activity Nutrition Needs Engine ──────────────────────────────────────────
// Given a workout/activity, computes calorie, macro, and hydration micro-goals
// that should be met through pre/during/post workout meals.
// Replenishment progress is tracked against nutrition-log entries for the day.

import { storage } from './storage.js';
import { hydrationFor } from './derive/hydration.js';
import { getGoals } from './goals.js';

// ─── Constants ───────────────────────────────────────────────────────────────

// Post-exercise protein window: 0.25–0.4 g per kg body weight
const PROTEIN_PER_KG_POST = 0.3;
// Post-exercise carbs: ~1.0–1.2 g per kg for glycogen replenishment
const CARBS_PER_KG_POST = 1.0;
// Pre-workout carbs: ~1 g per kg 1–1.5h before
const CARBS_PER_KG_PRE = 0.8;
// During workout: ~30–60g carbs/hr for sessions > 60min
const CARBS_PER_HOUR_DURING = 45;
// Water during: ~150–250 ml every 15–20 min
const WATER_ML_PER_HOUR_DURING = 600;

// ─── Compute needs from activity ─────────────────────────────────────────────
// `activity` should have: calories, durationSecs, avgHR, maxHR, activityType
// `profile` should have: weight (lbs), maxHR, dailyCalorieTarget, etc.
export function computeActivityNeeds(activity, profile = {}) {
  if (!activity) return null;

  const weightLbs = parseFloat(profile.weight) || 175;
  const weightKg = weightLbs * 0.4536;
  const durationSecs = activity.durationSecs || (activity.durationMins ? activity.durationMins * 60 : 0);
  const durationHrs = durationSecs / 3600;
  const caloriesBurned = activity.calories || activity.activeCalories || Math.round(durationHrs * 500); // fallback estimate

  // Hydration needs (uses existing calibrated formula)
  const hydration = hydrationFor(activity, profile);

  // ── Pre-workout needs ──
  const preCarbs = Math.round(CARBS_PER_KG_PRE * weightKg);
  const preCals = Math.round(preCarbs * 4 * 1.3); // carbs + some protein/fat buffer

  // ── During-workout needs (only for sessions > 45 min) ──
  const needsDuring = durationSecs > 2700; // 45 min
  const duringCarbs = needsDuring ? Math.round(CARBS_PER_HOUR_DURING * durationHrs) : 0;
  const duringWaterMl = needsDuring ? Math.round(WATER_ML_PER_HOUR_DURING * durationHrs) : 0;

  // ── Post-workout needs ──
  const postProtein = Math.round(PROTEIN_PER_KG_POST * weightKg);
  const postCarbs = Math.round(CARBS_PER_KG_POST * weightKg);
  const postCals = Math.round(postProtein * 4 + postCarbs * 4); // protein + carbs kcal

  // Total replenishment water (1.25× sweat loss, from hydration module)
  const totalWaterMl = hydration.replenishL != null
    ? Math.round(hydration.replenishL * 1000)
    : Math.round(durationHrs * 500); // fallback 500ml/hr

  // ── Micro-goals ──
  const goals = [];

  // Pre-workout
  goals.push({
    id: 'pre_carbs',
    phase: 'pre_workout',
    label: `${preCarbs}g carbs before workout`,
    target: preCarbs,
    unit: 'g',
    macro: 'carbs',
    priority: 'medium',
  });

  // During workout
  if (needsDuring) {
    goals.push({
      id: 'during_carbs',
      phase: 'during_workout',
      label: `${duringCarbs}g carbs during workout`,
      target: duringCarbs,
      unit: 'g',
      macro: 'carbs',
      priority: 'high',
    });
    goals.push({
      id: 'during_water',
      phase: 'during_workout',
      label: `${duringWaterMl} ml water during workout`,
      target: duringWaterMl,
      unit: 'ml',
      macro: 'water',
      priority: 'high',
    });
  }

  // Post-workout
  goals.push({
    id: 'post_protein',
    phase: 'post_workout',
    label: `${postProtein}g protein within 1 hr`,
    target: postProtein,
    unit: 'g',
    macro: 'protein',
    priority: 'high',
  });
  goals.push({
    id: 'post_carbs',
    phase: 'post_workout',
    label: `${postCarbs}g carbs to replenish glycogen`,
    target: postCarbs,
    unit: 'g',
    macro: 'carbs',
    priority: 'high',
  });
  goals.push({
    id: 'post_water',
    phase: 'post_workout',
    label: `${totalWaterMl} ml water (1.25× sweat loss)`,
    target: totalWaterMl,
    unit: 'ml',
    macro: 'water',
    priority: 'high',
  });

  return {
    caloriesBurned,
    durationSecs,
    hydration,
    needs: {
      pre: { calories: preCals, carbs: preCarbs },
      during: needsDuring ? { carbs: duringCarbs, water: duringWaterMl } : null,
      post: { calories: postCals, protein: postProtein, carbs: postCarbs, water: totalWaterMl },
    },
    goals,
  };
}

// ─── Track replenishment progress ────────────────────────────────────────────
// Checks nutrition-log entries tagged with pre/during/post workout meal categories
// against the computed needs. Returns progress for each micro-goal.
export function trackReplenishment(activityNeeds, dateStr) {
  if (!activityNeeds) return [];

  // Merge nutrition-log entries (manual/barcode/photo/voice)
  const logEntries = (storage.get('nutritionLog') || []).filter(e => e.date === dateStr);

  // Also check Cronometer CSV data for the same date
  const cronoRow = (storage.get('cronometer') || []).find(c => c.date === dateStr);

  // Sum macros by meal phase from nutrition-log
  const phaseTotals = {};
  for (const e of logEntries) {
    const phase = e.meal;
    if (!phase) continue;
    if (!phaseTotals[phase]) phaseTotals[phase] = { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 };
    const s = e.servings || 1;
    for (const k of ['calories', 'protein', 'carbs', 'fat', 'water']) {
      phaseTotals[phase][k] += (e.macros?.[k] || 0) * s;
    }
  }

  // All-day totals from nutrition-log
  const allDayTotals = { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 };
  for (const e of logEntries) {
    const s = e.servings || 1;
    for (const k of ['calories', 'protein', 'carbs', 'fat', 'water']) {
      allDayTotals[k] += (e.macros?.[k] || 0) * s;
    }
  }

  // Merge Cronometer totals (use the higher of nutrition-log vs Cronometer)
  if (cronoRow) {
    allDayTotals.calories = Math.max(allDayTotals.calories, parseFloat(cronoRow.calories) || 0);
    allDayTotals.protein = Math.max(allDayTotals.protein, parseFloat(cronoRow.protein) || 0);
    allDayTotals.carbs = Math.max(allDayTotals.carbs, parseFloat(cronoRow.carbs) || 0);
    allDayTotals.fat = Math.max(allDayTotals.fat, parseFloat(cronoRow.fat) || 0);
    allDayTotals.water = Math.max(allDayTotals.water, (parseFloat(cronoRow.water) || 0) * 1000); // Cronometer water is in L
  }

  return activityNeeds.goals.map(goal => {
    // Use all-day totals for all macros. Most users tag meals as breakfast/
    // lunch/snack, not "post_workout", so phase-only tracking misses intake.
    // Phase-specific totals kept for future detail view.
    const phaseConsumed = (phaseTotals[goal.phase] || {})[goal.macro] || 0;
    const dayConsumed = allDayTotals[goal.macro] || 0;
    // Use the higher of phase-specific or all-day (all-day always >= phase)
    const consumed = Math.max(phaseConsumed, dayConsumed);

    const pct = goal.target > 0 ? Math.min(consumed / goal.target, 1) : 0;
    const met = pct >= 0.9; // 90% threshold = goal met

    return {
      ...goal,
      consumed: Math.round(consumed),
      pct,
      met,
    };
  });
}

// ─── Summary helper: overall replenishment status ────────────────────────────
export function replenishmentSummary(progress) {
  if (!progress || !progress.length) return { total: 0, met: 0, pct: 0, status: 'none' };
  const total = progress.length;
  const met = progress.filter(g => g.met).length;
  const avgPct = progress.reduce((s, g) => s + g.pct, 0) / total;
  const status = avgPct >= 0.9 ? 'complete' : avgPct >= 0.5 ? 'partial' : 'low';
  return { total, met, pct: Math.round(avgPct * 100), status };
}
