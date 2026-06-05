# Hub Core Loop — two ledgers + response model

> Status: **BUILD** (started 2026-06-04). The Intelligence Hub's beating heart:
> turn each attributed outcome into accumulating, confidence-weighted personal
> knowledge. Implements the calibration math + two-ledger principle from
> INTELLIGENCE_HUB.md ("Calibration math", "What the hub maintains"). Consumes
> the attribution engine (`core/attribution.js`). Pure logic, unit-tested in
> `tests/hubCore.test.mjs`.

## The loop (one checkpoint in → both ledgers updated)
A "checkpoint" is any effort with an expectation (a race, a benchmark, a graded
session). One arrives → the hub does five things:

1. **Grade cleanliness → `obsPrecision`.** A clean, maximal, recent A-effort with
   no confounders = high precision (counts a lot). A confounded / sub-maximal /
   stale effort = low precision (barely nudges anything). Grading reuses the
   attribution result (confounder load, effort completeness, recency).
2. **Fitness ledger update.** Precision-weighted blend of the fitness parameter(s)
   this checkpoint informs (threshold pace, fatigue exponent k). Because precision
   adds, a first race when the model is naive moves it a lot; the same race once
   the model is well-established moves it little — "one 10K shouldn't rewrite my
   history" falls out of the math.
3. **Response ledger update.** The residual (`divergencePct` = actual − expected)
   is NOT discarded — it's partitioned across the active **acute** confounders
   (heat, last-night sleep, fuel, …) and each slice accumulates into that
   confounder's **sensitivity** estimate ("≈ +1.5%/°C above ref").
4. **Decay.** Every estimate's precision decays with age on a half-life, so the
   model reflects who the athlete is NOW without discarding history.
5. **Log.** Each update records what moved, by how much, and why (which
   observation, what precision) — no black-box drift.

## Core primitive — `Estimate { value, precision }`  (`core/hub/estimate.js`)
Every learned parameter in the hub is one of these. `precision` = inverse
variance = "how sure we are."
- `updateEstimate(est, obs, obsPrecision)` → precision-weighted blend:
  `value = (v·p + obs·op)/(p+op)`, `precision = p + op`.
- `decayPrecision(est, ageWeeks, halfLifeWeeks)` → `precision ×= 0.5^(age/halfLife)`
  (value untouched; we just trust it less as it ages).
- `confidence(est, k0)` → `p/(p+k0)` ∈ [0,1), the saturating confidence the coach
  uses to decide how assertive to be.

## Response model  (`core/hub/responseModel.js`)
`{ factors: { <factor>: Estimate } }` — one sensitivity estimate per confounder,
in **fraction-per-unit** (e.g. heat in fraction-per-°C-over-ref; sleep in
fraction-per-hour-of-debt). Keyed by the attribution engine's `factor` names.

- **`observeOutcome(model, divergence, factors, opts)`** — partitions `divergence`
  (a fraction, e.g. 0.03 = ran 3% slow) across the **acute** factors by
  explanatory weight `w_i = magnitude_i · confidence_i`:
  `share_i = divergence · w_i / Σw`, then `obsSensitivity_i = share_i / magnitude_i`,
  and updates `factors[f]` with `obsPrecision = confidence_i` after decaying by age.
  (If there are no acute factors, the residual is unattributed → caller treats it
  as a fitness signal, not a response signal.)
- **`predictPenalty(model, conditions)`** — given present `[{factor, magnitude}]`,
  returns `{ penalty, confidence, byFactor }` where `penalty = Σ sensitivity·magnitude`.
  This is what lets the coach say "expect ~2% slower today: heat ~1.5%, sleep ~0.5%."

### Why partition by `magnitude · confidence`
A bigger insult (more heat, more debt) and a more-confident attribution should
claim more of the blame for the residual. Dividing the residual this way keeps the
total attributed ≤ the residual (no double-counting) and feeds each factor an
observation in its own per-unit terms.

## Fitness model  (`core/hub/fitnessModel.js` — NEXT cut)
Holds fitness params as Estimates (thresholdPace, fatigueExponentK, …).
`updateFitness(param, observedValue, obsPrecision)` = `updateEstimate` + **sanity
clamps** (reject k outside [1.0,1.25], pace shifts beyond a plausible per-week rate
— a clamp-trip flags a mislabeled/mis-measured effort rather than silently drifting).

## The router  (`core/hub/ingestCheckpoint.js` — NEXT cut)
Glue: takes `{ predicted, actual, attribution }` (attribution = `attributeOutcome`
output) → computes `divergence`, grades cleanliness → `obsPrecision`, calls
`updateFitness` (clean signal) + `observeOutcome` (residual → response), returns an
explainable log of everything that moved.

## Guardrails (carry through every cut)
- Sanity clamps on fitness updates; a trip is surfaced, not swallowed.
- Confidence floor on assertiveness — below a precision threshold the coach hedges
  ("early read, low confidence") instead of asserting.
- Every update is explainable: what moved, by how much, driven by which observation
  at what precision and decay.
- Robust to sparse/missing data — never assume the plan ran; degrade gracefully.

## Build sequence
- **[this cut]** `estimate.js` + `responseModel.js` + `tests/hubCore.test.mjs`
  (the math, fully unit-tested in isolation).
- **[next]** `fitnessModel.js` (+ clamps) and `ingestCheckpoint.js` (the router that
  consumes `attributeOutcome`), with a fixture test over a real graded effort.
- **[later]** persistence (store/restore the ledgers), backfill from history,
  recency-decay scheduling, and consumption by the Coaching Team / Plan Generator
  (the hub state is what those query).
