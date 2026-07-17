# DESIGN_LESSONS.md — Arnold UI/UX memory (read before any UI work)

This is the durable memory of design lessons learned the hard way with Emil. It is
**binding** alongside `DESIGN_DECISIONS.md`. Every UI/UX change must pass this list.
When a new lesson is learned, append it here (dated) so we never relearn it.

## 0. Process — the #1 rule
- **MOCK FIRST, then build.** "I mock, we agree, I build." Use the visualize widget to
  show a design at Emil's density bar and get sign-off BEFORE editing real components.
  Editing build-blind and iterating on rejections has wasted many cycles. Do not skip this.
- Build-blind reality: the sandbox is usually down and Emil builds on Windows. So a wrong
  guess costs a full round-trip. Mocking is cheap; blind edits are expensive.

## 1. Audience & density
- Target user = **analytical/educated athlete** (incl. Emil). They want DENSITY and the
  "why", not dumbed-down tiles. Never ship "half a screen that tells me 3 numbers".
- **Use the whole canvas of a tile.** If a tile is wide, lay data out in 2D (corners/rows/
  columns) — do NOT stack everything in one narrow centered column leaving big black space.
  Dead black space = a design smell. Fill the space with real information or shrink the tile.
- **Executive, tight, elevated.** Lead with the core. Small fonts, tight rhythm, numbers
  forward. If you can remove chrome and keep meaning, remove it.

## 2. Visual language
- **No progress bars / long horizontal lines as scorecards** — Emil calls these a "shopping
  list", unoriginal. Position, light/glow, and shape carry meaning (see the pre/post-workout
  tile as the aesthetic bar). Trends (a mileage arc) may be a curve/sparkline, never a row of bars.
- **An "arc" must look like an arc** — show rise → peak → taper as a real curve, not a flat ribbon.
- Palette (dark theme): teal `#5eead4` (accent), blue `#60a5fa` (run/long), amber `#fbbf24`
  (tempo/threshold), coral `#fb7185` (intervals/HIIT), purple `#a78bfa` (strength), red
  `#f87171`/`#ef4444` (gap/race), green `#34d399`/`#4ade80` (good). Muted greys for context.
- Use design tokens / `C` theme (CSS vars) for colors, not raw hex where a token exists.

## 3. Mobile — the "preset button trap" (CRITICAL)
- `mobile.css` forces, with `!important`:
  - `input:not(.arnold-compact-input)` → `min-height:44px; font-size:16px; padding:12px 14px`
  - `button:not(.arnold-compact-btn)` → `min-height:42px`
- **Any inline-styled input/button/checkbox on a mobile screen MUST carry
  `.arnold-compact-input` / `.arnold-compact-btn`** or it will render huge and ignore your
  inline sizing. This bit us repeatedly (giant checkbox, tall buttons).
- **Design mobile and web layouts separately.** 7-across grids don't fit a phone. Pass an
  `isMobile` prop (CalendarTab has it) and branch: web = horizontal/grid, mobile = a tight,
  aligned, dense layout (a real table/columns — NOT a loose flex list, which reads un-tight).

## 4. SVG gotcha
- `preserveAspectRatio="none"` stretches the viewBox non-uniformly → a `<circle>` becomes a
  blob. For point markers use a short line/tick with `vectorEffect="non-scaling-stroke"`.

