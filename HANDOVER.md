# Arnold — Handover / Session State

> **Purpose:** canonical "where we are" doc so any new Cowork window can resume in one step.
> If a window crashes, open a new one, connect the `Arnold` folder, and say:
> **"Resume Arnold from HANDOVER.md"**
>
> Keep this file current at checkpoints. It is tracked by git, so it rides along
> with your normal `git push` — your manual backup is also the state backup.

---

## Last updated
2026-06-01 — Intelligence Hub stage 1 (attribution + real-zones engine)

## Commit status
- GitHub backup is **manual**. Daily Google Drive snapshot task `arnold-drive-backup` (9 PM).
- The big run-coaching batch + design docs were pushed at end of 2026-05-31 (per user).
- **Uncommitted since then (2026-06-01) — push these:**
  - `arnold-app/src/core/attribution.js` (NEW — Intelligence Hub stage 1)
  - `arnold-app/src/core/zones.js` (NEW — zone resolver + lab-test anchor/decay)
  - `arnold-app/src/core/zonesDebug.js` (NEW — window.zonesDebug)
  - `arnold-app/src/Arnold.jsx` (3 side-effect imports for the above)
  - `arnold-app/docs/INTELLIGENCE_HUB.md`, `docs/COACHING_TEAM.md`, `docs/PLAN_GENERATOR.md` (design — deepened: arbiter/calibration/knowledge-base + viz stack + session-type expectations + lab-anchor)
  - `HANDOVER.md`
- **Older uncommitted list (verify these went up in the 05-31 push; if not, include):**
  - `HANDOVER.md`, `CLAUDE.md` (handover protocol)
  - `arnold-app/src/Arnold.jsx` (EdgeIQ hero rail — new driver tiles + sparklines + Action column fix; **Nutrition 3rd tile is now "Glycogen"** (Coach signal `computeGlycogenEstimate`, status replete/moderate/depleted/critical + carbs-supplied/need sub). History: Balance → Carbs left → Glycogen. Web only.)
  - `arnold-app/src/core/goals.js` (weekly run target default 20→30; + `intermittentFastingOverride` goal)
  - `arnold-app/src/components/MobileHome.jsx` (weekly target fallback 50→30)
  - `arnold-app/src/components/PlannedWorkoutTile.jsx` (weekly goal now from `getGoals()`, +import)
  - `arnold-app/src/core/intelligence.js` (IF fasted-morning fallback at the coachSignals orchestrator, +import)
  - `arnold-app/src/core/intermittentFasting.js` (IF override + race-day exception + debug)
  - `arnold-app/src/core/coachSignals.js` (surface `ifFastedFallback` flag in output)
  - `arnold-app/src/components/CoachComment.jsx` (Play wrap-up bug: mobility no longer skipped; "Tomorrow" now derived from daysOut — see POSTMORTEMS 2026-05-31)
  - `arnold-app/POSTMORTEMS.md` (new entry)
  - `arnold-app/src/core/derive/tileMetrics.js` (NEW `predictRaceFinish` + `isPureRunningRace` — per-race finish prediction, any distance)
  - `arnold-app/src/components/CalendarTab.jsx` (race-day drawer shows predicted finish; + plan distance field; long-run >10mi; expected time)
  - `arnold-app/src/components/PredictedBandsCard.jsx` ("Expected" header one-row fix)
  - `arnold-app/src/components/PlannedWorkoutTile.jsx` (expected-vs-achieved effort chips + easy-pace trend; export plannedMinutes; history-derived pace)
  - `arnold-app/src/core/healthSystems.js` (asymmetric trajectory penalty +15/−8)
  - `arnold-app/src/components/GoalsHub.jsx` (Training targets tile; per-race predicted finish; layout)
  - `arnold-app/src/components/CloudSyncPanel.jsx` (Garmin 2FA self-flip banner)
  - `arnold-app/docs/HEALTH_SYSTEM_SCORING_V2.md` (resolved trajectory-penalty open question)
  - `arnold-app/src/components/GoalsHub.jsx` (NEW "Training targets" tile — weekly miles/strength/other/hours + auto annual projection)
  - `arnold-app/src/core/goals.js` (registered `weeklyOtherSessionsTarget` so it round-trips)
  - `arnold-app/src/components/CalendarTab.jsx` (long-run auto-classify threshold 13→10 mi, `LONG_RUN_MIN_MI`)
  - `arnold-app/src/components/PlannedWorkoutTile.jsx` (easy-run pace clarification — net no behavior change; comment only)
  - `arnold-app/src/components/MobileHome.jsx` (Start "Annual Goals" timeline now a PROJECTION: target = to-date + weekly-target × weeks-left; labelled "proj")
  - `arnold-app/src/components/CalendarTab.jsx` (expected distance + time on planned runs; imports plannedMinutes)
  - `arnold-app/src/components/PlannedWorkoutTile.jsx` (EXPORT plannedMinutes — also has the easy-pace comment change)

