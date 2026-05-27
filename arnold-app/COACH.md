# Arnold Coach Engine

The intelligence layer beyond alert/conflict surfacing. Arnold's job is
to **prevent goal misalignment** by continuously analysing all the
user's variables across multiple time horizons, detecting
patterns/dependencies/correlations, and providing **coaching guidance**
(not just status flags) to help the user achieve multiple goals
sequentially or mutually.

This doc is the long-running spec for that engine. It outlines three
versions (v1/v2/v3), the data Arnold currently uses vs leaves on the
table, the derivable signals that don't need new integrations, and the
personal correlations Arnold should learn. New ideas land here so they
don't get lost across sessions.

## The shift

| Before | After |
|---|---|
| Alert when goals collide | Guide toward goals that coexist or sequence |
| Static snapshot per page load | Continuous multi-horizon analysis |
| Severity flags (CONCERN / WATCH / NOTE) | Coach voice (acknowledge → mechanism → next action) |
| One-shot recommendation | Dialogue (user asks; Arnold answers with current context) |
| Generic thresholds (e.g. "<6.5h sleep") | Personal correlations (e.g. "your HRV drops 4ms when sleep <6.5h") |

Arnold is the coach IN the dialogue, not in the audience.

## The three versions

### v1 — Pattern detection (the "watch everything" foundation)

Extend `userState` with a `coachSignals` block that watches each variable
across day / week / month windows and computes the highest-leverage
derivable signals. UI consumes these later; v1 is engine-only.

The six v1 signals (see "v1 signal specs" below for full algos):

1. **Sleep debt** — cumulative deficit vs 7.5h target across 7/14/30 day windows.
2. **HRV depression** — current vs personal 28d baseline, plus consecutive-days-depressed counter.
3. **RHR drift** — slope (bpm/wk) over 14d. Gradual climb = canonical overreaching signal.
4. **Energy availability** — (intake − exercise kcal) / lean mass. Below ~30 kcal/kg LBM impairs endocrine function.
5. **Training monotony + strain** — Foster's formula. Mean daily TSS / SD × weekly load. Validated overreaching predictor.
6. **Sleep → next-day HRV correlation (personal)** — Pearson r over user's last 60 days, with n≥30 and |r|≥0.3 gate before surfacing.

