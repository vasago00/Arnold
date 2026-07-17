// core/aRace.js — THE ONE definition of "the race the plan is built toward" (the A-race).
//
// This exists because two resolvers used to inline their OWN order and DISAGREED: goalResolve
// preferred the marathon you set a goal time on, raceRecipe preferred the SOONEST marathon — so on
// a calendar with Berlin (soon, no goal time) + Valencia (later, 3:30 goal) the coach/plan named
// Berlin in some places and Valencia in others (Emil, 2026-07). This is the single source of truth.
//
// TWO DISTINCT CONCEPTS — keep them apart:
//   • A-RACE / GOAL RACE  → resolveARace() here. The race the block is built toward. Used for goal
//                            framing: coach voice, peak mileage, the "Nd → race" countdown, the plan.
//   • NEXT / SOONEST RACE → the chronologically-next race (computeRaceHorizon / futureRaces[0]).
//                            Used for taper + race-week fueling — you taper for whatever race is next,
//                            even a tune-up. That is legitimately different; do NOT unify the two.
//
// PURE — no storage/date imports, so it stays node-testable and can't fabricate.

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const MIN_MI = 24;
const KM_PER_MI = 1.60934;

// A marathon by DISTANCE (mi or km) or by NAME ("… Marathon", but not "Half Marathon"). Matches the
// robust check raceRecipe already used, so a name-only "Berlin Marathon" with no distance still counts.
export function isMarathon(r) {
  if (!r) return false;
  const mi = num(r.distanceMi) ?? num(r.distance_mi);
  if (mi != null && mi >= MIN_MI) return true;
  const km = num(r.distanceKm) ?? num(r.distance_km);
  if (km != null && km >= MIN_MI * KM_PER_MI) return true;
  const name = String(r.name || '').toLowerCase();
  return /\bmarathon\b/.test(name) && !/\bhalf\b/.test(name);
}

/**
 * resolveARace(races, today, aRaceDate?) → the A-race object (or null).
 *
 * Order (the CANONICAL one, from goalResolve — you only set a goal time on the race you're training
 * for): explicit aRaceDate → a MARATHON with a goal time → any race with a goal time → the soonest
 * marathon → an explicit priority-'A' race. `priority` alone is unreliable (the editor defaults every
 * race to 'A'), so it's the LAST resort.
 */
export function resolveARace(races, today, aRaceDate = null) {
  const list = Array.isArray(races) ? races : [];
  if (aRaceDate) {
    const exact = list.find((r) => r && r.date === aRaceDate);
    if (exact) return exact;   // an explicit target wins even if it's a non-marathon / past date
  }
  const future = list
    .filter((r) => r && r.date && String(r.date) >= String(today))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return future.find((r) => isMarathon(r) && Number(r.goalTimeSecs) > 0)
    || future.find((r) => Number(r.goalTimeSecs) > 0)
    || future.find(isMarathon)
    || future.find((r) => String(r.priority || '').toUpperCase() === 'A')
    || null;
}

// The A-race's date (the anchor racePhase/season logic keys on). Explicit target wins.
export function resolveARaceDate(races, today, aRaceDate = null) {
  if (aRaceDate) return aRaceDate;
  const r = resolveARace(races, today);
  return r ? r.date : null;
}

export default resolveARace;
