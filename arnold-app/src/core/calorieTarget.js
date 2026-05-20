// ─── Daily Calorie Target Resolver ──────────────────────────────────────────
// Phase 4r.fuel.1 — single source of truth for "how many calories should you
// eat today?" Replaces the static goals.dailyCalorieTarget that was scattered
// across 5+ call sites in Arnold (Calendar drawer, Daily Fuel, mobile Fuel,
// GoalsHub, NutritionInput).
//
// The target is computed dynamically per-date:
//   1. Preferred: computeTDEE(date).tdee — RMR (Katch-McArdle if body comp known,
//      Mifflin-St Jeor fallback) + actual activity calories + NEAT + TEF for that
//      specific day. This is the right baseline because rest days and HIIT days
//      have very different total energy expenditure.
//   2. Fallback: goals.dailyCalorieTarget — user-set static target.
//   3. Last resort: 2200 — a reasonable adult-male endurance-athlete default.
//
// Why a helper file: when this logic changes (e.g. add bulk/cut adjustments,
// or weekly periodization), we update ONE function instead of grepping.
//
// Usage:
//   import { resolveCalorieTarget } from './core/calorieTarget.js';
//   const target = resolveCalorieTarget(date, goals);

import { computeTDEE } from './energyBalance.js';

const FLOOR = 2200;

/**
 * Resolve today's calorie target.
 *
 * @param {string} date — YYYY-MM-DD. Defaults to today via computeTDEE.
 * @param {Object} goals — { dailyCalorieTarget?: number, ... }
 * @returns {number} calorie target for this date
 */
export function resolveCalorieTarget(date, goals) {
  // Try computed TDEE first.
  try {
    const result = computeTDEE(date);
    const tdee = result && Number(result.tdee);
    if (Number.isFinite(tdee) && tdee > 1000) return Math.round(tdee);
  } catch { /* fall through */ }

  // Fall back to user-set static target.
  const staticTarget = goals && parseFloat(goals.dailyCalorieTarget);
  if (Number.isFinite(staticTarget) && staticTarget > 1000) return Math.round(staticTarget);

  // Last resort.
  return FLOOR;
}

/**
 * Verbose version — returns the target plus the source label
 * (for UI that wants to show "computed via TDEE" vs "from goals").
 */
export function resolveCalorieTargetVerbose(date, goals) {
  try {
    const result = computeTDEE(date);
    const tdee = result && Number(result.tdee);
    if (Number.isFinite(tdee) && tdee > 1000) {
      return { target: Math.round(tdee), source: 'tdee', breakdown: result };
    }
  } catch { /* fall through */ }

  const staticTarget = goals && parseFloat(goals.dailyCalorieTarget);
  if (Number.isFinite(staticTarget) && staticTarget > 1000) {
    return { target: Math.round(staticTarget), source: 'goals', breakdown: null };
  }

  return { target: FLOOR, source: 'fallback', breakdown: null };
}
