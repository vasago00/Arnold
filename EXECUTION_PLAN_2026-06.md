# Arnold — Uplift Plan (LIVING DOC · started 2026-06-10)

> The answer to "how do we improve, specifically?" — a sequenced, file-level plan that
> turns the audit's tiers into steps with acceptance criteria. Sequenced so each step
> unblocks the next and ships value on its own. No big-bang rewrites: we **strangle** the
> old code (introduce the new layer alongside, migrate screen by screen, build after each
> step). Working rules from DESIGN_DECISIONS.md apply: smallest change, one source of
> truth, verify don't claim.
>
> **THIS IS A LIVING DOC.** Update the Status Board + Progress Log every time a step moves.
> Companion docs: `PRODUCT_AUDIT_2026-06.md` (the why) · `HANDOVER.md` (rolling state) ·
> `DESIGN_DECISIONS.md` (law).

## Status board
Legend: ☐ not started · ◐ in progress · ☑ code done (not yet build-verified) · ✅ build-verified by Emil

| Step | Item | Status | Build-verified |
|---|---|---|---|
| 0.1 | One theme/token source of truth | ✅ | category + status colors verified (53 tests green + builds) |
| 0.2 | Shared UI primitives (`<Tile>`/`<Card>`/`<MetricValue>`…) | ◐ | **Re-scoped after investigation (2026-06-12).** shared MetricTile ✓ + mobile on it ✓. WEB-tile migration = MOOT: web has NO MetricTile duplicate — its metric tiles are `KRITile`/`InlineKRIStat` (richer: 8-wk sparkline + YTD; different surface/purpose), not a bespoke copy, so there's nothing to unify + no warm-gray→opacity shift there. Dead `MetricTileLegacy`+`MiniArcGauge` in MobileHome = **REMOVED (ROUND 60)** — AST+esbuild verified. REMAINING (Emil's call): `<Card>`/`<SectionHeader>` primitive + migrate `PlannedWorkoutTile` (warm-gray, Emil chose KEEP via param) — but that's the audit's churn-epicenter card (~13 redesign rounds); audit counsels against re-opening it. |
| 0.3 | Collapse duplicated maps (signatures/classifier/types) | ✅ | signatures/types/classifier all migrated + build-verified |
| 0.4 | Seed Vitest test net | ✅ | now 8 suites / 53 tests green |
| 0.5 | Decompose `Arnold.jsx` monolith | ✅ | DONE (ROUNDS 38–59, Emil-greenlit, ~21 slices). Arnold.jsx **11.8k → 2,206 lines**. Last two big live components extracted R58/R59: TrainingTab → `components/TrainingTab.jsx`, LogDay → `components/LogDay.jsx` (both build+test-verified). Only SEED data + the App shell / TABS / status maps remain in Arnold by design. R60 follow-ups all DONE: dead `MetricTileLegacy`+`MiniArcGauge` removed from MobileHome, and the dead `getUnifiedActivities`/`getLogFitActivities` delegates deleted (no callers left after extraction). |
| 1.1 | "What Arnold has learned about you" hero | ✅ | built + on Daily/Play · (LearnedHero on mobile Start intentionally NOT added — violates the "Start = action, analytics on EdgeIQ" design rule) |
| 1.2 | One Coach voice | ✅ | unified + morning-forward fix · build-verified |
| 2.1 | Adaptive plan (readiness → tomorrow) | ✅ | engine ✓ · pre-workout tile (eased vol + Z2 + reason) ✓ · battery/fatigueLevel limiter ✓ · weekly strip ⤵ marker via shared `todayAdaptation` ✓ · test+build verified |
| 2.2 | Fuel for the work required | ✅ | `core/fuelForWork.js` + 9 tests ✓ · CARB/PRO/EA chips ✓ · build-verified |
| 3.1 | Visual hierarchy pass | ✅ | desaturation comprehensive (all 3 health grids) + readiness verdict on both heroes · build-verified. (Mobile Signal Cockpit values intentionally left — color encodes goal-progress there) |
| 3.2 | True web/mobile parity | ◐ | core delivered: `readinessVerdict` + `healthStatusColor` + `healthFillTint` shared, HealthSystemTile JSX unified ✓ · **R63: Start post-workout card (PlannedWorkoutTile) parity — cycle/swim/ski/walk now flip to the post-workout summary like run/strength (added matchFamily cases + HR-based load fallback).** OPEN-ENDED: other duplicated surfaces could still be unified as found (diminishing returns) |

