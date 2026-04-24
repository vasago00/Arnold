# Metric Overlap Audit — Start vs EdgeIQ

Generated: 2026-04-22
Companion to: `MOBILE_START_SCREEN_MAP.md` and `MOBILE_EDGEIQ_SCREEN_MAP.md`

Purpose: walk through every metric that appears on both screens, decide
whether it *should* appear on both, and — for the ones that stay — commit
to a single source of truth function and a single aggregation window.

---

## 0. Design rules (codified from 2026-04-22 discussion)

These are the ground rules every decision in §5 must satisfy.

**R1 · Week boundary.** A week runs **Monday 00:00 → Sunday 23:59** across the
entire app. We introduce `startOfWeek(date)` / `endOfWeek(date)` helpers in
a new `core/time.js` and every filter that needs a week boundary imports
from there. No more raw `getDay()` in filters.

**R2 · Daily = today.** "Today" means `localDate() === row.date` strictly.
If no row exists for today the tile shows `—` (not yesterday's value, not
a 3-day average). The one exception is the Big Moon — see R5.

**R3 · Missing days honestly hurt aggregates.** If a day needed for a weekly
or annual calc is missing, the aggregate reflects the gap. The fix is not
to invent values — it's to give the user a manual entry path for every
input that matters (see §6, "New work required").

**R4 · Annual = YTD, one pipeline.** Annual means Jan 1 00:00 through today.
Every screen that displays "annual" anything reads from the same helper.

**R5 · Big Moon: today's composite, never zero.** The hero's primary moon
shows today's readiness score (training + nutrition + body). To guarantee
it's never zero, the scoring function is allowed a short lookback *for
specific body inputs that arrive late* (HRV, RHR, sleep score often post
12–24h after the fact). Explicit carve-out, documented in the helper. See
§2 for the full proposal.

**R6 · Small Moon: 7-day rolling, Mon–Sun aligned.** The secondary moon is
a 7-day composite using the same daily pipeline, windowed by R1.

**R7 · Start tiles are user-selected.** The tiles below the hero are
configured by the user in the Goals tab, grouped into the four Start-screen
groups (Run / Strength / Recovery / Body). Per-tile the user picks:
(a) which metric, (b) which window — weekly, annual, or latest-daily.
Nutrition goals stay in the Nutrition tab; they can feed the moon but
don't occupy Start tile slots by default.

**R8 · One function per metric per window.** Every metric that survives
the audit gets exactly one home function in `core/metrics.js` (new file).
Both screens import it. Any duplicated `activities.filter(...)` inline on
a screen is a bug.

---

## 1. How to read this document

§2 and §3 are design proposals that need your call. §4 is the overlap
matrix — the main survey. §5 lists the canonical helpers we'll build
once you've marked up §4. §6 is new work unlocked by the rules.

For §4, the last column is for you. Write one of:

- `KEEP BOTH` — metric appears on both screens, same value, same window.
  We'll build one helper and import it twice.
- `MOVE TO START` — remove the EdgeIQ copy (with a pointer to Start if
  needed).
- `MOVE TO EDGEIQ` — remove the Start copy.
- `SPLIT & LABEL` — genuinely different windows on each screen, keep both
  but make the labels disambiguate (e.g. "This Week" vs "8-Wk Avg").
- `DROP` — delete from both screens.

---

## 2. Big Moon redesign (R5)

**Current behaviour (why it zeroes):** Start's Big Moon today renders
`computeRolling30d(today).score`. That function loops 30 days back,
computes each day's score, averages days where `score > 0`. If **all 30
days** return zero, the moon is zero. Each day returns zero when all three
domains (activity, nutrition, body) are empty for that day
(`trainingStress.js:668`). So you need at least one activity OR any logged
food OR any sleep/HRV/RHR in the whole month to move it.

**Emil's new semantics:**
- Big Moon = today's `computeDailyScore(today)` (not 30-day)
- Small Moon = 7-day rolling
- Big Moon must never be zero

**Why "never zero" is tricky under R2:** `computeDailyScore` today is
already today-strict for activity and nutrition. The reason most days
zero out isn't today-strictness — it's that Body-domain inputs (HRV,
sleep score, RHR) usually arrive 12–24h after the night they describe.
A strict today-only Body domain will be empty until your Garmin sync
ships the overnight data.

**Proposed fix — "late-arriving body" carve-out:**

```
Body inputs permitted a 36h lookback (configurable):
  - HRV (overnightHRV)
  - Sleep score
  - Resting HR
The function labels the factor "Sleep (last night)" if the date is today,
"Sleep (Apr 21)" if it's from yesterday. The user always sees the source
date. This is NOT a silent fallback.

Activity and nutrition stay strict today-only.
```

