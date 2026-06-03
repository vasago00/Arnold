# The Intelligence Hub — the reasoning core

> Status: **VISION / DESIGN** (2026-06-01). The foundational layer. Everything
> else — the Coaching Team (COACHING_TEAM.md) and the Plan Generator
> (PLAN_GENERATOR.md) — are APPLICATIONS that consume this hub. Build the hub
> right and you can throw any goal, any race, any athlete-question at it.

## Reframe (user, 2026-06-01)
The Plan Generator is NOT the centerpiece — it's downstream. The centerpiece
is an **Intelligence Hub**: a reasoning core that ingests every data point and
maintains a living, explainable model of the athlete's **physiological AND
mental state**. The Coaching Team is the hub's voice; the Plan Generator is
one of its outputs. "If the hub works, we can throw anything at it."

So the dependency order is:
**Intelligence Hub → Coaching Team (voice) → Plan Generator (an application).**

## First principles

### 1. Every data point is valuable — but interpretation is conditional
There is no "bad data," only data whose *meaning* depends on context. A single
run, race, night of sleep, or meal expands the model's knowledge of how this
specific body and mind behave. The hub NEVER discards a data point as noise.
What it does instead is decide **which ledger the point posts to**:
- **Fitness ledger** — does this tell us about current capability? (Only when
  the effort was a clean read.)
- **Response ledger** — how does the athlete respond to a condition? (Heat,
  under-sleep, under-fueling, travel, stress.) ALWAYS valuable, especially
  when the fitness read is confounded.
A scorching, under-slept, under-fueled 10K is a weak fitness checkpoint and a
GREAT data point about heat + sleep + fuel sensitivity. Both are true at once.

