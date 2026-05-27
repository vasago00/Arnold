# Arnold — How to make changes safely

The goal of this doc is for changes to ship without breaking things, and
for bugs to teach us something instead of just being patched. It
formalizes the change-management process agreed in May 2026 after the
arnold-compact-btn cascade bug (see POSTMORTEMS.md).

If you're an AI assistant or developer touching this codebase: read
this once, then follow it on every change. The whole doc is short on
purpose.

---

## Three artifacts that keep us honest

1. **`POSTMORTEMS.md`** — append-only log of bugs that escaped to a
   user-visible symptom. Each entry asks "what would have prevented
   this" so the doc gets shorter (per bug class) over time.

2. **`SMOKE_TESTS.md`** — per-surface regression checklist. ~30 checks,
   ~2 minutes to run. After every change, run the relevant section.
   When a bug ships that smoke tests missed, ADD A CHECK before
   closing the bug.

3. **Boot state fingerprint** (in `Arnold.jsx`, `[arnold-state]` logs).
   First thing to ask for when a bug is reported. Shows build, viewport,
   storage counts, intelligence state, derived targets, overrides.

---

## Pre-change checklist (5 questions, answer in your response before editing)

Before ANY meaningful code change, answer these five questions out loud
to the user (in the message that precedes the edit):

1. **What user-visible behavior does this touch?**
   Name the surfaces (EdgeIQ rail, Calendar drawer, etc.).

2. **What else uses this code path / class / shared state?**
   Grep the codebase. Don't assume isolation; the arnold-compact-btn
   bug bit five buttons because nobody asked this question.

3. **What's the minimal test the user can run to verify it works?**
   Point them at a specific section of SMOKE_TESTS.md, or describe a
   single tap sequence. If you can't articulate a test, you're not
   sure enough about the change.

4. **What's the rollback if it breaks?**
   Single-line answer ("revert the inset to -8px"), so the user can
   undo without you in the loop if something's catastrophic.

5. **What console signature confirms it landed?**
   Bump the build stamp suffix (`Phase 4r.XXX`). Reference it in your
   "tell the user" summary. The user verifies the stamp before testing.

If you can't answer all five with conviction, do more investigation
first. The 30 seconds it takes to answer them prevents the hour you'd
spend chasing a symptom.

---

## High-risk patterns to watch for

These are bug classes we've already hit. Don't add new instances of any
of them without explicit reasoning + a SMOKE_TESTS check.

### Inline `all: 'unset'` + class with `::before`/`::after` overlay

Inline styles win specificity over class rules. `all: unset` resets
`position` to `static`. If the class relies on `position: relative` to
contain an absolutely-positioned pseudo-element (like
`.arnold-compact-btn::before`), the pseudo-element escapes its parent
and absorbs clicks across whatever ancestor IS positioned (often the
viewport).

**Fix**: add `position: 'relative'` inline alongside `all: 'unset'`,
and put `!important` on the class rule as belt-and-suspenders. See
`mobile.css` `.arnold-compact-btn`.

### Two memos on different components with the same name

`insightsForHero` was defined inside `Dashboard` but referenced inside
`TrainingTab` — different React components in the same file. The
reference was undefined → render error → blank EdgeIQ. React doesn't
warn about this at compile time.

**Fix**: when you add a useMemo, double-check it's inside the SAME
function as the JSX that references it. Lint rule TBD.

### Touch handlers competing at different DOM levels

`<main>` has a page-level swipe handler that changes tabs. The
Calendar tab has its own swipe handler that changes months. Both fire
on the same gesture because `stopPropagation` on React synthetic touch
events is unreliable in Capacitor WebView.

**Fix**: at the page-level handler, early-return on tabs that own their
own gesture (`if (mobileActiveId === 'calendar') return;`).

### Static target pinning that goes stale

User pins "1750 kcal/day" once at the start of a cut. Sleep crashes,
recovery debt accumulates, RMR adapts, but the target stays 1750. The
intelligence layer then argues with itself about whether to cut or
recalibrate.

**Fix**: derive tangible targets from outcome goals via `goalModel.js`,
let user OVERRIDE if needed, surface the divergence between override
and derived value. Don't ever let static targets be the source of truth.

### Stale build masquerading as broken code

VM/build pipeline has been flaky. User tests on stale bundle, reports
"your fix didn't work," debugger chases ghosts.

**Fix**: ALWAYS ask the user to confirm the build stamp before
debugging a reported issue. Match against your most recent
`Phase 4r.XXX` tag.

### Silent catches that hide shape mismatches

`try { someDerivation(...) } catch { return null }` looks harmless until
the upstream return shape changes and the derivation throws. The
caller's empty-state check then renders nothing — visually identical
to "no data fired." The intelHeadline shape-mismatch bug (POSTMORTEMS
2026-05-24) was invisible in the running app for this exact reason.

**Fix**: in any derivation / synthesis / display-computation path, use
`safeCompute(label, fn, fallback?)` from `src/core/safeCompute.js`
instead of writing a bare `try/catch`. The helper logs
`[<label>] failed: <err>` to console on every catch so silent
failures become loud failures in DevTools.