This keeps R2 honest (tiles don't silently carry-forward) while ensuring
the moon has something to chew on by 8am when Garmin finishes syncing.

**Additional floor rule:** if all three domains STILL have no data after
the body lookback, the moon shows a "base" score of whatever the last
Small Moon value was, with a visible badge `stale`. Never zero, never
silently zero-looking.

**Domain weights need revisit too.** Today each active domain contributes
equally (`totalScore / activeDomains`, line 677). That means on a rest
day with only Body data, the moon is 100% Body — which reads as "great
readiness" even though you did nothing active. Proposal: weighted
composite `activity: 0.45, body: 0.35, nutrition: 0.20` when all three
present; empty domains redistribute.

**Decision needed — your call on:**
1. 36h Body lookback window — yes / longer / shorter?
2. Domain weight split (0.45 / 0.35 / 0.20)?
3. Stale-badge rule on total-zero fallback?

---

## 3. Start tile framework (R7)

**Four Start-screen groups** matching the Goals tab layout:

| Start group | Goals-tab group | Nutrition feeds this? |
|--|--|--|
| Run | Run | no |
| Strength | Strength | no |
| Recovery | Recovery | partial (sleep macros, hydration) |
| Body | Body | partial (calories-in / out, protein) |

**Per-tile user picks:**
- Metric ID (e.g. `weeklyRunMiles`, `latestHRV`, `annualRunMiles`)
- Window (`weekly` | `annual` | `latest-daily`)
- Goal binding (auto — pulls the target from `goals.*` based on metric)
- Display mode (`value only` | `value + target` | `value + target + %bar`)

**New storage key:** `arnold:startTileLayout` =

```json
{
  "Run":       [ { "metric": "weeklyRunMiles",     "window": "weekly",       "display": "valueTarget" },
                 { "metric": "annualRunMiles",     "window": "annual",       "display": "valueBar" } ],
  "Strength":  [ { "metric": "weeklyStrengthSessions", "window": "weekly",   "display": "valueTarget" } ],
  "Recovery":  [ { "metric": "latestHRV",          "window": "latest-daily", "display": "valueTarget" },
                 { "metric": "latestSleepScore",   "window": "latest-daily", "display": "valueTarget" } ],
  "Body":      [ { "metric": "latestWeight",       "window": "latest-daily", "display": "valueTarget" } ]
}
```

Default layout = today's Start layout (so nothing visually changes until
the user customizes).

**Metric catalog (first draft):** each row becomes a picker option.

| Metric ID | Group | Supported windows | Source helper |
|--|--|--|--|
| `runMiles` | Run | weekly, annual, latest-daily | `metrics.runMiles(window, refDate)` |
| `runHours` | Run | weekly, annual | `metrics.runHours(window, refDate)` |
| `runSessions` | Run | weekly, annual | `metrics.runSessions(window, refDate)` |
| `runAvgPace` | Run | weekly, annual, latest-daily | `metrics.runAvgPace(window, refDate)` |
| `strengthSessions` | Strength | weekly, annual | `metrics.strengthSessions(window, refDate)` |
| `strengthMinutes` | Strength | weekly, annual | `metrics.strengthMinutes(window, refDate)` |
| `pullUps` | Strength | latest-daily | `metrics.pullUps(refDate)` |
| `handstandPushups` | Strength | latest-daily | `metrics.handstandPushups(refDate)` |
| `latestHRV` | Recovery | latest-daily | `metrics.latestHRV()` |
| `latestSleepScore` | Recovery | latest-daily | `metrics.latestSleepScore()` |
| `latestRHR` | Recovery | latest-daily | `metrics.latestRHR()` |
| `weeklySleepHours` | Recovery | weekly | `metrics.weeklySleepHours(refDate)` |
| `latestWeight` | Body | latest-daily | `metrics.latestWeight()` |
| `latestBodyFat` | Body | latest-daily | `metrics.latestBodyFat()` |
| `latestLeanMass` | Body | latest-daily | `metrics.latestLeanMass()` |
| `weightTrend7d` | Body | weekly (avg) | `metrics.weightAvg(window, refDate)` |

**Decisions needed:**
1. Is nutrition genuinely excluded from Start tiles (lives only in
   Nutrition tab)?
2. Do you want a mixed group (e.g. the first row can be "key recovery" +
   "key body" next to each other) or strict four groups?