## 5. Information architecture (surfaces don't duplicate)
- **Start = the glance** (today's session, readiness, one coach line / Marathon Coach verdict).
- **EdgeIQ = the analytical layer** (signal cockpit + the training profile).
- **Calendar / Plan = the execution** (the week's sessions, the arc, apply).
- Don't repeat the same verdict/numbers across surfaces. Each surface = a distinct job.
- Don't bury a panel below the day drawer; mind bottom-nav clearance (it goes AFTER content,
  not between). Web strategy → Plan tab; mobile → compact summary near the top.

## 6. Modeling philosophy (so the UI reflects sound logic)
- **Forward-looking**: anchor on CURRENT state → what the GOAL requires. Don't drive a future
  prediction off a stale past race (past races = optional context only).
- **Evidence-based coefficients** (cross-training credit, goal→peak volume, etc.): cite the
  literature, make them a single tunable knob, and plan to make them hub-learnable.
- **Non-linear coaching**: cut-back weeks, rotating quality, doubles — not a straight ramp.
- **Adaptability is the coach's value**: protect a session's INTENT, offer ranked substitutions.

## Week-tile design (LivingPlan "This week") — settled 2026-07
- **Tile = 3 left-to-right rows**: (1) day + second-workout `STR` text badge opposite; (2) session
  icon + type name, then mileage; (3) effort (Lightning) + pace. Faint session-color wash fills the
  canvas (no dead black space). Big mileage number is the hero.
- **Icons = Phosphor** (from the workout tiles): `PersonSimpleRun` (runs), `PersonSimpleTaiChi`
  (mobility), `Trophy` (race), `Bed` (rest), `Lightning` (effort). **No dumbbell** — a strength day
  uses the `STR` text badge, not an icon. (Emil: hand-drawn SVGs looked terrible; dumbbell rejected.)
- **Rest/mobility are NOT full working tiles.** WEB: show the FULL 7-day week, but rest/mobility as
  RECESSIVE tiles (dashed, dimmed, purpose line — "where the work sticks" / "15 min · flexibility").
  MOBILE: show ONLY workout days as tiles, and summarize rest/mobility in the header line
  (`THIS WEEK · N MI · THU 🛏 Rest · WED 🧘 Mobility 15m`). Rationale: don't spend scarce phone canvas
  on low-info days; give workout tiles room.
- **Layout**: web = 7 across; mobile = 3 across (workouts only). Uniform grid for alignment.

## Quality-session structure (Emil, 2026-07 — to build, Sprint 3)
- Easy/long runs are one line (distance + pace). But **intervals/tempo need real structure**:
  a **warm-up** phase, a **main set** with a SHAPE (straight reps, pyramid, inverted pyramid,
  fartlek, cruise intervals — varying by phase: VO2/speed early, threshold mid, race-specific
  late), and a **cool-down**, each with paces + recoveries.
- Display: the **tile** shows a compact structure tag (e.g. "5×1km", "pyramid", "fartlek",
  "3×2mi T"); the **session drill-down** (3.2d) shows the full WU / main / CD breakdown.
- This is a workout-STRUCTURE generator (new) feeding the session card. Must be sim/unit tested.
- CHOSEN FORM (Emil, 2026-07): the drill-down uses an **EFFORT SILHOUETTE** — one flowing filled
  curve (warm-up rises → work reps plateau with recovery valleys → cool-down falls) + a one-line
  coach shorthand. NOT a bar/profile strip (too standard) and NOT the tall 3-row labeled card (too
  big). The tile carries a compact tag ("3×2mi", "1-2-3-2-1") and taps to open the silhouette.
  Built: `core/workoutStructure.js` (pure, tested) + `WorkoutSilhouette` in LivingPlan.

## Log (append new lessons, dated)
- 2026-07-11 — **On a HERO surface Emil has art-directed, match the render — don't reflexively
  flatten it.** The Training Profile node/ring graphic ("squid") didn't explain HOW the projected
  finish is derived. After several mock rounds Emil shared a polished concept render (glowing gap
  headline, readiness cards with lit bars, energy streams into a "FINISH PROJECTOR" gauge). Claude
  first "translated it on-brand" by stripping the glow/gauge/streams to a flat card — Emil: "nowhere
  near what I showed you." Lesson: the flat/executive/no-glow default (rule #2) is the baseline for
  DENSE/utility tiles, NOT an absolute. When Emil hands you a specific visual target for a hero
  element, build to THAT — keep the glow, the gauge, the streams — and only drop what's genuinely
  un-buildable (particle fields, heavy neon). Also: this reversed the "no scorecard bars" caution —
  the readiness cards use bars because his render does; his explicit art-direction overrides the
  prior lesson for this surface. Shipped: `RecipePath.jsx` FINISH PROJECTOR (gap headline + pillar
  readiness cards + energy streams + gauge + why), on a subtle radial-glow dark panel.

- 2026-07-05 — Rejected: sparse "3-number" tiles; progress bars; flat ribbon "arc"; recipe
  anchored on an 8-month-old race; Start/Calendar plan duplication; huge mobile buttons/checkbox
  (missing compact classes); wide web tiles with one centered column + black space; loose mobile
  list that "doesn't look tight". Accepted: mock-first; forward-looking current→goal; de-dupe
  surfaces; evidence-based coefficients; de-linearized plan (cut-back + rotating quality).
- 2026-07-10 — **Front-of-page week strip = the plan's OWN workout language, per day.** Final
  Start ticker (after several rejects): a precise "week strip" where each day is drawn in the same
  visual vocabulary as the plan/calendar tiles — RUNS render as effort silhouettes (easy = low
  mound, long = wide sustained plateau, tempo = cruise plateaus, intervals = spiky ridges; built
  with the SAME silhouette construction as LivingPlan's WorkoutSilhouette), strength = double
  chevron (S3), rest = crescent (R1). Days sit on a shared baseline for precision; quiet header
  ("THIS WEEK" + phase); today = soft teal highlight + accent letter. Generate silhouettes with
  the real algorithm so the strip matches the calendar exactly. Rejected on the way: effort-curve
  with nodes, per-day flames/gauges/capsules ("too similar"), ridgeline/ECG/heat-cells ("lacks
  quality/precision"), generic dots/glyphs. **Don't duplicate the race** on Start — it already
  lives top-right (hero); the strip carries the WEEK's shape, not the next race.
- 2026-07-10 — **A redundant card gets FOLDED into the analytical surface, not left to duplicate.**
  Marathon Coach was a standalone card on Start that "delivers very little on what/why." Instead of
  keeping it, its whole read (verdict pill, this-week targets, days-to-race, feasibility, why) was
  folded into the EdgeIQ Training Profile (RecipePath) — one place that carries current→goal build
  state AND the coach's prescription. Retire the duplicate (SeasonCoachCard now unused) rather than
  show the same coach voice twice.
- 2026-07-10 — **A "wire-into-finish" graphic must FAN, not cluster.** The training-profile finish
  graphic looked "misaligned/unproportionate/missing info" because connectors all converged near
  the ring center and the node stack wasn't centered. Fix pattern: center the node stack vertically,
  center the ring, and land each connector on a DISTINCT point of the ring's left arc (spread ~205°→
  155°) so the edges fan evenly. Also: "missing information" was partly no goal set → no targets/weak
  link; fold in the coach so the race goal populates targets, and keep a complete-looking current-only
  state when there's genuinely no goal.
- 2026-07-10 — **A "living plan" summary on a surface must ADD, not duplicate.** Mobile home
  already had This Week (actual volume) + Marathon Coach (verdict/targets/feasibility). The plan
  strip earns its place only by showing what neither does: the week's SHAPE (7 day-glyphs) + the
  next KEY session, tapping through to the full plan. Read the APPLIED planner week
  (`summarizePlanWeek`) so a summary stays in sync with the calendar — never re-generate a plan
  just to display it (that can diverge from what's on the calendar).
- 2026-07-10 — **Don't relocate a surface the user likes; relocation ≠ revamp.** Emil vetoed a
  straight "move the living plan to the web Plan tab" — he likes it on Calendar. Moving a
  well-placed surface is only worth it as a genuine revamp where it becomes the *centerpiece* of
  the destination, not a lift-and-shift. When a "move" is really an IA revamp, scope + mock it as
  its own piece; don't half-do it. (Backlog #39.)
- 2026-07-09 — **Don't fill width by stretching a control; COMPARTMENTALIZE it.** Emil rejected
  a fix that made selects/inputs/chips `width:100%` / `flex:1` to kill right-side dead space:
  "Don't stretch, organize by quadrants… Compartmentalize the display do not stretch it." The
  right pattern for a settings/Adjust panel: group related controls into bordered **quadrant
  cards** (each with a small uppercase heading) laid out in a `repeat(auto-fit, minmax(300px,1fr))`
  grid; controls inside sit at their **natural** size. The grid fills the panel; the controls
  don't distort. Applied to LivingPlan Adjust → Goal / Schedule / Day preferences / Health cards,
  with Regenerate + paces in a footer row. (Stretching a lone dropdown to half a panel width = a
  design smell, same family as the "3-number tile with black space".)
