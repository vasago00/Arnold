# Arnold — Data Model Spec (Phase A1)

**Status:** Spec / north star. Code does not yet match this document
(see AUDIT.md for the gap list and migration plan).

## Core principle

```
Source data flows in one direction:

   LAYER 0 (Source)        Garmin, Coros, HC, Cronometer, manual, profile
        │
        ▼
   LAYER 1 (First-order)   Pure functions of Layer 0 — TDEE, RMR, trends
        │
        ▼
   LAYER 2 (Interpretation) Pure functions of Layer 0 + Layer 1 — phase,
                            trajectory, trust scores, burdens, conflicts
        │
        ▼
   LAYER 3 (Prescription)  Today's calorie target, protein floor, training
                            prescription, recommendation cards
```

**Rules:**

1. Each variable has **exactly one canonical compute function**.
   Duplicates are bugs.
2. A variable can only depend on variables in the same or higher
   layer. No cyclic deps. No skipping layers (Layer 3 cannot read
   Layer 0 directly — it goes through Layer 1+).
3. Every consumer (UI surface, recommendation engine, etc.) reads
   Layer 3 prescriptions only. Layer 2 interpretation is internal
   to the intelligence engine. Layer 1 is internal to the
   derivation engine. UI never reads Layer 0 directly.
4. Goals (in Layer 0) accept **outcomes only** — weight, BF%, sleep
   hours, HRV baseline, performance metrics, race dates. The system
   derives all tangible targets (calories, macros, miles) from
   outcomes. Tangible targets in the goals object are legacy
   overrides only.
5. Storage shape changes go through a migration. Layer 0 schemas
   are immutable once shipped — new fields only, never re-typed.

---

# LAYER 0 — Source data (golden, immutable)

These come from external systems or user input. The system never
writes back to Layer 0 — it only reads.

## activities

Source: Garmin sync / Coros sync / manual entry / FIT relay
Storage key: `activities`
Shape (per row):
```
{
  date:           'YYYY-MM-DD',         // local date
  activityType:   string,               // 'Running' | 'Strength Training' | …
  durationSecs:   number,
  distanceMi:     number?,
  avgHR:          number?,              // bpm (Coros arm-band > Garmin wrist)
  maxHR:          number?,
  avgPaceRaw:     string?,              // 'M:SS' per mile
  calories:       number?,              // Garmin estimate — KNOWN TO BE INFLATED
  cardiacDrift:   number?,              // pp, computed by parser
  aerobicTE:      number?,
  anaerobicTE:    number?,
  weather:        { tempC, humidityPct, conditionCode }?,
  coords:         { lat, lon }?,
  id, source, …
}
```
Consumers: every Layer 1 derivative that uses activity data.
Notes: `calories` is the canonical Garmin-reported value; Layer 1's
`correctedActivityCalories` applies the burn-correction factor.

## sleep

Source: HC / Garmin sync
Storage key: `sleep`
Shape: `{ date, durationMinutes, totalSleepMinutes, sleepScore, overnightHRV, restingHR }`
Notes: `totalSleepMinutes` is the canonical field for Garmin live
data; `durationMinutes` is the legacy HC field. Layer 1 readers
prefer `totalSleepMinutes` then fall back.

## hrv

Source: HC / Garmin / CSV import
Storage key: `hrv`
Shape: `{ date, overnightHRV }`
Notes: Some HRV values land on sleep rows too. Layer 1 readers merge
both sources per date.

## weight

Source: HC + Garmin weight + manual entry
Storage keys: `weight`, `arnold:garmin-weight`
Shape: `{ date, weightLbs?, weightKg?, bodyFatPct?, skeletalMuscleMassLbs?, bmi? }`

## nutritionLog

Source: Cronometer sync + manual food log
Storage key: `nutritionLog`
Shape: `{ date, meal, calories, protein, carbs, fat, fiber, sugar, water, extended:{ sodium, potassium, magnesium, … } }`
Notes: Full-day entries from Cronometer worker land with `meal: 'full-day'`.

## cronometer (legacy)

Source: Cronometer CSV import (pre-worker)
Storage key: `cronometer`
Shape: per-day rows with the same nutrients.
Status: Read-only legacy; new data goes to `nutritionLog`.

## labSnapshots

Source: Manual entry / PDF import
Storage key: `labSnapshots`
Shape: `[{ date, markers:{ 'ApoB (mg/dL)': value, … } }]`

