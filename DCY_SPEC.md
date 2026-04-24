# Dynamic Conditioning Yield (DCY) — Readiness Score Spec

Generated: 2026-04-22
Status: **decisions locked**, ready to implement.
Supersedes: the existing `computeDailyScore` composite in `trainingStress.js`
for the Big Moon / Small Moon rendering. The current function stays wired
until the rewrite lands to avoid a broken hero during development.

---

## 1. The equation

```
DCY_today  =  F_today · N_today  −  G_today · (1.1 − R_today)

where
  F_today  =  EWMA(dailyStress series, τ = 42)     ≈ "adapted fitness"
  G_today  =  EWMA(dailyStress series, τ = 7)      ≈ "accumulated fatigue"
  N_today  ∈ [0, 1]                                  fuel adequacy coefficient
  R_today  ∈ [0, 1]                                  autonomic recovery coefficient
```

The two EWMAs are continuous exponentially-weighted moving averages over
the full daily-stress history. No rolling-window cliff edges. No explicit
`t` parameter — every prior training input contributes with age-decayed
weight automatically.

**Interpretation of the output:**
- `DCY > 0` → fitness stock exceeds fatigue cost → **Absorbing**.
- `DCY ≈ 0` → balanced → **Neutral**.
- `DCY < 0` → fatigue exceeds fitness → **Depleting**.

Typical range: roughly −30 to +25 for a well-calibrated dailyStress scale.
Display format is covered in §6.

---

## 2. Activity pillar — `dailyStress(dateStr)`

### 2.1 Per-session stress score

Every activity on `dateStr` contributes exactly one `sessionStress` number
on a shared TSS-equivalent scale where 100 ≈ 1 hour of running at
lactate-threshold pace (matching existing rTSS).

**For runs** — unchanged from today:
```
sessionStress = rTSS from computeRTSS({durationSecs, avgPaceRaw, ftpPace})
```

**For strength / Hyrox / any non-run session** — new TRIMP helper:
```
HR_rest   = latest sleep[].restingHR     (from recovery pipeline)
HR_max    = profile.maxHR ?? (220 − profile.age)
HRR       = (avgHeartRate − HR_rest) / (HR_max − HR_rest)    // 0..1
y         = profile.sex === 'F' ? 1.67 : 1.92                // Banister constants
TRIMP     = (durationSecs / 60) · HRR · 0.64 · e^(y · HRR)
sessionStress = TRIMP
```

The `0.64` calibration factor is standard Banister and aligns a typical
moderate endurance session's TRIMP with a comparable rTSS. We'll refine
by spot-checking 5–10 logged runs where both rTSS and TRIMP can be
computed from the same row, and adjusting the coefficient once.

**Fallback if `avgHeartRate` is missing on a strength session:**
use tonnage-scaled estimate:
```
sessionStress = tonnage / TONNAGE_TO_TSS_K
```
with `TONNAGE_TO_TSS_K` initially 150 (so a 10,000-lb session ≈ 67 TSS),
tuned empirically from your history. This path flags the session as
`stressSource: 'tonnage-fallback'` so the Limiting-Factor diagnostic
can annotate it.

### 2.2 Daily roll-up

```
dailyStress(date) = Σ sessionStress across every activity with that date
                    (runs, strength, Hyrox, mixed, anything counted)
```

### 2.3 EWMA fitness / fatigue

```
F(d) = α42 · dailyStress(d) + (1 − α42) · F(d − 1)
G(d) = α7  · dailyStress(d) + (1 − α7)  · G(d − 1)

α7  = 1 − exp(−1/7)   ≈ 0.1331
α42 = 1 − exp(−1/42)  ≈ 0.0235
```

Initialize `F(d₀) = G(d₀) = 0` at the earliest day we have data and roll
forward. For efficient recompute we cache `{F, G}` per date in
`trainingStressCache` (new storage key; invalidated when any historic
activity is added/edited on/before that date).

---

## 3. Fuel Adequacy pillar — `N_today`

### 3.1 Expenditure

```
TDEE_today = BMR + activityBurn_today + TEF_estimate

BMR source priority:
  1. latest labSnapshots entry with metrics.rmr (measured value)          ← best
  2. Katch-McArdle using latest weight[].skeletalMuscleMassLbs (LBM)       ← sex-agnostic
  3. Mifflin-St Jeor using profile.sex, weight, height, age                ← fallback

Katch-McArdle (sex-independent):
  LBM_kg = skeletalMuscleMassLbs · 0.4536
  BMR    = 370 + 21.6 · LBM_kg

activityBurn_today = Σ (activity.calories OR estimatedBurn) for activities on date
  where estimatedBurn = METs · weightKg · durationHrs   (MET table lookup by activityType)

TEF_estimate = 0.10 · intake_today     (thermic effect of food, 10% flat)
```

