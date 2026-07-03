# DESIGN_DECISIONS.md — binding rules (read EVERY session, treat as law)

> Purpose: stop re-litigating settled decisions and stop building the big version
> when Emil asked for the small fix. Any new Cowork/Claude session reads this
> BEFORE touching the UI. When a rule is wrong, Emil corrects the rule here ONCE
> and it stays fixed. Newest decisions appended at the bottom of each section.

## How I (Claude) must work here
- **Do the smallest change that satisfies the literal ask.** Don't infer extra scope.
- **Before anything beyond a small fix, restate the ask + my plan in ONE line and wait for "yes."**
- **One source of truth per number.** A metric is computed once and shown identically everywhere (Daily, EdgeIQ, Trend). Never two functions for the same value.
- **Verify, don't claim.** A source edit isn't "fixed" on Emil's screen until he rebuilds; say so.
- **Match the existing visual language** (boxed tiles, the app's tokens) — don't introduce new patterns unasked.

## Activity card — structure (LOCKED)
- **Hero band** (top, universal on every activity): LEFT = Training Readiness 7d/30d + A:C ratio · CENTER = rTSS speedometer (load + zone word) · RIGHT = 3 universal metrics **HR Effort · Avg HR · Calories**. The right rail never changes by sport.
- **Card body:**
  1. **Macro metrics** — the **4** discipline basics (fixed per activity). Keep this; Emil likes it.
  2. **Details** — the per-activity SUB-metrics. **This includes user-logged RPE and Added Load** — they are *details*, NOT their own section. Aim for a **consistent set count** per activity (don't leave it at 2 when the pool has more).
  3. **Fuel** — Fuel & Fluids + Replenish under ONE "Fuel" header (stacked, vertical — NO swipe panes; reverted 2026-06-09).
  4. **Vs Goal / Vs usual** — below Fuel.
- **NO narrative / directional writing on the card.** Numbers, tiles, visuals only. The ONLY place narrative/coaching analysis belongs is the **Coach** voice (CoachComment / top-right panel).

## Things explicitly REMOVED / rejected (don't re-add without asking)
- The "≈ in oz" hydration tile (redundant with litres).
- The Replenish "X/Y · NN%" summary badge (per-tile ✓ checkmarks are enough).
- The manual "Log post-run weight" button (sweat model auto-reads synced weigh-ins).
- The per-card coach line (coaching voice lives in the Coach, not the card).
- Fuel·Goals **swipe panes** (built then reverted — Emil: that was "the wrong piece").

## Naming / labels (LOCKED)
- Speedometer effort tile = **"HR Effort"** (measured). Perceived effort = **RPE** (logged on the card). They're complementary; keep both, keep them distinct.

## Open / not yet decided
- Visual primitives for the card (HR-zone bar / effort rings / sparklines) — Emil wants to see the layout land before choosing.
- Tap-to-expand on the 4 macro tiles — agreed in principle, not built.
- "Set number" of Details per activity — confirm the target count with Emil.

## Day drawer (web rail ~340px)
- Workout EXPECTED cards STACK vertically in the rail — never side-by-side (overflows off-screen; see POSTMORTEMS 2026-06-18).
- Race in the drawer is shown ONCE: a single line "★ <name> · <dist> · <city> · ⏱ ~<pred>" with a trailing ✕ to remove. No separate race pill, no race-type chip.

## Planner: cancel/edit is tied to whether the session HAPPENED, not the date
- A planned session (or a race) shows its remove ✕ and is tap-to-edit **iff it is not yet "done"** — i.e. Arnold has no matching logged activity (a real timestamped record) for it that day. Implemented via `sessionDone(session)` in `DayDrawer` (matches the planned type to a logged activity family).
- Do NOT gate on `isPast` or on "the day has any activity" — today's logged race-run must not lock an un-done strength session, and a missed past session stays removable. Once the matching activity is logged, the ✕ (and edit) disappear for that session only.

## Today's workout status — ONE source of truth (2026-06-21)
`core/todayStatus.js` `resolveTodayStatus({activities, planned, today})` is the SINGLE
authority for "what did the user do today / was the plan done". It reflects what
ACTUALLY happened: a logged workout that isn't the planned discipline (or with no
plan at all) reads as that discipline ("Cycling" / "Off-plan · Cycling"), NEVER as
"Rest day". Exports the shared maps too: `PLAN_TYPE_FAMILY`, `PLAN_TYPE_LABEL`,
`FAMILY_LABEL`, `actualFamilyOf`.

RULE: any surface that labels today's plan/done state MUST use resolveTodayStatus()
(or these exports) — never re-derive a plan-vs-actual label inline. Wired through it:
- `PlannedWorkoutTile.jsx` (mobile Start tile) — imports the maps + actualFamilyOf.
- `TrainingTab.jsx` (web EdgeIQ TODAY cockpit cell + "Today" attention tile).
Already correct (key off "trained-today", label by the actual session — leave as-is,
but route through todayStatus if ever changed): `core/intelligence.js` trainStatus,
`components/CoachComment.jsx`. Tests: `core/todayStatus.test.js`.

WHY: this class of bug ("Rest day ✓" on a day you rode the bike) recurred surface by
surface because each re-derived the label from the plan alone. Centralizing ends the
whack-a-mole.

ADDENDUM (2026-06-22) — multi-session / two-a-days. resolveTodayStatus() now ALSO
returns `sessions[]` (every qualifying session that day, annotated + sorted longest-
first), `secondaries` (all but the primary), and `multi` (true when ≥2 meaningful
non-mobility sessions). `primary`/`label`/`done` are unchanged for back-compat.
Daily training load ALREADY sums all of a day's sessions — trainingStress.js sums
every today-run's hrTSS, every strength/hyrox tonnage/load, and cycling load, and
flips sessionType→'mixed'; computeAcuteChronicRatio likewise SUMS all runs in the
7/28-day window. So load was never the collapse point — only the display was.
RULE: any surface showing today's status MUST render the full day — primary +
secondaries — never just the primary. (NOTE: ACWR counts RUN load only; same-day
cross-training fatigue from a ride is not in the run-ACWR — revisit when the coach
needs systemic load.)

## Annual Race Timeline (mobile Start tab) — "B1" geometry (2026-06-22)
`AnnualTimeline` (MobileHome.jsx) prioritizes UPCOMING races. Locked decisions:
- Past races do NOT get individual dots — they collapse into a single left "✓N" cap
  (count of races done this calendar year). This killed the unreadable green blob.
- The forward axis is TRUE linear time (today → last upcoming race + 14d; floored at
  8 weeks so a lone near race isn't marooned at the edge, capped 14 months so a far
  goal race can't over-compress the nearer ones). Dot spacing MUST reflect real
  time-to-race — do NOT switch to equal-slot spacing ("option A", rejected by Emil as
  time-dishonest: a race 3 weeks out must not look as far as one 6 months out).
- The window ENDS at the last race (+14d) — never pad the bar out to a fixed 11–14mo
  horizon. The old fixed horizon wasted the right third on empty next-year months
  ("2027 · F M A M" with no races) — that is the exact bug B1 replaced.
- Every upcoming race keeps its date label; when two collide the labels LANE-PACK
  downward (stack), never hide. Collapsing a cluster into a tap-to-expand chip ("B2")
  was REJECTED — Emil explicitly wanted nothing that requires an in-the-moment
  decision. The soonest race is emphasized (filled dot, bold label).
- The "✓N" cap is a DROPDOWN: tap → "Races done · YYYY" log listing each completed
  race this year (name · date · actual distance · finish time), chronological. Finish
  time + actual distance come from the longest activity logged on the race date
  (`doneRaceLog` in MobileHomeInner, matched against `unifiedActivities`); no matching
  activity → time shows "—". AnnualTimeline takes a `doneRaces` prop for this list.

RULE: keep upcoming-race spacing time-truthful; never reintroduce a fixed far horizon
or a tap-to-reveal cluster collapse. The done-cap dropdown is the canonical
"year in races" progress review.