## dailyLogs

Source: Manual entry + FIT relay
Storage key: `dailyLogs`
Shape: `{ date, rpe?, notes?, fitActivities?, … }`

## profile

Source: User input (Settings)
Storage key: `profile`
Shape: `{ sex, birthDate, heightCm, heightInches, weightLbs?, maxHR, thresholdHR, functionalThresholdPace, … }`
Notes: `dailyCalorieTarget`, `dailyProteinTarget`, `weeklyRunDistanceTarget`,
`targetRacePace` etc. are **legacy override fields**. Phase B will move
these to the override system; new code should never read them directly.

## goals

Source: User input (Goals UI)
Storage key: `goals`
Status: schema v2 locked 2026-05-23. v1 reads supported during a
2-week compat window via goalModel adapter, then deprecated.

### Locked schema (v2)

```js
storage.set('goals', {
  schemaVersion: 2,

  body: {
    weight:   { targetLbs: 170, targetDate: '2026-08-31', priority: 1 } || null,
    bodyFat:  { targetPct: 12,  targetDate: '2026-08-31', priority: 2 } || null,
    leanMass: { targetLbs: 165, targetDate: '2026-12-31', priority: 3 } || null,
  },

  recovery: {
    // Ongoing floors — no target date, continuous expectations.
    sleepHoursMin: { value: 7.5,   priority: 1 } || null,
    hrvBaseline:   { valueMs: 45,  priority: 2 } || null,  // 14-day rolling avg target
    rhrBaseline:   { valueBpm: 50, priority: 2 } || null,
  },

  performance: {
    // Endurance — paces / times tied to a target date (often a race).
    run5K:        { targetSecs: 1320, targetDate: '…', priority: 2 } || null,
    run10K:       { targetSecs: 2820, targetDate: '…', priority: 3 } || null,
    halfMarathon: { targetSecs: null, targetDate: null, priority: 3 } || null,
    marathon:     { targetSecs: null, targetDate: null, priority: 3 } || null,
    // Strength — 1RM lifts (lbs).
    benchPress:   { target1RMLbs: 225, targetDate: '…', priority: 2 } || null,
    backSquat:    { target1RMLbs: 315, targetDate: '…', priority: 2 } || null,
    deadlift:     { target1RMLbs: 405, targetDate: '…', priority: 2 } || null,
    overheadPress:{ target1RMLbs: 155, targetDate: '…', priority: 3 } || null,
    // Hyrox-specific composite — single time goal.
    hyrox:        { targetSecs: 4500, targetDate: '…', priority: 1 } || null,
  },

  races: [
    {
      id:           'hyrox-ny-2026',
      name:         'Hyrox NY',
      date:         '2026-06-03',
      city:         'New York',
      type:         'hyrox',  // 'hyrox' | '5K' | '10K' | 'half' | 'marathon' | 'ultra' | 'tri' | 'other'
      distanceMi:   null,
      priority:     'A',      // A = focused peak; B = key tune-up; C = training race
      goalTimeSecs: 4500,
    },
    // … more races …
  ],
});
```

### Design decisions (locked 2026-05-23)

1. **Priority model — per-goal.** Each goal carries its own 1/2/3 priority
   (or A/B/C for races). Lets the user prioritize one body metric over
   another, or one lift over another, independently. No category-level
   priority.

2. **Race-time-proximity auto-escalation.** Any race within 4 weeks is
   treated as effectively P1 by the derivation engine, regardless of
   user-set priority. The user-set priority (A/B/C) is the tiebreaker
   when multiple races are within the window. Reasoning: even a B-race
   in 2 weeks needs taper + carb-loading; treating it as P3 would
   under-fuel.

3. **Legacy profile fields — 2-week compat window.** `profile.dailyCalorieTarget`,
   `profile.dailyProteinTarget`, `profile.weeklyRunDistanceTarget`, etc.
   stay readable for 2 weeks via goalModel adapter. After that, a
   cleanup turn migrates remaining values to `arnold:overrides:targets`
   and removes legacy reads.

### Race-proximity boost table (drives Turn 2 derivation)

Eat-back fraction (applied to corrected activity calories) scales with
proximity to the soonest A/B race:

