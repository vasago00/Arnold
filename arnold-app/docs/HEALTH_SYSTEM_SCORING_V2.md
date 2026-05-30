# Health System Scoring v2 — Design Doc

Owner: Coach engine + scoring rebuild track
Status: Draft — implementation gated on this doc being agreed
Touches: `src/core/healthSystems.js` (only file whose math changes)

---

## 1. Why this exists

Today every Health System score (Brain, Heart, Bones, Gut, Immune, Energy, Longevity, Sleep, Metabolism, Endurance) is computed by a single function, `scoreSystem()`, that walks one input — `nutrients` — and produces a weighted average of nutrient-percent-of-target. Nothing else feeds the score. Not actual sleep duration. Not HRV. Not Coach engine signals. Not training volume. Not body data.

The visible symptom is Sleep/Rest reading 14% when the user actually slept 7.5h with a 70+ sleep score. The math is doing what it was written to do — it's just measuring "did you log enough magnesium and glycine in Cronometer today" and calling that "Sleep/Rest." That's not what the user thinks the number means, and it's not what the surface labels claim it means.

Meanwhile we have:
- A full Coach engine (`coachSignals.js`) producing 17 calibrated signals: sleep debt, sleep quality, HRV depression, RHR drift, recovery velocity, energy availability, monotony/strain, glycogen, polarization, TDEE drift, etc.
- A `SYSTEM_COACH_SIGNALS` map already declared at `healthSystems.js:1027` that says which signals are relevant to which system. It's only used by the Coach Read panel.
- Direct outcome measurements sitting in storage: sleep rows from Garmin, HRV rows, weight + body composition rows, activities with distance/duration/HR.

The rebuild's job is to **make the score reflect what the system actually measures**, using the data we already have.

---

## 2. Goals & non-goals

**Goals**
1. Each system's score reflects its real outcome state, not just one of three input streams.
2. Coach signals (already computed elsewhere) feed system scores.
3. Missing nutrient logs no longer crater a system's score.
4. Scoring is debuggable — every score can explain its three component contributions.
5. Public API (`getSystemsReport`, `getSystemDetail`) stays signature-stable so no UI surface needs editing.

**Non-goals**
1. DCY pillars (F / G / N / R) and the Daily Score on Start are untouched. They're working.
2. The 7-day weekly view (`getSystemWeekly`) keeps its current shape; we can revisit it later if scores look weird in retrospect.
3. The `getBioactiveStack` function and any nutrition tracking math is unchanged.
4. The `SYSTEMS` array (system metadata: id, name, color, weights) stays in place. Only the *interpretation* of `weights` changes — they become nutritional-component weights specifically, not whole-score weights.
5. No new persistent storage keys. v2 reads from the existing data spine.

---

## 3. Architecture — three-component blend

Every system score becomes a weighted blend of three independently-computed sub-scores, each on a 0–100 scale.

| Component | Default weight | What it measures |
|-----------|---------------|------------------|
| **Outcome** | 50% | The thing the system literally is. Direct measurement from storage. |
| **Coach** | 30% | Coach engine's interpretation of where the system is trending. |
| **Nutrition** | 20% | Current `scoreSystem` math, demoted from "the score" to one input. |

`finalPct = outcomeWeight × outcomePct + coachWeight × coachPct + nutritionWeight × nutritionPct`

Critically: **when a component has no usable data, it drops out and the remaining components renormalize.** Same pattern `recoveryCoef` in `dcy.js` uses. A new user with no Cronometer logs and no Coach signal history still gets a sensible score from whatever Outcome data is available; a power user with everything wired up gets the full blend.

Per-system override of these defaults is allowed and documented in section 5.

### Why a blend, not a winner-take-all

Each component has known failure modes:
- **Outcome** is noisy day-to-day (one bad sleep ≠ broken system).
- **Coach** is interpretive — it can be slow to react when state changes overnight.
- **Nutrition** is the most laggy and most prone to missing-data zeros.

Blending damps each one's blind spots. The renormalization rule means a missing component never produces a misleading zero — it produces "we don't know about that part, here's what we do know."

---

## 4. Component definitions

### 4.1 Outcome component (0–100)

Each system declares 1–3 outcome resolvers. Each resolver returns either a 0–100 score for "is the underlying biology in good shape" or `null` if no data. The component's final score is the average of the non-null resolvers.

Resolvers shipped in v2 are listed per-system in section 5. The full set:

| Resolver name | Reads from storage | Score function |
|---|---|---|
| `recentSleepDuration` | `sleep` rows last 7d | linear ramp 0% at 5h → 100% at user's `targetSleepHours` (default 8) |
| `recentSleepScore` | `sleep` rows last 3d | average sleep score / 100 |
| `hrvVsBaseline` | `hrv` + `sleep`, 7d acute vs 28d chronic | acute/chronic ratio mapped: 0.85→0%, 0.95→50%, 1.05+→100% |
| `rhrVsBaseline` | `sleep` rows, 7d acute vs 28d chronic | chronic/acute ratio (inverted), same mapping as HRV |
| `weeklyVolume` | activities, last 7d | hours/wk vs `weeklyTimeTargetHrs` (90% → 100%, 70% → 50%) |
| `weeklyMileage` | activities, last 7d, runs only | miles/wk vs `weeklyRunDistanceTarget` |
| `weeklyStrengthSessions` | activities, last 7d | sessions vs `weeklyStrengthTarget` |
| `weightVsTarget` | `weight` rows, latest | abs delta from `targetWeight` mapped: ±2% → 100%, ±5% → 80%, ±10% → 40%, beyond → 0% |
| `bodyFatVsTarget` | `weight` rows, latest with bodyFatPct | same drift mapping against `targetBodyFat` |
| `leanMassVsTarget` | `weight` rows, latest with skeletalMuscleMassLbs | linear ramp 70%→100% of `targetLeanMass` |
| `bodyBatteryAvg` | Garmin sleep rows, latest body battery | direct 0–100 |
| `monotonyHealth` | derived from `coachSignals.monotonyStrain` | inverted: low monotony = high score |
| `recoveryTrend` | derived from `coachSignals.recoveryVelocity` | direction × magnitude → 0–100 |

A resolver returns `null` when its inputs are missing. The outcome component then averages only the resolvers that returned a number. If ALL resolvers return null → outcome component = null → it drops out of the blend.

### 4.2 Coach component (0–100)

The `SYSTEM_COACH_SIGNALS` map at `healthSystems.js:1027` already declares per-system signal lists. For each listed signal in `userState.coachSignals`:

1. Read `sig.status` (e.g., `'concerning'`, `'moderate'`, `'positive'`, `'recovered'`, etc.)
2. Map to a 0–100 contribution via this table:

| Status word(s) | Score contribution |
|---|---|
| `positive`, `paid`, `stable`, `recovered` | 100 |
| `mild`, `rising`, `mixed`, `adapting`, `hot` | 70 |
| `moderate`, `warning`, `attention`, `impaired`, `slowing`, `depleted`, `grey-zone`, `low`, `sparse-easy` | 50 |
| `severe`, `concerning`, `concern` | 20 |
| `info`, unknown, null | drop |

Component score = arithmetic mean of contributions from signals that produced a number. If a system has zero matching signals OR all signals dropped, the Coach component = null and drops out of the blend.

### 4.3 Nutrition component (0–100)

This is the current `scoreSystem()` math, kept as-is. Walks `system.weights`, computes nutrient-percent-of-target, weighted average, scales to 0–100. The only change is what we do with it: it's no longer the final score, it's one input.

If `getOptimalTargets(dateStr)` returns nothing usable (e.g., user has no nutrition data at all and `findBestNutrientDate` produced a stale day), the nutrition component returns null and drops out.

---

## 5. Per-system specification

Each system declares its three component weights (defaults shown when not overridden) and its outcome resolvers. Listed in `SYSTEMS_V2_CONFIG` (a new constant alongside `SYSTEMS`).