### 3.2 Fuel Adequacy coefficient

Weighted geometric mean of three sub-coefficients, each clipped to
[0, 1.1] before the mean so overshooting one can't drag the whole thing
up unfairly:

```
N_cal     = clip( intake_cal  / TDEE_today,            0, 1.1 )
N_protein = clip( intake_pro  / goals.dailyProteinTarget, 0, 1.1 )
N_hydro   = clip( intake_water_L / goals.dailyWaterTarget, 0, 1.1 )

N_today = (N_cal^0.50 · N_protein^0.35 · N_hydro^0.15)
```

Weights:
- Calories 0.50 — the single biggest determinant of energy availability.
- Protein 0.35 — drives adaptation / recovery synthesis.
- Hydration 0.15 — matters but saturates fast.

Geometric mean (vs arithmetic) means that any *one* input near zero pulls
the whole coefficient down sharply — which is the right behaviour: eating
2,500 kcal with 30g protein shouldn't score the same as 2,500 kcal with
150g protein.

### 3.3 Meal-timing refinement (v1.1, optional)

Once we add `ateAt` timestamps to `nutritionLog` entries (see §7, new
work), compute a `timingBonus ∈ [0.9, 1.05]`:
- +0.05 if protein entry within 90 min after a training session.
- −0.05 if ≥3 hours pre-workout and the workout was ≥60 min (under-fueled
  start).
- 1.00 otherwise.

Then `N_today *= timingBonus`, re-clipped. v1 ships without this; the
`ateAt` field ships with v1 so the data accumulates silently.

---

## 4. Autonomic Recovery pillar — `R_today`

### 4.1 Deltas (your formulation, confirmed)

```
HRV_acute   = mean overnightHRV over last  7 days (today-inclusive), nulls skipped
HRV_chronic = mean overnightHRV over last 28 days (today-inclusive), nulls skipped
HRV_delta   = HRV_acute / HRV_chronic                 // >1 = trending up = better

RHR_acute   = mean restingHR over last  7 days
RHR_chronic = mean restingHR over last 28 days
RHR_delta   = RHR_chronic / RHR_acute                 // >1 = trending down = better
```

Both deltas are now oriented so higher-is-better. A delta of 1.0 means
"at baseline." Clip each to [0.5, 1.2] to absorb noise and bad readings.

### 4.2 Sleep quality sub-score

```
sleepSub = 0.6 · (sleepScore / 100)                // Garmin composite
         + 0.4 · stageSub                           // stage-based bonus

stageSub = clip( (deepPct / 0.15) · 0.5
               + (remPct  / 0.22) · 0.5,
               0, 1.1 )
  where deepPct = deepSleepSecs / (deep+light+rem)
        remPct  = remSleepSecs  / (deep+light+rem)
        0.15, 0.22 = typical adult healthy-range midpoints
```

If stage data is missing for the night (CSV without the parser fix, or
pre-backfill rows), `stageSub = sleepScore / 100` — falls back to the
Garmin composite so we don't lose the input.

### 4.3 Recovery coefficient

```
R_today = 0.45 · clip(HRV_delta, 0, 1.1)
        + 0.30 · clip(RHR_delta, 0, 1.1)
        + 0.25 · clip(sleepSub,  0, 1.1)
```

Arithmetic mean here (not geometric) — we want a missing input to
partially degrade R, not zero it out, since Body data arrives
asynchronously.

### 4.4 Late-arriving body lookback

As agreed in the design rules, R_today is allowed a 36h lookback *per
input* for HRV, RHR, and sleep — because Garmin typically posts
overnight data late morning. The deltas themselves are already windowed
(7/28 day means), so this only affects "do we have today's data yet."
The `sleepSub` uses the most recent sleep row within 36h. Each input
labels its source date so the UI's Limiting-Factor Alert can show
"Sleep (Apr 21)" when it's reading yesterday's night.

**R2 stays honored** — tile display is still today-strict; only DCY's
internal math gets the lookback.

---

## 5. Limiting-Factor diagnostic

Every DCY render produces a decomposition block:

```
{
  dcy: +7.2,
  state: 'absorbing',       // derived from thresholds in §6
  F: 41.3,
  G: 30.1,
  N: 0.87,
  R: 0.94,
  contributions: {
    fitness:    F * N           = 35.9,
    fatigue:    G * (1.1 - R)   = 4.8,
    fuelDrag:   F * (1 - N)     = 5.4,   // lost adaptation from under-fueling
    recoveryDrag: G * (R - 0.1) = 25.3,  // residual fatigue after recovery
  },
  sources: {
    hrv:   { value: 52, date: '2026-04-22', stale: false },
    rhr:   { value: 48, date: '2026-04-22', stale: false },
    sleep: { score: 85, date: '2026-04-21', stale: true }, // yesterday's night
    nutritionIntake: { cal: 2800, pro: 155, water: 2.6, source: 'cronometer' },
    stressToday: 72,
  },
  limitingFactor: 'fuel_adequacy',  // see rules below
  limitingMessage: 'Activity load is optimal, but fuel adequacy is 13% below target — suppressing adaptation.'
}
```

