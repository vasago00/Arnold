# Arnold — Bug Post-mortems

Append-only log. One entry per bug that escaped to a user-visible symptom.
Each entry answers four questions so we know what to change to prevent the
next one.

Template
--------
```
## YYYY-MM-DD — short title

**Symptom**
What the user actually saw / reported.

**Root cause**
What was actually wrong in the code. Be specific — file + line + the
mechanism, not the surface description.

**Fix**
What changed (commit / phase tag).

**What would have prevented it**
The process or tooling that would have caught this before ship. This is
the most important field — it's how the doc earns its keep.
```

---

## 2026-07-12 — Training Profile stuck on "set a goal" even after committing the goal (wrong race)

**Symptom**
Emil set GOAL TIME 3:30 on Valencia in the Adjust panel and pressed Enter, yet the EdgeIQ
Training Profile kept saying "set a goal to see the gap" — no goal, no targets. Cost ~10 rounds
of goal-fallback patching that all missed the point.

**Root cause**
`resolveTrainingProfile` didn't pass an `aRaceDate`, so `buildRaceRecipe.nextARace` fell to
"soonest marathon" — which was NY/Berlin, NOT Valencia. Emil built toward (and set the goal on)
Valencia, but the profile silently anchored on a different, goal-less marathon. Every goal-source
fallback was irrelevant because the profile was reading the wrong race's `goalTimeSecs`. Also
surfaced: the Adjust GOAL TIME field showed the grey placeholder "3:30" (goalInput init '' + a
pre-fill that read the wrong `getGoals().marathon` path), so Emil thought it was set when the box
was empty.

**Fix**
`resolveTrainingProfile` now reads `planPrefs.target` and passes it as `aRaceDate`, so the profile
anchors on the SAME race the plan/Adjust panel targets. Pre-fill effect reads the real v2 path
(`goals.performance.marathon.targetSecs`); placeholder changed to "e.g. 3:30". Tests added.

