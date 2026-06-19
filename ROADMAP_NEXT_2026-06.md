# Arnold — Next-Horizon Roadmap (logged 2026-06-14)

> Forward-looking items Emil wants to work on, beyond the 2026-06 uplift (which is
> essentially complete — see `EXECUTION_PLAN_2026-06.md` / `AUDIT_EVALUATION_2026-06.md`).
> Two themes: **(A) simplify + sharpen the data/energy model**, and **(B) evolve the Coach
> from observer → planner/guide.** Current-state findings for 1 & 2 are verified against the
> code; 3 & 4 are vision to be designed.

---

## A. Data & energy model

### 1. Pull non-activity steps/movement directly from Garmin; retire the Health Connect path
**✅ DONE (2026-06-14).** `garmin-client.js`: `fetchGarminDay` now persists the daily summary
(steps/active/total kcal) into `hcDailyEnergy` via new `upsertDailyEnergyRow` (source `'garmin'`,
wins per date) — so movement data populates on **web too**, not just Android. `hc-sync.js`:
`syncDailyEnergy` now defers (`garmin_worker_preferred`) when the worker is configured, mirroring
`syncWeight` — HC's daily-energy read is no longer needed when Garmin is set up. Existing readers
(`dcy.js`, CloudSyncPanel) unchanged (same `hcDailyEnergy` shape). esbuild + free-vars clean.
**HC FULLY RETIRED (R66):** boot `startPeriodicSync`/`onSyncEvent` removed from Arnold.jsx; HC card removed from
CloudSyncPanel; `hc-sync.js`/`hc-bridge.js`/native plugin parked (recoverable) for a future non-Garmin user.
**EMIL: build + confirm steps/active/total kcal populate on web (Start/EdgeIQ + Cloud Sync card)
without Health Connect; `npm test`.**

**Goal (Emil):** simplify the interaction model — one source (Garmin), drop the HC dependency.

**Current state (verified):**
- The Garmin client **already fetches the daily summary including steps/kcal/intensity-minutes/
  floors** — `core/garmin-client.js:207-211` (`steps: num(garminSummary.totalSteps)`), inside
  `fetchGarminDay`.
- But it **intentionally does NOT persist** steps/kcal: `garmin-client.js:372` — "Garmin's daily
  summary (steps/kcal) → intentionally NOT persisted; HC [owns steps + kcal]." Steps/kcal are
  currently owned by `core/hc-sync.js → syncDailyEnergy` writing `hcDailyEnergy` (Android-only,
  read-only HC; the stream we just repaired in R62).
- So today: movement data requires the Android build + Health Connect + a source app writing into
  HC — exactly the multi-hop fragility Emil wants gone.

**Approach (feasible, well-scoped):** persist the Garmin daily-summary steps/active-kcal/total-kcal
into the same `hcDailyEnergy` shape (or rename to a neutral `dailyEnergy` collection) from
`fetchGarminDay`, keyed by date; make the Garmin path authoritative and demote HC to an optional
fallback (or remove). Benefits: works on web too (HC is Android-only), removes the silent-permission
failure class, single source of truth. Watch-outs: dedup/precedence vs any existing HC rows;
Garmin "totalSteps" vs HC daily bucket parity; keep the `hcDailyEnergy` readers (`dcy.js`,
CloudSyncPanel) working during the cutover.

### 2. Factor non-activity steps/movement into RMR/daily energy target
**✅ DONE (2026-06-14, proper fix). Two bugs caught + fixed before this was trustworthy:**
- **(a) Coefficient was ~80x too high.** `steps × 0.04 × bodyMassKg` gives 12k steps @ 80 kg =
  38,400 kcal NEAT (real ≈ 480). `0.04` was a per-step value mislabeled per-kg, then multiplied by
  kg. Corrected to **`0.0005` per-step-per-kg** in BOTH `energyBalance.js` and `dcy.js` (the latter
  had the same latent bug, dormant because its Tier-1 device total usually wins).
- **(b) Workouts were double-counted in the target.** The old `tdee.tdee` baseline included
  `activityKcal`, and the target then re-added the session via eat-back. Fixed: `computeTDEE` now
  also returns **`restingTdee` = RMR + steps-NEAT + TEF (NO workouts)**, and `goalModel`'s target
  baseline uses `restingTdee`, with workouts added exactly once via eat-back.
