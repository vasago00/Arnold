# Coach — Backlog / Known Issues (living log)

Tactical items surfaced during dogfooding, parked for later. Newest first.

## New (2026-07-18, Emil dogfood)

### Predicted finish time doesn't respond to TRAINING — only to racing  (design flaw, not perception)
**Emil:** "If you follow a plan and never race, your target finish time never changes — that's not
reasonable or useful." **Correct, and it's a real gap.** The projection is driven by (a) a learned hub
"fitness" model (`hub.fitness.params.ref10kEquivSecs`) when seeded, else (b) an empirical-anchor fallback
(`findEmpiricalRaceAnchor` → Riegel/`fatigueExponent`, `derive/tileMetrics.js`). The anchor only accepts a
**race-effort at a STANDARD distance** (5K/10K/HM/M ±5%, last 24 wk) or a **quality long run ≥16 km** (last
8 wk). So most real training never moves it: a tempo/interval at a *non-standard* distance (e.g. a 4–6 mi
tempo ≈ 6.4–9.7 km) fails the ±5% standard-distance filter, and easy/long base miles never count. Net: a
normal build (easy + long + non-standard quality) leaves the number frozen for weeks — demoralizing and
wrong, because fitness demonstrably improves across a build.
**Fix direction (to design):** make the estimate training-responsive — ingest quality efforts at ANY
distance (VDOT/Riegel from any hard run ≥ ~3 mi, not just standard distances), aerobic efficiency
(pace-at-HR on easy runs, improving = fitness up), and the chronic-load/fitness trend the app already
tracks; **blend** with the demonstrated-effort ceiling and **cap the drift** so it stays honest (no 3:30
projected off pure easy miles). Show the anchor + "as of <date>" for provenance. Physiology: consistent
training raises CTL/aerobic base → race potential improves without racing (this is what Garmin/TP predictors
approximate). **Decision needed** on how far to let training-driven drift move the number vs demonstrated
evidence.

### Photo food logger — must actually work  (optimization)
The Photo mode (AI vision → macros) needs to be functional and optimized, not a stub. Pair with the Log Food
panel cleanup already parked in the sprint doc.

### Barcode scanner — cannot invoke the device camera
On mobile the barcode scanner doesn't open the native camera. Needs the Capacitor camera/permission wiring so
scanning actually launches the device camera.

### Pre/Post workout card (mobile) — doesn't show TWO planned sessions
The Play pre/post card shows only one planned workout/run; on a day with two planned sessions (e.g. run +
strength, or double) it can't show both. **Emil has a design in mind** that handles two. Design → build.

### Redesign the Training Profile (RecipePath)
The Training Profile surface needs a redesign (pairs with the finish-time rework above, since it headlines
the projected-vs-goal finish + weak link). Scope with mocks.

### Mobile density — "everything is huge"
The mobile UI reads oversized (card padding / fonts / spacing). Do the governed-density pass already parked
in the sprint UI/UX track (Start/EdgeIQ density refresh + Card/Button/MetricTile primitives). Confirm global
vs per-screen with Emil.

### storage.js `encryptValue` stack overflow on `garmin-sleep`  (pre-existing crash)
From the 2026-07-18 error screenshot: `arnold: encrypt flush failed for arnold:garmin-sleep RangeError:
Maximum call stack size exceeded at encryptValue (storage.js:116)`. Unrelated to the coach work; a real
recursion/size bug in the encrypt path for the garmin-sleep key. Trace + fix.

### EdgeIQ→Play transition felt slow on mobile  (mitigated — verify)
After the `todayPlanned.planned.type` fix made Play use the narrative engine, Play began triggering on-device
Gemma inference on the transition → jank. **Mitigated:** model registration + inference now deferred to idle
after a ~450ms settle (`CoachComment` + `core/perf.js`). Verify on device with `__arnoldPerf('coach:compute')`
(JS should stay < ~16 ms/frame; if slow it's GPU/model, now off the transition path).

## Open

### Play ↔ Fuel session-energy disparity  (2026-07-17, Emil — logged, fix later)
On the same day (Fri Jul 17, after the 7.5 mi run) the two surfaces show **different numbers for the
same session**:
- **Play** — Run card: **932 kcal CALS**; Sweat loss 2.02 L / Replenish 2.53 L.
- **Fuel** — "**+479 EARNED from session**"; Energy Balance "Activity **932**"; Nutrition header "+479 earned".
So the session's *burn* reads **932** on Play but the *earned/credit* reads **+479** on Fuel. Likely two
different concepts (gross session kcal vs net "earned" after RMR/adjustment) that aren't labeled
consistently, so they read as a contradiction. **To do:** trace the two figures to their sources
(activity kcal vs the fuel "earned" credit), reconcile the math, and label them so Play and Fuel agree
(or clearly distinguish gross burn from net earned). Data-consistency, not coach-narrative.

### Fuel — optional post-session replenishment note  (preference, not a bug)
The evening RED-S line is correct (low EA, real deficit). Emil may want Fuel to ALSO acknowledge the
session's replenishment ("+479 earned, rehydrate by …") as a secondary note. Small addition to gFuelStatus
if wanted.

### Calendar coach — season vs this-week copy coherence  (minor, cosmetic)
"Behind plan (3 wks)" trajectory shown next to "this week looks balanced — hold it." Not a contradiction
(two lenses: multi-week trajectory + this week), but could read as one. Copy/layout tweak if desired.

## Deferred by decision (need device / UX / model)

- **Dismiss affordance** — a dismiss control on the coach comment → `recordEngagement(beat, 'dismissed')`.
  Completes Stage 4 as BIDIRECTIONAL learning + unlocks the facilitative "stop-nagging-me" stance. Needs a
  control choice (× / long-press / swipe).
- **Stage 6 — facilitative stance** — MI-style tone; wants the dismiss signal live first (model now on).
- **Stage 8 — the Plan Stack** — `PLAN_STACK_DESIGN` → Plan-surface renderer (UI build). **This is the
  "Plan tab is a graveyard" fix** — the growing annual stack + Jan-1 drop. Mock-first, not started.
- **Native LiteRT/Gemma plugin** — only if WebGPU-in-WebView proves insufficient (WebGPU + Gemma now
  confirmed working on the S25 Ultra, so this is lower priority).

## Done (recent, for reference)
World model · certified facts · reasoner seam + adapter + loader · memory/personalization + engagement
capture · quality eval harness (clinical exercised) · clinical generators + recency · full race unification
(incl. calendar `analyzeSeason`) · post-run session read (grounded in actual distance) · the
`.activityType` vs `.type` logged-session fix · LivingPlan "today flips to done + actual miles" ·
**on-device model LIVE** (Gemma-2-2B over WebGPU, GPU-capability tiering + q4f32 fallback for no-shader-f16
GPUs + device-lost guard, synced Profile toggle) · **`todayPlanned.planned.type` fix** (Play/Start now lead
with today's planned-session purpose read instead of the stale strength tally) · coach-voice toggle sizing
(`arnold-compact-btn`) + live-state status on remount · **`core/perf.js`** response-time probe + deferred
on-device inference (keeps transitions snappy).
