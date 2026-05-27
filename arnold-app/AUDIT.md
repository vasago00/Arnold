# Phase A2 Audit — Calculator Consumer Map

**Status:** ✅ PHASE A COMPLETE as of Phase 4r.dataspine.4 (2026-05-24).
All 89 call sites either migrated, deleted, or intentionally retained
as Layer 1 internal. Legacy exports (`resolveCalorieTarget`,
`resolveCalorieTargetVerbose`, `getDynamicCalorieTarget`,
`getDynamicMacroTarget`) now throw deprecation errors so any
forgotten import surfaces loudly instead of silently producing
divergent numbers. The `getEffectiveTargets` reader in
`src/core/goalModel.js` is the single source of truth for daily
calorie + protein + carbs + fat + fiber targets.

Phase A finalization shipped:
1. `tileMetrics.js` migrated (the last unmigrated true call site).
2. `goalModel.deriveDailyMacros` added — getEffectiveTargets now
   surfaces dailyCarbs / dailyFat / dailyFiber so consumers no
   longer read the legacy goals.dailyCarbTarget etc. fields.
3. `coachingPrompts.js` line 238 migrated (the macro blocker
   that was deferred to dataspine.3).
4. Defensive fallback chains stripped across Arnold.jsx,
   MobileHome.jsx, NutritionInput.jsx, CalendarTab.jsx
   (~14 sites). Every consumer now reads goalModel directly.
5. Legacy exports replaced with throwing stubs. Comment headers
   document the migration map for anyone resurrecting the path.
6. Layer-boundary verification grep: UI files reading
   `storage.get('weight/sleep/hrv/...')` pass source arrays into
   computeUserState (Layer 3), not duplicating calculator math.
   Clean.

The document below is preserved as the migration record. Future
audits should compare against AUDIT.md as the prior-state baseline.

## Summary

Total of **89 call sites** found across 5 batches. Biggest offender:
`Arnold.jsx` (14 deprecated function calls) and `resolveCalorieTarget`
(11 consumer files). Most critical duplicate: `computeRecoveryLoad` is
defined inline in `goalModel.js` (line 375) but logic is reimplemented
in `intelligence.js` (line 161) and `predictedBands.js` — three
separate scoring algorithms for the same 0-3 recovery debt classifier.
Major risk area: `getDynamicCalorieTarget` & `getDynamicMacroTarget` in
`energyBalance.js` are NOT the same as `getEffectiveTargets` in
`goalModel.js`; the latter is the new canonical but many callers still
use the deprecated functions.

---

## Batch 1 — Calorie target consumers

**Status:** ✅ User-visible surfaces migrated as of Phase 4r.dataspine.2
(2026-05-23). Calendar drawer + Nutrition tab + EdgeIQ Fuel card +
Arnold.jsx Daily/Trend now all route through goalModel.getEffectiveTargets.
Remaining: coachingPrompts.js (5 sites, internal rule triggers) +
tileMetrics.js (1 site). These don't affect user-visible numbers
directly; deferred to dataspine.3.

**Total call sites:** 28
**Top affected files:**
1. Arnold.jsx (6 call sites) — ✅ migrated
2. energyBalance.js (8 call sites — internal derivations) — KEEP (Layer 1 internal)
3. coachingPrompts.js (5 call sites) — ✅ 3 of 5 migrated in dataspine.3 (r_nutritionPacing, r_macroBalance, r_underFuelling). Lines 238 (macro gram targets) remains — goalModel doesn't carry carbs/fat yet (Phase 2 follow-up).
4. CalendarTab.jsx (2 user-visible sites) — ✅ migrated
5. NutritionInput.jsx (2 sites) — ✅ migrated
6. MobileHome.jsx (1 site) — ✅ migrated
7. tileMetrics.js (1 site) — DEFERRED to dataspine.3