| Days to race | Window         | Eat-back fraction | Extra flat bonus | Carb emphasis |
|--------------|----------------|-------------------|------------------|---------------|
| ≤ 1          | Race-day       | 1.0 (eat all)     | +300 kcal        | High          |
| 2–7          | Race week      | 0.85              | +200 kcal        | High          |
| 8–28         | Race prep      | 0.75              | 0                | Moderate      |
| 29–56        | Build phase    | 0.625             | 0                | Normal        |
| > 56 or none | Base           | 0.5 (baseline)    | 0                | Normal        |

C-priority races get half the bump (boost is `0.5 + (table_value - 0.5) × 0.5`).
Carb emphasis becomes a Phase 2 macro-split modifier; not yet wired.

### Migration plan (Turn 4)

1. On boot: detect schema v1 vs v2. If v1, read legacy fields and write
   them into v2 shape AT FIRST WRITE (not on read — avoids racing).
2. `arnold:races` localStorage → `goals.races` array.
3. `profile.dailyCalorieTarget` etc. → `arnold:overrides:targets` (only
   if user had a manual non-default value).
4. 2-week compat window: goalModel reads v2 first, falls back to v1
   adapter. Both shapes coexist in storage.
5. After 2 weeks: cleanup turn deletes the v1 adapter, leaves v1 fields
   alone in storage (no destructive delete — just unread).

### Open for Phase B Turn 3+ (UI work)

- Goals UI form structure: tabs (Body / Recovery / Performance / Races)?
  or a single scrollable form?
- "Add goal" affordance for each category.
- Race entry: free-text + date picker OR curated catalog + date picker?
  (Current RACE_CATALOG can stay for catalog; manual entry stays for
  custom.)
- How to surface effective priority vs user-set priority when auto-
  escalation kicks in. Recommendation: chip badge "P1 (auto, race in
  12d)" so the user knows why.

## activeOverrides

Source: User opts to pin a derived value
Storage key: `arnold:overrides:targets`
Shape: `{ dailyCalories?: { value, setOn, expires? }, dailyProtein?: { … }, … }`
Notes: Overrides win over derivations. The derived shadow value is
still computed and visible alongside the override badge.

## outcomeLedger

Source: Layer 4 (future Layer 5) writer, weekly snapshot
Storage key: `arnold:outcomeLedger:weekly`
Shape: `[{ weekEnding, predictedLossLbs, actualLossLbs, intakeAvg, sleepAvgHrs, recoveryDebtAvg, trust* }]`
Notes: Phase D uses this to update trust priors. Currently scaffold-only.

## dailySnapshots (NEW — Phase A3)

Source: Auto-written by app boot + scheduled task. Captures the
state needed to RECONSTRUCT historical Layer 3 prescriptions.
Storage key: `arnold:dailySnapshots`
Shape: `[{ date, derivedCalorieTarget, derivedProteinTarget, recoveryDebt, sleepHrs, hrvBaseline, rhrBaseline, todayBurnReported, todayBurnCorrected, burnCorrectionFactor, phase, trajectory, burdens, asOf }]`
Retention: Keep last 365 days (1 year). Older entries pruned on
write to keep storage bounded.
Notes: This is the data Calendar drawer reconstructs from when
showing historical days' targets. Without it, past dates would
show today's target (wrong) or nothing (per-decision below). Each
snapshot is the OUTPUT of Layer 3 for that date, frozen at the
moment it was first computed. We don't recompute history; we
remember it.

When the user looks at a date that has no snapshot (data flowed in
late, or before this system shipped), the drawer shows a "no
historical target stored for this date" indicator. We do NOT
back-fill snapshots from current state, because that would create
phantom targets that weren't actually shown to the user at the time.

## races (legacy)

Source: localStorage (pre-goals migration)
Storage key: `arnold:races` (localStorage, not the storage layer)
Shape: `[{ id, name, date, distanceMi?, city? }]`
Status: Read-only. Phase B folds into goals.races.

---

# LAYER 1 — First-order derived

Pure functions of Layer 0. Stateless. Deterministic given the same
inputs. **Canonical function** column is the one we keep; the
DEPRECATED list at the bottom names the duplicates that go away.