## Step 3.2 sub-checklist (parity in safe slices — each build-verifiable)
- ☑ `readinessVerdict(score)` shared (web Daily hero + mobile Play hero) — round (g).
- ☑ `healthStatusColor(status)` shared (web tile/detail + both grids' header dots + mobile) — no-visual extraction.
- ☑ `healthFillTint(status, base)` shared across all 3 tiles (web/mobile/nutrition) — base alpha param reproduces each
  surface's exact tint (web/nutrition 0.15, mobile 0.12; def +0.03). No-visual; +tests.
- ☑ HealthSystemTile JSX unified → `components/HealthSystemTile.jsx` `HealthTileBase` with a `VARIANTS` config
  (web/mobile/nutrition). Three surfaces now render through it via thin wrappers that resolve their own icon maps +
  active/click props. Every per-surface value (icon size, name wrap/size/weight/color, value color #eaeaea vs #fff,
  tint base, accent line, comment, clickability) preserved exactly → no-visual. Mobile tiles also gain keyboard a11y
  (role=button + Enter/Space) as a side benefit. **Build-verify all 3 grids look identical.**

## Step 0.1 sub-checklist
- ☑ Create `src/theme/tokens.js` (CATEGORY / STATUS / BRAND + SPACE/RADIUS/TYPE).
- ☑ `PlannedWorkoutTile.FAMILY_COLOR` → `CATEGORY.*` (values unchanged).
- ☑ `planner.DAY_TYPES` → `CATEGORY.*` (values unchanged).
- ☑ `CalendarTab.PlanPickerModal.OPTIONS` → `CATEGORY.*` (unifies long_run/intervals/rest
  to canonical — intentional).
- ☑ `metricRegistry.COLOR` (STATUS role) → `tokens.STATUS` (added `hot` shade; values preserved).
- ✅ Build-verify (category colors) — Emil confirmed Daily/planner/calendar look unchanged.
- ☐ Build-verify (status colors) — confirm hero/card tier colors (good/warn/hot/over) unchanged after metricRegistry migration.

**0.1 is code-complete. All four color sources now read from `src/theme/tokens.js`.**

## Step 0.3 sub-checklist
- ☑ One signature map — new `core/activitySignatures.js` (`sigSrc`/`sigFile` + one `SIG_VERSION`).
  Migrated `PlannedWorkoutTile`, `WeeklyPlanner`, `CalendarTab` off their 3 local copies.
  Value-preserving (same images/version; CalendarTab's easy-run fallback kept via a thin wrapper).
- ☑ One classifier — the real dup was the ski/walk regexes (copied into CalendarTab, `_resolvePlanType`,
  coachSignals this session). Extracted `isSki`/`isWalk` into `activityClass.js`; all 3 now call them;
  added tests. (Ski regex unified to the broader variant — minor: more ski terms detected everywhere.)
  Sport detection elsewhere already used activityClass, so this was the remaining true duplication.
- ☑ One plannable-types list — `PlanPickerModal.OPTIONS` now derives from `planner.DAY_TYPES`
  (+ a local DESC map); removed the second hardcoded list. New disciplines auto-appear. Minor:
  picker order now follows DAY_TYPES and "Cross" reads "Cross-train".
- ☐ Build-verify: figures unchanged on Daily / planner week-strip / calendar tiles.

> **Sequencing note:** doing 0.3 (safe, value-preserving data dedup) before 0.2 (visual primitive
> merge) because the `MetricTile` consolidation needs a canonical text-scale decision (mobile uses
> white-opacity, the card uses warm-gray — they differ) + your eyes on a build, which I can't do
> from here. 0.2 resumes once there's a build loop and a quick call on the text scale.

## Step 0.2 sub-checklist
- ☑ `tokens.js` += `TEXT` (white-opacity) + `SURFACE` (card/border/track).
- ☑ Shared `src/components/ui/MetricTile.jsx` (token-styled; faithful to the mobile tile; bakes in
  "value neutral, color = status/trend").
- ☑ MobileHome migrated — `<MetricTile>` usages now resolve to the shared import; local copy renamed
  `MetricTileLegacy` (DEAD, removed next cycle after build-verify) + its `MiniArcGauge` also now dead.
- ☐ Build-verify: mobile Start metric tiles render identically.
- ☐ Remove the dead `MetricTileLegacy` + local `MiniArcGauge` from MobileHome.
- ☐ Migrate the WEB metric tile to the shared one (this shifts web text → white-opacity — verify).
- ☐ (later) `<Card>`/`<SectionHeader>` primitives + migrate PlannedWorkoutTile (its warm-gray → white-opacity).

## Progress log (newest first)
- **2026-06-13 (ae)** — **HC sync diagnostic + 0.5 slice 21.** (1) Health Connect "not syncing" (Emil): confirmed refactor
  didn't touch any HC path (imports/boot trigger/core hc-sync.js+hc-bridge.js all untouched). Real issue: HC fails SILENTLY
  — boot listener only toasted on success. Added a `sync:error` toast in the boot `onSyncEvent`. On-demand diagnostic
  already exists (CloudSyncPanel → HealthConnectStatusSection "Sync now" → shows permissionDenied+scopes/errors). HC syncs
  only sleep/weight/HR/dailyEnergy, native-only, 15-min. (2) Slice 21: `HealthSystemTile`+`HealthSystemsGrid` →
  `components/HealthSystemsGrid.jsx` (live); deleted dead `StartTilePickerSection` (grep-checked first); removed 4 orphaned
  imports. Arnold.jsx **6,540**. **Emil: build + Health Systems grid + HC "Sync now" diagnostic + `npm test`.**
- **2026-06-13 (ad)** — **0.5 slice 20: ImportHub cluster (IMPORT_ZONES + processImport + ImportHub, ~226 lines) removed
  from Arnold.jsx — found to be DEAD.** Started as an extraction; grep showed zero `<ImportHub>` render sites in src (dead/
  superseded by SyncPanel/DataSync). Treated as dead-code removal: body parked verbatim in `components/ImportHub.jsx` (NOT
  imported — recoverable if re-wired), no unused import added to Arnold. Arnold.jsx **6,627**. **Emil: build + `npm test`
  (functional no-op); decide keep-or-delete components/ImportHub.jsx.** Lesson: grep for the render site BEFORE extracting,
  not mid-way — would've flagged this as a delete from the start.
- **2026-06-13 (ac)** — **0.5 slice 19: Dashboard renamed + extracted as EdgeIQ → `components/EdgeIQ.jsx`** (~847 lines,
  biggest yet). Caught that "Dashboard" was a stale name — the function is the web EdgeIQ/Trend tab (tab==="weekly"); Emil
  asked to name it for what it is. ~30 deps all traced to existing modules + components; renamed on extraction; render call
  `<Dashboard>`→`<EdgeIQ>`. New-file-first, removed in verified chunks (byte-identical). One BOM-escape line left inert in a
  block comment (unmatchable, harmless). Arnold.jsx **6,850** (from ~11.8k at 0.5 start; ~5k lines now modularized out).
  **Emil: build + EdgeIQ tab (CockpitRail + KRI matrix + weekly CSV sync) + phone delegates to MobileEdgeIQ + `npm test`.**
- **2026-06-13 (ab)** — **0.5 slice 18: WebSystemDetail + SYSTEM_SIGNALS → `components/WebSystemDetail.jsx`** (~815 lines).
  Most entangled extraction yet but all deps resolved to existing modules (storage, dateUtils, healthTokens, goals,
  healthSystems, intelligence, dcyMath, sleepParser, activityClass) + sibling components BioactiveStack/CoachSigil; the
  local SYSTEM_SIGNALS map moved with it. `getUnifiedActivities()`→`allActivities()` the only body change. New-file-first,
  then removed from Arnold in 3 verified chunks (byte-identical). Arnold.jsx **7,689** (from ~11.8k at 0.5 start). **Emil:
  build + click a web Health System tile (inline Daily/Weekly/Annual panel) + `npm test`.** Pattern holds even for big,
  multi-dep components as long as every symbol is traced to its module first.
- **2026-06-13 (aa)** — **0.5 slice 17: ClinicalModule → `components/ClinicalModule.jsx`** (~660 lines — the biggest
  single extraction so far, done via tools). Clarified the workflow: Emil isn't a code-editor user, so "IDE cut-paste" is
  off — I make all file edits directly and Emil only runs build/test. Dep-trace came back clean (C/S/ai/buildFullPrompt +
  3 hooks; ScanPicker internal; one lazy pdfParser path fixed ./core→../core). Removed from Arnold in 3 verified chunks
  (all matched ⇒ byte-identical), new file rebuilt from the verified text. Arnold.jsx ~8,520. Labs+clinical feature now
  fully out of the monolith. **Emil: build + exercise the Core tab (sub-tabs, scan picker, PDF upload, AI analysis) +
  `npm test`.**
- **2026-06-13 (z)** — **AI_HDR bug fix + 0.5 slice 16: SessionVsUsual → `components/SessionVsUsual.jsx`.** Fixed the
  deferred `core/ai.js` bug (`aiStream` referenced an undefined `AI_HDR()` → streaming weekly-summary threw); now sends the
  same direct-browser Anthropic headers as the `ai()` fallback. Then did the first post-dead-code extraction: `SessionVsUsual`
  (~98 lines, the "today vs your usual <type>" comparison rendered by LogDay ×2). Fully importable — `allActivities`
  (dcyMath) + 5 activity classifiers; `divider`/`subHdr` are props; the local `getUnifiedActivities()` (a 1-line delegate)
  inlined to `allActivities()`. **Reproduction byte-identical** (removal Edit matched). Arnold.jsx ~9,180. **Emil: build
  (Daily-log session-comparison block + AI streaming) + `npm test`.** Pattern confirmed: small/mid presentational components
  whose deps are already in core/ are clean tool extractions; the remaining big stateful screens stay IDE territory.
- **2026-06-13 (y)** — **0.5 slices 10–15: DEAD-CODE DELETION SWEEP (batch finished).** Removed the rest of the
  Emil-approved dead components: block D (`TodaysTargetLine`/`CalibrationSummaryStrip`/`PillarCoachingStrip`/`CoachingStrip`,
  ~300), `WorkoutLog` (old manual logger, ~372) + cascade-dead `countExtracted`/`WORKOUT_TYPES`/`DocIcon`,
  `TrainingStressPanel` (~245), `RacePrepBanner` (~133), `PrinciplesPanel` (~80), `HomeCockpit` (~357). Pruned orphaned
  imports (`parseRunPDF`/`parseWorkoutCSV`/`fetchWeatherForDate`; `scoreAll`/`getInsights`; `ZONE_COLORS`/`ZONE_LABELS`;
  `raceReadiness`; `computeHyroxDensity`) — `parseFITFile` kept (live FIT flow). Grep-verified zero live refs to deleted
  comps. **Arnold.jsx now 9,281 lines** (~1,470 dead lines out this round; decomposition total ~2.5k+ out from ~11.8k).
  One inert detail: `TrainingStressPanel`'s tail line sits inside a `/* */` block comment (a `✓` literal the Edit tool
  can't match) — harmless. Emil already ran `npm test` 53✅ at the slices 10–11 checkpoint. **Emil: build (all tabs) +
  `npm test` to confirm 12–15 + pruning.** Dead-code batch DONE — remaining decomposition is big LIVE components (IDE).
- **2026-06-13 (x)** — **0.5 slice 9: DEAD-CODE DELETION — legacy AICoach.** Like RacesTab, `AICoach` (the AI-coach tab +
  memory timeline, ~95 lines) is dead — never rendered (AI-coach-as-a-tab retired for the ambient Coach/CoachComment).
  Deleted + cleaned the now-dead imports it alone used (`getWorkouts`, `findRelevantWorkouts`, `buildWorkoutMemoryContext`,
  `getRaces`, `buildTrainingContext`); kept `getGarmin`/`saveWorkout` (used elsewhere). Arnold.jsx ~10.75k (decomposition
  total ~1,049 lines out across 7 extractions + 2 dead deletions). **Emil: build (all tabs) + `npm test`.** Note: two
  consecutive dead components (RacesTab, AICoach) — the monolith carried real cruft from superseded features. Remaining
  big LIVE components (ClinicalModule/Dashboard/LogDay/ProfileSettings) are IDE-extraction targets.
- **2026-06-12 (w)** — **0.5 slice 8: DEAD-CODE DELETION — legacy RacesTab cluster.** While prepping the Races cluster as
  a mid-size extraction, found it's DEAD: `RacesTab` is never rendered (CalendarTab.jsx replaced it — says so in its
  header), and `RaceList` + `getMilestones`/`getTrainingProgress`/`raceStatus` are only used inside RacesTab. Emil
  confirmed delete. Removed the ~244-line cluster + 2 now-dead imports (`fetchAndParseICS`; `saveRaces` from the memory.js
  import — `getRaces` stays, still used elsewhere). No functional risk (nothing referenced it; recoverable via git).
  Arnold.jsx ~10.85k (decomposition total = ~954 lines out of ~11.8k across 7 extractions + this deletion). **Emil: build
  (everything works incl. the live Calendar tab = CalendarTab) + `npm test`.**
- **2026-06-12 (v)** — **0.5 slice 7: LabsModule + LabSparkline → `components/LabsModule.jsx`** (first big-component move).
  ~257 lines out. New file imports useState/useEffect/useRef, C, S, biomarkers (BM/BCATS/BCAT_CLR/BCAT_ICO/bStatus/SC/SL/
  SC_BG/SC_BORDER), parseLabCSV, ai+buildFullPrompt, dc; exports LabsModule (LabSparkline internal). Arnold.jsx imports
  LabsModule; `<LabsModule>` at L1610 unchanged. **Reproduction verified byte-identical** — the removal Edit's old_string
  (same text I wrote to the new file) matched Arnold.jsx exactly, proving the transcription is faithful. Arnold.jsx
  ~11.09k (7 slices = ~710 lines out). **Emil: build (Labs tab — blood panel viewer / category tabs / CSV import / AI
  analysis all work) + `npm test`.** REMAINING big component: ClinicalModule (L~1664, ~670 lines) — best as IDE cut-paste
  (deps now all importable: useState/useMemo, C, S, biomarkers, ai+buildFullPrompt; sub-component ScanPicker is local).
- **2026-06-12 (u)** — **0.5 slice 6: the `S` styles object → `arnoldStyles.js`.** Found while extracting labs: the labs
  components (and ~everything in Arnold.jsx) depend on the app-wide `S` inline-style object (66 keys, all referencing the
  `C` palette). Extracted `S` verbatim to `src/arnoldStyles.js` (imports `C` from arnoldTheme.js). ~75 lines out; one
  import back; 143 `S.xxx` usages unchanged. **Node-verified 23/23** (loads, C resolves, all labs+app keys present).
  Arnold.jsx ~11.35k (6 slices = ~453 lines out). With `C`+`ai`+`S` foundations all extracted, the labs components are now
  DEPENDENCY-CLEAN (everything they use is importable). REMAINING for labs = only the physical ~928-line component move
  (ClinicalModule 670 lines + LabsModule 238 + LabSparkline 20) — risky via reproduce-and-match edits, better as an IDE
  cut-paste OR I attempt LabsModule (~258 lines, exact text already read) via tools. **Emil: build (whole UI unchanged) +
  `npm test`.**
- **2026-06-12 (t)** — **0.5 slice 5: AI layer → `core/ai.js`** (prerequisite to labs, Emil-chosen). Moved `ai` +
  `aiStream` + `AI_WORKER_ENDPOINT`/`AI_WORKER_TOKEN`/`AI_KEY` (top of file) AND `buildFullPrompt` + `aiSummary` (bottom)
  into one `core/ai.js`. Exports: ai, aiStream, aiSummary, buildFullPrompt; deps: `td` (uiFormat) + supplement getters
  (supplements.js). ~135 lines out; removed the now-unused supplement import from Arnold. `AI_HDR` bug PRESERVED verbatim
  + flagged in the new file header (fix later). Note: the unrelated local `AI_KEY` string const in TrainingTab (~L9614) is
  untouched. **Node-verified 8/8** (exports + buildFullPrompt output; localStorage warnings in Node are expected/caught).
  Arnold.jsx ~11.43k (5 slices = ~378 lines out). **This UNBLOCKS labs** (it can import ai/buildFullPrompt from core/ai.js).
  **Emil: build (AI summary on EdgeIQ, AICoach, labs/clinical AI-analysis buttons all still wired) + `npm test` — then I
  do the labs extraction.**
- **2026-06-12 (s)** — **0.5 slice 4: SYSTEM_PNGS_DESKTOP asset map** → new `core/systemPngs.js` (the 11 low-poly system
  PNG asset imports + the id→asset map; paths `../assets`). ~17 lines out; used at Arnold.jsx ~L9154 (health-system tile).
  Asset wiring → not Node-testable, but pure/low-risk; Emil's build confirms. Arnold.jsx ~11.56k (4 slices = ~243 lines
  out). **FINDING (not fixed — out of refactor scope):** `AI_HDR()` is referenced in `aiStream` (Arnold.jsx ~L323) but
  **never defined anywhere in src** → the streaming-AI path (aiStream→aiSummary, used by the training-summary feature)
  would throw if reached. Pre-existing latent bug; flag for a deliberate fix later. INFLECTION: the cheap pure leaves are
  ~done; remaining big wins are entangled feature components (labs: ClinicalModule+LabsModule+LabSparkline ~900 lines;
  races; profile) — need careful multi-piece cluster extraction + Emil build-loop. **Emil: build + `npm test`.**
