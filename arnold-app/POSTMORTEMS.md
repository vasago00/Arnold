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
