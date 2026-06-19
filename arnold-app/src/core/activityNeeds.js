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
// Pre/post windows around the workout (ms). Cronometer per-meal rows carry
// wall-clock timestamps, so we bucket intake by WHEN it was eaten relative to
// the session rather than relying on the user to hand-tag each meal as
// pre/post-workout. Pre = up to 3 h before the start; During = start→end;
// Post = up to 2 h after the end.
const PRE_WINDOW_MS  = 3 * 60 * 60 * 1000;
const POST_WINDOW_MS = 2 * 60 * 60 * 1000;

function _zeroMacros() { return { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 }; }

// Parse "07:32 AM" / "19:14" / "6:41 PM" → { h, m } (24h) or null.
function _parseClock(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return { h, m: mm };
}

// Epoch-ms for an activity's start (activity.startTime || activity.time on its date).
function _clockMs(raw, activity, dateStr) {
  const clk = _parseClock(raw);
  const d = activity?.date || dateStr;
  if (!clk || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return null;
  const ms = new Date(`${d}T${String(clk.h).padStart(2, '0')}:${String(clk.m).padStart(2, '0')}:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}
// The FIT parser stores `time` as the activity START. We also accept an explicit
// END field if any source supplies one, deriving the missing endpoint from the
// elapsed time (durationSecs), so the window sits correctly whichever is given.
function _workoutStartMs(activity, dateStr) {
  if (!activity) return null;
  return _clockMs(activity.startTime || activity.startTimeLocal || activity.time, activity, dateStr);
}
function _workoutEndMs(activity, dateStr) {
  if (!activity) return null;
  return _clockMs(activity.endTime || activity.endTimeLocal, activity, dateStr);
}

// Epoch-ms for a nutrition-log entry — prefer its ISO timestamp (Cronometer
// per-meal rows), else reconstruct from date + clock time.
function _entryMs(e, dateStr) {
  if (e?.timestamp) { const ms = Date.parse(e.timestamp); if (!Number.isNaN(ms)) return ms; }
  const clk = _parseClock(e?.time);
  const d = e?.date || dateStr;
  if (clk && /^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
    const ms = new Date(`${d}T${String(clk.h).padStart(2, '0')}:${String(clk.m).padStart(2, '0')}:00`).getTime();
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function trackReplenishment(activityNeeds, dateStr, activity = null) {
  if (!activityNeeds) return [];

  const logEntries = (storage.get('nutritionLog') || []).filter(e => e.date === dateStr);

  // Workout time window. If we can't determine when the session happened, we
  // fall back to honoring only explicit pre/during/post meal tags (no
  // timestamp bucketing) so we never mis-attribute intake.
  const durMs = (activityNeeds.durationSecs || 0) * 1000;
  let startMs = _workoutStartMs(activity, dateStr);
  let endMs = _workoutEndMs(activity, dateStr);
  // Derive whichever endpoint is missing from the elapsed time.
  if (startMs == null && endMs != null) startMs = endMs - durMs;
  if (endMs == null && startMs != null) endMs = startMs + durMs;

  const phaseTotals = {
    pre_workout: _zeroMacros(),
    during_workout: _zeroMacros(),
    post_workout: _zeroMacros(),
  };

  for (const e of logEntries) {
    // Skip the Cronometer full-day rollup — it's a daily sum, not a timed meal,
    // and counting it made every goal auto-complete with day-totals.
    if (e.meal === 'full-day' || e.source === 'cronometer-live') continue;

    // 1) An explicit pre/during/post tag always counts toward that phase.
    let phase = (e.meal === 'pre_workout' || e.meal === 'during_workout' || e.meal === 'post_workout')
      ? e.meal : null;

    // 2) Otherwise bucket by timestamp relative to the workout window.
    if (!phase && startMs != null) {
      const t = _entryMs(e, dateStr);
      if (t != null) {
        if (t >= startMs - PRE_WINDOW_MS && t < startMs) phase = 'pre_workout';
        else if (t >= startMs && t <= endMs) phase = 'during_workout';
        else if (t > endMs && t <= endMs + POST_WINDOW_MS) phase = 'post_workout';
      }
    }
    if (!phase) continue;

    const s = e.servings || 1;
    for (const k of ['calories', 'protein', 'carbs', 'fat', 'water']) {
      phaseTotals[phase][k] += (e.macros?.[k] || 0) * s;
    }
  }

  return activityNeeds.goals.map(goal => {
    const consumed = (phaseTotals[goal.phase] || {})[goal.macro] || 0;
    const pct = goal.target > 0 ? Math.min(consumed / goal.target, 1) : 0;
    const met = pct >= 0.9; // 90% threshold = goal met
    return { ...goal, consumed: Math.round(consumed), pct, met };
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