| Variable                  | Type     | Units    | Canonical function                        | Module           |
|---------------------------|----------|----------|-------------------------------------------|------------------|
| `bodyComp`                | object   | —        | `getCurrentBodyComp()`                    | energyBalance.js |
| `rmr`                     | number   | kcal/day | `computeRMR().rmr`                        | energyBalance.js |
| `tdeeModel(date)`         | number   | kcal/day | `computeTDEE(date).tdee`                  | energyBalance.js |
| `tdeeEmpirical()`         | object   | kcal/day | `empiricalTDEE()`                         | energyBalance.js |
| `activityKcalReported(date)` | number | kcal/day | `dailyActivityCalories(date)`             | energyBalance.js |
| `nutDailyTotals(date)`    | object   | grams+kcal | `dailyTotals(date)`                     | nutrition.js     |
| `weightTrend(date, days)` | number   | lb       | `weightTrend(date, windowDays)`           | energyBalance.js |
| `weightTrendSlope(days)`  | number   | lb/week  | (new — see TODO below)                    | energyBalance.js |
| `bodyFatTrendSlope(days)` | number   | pp/week  | (new — see TODO below)                    | energyBalance.js |
| `dailyBalance(date)`      | object   | kcal     | `dailyEnergyBalance(date)`                | energyBalance.js |
| `calibration(weeks)`      | object   | —        | `assessCalibration({weeks})`              | energyBalance.js |
| `hrvBaseline(date, days)` | number   | ms       | `hrvBaseline(date, days)`                 | dcy.js           |
| `rhrBaseline(date, days)` | number   | bpm      | `rhrBaseline(date, days)`                 | dcy.js           |
| `sleepAvg(days)`          | number   | hours    | (new — consolidate)                       | dcy.js (TBD)     |
| `sleepDebt(days)`         | number   | hours    | (new — consolidate)                       | dcy.js (TBD)     |
| `acwr(date)`              | number   | ratio    | `computeAcuteChronicRatio(activities, date, ftpPace, maxHR)` | trainingStress.js |
| `tsb(date)`               | number   | TSS-pts  | (in trainingStress.js)                    | trainingStress.js |
| `cardiacDriftTrend(family)` | object | pp/sess  | (in insights.js — extract)                | dcy.js (TBD)     |
| `dcyDaily(date)`          | number   | 0..100   | `dcy(date)`                               | dcy.js           |
| `dcyWeekly(date)`         | object   | —        | `dcyWeekly(date)`                         | dcy.js           |

## Helpful new derivatives to add (Phase A3 work)

- `weightTrendSlope({days})` → returns lb/week, used by trajectory
  classifier in Layer 2. Currently inlined in 3+ places.
- `bodyFatTrendSlope({days})` → pp/week.
- `sleepAvg({days})` → average hours over window.
- `sleepDebt({days})` → cumulative gap vs goal sleep over window.
- `hrvDelta({days})` → % depression from baseline.
- `rhrDelta({days})` → bpm depression from baseline.
- `proteinAvg({days})` → grams/day average.
- `intakeAvg({days})` → kcal/day average over window.
- `correctedActivityCalories(date)` → activity kcal × burn-correction
  factor (from Layer 2 trust score). Used everywhere we currently
  inline the multiplication.

---

# LAYER 2 — Interpretation

Pure functions of Layer 0 + Layer 1. Outputs a single canonical
`userState` object. This layer is **internal to the intelligence
engine** — UI does not read Layer 2 directly.

## userState (canonical, returned by `computeUserState`)

```
{
  asOf: 'YYYY-MM-DD',                    // local date
  trust: {
    garminBurn: 'over'|'aligned'|'under',
    intakeLog:  'tight'|'loose',
    rmrModel:   'aligned'|'adapted-down',
  },
  phase: 'cut-plenty'|'cut-thin'|'cut-at-floor'|'maintenance'|'recomp'|'surplus',
  trajectory: 'on-pace'|'behind'|'ahead'|'stalled'|'lbm-loss',
  recoveryDebt: 0|1|2|3,
  burdens: [<string>],
  goalConflicts: [<object>],
  numbers: { … },                        // see below
}
```

## Burdens (canonical list — extend as patterns are added)