| System | Outcome weight | Coach weight | Nutrition weight | Outcome resolvers |
|---|---|---|---|---|
| **brain** | 40% | 40% | 20% | `recentSleepScore`, `hrvVsBaseline` (cognition proxies; we don't measure cognition directly) |
| **heart** | 50% | 30% | 20% | `rhrVsBaseline`, `hrvVsBaseline` |
| **bones** | 50% | 20% | 30% | `weeklyStrengthSessions`, `leanMassVsTarget` |
| **gut** | 30% | 30% | 40% | (no direct resolver yet — gut outcomes need new signals; nutrition gets higher weight here as fallback) |
| **immune** | 40% | 30% | 30% | `recentSleepScore`, `hrvVsBaseline` (immune signals are sleep + recovery state proxies) |
| **energy** | 50% | 30% | 20% | `bodyBatteryAvg`, `recoveryTrend` |
| **longevity** | 30% | 40% | 30% | `monotonyHealth`, `weeklyVolume` (consistency + appropriate dose) |
| **sleep** | 60% | 30% | 10% | `recentSleepDuration`, `recentSleepScore`, `hrvVsBaseline` (sleep is one of the few we measure directly) |
| **metabolism** | 50% | 30% | 20% | `weightVsTarget`, `bodyFatVsTarget` |
| **endurance** | 50% | 30% | 20% | `weeklyMileage`, `weeklyVolume` |

**Rationale notes**:
- **Sleep** gets a 60/30/10 split because sleep is one of the few systems where we have direct, high-quality measurement (Garmin sleep score + duration + stages). Nutrition contributes least because no nutrient causes good sleep — they support it. 10% acknowledges this without zeroing it out.
- **Gut** keeps a higher nutrition weight (40%) because we have no direct gut outcome signals yet. Fiber + meal-timing-rhythm + hydration-pattern are future signals; until we have them, nutrition is the best proxy.
- **Brain**, **Immune** lean equally on Outcome and Coach because we don't measure cognition or immunity directly. Sleep + HRV are the best universal proxies, but Coach signals add the recovery + monotony interpretation that improves the read.

These weights are **starting points**. Section 8 (open questions) flags which ones we explicitly expect to retune.

---

## 6. Renormalization rule

After computing each component, drop the nulls and renormalize the remaining weights to sum to 1.0:

```
present = components.filter(c => c.score != null)
if present.length === 0: return null  // no data at all
wSum = present.reduce((s, c) => s + c.weight, 0)
final = present.reduce((s, c) => s + (c.weight / wSum) * c.score, 0)
```

This means:
- A user with full data gets the declared blend.
- A user with no Coach signals yet (cold start, < 7d data) gets `(outcomeWeight × outcomePct + nutritionWeight × nutritionPct) / (outcomeWeight + nutritionWeight)` — purely Outcome + Nutrition.
- A user who logs nothing in Cronometer gets Outcome + Coach only.
- A user with literally no data (no sleep, no HRV, no activities, no nutrition) gets `null`, and the UI shows "—" instead of a fake number.

This is the same renormalization shape `recoveryCoef` uses for HRV/RHR/Sleep in `dcy.js`. Keeping it consistent is intentional.

---

## 7. API stability commitment

The two functions every UI surface calls today:

```js
getSystemsReport(dateStr) → [{ id, name, color, pct, status, comment }, ...]
getSystemDetail(systemId, dateStr) → { system: { ...id, name, pct }, details: [...nutrients] }
```

Both signatures stay identical. The shape of the returned objects stays identical. The numeric `pct` field is the only thing that changes meaning underneath — it's the v2 blend now, not the v1 nutrient-only score.

**One new optional argument**, additive: `getSystemsReport(dateStr, { coachSignals })`. When passed, the v2 math uses those signals. When omitted, v2 computes them lazily via `computeUserState`. This lets callers like the panel (which already has a userState in scope) skip the redundant compute.

Surfaces that consume the API today and will continue to work untouched:
- `MobileHome.jsx` — health system tile grid + `SystemDetailPanel`
- `Arnold.jsx` — web tile grid + `WebSystemDetail`
- `NutritionInput.jsx` — Fuel tab health system summary
- `intelligence.js` — userState construction

Zero edits to any of these files in the implementation phase. The flag below provides one-line rollback.

---

## 8. Failure modes & open questions

### Failure modes the design handles

| Failure | What v2 does |
|---|---|
| Cold start, no data | Returns `null`, UI shows "—" |
| Nutrition log missing for today | Nutrition drops, score still meaningful from Outcome + Coach |
| HRV sensor not worn | Outcome resolver for HRV returns null, other resolvers carry the system |
| Coach signal data sparse (< 7d history) | Coach component drops out, score is Outcome + Nutrition only |
| All three components null | Score = null, no fake number is displayed |
| User has weight goal but never weighed in | `weightVsTarget` resolver returns null, doesn't drag score down |

### Open questions to validate during tuning (task #205)

1. **Sleep weight 60/30/10 — too aggressive?** The fix for the user's "Sleep 14%" complaint depends on outcome carrying the score. If the Outcome resolver maps too lenient, sleep stays inflated even on a bad week.
2. **Brain at 40/40/20** — without a direct cognition signal, is 40% Outcome from sleep+HRV proxies misleading? Could argue for shifting that weight to Coach.
3. **Gut staying nutrition-heavy** — placeholder until real gut signals exist. Should we mark it explicitly as "estimated" in the UI?
4. **Renormalization can let Coach dominate** — when only Coach is present, an `attention` signal cluster scores ~50, which lands the system at exactly 50% (yellow). Is that the right interpretation when other inputs are missing?
5. **Cap at 100 or allow ≥100 overshoots?** v1 caps at 100. Outcome resolvers can produce 100+ (e.g., weekly volume 110% of target). Proposal: cap at 100 for display; expose the raw value in the debug helper.

These get answered during the tuning loop in task #205 with real data, not by guessing now.

---

## 9. Rollout plan

1. **Implementation** (task #203): write v2 `scoreSystem()` + outcome resolvers + per-system config. Feature-flag via a single `USE_V2_HS_SCORING` const at the top of `healthSystems.js`. Default `true` once #205 passes; ship to source control as `false` until then.
2. **Wiring** (task #204): pass optional `coachSignals` through `getSystemsReport` / `getSystemDetail`. Panel calls update to pass them.
3. **Tuning** (task #205): run v1 and v2 side-by-side via a debug helper (`window.hsScoreDebug(systemId, dateStr)`) that prints both. Walk every system, identify scores that feel wrong, adjust weights or resolver thresholds. Document final weights in this doc.
4. **Surface verification** (task #206): four manual checks — mobile tile grid, mobile panel, web tile grid, web panel. Look for: (a) does anything crash, (b) do scores look sensible, (c) does the existing "Coach Read" section in the panel still match what the score now says (it should — they're now reading the same signals).
5. **Flip the flag** and ship.

---

## 10. What this doc is not

Not a commitment to a specific UI change. Not a Daily Score / DCY redesign. Not a touch on the Coach engine itself. Not a re-do of nutrition math.

It's a swap of the formula behind the number labeled "Sleep/Rest" (and 9 others) so that what's displayed matches what those labels claim.

---

## 11. Validation methodology — biweekly look-back

Weights set in §5 are educated guesses. The only way to know if they're right is to measure whether the score *predicts or explains* something real. This section defines the harness; task #207 implements it.

### 11.1 Cadence

A 14-day rolling window. The harness runs automatically every 2 weeks (via the scheduled-tasks MCP) and on-demand via `window.hsValidationReport(systemId?)` in the console. 14 days × 10 systems = 140 system-days of paired observations — enough for meaningful correlation statistics on the systems with high-frequency ground truth, sufficient to flag drift on the slower-moving ones.

### 11.2 Ground-truth signals per system

Each system needs a "thing we're trying to be right about" that's measurable independently of the score itself. Some systems have strong ground truth (Sleep, Heart, Metabolism, Endurance); some need proxies (Brain, Bones, Immune, Longevity); one (Gut) has none until we add subjective inputs. Honest table:

| System | Ground truth | Quality | Notes |
|---|---|---|---|
| **sleep** | next-night sleep score, next-day HRV | strong | High-frequency, direct measurement |
| **heart** | 7d-forward HRV slope, RHR stability | strong | RHR and HRV are independent of nutrition logging |
| **metabolism** | 14d-forward weight delta vs target trajectory | strong | Real outcome with clear directionality |
| **endurance** | weekly miles + hours actually completed vs plan | strong | Adherence data already in storage |
| **energy** | next-day Body Battery + RPE on planned workout | medium | RPE not yet logged; Body Battery alone for v1 |
| **bones** | strength sessions completed + injury-free days | medium | Injury flag would need user input |
| **brain** | next-day HRV + sleep score as cognition proxy | proxy | No direct cognition measurement |
| **immune** | sick days (user-logged) + acute HRV drops | proxy | Sick-day logging not built yet |
| **longevity** | 30d training consistency + monotony health | proxy | No short-term outcome; long-game metric |
| **gut** | none for v1 | none | Needs subjective inputs (bloat, regularity, etc.) — call out as "estimated" in UI |

Gut, Immune, Brain, Bones will report partial validation only. That's honest data — better than overclaiming accuracy.

### 11.3 Statistics the harness produces

For each system, for the 14-day window:

1. **Spearman rank correlation** (ρ) between daily score and ground-truth signal. Rank-based because the underlying distributions aren't normal and we care about ordering, not exact values.
2. **Pearson correlation** (r) as a second view — flags non-monotonic relationships when the two diverge.
3. **R²** from a single-variable linear regression of ground-truth onto score. Gives "% of ground-truth variance the score explains."
4. **Residual standard deviation** — how wrong the score is when it's wrong, in the units of the ground-truth variable.
5. **Direction-agreement %** — on days where ground truth moved up, did the score predict up? Cheap directional sanity check, complements ρ.
6. **Component contribution decomposition** — for each system, re-run the score using each component alone (Outcome only / Coach only / Nutrition only) and report which produced the highest correlation. Tells us *which component is doing the predictive work.*

### 11.4 Decision rules

After each 14-day report, the rules for what counts as "weights are right":

- **Keep weights as-is** if Spearman ρ ≥ 0.5 AND direction-agreement ≥ 65%.
- **Investigate** if 0.3 ≤ ρ < 0.5 — score is correlated but weak. Look at which component contributed best alone; may need to shift weight toward it.
- **Re-tune** if ρ < 0.3 OR direction-agreement < 55%. Weights are not matching reality.
- **Flag for redesign** if a component has near-zero stand-alone correlation. That component isn't pulling weight even at 100% — its inputs may be wrong, not its weighting.

Decisions are logged in this doc as a "Tuning log" at the bottom. Each change has: date, system, what changed, why, what we expected to happen.

### 11.5 Output

The harness produces:
- A console-table summary keyed by system: `{ id, ρ, r, R², residualSD, dirAgree%, bestComponent, recommendation }`.
- A JSON blob saved to `storage.set('hsValidationHistory', [...])` so 3-month trends are visible.
- An optional one-line digest line for the Coach surface: *"HS scoring drifted on Brain (ρ=0.22) — review weights."* — but only when an actionable recommendation fires, not every run.

### 11.6 Honest limits

- 14 days is a short window for systems with slow-moving ground truth (longevity, bones). Treat those reports as drift indicators, not statistical proof.
- Self-correlation risk: if both score and ground truth read the same upstream signal (e.g., Sleep score uses HRV in Outcome AND HRV is the ground truth), correlation is partially baked in. The harness flags overlapping inputs in the report.
- We're not running a held-out test set — every day is in-sample. For now that's acceptable because we're not training weights statistically; we're sanity-checking hand-set weights against reality. If we ever introduce learned weights, we add held-out validation then.

---

## Tuning log

### 2026-05-29 — Trajectory lift + auto-derived targetLeanMass (task #208)

**Triggered by**: First v1-vs-v2 comparison across all 10 systems. Metabolism dropped 90 → 53, Bones dropped 73 → 42. Math was correct, framing was wrong: resolvers measured *distance from target* without measuring *trajectory toward target*. User mid-cut would score identically to user trending wrong way.

**What changed**:

1. `_trajectoryTowardTarget(rows, target, accessor, daysBack)` — new helper. Linear regression over last 28 days; returns lbs (or %) per week IN THE DIRECTION OF the target. Positive = moving correct way. Requires ≥ 4 data points.

2. `weightVsTarget` — base score unchanged; if trajectory > 0, add up to +15. Mapping: 0.5 lb/wk → +5, 1.0 → +10, 1.5+ → +15. A user 8.6% above target weight but losing 1 lb/wk now scores ~61 instead of ~51.

3. `bodyFatVsTarget` — same shape, slower scaling (BF moves slower than weight). 0.25%/wk → +5, 0.5%/wk → +10, 0.75%+ → +15.

4. `leanMassVsTarget` — when `targetLeanMass` is undefined in goals, derives a default at score-time: `targetWeight × (1 - targetBodyFat/100)`. For the user's 170 lb / 18% BF goal, that's ~139.4 lb. Eliminates the null-return that was making Bones single-source on `weeklyStrengthSessions` alone.

**Expected impact** (rough, real numbers TBD after user re-runs `hsScoreDebug`):
- Metabolism: 53 → ~63 if weight slope is toward target
- Bones: 42 → ~55-60 if lean mass is meaningful fraction of derived target
- All other systems: unchanged (resolvers they don't use)

**Skipped**: Loosening the 5-10% drift ramp from 80→40 to 80→60. That would inflate stationary-state scores back toward v1's flattery. The trajectory mechanism is the *honest* fix because it rewards motion, not static proximity.

**Open question**: Should trajectory penalize too? Currently trajectory adds when moving correct way, does nothing when moving wrong way. Could subtract up to -10 for negative trajectory. Deferred until we see how the additive form lands.

### 2026-05-29 — Body fat ramp softening + skeletal-muscle target fix

**Triggered by**: Expanded component dump showed two new problems. (1) `bodyFatVsTarget` returning 1.54 for ~19.6% drift — too brutal given body fat moves slowly. (2) `leanMassVsTarget` returning 0 because the user's row carries `skeletalMuscleMassLbs: 71.9` (Withings BIA), but the derived target was 139 lb (total lean from `targetWeight × (1 - BF%)`). Comparing skeletal-muscle-only against total-lean tanked the score even though the user is at target.

**What changed**:

1. `bodyFatVsTarget` — softened ramp. Old: 0-2% drift → 100, ≤5% → 80, ≤10% → 40, ≤20% → 0. New: ≤5% → 100, ≤15% → 80, ≤30% → 40, ≤50% → 0. Body fat at 21.5% vs target 18% (drift 19.6%) now scores ~68 instead of 1.5. Trajectory lift unchanged (0.25%/wk = +5, 0.75%+ = +15).

2. `leanMassVsTarget` — field-aware. Reads `totalLeanMass` / `leanMassLbs` first, falls back to `skeletalMuscleMassLbs`. Target derivation matches the source: total lean uses `targetWeight × (1 - targetBodyFat/100)`, skeletal muscle uses `targetWeight × 0.42` (athletic-male skeletal-muscle fraction). For the user's 170 lb / 18% BF goal with skeletal muscle data, derived target = 71.4 lb. Their actual 71.9 lb now maps to 100, not 0.

**Expected impact**:
- Metabolism outcome (weight + body fat avg) goes from ~26 to ~60 → final score ~70 (up from 54).
- Bones outcome (strength sessions + lean mass avg) goes from 0 to ~50 → final score ~67 (up from 42).

**Note on the sex coefficient**: hardcoded 0.42 is an athletic-male average. When `profile.sex` is reliably populated we can split to 0.42 male / 0.38 female. Not blocking the rebuild.

### 2026-05-29 — Flag flipped: `USE_V2_HS_SCORING = true`

**Final v1 → v2 baseline at flip time** (Emil's storage):

| System | v1 | v2 | Δ | Reading |
|---|---|---|---|---|
| brain | 78 | 56 | −22 | Honest — sleep debt + HRV depression |
| heart | 88 | 78 | −10 | Cardiac signals vs baseline, fair |
| bones | 79 | 69 | −10 | Lean-mass fix landed; strength gap remains |
| gut | 72 | 73 | +1 | No outcome resolvers; coach + nutrition only |
| immune | 87 | 70 | −17 | Same drivers as brain |
| energy | 70 | 87 | +17 | Body Battery genuinely high |
| longevity | 89 | 77 | −12 | Reasonable training-consistency adjustment |
| **sleep** | **15** | **62** | **+47** | The headline fix |
| **metabolism** | **94** | **61** | **−33** | Honest mid-cut interpretation |
| endurance | 68 | 86 | +18 | Hitting mileage target |

**Rollback**: flip `USE_V2_HS_SCORING` back to `false` at the top of `healthSystems.js`. No other changes needed.

**Next**: surface verification (task #206) — confirm all four surfaces still render. Then the biweekly validation harness (task #207) to keep the weights honest over time.

### 2026-05-30 — 7-day median smoothing for body composition resolvers (task #211)

**Triggered by**: Fresh-morning Garmin sync delivered new BIA values, and overnight Metabolism dropped from 61 to 44. Component dump showed `weightVsTarget: 41.86` (down from 51.6) and `bodyFatVsTarget: 21.6` (down from 68). Back-solving the curves implied a single-day jump of +2 lb on the scale and ~+3.5% body fat — which isn't physiology, it's BIA sensor noise from hydration / glycogen state / time-of-day. The resolvers were reading the single most-recent row.

**What changed**:

1. New helper `_recentMedian(rows, accessor, daysBack = 7)` — robust to outliers (a single bad reading can't move the median more than one slot in the sorted order). Mean would have been worse here because a hydration-low day pulls the average toward the noise.

2. `weightVsTarget`, `bodyFatVsTarget`, `leanMassVsTarget` — all three now use `_recentMedian` over the last 7 days instead of the single most-recent row. The trajectory function over 28 days was already correctly smoothed (linear regression), so its lift is unchanged.

**Expected behavior**: Metabolism stabilizes day-to-day instead of swinging on single BIA readings. The resolvers still react to real changes (a sustained 3-day shift will land in the 7-day median within ~2-3 days), but ignore single-day noise.

**Why median, not mean**: BIA noise tends to be asymmetric — readings tend to spike high (lower hydration in the morning) more often than they spike low. Mean is dragged toward the outlier; median isn't. With 7 days, you need 4+ outliers to move the median, which is much closer to real physiology change than the sensor's daily jitter.

**Future thought**: same pattern probably applies to `recentSleepScore` (sleep score noise is real) and any future direct-measurement resolver. Trajectory and median compose cleanly — score reflects "where you are smoothed" + "trend over 28 days," not "today's snapshot."

### Postmortem note — Garmin "ticket_not_found" 2FA self-flip

When the Cloudflare worker returns `garmin_failed` / `ticket_not_found` 401s across `/garmin/all` and `/garmin/weight` endpoints (sometimes with `/garmin/activities/recent` still working), the cause has been **Garmin's account 2FA flipping itself back on**. Garmin re-enables 2FA periodically — possibly after suspicious-IP detection or as a security policy enforcement. The worker can't authenticate when 2FA is on (it can't solve the email/SMS challenge).

**Recovery path**: log into `connect.garmin.com` directly → Account → Security → disable 2FA → re-run the Garmin sync. Takes < 60 seconds once you know to check.

**Future fix idea (not blocking)**: the Cloud Sync panel could detect repeated 401s with `ticket_not_found` and surface a banner: *"Garmin 2FA may have re-enabled itself. Disable it at connect.garmin.com → Security."* — saves the user from having to remember the pattern.

### 2026-05-30 — Validation harness shipped (task #207)

Implemented per §11 of this doc. Lives at the bottom of `healthSystems.js` as a self-contained block. Exports:

- `runValidationReport(daysBack = 14, systemIds = null)` — the analytical engine.
- `window.hsValidationReport([ids?])` — console-friendly table view.
- `window.hsValidationHistory()` — last 50 saved runs.

**Auto-run on boot.** A 14-day TTL gate fires the report automatically on module load if the last run is stale. Fires once per app session, 5 seconds after boot (lets cloud-sync land fresh data first). Logs:

- `[HS v2 validation] All systems within healthy correlation thresholds.` — silent pass case.
- `[HS v2 validation] Systems flagged for tuning attention: <id> (<rec>); …` — attention case, surfaces actionable recommendations from §11.4 decision rules.

**Statistics computed per system per run**: Spearman ρ, Pearson r, R², residual SD, day-over-day direction agreement %, plus a component decomposition (which of outcome / coach / nutrition correlates best alone). Math is self-contained — no external stats library.

**Recommendation engine maps ρ + direction-agreement → action**:
- ρ ≥ 0.5 AND dir-agree ≥ 0.65 → keep weights
- 0.3 ≤ ρ < 0.5 → investigate; consider shifting weight toward `bestComponent`
- 0 ≤ ρ < 0.3 → re-tune; the best component carries the predictive signal
- ρ < 0 → flag for redesign — score predicts inversely

**Ground truth per system**: as defined in §11.2. Gut returns null (no usable truth without subjective inputs).

**Persisted history**: each run pushed to `storage.hsValidationHistory` (capped at 50). Lets us look at 3-month tuning trends.

**Honest limits**: still no held-out test set (every day is in-sample). We're sanity-checking hand-set weights, not training learned ones. If we ever introduce learned weights, we add k-fold validation then.

### 2026-05-30 — Harness v1.1: concurrent ground truths + variance check (task #214)

**Triggered by**: First v1.0 report on Emil's 14-day data showed mostly negative or near-zero correlations across systems. Three diagnoses:

1. v1.0's ground truths were *future-window predictions* (next-night sleep score, next-7d HRV). Sleep system's job isn't to predict tomorrow's sleep — that's mostly random. The score's job is to reflect *current state* of the underlying biology. Reframed every ground truth as concurrent (trailing or surrounding) state.

2. "Best component = nutrition" was a noise artifact. Nutrition swings hardest day-to-day (one missed log tanks it), so Spearman picked it as "best" purely on variance, not on predictive value. Added a variance check: components with SD < 5 score points get excluded from `bestComponent` selection.

3. Bones/longevity windows were too short. Both have low daily cardinality (0-2 strength sessions/wk; consistency reads over 30d). Bumped per-system: bones 30d, longevity 30d, metabolism 21d. Default for sleep/heart/energy/etc. stays 14d.

**New ground truths**:

| System | v1.0 | v1.1 |
|---|---|---|
| sleep | next-night sleep score | trailing 7d Body Battery avg |
| heart | next-7d HRV mean | trailing-7d avg run HR (inverted 120→100, 180→0) |
| metabolism | next-14d weight mean | trailing 14d weight-vs-target score |
| endurance | trailing-7d hours | unchanged |
| energy | next-day Body Battery | trailing-3d Body Battery avg |
| bones | trailing-7d strength count | trailing-14d strength count |
| brain | (proxy: next-night sleep) | (proxy: trailing 7d Body Battery) |
| immune | (proxy: next-7d HRV) | trailing-7d HRV mean |
| longevity | trailing-30d distinct training days | unchanged (already concurrent) |

**New output fields**: `componentSD` (standard deviation of each component over the window — null `bestComponent` now traceable to "the component was too flat"). `window` (which per-system window was used).

**Honest acknowledgment**: concurrent ground truths risk tautology (if Sleep score uses HRV and ground truth IS HRV, correlation is baked in). We mitigate by choosing ground truths with PARTIAL independence — e.g., heart's truth is run HR (independent of HRV/RHR baselines), sleep's truth is Body Battery (derived from sleep + stress, partial overlap). Fully independent validation requires subjective signals (RPE, sick-day log) we don't yet collect — flagged as a future "ground-truth v2.0" enhancement.

### 2026-05-30 — Endurance weights re-tuned to 80/15/5 (task #215)

**Triggered by**: v1.1 validation run. Endurance blended ρ = -0.05 (flag-for-redesign band) but component decomposition showed Outcome alone at ρ = 0.378 with trailing-7d hours. Means Coach + Nutrition were not just dilutive but **inversely predictive** for this system — polarization / monotonyStrain / dowPatterns / recoveryVelocity coach signals tend to flag "concerning" exactly when training volume is high (which is when endurance should look strongest). Adding their weight to the blend pulled the score away from the truth.

**What changed**:
- `SYSTEMS_V2_CONFIG.endurance.weights`: `{ outcome: 0.50, coach: 0.30, nutrition: 0.20 }` → `{ outcome: 0.80, coach: 0.15, nutrition: 0.05 }`. Outcome dominates; Coach and Nutrition retained as minor modifiers but can't move the score against the volume signal.

**Expected impact**: Endurance ρ should flip from -0.05 to ~+0.35 (close to the standalone Outcome ρ of 0.378), landing in the "investigate" band. Direction-agreement % should rise from 62% to ~70%+.

**Caveat — what this does NOT fix**: the underlying issue is that for high-volume training systems, Coach signals are correctly flagging *trade-offs* (high monotony, poor polarization) that are real but ORTHOGONAL to "are you training enough." A more sophisticated rebuild would treat those signals as MODIFIERS (penalty caps, not blend components) so the score reflects "volume * appropriateness." Parked as a longer-term refinement.

**Post-ship validation**: re-running with the new weights moved Pearson r from low to 0.365 (matching outcome alone) and R² from 0.067 → 0.133. But Spearman ρ stayed flat. Diagnosis: Coach step-function signals (polarization, monotonyStrain) shuffle the rank order of close-together days even at 15% weight. Pearson follows the magnitude relationship; Spearman is more sensitive. Combined with the partial-tautology of ground truth (`trailing-7d hours` ≈ score's `weeklyVolume` input), endurance can't reach "keep weights" with the current bucketization. Accepted as a known limitation; endurance is marked "limited-validation" until the modifier-architecture refactor.

### 2026-05-30 — IF awareness: Nutrition fallback + Coach copy (task #213)

**Triggered by**: User (Emil) does intermittent fasting — typical first real meal past noon, only water/coffee/supplements through the morning. Without IF awareness:
- HS Nutrition component scored against empty-morning data → Gut and Metabolism crash to ~36 every morning before lunch.
- Fuel Coach line on Daily said "Today's target: X kcal · Y g protein. Frontload protein at breakfast." — nagging about a meal he doesn't take.
- Several Coach signals (energyAvailability, glycogen, tdeeDrift) returned null during fasted morning, which dropped from "best component" analysis and made gut validation impossible.

**What landed (this phase)**:

1. **New module `src/core/intermittentFasting.js`** — `detectIntermittentFasting(daysBack=14)` walks Cronometer per-meal `nutritionLog` rows, finds median first-meal-hour (calories ≥ 50 — coffee with milk doesn't break the fast). Classifies as IF if median ≥ 11 am. Robust to occasional early-eating days (races, hard AM workouts) via median, not mean. Cached in `storage.ifProfile` with 24h recompute window.

2. **HS v2 Nutrition fallback**. When `dateStr === today` AND today's calories < 200 AND `isInFastingWindow()` returns true → Nutrition component reads yesterday's nutrition score instead of zero. Surfaces `ifFallback: <value>` in `_debug.nutrition.breakdown` so the harness can verify the fallback fired. Historical days score against their own complete data as before.

3. **Coach digest `composeFuelLine` IF-aware**. `morning_open` kind now checks `ctx.if.isInFastingWindow` — when true, reframes from "Frontload protein at breakfast" to "Fasting window. Target X kcal · Y g protein once the window opens (≈12pm)." Acknowledges the user's actual pattern without preaching.

4. **IF context propagates through `classifyFuelState`**. Added `if: { isIF, isInFastingWindow, eatingWindowStart }` to `baseCtx` so all downstream Fuel-line composers can adapt without re-importing.

5. **Debug helper `window.ifDebug()`** for inspection — prints detected profile, cached profile, current fasting-window state, 3-day rolling intake.

**What's NOT done (deferred)**:

- **Coach signal engine** (`coachSignals.js`) is unchanged. `energyAvailability`, `glycogen`, `tdeeDrift` still go null on fasted mornings inside the engine itself. The HS Nutrition fallback handles the visible symptom (Gut/Metabolism crash) but the underlying signals are still empty during the fasting window. Real fix is to teach those signals to fall back to a 3-day rolling intake when today is sparse-and-fasted. Logged as a follow-up because it's deeper architecture and the HS-side fix may make it unnecessary.

- **Manual IF override**. Detection is fully automatic. If user wants to disable IF awareness during a non-fasting phase (off-season, race block), they'd need a `profile.intermittentFastingOverride` switch in Goals — not yet built.

- **Race-day exception detection.** User mentioned breaking the fast for races / hard early workouts. Detection currently uses ALL days; doesn't distinguish. The median-over-14d makes this robust to outliers but doesn't surface "today is a race day, expect early intake" as a Coach-line modifier. Possible enhancement.

**Expected outcome**: re-run `window.hsValidationReport()` after a few days. Energy and Gut should improve as the IF fallback prevents morning Nutrition crashes from propagating into the validation comparison.