| File:Line | Pattern | Migrate to | Risk |
|---|---|---|---|
| Arnold.jsx:77 | import getDynamicMacroTarget | replace with getEffectiveTargets import from goalModel.js | MEDIUM |
| Arnold.jsx:78 | import resolveCalorieTarget | replace with getEffectiveTargets import from goalModel.js | MEDIUM |
| Arnold.jsx:3254 | resolveCalorieTarget(td(),profile) | getEffectiveTargets({date:td()}).dailyCalories.effective | LOW |
| Arnold.jsx:3366 | resolveCalorieTarget(td(),profile) | getEffectiveTargets({date:td()}).dailyCalories.effective | LOW |
| Arnold.jsx:3367 | resolveCalorieTarget(todayStr, profile) | getEffectiveTargets({date:todayStr}).dailyCalories.effective | LOW |
| Arnold.jsx:5298 | resolveCalorieTarget(todayStr, profile) | getEffectiveTargets({date:todayStr}).dailyCalories.effective | LOW |
| Arnold.jsx:5809 | getDynamicMacroTarget() | getEffectiveTargets() — dailyCalories + dailyProtein | MEDIUM |
| Arnold.jsx:5810 | dyn?.dynamicTarget ?? resolveCalorieTarget() fallback | getEffectiveTargets().dailyCalories.effective | MEDIUM |
| Arnold.jsx:8689 | getDynamicMacroTarget() useMemo | getEffectiveTargets() (pure, no memo needed) | LOW |
| Arnold.jsx:9285 | resolveCalorieTarget(td(),profile) | getEffectiveTargets({date:td()}).dailyCalories.effective | LOW |
| Arnold.jsx:9571 | getDynamicMacroTarget() in try/catch | getEffectiveTargets() | MEDIUM |
| Arnold.jsx:9574 | ?? resolveCalorieTarget(td(), profile) fallback | getEffectiveTargets().dailyCalories.effective | LOW |
| NutritionInput.jsx:16 | import getDynamicMacroTarget | replace with goalModel import | MEDIUM |
| NutritionInput.jsx:17 | import resolveCalorieTarget | replace with goalModel import | MEDIUM |
| NutritionInput.jsx:1403 | getDynamicMacroTarget() | getEffectiveTargets() | MEDIUM |
| NutritionInput.jsx:1405 | dyn?.dynamicTarget ?? resolveCalorieTarget() | getEffectiveTargets().dailyCalories.effective | MEDIUM |
| CalendarTab.jsx:31 | import resolveCalorieTarget | replace with goalModel import | MEDIUM |
| CalendarTab.jsx:727 | resolveCalorieTarget(cell.date, goals) | getEffectiveTargets({date:cell.date}).dailyCalories.effective | LOW |
| CalendarTab.jsx:1351 | resolveCalorieTarget(dateStr, goals) | getEffectiveTargets({date:dateStr}).dailyCalories.effective | LOW |
| CalendarTab.jsx:1352 | parseFloat(goals.dailyProteinTarget) fallback | getEffectiveTargets({date:dateStr}).dailyProtein.effective | MEDIUM |
| MobileHome.jsx:25 | import getDynamicCalorieTarget, getDynamicMacroTarget | replace with goalModel import | MEDIUM |
| MobileHome.jsx:1799 | getDynamicMacroTarget() useMemo | getEffectiveTargets() | LOW |
| calorieTarget.js:33 | export resolveCalorieTarget (legacy canonical) | Fold into getEffectiveTargets in A3 | LOW |
| calorieTarget.js:53 | export resolveCalorieTargetVerbose | Fold explain logic into getEffectiveTargets.explain | LOW |
| coachingPrompts.js:24-25 | import getDynamicCalorieTarget, getDynamicMacroTarget | replace with goalModel imports | MEDIUM |
| coachingPrompts.js:106 | getDynamicCalorieTarget(today) | getEffectiveTargets({date:today}) | MEDIUM |
| coachingPrompts.js:194 | getDynamicCalorieTarget(today) | getEffectiveTargets({date:today}) | MEDIUM |
| coachingPrompts.js:231 | getDynamicMacroTarget(today) | getEffectiveTargets({date:today}) | MEDIUM |
| coachingPrompts.js:481 | getDynamicCalorieTarget(today) | getEffectiveTargets({date:today}) | MEDIUM |
| energyBalance.js:506 | export getDynamicCalorieTarget (deprecated source) | After all callers migrated: inline into calorieTarget.js or delete | MEDIUM |
| energyBalance.js:512 | comments reference goals.dailyCalorieTarget | update comments | LOW |
| energyBalance.js:520 | internal logic reads goals.dailyCalorieTarget | OK as-is (Layer 1 internal) | LOW |
| energyBalance.js:530 | parseFloat(goals.dailyCalorieTarget) | OK as-is (Layer 1 fallback) | LOW |
| energyBalance.js:536 | parseFloat(goals.dailyCalorieTarget) \|\| 2000 | OK as-is (Layer 1 fallback) | LOW |
| energyBalance.js:572 | export getDynamicMacroTarget (deprecated source) | After all callers migrated: DELETE | HIGH |
| energyBalance.js:573 | calls getDynamicCalorieTarget internally | OK; remove export in A3 | LOW |
| energyBalance.js:899 | parseFloat(goals.dailyCalorieTarget) | OK as-is (recommendCalorieTarget internal) | LOW |
| tileMetrics.js:25 | import resolveCalorieTarget | replace with goalModel import | MEDIUM |
| tileMetrics.js:1699 | resolveCalorieTarget(today, ctx.profile) | getEffectiveTargets({date:today}).dailyCalories.effective | LOW |

