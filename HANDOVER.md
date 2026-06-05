# Arnold — Handover / Session State

> **Purpose:** canonical "where we are" doc so any new Cowork window can resume in one step.
> If a window crashes, open a new one, connect the `Arnold` folder, and say:
> **"Resume Arnold from HANDOVER.md"**
>
> Keep this file current at checkpoints. It is tracked by git, so it rides along
> with your normal `git push` — your manual backup is also the state backup.

---

## Last updated
2026-06-04 — Hub core DONE (39/39, live via hubDebug); NEXT chapter planned → docs/HUB_GO_LIVE.md

## ▶ ACTIVE NEXT CHAPTER: Hub Go-Live (plan in docs/HUB_GO_LIVE.md)
Make the hub live, accurate, visible. 4 sequenced steps (do pure-logic 1–2 first = no build risk;
render edits 3–4 when mount stable). Tasks #46–#49 seed this.
  1. CALIBRATION — best-anchor (not training-average) so hub 10K ≈ Races 49:23 not 56:48; wire personal k.
  2. PERSIST + BOOT — core/hub/hubBoot.js (ensureHub/recordRaceLive) + 1 guarded Arnold.jsx hook.
  3. UI SURFACE — caveated hubFacts card (predictions + response sensitivities).
  4. PREDICTOR UNIFY — route Races + Trend racePredictor through predictFromFitness (kills 49:23 vs 1:01:40).
After this: Coaching Team (COACHING_TEAM.md) reads the live hub, voiced by the parked narration layer.
Plan-Generator stage 1 is the one item BLOCKED on Emil input (training days/week + strength commitment).

## Intelligence Hub — core loop, cut 5 (2026-06-04) — BACKFILL + WIRED (debug entry)

## ★ Intelligence Hub — core loop, cut 5 (2026-06-04) — BACKFILL + WIRED (debug entry)
The hub now boots from real history and is reachable in-app. Pure logic node-tested; full hub
suite (hubCore 11 + hubIngest 8 + hubState 7 + hubRaceFitness 5 + hubBackfill 5 + hubFacts 3) =
39/39, all executed.
- **`src/core/hub/backfill.js`** — `backfillHub(activities, {attributionFn, k, ...})` replays
  qualifying races CHRONOLOGICALLY: for each, predict from the hub's fitness-so-far → attribute →
  recordRace. First race seeds fitness (no prediction yet); later races' residuals teach the
  response model. Recency via gap-based ageWeeks (decay prior by gap since previous checkpoint).
  `defaultIsCheckpoint` = running race/hard effort ≥3km. DI `attributionFn` (app passes a wrapper
  around attributeOutcome; tests pass a fake) keeps it node-testable.
- **`src/core/hub/hubFacts.js`** (PURE, tested) — renders state → {refEquivSecs, fitnessConfidence,
  predictions[5K/10K/HM/M via predictFromFitness], responses[{factor,perUnitPct,unit,confidence,text}]}.
  fmtTime helper. "heat ≈ 0.42%/°C (confidence 38%)" style facts.
- **`src/core/hub/hubDebug.js`** (browser glue, NOT node-tested) — `buildHubFromStorage()` reads
  storage.get('activities'), backfills via real attributeOutcome, returns {state,trace,count,facts};
  attaches `window.hubDebug(opts)` (read-only: backfills + console-logs predictions + response facts).
- **Arnold.jsx**: ONE import line added (~L96) `import "./core/hub/hubDebug.js";` next to the other
  window.*Debug wirings. (Windows file verified complete; mount truncated it mid-write again = phantom.)
MOBILE: no separate step — hub is shared web code, reaches Android via `npm run build && npx cap sync`.
Hub is also self-deriving (backfills from synced activities), so it need not sync its own state.
VERIFY AFTER REBUILD: open the app/web console and run `window.hubDebug()` → should print N backfilled
checkpoints, fitness 10K-equiv + 5K/10K/HM/M predictions, and any learned response sensitivities.

### CHECKPOINT-SELECTION FIX (2026-06-04, after first window.hubDebug() showed 0 checkpoints)
First live run returned 0 — the original `defaultIsCheckpoint` required name/flag "race"/"tempo",
but real activities are plain `activityType:'running'`, names like "Morning Run", NO race flag, often
NO avgHR. REPLACED with `defaultSelectCheckpoints(activities)` (backfill.js) mirroring
tileMetrics.findEmpiricalRaceAnchor: a run qualifies if (1) explicit race (isRace/type'race'), OR
(2) standard-distance (±5% of 5/10/21.0975/42.195km) AND hard (avgHR≥85%max OR pace≤92% of median
≥16km long-run pace), OR (3) quality long run ≥10mi. Gated on isRun() (HYROX excluded). So Emil's
LONG RUNS now seed fitness (honest: easy long → conservative Riegel projection). backfillHub takes
`opts.selectCheckpoints` override. Tests updated (hubBackfill 5/5, hubFacts 3/3 with realistic shapes).
If hubDebug still shows 0 after rebuild → check whether ≥10mi runs exist in synced storage activities.

### ✅ LIVE RESULT (2026-06-04, after rebuild): hub works — but conservatively anchored
`window.hubDebug()` → backfilled **9 checkpoints**, fitness 10K-equiv 3408s (conf 0.86) →
predictions 5K 27:15 / 10K 56:48 / HM 2:05:20 / M 4:21:19; response model empty.
CALIBRATION FINDING (important, not a bug): predictions are ~conservative (M 4:21 vs Emil's real
2× sub-3:47; 10K-equiv ~7-8min slow). WHY: the 9 qualifying checkpoints were all QUALITY LONG RUNS
(easy training pace), no hard race efforts / no avgHR in the data → Riegel from easy pace projects
slow (same conservatism as the existing tier-2 anchor). Response empty because no graded races with
confounders yet. SELF-CORRECTS once a real race or HR-bearing fast effort is logged (a result faster
than the conservative estimate = overperformance = fitness signal that lifts it).
IMPLICATIONS for the deferred UI-surfacing step:
  • DON'T surface these predictions in the Coach without a "training-anchored / conservative" caveat
    (or until race-calibrated) — they read ~35min slow on the marathon and will look wrong to Emil.
  • 0.86 confidence reflects DATA VOLUME, not race accuracy — consider a separate "race-calibrated
    confidence" (low until a real race effort anchors it) before surfacing assertively.
  • Possible refinement: down-weight pure easy-long-run reads further, or require effort/HR for full
    fitness precision, so the estimate stays humble until a real effort calibrates it.