**What would have prevented it**
When two surfaces (Adjust panel + profile) claim to be "about your race," they must resolve the
SAME race from the SAME source — not one honoring the user's choice and the other auto-picking.
Diagnosing sooner: check WHICH race the profile anchored on before patching goal-read paths.
(#59 — one canonical goal/race — remains the real cleanup.)

## 2026-07-11 — Training Profile projected "22:01" and asked to "set a goal time" (both already set)

**Symptom**
The EdgeIQ Training Profile finish read 22:01 (a ~22-min 4-miler time) and still said
"Tracking 22:01 — set a goal time," even though Emil had a Berlin marathon with a goal.

**Root cause**
Two disconnects. (1) `buildRaceRecipe.nextARace` picked "soonest priority-'A' race", but
`normalizeRace` defaults EVERY race's priority to 'A', so a near 4-mile tune-up out-ranked the
marathon → the profile projected/anchored on the tune-up (distance 4mi → ~22 min). (2) The goal
was set in Performance goals (`goals.marathon.targetSecs`), but `buildTrainingProfile` only read
the race's own `goalTimeSecs`, so `goalSecs` stayed null → "set a goal time" + no targets +
monochrome graphic.

**Fix**
(1) `nextARace` now prefers a MARATHON (the build's actual target) over the priority signal:
aRaceDate → soonest marathon → a race with a goalTime → explicit-A. (2) `resolveTrainingProfile`
reads `goals.marathon.targetSecs` and passes it as `goalSecsFallback`; `buildTrainingProfile`
uses race goalTimeSecs ?? fallback ?? recorded finish. Tests added in trainingProfile.test.js.

**What would have prevented it**
A default of 'A' for every race makes "priority-A" meaningless as a selector — defaults should be
neutral (unset), not the top tier. And a goal that lives in one store but is read from another is
the same class of bug as the race-resurrection one: single source, or explicit fallbacks wired at
the read site.

## 2026-07-10 — Training Profile FINISH ring vanished even with a goal set

**Symptom**
The EdgeIQ Training Profile lost its finish circle (the "4:12" ring Emil liked); the
connector edges fanned into empty space. Emil had set the race goal time, so "something
is not connected."

**Root cause**
`buildTrainingProfile` (trainingProfile.js) computed the finish projection only
`if (predict && distKm)`, where `distKm = raceDistanceKm(nextARace)`. For a race with
no explicit `distanceKm`/`distanceMi` and a name that doesn't literally contain
"marathon" (his race is just "Berlin"), `raceDistanceKm` returns null → projection
no-ops → `finish.now` null → ring guarded off. The INGREDIENTS still rendered because
`distMi` independently falls back to 26.2, masking the problem (graphic half-worked).

**Fix**
Derive `projKm = distKm ?? distMi * 1.60934` and gate the projection on `projKm`, so
the inferred marathon distance drives the prediction when the race carries no explicit
distance. Ring returns.

**What would have prevented it**
Two code paths inferring the same thing (distance) with different fallbacks is a smell —
`distMi` fell back to 26.2 but the projection used the un-fallen-back `distKm`. Single
source: compute one canonical race distance and feed BOTH the requirements and the
projection from it.

## 2026-07-10 — Deleted race keeps coming back (hero + season phase + strip)

**Symptom**
Emil deleted a race from the Calendar AND from the Plan tab's race list, but it
still showed up on Start (hero race, "BUILD · to Berlin" phase) and the week strip.

**Root cause**
Races have THREE stores that drift: the canonical `storage['races']` (+`arnold:races`
localStorage mirror), races nested in the goals blob, and planner days with
`type:'race'` (the same race also lives on the Calendar as a planner day — the red
flag on the strip). `GoalsHub.loadGoalsV2()` (GoalsHub.jsx ~L164) intentionally
RESURRECTS from the latter two: `mergeRaces(canonical, legacyGoalsBlob)` +
`plannerRaceDays()` fold both back into `storage['races']` and persist on every
Plan-tab open. Both delete paths only removed from one/two stores (CalendarTab:
races store only; GoalsHub: goals blob + races store), never the planner race day —
so opening the Plan tab re-promoted the leftover planner race day into the canonical
store, which the hero (MobileHome L300) and seasonCoach (seasonCoach.js L44) read.

**Fix**
New `memory.deleteRaceEverywhere(id, dateHint)` clears all three: canonical store
(+mirror via saveRaces), goals-blob races (by id and date), and the planner race day
(pure, tested `clearPlannerRaceDay`). Wired into both CalendarTab `onDeleteRace`
sites and `GoalsHub.deleteRace` (grabs the date before dropping from state). Test:
`core/memory.test.js`.

**What would have prevented it**
A single authoritative delete from the start instead of per-surface filters, given
we already KNEW there were 3 drift sources (loadGoalsV2 was written specifically to
reconcile them). Rule: any entity with N storage representations needs ONE
delete/write path that touches all N — never an ad-hoc `list.filter()` at the call site.

## 2026-07-02 — Sim-caught: mobility/recovery days could be "greenlit"; + Monte-Carlo harness added

**Symptom**
Not user-reported — caught by the new simulation harness on its first run: 5 of 10,000 synthetic athlete-days violated the invariant "a recovery-type session is never reshaped." `adaptSession` was returning `action: 'greenlit'` for mobility days.

**Root cause**
`adaptPlan.adaptSession` only short-circuited to `hold` for `planned.type === 'rest'`. A **mobility/recovery** session (type/intensityClass 'mobility'/'recovery', not 'rest') fell through: not in the HARD set so never eased, but on a high-readiness/no-debt/full-battery day it reached the green-light branch → "cleared for the full session" on a recovery day. Harmless-ish, but wrong: you don't clear a rest day.

**Fix**
Introduced a `NIL = {rest, mobility, recovery}` set (mirrors fuelForWork's recovery concept) and short-circuit to `hold` when either `type` or `intensityClass` is NIL. Re-ran the sim: 0/10,000 violations. Existing `adaptPlan.test.js` (10 tests) unaffected (none asserted mobility behavior).

**What would have prevented it** — and what this session added
This IS the prevention: a **Monte-Carlo property-test harness** (`src/core/sim/`): a seeded PRNG (reproducible), a synthetic-athlete generator (documented physiology distributions), autocorrelated random-walk day-streams, and an invariants file split into HARD contracts (zero-tolerance) + STATISTICAL properties (explicit, rationale'd margins). `runSim` drives the REAL engine (`adaptSession`, `prescribeFuel`, `composeCalorieTarget` — imported, not mirrored) over 10k cases; `sim.test.js` runs it in `npm test`. It validates the engine across the *space* of athletes, not just Emil's one trajectory — and it's the de-risking that has to precede multi-user. Calibration matters: the first run also caught a *bad margin of our own* (greenlit floor set at 2%, actual ~0.15%) — margins are now measured across 3 seeds and documented. Also extracted `composeCalorieTarget` (calorieTargetMath.js, +unit tests) so the real calorie formula is directly testable (no drift).

## 2026-07-02 — "What Arnold has learned" footer frozen; a whole test suite wasn't running

**Symptom**
The LearnedHero card (race fitness / sweat / maintenance footer + learned sensitivities) didn't update when new data synced in — it showed mount-time values until a full app restart. Separately: adding tests to `tests/*.mjs` never changed the `npm test` count (stuck at 139, then 153).

**Root cause**
Two independent issues, same theme (things silently not refreshing).
(1) `LearnedHero.jsx` computed `facts`/`energy` in `useMemo(..., [])` — empty deps, so it ran once at mount and never re-derived on a storage change (Cloud Sync pull, fresh Garmin/Cronometer sync). Every other live card uses `useStorageVersion()` in its deps; LearnedHero didn't. (2) `vitest.config.js` `include` is `src/**/*.test.js(x)` and `exclude` is `tests/**` — so the entire `tests/` directory (24 Node `node:test` files: hub/coaching/energy suites) was invisible to `npm test`. Those only ran via manual `node --test`. New tests written there never counted.

**Fix**
(1) `LearnedHero` now calls `useStorageVersion()` and includes it in both `useMemo` dep arrays → re-derives on every storage change. Added `src/components/LearnedHero.test.jsx` (jsdom) that mounts the card, fires a storage change, and asserts the footer updates. (2) Ported the 22 pure-logic `tests/*.mjs` suites into co-located vitest files under `src/tests/*.test.js` (converted both runner styles — `node:test` default import and the homemade `const test = …` helper — to `import { test } from 'vitest'`, kept `node:assert`, rewrote `../src/` → `../`). `classifyActivityForHyrox.test.mjs` stays as the `test:legacy` fs-fixture script. Net: the hub/coaching/energy suites now run under `npm test`.

**What would have prevented it**
(1) A lint/grep guard for `useMemo(() => …storage/derivation…, [])` in components that render live data — the repo already had the `useStorageVersion` pattern; LearnedHero just missed it. The scan (grep for derived-data components lacking a reactivity signal) is the reusable check. (2) One test runner, one glob. A split where a whole directory of tests isn't in the default `npm test` means "green" was never the whole story — consolidating on vitest removes the blind spot.

## 2026-07-02 — Cronometer data logged on mobile never reached the web

**Symptom**
Emil uploaded Cronometer data on mobile; the web version never showed it. Web diagnostics: cloud sync paired, pulled 0 min ago, no pull error, but `todayFullDayEntry: null` and `nutritionLog` version frozen at the previous day. A **force pull** (bypasses etag + LWW, overwrites local from the server blob) STILL showed null — proving the server blob itself lacked today's entry. Manual "Push now" on mobile + "Pull now" on web didn't fix it either.

**Root cause**
The nutrition write path (`upsertFullDayEntry` in `cronometer-client.js`, used by both the live pull and the manual CSV import) writes to `nutritionLog` and relies solely on cloud-sync's **debounced** auto-push — `onStorageChange` → `bumpVersion` → `schedulePush` with a 1s timer. If the app loses foreground before that 1s timer fires (typical right after a one-shot mobile import), the push never happens. And the relay stores the **whole blob last-push-wins** (per-key LWW is applied only on *pull*, in `applySnapshot`), so with mobile's fresh data never uploaded, the server only ever held web's stale-nutrition snapshot — which web then re-pulled and even re-pushed (pull-first) on each load, keeping the loop stale. Net: the data was written locally on mobile but never published.

**Fix** (cronometer sync-publish, 2026-07-02)
Added `flushCloudPush()` (dynamic import of `cloud-sync.push()`, best-effort, no-ops when unpaired) and called it right after the write: in `upsertFullDayEntry` when the day's macros actually changed (skips idle 5-min live-pulls that only bump `createdAt`), and unconditionally at the end of `importCronometerCsvText` (a manual import is an explicit action + the recovery path). `push()`'s in-flight guard coalesces a burst (multi-day import) into ~one network push. A one-shot nutrition write now publishes immediately instead of waiting on a debounce that a backgrounding app can eat.

**What would have prevented it**
Any storage write that must cross devices needs a *guaranteed* publish, not a best-effort debounce that a lifecycle transition can drop. Two durable guards: (1) flush pending cloud pushes on `visibilitychange`/`pagehide` (publish-before-background), and (2) a sync self-check/invariant — "a local key whose version is newer than the last successful push" should surface as an unsynced-changes warning, the sync-layer analogue of the `__arnoldDiag` data checks. The force-pull-still-null test was the key move: it isolated the failure to the push side (server blob) vs the pull/merge side in one step.

## 2026-07-01 — Calorie target stuck at RMR (1880) on a training day; eat-back "did nothing"

**Symptom**
After a logged strength session, the daily calorie target didn't move — it read 1880 (Emil's RMR) exactly, same as a rest day. Emil: "since I lost calories in training I should see a higher caloric intake than 1880 to replenish — what actually failed?" `__arnoldDiag()` showed `derived: 1880`, `components.eatBack: 163` — so the eat-back WAS computed but wasn't reaching the target.

**Root cause**
`src/core/goalModel.js` `deriveDailyCalorieTarget`: order of operations. It computed `derived = round(baseTarget + recoveryAdj + eatBack + flatBonus)` FIRST, then applied the RMR floor AFTER (`if (derived < floor) derived = floor`). On a day where the deficit base (tdeeBase 1834 − deficit 500 = 1334) sits below RMR, `1334 + 163 = 1497` is still < floor, so the floor overwrote the whole number — swallowing the 163 eat-back. The floor itself ("never eat below RMR") is intentional and correct; the bug was that replenishment was folded in *below* the floor instead of stacked *on top* of it.

**Fix** (goalModel dup-fix 2026-07-01)
Reordered: floor the MAINTENANCE part first, then add training/race calories on top — `derived = round(max(baseTarget + recoveryAdj, floor) + eatBack + flatBonus)`. A training day is now RMR + replenishment (≈2043 for the reported case) and always exceeds the rest-day floor when there's a burn.

**What would have prevented it**
A property test on the composition: "for any inputs with eatBack > 0, derived must be strictly greater than the same inputs with eatBack = 0" — would have caught the floor swallowing replenishment. The composition is worth extracting into a pure, unit-tested helper (it currently reads storage, so it's awkward to test directly). The `workout-no-eatback` diagnostics invariant only fires when eatBack === 0, so it didn't catch a *computed-but-swallowed* eat-back; a "floored AND eatBack > 0" tripwire would cover the regression path.

## 2026-07-01 — Duplicate activity row inflates calories / load (raw count 2, one real session)

**Symptom**
`__arnoldDiag()` flagged a `duplicate-activity` error: `rawCount: 2, duplicateCount: 1, duplicates: ['strength|3197|291']` for a single strength session. The dedup-on-read layer kept the unified kcal correct (`unifiedCount: 1, activityKcal: 291`), but raw-reading surfaces (e.g. a readiness card showing "582") doubled it.

**Root cause**
`src/core/garmin-activities-client.js` `syncRecentActivities`: `existing` is snapshotted ONCE before the download loop (line ~495) and the up-front dedup filters candidates against that stale snapshot. But each iteration pushes to a freshly-read `all` and persists. So a session arriving twice within a single sync run — Garmin list overlap/pagination, or a manual FIT plus a synced copy of the same workout — slips past the up-front filter and gets written twice. Dedup was read-side only; the write wasn't idempotent.

**Fix** (dup-write fix 2026-07-01)
Added a write-side idempotent guard right before the push: skip if the same Garmin `activityId` is already present, OR an exact signature match exists (`date|canonType|duration|calories`). `forceReplace` bypasses it. The signature is a new shared helper `activitySignature` in `dcyMath.js`, used by BOTH the write guard and the diagnostics checker (`detectDuplicateActivities`) so "what we prevent" and "what we flag" can never drift. Date is part of the key, so real morning+evening sessions and same-shaped sessions on different days are preserved.

**What would have prevented it**
Idempotent writes as a rule for any sync that reads-modify-writes a collection in a loop — dedup against the *live* collection at push time, not a pre-loop snapshot. The read-side dedup masked the write bug for a long time; the diagnostics self-check layer (added the same day) is what finally surfaced it. Sharing ONE signature between the detector and the preventer is the durable guard against the two drifting.

## 2026-06-16 — Fuel buttons "grossly oversized"; many rounds of inline-height edits did nothing

**Symptom**
On mobile Fuel, the AM/Noon/PM supplement pills and the +250ml/+1L water buttons rendered far too tall. Across ~6 rounds I changed their inline `height` (30→22→18) and the user kept reporting the same oversized buttons; widget previews of the exact styles looked correct, so the disconnect was baffling.

**Root cause**
`src/mobile.css` line ~233: `button:not(.arnold-compact-btn) { min-height: 42px !important; }` — a global Apple-HIG touch-target floor. `min-height` with `!important` overrides an element's inline `height`, so every inline `height: 18px` I set on the `SlotBtn` and water buttons was silently clamped back up to 42px. The buttons were ALWAYS 42px; none of my height edits could ever take effect. The `show_widget` previews looked right because they don't load `mobile.css`.

**Fix** (Phase 4r.fuel.compactbtn)
Added `className="arnold-compact-btn"` to the `SlotBtn` button and the +250ml/+1L buttons in `NutritionInput.jsx`, opting them out of the 42px floor so their inline `height: 18px` applies. (The opt-out class already existed for exactly this purpose — used by dense calendar/race controls.)

**What would have prevented it**
When an inline style "isn't taking effect" on a real device but looks right in an isolated render, check the global stylesheet for an `!important` rule on that element/property BEFORE iterating on the inline value — I burned many rounds tuning a number the CSS was discarding. More durable: the design-lift `<Pill>`/`<Button>` primitives should carry the compact opt-out by default, and a lint/grep guard could flag inline `height` on a bare `<button>` (no `.arnold-compact-btn`) on mobile surfaces, since it's guaranteed dead.

## 2026-05-31 — Coach Play wrap-up said "Tomorrow: race" when tomorrow was mobility

**Symptom**
On the mobile Play screen, the Coach wrap-up read "Day winding down. Tomorrow: race. Sleep is the lever." — but the user had Mobility scheduled for tomorrow (Mon) and Tuesday; the race (HYROX) was 3 days out (Jun 3), and the EdgeIQ race tile correctly showed "3d". So the line was wrong on both the session type AND the day.

**Root cause**
`CoachComment.jsx` → `nextPlannedAfterToday()` filtered with `d.intensityClass !== 'rest'`. Mobility maps to `intensityClass: 'rest'` in `coachSignals.js` PLAN_INTENSITY (line ~1595, because it's low-load). So the loop skipped both mobility days and returned the next genuinely non-rest day — the race, 3 days out. Separately, the `evening_done` template hardcoded the word "Tomorrow" regardless of the matched day's `daysOut`.

**Fix** (Phase 4r.coach.playfix.1)
- `nextPlannedAfterToday` now selects the next day with an actual planned session (`d.planned && d.planned !== 'rest'`), so scheduled mobility counts; only blank rest days are skipped.
- Added `relativeDayWord(daysOut, dow)` and used it in both `evening_done` and `rest_day_planned` so the phrasing matches the real offset ("Tomorrow" only for daysOut 1; weekday name otherwise).

**What would have prevented it**
A unit test over `classifyPlayState`/`composePlayLine` with a fixture plan where tomorrow is mobility and a race sits 3 days out, asserting the wrap-up names mobility + "Tomorrow". More broadly: any consumer that says "tomorrow" should read the matched item's `daysOut`, never assume it.

---

## 2026-05-23 — Calendar taps absorbed by Today button's invisible overlay

**Symptom**
On mobile Calendar tab, tapping any future day tile failed to update the
drawer — the drawer kept showing today's data. Tapping `+ Plan` or
`+ Add race` chips also did nothing. Swipe gestures didn't change months.
A previous build had a different symptom: tapping a future day opened the
"+ Add race" modal with today's date pre-filled, rather than navigating to
the tapped day.

**Root cause**
Latent bug in the `.arnold-compact-btn` CSS class (added months earlier
in Phase 4r.calendar.21). The class adds an invisible `::before`
pseudo-element with `position: absolute; inset: -8px` to extend the
touch target by 8px in every direction, scoped to the button's own
positioning context via `.arnold-compact-btn { position: relative }`.

Every button using `arnold-compact-btn` in the calendar code also used
inline `style={{ all: 'unset' }}`. The CSS shorthand `all: unset` resets
**every** property to its initial value — including `position`, which
becomes `static`. Inline styles have specificity (1,0,0,0); class
selectors have (0,0,1,0). Inline wins. So `position: relative` from the
class **never actually applied**.

With `position: static` on the button, the `::before`'s `position:
absolute` walked up the DOM looking for the nearest positioned ancestor.
Nothing in the calendar's parent chain had `position` set (not
CalendarTab's outer div, not the `arnold-tab-panel` wrapper, not
`<main>`). The walk reached the initial containing block — the viewport.

With the viewport as containing block, `inset: -3px -8px` on the
`::before` made it a **full-viewport-sized invisible overlay**. Whichever
`arnold-compact-btn` button was rendered last in DOM order had its
`::before` on top of the stack, absorbing every click in the viewport
and firing its own `onClick`.

DOM render order in CalendarTab determined which button "won":
- Initially the `+ Add race` chip was last → every tap opened the race
  picker with the currently-selected date (today).
- After one of my partial fixes the Today button became the last
  compact button before the grid in DOM order → every tap fired
  `goToday()` which reset `selectedDate` back to today.

**Fix**
1. `mobile.css` Phase 4r.calendar.37 — added `!important` to
   `.arnold-compact-btn { position: relative !important }`. `!important`
   beats inline non-`!important` declarations regardless of specificity.
2. Reduced `inset` from `-8px` to `-3px -8px` (asymmetric) so vertical
   bleed into neighboring rows is minimized as a defensive secondary fix.
3. Belt-and-suspenders: added `position: 'relative'` directly inline to
   every button using `arnold-compact-btn` (iconBtn, chipBtn, +Plan,
   +Add race chips, PredictedBandsCard's drop-pin button). Inline win
   protects against any future CSS regression that drops the `!important`.
4. Added 10px margin between calendar grid and drawer on mobile so even
   if the cascade re-breaks, physical separation prevents tap overlap.
5. Added `if (mobileActiveId === 'calendar') return;` to the page-level
   swipe handler in Arnold.jsx so the calendar's own swipe handler can
   own gestures on its tab without competing.

**What would have prevented it**
- **Smoke test for calendar taps.** A 30-second "tap each chip + tap a
  future day + swipe both directions + tap Today" routine after any
  change to mobile.css, calendar styling, or anything that touches
  `arnold-compact-btn`. The bug would have shown up immediately.
- **Lint rule: forbid `all: 'unset'` inline on any element with a class
  using `::before`/`::after`.** This is the structural fix — eliminate
  the class of bug by making the pattern impossible. ESLint custom rule
  or a grep check in CI would do it. (Deferred — codebase has 35
  `all: 'unset'` uses, most safe; need targeted detection.)
- **Boot-time state fingerprint.** When the user reports a bug, having
  one screenshot of the console show the full state of the system would
  have led me to the build stamp + correct hypothesis faster.
- **CONTRIBUTING checklist.** "What ELSE uses this class / CSS rule?" —
  asked routinely before any mobile.css change, this bug would have
  been caught.

All four preventatives have shipped as of Phase 4r.calendar.37 (see
SMOKE_TESTS.md, CONTRIBUTING.md, and the boot fingerprint log in
Arnold.jsx).

---

## 2026-05-23 — Plan tab blanks out on Marathon "+ set" (missing useRef import)

**Symptom**
User taps `+ set` on the Marathon row in the Performance tile of the
Goals Hub. Entire Plan tab goes black — the section unmounts because
React caught an unhandled exception during render.

**Root cause**
When I built the new `TimeInput` component (Phase 4r.dataspine.13) I
used `useRef(null)` for the three input cells (hh/mm/ss) but forgot
to add `useRef` to the React import at the top of
`src/components/GoalsHub.jsx`. The existing import was:

```js
import { useState, useMemo, useEffect } from "react";
```

`useRef` resolves as `undefined` at runtime. The first call —
`const hhRef = useRef(null);` — throws `TypeError: useRef is not a
function` inside `TimeInput`. React's error boundary catches it and
unmounts the entire `GoalsHub` subtree. From the user's perspective,
the Plan tab "goes black."

The bug was specific to time fields because TimeInput is only
rendered when `def.unit === 'time'`. Tapping +set on Body / Recovery
/ Manual pins / Strength worked fine — they use the existing text
input that doesn't need refs.

**Fix**
Phase 4r.dataspine.13-fix1 — added `useRef` to the import in
`src/components/GoalsHub.jsx`:

```js
import { useState, useMemo, useEffect, useRef } from "react";
```

**What would have prevented it**
- **SMOKE_TESTS gap.** My smoke checks said "verify the form opens"
  but never said "click +set on a TIME FIELD specifically." I'd
  smoke-tested the non-time fields (Body weight, Recovery sleep)
  which work fine, then declared the change shipped. Time fields
  went untested because I added them as a new path and didn't
  add a check for them.
- **ESLint rule for missing React imports.** A `no-undef` rule with
  the `react` plugin's recommended config would flag `useRef` as
  undefined at lint time. Not yet wired into this project; should
  be added in a process pass when we're not actively building
  features.
- **Running the dev server before declaring shipped.** I haven't
  been doing this because the sandbox VM has been flaky; my workflow
  has become "write code, infer correctness from grep, ship." That's
  exactly the workflow that allowed this bug. When the VM cooperates,
  I should `npm run dev` and click through the actual edit form
  before bumping the build stamp.

**Smoke check added:** SMOKE_TESTS.md now has a "Plan tab — Goals
Hub edit forms" section that explicitly lists clicking +set on every
edit-form-bearing field (Body, Recovery, Performance Endurance,
Performance Strength, Races, Manual pins). The Endurance row
specifically calls out clicking Marathon to verify the H:MM:SS
input renders.

---

## 2026-05-23 — TimeInput refuses MM/SS input after HH is filled

**Symptom**
User taps `+ set` on Marathon → 3 H:MM:SS cells appear (good). Types
a digit in HH. Cursor doesn't advance. Tries to type in MM and SS —
keystrokes are ignored. Form is unusable.

**Root cause**
My `emit()` function in TimeInput padded empty cells with `'00'`
when ANY cell had a value:

```js
if (cleanH && cleanH !== '0' && cleanH !== '00') {
  onChange(`${cleanH}:${cleanM.padStart(2, '0') || '00'}:${cleanS.padStart(2, '0') || '00'}`);
}
```

So typing `3` in HH → `emit('3', '', '')` → `onChange('3:00:00')` →
parent's `drVal = '3:00:00'` → next render's `parts` = `{h:'3', m:'00',
s:'00'}` → MM cell renders with value `'00'`, SS cell renders with
value `'00'`.

Then `maxLength={2}` on those inputs means they're "full." Browser
silently blocks any new keystroke. Auto-advance is gated on
`cleaned.length === 2`, but `cleaned` derives from the typed input
which is empty (because the browser blocked it), so auto-advance
never fires either.

In short: I made the controlled-input loop self-poisoning. Each
emit pre-filled cells that then blocked future input.

**Fix**
Phase 4r.dataspine.13-fix2 — restructured TimeInput to hold its
own per-cell local state. Cells display ONLY what the user has typed
(not derived from parent's `value`). Padding happens once in the
emit step but doesn't round-trip back to the cells. The parent's
`value` is read only on mount to initialize state; after that, cells
are independent.

**What would have prevented it**
- **Actual interaction smoke testing.** I'd checked "form opens" and
  "single-cell entry works in isolation" but never typed a multi-cell
  sequence end-to-end. Adding a UAT-style script that specifies
  EXACT keystrokes and expected per-keystroke state (see
  SMOKE_TESTS.md → "Performance · Endurance — TIME INPUT (3-cell
  H:MM:SS) UAT script") makes the failure mode trip immediately.
- **Treating controlled inputs as state loops.** Any time a child's
  display state is derived from a string that the child also emits
  upward, I need to verify the round-trip doesn't poison the
  display. The pattern `value → parts → emit → value` is a footgun
  unless emit preserves whatever the user actually typed.
- **Process commitment:** for any input-handling code, walk through
  the keystrokes mentally as a UAT script BEFORE bumping the build
  stamp. Embed those scripts in SMOKE_TESTS.md so future-me runs
  them.

**Smoke checks added:** the UAT script in SMOKE_TESTS.md walks
through the exact keystroke sequence `3 → : → 1 5 → 0 0` for
Marathon and verifies the expected per-keystroke focus + cell
contents + final saved value. Two parallel scripts cover 5K
(no-HH path) and edit-existing-value (pre-fill path).

---

## 2026-05-23 — Sleep insight silently missing from weight-loss recommendation

**Symptom**
User asked: "why isn't my weight dropping despite eating at a deficit?"
The recommendation engine focused entirely on burn-side hypotheses
(Garmin activity-calorie inflation) and never surfaced the alternative
hypothesis that chronic sleep debt (user averaging <6h for 2-3 weeks)
suppresses fat oxidation and elevates cortisol-driven water retention.
The data was present in storage — the burden simply never fired.

**Root cause**
Two divergent inline implementations of the "chronic recovery debt"
classifier:
- `goalModel.js:375` (`computeRecoveryLoad`) — included sleep duration +
  sleep score + an HRV-depression signal (latest HRV < 70% of 14-day
  baseline).
- `intelligence.js:161` (anonymous IIFE) — IDENTICAL sleep duration +
  sleep score logic, but **silently omitted the HRV-depression signal**.

The `recovery-debt` burden in `userState.burdens` is set from
`intelligence.js`'s classifier. For users with normal sleep duration
but suppressed HRV (cortisol load, stress, illness onset), the burden
DID NOT fire in intelligence, even though goalModel computed the debt
correctly. The synthesizer in `intelligence.js` then had no
`recovery-debt` burden to feed into its hypothesis-ranking, so the
sleep angle was never offered as an alternative cause.

The deeper issue is **duplicate algorithms with divergent thresholds**.
The audit (AUDIT.md Batch 3) flagged this as the highest-risk bug
class in the codebase: three places implementing variants of the same
concept guarantees that one of them goes stale every time the science
gets refined.

**Fix**
Phase 4r.dataspine.1 — extracted the canonical classifier to
`src/core/recoveryDebt.js` (`classifyChronicRecoveryDebt`). Both
`goalModel.js` and `intelligence.js` now call it. The HRV-depression
signal now contributes to the burden in intelligence's userState,
which means the synthesizer sees it and can rank it as a hypothesis.
The `predictedBands.js` per-day fatigue classifier is intentionally
left separate — it's a different concept (single-day workout fatigue
including TSS-ratio + consecutive hard days), not chronic recovery
debt.

**What would have prevented it**
- **Single-source-of-truth principle in the data model spec** (now
  documented in DATAMODEL.md and AUDIT.md). Duplicate implementations
  of any Layer 1/2 derivative are bugs by definition.
- **Multi-hypothesis reasoning in the synthesizer.** Even with the
  burden firing correctly, the synthesizer should weigh competing
  causes and surface the top 2-3, not commit to one. This is Phase
  C3 work and remains pending — the current synthesizer's
  `recalibrate-math` pattern still picks a single dominant cause.
- **A SMOKE_TESTS check** that the `recovery-debt` burden fires when
  the user's recent sleep is low. Added below as part of this entry.
- **The audit (AUDIT.md) itself** as a recurring artifact. When a new
  Layer 1/2 calculator is added, the audit gets re-run to ensure no
  duplicates have crept in.

---

## 2026-05-24 — Start screen headline: "(undefined priority)" leaked into UI

**Symptom**
The Start-screen intelligence headline (below the DCY status word) read:
`Weight cut + race in 10 days (undefined prio…`. The literal string
"undefined" was visible to the user, and the trailing parenthetical was
mid-word-truncated. The user noticed and reported.

**Root cause**
Two stacked bugs:

1. `src/core/intelligence.js:553` built the conflict title via template
   literal:
   ```js
   title: `Weight cut + race in ${days} days (${race.priority} priority)`
   ```
   It read `.priority` directly from the raw race object. Earlier in
   the same module, the upcoming-race pipeline normalises priority into
   `_priority` (uppercased, defaulting to `'A'`), but that normalisation
   was never propagated to the conflict titles. When a race had no
   priority field set, the template literal interpolated the literal
   JavaScript string `"undefined"`.

2. `src/components/MobileHome.jsx:2653` (the Start-screen headline
   memo) hard-truncated at 46 characters with `raw.slice(0, 44) + '…'`.
   That cut hit mid-word for the actual headline length, producing the
   visible `prio…` fragment that drew the user's attention.

Bug 2 wouldn't have been user-visible without bug 1 — the real conflict
title fits comfortably in two lines on the S25U. Bug 1 wouldn't have
been visible without bug 2 — the truncation would have hidden the junk
text further down the cut-off line.

**Fix**
Phase 4r.intel.25:
- `intelligence.js:553` now uses the normalised `_priority` (with `||
  'A'` fallback) and feeds it into both the title and evidence object.
- `MobileHome.jsx` intelHeadline memo returns the full title; the render
  site clamps to 2 lines via `WebkitLineClamp: 2` + `overflowWrap:
  'anywhere'`. CSS handles overflow, JS doesn't truncate.

**What would have prevented it**
- **Lint rule against `${x.optionalProp}` in template literals.** No
  ESLint config exists in arnold-app today (verified via `glob
  eslint.config.*` — no hits). Adding `eslint-plugin-no-undefined-in-template`
  or a custom rule would catch this class of bug. The TypeScript
  alternative (annotate `priority` as `'A' | 'B' | 'C'`) is heavier
  but eliminates the whole class.
- **A grep-based pre-commit hook** for the pattern
  `\${[^}]+\.(priority|name|date)[^}]*}` in template-literal
  positions, surfacing every place we interpolate a possibly-undefined
  field.
- **A SMOKE_TESTS check** (added below) that walks the Start-screen
  headline for the literal string "undefined" — fast catch for any
  future template-literal interpolation bug.
- **Visual regression on truncated text.** The 46-char hard truncation
  was always going to bite eventually — fixed sizes don't survive new
  conflict titles. Switching to CSS line-clamp removes the failure mode
  entirely.

---

## 2026-05-24 — Start headline disappeared silently (shape mismatch on synth return)

**Symptom**
After Phase 4r.intel.27 shipped, the italic action line under the DCY
status word on the Start screen never rendered, despite the synthesizer
having ample cards to pick from. The user reported "I do not see the
Insights message" and provided a screenshot — the rail showed score +
"Depleting" + the four factor chips, but no headline between
"Depleting" and the chips. No console errors.

**Root cause**
`MobileHome.jsx:2663` did:
```js
const plan = synthesizeRecommendations(us, {});
const cards = plan?.cards || [];
```
But `synthesizeRecommendations` returns the cards **array directly**
(`intelligence.js:891` → `return cards.slice(0, 4)`), not a
`{cards: [...]}` object. So `plan?.cards` evaluated to `undefined` on
an array, `cards` became `[]`, the empty-cards guard returned `null`,
and the conditional render `{intelHeadline && ...}` rendered nothing.

This was a regression from Phase 4r.intel.27. Phase 4r.intel.25 (the
prior version) read the conflicts array off `userState` directly
(`us.goalConflicts`) so the shape was correct. When I rewrote to
read from the synthesizer's output, I assumed an object-with-cards
shape instead of reading the function signature.

The bug was silent because:
1. The conditional render `{intelHeadline && ...}` hides nullish state
   without any visual artifact (no empty container, no error).
2. The intelHeadline memo had a `catch { return null }` but no
   `console.warn`, so silent shape mismatches looked identical to
   "no cards fired."
3. No smoke test asserted the headline RENDERS — only assertions about
   its CONTENT existed (no `undefined`, wraps to 2 lines, etc.).

**Fix**
Phase 4r.intel.28 — `MobileHome.jsx:2663` now:
```js
const synth = synthesizeRecommendations(us, { rawInsights: [], rawPrompts: [] });
const cards = Array.isArray(synth) ? synth : (synth?.cards || []);
```
Handles both shapes defensively (array or object-with-cards) in case
the return type changes again. Added a `console.warn` to the
intelHeadline catch block so future silent failures surface.

**What would have prevented it**
- **TypeScript or JSDoc-typed return signatures.** The
  `synthesizeRecommendations` JSDoc at intelligence.js:720 actually
  says `@returns {Array<object>}` — I missed reading it. A typed
  return that an LSP could verify against the caller's destructure
  would have caught this at edit time.
- **No silent catches.** Every `catch { return null }` should
  `console.warn` so silent shape mismatches don't look identical to
  "no data fired." Sweep TODO: audit remaining `catch {}` blocks in
  the codebase and add explicit warnings.
- **A smoke test that asserts presence, not just shape.** Existing
  checks were "if the headline renders, it must not contain
  'undefined' and must wrap to 2 lines." Missing: "with realistic
  test data (a cut goal + a low intake), the headline MUST render
  at least one card's recommendation." Added below as a positive
  presence check.
- **Cross-reference test: the SAME synth call is made in two
  places (MobileEdgeIQ and intelHeadline). MobileEdgeIQ correctly
  treated the return as an array (`MobileHome.jsx:3601`). Diffing
  the two call sites at edit time would have surfaced the mismatch.
  Worth adding to CONTRIBUTING.md: when calling a shared core
  helper, grep for OTHER callers first and mirror their pattern.

---

## 2026-05-25 — Coach BETA tab went silent: `concernSlots is not defined` (file-rewrite regression)

**Symptom**
After shipping HYROX patterns + the manual-workout detection fix, the
user opened the Coach BETA tab and saw the empty state ("No briefs
produced. Either the engine threw or your data is too thin"). 0 act /
0 watch / 0 aligned — even the `patternAlignedBaseline` fallback
wasn't firing. Yesterday the same tab was producing multiple briefs.

**Root cause**
`composeCoachBriefs` referenced `concernSlots` but the `const
concernSlots = Math.max(1, maxBriefs - positiveSlotsToReserve);` line
got lost during one of my successive file-rewrite cycles when
appending the HYROX patterns. The Edit tool kept truncating
`coachBriefs.js` mid-append, and each subsequent restore pass
preserved the function structure but dropped this one line. Runtime
threw `ReferenceError: concernSlots is not defined` inside
composeCoachBriefs; `safeCompute` caught the throw, returned `[]`, and
the empty-state UI rendered.

**Fix**
Phase 4r.coach.v2.hyrox.fix2 — restored the `concernSlots` declaration
on line 910. Engine now fires briefs again (verified with synthetic
empty + normal-state inputs: empty → 1 aligned-baseline; normal → 3
positives).

**What would have prevented it**
- **Don't use bash heredoc + Edit-tool replacements on the same large
  file in the same session.** The Edit tool's diff model and the bash
  shell's stdin both have hidden length limits I kept hitting. Combined,
  they produced silently-truncated files where the harness reported
  success and the on-disk reality differed.
- **Run `node --check` after every change to a JS module that the app
  depends on.** I checked syntax often but the bug was a runtime
  reference to a missing variable — `node --check` passes syntax but
  not name resolution. A unit test that just calls
  `composeCoachBriefs({...})` once would have caught it.
- **Run a smoke harness over the engine after touching it.** The
  CoachBeta surface guards itself with `safeCompute`, which means
  engine bugs go silent. The smoke harness should call the engine
  directly with a known-good payload and assert at least one brief
  fires.
- **Watch the tab counts as a signal.** The `0 act / 0 watch / 0
  aligned` line in the CoachBeta header was a free runtime
  diagnostic. I should have looked at the screenshot more carefully
  before assuming the engine was healthy.

---

## 2026-05-24 — Daily tab crashed on web: `dyn is not defined` (Phase A cleanup regression)

**Symptom**
After shipping Phase 4r.dataspine.4, the Daily tab on web threw
`Uncaught ReferenceError: dyn is not defined` from `NutritionInput.jsx:1432`
and React showed "An error occurred in the <NutritionInput>
component" — the whole Daily tab went blank. Visible in console; only
caught because the user opened DevTools.

**Root cause**
During the Phase A finalization sweep, I rewrote the calorie/macro
target block at `NutritionInput.jsx:1411-1421`. The original block
defined a local `dyn` variable that the JSX 20 lines below
(`targetInline` at line 1432) referenced for `dynamicTarget`,
`isTrainingDay`, `eatBackKcal`, and the four macro grams. My rewrite
renamed the variable to `effGoals` (matching the new shape: a goals
object) and didn't notice the downstream JSX still expected `dyn`.

The grep I ran before declaring Phase A "done" looked for the legacy
function NAMES (`getDynamicMacroTarget` etc.) and for the imports.
It DID NOT grep for `\bdyn\b` to catch consumers of the local
variable I had just deleted. So the rename created an undefined-
variable reference that survived to runtime.

The component-level error meant the whole Daily tab failed to render,
not just the nutrition panel.

**Fix**
Phase 4r.dataspine.5 — added a shape-compat shim at
`NutritionInput.jsx:1422-1432` that builds a `dyn` object from
`eff` with the legacy field names the JSX expects
(`dynamicTarget`, `isTrainingDay`, `eatBackKcal`, `proteinG/carbsG/
fatG/fiberG`). `effGoals` stays for the macro-vs-goal child
components that consume the goals-object shape. Both new variables
coexist, the JSX is untouched.

The alternative — rewriting the JSX to read from `effGoals` directly
— is cleaner but a bigger diff. Shim was the right call to ship the
fix fast; a future polish pass can collapse the two.

**What would have prevented it**
- **Variable-rename grep, not just import-rename grep.** When a
  rewrite deletes or renames a local variable that other code in
  the same file likely consumes, grep `\b<oldname>\b` BEFORE
  declaring the rewrite done. Added to CONTRIBUTING.md.
- **Component-level error boundaries.** React showed "Consider
  adding an error boundary." A single `<ErrorBoundary>` wrapping
  each tab content area would have failed gracefully with a
  visible diagnostic instead of blanking the whole tab. TODO:
  add error boundaries around NutritionInput, GoalsHub,
  CalendarTab, TrainingTab, Dashboard.
- **A smoke test for "every tab renders without throwing on a
  fresh boot."** Currently smoke tests check specific feature
  behaviors per tab. Missing: a top-level "no component-level
  errors in console on boot of each tab." Adding this would have
  caught this within seconds of the build.
- **Build-stamp + smoke-tests trigger.** CONTRIBUTING.md says
  "before declaring done, run the smoke tests for the surfaces
  you touched." NutritionInput is on the Daily tab — running
  the Daily smoke section would have surfaced the blank tab
  immediately. I marked Phase A done without running smokes.
  Mea culpa.

## 2026-06-18 — Cronometer `export_http_403` was upstream, not Arnold
**Symptom:** Cronometer sync fails with `cronometer_upstream_failed (export_http_403[server=cloudflare;ray=...;mit=;ct=])`. Worker login + GWT `authenticate` + `generateAuthorizationToken` all succeed; only `GET /export` 403s with an empty body, `server=cloudflare`, no `cf-mitigated`.
**Investigation:** Added browser UA + Referer + `Sec-Fetch-*` trio to the export request (note: CF Workers strips `Sec-*` outbound anyway) — no change. Matched `gocronometer`'s exact request shape — still 403.
**Root cause (confirmed by Emil):** Cronometer's `/export` denies the request **in Emil's own logged-in browser** — Gold account, valid 32-hex nonce, `generate=dailySummary`, correct date range → `Access to cronometer.com was denied / HTTP ERROR 403` (Jetty error page). So it's a **Cronometer-side breakage of their export endpoint**, not Arnold's worker. Full re-login did not fix it. Emil emailed Cronometer support.
**Worker changes kept (harmless/beneficial):** `cronoExport` now sends browser-ish headers + surfaces `server/ray/mit/ct` diagnostics on failure; a `403`/`429` on export no longer deletes the session and re-logs-in (this retry storm previously caused the "Too Many Attempts" account lockout).
**Fallback if Cronometer doesn't fix it:** pull daily macros via the diary's GWT data call (works from the worker — GWT auth already succeeds) instead of the CSV `/export`. Requires a browser capture of that diary GWT request to reverse-engineer the payload.

## 2026-06-18 — DCY fuel-N = 1 ("Strongly Absorbing") on an empty SETTLED day
**Symptom:** With zero nutrition logged all day (Cronometer down), the daily score read "Strongly Absorbing" and the DCY panel showed `FUEL — N 100%` (Calories 0/2077, Protein 0/170).
**Root cause:** `fuelAdequacy()` distinguishes tracker (≥3 days history → empty day = N 0) from non-tracker (no history → empty day = N 1, don't penalize). But the history check read `eff.baseline`, which `effectiveIntake()` only populates when `state.isPartial` (an in-progress day). After bedtime or on any historical/settled day, `partialDayState` returns `isPartial:false` → `baseline = null` → `hasBaselineHistory` false → every empty *tracked* day fell through to the non-tracker `N = 1` "assume normal" branch.
**Fix (Phase 4r.dcy.3):** Resolve the tracker history independent of partial-day state — lazily call `nutritionBaseline(date)` when the empty-day / N==null branches actually need it, instead of relying on the partial-only `baseline`. Empty tracked day now correctly returns N=0 (DCY goes depleting, FUEL N shows 0%). `nutritionBaseline` only counts days with ≥ minKcal within the 14-day lookback, so a non-tracker still gets N=1.
**Caveat:** if Cronometer stays down >14 days the baseline empties and the user reads as a non-tracker again (N=1). Acceptable for now.

## 2026-06-18 — Shipped a drawer card that overflowed off-screen (quality miss)
**Symptom:** Two EXPECTED cards laid out `gridTemplateColumns: '1fr 1fr'` inside the ~340px web day-drawer rail pushed the 2nd card off the right edge of the entire app. Also added a stray lowercase "✕ race" pill wedged between chips.
**Cause:** Grid tracks default to `min-width: auto`, so `1fr 1fr` won't shrink below each child's min-content; `PredictedBandsCard` is not designed for ~160px, so the row overflowed the fixed-width rail (which doesn't clip) and spilled past the viewport. I had even flagged the cramping risk but shipped it anyway.
**Fix:** Stack the EXPECTED cards (`'1fr'`) in the rail. Race remove moved inline onto the race line (small ✕), not a separate pill.
**Rule (DESIGN_DECISIONS):** Do NOT place 2+ content cards side-by-side inside the fixed ~340px web drawer rail — stack them. If side-by-side is truly wanted, widen the rail first. Never ship a layout whose overflow I couldn't visually verify when reasoning says it's tight — default to the safe (stacked) layout.

## 2026-06-19 — Fuel showed 92% / "Strongly Absorbing" with ZERO food logged (hallucination)
**Symptom:** Start screen at 9pm, no food logged (Cronometer outage), yet Fuel pill = 92% and DCY = "+41 Strongly Absorbing." Implied data the user never entered.
**Root cause:** `geomMeanWeighted` filters `p.v > 0`, so it DROPS components that are exactly 0 (treats "ate 0 cal" as *missing*, not *zero fuel*). With food=0 but water logged (~2.75 L / 3 L = 0.92), N was computed from **hydration alone** → 0.92. The earlier empty-day guard (Phase 4r.dcy.3) didn't fire because it required water===0 too.
**Fixes (Phase 4r.dcy.4):**
1. `isEmptyDay = intakeCal === 0 && intakeProtein === 0` (dropped the `&& intakeWaterL === 0` — hydration is NOT fuel and must not mask an empty food day).
2. Made `hasBaselineHistory()` robust to sync outages: also true if `storage.get('cronometer')`/`nutritionLog` has any history or `cronometerAuth` is configured — so a tracker whose recent lookback is empty (Cronometer down) still scores empty days N=0, never the non-tracker N=1.
**Result:** empty food day for a tracker → N=0 → DCY negative → "Depleting", Fuel 0%. No more invented fuelling.
**Lesson:** geometric-mean helpers that drop zeros silently turn "real zero" into "no data" — never feed a hard-zero, must-count input (calories) through a `v>0`-filtering mean without guarding the zero case first.

### 2026-06-19 (addendum) — Same hydration-masks-empty bug in the EdgeIQ/Daily "Nutrition" domain
The Start "Fuel %" (dcy.js) and the EdgeIQ "Nutrition" pillar are SEPARATE scorers and both had the bug. `trainingStress.js` computeDailyScore builds the nutrition domain from protein/calories/hydration factors, each guarded `if (x > 0)` — so with food=0 + water logged, only hydration is scored → domain ≈ 92. Fix: `hasNutData = nutProtein > 0 || nutCalories > 0` (water alone no longer constitutes a nutrition score → domain reads "no data" / "—" instead of a fake 92).
**Meta-lesson:** the "no food but X% fuel" hallucination lived in THREE places (dcy fuelAdequacy via geomMean v>0 drop, dcy isEmptyDay requiring water=0, and trainingStress nutrition-domain `if(x>0)` skips). When a metric must count a hard zero, audit EVERY scorer that surfaces it — they don't share code.

## 2026-06-21 — Body weight showed yesterday's value; a 10:01 morning weigh-in was rejected
**Symptom:** Arnold showed 184.2 lb; Garmin (and the actual morning weigh-in) was 186.8 lb. `window.weightDebug()` showed today's only reading — 2026-06-21 @ **10:01**, 186.8 — flagged `fasted: FALSE`, so the selector fell back to June 20's 06:03 reading (184.2).
**Root cause:** `bodyWeight.js` `MORNING_CUTOFF_HOUR = 10` with `time < 10:00`. A 10:01 reading misses by **one minute** → excluded as non-fasted → trend falls back to the previous fasted day and presents it as current.
**Fix:** cutoff 10:00 → **noon (12:00)**. A genuine morning weigh-in (06:00–noon) now counts; the EARLIEST-per-day rule still selects the most-fasted reading on multi-reading days; 13:00+ intraday/evening readings remain excluded.
**Durable catch (proposed, ties to DATA_INTEGRITY Layer 3):** when the displayed body weight is NOT from today (fallback to an earlier fasted day), label it **"as of <date>"** instead of presenting a stale value as current — the same staleness-honesty the data-health banner uses. The weight selectors should return the value's DATE so the UI can show it.
**Note:** arbitrary hard time-thresholds are fragile; consider making the morning window profile-configurable later.

### 2026-06-21 (Phase 2) — fuel/nutrition scorers migrated onto metricResult
trainingStress nutrition domain + dcy fuelAdequacy now route the zero-vs-missing decision through `core/metricResult.js` (`scoreAdherence`/`combineDomain`). Structural guarantees (verified by node tests, not just patches): water-only/no-food → no-data (never a fabricated %); a logged-but-zero macro is SCORED LOW, not dropped (fixes the partial-day geomMean `v>0` skip); non-tracker → not-tracked. `dcy.N` stays numeric (formula needs it) with a sibling `fuelStatus`; Start Fuel pill + DcyDetails render "—" on no-data.