### 2. Confound attribution — "find the culprit"
When an outcome diverges from expectation (slower race, bad session, off
HRV), the hub's job is to **diagnose why before it judges**. It cross-examines
the surrounding signals to attribute the divergence:
- Weather (heat/humidity — already pulled per-day)
- Sleep debt / poor last-night sleep
- Under-fueling (cut state, glycogen, low intake pre-session)
- Elevated RHR / depressed HRV (illness, incomplete recovery)
- Travel / schedule disruption
- Accumulated load (ACWR high) → fatigue masking fitness
The output is an attributed explanation ("you ran 3% slow; HRV −12ms + 26°C +
4h sleep debt account for it"), NOT a verdict that fitness dropped. This is
the single most important capability — it's what separates a coach from a
calculator.

### 3. Checkpoint validity grading
Following from (1) and (2): a race is only a clean **fitness checkpoint** when
the confounders are quiet. The hub grades every potential checkpoint:
- **Clean** → trust it; use it to calibrate the fitness model + as an anchor.
- **Confounded** → down-weight or exclude as a fitness signal; route it to the
  response ledger instead, with the culprit named.
- The athlete sees the call AND the reason ("not counting this as a fitness
  read — too hot + under-slept — but here's what it taught us about your heat
  response"). Never silently drop or silently trust.

### 3b. Expectation is SESSION-TYPE-SPECIFIC (learned 2026-06-01 from real data)
A race-pace expectation only applies to a race/hard effort. Comparing an easy
Z2 run against the race predictor is a CATEGORY ERROR — an easy run reads
~20-30% "slower" purely because easy pace ≠ race pace, which is correct
training, not underperformance. Each session type has its OWN expectation:
- **Race / hard effort** → expectation is a TIME (vs predictRaceFinish). "Did
  you run as fast as your fitness allows?" Gate: avg HR ≥ ~95% of LT
  (LT = stored thresholdHR, else ≈0.88×maxHR), or explicit race flag.
- **Easy / Z2 run** → expectation is an HR ZONE, not a time. The PRIMARY
  attribute is "did you hold Z2 / stay sub-threshold?" The FITNESS signal is
  pace-AT-that-HR improving over time (aerobic efficiency) — "pace can improve
  as long as the main attribute (Z2 effort) is in line" (user's words). NEVER
  a race-pace time verdict. (This is the easy-pace trend already built in
  PlannedWorkoutTile #17 — same idea belongs in attribution as the easy-run
  expectation. TODO: add a positive easy-run evaluation, not just suppression.)
- **Tempo / threshold** → expectation is pace-at-threshold-HR (its own band).
v1 SHIPPED the guard (suppresses the bogus verdict → 'not-an-effort'); the
positive easy/tempo evaluations are the next refinement.

### 4. Missing data is itself signal — and must never break the model
The athlete will skip sessions and miss races — overslept, no motivation, life.
The hub must:
- **Stay robust** — never assume the plan was executed; reason from what was
  actually logged, gracefully degrade when data is sparse.
- **Read the gap as information** — adherence patterns, motivation dips, life
  load. A missed race because "I didn't want to wake up" is a mental-state
  data point, not an error. Repeated skipped early sessions → maybe the plan's
  timing fights the athlete's chronotype; the logistics/mental model notices.
- **Never punish or shame** — missing is normal; the model adapts, the coach
  stays constructive (ties to user-wellbeing + "always in control").

### 5. Mental state is first-class, alongside physiology
Motivation, adherence, mood, perceived effort, life stress — modeled
explicitly, not as an afterthought. Physiology says what the body CAN do;
mental state says what the athlete WILL do and how they FEEL doing it. A plan
that's physiologically perfect but mentally unsustainable fails. The hub tracks
both and the coach reasons over both.

### 6. Recency-weighted knowledge (fading, not cutoffs)
Old data fades in influence as it ages (user principle, already applied to the
race anchor). The hub generalizes this: every model parameter is a
recency-weighted estimate, so it always reflects who the athlete is NOW while
still learning from history. (Current race-anchor uses a hard 24-wk cutoff;
the truer form is a gradual decay weight — logged as a refinement.)

## Calibration math — how the hub learns from each checkpoint (the hard part)
This is the closed loop. When a clean checkpoint arrives (a race or a
benchmark effort the grading step deemed trustworthy), the hub updates its
fitness model. The math has to be careful: one race should *inform*, not
*overwrite*, and a confounded race should barely move anything.

### Bayesian-style weighted update (not replace)
Every model parameter (e.g. the personal fatigue exponent k, threshold pace)
is held as an **estimate + a confidence (inverse variance)**. A new
observation updates it as a precision-weighted blend:
```
new_estimate = (prior·priorPrecision + obs·obsPrecision) / (priorPrecision + obsPrecision)
new_precision =  priorPrecision + obsPrecision
```
- A first race when the model is naive (low prior precision) moves the
  estimate a lot. The same race once the model is well-established moves it
  little. This is exactly "one 10K shouldn't rewrite my history" — falls out
  of the math, no hand-tuned weights.

### What sets the observation's precision (how much a checkpoint counts)
`obsPrecision` is scaled DOWN by everything that makes the read less clean:
- **Cleanliness** (from checkpoint grading): confounded race → low precision
  → barely nudges the model. Clean A-effort → full precision.
- **Effort completeness:** a maximal race counts more than a tempo; a
  paced/positive-split race more than a fade.
- **Distance proximity:** a race near the parameter's regime informs it more
  (a 10K calibrates threshold strongly, the marathon-end durability weakly).
- **Recency:** newer observations enter at higher precision; see decay below.

### Recency decay (fading, generalized)
Each stored observation's precision decays with age on a half-life (e.g.
~8–12 weeks for fitness, longer for durability which changes slowly). So the
model is a recency-weighted posterior — it reflects who the athlete is NOW
without throwing history away. (Replaces the race anchor's current hard 24-wk
cutoff with a smooth weight — same principle, gentler curve.)

### Residual → response model (the other ledger)
The prediction error isn't discarded — it's the raw material of the response
model. `residual = actual − predicted`. The attribution engine partitions the
residual across the active confounders (heat, sleep debt, fuel, load) and
those partitions accumulate into condition-sensitivity estimates:
"≈ +1.5%/°C above 18°C", "≈ +1%/hour of sleep debt". Over many efforts these
become reusable, cited coaching facts. So a confounded race that's a poor
fitness checkpoint is a PRIME response-model data point — the loop turns the
confound into knowledge.

### Guardrails
- **Sanity clamps:** reject physiologically impossible updates (k outside
  [1.0,1.25], threshold pace shifts beyond a plausible per-week rate) — likely
  a mislabeled or mis-measured effort.
- **Confidence floor on assertiveness:** until precision crosses a threshold,
  the coach hedges ("early read — ~3:5x, low confidence") rather than asserting.
- **Everything explainable:** each update logs what moved, by how much, and why
  (which observation, what precision, what decay). No black-box drift.

## What the hub actually maintains (the living model)
A continuously-updated, explainable state estimate:
- **Fitness model** — personal fatigue exponent, threshold (LTHR/pace),
  aerobic/durability profile, current race-equivalent times. Calibrated from
  clean checkpoints + training.
- **Response model** — sensitivity to heat, sleep debt, under-fueling, load.
  Built mostly from confounded efforts + daily variation.
- **Readiness model** — ACWR, HRV/RHR trend, HS scores, cut state, glycogen.
- **Adherence / mental model** — what gets done vs planned, timing patterns,
  motivation/mood signals, perceived effort vs actual.
- **Confidence on everything** — each estimate carries how sure the hub is,
  driven by data volume + recency + cleanliness. Confidence gates how
  assertive the coach is.

## How applications consume it
- **Coaching Team** — each expert queries the hub's relevant sub-model; the
  arbiter reasons over the whole state + confidence to resolve conflicts and
  speak one voice.
- **Plan Generator** — asks the hub for "current fitness + readiness + the
  gap to goal" and writes a plan; re-queries after each checkpoint.
- **Race predictor / tiles** — already a primitive consumer (predictRaceFinish
  reads the fitness model). It's the first thin slice of the hub that exists.

## Visualization stack (decision 2026-06-01, user-introduced)
The hub's outputs need BESPOKE visuals that no off-the-shelf chart provides:
system/cause-effect maps (force-directed graphs), the personal fatigue curve
+ exponent fit, recency-weighted confidence bands, calibration timelines where
tune-up races re-anchor the model. → Adopt **D3.js** (d3js.org, by Observable;
v7.x) for these, deliberately:
- **Observable Plot** (D3's high-level API) for ROUTINE charts (lines, bars,
  scatter); **raw D3** for the bespoke hub/coach visuals only.
- **React/D3 boundary:** React owns layout + lifecycle; D3 owns the SVG/Canvas
  internals of a given viz (D3 must not fight React for the DOM). Standard
  pattern: a React wrapper component, a D3 render fn on a ref.
- **Keep** the existing hand-rolled lightweight SVG (EdgeIQ sparklines, gauges,
  annual timeline) — D3 is overkill for a 7-point sparkline. Introduce D3 where
  complexity earns it, don't rip out what works.
- **Mobile (Capacitor web view):** D3 works (it's a browser), but mind bundle
  size + the React boundary; prefer Plot/SVG on dense mobile tiles.
- npm dependency in `arnold-app`. Aspiration: a reusable Arnold viz vocabulary
  usable beyond Arnold too (user's "everywhere" goal).

### Visual direction — APPROVED 2026-06-01
The **calibration timeline** mock (fitness line + narrowing confidence band +
clean vs confounded checkpoints re-anchoring the curve + goal line + projected
finish) was shown and approved by the user as fitting Arnold's aesthetic. This
is the reference look for hub visuals. Design notes confirmed by the mock:
- Flat, clean, low-chrome; purple ramp for the model, green for goal/clean,
  orange (hollow) for confounded — consistent with EdgeIQ palette.
- The two-ledger principle is VISIBLE: confounded race rendered hollow +
  down-weighted + labeled with the culprit ("28°C, −4h sleep → response model").
- Confidence communicated as a band that visibly narrows with clean evidence.
- In-app, D3 GENERATES these from live data + animates transitions (band
  tightening, points re-anchoring) — the mock is hand-SVG in the D3 idiom, an
  accurate preview of the look, not the live mechanism.
Next bespoke visual to mock when wanted: the cause-effect SYSTEM MAP
(force-directed — signals as nodes, causal edges, current leverage point
highlighted).

## Build stages (hub-first)
1. **Attribution engine v1** — ✅ BUILT 2026-06-01 (`src/core/attribution.js`).
   `attributeOutcome({activity, expectedSecs?, actualSecs?, acwr?, data?})` →
   `{date, divergencePct, verdict, culprits[], summary}`. Probes per-date raw
   data (sleep debt, HRV depression vs 28d baseline, RHR rise, under-fueling vs
   14d norm, heat if weather attached, ACWR if passed). Each culprit carries
   direction/magnitude/confidence (so stage 2 can down-weight proportionally).
   PURE + date-flexible + defensive (missing data never errors). Verdict =
   under/over/as-expected/no-expectation. Plain-language `summary` = the
   "coach not calculator" line. `window.attributionDebug(dateStr?)` wired (also
   pulls predictRaceFinish to set expectedSecs, skipping self-anchoring).
   Read-only — mutates no model. NOT build-verified (VM down).
2. **Checkpoint grading** — clean vs confounded classification on races, with
   the reason shown; clean ones calibrate, confounded ones route to response
   ledger. Wire into the race anchor + predictor.
3. **Response model** — accumulate condition-sensitivities (heat/sleep/fuel)
   into reusable estimates the coach can cite.
4. **Adherence / mental model** — track planned-vs-done, timing, motivation
   signals; feed the logistics + mental reasoning.
5. **Confidence layer** — attach recency-weighted confidence to every estimate;
   gate coach assertiveness on it.
6. **Recency-decay refactor** — replace hard cutoffs with graceful decay weights
   across all models.
THEN the Coaching Team + Plan Generator sit naturally on top.

## Non-negotiables
- Every conclusion is explainable and attributed (which signals, what weight).
- No data point discarded; only routed + weighted.
- Robust to missing/sparse data; missing is read, never errored or shamed.
- Always reasons over the athlete's OWN data; published method is the lens.
- Recency-aware: reflects who the athlete is now.
