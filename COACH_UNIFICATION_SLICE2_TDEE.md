# Coach Unification — Slice 2: One TDEE (and one RMR) source

**Created 2026-06-26 · design-first, awaiting sign-off before refactor.**
Companion to `COACH_UNIFICATION_DESIGN.md` (Slice 1 = one `racePhase` source, shipped).

## The problem (observed)
Today the DCY card read a TDEE built from the Garmin device total while the EdgeIQ
Energy-Balance tile read a model sum — **689 vs 2038 kcal for the same day**. Two
engines compute "today's TDEE" two different ways, and they disagree:

| Concern | `dcy.tdeeWithTier(date)` | `energyBalance.computeTDEE(date)` |
|---|---|---|
| Shape | device-first, 3-tier | pure model sum |
| Tier 1 | device 24/7 total (`hcDailyEnergy.totalCalories`), now gated `≥ bmr` | — (never uses device total) |
| Fallback | steps-NEAT + `activityBurnFor` → `bmr + activityBurn` | always `RMR + activityKcal + steps-NEAT + TEF` |
| RMR source | `bmrWithTier()` — **lab/clinical RMR first**, then Katch→Mifflin, floor ≥1700 | `computeRMR()` — **Katch-McArdle / Mifflin only** (ignores lab RMR) |
| TEF | added | added |
| Consumers | DCY card, `cutMode` | EdgeIQ balance, `fuelForWork`, `insights`, `EnergyTimingChart` |

So there are really **two divergences**: TDEE definition AND the RMR underneath it.
Note the primary cut target (`recommendCalorieTarget`) uses `empiricalTDEE` (intake±weight
ground truth) — neither engine — so blast radius is the *display/fuel* surfaces, not the cut.

## The principle (DESIGN_DECISIONS)
One source of truth. There should be exactly one "what did I burn today" number and one
RMR, with a single documented rule for when the device total wins.

## Proposed canonical
**RMR:** `dcy.bmrWithTier()` becomes THE RMR. It strictly dominates `computeRMR()` (adds a
lab-RMR Tier 1 on top of the same Katch/Mifflin ladder). `energyBalance.computeRMR()` is
re-pointed to delegate to it (keep the export + return shape for call-site stability).

**TDEE:** `dcy.tdeeWithTier()` becomes THE all-in TDEE (device-first, BMR-gated). It's the
more accurate "burn today" because it prefers the watch's measured 24/7 total and falls
back to the model only when that's absent/partial. `energyBalance.computeTDEE(date)` keeps
its rich return object (so `fuelForWork`/balance breakdowns don't churn) but its headline
`.tdee` field is set to `dcy.tdee(date)` — so every surface shows the same number.

**restingTdee (for eat-back / fuel):** stays a model decomposition (`RMR + NEAT + TEF`, no
workouts) because a device total can't be decomposed — BUT it now uses the **canonical RMR**
and the same de-duped steps-NEAT, so `restingTdee + workouts ≈ tdee` reconciles on a normal
day. This is the one model breakdown, exported once.

## Execution slices (smallest-change, each its own build+test)
- **2-a · One RMR.** `energyBalance.computeRMR()` delegates to `dcy.bmrWithTier()`. One RMR
  everywhere. *Behavior change:* surfaces that showed the Katch/Mifflin RMR now show
  lab-first RMR when a clinical RMR exists (more accurate). Add a unit test: with a clinical
  RMR present, `computeRMR().rmr === bmrWithTier().value`.
- **2-b · One TDEE headline.** `computeTDEE().tdee = dcy.tdee(date)`; keep `restingTdee`,
  `neatKcal`, `activityKcal`, `intakeKcal` for the breakdown, recomputed off canonical RMR.
  EdgeIQ balance + DCY card now agree. Add a test: `computeTDEE(d).tdee === tdee(d)`.
- **2-c · Reconcile + guard.** Assert/curate `restingTdee + todaysWorkoutKcal ≈ tdee` (within
  tolerance) so the eat-back model can't silently drift from the headline; document the rule
  in `DATAMODEL.md`.

## Risks / call-outs
- Avoid a circular import: `energyBalance.js` already imports from `dcyMath.js`; `dcy.js`
  imports `computeRTSS`/`computeTonnage` from `trainingStress.js`. Pull `bmrWithTier`/`tdee`
  via a call-time getter (the pattern `trainingStress.js` already uses for `dcyMath`) if a
  static import would cycle.
- The ≥1700 BMR floor (dcy) will now apply to the balance tile's RMR too — intended, but
  worth eyeballing for a small user.
- This unifies the *display/fuel* path. The **cut target** stays empirical-first (correct);
  we are NOT changing how the cut number is produced.

## Build log
- **2026-06-26 — decision:** Emil chose the full **`energyExpenditure` service** (not the cheap delegate) to set up the transparency hero (2.3) + fuel (2.4).
- **2026-06-26 — 2-a DONE (awaiting build):** `energyBalance.computeRMR()` now delegates to `dcy.bmrWithTier()` (cycle-safe `import * as _dcy`). Keeps `{rmr, formula, inputs}` + adds `tier`. One RMR everywhere.
- **2026-06-26 — 2-b DONE (awaiting build):** new `core/energyExpenditure.js`. Refined the design while building: the service exposes TWO answers, because empirical TDEE is a 4-week average (right for maintenance, wrong as "today's burn"):
  - `tdee` = today's expenditure (device Tier-1 → model), `source`/`confidence`/`note`.
  - `maintenance` = empirical (high/med) → expenditure, with its own source/confidence.
  - plus full model decomposition (rmr/activity/neat/tef/restingTdee/intake) + raw `candidates`.
  Pure selectors `pickExpenditure`/`pickMaintenance` unit-tested in `tests/energyExpenditure.test.mjs`.
- **2026-06-26 — 2-c DONE (awaiting build):** wired the surfaces that display a TDEE/deficit number to the one service:
  - `EnergyTimingChart.jsx` (the on-screen "BURN TODAY" Σ) → `energyExpenditure().tdee`; stacked bar stays the model decomposition; added a source note (`◷ watch-measured` / `≈ estimated`).
  - `cutMode.js` `_avgTdee` → `energyExpenditure(ds).tdee` per day (the 14/28-day average is the maintenance basis).
  - `fuelForWork.js` — inspected; only reads `intakeKcal` (no TDEE total), so no divergence → left as-is.
  - EdgeIQ burn donut — a rough 30-day average on the now-unified RMR; left as-is.
  - DCY card — aligns via the shared RMR (2-a) + the Tier-1 ≥RMR gate; a full rewire to read the service is blocked by the cycle (dcy can't import the service) and is a **follow-up** (component-level), not needed for consistency now.
  - Documented the canonical precedence in `DATAMODEL.md` (Layer 1 — energy variables).
- **Follow-up (parking lot):** have the DCY card/MobileHome read `energyExpenditure` directly so the composite's embedded TDEE is literally the service value (currently equivalent-by-construction on most days).

## Open decision for Emil
Do 2-a (unify RMR to lab-first) **now** as part of this slice, or unify **TDEE only** (2-b/2-c)
and defer the RMR swap? RMR-first is the cleaner "one source," but it changes the displayed
RMR/restingTdee for anyone with a clinical RMR on file.