- **2026-06-12 (r)** — **0.5 slice 3: small display/format utils.** `td`/`fmt`/`Q`/`HRV_L`/`hc`/`dc`/`genId`/`calcPace`/
  `daysUntil`/`raceTypeBadge` → new `core/uiFormat.js` (imports `BM` from biomarkers.js + `parseLocalDate` from
  dateUtils.js — no cycle). ~24 lines out; one import; usages unchanged (BM/parseLocalDate still used elsewhere in
  Arnold). **Node-verified 17/17** (td/fmt/hc/dc/calcPace/raceTypeBadge/genId/Q/HRV_L). Arnold.jsx ~11.58k lines (3 slices:
  biomarkers + parsers + uiFormat = ~226 lines out). **Emil: build (Labs/Clinical/logging/races badges unchanged) +
  `npm test`.**
- **2026-06-12 (q)** — **0.5 slice 2: CSV/import parsers.** `parseCSV` / `parseLabCSV` / `ndate` / `mapGarmin` /
  `mapCrono` / `mergeLogs` → new `core/importParsers.js` (pure, self-contained — they only reference each other). ~115
  lines out of Arnold.jsx; one import back; usages unchanged (incl. ndate @ L10811). **Node-verified 12/12** (CSV quote/
  header handling, ndate formats, Garmin/Crono row mapping, mergeLogs overwrite+fill). Arnold.jsx now ~11.6k lines (from
  ~11.8k after 2 slices). **Emil: build (CSV import / Garmin+Cronometer sync / lab CSV import unchanged) + `npm test`.**