| Burden id                       | Fires when                                                              |
|---------------------------------|-------------------------------------------------------------------------|
| `burn-inflated`                 | empirical TDEE < model TDEE by ≥300 kcal AND confidence ≥ medium       |
| `cut-at-floor`                  | derived calorie target ≤ RMR + 50 kcal                                  |
| `cut-thin`                      | derived calorie target ≤ RMR + 200 kcal                                 |
| `cut-plenty`                    | derived calorie target > RMR + 200 kcal                                 |
| `stalled`                       | actual loss rate ≥ -0.05 lb/wk and goal is to lose                      |
| `behind-on-pace`                | actual loss rate < 50% of target loss rate                              |
| `losing-too-fast`               | actual loss rate > 1.5× target loss rate (LBM risk)                     |
| `goal-aggressive`               | required loss rate > 1.0 lb/wk                                          |
| `sleep-debt`                    | 7-day sleep avg < goal sleep hours - 1.0 OR 14-day avg < 6.5h          |
| `chronic-sleep-debt`            | 21-day sleep avg < 6.5h                                                 |
| `recovery-debt`                 | recoveryDebt classifier returns ≥ 2                                     |
| `hrv-suppressed`                | latest HRV < 70% of 14-day baseline for ≥3 consecutive days             |
| `rhr-elevated`                  | latest RHR > baseline + 5bpm for ≥3 consecutive days                    |
| `cortisol-water-retention`      | sleep-debt AND (weight trend < expected by ≥0.3 lb/wk)                  |
| `rmr-adaptation`                | empirical TDEE drift > 200 kcal/day under model AND chronic deficit ≥6wk |
| `protein-low`                   | 7-day protein avg < proteinFloor × 0.85                                 |
| `protein-low-today`             | today's intake < proteinFloor × 0.6 AND user has logged 50%+ of typical |
| `logging-spotty`                | observed-day coverage < 50% in last 4 weeks                             |
| `trained-today`                 | any activity logged for today                                           |
| `untrained-3d`                  | no activity logged for the last 3 days                                  |
| `over-reach`                    | ACWR > 1.5 for ≥3 consecutive days                                      |
| `under-load`                    | ACWR < 0.8 for ≥7 consecutive days                                      |
| `drift-trending-up-{family}`    | cardiacDrift slope > 1pp/session over last 5 sessions, p<0.10          |
| `intake-volatile`               | day-to-day intake CV > 35% over last 7 days                             |
| `calorie-override-divergent`    | user override differs from derived target by >100 kcal                  |
| `protein-override-divergent`    | user override differs from derived target by >15g                       |

## Goal conflicts (canonical patterns)

Pairwise checks across active goals + active burdens. Each conflict
has a severity (info / attention / concern) and a recommendation.

| Conflict id                          | Triggers                                                  | Recommendation theme              |
|--------------------------------------|-----------------------------------------------------------|-----------------------------------|
| `cut-and-strength-gain`              | weight-cut goal active + strength-gain goal active        | Pick one; recomp is slow          |
| `cut-and-race-peak`                  | weight-cut goal + race ≤8 weeks                           | Defer cut OR defer race           |
| `cut-and-sleep-debt`                 | weight-cut + sleep-debt burden                            | Fix sleep first; cut is broken    |
| `cut-and-cortisol-water-retention`   | weight-cut + cortisol-water-retention burden              | Sleep + maintenance week          |
| `aggressive-and-recovery-debt`       | goal-aggressive + recovery-debt                           | Extend goal date; you're cooking  |
| `cut-at-floor-and-burn-inflated`     | cut-at-floor + burn-inflated                              | Recalibrate target down; not eat less |
| `race-prep-and-untrained`            | race ≤4 weeks + untrained-3d                              | Resume training; race at risk     |
| `race-prep-and-over-reach`           | race ≤4 weeks + over-reach                                | Deload; race is at risk           |
| `strength-and-protein-low`           | strength-gain goal + protein-low burden                   | Floor protein at 1.0g/lb          |

## numbers (canonical fields surfaced by Layer 2)

Single source of truth for any value Layer 3 cards display. Layer 3
**never** recomputes these.

