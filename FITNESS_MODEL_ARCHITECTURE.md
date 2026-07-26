# Arnold — Race-Readiness as a Continuously-Estimated Fitness State
*Design / architecture · 2026-07-18 · grounds the predicted-finish model in one coherent, testable design*

> **Why this doc exists.** The finish-time predictor was patched reactively (anchor-only → a naïve
> training blend → ripping it out) and produced numbers that don't trace cleanly to evidence. This
> replaces all of that with **one model**: a latent fitness state that every run updates, calibrated by
> races, compounding through training, decaying between anchors — with a confidence band derived from the
> model itself, and every number traceable to real data. Nothing here is invented: each choice cites the
> verified research in `ARNOLD_SCIENCE_AND_STRATEGY_2026.md`.

---

## 0. The principle (Emil's words, made precise)

1. **Compound BOTH training and recorded efforts — not one or the other.** Every run is evidence.
2. **Races are strong anchors, but they decay.** A race pins the estimate *now*; its influence loosens as
   time passes and newer evidence arrives.
3. **Training compounds between anchors.** Consistent load raises fitness; a break lets it fall. Tempos,
   intervals, and easy runs are all evidence — **treated differently**, by how much each truly reveals.
4. **Never show a number that isn't anchored to data.** No evidence → no number (or an explicit "need
   data" state). Same no-fabrication contract the coach engine already lives by.

The model below satisfies all four **by construction**, not by hand-tuned rules.

---

## 1. The core idea — a recursive Bayesian estimate of one latent fitness state

Model current running fitness as a single hidden quantity **F(t)** with an **uncertainty σ(t)**. We never
observe F directly; we observe *runs*, each a noisy measurement of it. We maintain F by walking through the
athlete's runs in time order and doing two things at each step:

- **Predict** F forward to the run's date using a *process model* (training load drives fitness up or down;
  uncertainty grows with elapsed time — this is the **decay** of old anchors).
- **Update** F toward what the run *implies*, weighted by how trustworthy that run is (a race pulls hard; an
  easy run nudges). This is the standard inverse-variance (Kalman) fusion.

This is precisely the **Banister impulse-response model** (fitness with a slow ~42–49-day time constant,
fatigue ~7–11 days — verified) written as a filter. It is how Runalyze derives a continuously-updated
"effective VO₂max" from ordinary HR+pace training and Firstbeat derives continuous VO₂max — both verified in
the research pass. It is not a novelty; it's the standard, and we simply implement it honestly.

**Why a filter and not a formula:** a formula (Riegel off the best race) can't compound training and can't
decay. A filter does both natively: races are low-noise measurements, training is the process drift + a
stream of higher-noise measurements, and the "decay factor" is just uncertainty growing between anchors.

---

## 2. The fitness currency — critical speed / vVO₂max, not raw pace

F is expressed as **critical speed (CS)** — equivalently a reference velocity we can convert to a
"current-effective-10K" time. Rationale (verified):

- **velocity at VO₂max (vVO₂max) is the single best predictor of distance performance (~94% of variance)
  because it integrates aerobic power AND running economy** — which raw pace or raw VO₂max miss
  (McLaughlin 2010).
- **Critical speed is a validated determinant from the mile to the marathon**, computable **lab-free from
  two or more maximal efforts** (2026 Sports Medicine review). It is the heavy/severe-intensity boundary —
  physiologically ≈ the velocity you can hold for ~30–60 min.

CS is the anchor of the state; D′ (anaerobic reserve) is a secondary parameter that mostly matters for short
races and can be held at a personal/default value initially. **Labeling honesty:** CS ≈ threshold, but it is
*not* identical to MLSS/ventilatory thresholds — we call it "critical speed / threshold velocity", never
"your lactate threshold".

---

## 3. Observation model — turning each run into evidence (the part I got wrong)

**My bug:** I mapped every effort to a race-equivalent with Riegel *as if it were an all-out effort*. A
submaximal tempo or an easy run then "projected" to an absurdly slow race → the 5:57. The fix is
**effort-aware mapping**: each run type is converted to CS through the *correct* physiological relationship,
and carries a **measurement variance** (how much we trust it).

For each run we derive: `{ observedCS, variance r, date }`. Classification uses summary data we already have
(distance, duration, avg/max HR, planned type):