**Limiting factor rules** (first match wins):
1. If `N < 0.8` and contributes > 30% of the negative pressure → `fuel_adequacy`.
2. If `R < 0.8` and contributes > 30% of the negative pressure → `recovery`.
3. If `G > 1.5 · F` → `acute_overload`.
4. If `F < 0.3 · (28d_avg_F)` → `detraining`.
5. Else → `balanced`.

---

## 6. Display — signed number + glyph

No full words. Number first, state glyph second, source badge if inputs
stale:

```
+12  ↑↑            (strongly absorbing)
+5   ↑             (absorbing)
±0   ·             (neutral / balanced)
−5   ↓             (depleting)
−12  ↓↓            (strongly depleting)
−20  ✕             (overreaching — warn)
```

Thresholds (tunable):
```
dcy ≥ +10              →  ↑↑
+3 ≤ dcy < +10         →  ↑
-3 < dcy < +3          →  ·
-10 < dcy ≤ -3         →  ↓
-20 < dcy ≤ -10        →  ↓↓
dcy ≤ -20              →  ✕
```

**Big Moon:** DCY_today + glyph.
**Small Moon:** mean of daily DCY across Mon–Sun of this week (R1 compliant),
rendered the same way. Labelled "week".

Stale-source badge rendered next to the glyph as a small "·" dot when
any input's source date is not today (typical case in the morning before
overnight sync lands).

---

## 7. Helpers to build

All new code lives in two new files:

```
core/time.js                              (week boundaries, YTD helpers — also covers R1)
core/dcy.js                               (the entire readiness pipeline)
```

`core/dcy.js` exports:

```js
export function dailyStress(dateStr)                     // sum of sessionStress
export function sessionStress(activity, { hrRest, hrMax, sex })
export function trimp({ durationSecs, avgHR, hrRest, hrMax, sex })
export function ewmaSeries(series, tau)                  // [{date, value}, …]
export function fitnessStock(refDate)                    // F = EWMA τ=42
export function fatigueStock(refDate)                    // G = EWMA τ=7

export function bmr()                                     // uses labSnapshot ▸ Katch-McArdle ▸ Mifflin
export function tdee(dateStr)
export function fuelAdequacy(dateStr)                     // N

export function hrvBaseline(refDate, days)
export function rhrBaseline(refDate, days)
export function recoveryCoef(refDate)                     // R

export function dcy(dateStr)                              // full diagnostic object per §5
export function dcyWeekly(refDate)                        // Mon-Sun mean
```

**Caching:** `ewmaSeries` result + per-date `{F, G}` → `localStorage.setItem('arnold:dcy-cache:v1', …)` keyed on last-mutation timestamp of `activities`. Invalidate on any activity add/edit/delete via a hash.

---

## 8. Data-plumbing changes required

| Change | Scope | File(s) | Priority |
|--|--|--|--|
| Preserve sleep stages in CSV parser | Modify parser | `Arnold.jsx:310` — add `deepSleepSecs`, `remSleepSecs`, `lightSleepSecs` to the sleep row rather than collapsing to total | P1 |
| Backfill existing sleep rows | One-time script | `outputs/backfill-sleep-stages.mjs` that re-parses CSV exports already on disk | P1 |
| Store stages from Health Connect sleep | Already schema-supported | Verify `hc-sync.js` maps `stages[]` → `deepSleepSecs` etc. on write | P1 |
| Add `ateAt` timestamp to nutritionLog | New field | `components/NutritionInput.jsx` — add optional time picker; `core/nutrition.js` — accept + persist | P2 (v1 without, v1.1 with) |
| Add `sex` to profile | New field | `Arnold.jsx` profile editor + `goals.js`/profile schema. Optional since Katch-McArdle covers most cases | P2 |
| Add `maxHR` to profile (or derive from activities) | New field | Profile editor; fallback `220 − age` | P2 |
| Tune TONNAGE_TO_TSS_K empirically | Config | `core/dcy.js` constant; log a calibration report on import | P2 |
| Unit conversions audit | Verify | `weight[].weightLbs` vs kg, water mL vs L — ensure every place the DCY pipeline touches is unit-consistent | P1 |

---

## 9. Implementation order

Smallest blast radius first; each stage ends at a working app.

