
## 2026-06-21 — "Hydration alone" latent re-opening (caught by Phase 3 extraction)
When extracting `trainingStress.nutritionScore()` into a pure, independently-callable
function, a golden test with `{macros:null, water:2.5}` revealed it scored **0.83 from
hydration alone** — a mini-version of the original Fuel-92% bug. The original block was
safe only because the *caller* nulled water when no food was logged; the pure function
trusted that. Fix: `nutritionScore` now gates internally (no calories AND no protein →
drop water), matching `dcy.fuelScore`. **Lesson:** when you extract a pure scorer, give
it its OWN invariant guard — don't rely on a caller's gating, or the bug rides along the
moment someone calls it differently. This is exactly the regression the golden tests exist
to catch, and they did.

## 2026-06-21 — Start tile "lost" an off-plan workout
Logged a 46-min indoor bike on a day whose plan was an easy run. Daily tab + Calendar
showed it (they read the actual record); the Start post-workout tile stayed blank.
Root cause: `deriveState()` in PlannedWorkoutTile.jsx only promotes to the post-workout
"complete" state when a logged activity matches the PLANNED family (`matchFamily`). A
cycling session on a run-plan day failed the match → tile stuck in `pre`, hiding the
workout. Fix: after the planned-family check, an off-plan fallback flips to `complete`
on the actual activity (any non-mobility session ≥20 min), labels by what was ACTUALLY
done (own discipline icon + "Off-plan · Cycling"), and carries `offPlan`/`plannedFamily`.
Principle (recurring): tiles must reflect what ACTUALLY happened, not whether the planned
thing happened.

### Tooling note — Edit/Write truncated the file (again)
Used the Edit tool on PlannedWorkoutTile.jsx (existing file) and it TRUNCATED everything
after ~line 2854 (mid-SessionSignature) — the documented Windows-mount hazard. Recovered
cleanly: `git show HEAD:<path>` (pristine, parsed OK), diffed to confirm the only deltas
were my 3 intended edits + the lost tail (no unrelated working-tree changes), then
rebuilt from HEAD by re-applying the 3 edits via python string-replace. RULE REINFORCED:
NEVER use Edit/Write to modify an existing file on this mount — only bash/python
string-replace. New-file Write is fine.

### 2026-06-21 (follow-up) — root cause was the NO-PLAN guard, not just family mismatch
First fix put the off-plan branch AFTER `if (!planned || !family || family==='rest') return none`.
But the Start tile still showed nothing because today's planner slot wasn't returning a plan
at all (`todayPlanned()` → null/rest), so deriveState bailed to `none` BEFORE reaching the
off-plan branch — the CoachingHeroCard (its `none` fallback) rendered instead. Real fix:
compute `meaningfulToday` (any non-mobility activity ≥20 min, same `allActivities` source the
Calendar uses) and the off-plan/no-plan `complete` BEFORE the no-plan guard. Now the
post-workout summary appears whether or not a plan existed. Label: "Off-plan · <discipline>"
when a different workout was planned; just "<discipline>" when nothing was planned.
LESSON: when a tile "loses" data the rest of the app shows, check the EARLY-RETURN guards
first — the bug is usually an upstream gate bailing before the data is ever considered.