```
numbers: {
  // Energy
  rmr, tdeeModel, tdeeEmpirical, tdeeCurrent,
  goalTarget,            // effective (derived OR override) calorie target
  calorieTargetDerived,  // what the model derived (regardless of override)
  calorieTargetOverride,
  calorieTargetSource,   // 'derived' | 'override'
  headroomKcal,          // goalTarget - rmr
  recommendedTarget,     // what model recommends for the user's pace
  burnCorrectionFactor,  // empirical/model ratio, clamped [0.4, 1.0]

  // Macros
  proteinTarget,         // effective
  proteinTargetDerived,
  proteinTargetOverride,
  proteinTargetSource,
  proteinFloor,          // = proteinTarget (alias for legibility)

  // Today vs target
  todayIntake,
  todayProtein,
  todayBurnReported,     // raw Garmin number
  todayBurnCorrected,    // burnFactor-adjusted

  // Trajectory
  actualLossRate,        // lb/week, observed
  targetLossRate,        // lb/week, required by goal
  weeksAtCurrentPace,    // to hit weight goal at current rate
  weeksExtendIfRecal,    // weeks to add to goal date if we accept current rate

  // Dates
  userTargetDate,        // user-set goal date
  projectedDate,         // when goal will be hit at current rate

  // Body
  distanceToTarget,      // lb to lose
  driftLbs,              // calibration drift

  // Recovery (new — to be added)
  sleepAvg7d, sleepAvg14d,
  sleepDebt7d,           // hours below goal × days
  hrvBaseline14d, hrvDelta3d,
  rhrBaseline14d, rhrDelta3d,

  // Performance (new — to be added when Phase B performance goals land)
  current5KSecs, current10KSecs, …

  // Calibration
  calStatus,             // 'aligned' | 'under-loss' | 'over-loss' | 'no-data'
  empiricalConfidence,   // 'high' | 'medium' | 'low' | 'insufficient'
  requiredLossRatePerWeek,
}
```

---

# LAYER 3 — Prescriptions

Pure functions of `userState`. **The only layer the UI reads.**

## getEffectiveTargets({ date? }): canonical

Returns the day-specific targets for a date (today by default).

```
{
  dailyCalories: {
    effective: number,        // = derived OR override
    derived:   number,
    override:  { value, setOn, expires? } | null,
    source:    'derived' | 'override',
    explain:   { components: {...}, floor, flooredAtRmr, … },
  },
  dailyProtein: { … },        // same shape
  dailyCarbs:   { … },        // (new — Phase A3)
  dailyFat:     { … },        // (new — Phase A3)
  weeklyVolume: { … },        // (new — Phase 2: training derivations)
  asOf: 'YYYY-MM-DD',
}
```

## synthesizeRecommendations(userState): canonical

Returns the ordered card list for the EdgeIQ action grid. Multi-
hypothesis aware (Phase C3 rewrite): each card represents one of
the top-N hypotheses ranked by evidence, not single-cause attribution.

## getTodaysPrescription(date): new (Phase A3)

Wraps `getEffectiveTargets` + `synthesizeRecommendations` for a date.

## getTrainingPrescription(date): new (Phase 2)

Today's planned session + intensity bounds, derived from race
calendar, recovery state, and ACWR ceiling.

---

# DEPRECATED — these functions should be deleted or aliased in A3

## Calorie target functions (consolidate to `getEffectiveTargets`)

| Function                              | Module           | Status                                |
|---------------------------------------|------------------|---------------------------------------|
| `resolveCalorieTarget(date, goals)`   | calorieTarget.js | DEPRECATED — alias to `getEffectiveTargets({date}).dailyCalories.effective` |
| `resolveCalorieTargetVerbose(date, goals)` | calorieTarget.js | DEPRECATED — same; expose explain    |
| `getDynamicCalorieTarget(date, opts)` | energyBalance.js | DEPRECATED — same                     |
| `getDynamicMacroTarget(date, opts)`   | energyBalance.js | DEPRECATED — replaced by `getEffectiveTargets({date}).dailyCalories|Protein|Carbs|Fat` |
| `profile.dailyCalorieTarget` reads    | (many files)     | DEPRECATED — route through override system |
| `profile.dailyProteinTarget` reads    | (many files)     | DEPRECATED — same                     |
| `profile.weeklyRunDistanceTarget` reads | (many files)   | DEPRECATED — wait for Phase 2 training derivations |

## TDEE / RMR functions (consolidate to energyBalance.js)

| Function             | Module    | Status                                            |
|----------------------|-----------|---------------------------------------------------|
| `bmr()`              | dcy.js    | KEEP for Phase A (DCY uses it). Phase C decides   |
| `bmrWithTier()`      | dcy.js    | KEEP for Phase A. Phase C decides                 |
| `tdee(date)`         | dcy.js    | KEEP for Phase A. Phase C decides                 |
| `tdeeWithTier(date)` | dcy.js    | KEEP for Phase A. Phase C decides                 |

Phase A migration target: every Layer 1+ consumer OUTSIDE dcy.js
that needs RMR/TDEE reads from `energyBalance.js`. DCY internals
stay on their own functions until Phase C reconciles the two
implementations.

## Recovery debt classifiers (consolidate to ONE)