**Stage 1 — Scaffold (no behavior change)**
1. Create `core/time.js` with `startOfWeek`/`endOfWeek`/`inWindow`.
2. Create `core/dcy.js` with stubs that currently call through to the
   existing `computeDailyScore` so the Big Moon keeps rendering.

**Stage 2 — Activity pillar**
3. Implement `trimp()`, `sessionStress()`, `dailyStress()`.
4. Implement `ewmaSeries()`, `fitnessStock()`, `fatigueStock()`. Cache.
5. Unit-check on known sample days: a 60-min easy run should return
   rTSS ≈ 40–50; a heavy strength day with avgHR 130 bpm should TRIMP
   into a similar range. Report calibration.

**Stage 3 — Recovery pillar**
6. Implement `hrvBaseline`, `rhrBaseline`, `recoveryCoef`.
7. Fix CSV parser to preserve sleep stages (P1 data-plumbing item).
8. Backfill sleep stages from existing CSVs on disk.

**Stage 4 — Fuel pillar**
9. Implement `bmr()`, `tdee()`, `fuelAdequacy()`.
10. Optional `sex` profile field if Katch-McArdle+Mifflin fallback proves
    noisy on days without a weight row.

**Stage 5 — DCY composition + display**
11. Implement `dcy(dateStr)` returning the full diagnostic object.
12. Swap Big Moon render in `MobileHome.jsx` HeroRail from
    `computeRolling30d` to `dcy(today)`. Render as signed number + glyph.
13. Swap Small Moon render from `computeRolling7d` to `dcyWeekly(today)`
    (Mon–Sun aligned).
14. Add Limiting-Factor line under the moons.

**Stage 6 — Meal timing (v1.1)**
15. Add `ateAt` to nutritionLog entries with optional time picker.
16. Implement `timingBonus` multiplier in N.

**Stage 7 — Forecasting (v1.2)**
17. `dcyForecast(plannedStress, assumedN, assumedR)` — projects
    tomorrow's DCY given a planned session. Wire into the Plan card on
    Start.

---

## 10. Audit findings

| Item | Finding | Impact on spec |
|--|--|--|
| FIT `calories` field on activity rows | **Present** (`Arnold.jsx:139` preserves, `activityNeeds.js:33` uses) | Expenditure calc uses real FIT calories where available. ✓ |
| `profile.sex` field | **Missing** | Added to P2 plumbing. Mitigated by Katch-McArdle (uses LBM from `weight[].skeletalMuscleMassLbs`). Only needs adding when Mifflin fallback is triggered — which is rare since your weight rows carry BF% |
| `activity.startTime` | **Present** (`Arnold.jsx:139`) | Ready for meal-timing calc as soon as `ateAt` lands |
| Sleep stages in Health Connect | **Schema-supported** (`hc-bridge.js:91` types `stages[]`) | HC-sourced sleep will carry stages; CSV parser is the only gap |
| Sleep stages in CSV | **Collapsed to total hours** (`Arnold.jsx:310`) | P1 parser fix + one-time backfill |
| Existing ACWR function | **Runs-only, rolling sum** (`trainingStress.js:102`) | Deprecated when `fitnessStock`/`fatigueStock` land — but keep the old fn for the EdgeIQ "A:C Zone" display unless we migrate that too |
| Existing `computeDailyScore` | Works; uses 0-100 composite | Not deleted — kept as a fallback during migration. Deprecated once DCY is proven |
| Tonnage→TSS calibration | No empirical anchor yet | Log a calibration report on first run showing: for last 90 days' activities, what TONNAGE_TO_TSS_K best aligns tonnage-derived stress with TRIMP on the same sessions |

---

## 11. Open design choices (non-blocking — sensible defaults shipped)

1. **Initial F and G values.** Option A: initialize to 0 at the earliest
   data date (cold start — DCY reads depleting for a few weeks). Option B:
   seed from the most recent 60 days' average stress. **Default: Option B**
   (pre-seed) because you already have months of activity data in
   localStorage.
2. **Stress contribution from cardio other than runs** (e.g. cycling,
   rowing, swimming). v1 treats all non-run non-strength activities as
   TRIMP-driven if avgHR exists, else MET × duration × weight. Flag for
   later dedicated handling if you start logging these heavily.
3. **Depletion alert trigger.** Currently `dcy ≤ -20 → ✕`. Should it
   notify / vibrate / throw up a banner, or just render? **Default: just
   render in v1** — we'll add notification wiring only if you want it.
4. **Forecast input format.** v1.2 takes a number (plannedStress) rather
   than a full template. Later we can let you pick from saved templates
   and auto-compute the planned stress.

---

Ready to execute when you are. Stage 1 (scaffolding) is a ~30-minute,
zero-risk change; I can do that first and we verify the wiring before
actual math rewrites land in Stage 2.