- **2026-06-12 (p)** — **0.5 monolith decomposition STARTED (Emil-greenlit) — slice 1: biomarker config.** Mapped
  Arnold.jsx's top-level defs; the big components (LogDay ~3.2k lines, Dashboard, TrainingTab) are entangled → start with
  pure leaf blocks. Slice 1: the `BM` biomarker reference table (54 markers) + `BCATS`/`BCAT_CLR`/`BCAT_ICO` + `bStatus`
  + `SC`/`SL`/`SC_BG`/`SC_BORDER` → new `core/biomarkers.js` (pure data + 1 pure fn, zero deps). ~87 lines out of
  Arnold.jsx; one import back in; 15 usages unchanged. **Node-verified** (module loads, bStatus correct across
  low/high/mid markers + edge cases). Removed the 2 local blocks via exact-match Edits (special chars matched fine).
  **Emil: build (Labs/Clinical tabs + health-system detail unchanged) + `npm test`.** Method established: extract pure
  leaf blocks first, Node-verify the non-JSX ones, Emil's build confirms.
- **2026-06-12 (o)** — **Dedup slice — SYSTEM_ICONS unified (3 copies → 1).** The 10 health-system inline-SVG icons were
  copied THREE times: byte-identical @16px in Arnold.jsx + NutritionInput.jsx, and again @14px (`SYSTEM_ICONS_M`) in
  MobileHome.jsx. Extracted to `components/systemIcons.jsx` with a `size` param (default 16; mobile passes 14). All three
  files import it; `SYSTEM_ICONS_M` is gone. Web/nutrition call `(color)`→16, mobile `(color,14)`→14 — exact prior sizes,
  no-visual. Closes one of the audit's "same maps duplicated across files" defects. (Can't Node-test JSX; pure
  byte-identical render fns → very low risk.) **Emil: build (icons unchanged on Daily/Start/Nutrition) + `npm test` (53).**
- **2026-06-12 (n)** — **Pre-workout card fixes (Emil-flagged regressions + polish).** (1) Web figure was clipped
  (`overflow:hidden` + no floor) → `Card` minHeight = figureBottom+8. (2) Coach line went silent on held/no-debt days →
  always-on "On plan" fallback. (3) Coach overlapped figure on some art → first tried pinning it to the card bottom
  (`marginTop:auto`) but that opened a wide gap on web (Emil flagged) → reverted to: Coach sits under the targets with a
  right padding of `figureSize+14` that clears the figure's column, so it never overlaps for ANY signature. (Swim/cycle/
  walk/hike PNG framing rigor remains separate image-asset work.) Layout only.
- **2026-06-12 (m)** — **2.1 weekly surface DONE — the last open plan item.** New shared selector
  `core/todayAdaptation.js`: `getTodayAdaptation({planType,distanceMi,durationMin,label})` (async — fatigue band fetch)
  assembles the SAME adaptSession ctx as the daily tile from storage (sleep/HRV via extracted `readinessScoreFrom` +
  `readTodaySignals`, rebound debt via the shared recoverySignature fns, fatigue via getPredictedBands, profile sleep-
  goal from storage) → so the weekly view can't disagree with the daily card. Wired into `WeeklyPlanner`: computes
  today's index in the shown week and renders a terse **⤵ eased / ⤵ trim** marker (reason in tooltip) on today's column
  only when the session was downgraded; held/cleared show nothing. `readinessScoreFrom` extracted verbatim from the
  tile's readinessVerdict scoring and locked with +6 vitest (`todayAdaptation.test.js`) — Node-verified 8/8 (incl. exports).
  NOTE: the async end-to-end couldn't be Node-run (sandbox mount served a truncated copy of the just-written file — the
  documented stale-mount issue; Read-tool confirms the real file is intact); it's glue over already-tested pieces and its
  vitest runs on Windows. **Emil: build (Plan/Calendar → Weekly Planner strip shows ⤵ on today when eased) + `npm test`
  (expect 53).** WeeklyPlanner is shared, so this lands on web AND mobile at once.
- **2026-06-12 (l)** — **FULL SUITE GREEN ON WINDOWS (Emil ran it).** `npm test` → vitest 3.2.6: **47 passed (7 files)**
  — activityClass 11, adaptPlan 10, readinessTokens 5, activitySignatures 4, fuelForWork 9, tokens 3, healthTokens 5.
  Confirms the full net (this session's +29 plus the earlier 18) end-to-end on the real toolchain, matching the 51 ad-hoc
  Node assertions. The uplift's logic is fully verified; visual/JSX side confirmed via Emil's per-round builds.
- **2026-06-12 (k)** — **VERIFICATION CHECKPOINT — all new pure logic machine-verified.** The sandbox VM came back, but
  `vitest` still can't run there (repo `node_modules` has the Windows rollup binary, not the Linux one — and we must NOT
  `npm install` into the mounted folder). Worked around it: since `package.json` is `type:module` and the engines are
  pure, ran the source modules DIRECTLY in Node from /tmp (outside the mount) and re-asserted every test case by hand-
  written script. Result: **51/51 green** — adaptPlan (12 incl. the battery/greenlit fix), fuelForWork prescribeFuel
  (20, incl. eased→light + EA + float cases), readinessVerdict (incl. verdict-color == ringColor at every band),
  healthStatusColor + healthFillTint (incl. the 0.12+0.03 float guard). So all Phase 2 + Phase 3 pure logic is confirmed
  correct, not just traced. NOT covered by this: the React/JSX rendering (HealthTileBase, tile wirings) → still needs
  Emil's Windows Vite build; and the ~25 earlier vitest suites → Emil should still run `npm test` on Windows once to
  confirm the full suite. **Emil: when convenient, `npm test` on Windows for the full suite + build.**