3. What max tiles per group on Start (today's layout is ~3 each)?

---

## 4. Metric overlap matrix

Key for "Rule violated?":
- W = week boundary differs (R1)
- T = today-strict rule broken (R2)
- Y = annual calc differs (R4)
- S = two sources (not single SoT) (R8)

| # | Metric | Start: where / how | EdgeIQ: where / how | Rule(s) violated | Your call |
|--|--|--|--|--|--|
| 1 | **HRV (latest)** | Recovery tile via `hrv[].overnightHRV` desc-date first row | Signal Cockpit + Daily-tab Training signal; same source | — | ☐ |
| 2 | **Resting HR (latest)** | Recovery tile via `sleep[].restingHR` desc-date first row | Cockpit + detail panel; same source | — | ☐ |
| 3 | **Sleep score (latest)** | Recovery tile via `sleep[].sleepScore` | Cockpit + detail panel; same source | — | ☐ |
| 4 | **Weight (latest)** | Body tile via `weight[].weightLbs` desc-date | Detail panel Body section; same source | — | ☐ |
| 5 | **Body Fat % (latest)** | Body tile via `weight[].bodyFatPct` | Detail panel Body section; same source | — | ☐ |
| 6 | **Lean Mass (latest)** | Body tile via `weight[].skeletalMuscleMassLbs` | Detail panel Body section; same source | — | ☐ |
| 7 | **Weekly run miles (current week)** | `This Week` tile, Mon–Sun week, filtered by `/run/i` on merged activities | *Not present explicitly* | n/a | ☐ |
| 8 | **Avg weekly run miles (rolling)** | *Not present* | Cockpit: 8-week Sun-anchored avg, miles / 8 | W (Sun vs Mon boundary, though Start doesn't have this exact metric) | ☐ |
| 9 | **Weekly run hours** | `This Week` tile, Mon–Sun week | Cockpit `Avg Hours/wk`: 8-week avg | W, S | ☐ |
| 10 | **Weekly strength sessions** | `This Week` strength count | *Only YTD annual on EdgeIQ via Annual Progress + detail panel "Strength Sessions YTD"* | — (different concepts) | ☐ |
| 11 | **YTD run miles** | Annual Timeline via `activities.filter(date >= jan1 && /run/i)` summed `distanceMi` | Annual Progress + detail `resolveSignal('annual')` — **same formula**, different file | S | ☐ |
| 12 | **YTD total sessions / workouts** | Annual Timeline count of all activities since Jan 1 | EdgeIQ header pill + Annual Progress, same formula | S | ☐ |
| 13 | **Daily HRV score/target %** | Recovery tile shows ms + implied goal target tag | Cockpit shows value + goal + progress bar | — (presentation differs, value same) | ☐ |
| 14 | **Protein (latest / avg)** | *Today's protein* via `nutrition.dailyTotals(today)` which prefers `meal:'full-day'` full-day summary, then cronometer fallback | Cockpit shows 30-day avg protein from `cronometer` only (nutritionLog ignored) | S (different pipelines), T (Start=today, EdgeIQ=30d) | ☐ |
| 15 | **Readiness composite (Big Moon)** | `computeRolling30d(today).score` — 30-day straight average | *Not present* | — | Will be rewritten per §2 — ☐ |
| 16 | **Readiness composite (Small Moon)** | `computeRolling7d(today).score` — 7-day weighted, rolling last-7-days (not Mon–Sun) | *Not present* | W (rolling 7 calendar days vs Mon–Sun week) | Will be rewritten per §2 — ☐ |
| 17 | **Today's pace / rTSS pill** | Hero rail session metric | *Not present* | — | ☐ |
| 18 | **Sleep Insight card** | Derived from last 7 sleep rows (avg hrs, score, consistency) | Only latest in detail panel | — (different uses) | ☐ |
| 19 | **Training volume for nutrient-target scaling** | *Not surfaced as UI* | Indirectly via `getOptimalTargets` which reads last-7-day activities | — | ☐ |
| 20 | **Health Systems scorecard (10 systems)** | *Not present* | Entire EdgeIQ Health Systems card | — | ☐ (EdgeIQ-only by design?) |
| 21 | **Labs Summary / Blood markers** | Labs Summary strip on Start (prop-driven `data.labSnapshots[0]`) | Detail panel Blood section (same prop) | — | ☐ |
| 22 | **Today's Plan** | Start "Today's Plan" card — hardcoded fallback when no plan | *Not present* | — | ☐ |
| 23 | **Core Summary** | Start "Core Summary" card | *Not present* | — | ☐ |
| 24 | **Goal targets (every `goals.*` field)** | Read via `getGoals()` across every tile | Read via `getGoals()` in Cockpit + scoring | — (already single-source via `goals.js`) | KEEP ✓ (example — this one is right) |

**Rows 1–6 (latest biometric values):** already read from the same source
on both screens. The only question is whether they need to appear twice.
My recommendation: HRV / RHR / Sleep / Weight / BF / Lean Mass keep a
**brief** representation on Start (morning glance) and the full trend
view lives on EdgeIQ. Not duplication — different treatment, same value.

**Row 14 (Protein):** most concerning. Two pipelines return two different
numbers for the same concept. Either: (a) canonicalize `protein(window,
refDate)` to use `nutrition.dailyTotals` uniformly, and EdgeIQ's Cockpit
just asks for `protein('30d-avg')`; OR (b) drop the Cockpit Protein tile
entirely since Nutrition tab owns protein analytics.

**Rows 11, 12 (YTD):** same formula written twice. Pure R8 violation.
Trivial to consolidate — pick the decision (probably KEEP BOTH + one
helper).

**Rows 15–16 (moons):** already slated for rewrite per §2. Small Moon
today uses rolling 7 calendar days, not Mon–Sun — violates R1.

---

## 5. Canonical helpers to build (after §4 decisions)

Once §4 is marked up, the consolidated API becomes `core/metrics.js`:

```
// core/time.js — week boundary helpers (Mon-Sun)
export function startOfWeek(d)           // Mon 00:00 of the week containing d
export function endOfWeek(d)             // Sun 23:59 of the week containing d
export function startOfYear(d = now)     // Jan 1 00:00
export function inWindow(date, window, ref)  // 'today' | 'week' | 'annual' | '7d-rolling'

// core/metrics.js — single source of truth per metric
export function runMiles(window, ref)
export function runHours(window, ref)
export function runSessions(window, ref)
export function runAvgPace(window, ref)
export function strengthSessions(window, ref)
export function strengthMinutes(window, ref)
export function latestHRV()
export function latestSleepScore()
export function latestRHR()
export function latestWeight() / latestBodyFat() / latestLeanMass()
export function protein(window, ref)         // uses dailyTotals pipeline, never raw cronometer filter
export function workoutsCount(window, ref)   // total sessions
```

Every screen deletes its inline `.filter()` loops and calls these.

**Refactor order (smallest blast radius first):**
1. Introduce `core/time.js`. Replace all `getDay() === 0 ? ...` blocks.
2. Introduce `core/metrics.js` with 5 lowest-risk functions (latest-*).
3. Migrate EdgeIQ Cockpit + Start Recovery tiles to those 5.
4. Add weekly/annual run helpers; migrate Start `This Week` + EdgeIQ
   Cockpit + Annual Progress + Annual Timeline.
5. Protein migration — requires decision on row 14 first.
6. Moon rewrite per §2.

---

## 6. New work required (unlocked by the rules)

1. **Goals-tab extension — Start tile picker UI.** Per-group drag-list with
   add/remove/reorder + per-tile metric-picker + window-picker. Persists
   to `arnold:startTileLayout`.
2. **Manual daily-entry paths (R3).** Every field that a weekly/annual
   calc reads must have a "tap here to enter today's value" affordance
   for days when no API delivered it. Minimum v1 fields:
   - HRV (manual number)
   - Sleep score + sleep hours
   - Resting HR
   - Weight / body fat / lean mass
   - Today's protein (if nutrition tab empty)
   Ideally a "Yesterday's missing data" notification on app open if any
   of these are `null` for yesterday.
3. **Big Moon zero-floor logic.** Carve-out in `computeDailyScore` for
   body-signal 36h lookback + stale-badge fallback. Also: render a
   source-date line under the moon ("inputs from: Apr 21 sleep, today's
   run, today's nutrition").
4. **Week-boundary migration.** One-off sweep to replace every inline
   week filter with `inWindow(date, 'week', ref)`.
5. **YTD canonical helper.** `annualTotal(field, refDate)`. Start's
   Annual Timeline and EdgeIQ's Annual Progress + detail panel all call
   it.
6. **Metrics registry driving Goals-tab picker.** The table in §3 gets
   codified in `core/metrics.js` as an exported `METRICS_CATALOG` so the
   Goals tab auto-populates pickers.

---

## 7. Decisions I need from you

Copy / paste this block and fill in:

```
BIG MOON
  Body-signal lookback window:  ____ hours (default 36)
  Domain weights (activity/body/nutrition):  ___ / ___ / ___
  Stale-fallback: show last Small Moon with "stale" badge?  Y / N

START TILE GROUPS
  Four groups (Run / Strength / Recovery / Body) only — no mixed rows?  Y / N
  Nutrition stays out of Start tiles?  Y / N
  Max tiles per group on Start:  ____

OVERLAP MATRIX (§4) — mark each row 1–24 with one of
  KEEP BOTH | MOVE TO START | MOVE TO EDGEIQ | SPLIT & LABEL | DROP
  (Rows 15-16 are already going to be rewritten per §2)

ROW 14 (Protein duplication) — which pipeline wins?
  ( ) A. Canonicalize via nutrition.dailyTotals; EdgeIQ Cockpit uses it
  ( ) B. Drop Cockpit Protein tile; Nutrition tab is sole owner
```

Once you mark this up I'll start on the canonical helpers per §5, in the
refactor order listed there.
