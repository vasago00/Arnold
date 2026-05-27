// ─── DEPRECATED — Phase 4r.dataspine.4 (2026-05-24) ────────────────────────
//
// The contents of this module — `resolveCalorieTarget` and
// `resolveCalorieTargetVerbose` — were removed when Phase A data-spine
// consolidation finished. The canonical Layer 3 reader is now
// `getEffectiveTargets` from `./goalModel.js`.
//
// Migration map for anyone resurrecting this code path:
//   resolveCalorieTarget(date, goals)
//     → getEffectiveTargets({ date }).dailyCalories.effective
//   resolveCalorieTargetVerbose(date, goals)
//     → getEffectiveTargets({ date }).dailyCalories
//        // .effective / .derived / .override / .source / .explain
//
// Why deleted: the old resolver had no awareness of the override
// system, the outcome-driven goal model, or the race-proximity
// modifier. Keeping it alive meant TWO competing answers to the
// same question, which produced visible inconsistencies (Nutrition
// tab showing 2919 kcal while Calendar drawer showed 1965 kcal for
// the same day). See POSTMORTEMS.md and AUDIT.md Batch 1 for the
// full history.
//
// The exports below intentionally THROW. If a code path imports them
// it will fail loudly at first call instead of silently falling back
// to an inconsistent value.

const DEPRECATED_MSG =
  '[calorieTarget.js DEPRECATED — Phase 4r.dataspine.4] ' +
  'Use getEffectiveTargets from ./goalModel.js instead.';

export function resolveCalorieTarget(/* date, goals */) {
  throw new Error(DEPRECATED_MSG);
}

export function resolveCalorieTargetVerbose(/* date, goals */) {
  throw new Error(DEPRECATED_MSG);
}