- **2026-06-12 (j)** — **3.2 slice 3 (the big one) — HealthSystemTile JSX UNIFIED.** New `components/HealthSystemTile.jsx`
  exports `HealthTileBase` driven by a `VARIANTS` config (web / mobile / nutrition). The three near-identical tile bodies
  (web Arnold.jsx, mobile `MobileSystemTile`, nutrition `HealthSystemTile`) are now **thin wrappers** that resolve their
  own icon maps (SYSTEM_PNGS_DESKTOP / SYSTEM_PNGS / SYSTEM_ICONS[_M]) + active/click props and delegate to the base.
  Every per-surface value preserved EXACTLY (checked --text-primary=#eaeaea ≠ mobile's #fff → kept valueColor
  per-variant; icon sizes 44/36/26; name wrap only on mobile; comment only web+nutrition; nutrition boxed-svg +
  non-clickable; tint base 0.15/0.12). Intended **no-visual**; the one behavior add is mobile tiles gaining keyboard a11y
  (role=button + Enter/Space). Removed now-unused `healthFillTint` imports from all 3 files. **Emil: build and eyeball
  ALL THREE health grids — web Daily, mobile Start, Fuel/Nutrition — they should look identical. This is the higher-risk
  slice, so a careful compare is worth it.**
- **2026-06-12 (i)** — **3.2 slice 2 — health-tile FILL TINT shared.** `healthFillTint(status, base)` added to
  `healthTokens.js`: same color vocab, `base` alpha per surface (web/nutrition 0.15, mobile 0.12) with the deficient
  state always +0.03 — exactly reproduces all three tiles' prior inline rgba (rounding guards the 0.12+0.03 float).
  Migrated web `HealthSystemTile`, mobile `MobileSystemTile`, nutrition `HealthSystemTile`. Color + tint for the health
  tiles are now BOTH single-source; only the JSX layout differs per surface (deferred merge). No pixels change. +2
  vitest (now healthTokens = 5). **Emil: build (identical) + `npm test`.**