Output shape: each signal returns a structured object with the raw
numbers, a status enum, and a `surfaceable` flag. The synthesizer can
read these directly; a future coach layer can compose them into
multi-signal insights ("sleep is the leverage point that unblocks cut +
recovery + race").

### v2.5 — Race-format-aware patterns (HYROX shipped 2026-05-25)

Format-aware coaching that reads `src/core/raceFormats.js` and emits
HYROX-specific briefs instead of generic "pause your cut for race"
copy. Four patterns:

- `patternHyroxStationCoverage` — checks last 14 days against the 4
  HYROX modality buckets (running, erg, strength, mixed-modal/metcon).
  Fires when any are uncovered with race ≤21 days out. Uses
  `classifyActivityForHyrox()` to bucket activities by Garmin-style
  type/name fields.
- `patternHyroxStrengthReadiness` — dual-state: fires as `aligned`
  when ≥2 strength sessions/wk (positive recognition tied to the
  loaded HYROX stations — sled 152kg, farmers 2×24kg, sandbag 20kg),
  or as `act/watch` when strength has been sparse with race ≤21d out.
- `patternHyroxGlycogenWindow` — replaces generic `patternRaceSequencing`
  for HYROX in the ≤7d window. Race-day-specific carb-loading guidance
  scaled by days remaining (race day → race week → ramp-in).
- `patternHyroxPacingPrep` — fires in the 4-21d window when recent
  intensity / race-pace work is sparse (<2 hard sessions in 14d).

`patternRaceSequencing` is now gated to skip HYROX races (the new
patterns own race-week messaging). When upcoming race is NOT a HYROX,
the generic sequencer still fires as before.

Detection: `isHyrox(race)` checks `race.type === 'hyrox'` first, falls
back to fuzzy `/hyrox/i` match on race name. The lookup helper
`getRecentActivities(days)` reads from storage directly inside the
patterns (tight scope to race-aware needs; avoids bloating
coachSignals with race-specific aggregations).

Future race formats (marathon sub-3:30 in December) get parallel
pattern sets following the same structure — `patternMarathonMileageBuild`,
`patternMarathonPaceWork`, `patternMarathonTaper`. See RACES.md for
the prep-focus list.

### v2 — Trade-off articulation (coach voice)

**v2.engine shipped 2026-05-24** — `src/core/coachBriefs.js` produces
structured Brief objects with three-part coach-voice (acknowledge /
mechanism / next action). Six pattern detectors live:

**Concern patterns** (fire when something needs attention):
- `patternLeveragePoint` — sleep as bottleneck on multiple goals
- `patternRaceSequencing` — cut vs upcoming race trade-off
- `patternSustainability` — goal pace vs current capacity
- `patternEnergyAvailability` — EA below endocrine threshold (<40 / <30)
- `patternPersonalCorrelation` — when v1's sleep→HRV correlation surfaces
- `patternMutualReinforcement` — positive callout when goals coexist (no concerns)
- `patternAlignedBaseline` — fallback when nothing else fires

**Positive patterns** (Phase 4r.coach.v2.positive — fire INDEPENDENTLY of concerns; composer reserves up to 2 slots for these so they always show alongside acts/watches):
- `patternTrainingConsistency` — 5+ of last 7 days with training
- `patternHrvImproving` — HRV trending above 28d baseline
- `patternProteinConsistency` — 7d protein avg at or above floor
- `patternWeeklyVolumeProgress` — substantial weekly load with healthy variance

Composer rule: takes all concern briefs sorted by state then priority,
reserves up to MAX_POSITIVE (2) slots for positive briefs. Caps total
at maxBriefs (5). Falls back to `patternAlignedBaseline` only if both
streams produce nothing.

The positive-as-additive pattern was added 2026-05-24 from user
feedback: *"there is nothing that I am doing good, there are only Act
points in the coach feedback."* Original design had positives gated
on absence of concerns, which made them invisible to anyone with an
active concern — the wrong shape for a coach.

`composeCoachBriefs(userState)` runs all patterns, ranks by state
(act > watch > aligned) then priority, returns top 5.

Each Brief shape:
```js
{
  id, priority, state,                          // act | watch | aligned
  pillarsAffected, goalsAffected,
  acknowledge,    // 1 sentence specific with numbers
  mechanism,      // 1 sentence the why
  nextAction,     // 1 sentence concrete + timeline
  evidence,       // chips linking back to source signals
  confidence,
}
```

Debug: `window.coachBriefsDebug()` runs the full pipeline and prints
each brief with its three parts + evidence chips.

**v2.surface (next session)** — build `CoachBeta.jsx` component, wire
as new web nav tab "Coach (BETA)" between EdgeIQ and Daily. Each brief
renders as a block with state badge, three-part coach voice, evidence
chips, and a feedback affordance (thumbs / "this read wrong" textbox)
so the 2-3 week beta period actually informs iteration.

Once v2.surface lands and the voice is calibrated against your real
data, promote the engine into the production Goal Alignment rail.

### v3 — Dialogue

A query interface ("ask Arnold") where the user can pose questions:

- "Should I do a hard run today?"
- "Can I cut weight now or should I wait?"
- "What's blocking my marathon training?"

Arnold answers by synthesising current `coachSignals` + goal portfolio +
the question's intent. Could be rule-based initially (decision tree over
the signals), LLM-backed later for natural-language understanding.

Arnold "in the dialogue, not in the audience" is fully realised at v3.

## Data audit — what we have but underuse

### From Garmin (we get this live, just don't read it)

| Field | What we use | What we leave on the table |
|---|---|---|
| Sleep | Duration + score | Sleep stages (deep / REM / light / awake), sleep efficiency, time-to-sleep, bedtime variance |
| HRV | Latest single value | 7/14/30d trend, depression vs personal baseline, time-of-night pattern |
| RHR | Latest value | 14d slope (slow climb = overreaching signal) |
| Activities | Duration / distance / kcal / HR zones | Recovery time Garmin recommends, training effect (aerobic + anaerobic), respiration rate, training status (productive / unproductive / overreaching / detraining) |
| Daily | — | Body Battery, stress score, steps + floors (NEAT proxy), intensity minutes, SpO2 overnight |
| Performance | — | VO2 max trend, lactate threshold estimate, race-time predictions, cardio fitness age |
| Readiness | — | Garmin's training-readiness composite (use as sanity check or input feature) |

### From Cronometer

| Used | Ignored |
|---|---|
| kcal, P/C/F/Fi | Micronutrients (vits + minerals), meal timing (entry timestamp), sodium split, water |

### From the planner

We don't compute training monotony (variance of daily TSS) or training
strain (monotony × load), both of which are well-validated overtraining
predictors.

## Derivable signals — no new APIs needed

Signals derivable purely from existing storage:

- Sleep debt accumulator (rolling 7/14/30d)
- HRV depression depth + duration
- RHR drift (slope over 14d)
- Energy availability ((intake − exercise kcal) / LBM)
- Training monotony / strain (Foster's formula)
- Polarization index (% Z1–2 vs Z3 vs Z4–5)
- Pace–HR decoupling trend (already partial)
- Day-of-week patterns (which weekday breaks recovery first)
- Recovery velocity (days for HRV to return to baseline post-load)
- Glycogen estimate (Z4–5 minutes vs carb intake)
- TDEE drift (metabolic adaptation to cut)

## Correlations Arnold should learn (the personalisation layer)

| Pair | Why it matters |
|---|---|
| Sleep duration ↔ next-day HRV | Direct personalisation of "how much does sleep buy you" |
| Sleep duration ↔ next-day RHR | Same, on the other recovery channel |
| Sleep duration ↔ next-day run quality (HR at same pace) | Sleep's payoff in performance currency |
| Calorie deficit depth ↔ HRV depression | Where YOUR endocrine system protests |
| Carb intake yesterday ↔ today's Z4–5 capacity | Personal carb requirement for high intensity |
| Training load this week ↔ sleep quality this week | Inverted-U; the load where extra training breaks sleep |
| Meal timing (last meal hour) ↔ overnight HRV | Personal evening-eating cutoff |
| Cumulative deficit days ↔ TDEE drift | When YOUR RMR starts defending weight |

After 6 months of user data, Arnold knows *"Emil's HRV drops 4ms when
sleep falls below 6.5h"* specifically — not from a textbook, from
observation. This is what makes the coach feel personal.

## v1 signal specs (canonical algorithms)

### 1. `computeSleepDebt(sleepArr, opts)`

- Input: `sleepArr` = `[{ date, durationHours }]`
- `target` = 7.5h (configurable via `opts.targetHours`)
- For each window (7d, 14d, 30d):
  - `debt = sum(max(0, target − actual)) for nights in window`
  - `nightsBelow = count(actual < target)`
  - `avgHours = mean(actual)`
- `status`:
  - `paid` if `debt7d < 1`
  - `mild` if `debt7d ∈ [1, 3)`
  - `moderate` if `debt7d ∈ [3, 7)`
  - `severe` if `debt7d ≥ 7`

### 2. `computeHrvDepression(hrvArr, opts)`

- Input: `hrvArr` = `[{ date, value }]`
- `latest` = today's HRV
- `baseline28d` = mean of last 28d HRV (exclude outliers > ±2σ)
- `depressionMs` = `baseline28d − latest` (positive = depressed)
- `depressionPct` = `depressionMs / baseline28d`
- `consecutiveDepressedDays` = days back-from-today where each is below baseline
- `status`:
  - `normal` if `depressionPct < 5%`
  - `mild` if `depressionPct ∈ [5, 10%)`
  - `moderate` if `depressionPct ∈ [10, 20%)` OR `consecutiveDays ≥ 5`
  - `severe` if `depressionPct ≥ 20%` OR `consecutiveDays ≥ 10`

### 3. `computeRhrDrift(rhrArr, opts)`

- Input: `rhrArr` = `[{ date, value }]` (likely from sleep records or HRV records)
- `latest` = today's RHR
- `baseline28d` = mean of last 28d
- `slopeBpmPerWeek` = linear regression slope over last 14d × 7
- `status`:
  - `stable` if `|slope| < 0.5 bpm/wk`
  - `rising` if `slope ∈ [0.5, 1.5] bpm/wk`
  - `concerning` if `slope > 1.5 bpm/wk` (overreaching range)

### 4. `computeEnergyAvailability(opts)`

- Input: today's `intakeKcal`, today's `exerciseKcal`, `lbmKg` from body comp
- `netKcal = intakeKcal − exerciseKcal`
- `eaKcalPerKgLBM = netKcal / lbmKg`
- `status`:
  - `sufficient` if `≥ 40 kcal/kg LBM`
  - `low` if `∈ [30, 40)`
  - `deficient` if `< 30` (endocrine impact threshold)

### 5. `computeTrainingMonotonyStrain(activities, opts)`

- Input: activities array; compute daily TSS for last 7 days (using existing rTSS helpers)
- `weeklyLoad = sum(dailyTss)`
- `monotony = mean(dailyTss) / stddev(dailyTss)` (clamp stddev at 1 to avoid div-by-zero)
- `strain = monotony × weeklyLoad`
- `status`:
  - `balanced` if `monotony < 1.5`
  - `monotonous` if `monotony ∈ [1.5, 2)` (same load every day)
  - `high-strain` if `monotony ≥ 2 AND strain > 6000`

### 6. `computeSleepHrvCorrelation(sleepArr, hrvArr, opts)`

- Input: paired by date: sleep[t] hours with hrv[t+1] value, last 60 days
- `n` = number of valid pairs
- `r` = Pearson correlation coefficient
- `slope` = linear regression slope (ms HRV per hour sleep)
- `pValue` = approximate via t-distribution
- `surfaceable` = `n ≥ 30 AND |r| ≥ 0.3` (statistical floor)
- `insight` = e.g. `"+1h sleep ≈ +4ms HRV next day"` (only when surfaceable)

## Roadmap parking lot — beyond v1

### v2 signals — shipped 2026-05-25 (Phase 4r.signals.1-8)

All v2 signal ideas + the four planned correlations + Garmin underused-field
wedge shipped this phase. Each declares narrative-graph metadata
(`narrativeThreads`, `causalUpstream`, `causalDownstream`) so the v2.6
narrative engine can compose stories without retrofit.

  • TDEE drift — adapting / starvation / rebounding (Phase 4r.signals.2)
  • Recovery velocity — improving / stable / slowing / concerning (.3)
  • Glycogen estimator — replete / moderate / depleted / critical (.4)
  • Polarization index — polarized / balanced / grey-zone / hot / sparse-easy (.5)
  • Day-of-week patterns — personal weekly HRV rhythm (.6)
  • Personal correlations: sleep↔RHR, sleep↔run-quality, deficit↔HRV,
    weekly-load↔weekly-sleep (.7)
  • Sleep quality (architecture) — deep + REM + efficiency + continuity (.8a)
  • Garmin training-readiness cross-check (.8b)

### v2 layer ideas — still deferred

  • **Z-aware recovery velocity** — split recovery velocity by session type
    (Z3 tempo recovers differently from Z5 intervals). Needs ~6mo data.
  • **Bedtime variance** — sleep-onset SD over 14 days; circadian stability.
  • **Strain-monotony interaction** — currently we report each separately;
    a combined "load is monotonous AND high" detector would catch a specific
    overreach pattern (same volume every day, no easy days).

### v2 trade-off templates (deferred)

Concrete coach-voice patterns to articulate trade-offs:
- "If you cut now while X, here's what you'll lose; here's what you'll gain."
- "These two goals can coexist this month because Y; they can't past Z."
- "The leverage point this week is W — fixing it unblocks A, B, and C."

### v2.6 — Narrative integration (locked, builds after Step 8)

Coach tab transformation. Today CoachBeta renders N independent brief
cards ranked by state. Each card is self-contained. The user sees
snippets, not a story. User feedback 2026-05-25: "the way you describe
these variables is the key to the coach experience — putting the storyline
together, not just snippets. The best visualization is a mix of variables
+ small narrative so the user understands how it all comes together."

Architecture move: introduce a narrative layer between signals and UI.

  • Each signal exposes `narrativeThreads: [...]` (which storylines does
    this signal contribute to — sleep-recovery, cut-adaptation,
    training-capacity, fuel-timing, race-readiness) and
    `causalUpstream` / `causalDownstream` (graph edges).
  • A composer picks a leverage signal, walks its downstream effects,
    and emits a 2-3 paragraph narrative: leverage point → connected
    threads → trade-off → ONE action → ONE metric to watch.
  • Coach tab renders: narrative on top, ranked brief cards below as
    drillable supporting detail. Cards stay as the per-signal evidence
    layer — they're not deleted.

Signals being built in Steps 4-8 should declare their narrative metadata
inline so the composer has the graph it needs when this phase starts.
No more isolated briefs — every new signal arrives narrative-ready.

Visualization: TBD with user. Probable shape — a small "system map"
graphic showing the chain of cause-effect for the current leverage
point. Lightweight, not a full dashboard.

### v3 dialogue scaffolding (deferred)

- Question taxonomy: "should I X today?" / "can I do X right now?" / "what's blocking Y?" / "explain why Z"
- Rule-based decision tree v1
- LLM-backed natural language v2

### Additional data sources — shipped 2026-05-25

- **Sleep stages** (deep / REM / light / awake) — read by `computeSleepQuality`
- **Garmin recovery time** + **training-readiness factor breakdown** —
  read by `computeGarminReadiness`
- **Meal timing (Cronometer entry timestamps)** — Phase 4r.signals.1

### Additional data sources — still deferred

- **Garmin Body Battery** composite — already arrives in storage as
  `bodyBatteryChange`; doesn't yet feed any signal. Lower ROI than
  training-readiness because Garmin's readiness includes Body Battery's
  inputs already. Could surface as a tile.
- **Garmin training status** (productive / unproductive / overreaching /
  detraining) — needs a new Garmin endpoint we haven't wired yet.
- **Respiration rate** — already in storage (`avgRespiration`,
  `lowestRespiration`, `highestRespiration`); could feed a sleep-stress
  signal but the literature on it as a recovery proxy is thin.
- **SpO2 overnight** — needs new sync; primarily useful for altitude /
  illness detection, not training recovery.
- **Micronutrients from Cronometer** — already arrive in `extended`
  block on full-day rows; no signal consumes them yet. Iron/B12/D could
  power a "low energy" diagnostic eventually.

## How this doc is maintained

- v1 ships → mark v1 section "shipped on [date]", move v2 from "deferred" to "next"
- New signal idea? Append to the appropriate v-section under "deferred"
- New correlation noticed in user data? Append to the correlation table with a note
- Vocabulary or framing change? Update "The shift" table at the top