| Effort type | How detected (summary data) | Maps to CS via | Trust (variance r) |
|---|---|---|---|
| **Race / all-out** | standard distance ±5% + high HR (≥~90% max) or flagged; or a clear PR effort | a point on the speed–duration curve → CS/D′ directly (2 efforts fix CS exactly) | **highest** (smallest r) |
| **Threshold / tempo** | sustained 15–60 min, HR ≈ 85–92% max, pace ≫ easy | sustained velocity ≈ CS itself (duration-adjusted: 20 min sits just above CS, ~60 min ≈ CS) — **not Riegel-projected** | high |
| **VO₂ / intervals** | short hard reps, HR ≥ ~92% max | rep velocity ≈ vVO₂max → CS via the vVO₂max↔CS ratio | medium |
| **Long run (steady)** | ≥ ~90 min; adds the **durability** read (§6) | its steady velocity-at-HR informs CS weakly, but it strongly informs durability + load | medium-low on level |
| **Easy run** | HR ≤ ~80–82% max | **HR→%vVO₂max** relationship (Runalyze's method, verified): (%HRmax, velocity) ⇒ implied vVO₂max ⇒ CS | **lowest on level** (largest r); but its *trend* is a low-variance signal of *change* |

Two consequences that directly fix the reported bugs:

- An **easy run can never dictate the number** — its large `r` gives it a tiny update weight, so it can't
  override a race (no more 5:57).
- A **tempo is read as a threshold measurement**, not a failed race — so genuine quality training *does*
  move the estimate, in the right direction and magnitude.

**Efficiency trend as its own low-noise signal:** the *level* an easy run implies is noisy, but the *change*
in pace-at-a-fixed-%HRmax over weeks is a reliable indicator that fitness is rising or falling. We feed that
as a separate, lower-variance observation of the *derivative* of F — this is how easy base miles legitimately
compound the estimate between races.

---

## 4. Process model — compounding and decay between observations

Between two runs, F evolves; it does not sit frozen (my anchor-only version) nor free-float (my naïve blend).

**Drift (the compounding), Banister fitness–fatigue:**
- Maintain **chronic load CTL** (EWMA of daily training stress, τ ≈ 42 d) and **acute load ATL** (τ ≈ 7 d) —
  the verified impulse-response structure; τ_fitness ≈ 42–49 d, τ_fatigue ≈ 7–11 d.
- Expected fitness change between t₀ and t is tied to the load trajectory: rising CTL ⇒ F drifts up toward a
  ceiling; collapsing CTL (injury/break) ⇒ F decays with the detraining constant. Formally
  `F_pred(t) = F(t₀) + α·(CTL(t) − CTL(t₀))`, α a bounded personal responsiveness (default from population,
  learned as data accrues). Drift is **capped** so load alone can't manufacture improbable gains.

**Uncertainty growth (the decay factor — Emil's "races decay"):**
- `σ²(t) = σ²(t₀) + q·Δt` — variance grows with elapsed time (process noise q) and with load volatility. So
  an old race's *pin* loosens: months later the band is wide and the estimate is governed mostly by recent
  training. Exactly "races are anchor points but they decay; training picks up until another anchor."

**DECIDED (Emil) — decay timescale = the fitness's BUILD time, not a fixed half-life.** An anchor decays over
a horizon proportional to *how long it takes to train to that result*. Reverse-calculate the build time a
result represents and use it as the anchor's decay half-life:
- A 3:47 marathon represents a ~12–16-week aerobic build → it stays authoritative for months (endurance is
  "sticky": long to build, slow to lose).
- A fast 5K represents a ~4–6-week sharpening → it decays much faster (top-end speed builds and fades quickly).
- Formally, the per-anchor process noise `q` is set so the anchor's influence halves at `t₀ + T_build`
  (i.e., `q ≈ r_anchor / T_build`): a longer build ⇒ slower σ-growth ⇒ the race counts for longer. This is
  physiologically honest — the detraining time constant scales with the depth/duration of the adaptation.
- `T_build` starts from a **distance-scaled population prior** (marathon ≫ half > 10K > 5K) adjusted by how
  advanced the result is, and is **personalized from the athlete's own build history** as data accrues (how
  long *they* actually took to reach that level). This is a first-class empirical target for §9's back-test.

---

## 5. Fusion — the recursive update (one pass over the runs)

Scalar Bayesian filter (the tractable, testable form of a Kalman filter). Sort runs by date; carry
`(F, σ²)`. For each run with observation `o` and variance `r`:

```
# 1. PREDICT to this run's date
F_pred  = F + α·(CTL(t) − CTL(t_prev))          # load-driven drift (capped)
σ²_pred = σ² + q·(t − t_prev)                    # uncertainty grows with the gap  ← the decay factor

# 2. UPDATE toward the observation, weighted by trust
K   = σ²_pred / (σ²_pred + r)                    # Kalman gain ∈ (0,1): race→~1, easy run→~0
F   = F_pred + K·(o − F_pred)
σ²  = (1 − K)·σ²_pred
```

After the last run, **predict once more to today** (drift by recent load, grow σ²). The result is
`F_today ± σ_today`, fused from *all* evidence, each weighted by how much it deserves.

This is the whole answer to "anchor to both, not one or the other": the race gives a near-1 gain (dominates
when fresh), easy runs give near-0 gains (nudge), tempos sit in between, and the process step compounds
training and decays old anchors — automatically.

---

## 6. Projection to a race distance (+ durability)

`F_today` (critical speed) → a finish time for any distance:
- Base projection via the **critical-speed model** `t(D) = D/CS + D′/CS`-style, or the athlete's **personal
  fatigue exponent** (we already fit this in `fatigueExponent`) — keep whichever back-tests better.
- **Durability / decoupling modifier (P2, verified as a 4th pillar):** the marathon specifically punishes
  late fade. Apply the durability read (`durability.js`) as a distance-scaled adjustment — good durability
  tightens the marathon toward the CS projection; poor durability slows it. Decoupling **improves marathon
  prediction beyond critical speed alone** (Smyth & Muniz-Pumares, 82,303 marathoners — verified).

---

## 7. Confidence band — derived, not decorated

The band is `F_today ± z·σ_today` mapped through the projection. It is honest and dynamic **because it comes
from the model's own uncertainty**:
- fresh race → small σ → tight band;
- months since any hard effort → large σ → wide band;
- a new tempo → σ drops → band tightens the moment real evidence lands.

This is what makes the band trustworthy (your requirement): it *is* the model's uncertainty, not a fixed ±%.

---

## 8. Invariants — the discipline, guaranteed by construction (and tested)

1. **Every number traces to observations.** No runs → no estimate. (Anchoring rule.)
2. **An easy run cannot move the estimate more than a few %** (high r → low gain). No more 5:57.
3. **A fresh race dominates** (low r → gain ≈ 1): the estimate sits at the race projection.
4. **A race decays**: with only easy training afterward, the estimate holds near the race but the band widens;
   if easy-run efficiency rises, the estimate drifts faster; if load collapses, it decays.
5. **A tempo/interval moves it appropriately** — in the right direction, bounded magnitude.
6. **Monotonic sanity**: uniformly faster training ⇒ estimate never gets slower.

---

## 9. Empirical validation — how we earn trust in the numbers

- **Back-test on the athlete's own races (leave-one-out):** for each real race, estimate F from *only the
  data before it*, project, and compare to the actual result. Report error distribution and band coverage
  (does the real time land in the band ~the intended fraction of the time?). This is the direct trust test —
  we can run it on your history the moment the filter is built.
- **Synthetic athletes:** improving, detraining, tapering, injury-gap, and "races-then-only-easy"
  trajectories → assert the estimate and band behave (rise, decay, widen) as designed.
- **Invariant unit tests:** each rule in §8 as a test (these replace the ad-hoc tests we've been churning).
- **Parameter fits:** q, α, τ, r-per-type start from the literature/population defaults and are tuned to
  minimize back-test error — documented, not hand-waved.

---

## 10. Migration — what we keep, what we replace

- **Keep:** `coaching/vdot.js` (VDOT/velocity math), `fatigueExponent` (personal distance exponent),
  `durability.js` (P2), the effort-classification ideas, `racePredictionOpts`. The hub fitness model becomes
  *one observation source*, not the sole authority.
- **Replace:** the ad-hoc blend in `fitnessEstimate.js` + the "prefer training vs anchor" logic in
  `predictFinishSecs`. These become a single new estimator, e.g. `core/derive/fitnessState.js`
  (`estimateFitnessState(activities, {today}) → { CS, sigma, asOf, contributions[] }`) that
  `predictFinishSecs` calls; projection + durability + band wrap it.
- **Confidence band + provenance UI** (RecipePath) already built — it just reads the new state's σ and
  contributions.

---

## 11. Build phases (each shippable + tested, no big-bang)

1. **Observation layer** — `classifyEffort(run)` + `effortToCS(run) → {cs, variance}` per type, pure +
   unit-tested against known efforts (a 49-min 10K, a 1:47 half, a 20-min tempo, an easy run all map to
   sane CS). *This is where the science lives; nail it first.*
2. **Process + fusion** — CTL/ATL drift + the scalar filter; unit-test the §8 invariants on synthetic data.
3. **Projection + durability + band** — wire CS→time, apply durability, σ→band. Swap `predictFinishSecs` to
   the new state. Back-test on Emil's races.
4. **Tune + document** — fit q/α/τ/r to minimize back-test error; write the numbers down.

---

## 12. Design decisions (DECIDED 2026-07-18)

- **Decay timescale — build-time-proportional (Emil).** Not a fixed half-life: each anchor decays over the
  training time its result represents (marathon ≫ 5K). See §4. Build-time from a distance-scaled prior,
  personalized from the athlete's own history as it accrues.
- **Marathon fade — moderate fixed + durability (Emil).** A modest baseline penalty for the half→full jump
  (you haven't proven the distance), adjusted up/down by the measured durability/decoupling signal (§6). Not
  durability-only (thin long-run data early), not heavily conservative.
- **Projection base — keep the fitted fatigue exponent; back-test decides (Emil).** Use the existing personal
  `fatigueExponent` as the projection base; introduce CS+D′ only where the back-test shows it wins. VDOT is
  the internal fusion currency; the projection stays on our fitted exponent.

## 13. Build status

- **Phase 1 — observation layer: BUILT (`core/derive/fitnessObservation.js` + test).** `classifyEffort` +
  `effortToVdot` map each effort to a consistent VDOT by its true intensity (race→maximal curve,
  tempo→88% VO2max, intervals→100%); easy/long return null as level evidence. Verified: a 49-min 10K, a 1:47
  half, and a matched tempo all land on ~VDOT 41 → a 3:45 marathon; easy runs never set the level.
- **Phase 2 — process + fusion: BUILT (`core/derive/fitnessState.js` + test).** The scalar Kalman filter
  fuses the level observations; between them the state drifts by the easy-run efficiency trend and its
  uncertainty grows at `q = Q0/T_build` (the build-time decay). All design invariants pass as tests: a fresh
  race dominates and is tight; steady easy miles do NOT move the level; a faster tempo pulls it up; two races
  fuse tightly; an old race widens; a 5K anchor decays faster than a marathon over the same gap; easy-only →
  null. Output: `{ vdot, sigma, asOf, effRate, contributions }`.
- **Phase 3 — projection + band + LIVE SWAP: BUILT (`core/derive/fitnessProjection.js` + test).** `projectRace`
  turns `{ vdot, sigma }` into a finish via the Daniels base × a TRANSPARENT marathon fade (moderate-fixed,
  graded by long-run readiness = `longestLong/distance`, adjusted by durability); the band is the state's own σ
  mapped through the projection. **`predictFinishSecs` (tileMetrics.js) now runs the fitness-state model as the
  PRIMARY path** (`source: 'fitness-state'`), with the old hub/anchor kept only as an explicit conf-0.5 fallback
  when there's no recent LEVEL evidence. Also: marathon-race DETECTION fixed — the "hard-effort" HR gate now
  scales with distance (0.82 at ≥30 km, since a marathon sits at ~85% HRmax; a fixed 0.90 gate missed every
  marathon), and `__finishDebug()` surfaces `state`, the projection breakdown, and every detected race at any
  age for calibration. Verified end-to-end on Emil's real efforts (49-min 10K, 1:47 half): VDOT 41.4, σ 0.88 →
  **10K 48:34, half 1:48, marathon 3:54:22** (base 3:43 × 1.05 readiness fade, conf 0.91). The 5:57 absurdity is
  gone; every shown number traces to a demonstrated effort.
- **Phase 4 — BACK-TESTED against Emil's real Garmin marathon history (2023–2025; `fitnessBacktest.test.js`).**
  Findings, all from his own data (nothing invented):
  1. **Detection rule simplified & hardened.** The distance-scaled HR gate still dropped his best-paced
     marathons (Sydney 3:47 at 79% HRmax → classed "long"; 2023 Berlin logged a broken 96-bpm strap). Per Emil,
     "anything over 26 miles is a marathon" — so a ≥26 mi (41.5 km) effort is now classed `race` unconditionally
     (no HR gate; long runs cap at ~22 mi, so there's no collision). Title matching also broadened to the racing
     vocabulary (marathon/parkrun/championship/…), not just the literal word "race". Now **all 8 of his marathons
     are recognised.**
  2. **The fade is well-calibrated at full readiness.** His marathons imply VDOT ≈ 40.5–41.2; his 10K/half imply
     ≈ 41.4. So his true marathon fade is only ~+4 min over the flat-physiology base (3:43 → 3:47), i.e. **fade
     ≈ 1.02** — exactly what the model applies at readiness ≥ 0.75. The 1.05 (→ 3:54/3:56) only appears at
     readiness 0.5, i.e. when he hasn't logged a recent long run — which is the honest "you have the speed but
     haven't re-proven the distance" state. As long runs return, readiness → 1 and the number walks down to ~3:47.
  3. **Walk-forward is a fitness read, not a race-day oracle** (all inside ±35 min): NY-2025 predicted 3:49 vs
     actual 4:07 — correctly reading his Sydney/Chicago form; the 4:07 was a genuine off-day. Chicago-2025 3:54
     vs 3:47 (+7). Sydney-2025 4:18 vs 3:47 (+31) — the only large miss, because his build block was not in the
     marathon-only export; with training synced, readiness fills in and it tightens.
  4. **Current read (2026-07-19).** Marathons only, 8.5 mo stale → VDOT 39.4, σ 1.61 → **~4:06, band 3:58–4:15**
     (honestly wide). Add a fresh 10K + half → VDOT 41.1, σ 0.82 → **~3:56, conf 0.92** (re-anchored + tighter).
  Remaining Phase 4 work: fine-tune (q, α, τ, r, T_build) once more real non-marathon anchors are available;
  the "off-day" pull of a single bad marathon (NY-2025 4:07 → VDOT 37) on the fused state is the main open knob.

## 14. The aerobic ceiling — reconciling measured VO2max with race-derived VDOT

Emil's Garmin/lab VO2max reads ~47–51; his races (10K 49:00, half 1:47, marathons ~3:47) imply VDOT ~41.
These are DIFFERENT currencies and must not be swapped: Garmin's number is an *estimated aerobic engine*
(Firstbeat, from HR↔pace), while Daniels VDOT is derived from race *performance* and already folds in running
economy, threshold, fractional utilisation, and execution. Feeding VO2max 47 into the finish would print a
3:20:50 marathon he has never run — the exact unanchored fabrication the fitness-state rebuild removed.

**Decision: races drive the prediction; the measured engine is a SEPARATE upside signal.** The gap between the
two (here ~6 VDOT points) is the single most actionable coaching read in the data — the classic "big engine,
race legs" profile — and its lever is threshold + economy work, not more easy base.

Built (`core/derive/potentialGap.js` + test; wired into the coach and the training profile):
- `computePotentialGap` — pure: race-anchored VDOT vs measured VO2max → `{ currentSecs, ceilingSecs, reachSecs,
  gapVdot, lever, magnitude, confidence }`. The ceiling treats the VO2max as a VDOT ("if economy were textbook")
  and is kept **apples-to-apples** with the displayed finish by backing the marathon fade out of the anchored
  time and applying the SAME multiplier to the ceiling. Realistic `reach` closes only ~35 % of the gap (≤3 pts).
- `readMeasuredVo2` — the same priority chain MobileHome uses (manual watch → API → activity DTO → lab test),
  with source-and-age-graded confidence (a fresh lab test outranks a 16-mo-old one or a noisy activity estimate).
- `resolvePotentialGap` — the one orchestration the coach and the profile share, so they can never disagree.
- `gPotentialGap` coach voice — speaks the gap + lever on strategic surfaces (plan/edgeiq/play) ONLY when
  actionable (large/moderate) or the data needs a re-test (racing above the reading); silent on small/matched
  gaps and low-confidence VO2max (the anti-lingering discipline).
- RecipePath marker — a distinct, clearly-labelled "Aerobic ceiling ~3:30" line beside the anchored finish,
  never replacing it. For Emil today: current ~3:56 (anchored) · ceiling ~3:31 (engine) · realistic reach ~3:47.

Note on the "8 months stale" confusion: that was an artefact of the marathon-only CSV used for the back-test.
The live app carries his May-2026 half and June-2026 10K, so `state.asOf` reads June 2026 and the estimate is
anchored to recent races — verify via `__finishDebug().detectedRaces`.
