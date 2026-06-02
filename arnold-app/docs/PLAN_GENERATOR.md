# Plan Generator — reverse-periodized training plans

> Status: **DESIGN** (2026-06-01). Not yet built. This is the spec the
> implementation should follow. Centerpiece of Coach v3 (programming, not
> just signals). See COACH.md (v3 dialogue/programming) and RACES.md
> (per-race prep metrics + `patternMarathon*`).

## What it is
Given a target race + goal time, work **backwards** to a week-by-week
training prescription: weekly mileage, the easy/tempo/speed split, long-run
progression, and strength — calibrated to the athlete's CURRENT state and the
weeks remaining. It is a *sharpening / gap-closing* engine, not a
start-from-zero plan: it assesses where the athlete is and recommends what's
achievable in the time left.

## First target: Berlin
- **Goal:** sub-3:40 marathon, and it should "feel easy to hit" → design to a
  fitness ceiling ABOVE goal pace so race day sits comfortably inside range.
- **Athlete state (Emil):** marathon PR 3:47 (run twice last year). Base
  already built. Focused build starts after HYROX (~mid-June).
- **Goal pace:** 3:40:00 / 26.2 mi = **8:23 /mi** (≈5:13 /km). Target-fitness
  pace a touch faster (~8:10–8:15) so goal feels controlled.
- Then **NY** (hills — course modeling matters), then **Valencia** (flat, PR
  attempt).

## Inputs (all already in Arnold — this is why we built them)
- **Current fitness** → `predictRaceFinish` + `fatigueExponent` (personal
  log-log fit / durability / distance-aware). Gives current predicted
  marathon + the personal fatigue exponent.
- **Threshold/LT pace + HR** → profile / Goals (and the planned Arnold-native
  LTHR calculator). Anchors the tempo & goal-pace zones.
- **Training readiness / load** → ACWR (`computeAcuteChronicRatio`), weekly
  load, HS scores, Cut Mode, recovery signals. Governs how fast volume can ramp.
- **History** → recent weekly mileage, longest run, polarization
  (`computePolarizationIndex`), strength frequency. The starting point of the
  ramp.
- **Constraints (USER-SUPPLIED — still needed for Berlin):** available
  training days/week, and how many strength sessions are non-negotiable.
  ⟵ TODO: collect these from Emil before building Berlin.

## The backward math (core algorithm)
1. **Required fitness** = invert the endurance model: what threshold pace +
   fatigue exponent are needed to hold goal pace for 26.2 with margin.
2. **Gap** = required fitness − current fitness (from `predictRaceFinish`).
3. **Feasibility check** = is the gap closable in the weeks remaining at a
   safe ramp (ACWR ≤ ~1.3, ~10%/wk volume cap)? If not, the Coach says so and
   proposes the best achievable time instead of a fantasy plan. (This is the
   "assess and recommend what can be done" behaviour Emil asked for.)
4. **Peak targets** (from RACES.md marathon block): peak weekly mileage,
   long-run peak (~20–22 mi / ~85% race distance), minutes at goal pace.
5. **Periodize backward from race day:**
   - Taper (2–3 wk): volume down ~40–50%, intensity retained.
   - Peak (3–4 wk): max volume + race-pace specificity (goal-pace long runs).
   - Build (4–6 wk): progressive volume, threshold emphasis.
   - Base/transition (now → build): bridge current volume to build start.
   - Cutback every 3rd–4th week (~20–30% down) for absorption.
6. **Weekly prescription** per week: total mi, polarized split
   (~80% easy / ~15% threshold-tempo / ~5% speed, phase-adjusted), long-run
   distance, # strength sessions, which sessions are at goal pace.

## Outputs
- A week-by-week table (mileage, split, long run, key workouts, strength).
- A one-line Coach verdict: "sub-3:40 is achievable / aggressive / not in this
  window — here's the realistic target."
- Writes into the existing planner (`planner.js`) so each prescribed week shows
  up on the Calendar + Plan tab with distances (the `+Plan` distance field we
  just added is the write target).

## Adaptive replanning (what makes it a coach, not a static plan)
Re-run weekly against actual logged data: if the athlete hits/misses volume,
if ACWR spikes, if readiness drops, the remaining weeks re-solve. The plan is
a living projection, same philosophy as the annual-goal projection.

## Course modeling (NY) — dependency, separate item
NY's elevation changes the pacing plan and the required durability. Needs the
course-elevation data source (see HANDOVER race-predictor follow-ups). Berlin
+ Valencia are flat enough to ignore initially; build the generator course-
blind first, layer course modeling in for NY.

## Build stages (incremental — don't boil the ocean)
1. **Assessment read-out:** current marathon projection + gap to sub-3:40 +
   feasibility verdict. (Smallest useful slice; proves the backward math.)
2. **Static Berlin plan:** generate the full week-by-week table once, write to
   planner. Collect Emil's days/week + strength constraints first.
3. **Adaptive replanning:** weekly re-solve from logged data.
4. **Course modeling:** layer in for NY.
5. **Generalize:** Valencia (PR attempt) + make race-type-agnostic.

## Open questions / decisions still needed
- Emil's available training days/week + non-negotiable strength count.
- Exact sub-3:40 confirmation (assumed from this convo) + Berlin date.
- How prescriptive vs advisory the weekly output should be (hard targets vs
  ranges).
- Periodization model: which template (Pfitzinger / Daniels / Hanson-style) to
  base phase structure on, or a blended Arnold-native one.