- **2026-06-12 (h)** — **STEP 3.2 STARTED — parity in safe slices (Emil-picked).** Found the desaturation sweep
  comprehensive (other colored numbers are categorical macro colors / section theming / status words — all legit). First
  3.2 extraction beyond the verdict: `healthStatusColor(status)` in new `core/presentation/healthTokens.js` → STATUS
  token color for good/focus/def. Migrated every inline copy: web `HealthSystemTile` + `WebSystemDetail` + the web grid
  header count-dots (Arnold.jsx), and the mobile grid header dots (MobileHome.jsx). STATUS hexes are byte-identical to
  the old hardcoded values (#4ade80/#fbbf24/#f87171) → **provably no pixels change**; the win is one source for the
  health-status palette. +3 vitest (`healthTokens.test.js`). DEFERRED (higher-risk, wants a live build loop): merging
  the 3 HealthSystemTile JSX bodies into one variant-prop component (they differ only in icon size / name-wrap / tint
  alpha). **Emil: build (should look IDENTICAL — it's a refactor) + `npm test`.**
- **2026-06-12 (g)** — **PHASE 3.1 consolidation + first parity down-payment.** (1) Desaturated the **3rd/last health
  grid** — `NutritionInput.jsx` `HealthSystemTile` `{pct}%` → neutral `--text-primary` (status on the fill tint), so all
  three health grids (web Daily / mobile Start / Nutrition) now read identically; removed its dead `statusColor`.
  (2) **Dedup'd the readiness verdict** into a shared pure helper `readinessVerdict(score)` in `readinessTokens.js` →
  `{ word, color }` (Go strong ≥70 / Go steady ≥45 / Dial back / null on empty). Both the web Daily hero AND the mobile
  Play hero now call it instead of two inline ternaries — they can't drift again (the exact divergence Emil caught).
  Dropped the now-unused `ringColor` import from Arnold.jsx. +5 vitest (`readinessTokens.test.js`) incl. a check that the
  verdict color == ringColor at every band. This is 3.2-parity in microcosm: presentation logic → one module, both
  surfaces consume. **Emil: build (visual: Nutrition health grid desaturated; verdict unchanged) + `npm test`.**
- **2026-06-12 (f)** — **PHASE 3.1 ported to MOBILE (Emil caught the gap).** (d)+(e) only touched the WEB Daily/hero
  code paths; mobile has separate components, so the changes didn't show on mobile. Ported both: (1) `MobileSystemTile`
  (MobileHome.jsx ~L3286) `{sys.pct}%` desaturated statusColor→`T1` (#fff); status stays on the fill tint + top accent
  line; removed the now-dead `statusColor` const. (2) Mobile **Play hero** readiness (Arnold.jsx ~L6609) now shows the
  same **verdict word** ("Go strong/steady" / "Dial back") above the rings via `ringColor(r7Score)`. Note: a 3rd health
  grid exists in `NutritionInput.jsx` (Nutrition screen) — left as-is for now. Mobile "Signal Cockpit" tiles
  (MobileHome ~L4452) still color the value, but those carry a goal-progress bar in the same color (color is arguably
  meaningful there) — deferred/flagged. **Emil: build to see mobile health tiles desaturated + the verdict on Play.**
- **2026-06-12 (e)** — **PHASE 3.1 cont. — readiness verdict headline (the "one read").** Finding first: the rainbow-
  numbers problem was mostly ALREADY solved — `MetricCluster`/`metricRegistry` render values neutral (`--text-primary`)
  with color only on the tier sub-word, and `KRITile` was already compliant; `HealthSystemTile` was the lone offender
  (fixed in (d)). So Daily desaturation is essentially done. New focal piece (Emil-picked): the Daily hero now shows a
  plain-language **verdict word** ("Go strong" ≥70 / "Go steady" ≥45 / "Dial back") above the readiness rings, colored
  via `ringColor(r7Score)` (same source as the ring color → can't disagree). The WORD carries the accent; the score
  stays in the rings (no number duplication). Gated on `r7Score > 0`. Visual-only. **Emil: build to see the verdict
  headline on Daily.** Next options: desaturate other screens (EdgeIQ/Trend/Fuel) or Step 3.2 parity.
- **2026-06-12 (d)** — **PHASE 3.1 started — visual-hierarchy pass on web Daily.** Emil approved the color-discipline
  mock (value neutral, color reserved for status/trend, one hero). First increment, the headline desaturation:
  `HealthSystemTile` (Arnold.jsx ~L9366) `{pct}%` was painted in statusColor (green/amber/red) — now **neutral
  `--text-primary`**, with status carried solely by the **existing rising fill tint** (+ border when expanded). (Tried a
  status dot first; Emil noted the tint already encodes status, so the dot was redundant noise — removed.) Found
  `KRITile.jsx` ALREADY compliant (values use `--text-primary`; only amber/red
  tint; dots + trend arrows for status) — no change needed. **Emil: build to see the health grid desaturated.**
  Follow-up increments: (1) elevate Readiness to the single hero (accent rail + verdict word, per mock); (2) sweep any
  other colored-number spots on Daily; (3) 3.2 web/mobile parity. Visual-only change, no engine/test impact.
- **2026-06-12 (c)** — **2.2 fuel-for-work BUILT + WIRED.** New `core/fuelForWork.js`: `prescribeFuel(session, ctx)`
  is PURE (like adaptPlan) → `{ bracket, preCarbsG, duringCarbsPerHr, pmProteinG, ea:{kcalPerKgFfm,status,flag},
  deficitVsTarget, summary, reason }`. Science: pre-carb 1–4 g/kg by demand bracket (light .5 / moderate 1 / high 1.5 /
  very-high 2.5 g/kg); during-fuel 0/<75min, 40 g/h, 75 g/h; recovery protein 0.3 g/kg (0.4 hard/long, min 20);
  energy availability EA=(intake−exercise)/FFM kg → low<30 / reduced<45 / optimal (RED-S, IOC 2018). `intensityClass`
  is authoritative so an EASED session fuels as the easy work it now is (not its original tempo type). `fuelForToday()`
  is the thin storage wrapper (getCurrentBodyComp + computeTDEE + getEffectiveTargets). Tile: the fuel row now shows
  **CARB / PRO / EA chips** for the adapted session (EA chip only when low/reduced, red/amber). 9 vitest cases lock it
  (traced green by hand — sandbox VM still down). **Emil: `npm test` (+9 → adaptPlan 10 + fuel 9) and build to see the
  chips on a hard day.** Remaining in Phase 2: weekly/calendar adaptation (needs the shared today-context selector —
  do in Phase 3 parity). Then Phase 3 visual polish.
- **2026-06-12 (b)** — **BUG FIXED (Emil-flagged):** the header **battery icon and the coach disagreed** — battery
  reads `predicted.source.fatigueLevel` (intel fatigue model) showing ~empty, while the coach said `Cleared: Recovered`.
  Root cause: `adaptSession`'s `greenlit` path only weighed `readinessVerdict().score` (sleep+HRV) + rebound debt — it
  never saw `fatigueLevel`, so a well-slept morning could clear you while the fatigue model read depleted. FIX: `fatigueLevel`
  is now a first-class limiter in `dominantLimiter` (≥3 sev3 / ≥2 sev2 / ≥1 sev1). Because `greenlit` requires `sev===0`,
  any non-zero battery fatigue now blocks "Recovered" AND eases a hard session — one change covers both. The tile passes
  `predicted.source.fatigueLevel` (the exact signal the battery icon shows) into ctx, so battery + coach tell one story.
  +3 vitest cases (depleted→not greenlit / battery-alone→ease / full→still greenlit). **Emil: rebuild to confirm; the
  empty-battery + "Recovered" combo should now read as eased-with-reason instead.** Task #9 done.
- **2026-06-12 (a)** — **2.1 adaptive plan WIRED into the pre-workout tile.** PlannedWorkoutTile now maps its
  existing signals → `adaptSession`: `readinessVerdict().score` → readiness band (≥75 high / ≥55 moderate / else low),
  `reboundDebt.totalDebtLbs` → debtLbs, plus hrvDelta / sleepHrs / sleepGoalHrs(profile, def 7.5). Render: the TARGET
  chips now show the **adjusted** volume (`adapted.distanceMi`/`durationMin` — = plan when held, cut when eased/trimmed),
  and an eased-to-Z2 session swaps the stale tempo-pace chip for a `Z2 · easy` cue. The single coach line under the tile
  (`_coachLine`) now **leads with the adaptation reason** — `Adapted:`/`Cleared:` (ease=red, trim=amber, greenlit=green)
  — falling back to the rebound-debt `Recovery:` copy when there's no adaptation. One line, one source of truth; the
  header still shows the originally-planned label so the user sees what changed and why. Additive; engine untouched (7
  tests still apply). **Emil: build to verify (`cd arnold-app && npm run build && npx cap sync android && npx cap run
  android`). Sandbox VM is down so I couldn't esbuild-parse-check — manual scope review done (GOOD/T2/planType/planMins/
  plannedToday/profile/reboundDebt/PLAN_TYPE_LABEL/hrvDelta/sleepHrs all in scope; adaptSession imported).** Next:
  weekly/calendar view, then 2.2 fuel-for-work.
- **2026-06-10 (n)** — **PHASE 2 started, then parked for tomorrow.** Built the **2.1 adaptive-plan ENGINE**:
  pure `core/adaptPlan.js` → `adaptSession(planned, ctx)` where ctx = {readiness, debtLbs, hrvDelta, sleepHrs,
  sleepGoalHrs}. Rules: hard session + strong limiter (debt≥2 / HRV≤−12 / short sleep / low readiness) → EASE
  (intensity→Z2, −25% volume) with the reason; mild limiter → TRIM (−15%); strong morning + no debt → GREENLIT;
  else HOLD; easy/rest never eased. 7 vitest cases lock it (`adaptPlan.test.js`). Build-safe (additive pure module).
  **PARKED HERE.** TOMORROW: (1) wire `adaptSession` into the pre-workout tile (PlannedWorkoutTile already has
  readinessVerdict + reboundDebt + sleep/HRV → map to ctx; render the adjusted prescription + reason where the
  current advisory band is); (2) the weekly-plan/calendar view; (3) **2.2 fuel-for-work** (next-session carbs/protein
  + low-EA flag from energyBalance/calorieTarget + the plan). Then Phase 3 (visual polish + web-tile/card→white-opacity).
  **Emil: `npm test` to confirm the engine (should be +7 green); no build needed (no UI change yet).**
- **2026-06-10 (m)** — Built the **1.2 living-coach fix**. Discovery: the time-of-day × session-state × event model
  is ALREADY implemented on `daily_digest` (composeDigest: hour/isEvening + trainedToday/plan.done) and `play`/`fuel`
  (classifyPlayState: post-workout event window → morning/midday/evening buckets gated on session-done). The GAP was
  the `leverage` surface (Start mobile + EdgeIQ web) — the "sleep at 8am" source. FIX (CoachComment leverage block):
  in the morning with a planned, not-done session and nothing trained, lead FORWARD with today's session via the
  already-tested `composePlayLine('planned_morning')` instead of the backward leverage point. Reuses proven copy,
  build-safe (in-scope fns, no new imports). Left dead CoachBeta/CoachLine imports (harmless; can't delete files).
  **Emil: build — and in the MORNING (before 11am) with a planned-not-done session, the Start coach should say
  "Today: {session}…" not a sleep line.** (Behavior is morning-only, so hard to see midday.)
- **2026-06-10 (l)** — 1.1 hero build-verified ("renders well"). Mapped 1.2: **the coach is already unified** —
  `CoachComment` is the only rendered coach (ONE shared `computeUserState` pass → internally consistent; each
  surface shows a deliberate facet). `CoachBeta` + `CoachLine` are DEAD (imports retired, never rendered). So the
  "merge composers" work is mostly done. **Real remaining 1.2 = (a) TIME-OF-DAY awareness (the gap behind Emil's
  "sleep at 8am" complaint) + (b) event-driven suppression (no noise) + (c) delete the dead CoachBeta/CoachLine.**
  Proposed time-of-day behavior to Emil for confirm before building (it's a behavior decision).
- **2026-06-10 (k)** — **PHASE 1 started.** Mocked the "What Arnold's learned about you" hero (confidence bars,
  plain-language magnitude, tap-to-explain); Emil: "that lands." Built `components/LearnedHero.jsx` from real
  `hubFacts` (responses → factor + magnitude + confidence bar + tap reveals HOW it was learned; footer = race
  fitness + sweat). Confirmed responses carry `{factor,perUnitPct,unit,confidence}` but NO per-response sample
  count, so dropped the "N efforts" and the tap shows a plain-language method explanation instead. Swapped it in
  for `HubPanel` at Arnold.jsx:7729 (Activity column → shows on web Daily + mobile Play tab; HubPanel.jsx kept but
  now unused). **Emil: build + look at the Daily/Play screen — the hero should render with your real learned data.**
  NEXT: optionally promote placement higher + add to mobile Start (MobileHome); then 1.2 (one Coach voice).
- **2026-06-10 (j)** — `C` extraction build-verified by Emil ("all looks good"). Probed the next 0.5 pieces and
  hit the wall: `S` (the app stylesheet) is ~130 lines at the truncation-prone file tail, and the big components
  (LogDay ~3.2k lines) are deeply scope-coupled — both are large, fragile blind cuts for little/no user value.
  **Decision recorded:** 0.5's *deep* decomposition is DEFERRED to a session with a live editor + build loop;
  doing it blind is slow and risky for zero user gain. **Phase 0's foundations are banked** (one token source,
  one signature map, one classifier, one plannable-types list, a green 16-test net, a shared tokenized MetricTile,
  the C palette extracted). **Recommend now moving to Phase 1 — the "learned about you" hero — the highest-value
  work in the plan and safe to build additively.** Awaiting Emil's go on that.
- **2026-06-10 (i)** — 0.3b verified green by Emil. Started **0.5**: extracted the `C` CSS-var palette out of
  `Arnold.jsx` into `src/arnoldTheme.js` + imported it (the 2 local `const C` are circumference vars — they
  shadow as before, no conflict). Safe, value-preserving prep that makes `C` importable for future component
  extractions. **REALITY CHECK:** the file's components share a deep web of module-scope helpers, so meaningful
  component extraction (LogDay etc.) is a SLOW incremental track + each step needs a build to catch scope breaks —
  not feasible as a big-bang blind edit. Will keep chipping safe pieces. **Emil: build to confirm the web app
  still renders (the C move touches the whole web shell's colors).** Then continue 0.5 or, given it's pure
  maintainability, consider banking Phase 0 and moving to the high-value Phase 1.
- **2026-06-10 (h)** — Emil: follow the plan in order (no Phase-1 pivot). Did **0.3b classifier dedup**:
  extracted `isSki`/`isWalk` into `activityClass.js`, removed the 3 duplicated regexes (CalendarTab,
  `_resolvePlanType`, coachSignals), added tests. **0.3 now complete.** Only **0.5 (monolith decomposition)**
  remains in Phase 0 — the heaviest/riskiest blind item; will approach it carefully + incrementally.
  **Emil: `npm test` (expect green, +2 ski/walk suites) + `npm run build`.**
- **2026-06-10 (g)** — Found the "web tile" is actually **`KRITile`** (Trend-tab tile w/ pin), a DISTINCT
  component, not a 2nd `MetricTile`. So migrating it (and the card's text) onto the shared white-opacity
  scale is a **visible change → moved to Phase 3** (design), keeping Phase 0 invisible. The
  value-preserving part of 0.2 (shared tokenized `MetricTile` + mobile on it) is **done**. Tried to delete
  the dead `MetricTileLegacy` — big exact-match edit didn't match (tricky inline chars); left it (harmless,
  labeled) to remove during 0.5. **Sequencing reality:** the two remaining Phase-0 items — 0.3b (classifier
  merge) + 0.5 (decompose the 11.8k-line monolith) — are large STRUCTURAL edits that are high-risk to do
  blind (this failed deletion is the proof) and are pure-maintainability (no user-facing value). Recommend:
  **bank the foundations and move to Phase 1 (the "learned about you" hero — additive, the differentiator),**
  doing 0.3b/0.5 opportunistically with a tighter build loop. Awaiting Emil's nod on that pivot.
- **2026-06-10 (f)** — Test net **green** (16 tests) + **build clean** on Emil's machine. Started **0.2**:
  added `TEXT`/`SURFACE` tokens; built the shared `ui/MetricTile`; pointed MobileHome's tiles at it
  (local copy → dead `MetricTileLegacy`, removed after verify). Value-preserving for mobile (the shared
  tile uses the exact mobile values). **Emil: build + confirm the mobile Start tiles look unchanged.**
  Then I remove the dead code and migrate the web tile (which will shift web text to white-opacity).
- **2026-06-10 (e)** — Decisions: Vitest **yes**, canonical text scale **white-opacity**. Shipped
  **0.4 test net**: `vitest` dev-dep + `npm test`/`test:watch` scripts + `vitest.config.js` + 3 suites
  (`activityClass`, `activitySignatures`, `tokens`) that lock the classifier contract + the deduped
  maps. Added `TEXT` (white-opacity) to tokens for the 0.2 primitives. **Emil: run `npm install`
  then `npm test` (expect green), and build.** NEXT: **0.2** (shared `<Card>`/`<MetricTile>` on the
  white-opacity TEXT) — the headline web/mobile dedup — then **0.3b** classifier dedup (now test-guarded).
- **2026-06-10 (d)** — Emil build-verified checkpoint (figures + status colors clean). Shipped
  **0.3c types dedup**: `PlanPickerModal.OPTIONS` derives from `DAY_TYPES`; removed the second
  hardcoded list + the now-dead CATEGORY import in CalendarTab. **Phase 0 remaining needs two
  decisions from Emil:** (1) Vitest OK → unblocks 0.4 test net → the safe 0.3b classifier dedup;
  (2) canonical TEXT scale for 0.2 (recommend white-opacity #fff/.88/.65/.45 as the dark-UI standard;
  the card's warm-gray then migrates to it). 0.5 (monolith decomposition) can proceed independently.
- **2026-06-10 (c)** — Started **0.3**. Shipped the **signature dedup** (0.3a): `activitySignatures.js`
  is now the only figure map; `PlannedWorkoutTile`/`WeeklyPlanner`/`CalendarTab` migrated; the 3
  duplicate maps + 3 `SIG_VERSION`s are gone. `grep` confirms no live references to the old maps.
  Value-preserving. **Checkpoint — Emil to build-verify figures + the 0.1 status colors before I
  continue** with the classifier/types dedup (0.3b/c) and then the visual primitives (0.2).
- **2026-06-10 (b)** — Emil build-verified the category-color migration ("all looks good").
  Finished **0.1**: migrated `metricRegistry.COLOR` → `tokens.STATUS` (added a `hot` #fb923c
  shade; rendered values preserved — note this registry's "over" = STATUS.bad #f87171, a
  high-tier red, not the deep-red ceiling). **0.1 now code-complete** — one color source of
  truth. Next: one quick build to confirm hero/card tier colors unchanged, then **Step 0.2**
  (shared `<Card>`/`<Tile>`/`<MetricValue>`/`<TrendLine>` primitives in `src/components/ui/`).
- **2026-06-10 (a)** — Plan approved (Phase 0 first); Vitest OK pending Emil. **0.1 started:**
  created `src/theme/tokens.js` as the single source for color/spacing/radius/type. Migrated
  the three discipline-color consumers (`FAMILY_COLOR`, `DAY_TYPES`, `PlanPickerModal.OPTIONS`)
  to read from `CATEGORY` — values preserved except the few planner/picker disagreements,
  now unified to canonical (long_run #3b82f6, intervals #f87171, rest #6b7280). `metricRegistry`
  STATUS migration deferred to next sub-step. Not build-verified (sandbox down) — **Emil to
  build and confirm colors look unchanged before we proceed.**

## How to read effort/risk
- **Size** = S (one focused pass), M (a few passes), L (a multi-session track).
- Every step ends with a **build from the Windows terminal** and an explicit
  **acceptance check** — that is the "done" bar. Nothing is "fixed" until it builds on
  Emil's screen.
- Because there's no CI, the order front-loads the **test net** so later refactors are
  safe.

---

## PHASE 0 — Foundations (do this first; it ends the churn)

The per-session UI thrash and the divergence bugs are not bad luck — they're the absence
of a system. Phase 0 builds the system. Unglamorous, highest leverage.

### Step 0.1 — One theme/token source of truth  · Size S · **START HERE**
**Do:** create `src/theme/tokens.js` exporting three *separate* color roles, each with
ONE job:
- `BRAND` (the neon/dark identity accents),
- `CATEGORY[run|strength|hiit|mobility|cross|cycle|swim|ski|walk|race|rest]` (one hue per
  discipline — the figure palette),
- `STATUS[good|warn|bad|neutral]` (progress/regress + health states),
plus `SPACE`, `RADIUS`, `TYPE`, `SURFACE`, `TEXT` scales.
Map today's CSS vars + the stray hex into it.
**Acceptance:** `FAMILY_COLOR`, `planner.DAY_TYPES`, `PlanPickerModal.OPTIONS`, and
`metricRegistry.COLOR` all *import from* `tokens.js`. `grep` finds each discipline color
defined exactly once. The intervals `#f87171` vs `#fbbf24` disagreement is gone.

### Step 0.2 — Shared UI primitives  · Size M
**Do:** build one implementation each of `<Tile>`, `<Card>`, `<MetricValue>`,
`<TrendLine>`, `<MiniGauge>`, `<SectionHeader>` in `src/components/ui/`, styled only from
`tokens.js`. Replace the two `MetricTile`s (web in `Arnold.jsx`, mobile in
`MobileHome.jsx`) with the shared one.
**Acceptance:** both Daily (web) and Play (mobile) render the metric grid from the *same*
`<MetricTile>`. Changing a tile's look is a one-file edit. The Max-HR-style "value colored
by the wrong rule" class of bug is structurally prevented (color comes from a token role,
not an ad-hoc paint call).

### Step 0.3 — Collapse the duplicated maps (one source of truth)  · Size S–M
**Do:**
- One `activitySignatures.js` (figure path + version). Delete `SIGNATURE_SRC`,
  `PLAN_SIGNATURE`, `SIG_FILE`; one `SIG_VERSION`.
- One classifier: make `CalendarTab`'s local classifier and `Arnold._resolvePlanType`
  *call* `activityClass.js` instead of re-implementing it.
- One plannable-types list: `planner.DAY_TYPES` is canonical; `PlanPickerModal` imports it
  (the calendar-drawer miss this session was a second hardcoded list — delete it).
**Acceptance:** adding a discipline or changing a figure/color is a **one-file** change.
`grep` shows a single definition for signatures, classification, and plannable types.

### Step 0.4 — Seed the test net  · Size S  (run on Windows; sandbox is down)
**Do:** add Vitest (vite-native). Unit-test the pure core that must be identical
everywhere: `computeDailyScore`, hub `estimate`/`responseModel`, `activityKind`,
`addedLoad` pace equivalence, `sessionRPE`. Add snapshot tests for the shared tiles.
**Acceptance:** `npm test` is green and asserts the "one number, shown identically"
invariants. Future refactors have a safety net.

### Step 0.5 — Decompose the monolith (strangler, incremental)  · Size L
**Do:** move (don't rewrite) `LogDay`, `HomeCockpit`, `Dashboard`, `ImportHub`,
`PlanPickerModal`, and the activity-card builder out of `Arnold.jsx` into their own files,
one per pass, building after each.
**Acceptance:** `Arnold.jsx` becomes a thin shell/router; each screen lives in a file under
~1,500 lines; the recurring mount-truncation pain disappears.

**Phase 0 exit:** one color system, one tile, one of each map, a test net, and a navigable
codebase. From here, visual changes are one-file and safe — the churn is over.

---

## PHASE 1 — Make the differentiator the hero (highest ROI on perception)

### Step 1.1 — "What Arnold has learned about you"  · Size M
**Do:** a confidence-aware surface, promoted to the **top of Daily** (above the metric
grid). For each learned relationship from `attribution.js` / `hubFacts` / `coachInsights`
(heat strain, sweat rate, sensitivity, durability…): show the *relationship*, the
*magnitude*, the *confidence %*, whether confidence is *rising*, and **tap → the evidence**
(the sessions that taught it).
**Acceptance:** a first-class Daily card showing ≥3 learned facts with confidence and a
drill-down. This is the demo that beats Garmin/WHOOP's "made-up scores" — it answers
*why*, with receipts.

### Step 1.2 — One Coach voice  · Size M
**Do:** a single `coach(brief)` composer that every surface calls; collapse
`CoachComment`, `CoachLine`, `CoachBeta`, `coachBriefs`, `narrativeComposer`,
`narrativeGraph`, `coachingPrompts` into one source that emits a brief, and surfaces render
length-appropriate slices. Make it **time-of-day aware** (morning → plan/readiness; evening
→ recovery/sleep) and **event-driven** (speak once about what changed; never fire on a
water log).
**Acceptance:** Daily, Play, and Fuel show the *same underlying message*; the coach never
contradicts itself across screens; no trivial-log noise. (Closes Emil's standing item B +
the "living coach" deferral.)

---

## PHASE 2 — Close the loop (scorekeeper → coach)

### Step 2.1 — Adaptive plan  · Size M–L
**Do:** wire `hub` readiness/recovery-debt into `planGenerator`/`planner` so **tomorrow's
prescribed session auto-adjusts** (intensity/volume) and the **reason is shown** ("eased to
Z2 — 1.1 lb hydration debt + low HRV"). This is TrainAsONE/Runna's core hook, on a better
engine you already own.
**Acceptance:** a low-readiness morning visibly downgrades the planned session with a
stated reason; a strong morning can green-light the harder option.

### Step 2.2 — "Fuel for the work required"  · Size M
**Do:** from `energyBalance`/`calorieTarget`/`raceFueling` + the (now adaptive) plan,
prescribe **next-session** nutrition and flag low energy availability.
**Acceptance:** "Tomorrow: tempo 6 mi → target ~70 g carbs pre, 25 g protein PM; you're ~X
under today." Makes the Cronometer integration pay off (the Fuelin/MAVR whitespace).

---

## PHASE 3 — Polish to consumer tier

### Step 3.1 — Visual hierarchy pass  · Size M
One hero per screen, progressive disclosure (summary → tap-to-expand, which the card
already gestures at), fewer simultaneously-colored numbers (value neutral, color reserved
for status/trend), lean into the low-poly/dark brand.
**Acceptance:** each screen has exactly one obvious focal point; a first-time user can name
"the one thing this screen is telling me."

### Step 3.2 — True web/mobile parity  · Size M
With shared primitives in place, both surfaces render from the same components; differences
become layout-only, intentional, and small.

---

## The first concrete move (recommended)

Start with **Step 0.1 (theme tokens)** → **0.2 (shared `<MetricTile>` + `<Card>`)** →
**0.3 (collapse the maps)**, in that order. Rationale: this trio kills the two root causes
of everything painful — duplication and ad-hoc styling — in ~1–2 focused passes, and every
later step (especially the "learned about you" hero and the visual-hierarchy pass) gets
dramatically cheaper and safer afterward. It also directly enforces the laws already in
`DESIGN_DECISIONS.md` that the code doesn't yet honor.

Deliverable for move #1: a `tokens.js` + a `src/components/ui/` with `<Card>`, `<Tile>`,
`<MetricValue>`, `<TrendLine>`, migrated on **one screen** (Daily) as the proof, building
clean on Windows — then roll the same primitives across the rest.

## What I need from you to start
- A green light on the Phase-0-first sequence (vs. jumping to the "learned about you" hero,
  which I can do but it'll be built on the old, churn-prone foundation).
- Confirmation that adding **Vitest** as a dev dependency is fine (Step 0.4) — it's the
  safety net that makes the refactors honest.