---

## Batch 2 — RMR / TDEE consumers (non-DCY only)

**Total call sites:** 22
**Top affected files:**
1. energyBalance.js (9 internal call sites)
2. intelligence.js (3 call sites)
3. goalModel.js (3 call sites)

Most calls are Layer 1 → Layer 2 reads that already follow the spec.
The audit found no Layer 3 (UI) callers that need to migrate — UI
already reads via `getEffectiveTargets` or `intelligence.cards`.

Migration scope for this batch is **comment updates + verification only**
during Phase A. No deletions until Phase C decides DCY's fate.

(See full table in agent's report — included verbatim in repo at git
history; truncated here for readability since Phase A3 has no work in
this batch.)

---

## Batch 3 — Recovery debt classifiers ⚠ HIGHEST PRIORITY

**Status:** ✅ Chronic-debt classifier (goalModel ↔ intelligence) consolidated
as of Phase 4r.dataspine.1 — 2026-05-23. PredictedBandsCard's
`classifyFatigueSeverity` is a DIFFERENT concept (single-day workout
fatigue, not chronic 3-night debt) and stays separate per design
clarification during the migration.

**Total call sites:** 15
**Top affected files:**
1. intelligence.js (inline logic + 8 consumer references) — ✅ migrated
2. goalModel.js (inline definition + usage) — ✅ migrated
3. predictedBands.js (inline logic) — INTENTIONALLY UNCHANGED (different concept)

| File:Line | Pattern | Migrate to | Risk | Status |
|---|---|---|---|---|
| goalModel.js:375 | `function computeRecoveryLoad` inline def | EXTRACTED to `src/core/recoveryDebt.js` → `classifyChronicRecoveryDebt` | HIGH | ✅ Phase 4r.dataspine.1 |
| intelligence.js:161 | inline 0/1/2/3 classifier (MISSING HRV signal vs goalModel) | Now calls `classifyChronicRecoveryDebt` — gains the HRV signal | HIGH | ✅ Phase 4r.dataspine.1 |
| predictedBands.js:119 | `classifyFatigueSeverity` (single-day workout fatigue) | Different concept; stays separate. Phase C may rename for clarity. | MEDIUM | NO-OP (design clarification) |
| goalModel.js:168 | `computeRecoveryLoad({ sleep, hrv })` call | Now calls `classifyChronicRecoveryDebt` | LOW | ✅ Phase 4r.dataspine.1 |
| dcy.js:717 | export `recoveryCoef(refDate)` | KEEP for Phase A (DCY uses it). Phase C decides | LOW | DEFERRED |
| dcy.js:754 | export `recoveryBreakdown(refDate)` | KEEP for Phase A. Phase C decides | LOW | DEFERRED |
| intelligence.js:279 | `burdens.push('recovery-debt')` (reads value) | OK as-is — consuming result | LOW | NO-OP |
| (10+ other call sites) | reading `u.recoveryDebt` for card display | OK as-is — consuming result | LOW | NO-OP |

**Behavior change shipped with the migration:** intelligence.js
previously omitted the HRV-depression signal that goalModel.js
included. Both now use the canonical classifier, which means the
`recovery-debt` burden in userState NOW FIRES on HRV depression even
if sleep duration alone wouldn't have triggered it. This directly
addresses the silent divergence that hid the sleep insight in the
2026-05-22 weight-loss conversation.

---

## Batch 4 — Weight + body comp consumers

**Total call sites:** 24
**Top affected files:**
1. energyBalance.js (6 internal call sites)
2. intelligence.js (4 call sites)
3. coachingPrompts.js (3 call sites)

All call sites already use the canonical `getCurrentBodyComp` and
`weightTrend` from `energyBalance.js`. The audit found **no
duplicate implementations** for these.

Migration scope for Phase A3: **none**. The `parseFloat(goals.targetWeight)`
fallback chain shows up ~20 times but those are reading Layer 0
storage as part of legitimate fallback logic, not duplicating
calculations. Phase B will move profile/goal target fields to the
override system; until then, fallbacks stay.

---

## Batch 5 — Coaching prompts + insights consumers

**Total call sites:** 12
**Top affected files:**
1. Arnold.jsx (4 display calls)
2. MobileHome.jsx (3 display calls)
3. intelligence.js (1 read for evidence chips)

Layer boundaries are clean. UI reads `getTopCoachingPrompts` /
`getPromptsByPillar` from coaching prompts module, and `generateInsights`
through intelligence.js. The intelligence.js synthesizer is the only
consumer that combines both streams.