This is the calibration loop behaving correctly on training-only data; it is the expected v1 state.

### PREDICTOR INCONSISTENCY found 2026-06-04 (Emil: FOLD INTO HUB later, do NOT band-aid now)
Same race, two different predictions in the existing app: Races page Queens 10K = 49:23, Trend
"Race Predictor" KRI = 1:01:40. ROOT CAUSE (diagnosed, not the hub): two independent predictor paths.
  • Races page (GoalsHub/CalendarTab) → predictRaceFinish → findEmpiricalRaceAnchor = SINGLE BEST
    anchor (fastest demonstrated effort) + personal fatigueExponent k → 49:23 ("what can you race?").
  • Trend racePredictor (tileMetrics.js L898 metric; displayed value from its `timeframes()` L1015-1053)
    → `mode:'avg'` over `riegelPredictFromRun(a, fieldKey)` for ALL runs → AVERAGES every run's 10K
    projection, dragged slow by easy runs → 1:01:40. (Also note compute().value hardcodes headline.tHM
    at L984 — a separate latent oddity.)
DECISION: don't tactically patch the Trend metric. Instead, when the hub becomes the single predictor,
route BOTH Races + Trend through predictFromFitness (one fitness model → one number everywhere). This
inconsistency is the canonical motivation for the hub-as-single-source-of-truth. Tracked here.

### NEXT (deferred — paused here per Emil)
1. Coach-UI surfacing: show hubFacts ("for you, heat ~X%/°C"; hub predictions) in the Coach/EdgeIQ —
   the careful render edit, do when mount is stable.
2. Persist-on-boot: load hub:state on app boot, recordRace when a race grades, saveHubState — so it's
   incremental, not re-backfilled each call. (Currently hubDebug re-backfills read-only.)
3. Wire personal k: feed the existing fatigueExponent fit into buildHubFromStorage instead of 1.06.
4. Coaching-Team / Plan-Generator consume hub state (predictFromFitness, hubFacts, response model).
⚠ Stale-mount keeps truncating Arnold.jsx + edited test files mid-write — re-emit via bash heredoc,
strip NULs, verify Windows file via Read tool. Bash writes = reliable mount channel.

## Intelligence Hub — core loop, cut 4 (2026-06-04) — REAL RACES → FITNESS LEDGER

## ★ Intelligence Hub — core loop, cut 4 (2026-06-04) — REAL RACES → FITNESS LEDGER
Connected logged races to the fitness ledger and made the accumulated fitness predict. Pure logic,
tested: `node arnold-app/tests/hubRaceFitness.test.mjs` → 5/5; full hub suite (hubCore 11 +
hubIngest 8 + hubState 7 + hubRaceFitness 5) = 31/31, all executed. Still no app wiring.
- **`src/core/hub/raceFitness.js`** — Riegel inversion consistent with tileMetrics.js (T2=T1·(D2/D1)^k).
  Hub fitness scalar = `ref10kEquivSecs` (race normalized to 10K via personal k). Exports:
  `raceEquivSecs(distKm,secs,k)`, `observationsFromRace(race,{k})` → paramObservations,
  `predictFromFitness(fitnessModel,targetKm,{k})` → predicted secs+confidence (unfolds the scalar),
  `recordRace(hubState,race,attribution,{k})` → recordCheckpoint (both ledgers). k defaults 1.06;
  pass the personal fatigueExponent k when known. NON-running results (HYROX, no dist/time) → skipped.
- **ROUTER DECOUPLE (design fix, ingestCheckpoint.js rewritten):** fitness updates no longer require
  a prior expectation — a race is a direct fitness measurement, so a FIRST race seeds fitness. Only
  the RESPONSE ledger needs a residual (divergencePct>0). gradeCheckpoint now returns
  {obsPrecision (=cleanliness×effort, always), hasExpectation, responseable}. Updated hubIngest tests
  (now 8: added "first race seeds fitness w/o prediction" + "no fitness obs → nothing moves").
- Proven round-trip: log a 40:00 10K → predicts the 10K back AND a ~1:28 HM via personal k.
- ⚠ Stale-mount truncated ingestCheckpoint.js + hubIngest.test.mjs mid-write AGAIN; re-emitted via
  bash heredoc, re-ran clean. Windows files authoritative/correct. (Bash writes = reliable mount channel.)
HUB STATUS: Estimate → response+fitness ledgers → router → persistent hubState → race↔fitness I/O.
NEXT: (1) BACKFILL — replay historical races through recordRace to seed both ledgers from day one;
(2) app WIRING — load hub on boot, recordRace when a race is graded, save, surface response facts +
hub predictions in the Coach/predictor; (3) wire personal k from existing fatigueExponent into the
hub calls; (4) Coaching-Team / Plan-Generator consumption.

## Intelligence Hub — core loop, cut 3 (2026-06-04) — PERSISTENCE

