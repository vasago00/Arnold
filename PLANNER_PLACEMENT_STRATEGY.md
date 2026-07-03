# Planner placement — strategic design note

**Status:** strategy / design-first. Created 2026-07-01. Origin: Emil — "the UI/UX isn't
good because conceptually we haven't thought it through." Decide the MODEL before building
the 2.1 UI.

## The four jobs of a planner
1. **Configure** — how you train (available days, run/strength counts, focus, goals).
2. **Generate** — lay out a periodized schedule toward a race (engine 2.1: `generateSeasonBlock`).
3. **View / adjust** — see the schedule, edit days, move sessions.
4. **Execute** — run today's session; log it.

## The problem: these are scattered, with no flow
- **Plan tab** (`goals`): Goals + `PlanGeneratorPanel` (single-week generator) + Workbench.
- **Calendar tab**: race markers + the planned/completed schedule (day tiles, drawer).
- **Start**: today's execution.
- **Races live in TWO places** (Plan-tab list + Calendar markers) — duplication.
Net: you *generate* in one room and the plan *teleports* to another; there's no continuous
"plan → see it → tweak it → run it". That disconnect — not pixels — is the bad UX.

## Proposed model: the Calendar IS the planner
A plan is a shape in time; the calendar already is that surface. So generation becomes an
action ON the calendar rather than a separate tab that pushes in:
- **Targets are on the calendar.** Tap a race marker → "Build a plan to [this race]" — the
  whole target-race feature as one gesture. (Engine already supports `targetRaceDate`.)
- **Generate in place.** Config panel (target/horizon, available days, run/strength) →
  periodized block **previews overlaid on the calendar** (weeks it fills, colored by phase)
  → commit (fill-empty default, protects hand-edits).
- **Adjust in place** (drawer/drag — exists). **Execute** from Start, same plan.
- **Plan tab → inputs, not a home for the plan:** goals/outcomes + training preferences
  that feed the calendar's generate action. **Races consolidate to one home** (the calendar).

## Web vs mobile (differ on purpose, not by accident)
- **Web:** the calendar has room — month / multi-week grid, generate-in-place, preview
  overlay, side/drawer config. Spatial and rich.
- **Mobile:** the vertical week-scroll (exists). Generate via a bottom-sheet flow
  (target → horizon → preview list → apply). Execute from Start. Config as a sheet.

## The pivotal decisions
1. **Home of the plan** — Calendar-as-planner (generate in place) [recommended] vs keep a
   separate Plan tab that owns generation and pushes to the calendar.
2. **Generate trigger** — tap-a-race-to-build [recommended] (+ a generic "Generate plan"
   button) vs button-only.
3. **Races: one home** — move to the calendar as the single source (Plan tab references
   them) vs keep the Plan-tab list too.
4. **Web/mobile divergence** — how different are the two experiences (shared flow vs
   web-rich grid + mobile sheet).

## DECISION (2026-07-01, Emil): the Calendar IS the planner
Generate in place; races are the targets on the calendar; Plan tab → inputs (goals +
preferences). Recommended sub-defaults to proceed with unless Emil says otherwise:
tap-a-race-to-build **+** a "Generate plan" button; races consolidate to the calendar
(phased); web = rich grid + preview overlay, mobile = week-scroll + bottom-sheet flow.

## Build sequence (cadence-sized chunks)
- **C1 — Generate flow (self-contained):** new `SeasonPlanGenerator` component = config
  (target race from calendar / horizon, available days, run/strength, focus) → `generateSeasonBlock`
  → multi-week PREVIEW (week • phase • mileage • long run, colored by phase) → Apply via
  `pasteSeasonBlock` (fill-empty default + overwrite checkbox). Reuses the engine; minimal
  new surface. Buildable/testable on its own.
- **C2 — Mount in Calendar:** a "Generate plan" button on the Calendar opens C1 as a
  sheet/panel; tapping a race marker opens it pre-targeted to that race. Refresh the grid on apply.
- **C3 — Preview overlay (web):** highlight the weeks the block will fill on the month grid,
  colored by phase, before commit. (Mobile keeps the preview list.)
- **C4 — Consolidation/cleanup:** retire the old single-week `PlanGeneratorPanel` from the
  Plan tab (or reduce it to preferences); de-duplicate the races list (calendar = one home).

## Build log
- **2026-07-01 — C1 DONE (awaiting build):** `components/SeasonPlanGenerator.jsx` — target picker (specific race from calendar / next race / 4·8·12 wk) + training prefs → `generateSeasonBlock` → week-by-week preview (date • phase chip • mileage • long run) → Paste (fill-empty default + "overwrite my edits" checkbox) via `pasteSeasonBlock`. Reads races from storage; reuses the tested engine + hub paces. **Mounted TEMPORARILY in the Plan tab** (above the old single-week panel) for visibility; C2 relocates it into the Calendar with tap-a-race targeting.

- **2026-07-01 — course-correct + C2 DONE (awaiting build):** the temporary Plan-tab mount created a confusing duplicate (two generators) and contradicted the decision. Fixed: (a) **removed the old single-week `PlanGeneratorPanel`** from the Plan tab (superseded — its this-week case folded into the new generator as a "This week only" target); (b) **moved `SeasonPlanGenerator` INTO the Calendar** (mounted after the coach banner, refreshes the grid via `setTick` on apply). Plan tab now = Goals + Workbench only. **Workbench (Emil decision):** keep but **tuck away** → wrapped in a collapsed `<details>` "🔧 Workout Builder" section in the Plan tab. C3 (grid preview overlay) + tap-a-race targeting still to come.

- **2026-07-01 — C2 tap-a-race DONE (awaiting build):** the generator now lives **below the day
  drawer** as a collapsed dropdown (Emil wanted a month-header button — noted, deferred, kept
  here for now). Tapping a future race day → the drawer shows **"✦ Build plan to this race"** →
  the generator opens pre-targeted to that race (as the A-race), expands, and scrolls into view
  (`openRaceReq` → `SeasonPlanGenerator` effect). Also added the visible paces line, weekly
  mileage bars, and Clear / Paste / Remove-from-calendar controls (`clearSeasonBlock`).
- **2026-07-01 — C3 DONE (awaiting build):** generate a block → the month grid RINGS the days
  it will fill, colored by phase (build blue / taper amber / race red / recovery green), so you
  see the plan's shape on the real calendar before pasting. `SeasonPlanGenerator` publishes the
  block via `onPreview`; `CalendarTab` builds `previewByDate` (date→phase) → `MonthGrid` draws an
  inset phase-colored ring per cell. Clears on paste/clear.
- **NEXT:** C4 (delete old `PlanGeneratorPanel`, de-dup races). Also open: relocate the generator
  trigger to a month-header button (Emil's preference).

### Net state after C2 (awaiting build)
- **Plan tab:** Goals + collapsed "🔧 Workout Builder" (Workbench tucked away). No generators.
- **Calendar:** `SeasonPlanGenerator` (under the coach banner) + the month grid. Planning lives here now.
- **Removed:** old single-week `PlanGeneratorPanel` (unused file remains; delete in C4).

## Sequencing note
This supersedes the "just extend PlanGeneratorPanel" UI plan in `PLAN_GENERATOR_SEASON_2.1.md`
— the engine stays, but WHERE its UI lives is decided here first. Once the model is chosen,
the 2.1 UI is built into that home (likely the Calendar), not bolted onto the Plan tab.
