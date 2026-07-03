# Sprint 2 · 2.1 — Adaptive plan generation (periodized, multi-week)

**Status:** design-first, awaiting sign-off. Created 2026-07-01.
**Acceptance (sprint plan):** "Generate plan produces a real multi-week schedule to the
calendar" — periodized weeks (base/build/mini-taper/recovery) with weekly mileage +
long-run targets, driven off the season engine.

## What already exists (reuse, don't rewrite)
- `core/hub/planGenerator.js` → `generateWeeklyPlan(opts)`: pure + tested. Lays ONE 7-day
  week (long / quality / easy / strength) across your `availableDays` from a
  `weeklyMileageTarget` + `paces`. Also `pacesFromHubFacts`, `generateAndSaveWeek`.
- `components/PlanGeneratorPanel.jsx`: configure (available days, run/strength counts,
  focus) → Generate → preview ONE week → paste to this/next week.
- `core/seasonPlan.js` → `resolveSeasonPlan({races, today, weeklyMiles, longestRecentMi,
  acwr, ceilingMiles})`: THE periodization engine — returns `{ phase, verdict,
  targetWeeklyMiles, longRunTargetMi, tuneUp, nextMarathon, why }` for a given week.

## The gap
The generator produces ONE generic week from a static mileage target. It is NOT
season-driven: no ramp toward races, no mini-taper before / recovery after a marathon,
no multi-week block. 2.1 closes that.

## Design — a season layer that composes the two engines
New pure fn `generateSeasonBlock(opts)` in `planGenerator.js` (keeps `generateWeeklyPlan`
untouched):

```
generateSeasonBlock({
  races, today, horizonWeeks,            // how far to project
  availableDays, runDays, strengthDays, focus, paces,
  weeklyMiles, longestRecentMi, acwr, ceilingMiles   // current load → seeds week 1
}) → { weeks: [ { weekKey, phase, verdict, targetWeeklyMiles, longRunTargetMi, why, days } ], summary }
```

Loop, week by week from this Monday:
1. `sp = resolveSeasonPlan({ races, today: <thatMonday>, weeklyMiles: <carried>, longestRecentMi, acwr, ceilingMiles })`.
2. Map `sp.phase` → `generateWeeklyPlan` opts for that week:
   - **build** → normal week; `weeklyMileageTarget = sp.targetWeeklyMiles`; long run = `sp.longRunTargetMi`; quality per `focus`. Tune-up week (`sp.tuneUp`) → swap one quality for the tune-up race, no taper.
   - **mini-taper** → `generateWeeklyPlan` at the reduced `sp.targetWeeklyMiles` (~0.6×), drop the long run, keep ≤1 short sharpener.
   - **race-week** → the marathon is the key session (placed on race day from `races`); only short easy around it; no quality/long.
   - **recovery** → easy only, no quality, capped short long run (`sp.longRunTargetMi`).
3. **Thread the ramp:** next week's input `weeklyMiles` = this week's `targetWeeklyMiles`
   (so build ramps ~10%/wk toward the ceiling, exactly as `resolveSeasonPlan` intends).
4. Attach `phase` + `why` to the week for the preview and the calendar.

## Paste to calendar — the one real safety decision
`pasteSeasonBlock(weeks, { mode })` writes each week via `savePlannerWeek`. Options:
- **fill-empty** (safe default): only write days that are empty/rest OR already
  `generated:true`; NEVER overwrite a day you hand-edited.
- **overwrite**: replace every day in range (with a confirm).
Recommend **fill-empty default + an explicit "overwrite my edits" checkbox**.

## UI
Extend `PlanGeneratorPanel`: a "Season block" toggle → horizon selector (e.g. "to next
race" / 4 / 8 / 12 weeks) → preview a compact week-by-week list (phase • mileage • long
run, colored by phase) → "Paste N weeks" with the fill-empty/overwrite choice.

## Build log
- **2026-07-01 — decisions:** horizon = **selectable each time** (next race / 4 / 8 / 12 wk); paste = **fill-empty default** (protect hand-edits) + overwrite option; **engine-first** then UI.
- **2026-07-01 — engine DONE (awaiting build):** `generateSeasonBlock(opts)` + `pasteSeasonBlock(store, weeks, {mode})` added to `planGenerator.js` (single-week engine untouched). Per-week phase + targets from `resolveSeasonPlan`; ramp threaded (this week's target → next week's input); phase rules (build sets long run to season target; mini-taper drops long + trims to 1 quality; race-week places the marathon + easy; recovery easy-only, capped long). Week containing a marathon is forced to race-week. 4 unit tests in `tests/hubPlanGenerator.test.mjs`.
- **2026-07-01 — target a SPECIFIC race (Emil ask):** engine now takes `opts.targetRaceDate` — build all the way to any chosen race/event on the calendar (not just the chronologically-next one); intermediate marathons fold in as race-weeks automatically (test: target Valencia → Berlin + NYC + Valencia all get race-weeks, block ends on Valencia). `horizon` still supports 'next-race' / 4 / 8 / 12.
- **NEXT (UI chunk):** extend `PlanGeneratorPanel` — a "Season block" toggle → target picker: **a specific race from your calendar** (primary) OR next race / 4 / 8 / 12 wk → multi-week preview (phase • mileage • long run, colored by phase) → "Paste N weeks" with fill-empty default + an "overwrite my edits" checkbox.
- **Open nuance (note for later):** the engine only tapers for MARATHONS. If you target a shorter goal event (a half/10K) and want a real taper into it, that's a small refinement (taper for the *targeted* race regardless of distance) — not built yet.

## A-race prioritization (2026-07-01, Emil decision)
Problem Emil spotted: continuous model treated all 3 marathons equally, so peaks DESCENDED
(Berlin 42 = ceiling, Valencia lower) — backwards for a sub-3:30 goal at Valencia. Also the
42 peak is just his 30mpw target × 1.4 (a volume-setting lever).
Fix (built, awaiting build): **targeting a race = making it the A-race.** `racePhase` /
`resolveSeasonPlan` take `aRaceDate`; only the A-race triggers taper/recovery, other
marathons become supported TUNE-UPS the build runs through (no reset), so volume climbs to
the ceiling and peaks INTO the goal. `generateSeasonBlock` derives `aRaceDate` from
`targetRaceDate`; A-race week = race-week, non-A marathon = build week with the race placed
(replaces that week's long run). Tests updated (only 1 race-week for the A-race; build
doesn't reset; default no-A-race still tapers every marathon). UI notes "goal (A-)race".

## Still open
- **Generate-plan PLACEMENT** (Emil): the card under the coach banner isn't well positioned —
  wants it "obvious yet tucked away." Proposed: a "＋ Plan" / "Generate" button in the
  calendar's month-header toolbar that opens the (collapsed) generator, instead of a full row
  above the grid. NOT done yet.
- Volume: for a sub-3:30 goal, the 42 peak (30mpw×1.4) is modest — consider raising the weekly
  target/ceiling. (Settings lever, not code.)

## Open decisions for Emil
1. **Horizon default** — to the next marathon (Berlin, Sep 27), or a rolling 8–12 weeks?
2. **Paste safety** — fill-empty-only by default (protect manual edits) vs overwrite? (I recommend fill-empty.)
3. **Scope of this chunk** — ship the ENGINE + a minimal preview/paste first (build/test the periodization), then polish the UI in a second pass? (Recommended, matches cadence.)