## ★ Intelligence Hub — core loop, cut 3 (2026-06-04) — PERSISTENCE
The hub now accumulates across sessions (the point of "learning over time"). Pure logic, tested:
`node arnold-app/tests/hubState.test.mjs` → 7/7; full hub suite (hubCore+hubIngest+hubState) = 25/25,
all executed in sandbox. Still no app wiring (nothing imports core/hub/* → zero build risk).
- **`src/core/hub/hubState.js`** — `createHubState({fitnessPriors})`; `recordCheckpoint(state,
  attribution, opts)` → {state, ingest} (runs the router, folds ledgers back, appends a compact
  dated log entry capped at 200, sets lastUpdated); `serializeHubState`/`deserializeHubState`
  (JSON round-trip + version migration; deserialize is PARANOID — junk/corrupt-estimate/future-
  version all → clean fallback via `coerceEstimates`); `saveHubState(state, store)` /
  `loadHubState(store)` take an INJECTED store ({get,set}) so the module stays node-testable —
  the app passes the real `storage` from core/storage.js. Key: `hub:state`, version 1.
- Proven: a 2nd hot-race obs grows heat-sensitivity confidence; survives serialize→store→reload.
HUB STATUS: spine complete — Estimate → responseModel + fitnessModel → ingestCheckpoint router →
hubState (persistent, accumulating, self-healing). All core/hub/*, unwired from the app.
NEXT (still unbuilt): (1) race→param INVERSION — derive paramObservations from a real logged race
via predictRaceFinish (connects real data to the fitness ledger; the one caller-supplied gap left
in cut 2); (2) BACKFILL — replay historical graded efforts through recordCheckpoint to seed the
response model; (3) app WIRING — load hub state on boot, recordCheckpoint when an effort is graded,
save; surface response-model facts in the Coach ("for you, heat ~X%/°C"); (4) Coaching-Team /
Plan-Generator consumption of hub state.

## Intelligence Hub — core loop, cut 2 (2026-06-04) — LOOP CLOSED

## ★ Intelligence Hub — core loop, cut 2 (2026-06-04) — LOOP CLOSED
Added the fitness ledger + the router that ties both ledgers together. All pure logic, tested:
`node arnold-app/tests/hubIngest.test.mjs` → 7/7, plus cut-1 `hubCore.test.mjs` 11/11 = 18/18, all
actually executed in sandbox. No app wiring yet (nothing imports core/hub/* → zero build risk).
- **`src/core/hub/fitnessModel.js`** — params as Estimates; `updateFitness` with sanity clamps:
  ABSOLUTE bounds reject impossible values (fatigueExponentK ∉ [1.0,1.25] → rejected, model
  unchanged), RATE bound clamps implausible weekly shifts (thresholdPaceSecPerKm ≤4 s/km/wk →
  clamped + flagged). Returns {model, log} (explainable: prior, obs, appliedObs, clamped, reason).
- **`src/core/hub/ingestCheckpoint.js`** — the ROUTER + `gradeCheckpoint`. Grades a checkpoint's
  fitness precision = cleanliness × effort (cleanliness = 1/(1+Σ acute confidence); effort hard=1
  / tempo=0.5 / easy=0.25; no-expectation → 0/not gradeable). Then: fitness update at graded
  precision + residual→response (ONLY when divergencePct>0; overperformance = fitness signal,
  not "the heat helped"). Returns {fitnessModel, responseModel, log{grade,fitness,response,summary}}.
  Consumes attributeOutcome shape {verdict,divergencePct(signed fraction,+=slower),effort,acute[],chronic[]}.
- KEY proven property: a confounded 3%-slow race moves fitness <0.5s (precision-damped) AND routes
  the 3% to the response model split heat/sleep — the two-ledger principle in one test.
NEXT cut (HUB_CORE.md build sequence): persistence (store/restore ledgers in storage), backfill
from history (replay graded efforts to seed the response model), recency-decay scheduling, then
the race→param inversion (derive paramObservations from a real race result via predictRaceFinish),
then Coaching-Team / Plan-Generator consumption of hub state. NOTE: paramObservations are currently
caller-supplied (cut 2 didn't build the race→threshold inversion — that's the next concrete piece).

## Intelligence Hub — core loop, cut 1 (2026-06-04)

## ★ Intelligence Hub — core loop, cut 1 (2026-06-04)
Emil chose "build the hub core loop (two-ledger + response model)" as the next foundation.
This is the FIRST real code of the Intelligence Hub itself (not UI). Pure logic, unit-tested
(`node arnold-app/tests/hubCore.test.mjs` → 11/11 pass, actually executed in sandbox).
- **`docs/HUB_CORE.md`** — design: the loop (grade cleanliness → fitness update + residual→response
  → decay → log), schemas, residual-partitioning math, guardrails, build sequence. Grounded in
  INTELLIGENCE_HUB.md "Calibration math" + attribution.js output shape.
- **`src/core/hub/estimate.js`** — Bayesian `{value, precision}` primitive: `updateEstimate`
  (precision-weighted blend — naive prior moves a lot, established prior barely moves; "one 10K
  shouldn't rewrite history" falls out of the math), `decayPrecision` (half-life recency),
  `confidence` (saturating p/(p+k0), gates coach assertiveness).
- **`src/core/hub/responseModel.js`** — the SECOND ledger. `observeOutcome(model, divergence,
  factors)` partitions the residual across ACUTE attribution factors by magnitude·confidence →
  accumulates per-confounder sensitivity (fraction-per-unit); `predictPenalty(conditions)` →
  "expect ~2% slower: heat ~1.5%, sleep ~0.5%" with confidence; `sensitivityOf`. Consumes the
  attribution factor shape `{factor,timescale,magnitude,confidence}`. Shares sum to residual
  (no double-count); chronic/empty/zero inputs are no-ops.
NEXT cut (per HUB_CORE.md build sequence): `fitnessModel.js` (params as Estimates + sanity clamps)
+ `ingestCheckpoint.js` (the router: takes {predicted, actual, attributeOutcome result} → grades
cleanliness → updates fitness + response → explainable log), with a fixture test over a real
graded effort. Then persistence + backfill from history, then Coaching-Team/Plan-Gen consumption.

## Narration Layer (guided local-LLM "one voice") — built + validated, DEPLOYMENT DEFERRED (2026-06-04)

## ★ Narration Layer + local-LLM experiment (2026-06-04)
Explored using a small local model (HuggingFace/LM Studio) as Arnold's narrative voice.
Tested 3 phone-realistic models on real data (free-form, raw JSON):
- **Qwen 3 8B** — faithful but vague; BURIED the key signal (overreaching rTSS).
- **Phi-4-mini 3.8B** — numbers correct, best-ish salience, but LEAKED JSON keys + INVENTED
  "a session on Monday" (true hallucination).
- **Gemma 3 4B** — WARMEST + BEST salience (caught the A:C 0.43 vs rTSS 171 tension), but
  MISREAD calorie target as intake (said "high" when 380 under) + leaned on chat memory.
Conclusion: all faithful on explicit numbers; NONE safe doing selection / interpretation /
free generation. **Chosen narrator: Gemma 3 4B.** Each failure = the model doing a job it
shouldn't (select / interpret / invent) — all removed by a guided contract.
- **New doc: `arnold-app/docs/NARRATION_LAYER.md`** — the guided design + paste-ready test kit:
  the **narration contract** (engine → narrator: pre-interpreted, pre-numbered, ordered
  `must_mention` + `may_mention` + `closing`; cross-day context supplied, never recalled), the
  guided **system prompt**, two worked examples (HYROX day + sparse rest day), and the wiring
  (templates now → arbiter emits the contract later; the contract IS the arbiter's output shape,
  per COACHING_TEAM.md §3 "one voice"). Calls LM Studio local server (localhost:1234) for proto.
- Also at workspace root: `LLM_NARRATIVE_TEST.md` (the original FREE-FORM test kit).
VALIDATED 2026-06-04: ran the guided prompt on Gemma 3 4B and iterated the prompt 3× — each
iteration closed one failure channel (calorie misread → fixed by pre-interpreted contract;
invented "75%" number → fixed by no-new-numbers rule; invented hydration/nutrition advice +
padding → fixed by no-advice/no-padding rule). FINAL Example-B output was CLEAN: every number
from the contract, no invented number, no invented advice, no padding, warm voice, natural
closing. Recipe proven end-to-end on a 4B phone-sized model:
deterministic engine → guided contract → tightened narrator prompt → number-validator backstop.
NEXT BUILD: engine-side `core/narration/` module — (1) contract templater that assembles
must_mention (pre-interpreted, pre-numbered, priority-ordered) from the presentation-layer
registry values + attribution.js output + closing; (2) the deterministic number-validator
(allowed-number set from contract → regex output → reject/regen on stray number). Emil wires the
actual LM Studio / on-device call. (No app code shipped this session — design + experiment only.)

## Presentation Layer Pass 1 — EdgeIQ web driver rail (2026-06-04)

## ★ Presentation Layer Pass 1 — EdgeIQ web driver rail (2026-06-04)
Scope chosen by Emil: "Registry-fy web EdgeIQ tiles" (NOT unify web+mobile — they show different
things: web = MiniStat driver rail, mobile = Health Systems scorecard; left mobile alone).
- **New: `src/core/presentation/edgeiqRegistry.js`** — `EDGE_SIGNALS` (one def per signal:
  domainActivity/Nutrition/Body, acwr, rtssToday, weeklyLoad, calLeft, proteinLeft, glycogen,
  hrv, sleep, weight — each carries label/type/tier/valuePx/fmt + a `select(bag)` for value+sub+
  history); `resolveEdgeStat(id, bag)` → props for the existing `<MiniStat>`; `EDGE_RAIL` =
  declarative column layout (domain col · sep · Activity · Nutrition · Body brackets).
  `display` field handles tiles whose shown text ≠ color-driving value (Glycogen word, Sleep h/score).
- **Arnold.jsx**: import added (~L62); web EdgeIQ render (~L10383) now builds an `edgeBag` (the
  already-computed values + sparkline histories + rtssBand helper) and maps `EDGE_RAIL` →
  RailColumns/MiniStats via resolveEdgeStat. The 4 hand-written RailColumns were deleted. The
  `MiniStat`/`RailColumn`/`Sep` renderers AND the trailing Action+Race column (bespoke ✓/race JSX)
  are unchanged.
- Intended: ZERO visual change — same tiles, same values, just sourced through the registry.
- Full file parses clean. NOT visually build-verified — rebuild from Windows + eyeball EdgeIQ.
- ⚠ Stale-mount NULs recurred (2089); stripped + Windows file confirmed clean (now 11492 lines).
NEXT options: (a) the special Action+Race tiles could join a registry later; (b) Start tiles /
session-detail surfaces; (c) mobile EdgeIQ is deliberately NOT registry-fied (different surface).

## Presentation Layer Pass 0b COMPLETE — whole hero band shared (2026-06-04)

## ★ Presentation Layer Pass 0b — ContextCluster (2026-06-04) — HERO BAND FULLY SHARED
Extracted the readiness rings + A:C chip (the `context` role) into a shared component. With
this, ALL THREE hero-band roles are now declaration-driven and shared by the web Daily hero
and the mobile Play hero: context (ContextCluster) · headline (LoadGauge) · primary (MetricCluster).
The hero band can no longer drift between platforms — platform = a surface profile only.
New files:
- `src/core/presentation/readinessTokens.js` — `ZONE_COLORS`, `ZONE_LABELS`, `ZONE_LABELS_SHORT`
  (short A:C labels so "Under-training"→"Under" on compact), `ringColor(s)` (70/45 hex thresholds
  + null guard, matches the hero ring scoreColor). Moved here so a component can share them
  without importing back from Arnold.jsx (cycle).
- `src/components/ContextCluster.jsx` — 7d/30d rings + A:C chip, sized by surface profile.
Arnold.jsx changes:
- Imports added (~L60): ContextCluster + `{ ZONE_COLORS, ZONE_LABELS }` from readinessTokens.
- Module-level `const ZONE_COLORS`/`ZONE_LABELS` (was ~L4181) DELETED → now imported (all existing
  refs across EdgeIQ etc. resolve to the import unchanged).
- Mobile Play hero left cluster (~L6376): MiniRing×2 + inline A:C IIFE → `<ContextCluster ...
  surface="play-hero"/>`. (The inline `MiniRing` def ~L6198 is now dead but left in place — harmless.)
- Web Daily hero readiness col (~L6499): inline rings map + A:C → `<ContextCluster ...
  surface="daily-hero"/>`. "Training Readiness" header kept.
Intentional unifications (eyeball on rebuild): web ring labels now "7d"/"30d" (were "7-day"/
"30-day"); web A:C chip is now the vertical stack (ratio / zone / "A:C ratio") like mobile, instead
of ratio+label inline. Mobile A:C unchanged in spirit (still short labels via ZONE_LABELS_SHORT).
- Full file parses clean. ✅ BUILD-VERIFIED on web & mobile 2026-06-04 (Emil confirmed all in order).
- ⚠ Stale-mount NULs recurred AGAIN (3746); stripped + Windows file confirmed clean (now 11516 lines).

## Presentation Layer Pass 0b — LoadGauge (2026-06-04)

## ★ Presentation Layer Pass 0b — LoadGauge (2026-06-04)
Extracted the hero speedometer into `src/components/LoadGauge.jsx` (the `headline` role).
One self-contained component replaced the two inline SVG copies (web Daily hero + mobile
Play hero). Props = the gauge MODEL: `value, max, breaks, zoneNames, label, unit, surface`.
It computes its own geometry (cx/cy/R, arcs, needle, zoneIdx, display) internally.
- Wiring (Arnold.jsx): import added (~L58); mobile gauge block (~L6434) and web gauge block
  (~L6522, inside the tooltip+order:2 wrapper) both replaced with `<LoadGauge ... surface=
  "play-hero|daily-hero" />`; the shared geometry block (was ~L6132-6161) DELETED — the gauge
  MODEL vars (gaugeValue/gaugeMax/gaugeBreaks/gaugeZoneNames/gaugeLabel/gaugeUnit, ~L6110-6130)
  stay and feed LoadGauge.
- BUGFIX via unification: the old MOBILE gauge hardcoded the label "rTSS" even on Tonnage days;
  LoadGauge uses the real `label`(+unit), so mobile now correctly shows "Tonnage · lbs" / "Load".
  (rTSS days unchanged — still "rTSS".) Mobile Tonnage value font is 15 (was 18) on big numbers.
- Full file parses clean (@babel/parser). NOT visually build-verified — rebuild from Windows.
- ⚠ Stale-mount NUL corruption recurred (5449 trailing NULs on the bash mount); stripped with
  `tr -d '\000'`, Windows file confirmed clean via Read tool. (See the stale-mount note below —
  this keeps happening after large edits; always strip+reparse before trusting a full-file parse.)
NEXT (still Pass 0b/1): ContextCluster (rings + A:C) needs `ZONE_LABELS`/`ZONE_COLORS`/`scoreColor`
moved to a shared module first (they live in Arnold.jsx module scope, not exported) — that's the
one extra plumbing step before the context role can be a shared component. Then EdgeIQ/Start/detail.

## Presentation Layer Pass 0 — registry + MetricCluster (2026-06-04)

## ★ Presentation Layer Pass 0 — BUILT (2026-06-04)
First consumer of docs/PRESENTATION_LAYER.md. The session-quality cluster (the reps/tempo
tiles) is now declaration-driven and SHARED by the web Daily hero and the mobile Play hero.
New files:
- `src/core/presentation/metricRegistry.js` — format/label/tier SoT per metric. Centralizes the
  run IF/EF tier logic + EF-vs-30d verdict that was DUPLICATED inline in both heroes. `select(bag)`
  per metric returns a tile descriptor; `selectMetrics(ids, bag)` resolves an ordered list.
  Value bag = `{ runMetrics, strengthMetrics, ef30Avg }` (pre-resolved; this layer only formats).
- `src/core/presentation/storySpecs.js` — `STORY` (per-kind role→metric-ids: run→pace/effortIF/
  efficiency, strength&hybrid→density/workRest/effortPct), `kindFromBag`, `primaryIdsFor(bag)`,
  `SURFACE` profiles (`play-hero`=compact/short, `daily-hero`=comfortable/full), `profileFor`.
- `src/components/MetricCluster.jsx` — the ONE renderer. Owns layout (row+wrap, gap, font sizes via
  DENSITY tiers, short-vs-full label via profile). Pass-0 scope = the `primary` role only.
Wiring in Arnold.jsx:
- Imports added (~L57): MetricCluster, primaryIdsFor, selectMetrics.
- Mobile Play hero (~L6387): deleted the inline runTiles/strengthTiles builders; now builds
  `heroBag` + `primaryIds`, gates the right grid cell on `selectMetrics(...).length`, renders
  `<MetricCluster ... surface="play-hero" align="end"/>`.
- Web Daily hero (~L6659): deleted the inline cells IIFE; same `heroBag`/`primaryIds`, renders
  `<MetricCluster ... surface="daily-hero" align="start"/>` inside the bordered order:3 cell.
- Full file parses clean (@babel/parser). ✅ BUILD-VERIFIED on device 2026-06-04 (Emil rebuilt;
  both heroes render correctly, nothing out of sync).
Behavior notes / intentional unifications:
- EF-vs-30d sub text is now ONE wording ("↑ X% vs 30d" / "↓ X% vs 30d" / "≈ 30d avg") — was
  longer on web, shorter on mobile. Tile VALUE color is now neutral (text-primary) on both; the
  tier color rides the SUB line (web already did this; mobile previously colored some values).
- Gauge (headline) + rings/A:C (context) still bespoke — they fold in at Pass 0b/1.
NEXT (Pass 0b/1, pending Emil's call): extract the load gauge into a shared `<LoadGauge>` (headline
role) + a `ContextCluster` (rings+A:C), then EdgeIQ/Start/detail surfaces. Pass 2 = arbiter emits
the story specs (COACHING_TEAM.md) and templates become live reasoning.

## Presentation Layer — design doc (2026-06-04)

## ★ Presentation Layer — design doc written, NEXT decision pending (2026-06-04)
Emil stepped back from per-screen pixel tweaks (reps/tempo side-by-side, "Under-training"
wrap, etc.) and named the real problem: we hand-author presentation for every
**activity kind × surface × platform** combo — that's whack-a-mole and not what the vision
says the screens are for. The screens should be layer 3 (ONE VOICE / presentation) of the
Coaching Team, telling the hub's story, not a grid we re-tune by hand.
- **New doc: `arnold-app/docs/PRESENTATION_LAYER.md`** — defines the fix: a metric registry
  (one format SoT per metric, extending METRIC_OVERLAP_AUDIT's value-SoT), a per-activity-kind
  STORY CONTRACT (metrics tagged headline/primary/secondary/context), and ONE responsive
  `MetricCluster` renderer that owns all layout (direction/wrap/gap/label-length) driven by a
  SURFACE PROFILE (density). Platform = a profile param, not a code fork. The story shape =
  the arbiter's output shape, so we build the rendering contract now and the hub fills it later.
- **Pass 0 proposed:** prove it on the hero band — re-point BOTH web Daily + mobile Play heroes
  at the same MetricCluster w/ different profiles, so they can't drift and reps/tempo + wrap
  become declarations, not JSX.
- **PENDING Emil decision** (5 open questions in the doc §"Open decisions"): Pass-0 scope,
  where code lives, density auto-vs-fixed, role-vocab depth, message ownership. He said
  "write up and then we'll decide where/how to take it forward" — so the doc is the deliverable
  for this turn; next session resumes from his answers to those 5 questions.
- Tactical state: the reps/tempo fix (mobile right cluster → `flexDirection:'row'`) is IN as a
  stopgap; it'll be superseded by the MetricCluster when Pass 0 lands.

## Mobile Play hero — declutter the readiness band (2026-06-03)

## Mobile Play hero — declutter the readiness band (2026-06-03)
User screenshot: mobile Play hero band (`Arnold.jsx` ~L6441, the `1fr auto 1fr` grid)
rendered cramped — A:C "Under-training" wrapped to two lines, side metrics crowded/clipped
the card edges. Mobile-only (this band is above the web section, untouched by the web change).
- **A:C chip** (~L6446): added a short single-word zone map for the narrow chip
  (`{optimal:'Optimal', undertraining:'Under', overreaching:'Over', danger:'Danger'}`) +
  `whiteSpace:'nowrap'`, so it stops wrapping and stops blowing out the left cluster width.
  Global `ZONE_LABELS` left untouched (web/Daily still shows the full words).
- **Right cluster** (~L6493): tiles now stack value / unit / label VERTICALLY with `nowrap`
  (was value+unit inline, which was wide and crowded the gauge / clipped the edge).
- Gauge stays dead-center (grid `1fr auto 1fr` centers the auto column regardless of side widths).
- NOT visually build-verified — rebuild from Windows. JSX balance confirmed (band parsed clean in isolation).

### ⚠ Sandbox mount went STALE mid-session (read this if babel/build looks wrong)
After the mobile edits, the sandbox-mount copy of Arnold.jsx FROZE at a truncated 11764 lines
(ended mid-object at `ait:{`), so `@babel/parser` in the VM reported phantom EOF errors that
DID NOT exist in the real file. The Read tool (Windows path) showed the correct 11770-line file
ending in `};`. Lesson: the Edit/Read tools = authoritative Windows path (what the user builds);
the bash `/sessions/.../mnt/...` mount can lag/truncate. To validate JSX when the mount is stale,
copy the edited region into a /tmp file and parse THAT in isolation (worked here). Don't trust a
full-file bash parse when `wc -l` on the mount disagrees with the Read tool's last line number.

## Web Daily hero — mirror mobile 3-col band (2026-06-03)
Reorganized the WEB Daily hero (`Arnold.jsx` ~L6542 `<section>`) so it mirrors mobile:
ONE hero rail, two top-level columns — a LEFT readiness band and the Coach digest RIGHT.
- **Outer grid** now `minmax(0,1fr) minmax(0,1fr)` (was `1fr 1.45fr`) so the Coach column's
  left border lines up exactly with the divider between the Activity and Nutrition tiles below
  (that grid is also `1fr 1fr`, same gap) — the symmetry the user asked for.
- **LEFT band** is a 3-col grid `minmax(0,1fr) auto minmax(0,1fr)` with CSS `order` placing:
  readiness numbers (rings + A:C, `order:1`) LEFT · speedometer (`order:2`) CENTER ·
  session-quality cells (Pace/Effort/Eff or Density/W:R/Effort, new `order:3` cell) RIGHT.
  Achieved by splitting the old single readiness COL2 row: rings+A:C stay in the left cell,
  the cells IIFE moved out into its own right-cell `<div>`.
- **Dead readiness-narrative IIFE deleted** (it already `return null`'d since narrative.5.fix.30).
- Coach (`<CoachComment surface="daily_digest"/>`) is the outer grid's 2nd column, unchanged.
- JSX verified balanced + full file parses clean via `@babel/parser` (sandbox node).
- WEB-ONLY; mobile (`MobileHome.jsx`) untouched. NOT visually build-verified — rebuild from Windows.

### ⚠ NUL-corruption recovery (same session)
After the edits the file failed to parse ("Unexpected character ' '" at EOF). Root cause: the
file had **3061 trailing NUL bytes** appended (a stale-mount/partial-write artifact, not lost
code — content was intact). Fixed with `tr -d '\000'`. If a future window sees a parse error at
the very end of a big file on a line that looks like blank spaces, check for trailing NULs
(`tr -cd '\000' < f | wc -c`) before assuming a real syntax bug. Confirmed clean via Read tool
(Windows-visible path) afterward.

## Race-day fixes (2026-06-03, race-pre signature image + Coach race-name)

## Race-day fixes (2026-06-03, from HYROX race day)
- **Mobile pre-race tile had no image** — `PlannedWorkoutTile.jsx` `race-pre` block was the ONLY state lacking a `SessionSignature` corner-stamp (it only rendered SectionHeader + SplitTopPanel). Added the signature (family='race'/planType='race' → SIGNATURE_SRC.race = race.png). `Card` is position:relative so the absolute stamp anchors fine.
- **Coach said "your HIIT" on race day** — HYROX classifies as HIIT via activityKind. Fixed in `CoachComment.jsx`: both `composeDigest` (Daily) and `composePlayLine` (Play, via `classifyPlayState` ctx.raceName) now use the race NAME when `raceHorizon.daysOut===0 && race.date===us.asOf`. Daily: "Race done — you raced {name} today 🏁"; Play post-workout/logged_earlier name the race. Falls back to activity label on non-race days.
- NOT build-verified — rebuild from Windows terminal.

## Race-card-won't-drop-after-HYROX fix (SHIPPED 2026-06-03)
The pre-race card lingered after the race because "race done" detection was RUN-ONLY (`isRun(a)`), but HYROX logs as strength/cardio, not run. Fixed in THREE places, all broadened to "any non-mobility activity ≥30min or ≥5mi on the race date":
- `PlannedWorkoutTile.jsx` `raceLogged` fallback (~L205) — flips Play/web tile race-pre → race-complete.
- `Arnold.jsx` Play race card gate (~L6222, `_raceDoneToday`) — drops the mobile Play RaceFocusCard.
- `Arnold.jsx` web EdgeIQ race card gate (~L10761, `_raceDoneToday`) — drops the web RaceFocusCard.
Each now hides the card immediately once the race is logged, not at midnight.
"vs usual" panel — REAL fix 2026-06-03: the dense inline IIFE had a SYNTAX ERROR (Uncaught SyntaxError 'Unexpected identifier vsusual') that crashed the whole block → nothing rendered, and made all my data-shape theories moot (code never ran). FIX: extracted to a clean top-level `SessionVsUsual({fd,todayStr,divider,subHdr})` component (~Arnold.jsx L4192, before TrainingStressPanel), called from the strength panel's last-panel slot. Always renders when fd has duration; shows today's stats (Duration/AvgHR/Load) labeled "logged", upgrades to "+X% vs usual" deltas once ≥2 prior same-type sessions exist. Uses classifier FUNCTIONS not fd.* properties. LESSON: stop hand-writing dense inline IIFEs in JSX — extract to components.
- **2nd reason it didn't show (found after the syntax fix):** there are TWO `fitGroups.map` strength-render paths in Arnold.jsx (~L6896 the Daily/desktop card, ~L7298 the alternate). The panel was only added to the L7298 one; user's Daily screenshots render via L6896. NOW added to BOTH (L7072 after that path's VS-GOAL IIFE, + L7385).
- **3rd fix — comparison bucket too broad (RENDERS NOW, showed bogus +151%/+184% deltas):** `sameType` for HIIT matched all interval RUNS via isHIITAct, so HYROX compared against short interval runs ("15 similar sessions", absurd deltas). FIXED: distinct buckets — hybrid↔hybrid ONLY (isHybridAct, checked first), HIIT excl. hybrid, strength excl. hybrid, run excl. HIIT+hybrid. `typeKind` drives the label. HYROX now reads "Today's hybrid session · 0 prior · logged" (no baseline) instead of comparing to runs. PANEL CONFIRMED RENDERING on Daily.

## Speedometer redesign — rTSS out + zone label + cluster legibility (2026-06-03)
Per user: hero wasn't rendering cleanly, mobile missing the OVERREACHING zone message web has, and rTSS should come OUT of the dial.
- **rTSS relocated out of the dial** (BOTH web ~L6592 + mobile ~L6466): dial now shows needle + metric label only; rTSS value moved to a small caption line BELOW, under the zone status.
- **Zone label added to MOBILE hero** (`zoneLabel` = OVERREACHING/OPTIMAL/etc., needleColor-tinted) — mobile now matches web which already had it (~L6594).
- **Right cluster legibility**: was cramped horizontal rows; now vertical stack — value (13px) + inline sub-tier + uppercase label below. More breathing room (gap 3, paddingLeft 8). Wrapped center dial+labels in a flex column so zone/rTSS sit under the gauge in the 3-col grid.

## ★ HYROX/hybrid ROOT FIX (2026-06-03) — ended the whack-a-mole
After patching "HYROX excluded from strength" in 5+ surfaces one-by-one, did the root fix. NEW `isStrengthVolume(a)` in `activityClass.js` = `isStrength(a) || isHybridWorkout(a)`. KEY DESIGN: kept `isStrength()` PURE (unchanged) for CLASSIFICATION (calendar icon/family, activityKind route hybrid→'hiit' first BY DESIGN — changing isStrength would break HYROX's icon). `isStrengthVolume` is the single source of truth for VOLUME/TRACKING surfaces.
- Audited all isStrength usages. Switched VOLUME surfaces to `isStrengthVol`/`isStrengthVolume`: Arnold.jsx strength hero cluster (L6024), 2× weekly strength rollups (L7079, L7409), ytdStrength (L3662), wk7Str (L8580); MobileHome.jsx thisWeekStr (L119), recent30Str (L129).
- LEFT untouched (classification/display): fd.isStrength label rendering, calendar activityFamily (hybrid→hiit icon is intentional), isPureRunningRace (predictor already handles hybrid). 
- Verify after build: HYROX counts toward strength minutes/sessions/YTD everywhere; still shows HIIT-family icon on calendar; predictor still excludes it.

## Mobile round 3 (2026-06-03)
- **Strength hero cluster missing on HYROX** (this screenshot) — `strengths = todayActs.filter(isStrengthAct)` excluded HYROX → strengthMetrics null → no right cluster. Now uses `isStrengthVol` (root fix above).
- **vs-usual didn't render on MOBILE** — duration guard read `fd.durationSecs` but grouped/mobile objects may carry only `durationMins`. Now derives `fdDurSecs` from either.
- **HYROX still on START hero (badge + RACE card)** — `MobileHome.jsx` data hook `nextRace` (~L282) filtered `d>=today`, including race day. Added `_raceDoneOn(rDate)` (any non-mobility ≥30min/≥5mi logged on race date) to the filter → Start badge + RACE perf card drop once logged. (3rd surface with this same fix; Play tile + web EdgeIQ done earlier.)
- **Play hero RIGHT cluster for non-run days** — runs show Pace/Effort/Efficiency; strength/HYROX showed nothing (asymmetric). Now builds `strengthTiles` from existing `strengthMetrics`: **Density (work rate) · Work:Rest (energy system) · Effort (%maxHR zone)** — meaningful + distinct from the Duration/AvgHR/AnaerTE tiles already below the hero (per user). `rightTiles = runTiles || strengthTiles`; empty div only when neither exists.

## Play hero speedometer centering (FIXED 2026-06-03)
On non-run days (e.g. HYROX) the Play hero's RIGHT run-metrics cluster is omitted; the old `space-between` flex then pushed the speedometer to the right edge. Changed to a 3-col grid `1fr auto 1fr` (Arnold.jsx ~L6392) with the RIGHT column rendering an empty `<div/>` when no run metrics — speedometer stays dead-center, left cluster balanced by empty right. justifySelf start/end on the side clusters.

## Race card 7-day window regression (FIXED 2026-06-03)
After HYROX dropped, the NEXT race (NYRR Queens 10K, ~17d out) immediately showed on web EdgeIQ — because that RaceFocusCard used a **60-day** window (`cutoff60`) while the rule (and the Play tab) is **7 days**. Changed web EdgeIQ gate to `cutoff7` (~Arnold.jsx L10760). Now matches the Play tab: race card only within 7 days of race date.

## Daily screen fixes (SHIPPED 2026-06-03)
- **Trend tab icon** — was reusing Core's Pulse; added distinct `Icon.TrendChart` (line-chart trending up) in MobileHome, mapped weekly→TrendChart in WEB_TAB_ICON_CMP.
- **Strength minutes/sessions read 0 on HYROX day** — `isStrengthAct` excludes HYROX (HIIT-run precedence: hyrox matches HIIT_RE + has run distance → isRun true → isStrength false). FIX: weekly strength rollups now count `isStrengthAct(a)||isHybridAct(a)` (both Daily VS-GOAL sites, ~L6938 + ~L7258). HYROX/CrossFit/circuits are resistance-heavy → count toward strength. (`isHybridWorkout` imported as `isHybridAct`; 'hyrox'+'cardio_training' both in HYBRID_RE so works regardless of whether Garmin logged it as hyrox or cardio.)
- **"Today vs your usual" panel (NEW)** — fills the gap below strength VS-GOAL bars / above Nutrition. Compares the logged session vs median of last ≤180d same-type sessions (duration, avgHR, load) as % deltas. Pops when you log; needs ≥3 prior similar sessions. Same-type predicate matches HIIT/hybrid, strength(+hybrid), run(non-HIIT), mobility. (User wanted "how it compares to all such sessions" — daily screen, session-triggered, not weekly-redundant.)

## Web tab bar icons (SHIPPED 2026-06-03)
Web tab bar used unicode glyphs (◈ ⊕ ▦ etc.); now uses the same gamified inline-SVG icon language as mobile. New `WebTabIcon({tabId,color,size})` exported from `MobileHome.jsx` (maps all 9 web tab ids → best-fit `Icon`: training→GemSpark, daily→PspX, weekly→Pulse, races→Calendar, goals→Target, labs→Pipe, clinical→Pulse, supplements→Pill, settings→User). Wired into `Arnold.jsx` TABS map (replaced `{t.icon}` glyph); active=C.acc, inactive=C.s, size 18. (Web has more tabs than mobile's bottom-nav, so couldn't reuse NavIconForTab/TAB_TO_NAV_ID which sends Daily/Trend/Stack/Profile → 'more'.) NOT build-verified.

## ★ NEXT: Surface attribution in the Coach voice (narrative integration) — user wants the "right way"
User asked where/when the attribution narrative appears. Answer: TODAY it's CONSOLE-ONLY (`window.attributionDebug`). User chose to surface it the RIGHT way = via the v2.6 narrative layer (one unified coach voice), NOT a standalone competing card.
- **GOOD NEWS: the narrative layer largely EXISTS already** — `src/core/narrativeComposer.js` has `composeNarrative(userState)`: leverage-point selection (`pickLeverage`/`findProblematicSignals`), causal chains, secondary threads, action + metric-to-watch, a visualization graph, macro context. Rendered via CoachComment (Daily digest / Play / EdgeIQ).
- **The integration task (design first, then build):** attribution is a DIFFERENT kind of input — event-triggered (a run/race just happened) + explanatory (why did THIS go as it did), vs the narrative's standing-state leverage. KEY DESIGN DECISION: does a fresh hard-effort attribution BECOME that day's leverage point, or feed in as a high-priority THREAD the composer weaves into the opening? (This is the arbiter-priority logic from COACHING_TEAM.md.) Get it wrong → coach either ignores the race or fixates on it.
- Recommended next session: read pickLeverage/threads end-to-end, design attribution's slot, then wire `attributeOutcome` output into composeNarrative as a post-activity thread. Connecting two BUILT things, not building from scratch.

## Attribution v2 — SHIPPED 2026-06-03 (`attribution.js`)
Acute/chronic timescale split + honest messaging. Every probe now tags `timescale` (acute=this-day: last-night sleep, HRV, RHR, fuel, heat; chronic=compounding: sleep-debt rolling-7night, load/ACWR). Result returns `acute[]` + `chronic[]` buckets. New `probeSleepChronic` (rolling 7-night deficit). `no-expectation` verdict now honestly says "can't grade — no expectation for this race type" + lists acute factors (was the misleading "no confounders"). Debug helper attaches weather via `fetchWeatherForDate` (day max temp) so heat probe fires. STILL PENDING: response-model quantification (per-factor % contribution) — needs hub stage 3 response model. Re-test: `window.attributionDebug('2026-06-03')` should now show heat (hot day) as acute + week-long sleep as chronic.

## Attribution v2 backlog (original notes from HYROX race-day test) — see INTELLIGENCE_HUB.md §3c
- HYROX logged as "0mi in 5647s" — running distance (~8km) not in `distanceMi` (multisport/other activity). Matters for the response model later (wants the run portion). Log/extract HYROX run distance someday.
- Attribution v1 said "No notable confounders" but really had NO expectation to assess against (hybrid race, not predicted) AND missed heat (weather not attached) + chronic sleep debt (probe is acute-only). Fixes specced in §3c: acute/chronic timescale tags, chronic sleep+load probes, weather attachment, "can't assess" vs "no confounders" messaging, two output buckets (affected-this-effort vs standing-risks), and eventual response-model quantification. Causation comes from the response model across MANY efforts, not one race.

## Last-updated (prior)
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