Migration scope for Phase A3: **none**. The Phase C2 decision (fold
coaching prompts into burden catalog) will eliminate `coachingPrompts.js`
as a separate stream, but that's not Phase A work.

---

## Cross-batch observations

**1. Arnold.jsx is the biggest offender.** 14 distinct deprecated
function calls. Replacing 2 imports + 10 call sites collapses the
mess to one canonical `getEffectiveTargets` call site pattern.

**2. The `dyn?.dynamicTarget ?? resolveCalorieTarget()` pattern is
rampant.** Appears in Arnold.jsx (5810, 9574), NutritionInput.jsx
(1405). Once `getEffectiveTargets` replaces both, the fallback chain
collapses to a single `.dailyCalories.effective` read.

**3. Recovery debt is the costliest duplicate.** Three separate
algorithms in three files. **HIGH RISK** bug class — if we change a
sleep threshold, two of three classifiers go stale silently. **This
is what hid the sleep insight from my weight-loss answer.**

**4. DCY is correctly isolated.** Phase A leaves dcy.js internals
alone. Phase C will reconcile.

**5. Layer boundaries are clean for new code.** intelligence.js +
goalModel.js properly read Layer 1 from energyBalance.js. The mess
is concentrated in the legacy Arnold.jsx + Mobile/NutritionInput +
calorieTarget.js trio that pre-dates the layering.

---

## Phase A3 migration order

### Stage 1 — Extract shared recovery debt classifier ⚠ FIRST

1. Create `src/core/recoveryDebt.js` (or add to `dcy.js`):
   `export function classifyRecoveryDebt({ sleep, hrv }) → 0|1|2|3`
2. Move the 13-line scoring algorithm from `goalModel.js:375` into it.
3. Reconcile the thresholds with `intelligence.js:161` and
   `predictedBands.js:131-180` — pick ONE canonical set (the more
   conservative of the three; document the choice in a code comment).
4. Replace the three inline implementations with calls to the
   extracted function.
5. Smoke test: SMOKE_TESTS.md `Calendar mobile` + `EdgeIQ web` sections
   (recovery debt drives PredictedBandsCard battery icon, intelligence
   burdens list, goalModel calorie-target recovery modifier).

**Risk:** MEDIUM — three threshold sets to unify.
**Payoff:** kills the HIGH-risk bug class in batch 3.

### Stage 2 — Consolidate calorie targets

1. For each batch-1 call site, replace per the table.
   Order: leaf consumers first (CalendarTab → MobileHome → NutritionInput
   → Arnold.jsx → coachingPrompts.js → tileMetrics.js).
2. After all callers migrated: delete (or alias) `resolveCalorieTarget`,
   `resolveCalorieTargetVerbose`, `getDynamicCalorieTarget`,
   `getDynamicMacroTarget`. Comment on each export explaining the
   migration so future-me doesn't re-add them.
3. Smoke test after each file: SMOKE_TESTS.md surface-specific section.

**Risk:** LOW per call site, but 28 sites means careful per-file
testing. Each file is its own commit + smoke check.
**Payoff:** the Calendar drawer / Nutrition / EdgeIQ inconsistency
you reported becomes structurally impossible — one calculator.

### Stage 3 — Verify boundaries

1. Grep one more time: are there any direct Layer 0 reads in UI files?
   (e.g. `storage.get('weight')` in a component rendering numbers)
2. Confirm Layer 3 cards (EdgeIQ grid, Calendar drawer cells) don't
   bypass `getEffectiveTargets` for any displayed number.

**Risk:** LOW. Mostly already correct.

### Stage 4 — Deferred to Phase B / Phase C

- Profile field migration (`goals.dailyCalorieTarget` → override system)
- DCY consolidation
- Coaching prompts → burden catalog merge
- New Layer 1 helpers (`weightTrendSlope`, `sleepAvg`, `sleepDebt`,
  `hrvDelta`, etc.)

**Estimated effort:** Stage 1 ~4-6h, Stage 2 ~6-8h, Stage 3 ~2-3h.
**Total Phase A3: 12-17 hours.**

---

## How to use this doc during Phase A3

For each row in batches 1 & 3:
1. Open the file at the indicated line.
2. Apply the migration in the table.
3. Run the smoke-tests section relevant to the surface.
4. Mark the row ✅ in this doc with the build stamp (e.g. `✅ Phase 4r.dataspine.1`).
5. Move to the next row.

When a batch is fully ✅'d, append a note at the top of the batch:
> Batch N complete as of Phase 4r.dataspine.X — Y call sites migrated.

When AUDIT.md has no unchecked rows in batches 1 & 3, Phase A3 is done.
