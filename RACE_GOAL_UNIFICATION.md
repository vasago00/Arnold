# Race / Goal Resolution — Audit & Unification (2026-07-16, Emil + Claude)

> Origin: the planner coach said "Berlin Marathon in 73 days" while the countdown + peak targeted
> "Valencia (143d)". Root cause: multiple call sites resolved "which race" DIFFERENTLY. This audit
> maps every site, defines the two legitimate concepts, and unifies the goal-race path on ONE resolver.

## The two concepts (keep them apart)

| Concept | Means | Resolver | Used for |
|---|---|---|---|
| **A-RACE / GOAL RACE** | the race the block is built toward | `core/aRace.js → resolveARace()` (+ `planPrefs.target`) | coach voice, peak mileage, "Nd → race" countdown, the plan, weak-link, race-readiness |
| **NEXT / SOONEST RACE** | the chronologically next race | `computeRaceHorizon` / `futureRaces[0]` | taper + race-week fueling (you taper for whatever's next, even a tune-up) |

These are legitimately different. The bug was goal-context sites using the *soonest* race.

**Canonical A-race order** (`resolveARace`): explicit `aRaceDate` → a MARATHON with a goal time → any
goal-time race → the soonest marathon → an explicit priority-'A' race. (You only set a goal time on the
race you're training for; `priority` is unreliable — the editor defaults every race to 'A'.)

## What was FIXED

- **`core/aRace.js` (new)** — the single resolver + robust `isMarathon` (distance mi/km OR name, excl. halves).
- **`core/goalResolve.js`** — `buildGoalModel` now calls `resolveARace` (was an inline order; behaviour
  identical for distance-carrying races, now also catches name-only marathons).
- **`core/raceRecipe.js`** — `nextARace` now calls `resolveARace`. This was the DIVERGENT one: it preferred
  the *soonest marathon* (→ Berlin) over the goal-time marathon (→ Valencia). Now aligned. This flows
  through to `trainingProfile` (weak-link / goal profile) and everything built on the recipe.
- **`components/CoachComment.jsx`** — the plan-line fallback (`composePlanLine`) now frames toward the goal
  race via `goalRaceHorizon()`, and the hub race-readiness picker (`_next`) uses `resolveARace`. (The
  narrative engine already resolved the goal race via `buildCoachContext`.)

## CORRECT as-is (next-race context — do NOT change)

- `core/coachSignals.js → computeRaceHorizon` — taper / race-week; the next race is the right anchor.
- `components/LogDay.jsx → _nextRace` — feeds the workout tile's taper/race-week awareness (next race).
- `core/hub/planGenerator.js` — anchored on the explicit `targetRaceDate` (= `planPrefs.target`); its
  per-week `isMarathon` taper is correct (every marathon tapers).
- `core/seasonCoach.js` — uses the season phase's `nextRace` for phase timing (chronological is right).

## OPEN — a product decision, not a bug (flagged for Emil)

- **`components/MobileHome.jsx → nextRace`** (mobile Start race card): shows the SOONEST race with a
  countdown + finish prediction. That's a defensible "your next race is X in N days" — but it makes the
  mobile Start show **Berlin** while the web plan header shows the goal **Valencia**. Decision needed:
  should the Start race card show the GOAL race (consistency with the plan) or the NEXT race (what you'll
  actually run next, with its finish prediction)? A middle option: show the next race for the countdown/
  prediction, but LABEL it ("next race") and add a separate goal-race line, so neither reads as "the race"
  ambiguously. Left unchanged pending that call.