- NEAT is steps-derived (`steps × 0.0005 × bodyMassKg`) when a real daily step count exists
  (Garmin-fed via #1), flat `RMR×0.13` fallback otherwise; returns `neatSource`/`steps`.
- esbuild + free-vars clean. **NOTE for follow-up:** the *empirical* path (`rec.tdeeEmpirical`,
  weight-trend-fitted full maintenance) + eat-back may also double-count workouts — left untouched
  (calibration engine; needs its own audit). **EMIL: build + `npm test`; targets will be LOWER on
  workout days now (correct — old version over-fed); sanity-check high- vs low-step days differ.**

**Goal (Emil):** the day's "calories to burn"/target should reflect actual non-activity movement,
not a flat assumption. (Emil's hunch: it currently doesn't — **confirmed**.)

**Current state (verified):**
- The daily calorie **target** (`core/goalModel.js → getEffectiveTargets`) derives its expenditure
  base from `computeTDEE(today)` (`goalModel.js:224`).
- `computeTDEE` = `RMR + activityKcal + neatKcal + tefKcal`, and **NEAT is a flat factor**:
  `neatKcal = rmr × 0.13` (`energyBalance.js:247`, `NEAT_FACTOR_DEFAULT = 0.13`). The header even
  says NEAT is "estimated from RMR × NEAT_factor **in absence of step count**." → actual steps do
  **not** move the target; a 3k-step day and an 18k-step day get the same NEAT.
- Meanwhile a **calibrated steps→NEAT model already exists but isn't wired into the target**:
  `core/dcy.js:286` `NEAT_KCAL_PER_STEP_PER_KG = 0.04` (Tudor-Locke/Bassett, ±20% vs DLW), reading
  `hcDailyEnergy` steps for a "steps-derived NEAT" tier. So the math exists; it just doesn't feed
  `computeTDEE`/the target.

**Approach:** when a real daily step count is available (post-item-1, from Garmin), replace the flat
`rmr × 0.13` NEAT in `computeTDEE` with the steps-derived NEAT (`steps × 0.04 × bodyMassKg`),
falling back to the flat factor only when steps are missing. This makes the target responsive to
actual movement and unifies the two NEAT computations (energyBalance vs dcy) into one. Naturally
**coupled to item 1** (reliable steps in → real NEAT out). Guard against double-counting activity
kcal vs step kcal on workout days.

---

## B. Coach evolution — from scorekeeper to coach (the big one)

> This is the ultimate target spot and where the intelligence pays off. It builds on parts that
> already exist (`adaptPlan.js`, `todayAdaptation.js`, `planner.js`/`planGenerator.js`,
> `fuelForWork.js`, `goals.js`, the hub) — the work is connecting them into a goal-aware,
> continuously-recalibrating coach.

### 3. Coach as planner & guide, driven by explicit goals
**Goal (Emil):** the Coach should plan and guide, not just observe/evaluate. It needs first-class
**goal inputs** across dimensions:
- **Activity / training** goals — near-term and long-term (e.g. weekly volume, build vs maintain).
- **Race** goals — target race(s), date(s), goal time/pace.
- **Body** goals — weight, body-fat, lean-mass targets and timelines.
- **Nutrition** goals — intake/macros/fueling, energy-availability guardrails.

**Direction:** a single goal model the Coach reasons from (some pieces exist in `core/goals.js` +
profile targets). The Coach then *prescribes* (generates/owns the plan) rather than just reading a
static plan, and *guides* (explains the path from today's state to the goal). This is the bridge
from "one Coach voice" (done) to "one Coach mind that has a plan."

### 4. Live adaptability — instantaneous recalibration on training changes
**Goal (Emil):** when reality diverges from the agreed plan, the Coach recalibrates **immediately**
and surfaces the consequences + the path back. Concretely:
- If a planned day is **skipped / swapped / done lighter** (or a different activity done), the Coach
  alerts to the **knock-on effects** on the weekly plan and long-term goals, and **suggests how to
  get back on track**.
- Trade-off transparency both ways: "take a rest/mobility day today → you gain recovery, but you'll
  need to push harder tomorrow/this week to stay on goal," AND the Coach proactively **pushes
  recovery/light days** when that's what the long-term goal needs.
- "This is where the intelligence really shines and value is added."

**Direction:** extend the existing readiness→tomorrow adaptation (`adaptPlan`/`todayAdaptation`) from
a *single-day* nudge into a *plan-level* re-solve: a change today re-flows the rest of the
week/block against the goal, with the delta explained in the Coach voice. Pairs with item 3 (needs
goals to recalibrate *against*) and the transparency-hero direction in `UX_UI_REVIEW_2026-06.md`
(show the why + the knock-on). Likely the flagship feature of the next phase.

---

## Sequencing note
Items **1 → 2** are a tight, low-risk pair (data plumbing) and a good warm-up. Items **3 → 4** are
the high-value, higher-design coach evolution and should be scoped deliberately (goal model first,
then the live re-solve). The UX for 3 & 4 rides on the "governed density + transparency hero"
direction now being prototyped.
