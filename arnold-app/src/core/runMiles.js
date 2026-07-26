// ─── core/runMiles.js — ONE definition of "how many run miles is this week?" ───
//
// ROUND 98. Emil, on two screenshots of the same plan at the same moment: the card
// header said "this week targets 19 mi" while the WEEK BUDGET strip an inch below it
// said 26. Both were correct arithmetic. They were just four different arithmetics.
//
// Before this file, "week mileage" was computed in five places:
//
//   1. hub/planGenerator.js sumDayMiles   — sums top-level d.distanceMi on every day
//   2. planTiers.js budgetMi              — a re-implementation of (1), inline
//   3. planTiers.js weekBudgetStatus      — a THIRD inline sum, tier-variant aware
//   4. planner.js dayRunMiles             — the only one that reads day.sessions[]
//                                            and filters by run type
//   5. seasonPlan.js targetWeeklyMiles    — a different QUANTITY (see below), fine
//
// (1), (2) and (3) all sum `distanceMi` WITHOUT asking what kind of session it is and
// WITHOUT looking at `sessions[]`. On a freshly generated block that happens to give
// the same answer as (4), because the generator only ever puts `distanceMi` on run
// days — which is exactly why this survived so long. It stops being the same answer
// the moment a day is real rather than freshly generated: a two-a-day has two run
// sessions and only the PRIMARY one is mirrored to top-level `distanceMi` by
// `makeDay` (planner.js), so (1)-(3) undercount it; a cross-training day carrying a
// distance is counted as RUNNING by (1)-(3) and correctly ignored by (4). Stored
// planner weeks — the ones the athlete has actually edited, swapped and logged
// against — are full of both.
//
// So the rule this file encodes is: **run miles come from the sessions, and only from
// sessions whose type is running.** Everything that wants a week total imports from
// here. There is deliberately no `sumAllMiles` export — if a caller wants to count
// cross-training too, that is a different question with a different name.
//
// WHAT THIS FILE IS *NOT*. It is not the ramp's `targetWeeklyMiles`. That number is
// the periodization line — what the ramp is climbing to, race miles excluded — and it
// is genuinely a different quantity from "what will I cover this week". Both are true
// and both are printed; collapsing them is how a plan starts lying in one direction to
// stay honest in the other. Keep two names, one arithmetic each.
//
// ZERO IMPORTS, on purpose. planner.js reaches storage and the theme tokens, and the
// plan generator advertises itself as pure; making the generator import planner.js to
// get one Set would have dragged localStorage into it and forced every node harness to
// stub a browser. A leaf module is what lets all five callers share the definition
// without any of them inheriting each other's dependencies.

// The session types that carry RUN MILEAGE. Every member is here for a reason, and the
// membership was itself a bug before ROUND 98 — the tree held SIX different answers to
// "does this session count toward the week's miles":
//
//   CalendarTab MILEAGE_TYPES  easy_run long_run tempo intervals hiit recovery run race
//   LivingPlan  (day tiles)    easy_run long_run tempo intervals hiit recovery run race
//   LivingPlan  RUN_SET (done) easy_run long_run tempo intervals hiit
//   weekResolve RUN            easy_run long_run tempo intervals hiit
//   coachContext/coachNarrative easy_run long_run tempo intervals hiit
//   runMiles    (first draft)  easy_run long_run tempo intervals            race
//
// So a HIIT session counted on the calendar and vanished from the week budget; a race
// counted in the budget and vanished from the "done" figure on the same card. The widest
// of those — CalendarTab's, the one the athlete literally adds up by eye — is the truth,
// and it is what this set now is.
//
//   easy_run / long_run / tempo / intervals — the obvious four.
//   hiit      — run intervals under another name; it carries a distance and it is run.
//   recovery  — a recovery RUN. Slow miles are still miles; dropping them under-counts
//               exactly the athlete who is doing the easy running right.
//   run       — the legacy generic type on older logged/imported days. Dropping it would
//               silently shrink historical weeks, which is how a base looks like it fell.
//   race      — Emil, 2026-07: "Races should count towards the total mileage of the week
//               in all times."
//
// Not here, on purpose: strength, mobility, walk, cross/cycling/swim/ski. Those can carry
// a stale `distanceMi` from an import, and counting a 12-mile bike as run mileage is how
// the WEEK BUDGET strip came to read higher than the header above it.
export const SESSION_RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit', 'recovery', 'run', 'race']);

export function isRunSession(s) {
  return !!(s && s.type && SESSION_RUN_TYPES.has(s.type));
}

// Miles for ONE session — 0 for anything that is not a run, so callers can sum
// blindly instead of each remembering to filter.
export function sessionRunMiles(s) {
  return isRunSession(s) ? (Number(s.distanceMi) || 0) : 0;
}

// Minimal day → sessions normalizer. Intentionally NOT planner.js's `daySessions`:
// that one also expands the generator's `strength: true` FLAG into a standalone
// Strength session so the calendar can post both halves of a double. That expansion
// adds a session with no `distanceMi`, so it cannot change a mileage total — and
// depending on it here would mean importing planner.js and everything under it.
function daySessionsForMiles(day) {
  if (!day) return [];
  if (Array.isArray(day.sessions)) return day.sessions.filter(s => s && s.type && s.type !== 'rest');
  return (day.type && day.type !== 'rest') ? [day] : [];
}

// Planned run miles for one day, across every run session on it.
export function dayRunMilesRaw(day) {
  return daySessionsForMiles(day).reduce((mi, s) => mi + sessionRunMiles(s), 0);
}

// Week total, rounded to 0.1 mi. The rounding lives HERE rather than at each call site
// so two surfaces can't disagree by a tenth and look like they disagree about the plan.
export function sumRunMiles(days) {
  return Math.round((days || []).reduce((t, d) => t + dayRunMilesRaw(d), 0) * 10) / 10;
}