## Annual goals projection (Phase 4r.goals.annualproj — shipped this session)
- Mobile Start "Annual Goals" (AnnualTimeline): the denominator is now a live projection, not a static goal. `annualRunMiGoal = totalMi + weeklyRunDistanceTarget × weeksLeft`; `annualWorkoutsGoal = totalSessions + weeklyWorkoutsTarget × weeksLeft`. Raising weekly targets in the Training Targets tile raises the projected year-end total. Workouts/wk = derived runs (weeklyMi/5, floor 3) + strength + other (excl. mobility, per user). Labelled "/ N proj".
- **Still static (follow-up if wanted):** the separate "Annual Progress" detail section (~MobileHome L4380) and desktop annual readouts still use `G.annualRunDistanceTarget || 800`. User only referenced the Start timeline; left others unchanged.

## Active task / next (run-coaching thread — prioritized)
Plan the user approved, in order. STOP after the 2FA banner.
1. [x] **Weekly training targets panel** — `TrainingTargetsTile` in GoalsHub. Edits flat cadence keys (weeklyRunDistanceTarget / weeklyStrengthTarget / weeklyOtherSessionsTarget / weeklyTimeTargetHrs) via getGoals/setGoals; shows annual target pro-rated for weeks left in calendar year. Full-width band between top/bottom Goals rows. **This also fixes the "no editable weekly-miles field after Plan redesign" gap** — v2 schema (body/recovery/performance/races) never included cadence keys.
2. [x] **Easy-run pace — show but don't grade** (clarified with user). Easy/long runs DO still show a suggested pace chip pre-run (`PlannedWorkoutTile.jsx` `targetPace`, race-pace +75s/+60s — RESTORED after an initial over-removal). It's informational only: the achieved-pace chip post-run already carries no status color (line ~1814, no `color` prop), so easy pace is never graded good/bad. The "improving / not improving" trend grade the user wants is folded into #17. (Note: `target.paceTarget` ~L2331 + `PreHeroPanel` are dead code — never set/rendered.)
3. [x] **Auto-recognize long runs (>10 mi)** — `CalendarTab.jsx` `activityFamily()` threshold lowered 13→`LONG_RUN_MIN_MI` (=10), classifies run as long_run when `mi > 10`. New named constant at top of file.
4. [x] **Expected time per run on calendar** — `CalendarTab.jsx` DayDrawer appends expected distance + predicted duration to the "Planned:" line for EASY/LONG runs only ("Planned: Easy run · 6 mi · ~52 min"). Duration via `plannedMinutes()` — EXPORTED from `PlannedWorkoutTile.jsx`, imported into CalendarTab. No circular import.
   - **Intervals/tempo/HIIT: NO predicted time** (per user — time isn't the goal for quality work; only distance shows if present). Gated via `TIMED_RUN_TYPES = {easy_run, long_run}`.
   - **Render fix:** reverted the PredictedBandsCard `planLabel` enrichment — it collided with the card's appended weather temp and rendered "~2016°C" (the "~20 min" + "16°C" mashup). Card header is back to clean "MOBILITY · 16°C"; predicted time lives only on the drawer "Planned:" line now.
   - **Horizon:** drawer shows the selected day, so clicking tomorrow shows tomorrow's time — satisfies "as long as it shows tomorrow." No multi-day grid render (not wanted).
   - **ROOT CAUSE of "no time shows" (user was right):** the `+ Plan` flow (`PlanPickerModal`) only stored a `type` — there was NO distance input anywhere, so planned runs had no `distanceMi` for `plannedMinutes` to use. Fixed: added an optional distance (mi) field to PlanPickerModal that appears when a run type is staged; `onPick(type, distanceMi)` now persists `distanceMi` on the planner day entry. Non-run types still commit on tap. (The "8.3mi" numbers on tiles were COMPLETED activities, not planned.)
   - **Follow-on benefit:** planned miles can now feed weekly/annual projections too (not yet wired — note for later).
   - **Data-driven pace (per user):** `plannedMinutes` now derives pace from the user's OWN recent logged runs (`historicalPaceSecs()` — median secs/mi per run type over 90d, ≥3 samples), NOT the configured targetRacePace. Falls back to targetRacePace + per-type offset only when history is thin. IMPORTANT: this is unrelated to the broken race-finish predictor (#18) — it's a median of actual runs, no fitness extrapolation. Long-run bucket uses >10mi to match CalendarTab.
5. [x] **Expected vs achieved effort** — `PlannedWorkoutTile.jsx` completed-state `effortCompare`: (1) duration vs plan ("48/52 min vs plan", informational, not graded); (2) **easy-pace trend** — compares today's pace-per-HR (efficiency) vs median of recent easy/steady runs (60d, ≥3mi, ≥3 samples): faster-at-same-HR by ≥3% = "↑ improving" (teal), ≥3% slower = "↑ effort" (amber), else "steady" (neutral). NEVER pass/fail — easy pace shown, not graded good/bad (per user). Rendered as lead chips in the post-workout quality row.
6. [x] **Race prediction** — DIAGNOSIS: not actually broken. Validated against real data: anchor = user's RBC Brooklyn Half (May 16, 13.3mi/1:50:42, avgHR 153 = 97% of Garmin LT 158 → legit race effort). Model predicts 1:49:02 vs actual **1:50:40** = ~1.4% fast = bullseye. The "failed miserably" memory was the OLD Garmin VO2max path, already replaced by empirical-first Riegel (Phase 4r.race.1). NO accuracy change made.
   - **Built (the real ask): per-race predicted finish for ALL races.** New `predictRaceFinish(race, activities)` + `isPureRunningRace()` in `tileMetrics.js` — Riegel from the empirical anchor to ANY race distance (not just 4 standard fields). Guards out hyrox/tri/other (run-pace projection meaningless there).
   - Surfaced in TWO places: (1) Plan-tab **Races list** (`GoalsHub.jsx`) — now a dedicated **column** (between date and days-out) showing "⏱ H:MM:SS" for runnable races, "—" for hyrox/tri/other so the table aligns. Race row uses its own 6-col grid (not shared `styles.row`). (2) **Calendar drawer** race line (`CalendarTab.jsx`). Both recompute live. No circular import.
   - NOTE: renders for runnable races. HYROX/tri show "—" by design.
   - **BUG FIXED (web showed "—" for ALL races incl. marathons):** catalog races (Berlin/Valencia/NYC/NYRR etc.) carry `distanceMi` but NO `type`, so they save as `type:'other'`. Original `isPureRunningRace` excluded 'other' → every catalog race gated out. Fixed: only `hyrox/tri/swim/bike` are hard-excluded; `'other'`/missing now falls back to the distance check (≥3km → predict). So catalog marathons/10K now predict; HYROX still "—".
7. [x] **HS trajectory penalty** — `healthSystems.js` (`weightVsTarget` + `bodyFatVsTarget`): trajectory now ASYMMETRIC — reward toward target +15, penalize away −8 (gentler downside because base drift ramp already captures wrong-way movement; avoids double-count + BIA noise). Resolved the open question in HEALTH_SYSTEM_SCORING_V2.md.
8. [x] **Garmin 2FA self-flip banner** — `CloudSyncPanel.jsx`: when `meta.lastError` matches the self-flip signature (ticket_not_found / 401 / unauthorized / mfa / 2fa), shows a red banner with recovery steps (connect.garmin.com → Security → disable 2-Step → Edit credentials → re-enter password). Banner names the URL as text only (no auto-navigation, per link-safety). **← thread STOP reached.**

## Current focus
Just shipped: three new driver tiles in the **web EdgeIQ hero rail** (`Arnold.jsx`, tag `Phase 4r.edgeiq.2`).
Each domain driver column now has 3 tiles (was 2), matching the 3 domain scores; driver columns bumped `flexWeight` 2 → 3.
- **Activity → "Weekly load"** = `acwrToday.acuteLoad` (7-day rTSS); sub `vs {chronicLoad} avg`; neutral color (`type='load'`).
- **Nutrition → "Balance"** = today's `dailyEnergyBalance(today).balance` (intake − TDEE); shown only once intake is logged; green=deficit / amber=surplus (`type='balance'`).
- **Body → "Weight"** = latest `weightLbs` + 7-day sparkline; sub `{±delta} vs {targetWt}`; neutral color (`type='weight'`).
Edits: import `dailyEnergyBalance`; 3 new `statusFor` types; a compute block before `Sep`; one `<MiniStat>` per driver column.
**Not yet build-verified** — VM was down, so no `npm run build`/eslint run. User should build from Windows terminal and eyeball the rail (watch for wrap on narrow widths — row uses `flexWrap`).

### Follow-up fixes (same session, tag `Phase 4r.edgeiq.3`)
Two issues from the user's screenshot of the first version:
- **Sparklines on every driver tile.** Added 7-day series (oldest→newest) for ACWR, rTSS, Weekly load, Cal left, Protein left, Balance, and passed each as `history=`. (HRV/Sleep/Weight already had them.) New series built in the compute block via `computeAcuteChronicRatio`, `computeHrTSS`, `nutDailyTotals` + `getDerivedTargets`, and `dailyEnergyBalance`.
- **"Today" ✓ was squashing.** Root cause: bumping the driver columns to `flexWeight` 3 shrank the Action column's width share. Fix: kept the Action column on a single row and widened it to `flexWeight` 3 (matching the driver columns) so "Long run ✓" fits inline. (An earlier attempt stacked Today above Race vertically — reverted: it left dead vertical space. The `vertical` prop on `RailColumn` remains available but unused.)

## Current focus / next
Confirm the rail renders correctly after a build (still **not build-verified** — VM down). Watch: stacked Action column will sit taller than the single-row tiles (expected); sparse-data tiles like rTSS only draw a line when ≥2 days have data. Then back to the backlog below.

## Environment gotchas (read before running anything)
- **Sandbox / Linux VM is currently down** ("VM service not running"). So from inside Cowork I **cannot** run `npm run build`, `npx cap sync`, or `git` reliably.
- File edits (Read/Write/Edit) work fine regardless of the sandbox.
- **Build & deploy to phone is done from the Windows terminal**, not from here:
  ```
  cd C:\Users\Superuser\Arnold\arnold-app
  npm run build
  npx cap sync android
  npx cap run android
  ```
- **git push is done by the user from the Windows terminal** (sandbox mount can be stale and silently skip edited files).

## Active task
_None in progress._ Next step is to pick a backlog item below.
Suggested starting point: **Cut/IF follow-ups** — best-scoped, builds on last session, mostly source edits.

---

## Backlog (parked items from prior sessions)

Sourced from `arnold-app/COACH.md`, `arnold-app/RACES.md`, and
`arnold-app/docs/HEALTH_SYSTEM_SCORING_V2.md` ("deferred" / "parking lot" sections).

### Cut / IF follow-ups (HS Scoring v2 doc)
- [x] **Fasted-morning fallback** — done at the orchestrator (`intelligence.js`), not in the pure `coachSignals.js`. When `intake < 200 && isInFastingWindow()`, substitutes `rollingIntakeForIF(3)` for `todayIntakeKcal`/`todayCarbsG` → fixes `energyAvailability` false RED-S. Flag `ifFastedFallback` surfaced in coachSignals output. NOTE: only `energyAvailability` consumes single-day intake; `glycogen` uses a 24h carb window (incl. last night) and `tdeeDrift` uses 4-week snapshots, so neither suffers the single-day fasted crash — EA was the real offender. Carbs fallback also feeds prefuel.
- [x] **Manual IF override** — added `intermittentFastingOverride` goal (`goals.js`, 'auto'|'on'|'off', string field in Goals Hub). `intermittentFasting.js` `getIFProfile()` applies it at read time (immediate, no 24h cache wait). `window.ifDebug()` shows it.
- [x] **Race-day exception** — `isRaceDayToday()` (reads `storage.get('races')`); `isInFastingWindow()` returns false on race days so early race-morning intake isn't treated as fasting.
- [x] HS trajectory penalty — DONE (asymmetric +15/−8). See "Active task / next" #7.
- [x] Garmin 2FA self-flip banner — DONE. See "Active task / next" #8.

### Coach signal ideas (COACH.md — v2 still deferred)
- [ ] Z-aware recovery velocity (split by session type; needs ~6mo data).
- [ ] Bedtime variance — sleep-onset SD over 14 days (circadian stability).
- [ ] Strain-monotony interaction detector ("monotonous AND high").

### Coach voice / bigger builds (COACH.md)
- [ ] v2 trade-off templates (coach-voice trade-off patterns).
- [ ] **v2.6 Narrative integration** (marked "locked", largest effort) — narrative layer between signals and UI; Coach tab tells a story vs N cards. Signals already declare `narrativeThreads` / `causalUpstream` / `causalDownstream`.
- [ ] v3 dialogue scaffolding (question taxonomy → rule-based tree → LLM).

### New data sources (COACH.md — still deferred)
- [ ] Garmin Body Battery tile (data already in storage as `bodyBatteryChange`).
- [ ] Garmin training status (productive/overreaching/detraining — new endpoint needed).
- [ ] Respiration-rate sleep-stress signal; overnight SpO2; Cronometer micronutrients → low-energy diagnostic.

### Race-aware patterns (RACES.md — for Dec sub-3:30 marathon)
- [ ] `patternMarathonMileageBuild`, `patternMarathonPaceWork`, `patternMarathonTaper`.
- [ ] Build out `src/core/raceFormats.js` (race specs currently only in the doc).

### Race predictor — follow-ups (added 2026-06-01 from user feedback)
- [x] **HYROX predicting on pure distance — FIXED.** Catalog HYROX has `distanceMi:4.97` + `tags:['hyrox']` but no `type`, so it fell through to the distance check. `isPureRunningRace` now excludes by tag (hyrox/spartan/obstacle/tri/...) AND name regex. HYROX → "—".
- [x] **Missing 1-mile prediction — FIXED.** Distance floor was 3 km, dropped the 5th Ave Mile (~1.6 km). Lowered to 1 km. (Anchor SOURCE still needs ≥3 mi — separate.)
- [x] **Marathon model — REPLACED crude penalty with a real endurance model** (user rejected the additive +30/+20% as "the other extreme, no intelligence" — correct). New `fatigueExponent(activities, {anchorKm, targetKm})` in tileMetrics.js. The exponent k in `T=T1×(D2/D1)^k` IS the endurance model (Riegel's flat 1.06 only valid for short extrapolations → under-predicts long). Three tiers best-first: (1) **personal-fit** — regress ln(time)~ln(distance) over best effort per distance bucket (mile/5K/10K/long/half); slope = personal fatigue resistance; used if ≥3 buckets, R²≥0.95, k∈[1.0,1.25]. (2) **durability-adjusted** — distance-aware baseline nudged ±0.04 by median long-run `aerobicDecoupling` (low drift=durable=lower k). (3) **distance-aware** baseline 1.06→1.18 as target/anchor ratio grows. `predictRaceFinish` returns `exponent`/`exponentSource`/`fit`. For user's 1:50 half: marathon now ~3:58–4:05 (was 3:47 raw / 5:00+ penalized). Old crude penalty fully removed.
- [ ] **Course profile modeling (user wants FULL modeling).** Predictor is course-blind — NY (hilly) vs Berlin/Valencia (flat) all show the same marathon time. User wants real elevation-based modeling. NEEDS: a course-elevation data source + per-race course data (not currently stored). Flat vs hilly ≈ 2-4 min at marathon distance. `predictRaceFinish` returns `courseModeled:false` as a marker. Scoped as its own (heavier) item.
- [ ] **Surface base-vs-penalized + readiness in UI.** `predictRaceFinish` now returns `baseSeconds`/`penaltyApplied`/`readiness`; the Races table + calendar drawer still show only `seconds`. Could add a tooltip ("fitness-equivalent X; −Y% for distance readiness").

### 🔨 Intelligence Hub — Stage 1 SHIPPED + REFINED (2026-06-01): Attribution Engine v1
`arnold-app/src/core/attribution.js` (NEW) + `src/core/zones.js` (NEW) + `src/core/zonesDebug.js` (NEW), all side-effect imported in Arnold.jsx. Console: `window.attributionDebug()`, `window.zonesDebug()`, `window.zonesResolved()`, `window.setLabTest({...})`.
- **`attributeOutcome()`** — the hub's "find the culprit": cross-examines per-date confounders (sleep/HRV/RHR/fuel/heat/load) + classifies effort + (for easy runs) within-run zone discipline. Returns `{verdict, effort, zoneDiscipline, culprits[], summary}`. Pure, read-only, defensive.
- **Effort gate fixed (2 bugs):** (1) race-pace expectation only applies to HARD efforts — easy runs no longer get bogus "underperformed". (2) effort classified against REAL zones via `resolveZones`/`classifyEffort` (NOT %HRmax, NOT the run's own peak HR — both caused false "race effort"). User real zones (Garmin custom): Z2 ceiling 136, LT2 162, maxHR 173, resting 46.
- **Within-run zone discipline (added per user):** avg HR hides drift — reads `hrZones` per-zone seconds. VALIDATED on real run: avg 135 (looked clean) but only 50% in Z1-2, 37min above Z2 → graded `grey-zone-creep`. Matches block-level zonesDebug (48% easy / 34% Z3). KEY TRAINING INSIGHT: Emil's easy runs drift to Z3 ~half the time — capping easy HR ≤136 is the highest-leverage change for Berlin sub-3:40. (Future refinement: cross-ref elevation/weather to distinguish hill-drift from ran-too-hard.)
- NOT build-verified — rebuild from Windows terminal. NEXT hub stage: #2 checkpoint grading (clean vs confounded → calibrate anchor or route to response model).

### ★★★ The Intelligence Hub — the reasoning core (NEW 2026-06-01 — THE FOUNDATION, build FIRST)
Full design doc: `arnold-app/docs/INTELLIGENCE_HUB.md`. **Reframe (user): the hub is the centerpiece, NOT the Plan Generator.** Dependency order is now Intelligence Hub → Coaching Team (its voice) → Plan Generator (an application). "If the hub works we can throw anything at it." Core principles:
- **Every data point is valuable; interpretation is conditional.** No "bad data" — route each point to a Fitness ledger (clean reads only) and/or a Response ledger (always). A hot/under-slept/under-fueled race = weak fitness checkpoint BUT great heat/sleep/fuel-response data.
- **Confound attribution ("find the culprit")** — when an outcome diverges, diagnose WHY (weather/sleep/fuel/HRV/load/travel) before judging. The signature capability — coach vs calculator.
- **Checkpoint validity grading** — races graded clean vs confounded; clean → calibrate + anchor; confounded → response ledger w/ culprit named. Shown to user with reason, never silent.
- **Missing data is signal, never breaks the model** — robust to skipped sessions/races; reads the gap (adherence, chronotype, motivation); never shames.
- **Mental state first-class** alongside physiology (motivation, adherence, mood, perceived effort).
- **Recency-weighted** everything (generalizes the race-anchor fade; hard cutoffs → decay weights).
- Hub maintains living models: fitness / response / readiness / adherence-mental / confidence-on-everything.
- Build stages (hub-first): (1) attribution engine v1, (2) checkpoint grading, (3) response model, (4) adherence/mental model, (5) confidence layer, (6) recency-decay refactor → THEN Coaching Team + Plan Generator on top.

### Design deepened 2026-06-01 (three interaction problems — now substantive, not sketches)
- **Arbiter conflict-resolution** (COACHING_TEAM.md "Arbiter — conflict resolution model"): experts emit structured recommendations {action, urgency, confidence, protects, costs, flexibility}; resolution is PHASE-PRIORITIZED (base/build/peak/race-week/recovery each load a different priority vector — same conflict resolves opposite ways by phase); algorithm = hard-constraint gates (safety/ACWR/injury/fixed-constraints) → score → seek non-conflicting compromise via flexibility FIRST → phase vector breaks true trade-offs → emit one plan + the surfaced trade-off. Worked base-phase example included.
- **Calibration math** (INTELLIGENCE_HUB.md "Calibration math"): Bayesian precision-weighted update (estimate + confidence); obsPrecision scaled by cleanliness/effort/distance-proximity/recency so one race informs not overwrites; recency half-life decay (generalizes anchor fade); residual partitioned by attribution → feeds response model; sanity clamps + confidence floor on assertiveness.
- **Knowledge base** (COACHING_TEAM.md "Representation"): curated structured principle store (NOT freetext-to-LLM, NOT hardcoded rules) — each principle {coach, source, claim, prescribes(machine-usable), benefits, costs, conflictsWith, strength}; experts retrieve by domain+phase+conditions and apply to athlete's own numbers; conflicts surfaced not hidden; athlete's own validated responses become personal overriding principles.

### ★★ The Coaching Team — panel of experts, one voice (NEW 2026-06-01 — the VOICE of the hub)
Full design doc: `arnold-app/docs/COACHING_TEAM.md`. This is the soul of Arnold and the top of the architecture. Run/strength/mobility/nutrition/logistics "coaches" reason over Arnold's metrics, an arbiter (= the v2.6 narrative composer, generalized) resolves their conflicts against the race goal, and the athlete hears ONE voice — advised & guided, ALWAYS in control (advisory only, never auto-mutate).
- 3 layers: domain experts → arbiter (head coach) → one voice (+ "ask a coach" drill-down). Knowledge base encodes leading coaches' methodologies (Daniels/Pfitzinger/Lydiard/Seiler/Canova/...) with attribution.
- Differentiator: reasons over the richest per-athlete dataset (fatigue exponent, LTHR, ACWR, HS, cut mode, glycogen, IF, durability) refreshed daily.
- Build order (years of runway): (1) v2.6 narrative layer FIRST [COACH.md], (2) Plan Generator stages 1-2, (3) run+nutrition experts + arbiter on ONE decision type, (4) add strength/mobility/logistics, (5) knowledge base, (6) conversational "ask a coach" [v3].
- Non-negotiables: advisory only; everything explainable (signal + principle + trade-off); one voice, specialists on demand; athlete's own data first.

### ★ Plan Generator — reverse-periodized training plans (NEW 2026-06-01 — feeds the Coaching Team)
Full design doc: `arnold-app/docs/PLAN_GENERATOR.md`. This is where the Coach evolves from signals → actual programming (Coach v3). Everything else built (fatigue exponent, readiness/ACWR, HS, cut mode, LTHR) are its INPUTS.
- Concept: given target race + goal time, work BACKWARD to a week-by-week prescription (mileage, easy/tempo/speed split, long-run progression, strength), calibrated to current state + weeks left. A sharpening/gap-closing engine, not couch-to-marathon.
- **First target: Berlin, sub-3:40** (Emil PR 3:47 ×2 last yr, base built, build starts post-HYROX ~mid-June). Goal pace 8:23/mi; design to a ceiling above it so it "feels easy." Then NY (needs course modeling), then Valencia (flat PR).
- Build in STAGES (see doc): (1) assessment read-out + feasibility verdict, (2) static Berlin plan written to planner, (3) adaptive weekly replan, (4) course modeling for NY, (5) generalize.
- [ ] **BLOCKER before stage 2:** collect Emil's available training days/week + non-negotiable strength sessions; confirm exact sub-3:40 + Berlin date.
- [ ] Course-elevation data source (shared dependency with race-predictor course modeling).

### Data ownership / metrics independence (NEW — added 2026-06-01 from user)
Goal: Arnold owns its metrics & data; no reliance on Garmin/3rd-party computed values.
### Zones + thresholds (SHIPPED 2026-06-01 — `src/core/zones.js`)
Single source of truth for HR zones. `resolveZones()` picks best available: **lab/field test → Garmin custom → Karvonen/HRR → %HRmax**. `classifyEffort(avgHR, zones)` → easy/tempo/hard (the attribution engine now uses THIS for the effort gate, not %HRmax — fixed the "140 = race effort" bug; user's REAL data: maxHR 173, resting 46, Karvonen & Garmin AGREE Z2 = 123–136, so 140 is Z3). Zones built around two thresholds: **LT1 = top of easy/Z2**, **LT2 = lactate threshold (≈LTHR)**.
- **Lab-test anchor + transition (user requirement):** `setLabThresholds({lt1Hr,lt2Hr,testedAt,...})` (console `window.setLabTest(...)`). A test enters at full confidence and DECAYS on a half-life (`LAB_HALF_LIFE_DAYS=75`, `labConfidence()`); `resolveZones` BLENDS the test with derived (Karvonen) zones by that confidence — so it transitions "trust the test → trust derived" automatically as it ages; a fresh test resets the clock. (Answers "how long is a lab test good for": HR anchors ~3mo stable / 6-10wk in a build; pace anchors stale faster — so decay not cutoff.) Console: `window.zonesResolved()`. User getting a lab test in ~30 days → enter via setLabTest.
- **80/20 finding:** user only ~48% easy (Z1-2), 34% Z3 (30d) — grey-zone drift; tightening easy-run discipline (hold ≤~136) is high-leverage for Berlin sub-3:40.

### Data ownership / metrics independence (NEW — added 2026-06-01 from user)
Goal: Arnold owns its metrics & data; no reliance on Garmin/3rd-party computed values.
- [ ] **Arnold-native threshold calculator — LT1 AND LT2 (expanded from LTHR).** Derive BOTH thresholds from user's own data so zones don't depend on a lab/Garmin. **LT2 (≈LTHR):** race-anchored (10K≈100-102% LTHR, HM≈96-98%, M≈88-92%) + per-run avgHR — converges ~158 for user. **LT1 (top of easy/Z2 — the boundary that governs the 80/20 question):** HR-pace decoupling/deflection analysis on runs; rough proxy Maffetone 180−age. Feed both into `resolveZones` as a derived source (and as the blend partner for an aging lab test). Recompute on rolling 8-12wk window. NOTE: decoupling-deflection + sustained-effort methods want HR STREAMS (not currently stored — activities have avgHR/maxHR/hrZones only). Per-run `aerobicDecoupling` IS stored and usable now as a partial signal.
- [ ] **Data retention / ownership policy.** Findings: data is in browser localStorage + IndexedDB engine (`arnold:*`), **kept forever, never purged** (no TTL/prune anywhere; only `events` log caps at 200). Risk: localStorage ~5-10MB quota ceiling, no quota-handling code → silent write failure possible as data grows. Recommendation: NO deletion of summaries (the history IS the value); tier raw HR streams if added (keep recent raw, downsample old); add one-click full export for true portability/ownership; handle quota gracefully.

### Run / training coaching cluster (added 2026-05-31 — MOSTLY SHIPPED)
- [x] **Expected time per run on calendar** — DONE (easy/long only; needs planned distance). See "Active task" #4.
- [x] **Expected vs achieved effort** — DONE (duration vs plan + easy-pace trend). See #5.
- [x] **Fine-tune race prediction** — DONE: was accurate; built per-race predictions instead. See #6.
- [x] **No pace target on easy runs** — clarified: pace shown, not graded. See #2.
- [x] **Auto-recognize long runs (>10 mi)** — DONE. See #3.
- [ ] **Evolve into actual coaching strategies** — STILL OPEN. Turn run signals into prescriptive training guidance (larger/vague — needs scoping; overlaps Coach v2/v3).
- [ ] **Planned miles → weekly/annual projections** (follow-on from the +Plan distance field; not yet wired).

### Shipped this session (run target)
- [x] Weekly run distance target → **30 mi**: canonical default in `goals.js`; aligned scattered fallbacks (web 20→30, mobile 50→30, planned-tile hardcoded 25 → now reads `getGoals().weeklyRunDistanceTarget`).
  - **Caveat:** if a `weeklyRunDistanceTarget` value was previously saved in Goals (localStorage), that stored value overrides the new default — set it to 30 in Goals settings to be sure. (Can't read/write that localStorage from here.)

---

## Recently shipped (last session, for context)
- HS Scoring v2 (three-component blend: Outcome 50% / Coach 30% / Nutrition 20%).
- Cut Mode classifier (7 chronic states) + Plan-tab cut-aware Coach line + segmented override buttons in Goals.
- IF awareness (`detectIntermittentFasting()` from Cronometer meal timestamps).
- Prefuel signal (per-session carb adequacy).
- Mobile HS tile names wrap to two lines (zero-width space after slash, `minHeight: 28`, `MobileSystemTile` in `MobileHome.jsx`).

## How to update this file
At each checkpoint: refresh **Last updated**, **Commit status**, **Current focus**, and **Active task**;
tick backlog boxes as items ship; move shipped items into "Recently shipped".