| Function                        | Module                | Status               |
|---------------------------------|-----------------------|----------------------|
| `recoveryCoef(date)`            | dcy.js                | KEEP for Phase A (DCY uses it) |
| `recoveryBreakdown(date)`       | dcy.js                | KEEP for Phase A     |
| `computeRecoveryLoad(...)` (inline) | goalModel.js      | DEPRECATED — extract to shared `recoveryDebtClassifier` in a new module (or in `dcy.js`); both goalModel + intelligence + predictedBands read from it |
| recovery debt logic (inline)    | intelligence.js       | DEPRECATED — same    |
| recovery debt logic (inline)    | predictedBands.js     | DEPRECATED — same    |

Phase A scope: extract the 0-3 classifier used by goalModel /
intelligence / predictedBands into ONE function with ONE set of
thresholds. DCY's `recoveryCoef` keeps its own logic for now.

## Coaching prompts (decide: keep or fold into synthesizer)

`coachingPrompts.js` has its own catalog of rule-based prompts that
overlap with Layer 2's burdens + Layer 3's synthesizer. Two choices
for Phase C:

- **A**: Fold prompts into the burden catalog. One rule engine.
- **B**: Keep prompts as a third evidence stream the synthesizer
  consumes (current path). Risk: duplicate logic, divergent text.

Recommendation: **A** in Phase C2. Each prompt becomes a burden;
the synthesizer is the only thing that emits cards.

---

# Glossary

- **Layer 0 / source data**: raw inputs from sensors or user.
- **Layer 1 / first-order derived**: pure calculation from Layer 0.
- **Layer 2 / interpretation**: combines Layer 1 into a canonical
  `userState` (trust, phase, trajectory, burdens, conflicts).
- **Layer 3 / prescription**: today's targets + recommendation cards
  the UI shows.
- **Outcome goal**: what the user wants to achieve (weight, BF%,
  performance metric, race result). Set in Goals UI.
- **Derived target**: tangible daily/weekly number the system
  computes from outcome goals (calorie target, protein floor, miles).
- **Override**: user-pinned tangible target that wins over the
  derived value but doesn't replace it (derived shadow is still
  visible).
- **Burden**: a named state of the body or training that triggers
  recommendations and conflict checks.
- **Conflict**: two active outcome goals + current burdens that
  combine to make at least one of the goals unachievable.
- **Phase**: where in the cut/maintenance/surplus continuum the user
  currently is, factored by RMR headroom.
- **Trajectory**: whether the user is on/behind/ahead/stalled vs
  their goal pace.
- **Trust score**: deterministic-for-now classifier of whether a
  source's number matches the scale's truth (Garmin burn over/
  aligned/under; intake log tight/loose; RMR model aligned/adapted-down).

---

# Open questions — status

1. **Date-aware derived targets.** ✅ RESOLVED 2026-05-23.
   Decision: **reconstruct historical target per date** using a new
   `dailySnapshots` ledger (see Layer 0 entry above). The Calendar
   drawer for May 20 shows what the model said on May 20, frozen
   at that time. For dates with no snapshot, show "no historical
   target stored for this date." Never back-fill from current state.

2. **Profile field migration timing.** Phase B1 decision. Plan:
   read both old + new for a 2-week compatibility window, then
   write to override system + delete from profile. Start the clock
   when Phase B1 lands.

3. **Coaching prompts merge order.** Phase C2 decision. Spec
   recommends Option A (fold into burdens). Open until C2 starts.

4. **DCY survives or is folded?** ✅ RESOLVED 2026-05-23.
   Decision: **leave DCY alone during Phase A**. Revisit in Phase C
   after burden catalog + conflict detector ship. DCY's current
   `dcy.js` functions stay as-is; Phase A treats `bmr()`, `tdee()`,
   `recoveryCoef()` as currently-used (no DEPRECATED tag yet) but
   we still want their callers to migrate where possible without
   breaking DCY itself.

---

# How to use this doc

- Whenever you add a Layer 0 field, append it to LAYER 0 above.
- Whenever you add a Layer 1 derivative, designate the canonical
  function here BEFORE writing code. If a duplicate exists, mark it
  DEPRECATED and add to A3 migration.
- Whenever you add a burden or conflict, append to the catalog above.
- Whenever a UI surface needs a new number, ask: is it already in
  `numbers`? If yes, use it. If no, add it to `numbers` (Layer 2)
  and surface via `getEffectiveTargets` (Layer 3). Don't compute
  in the UI.