```js
// BEFORE
const eff = (() => { try { return getEffectiveTargets({ date }); }
                     catch { return null; } })();

// AFTER
import { safeCompute } from '../core/safeCompute.js';
const eff = safeCompute('CalendarDrawer:getEffectiveTargets',
                        () => getEffectiveTargets({ date }));
```

Silent catches are still acceptable in defensive parsing code
(`try { JSON.parse(blob) } catch { return defaults }`) where failure
is expected and routine. Use judgment: if a failure here would make
something disappear from the UI, use `safeCompute`.

### Variable-rename grep gap

When a rewrite deletes or renames a local variable that other code in
the same file likely consumes, grep `\b<oldname>\b` BEFORE declaring
the rewrite done. The 4r.dataspine.5 `dyn is not defined` regression
(POSTMORTEMS 2026-05-24) crashed the entire Daily tab because I
renamed `dyn` to `effGoals` at the top of NutritionInput.jsx but
missed JSX 20 lines below that still referenced `dyn.dynamicTarget`.

**Fix**: rename-aware pre-commit check. Before finalising a rewrite
that changes a local variable name, grep the file (not just the
import) for `\b<oldname>\b`. If matches exist outside the rewritten
block, either keep the old name as an alias or update the references
explicitly.

### Cross-file symbol deletion without a sweep

When a multi-phase migration deletes an EXPORTED symbol from `core/`,
the same-file grep above isn't enough — downstream files that
imported the symbol (or depended on a local variable that was fed
from it) will still reference it. The second `dyn is not defined`
regression (Phase 4r.dataspine.5, 2026-05-25) survived migration
because Phase 4r.dataspine.4 deleted `getDynamicCalorieTarget` and
the local `dyn` it produced, but `coachingPrompts.js` had two
functions (`r_nutritionPacing`, `r_underFuelling`) that still
referenced `dyn`. The rules silently failed via `try/catch` in the
rule loop for days before a console screenshot surfaced them.

**Fix**: when deleting any symbol from `core/`, run a project-wide
sweep BEFORE bumping the build stamp:

```bash
grep -rn '\b<deleted-symbol>\b' arnold-app/src/
# Also grep for likely-derived local names the symbol used to feed:
grep -rn '\bdyn\b' arnold-app/src/   # if you just deleted the function whose result was named `dyn`
```

Comment references are fine. Code references are not. If matches
remain, fix them all in the same commit as the deletion.

### Try/catch armor that hides errors from smoke tests

`coachingPrompts.js` and `coachBriefs.js` wrap every rule in
`try/catch + console.warn` so one broken rule can't blank the panel.
The panel still renders with whichever rules didn't crash, so the
"is this surface up?" smoke test passes — but a ReferenceError can
fire on every render for days before someone notices the console.
This is exactly how the `dyn is not defined` regression survived.

**Fix**: when adding a `try/catch` armor that swallows errors, also
add a HEALTH PROBE that runs the same loop and counts errors. Wire
the count into the boot fingerprint so smoke tests can check "is
error count zero?" alongside "does the surface render?". See
`runCoachingPromptsHealthProbe` in `coachingPrompts.js` and the
`[arnold-state] coach prompts:` line in `Arnold.jsx`.

### Tab content crashes blank the whole tab

A render error inside a tab component propagates up the React tree to
the root (no error boundary in between), which renders nothing for
the whole tab. The user sees an empty tab with no diagnostic.

**Fix**: every tab content is wrapped in `<ErrorBoundary tabName="…">`
(see `src/components/ErrorBoundary.jsx`). The boundary catches
component-level throws and shows a retry UI with the error message.
Console gets a `[ErrorBoundary:<tab>]` log with the full stack trace.
Adding a NEW tab? Wrap it in `<ErrorBoundary tabName="…">` in
`Arnold.jsx`'s tab dispatch.

---

## Bug response protocol

When the user reports a bug:

1. **Ask for the boot fingerprint screenshot.** If they haven't sent
   the console, ask. The fingerprint tells you build version, data
   counts, and intelligence state in 5 lines.

2. **Confirm the build is current.** Compare the `[arnold-build]` stamp
   against your most recent ship. If stale → rebuild, don't debug.

3. **Identify which surface(s) are affected.** Match to a SMOKE_TESTS
   section. If the smoke test wouldn't have caught this, that's a gap
   to record.

4. **Hypothesize root cause BEFORE proposing a fix.** Write out the
   chain of reasoning. Symptom-driven fixes shifted the bug 3 times
   in the calendar saga because no root cause was ever stated.

5. **Run the pre-change checklist** (above) before editing.

6. **Add a smoke test** that would have caught this bug, in the same
   commit as the fix.

7. **Append a postmortem** if the bug was non-trivial. Especially if
   it was latent (existed in code for a while before manifesting).

---

## When to skip the process

For purely cosmetic tweaks (spacing, copy, color shades) where the
behavior is unchanged, the checklist is overkill. Use judgment. But
for ANY change that:
- Touches shared CSS classes
- Changes a function signature
- Adds or removes a memo / useEffect
- Modifies storage shape
- Touches sync, the intelligence layer, or goalModel
- Affects touch / swipe / click routing

...always run the full process. The 30 seconds you save aren't worth
the hour you might lose later.

---

## Updating this doc

When we discover a new bug class, ADD IT to "High-risk patterns" above
so the next change avoids it. The doc earns its keep by growing
alongside the bugs we've collectively learned from.
