# Mobile Start Screen — Data Source Map

_One-stop trace of every value rendered on the Start screen. Use this as the reference when we discuss what to change._

---

## Architecture summary

**Entry point:** `src/components/MobileHome.jsx` → `MobileHome` → `MobileHomeInner`

**Single source of truth:** `useMobileData()` hook at `MobileHome.jsx:26` — reads **directly from localStorage** via `storage.get(...)` and recomputes on day change. No prop-drilling from `Arnold.jsx` for the Start screen data (except `data.labSnapshots` for the Labs tile).

**Data flow diagram:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  localStorage  (arnold:* keys)                                       │
│  ────────────                                                        │
│  activities      dailyLogs       sleep        hrv                    │
│  weight          cronometer      nutritionLog profile                │
│  races           strengthTemplates                                   │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  useMobileData()                                 MobileHome.jsx:26   │
│  ──────────────                                                      │
│    · Reads 7 raw keys                                                │
│    · Unifies activities (CSV + fit uploads, deduped)                 │
│    · Computes: this-week totals, 30-day averages, YTD, weekly trend, │
│      pace, latest sleep/HRV/weight, today's nutrition, next race     │
└──────────┬───────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  MobileHomeInner                                 MobileHome.jsx:1051 │
│  ────────────────                                                    │
│    · Calls computeRolling7d() / computeRolling30d() (trainingStress) │
│    · Builds heroStats, run/strength/recovery/body tiles              │
│    · Renders HeroRail, tiles, ThisWeek, AnnualTimeline, TodaysPlan,  │
│      CoreSummary, LabsSummary                                        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Storage keys actually read by Start

| Key                    | Helper                          | What's in it                          |
|------------------------|----------------------------------|----------------------------------------|
| `arnold:activities`    | `storage.get('activities')`     | Garmin CSV activities (runs, rides, strength, etc.) |
| `arnold:dailyLogs`     | `storage.get('dailyLogs')`      | Per-day bucket; contains `fitActivities[]` (daily FIT uploads) |
| `arnold:sleep`         | `storage.get('sleep')`          | Garmin Sleep CSV rows                  |
| `arnold:hrv`           | `storage.get('hrv')`            | Garmin HRV Status CSV rows             |
| `arnold:weight`        | `storage.get('weight')`         | Garmin weight CSV + manual entries     |
| `arnold:cronometer`    | `storage.get('cronometer')`     | Cronometer Daily Summary CSV rows      |
| `arnold:nutritionLog`  | (inside `nutDailyTotals()`)     | Manual nutrition entries               |
| `arnold:profile`       | `storage.get('profile')`        | Profile (name, targetRacePace, etc.)   |
| `arnold:races`         | Raw `localStorage.getItem`      | Race plan/events                       |
| `arnold:strengthTemplates` | (inside `computeDailyScore`) | Lift templates (used by readiness)   |
| `arnold:goals`         | `getGoals()`                    | All user goal targets (see below)      |

**Derived / unified stream inside `useMobileData()`:**
- `activities` (unified) = CSV activities (excluding `source === 'health_connect'`) merged with `dailyLogs[*].fitActivities[*]`, deduped by `date|title|time` (`MobileHome.jsx:44–74`). Everything downstream (miles/week, YTD, pace) works off this unified list.

---

## Render order — section by section

Each row below:
`displayed value` → `code variable` → `source` → `calculation summary` → `file:line`

### 1. Header

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| "Good morning/afternoon/evening" | `greeting` | `new Date().getHours()` | <12 morning, <17 afternoon, else evening | `MobileHome.jsx:1061` |
| Profile name | `profileName` | `storage.get('profile').name` with fallbacks to `data.profile.name` → raw `arnold:data` → `'Emil'` | First non-empty wins | `MobileHome.jsx:1064` |

### 2. HeroRail — Readiness ring + small "moon" + factors + hero stats + race

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| **Main ring score** | `mainScore` | `computeRolling7d().score` | Weighted 7-day readiness — combines rTSS / tonnage / sleep / HRV / RHR / nutrition / weight trend, bucketed into Activity / Nutrition / Body domains then goal-weighted. | `MobileHome.jsx:1100`; calc at `trainingStress.js:718` (7d) and `:415` (per-day) |
| Status word / color | `statusWord` / `statusColor` | derived from `mainScore` | ≥70 green "On Track"; ≥45 amber "Needs Work"; >0 red "Behind"; else blue "No Data" | `MobileHome.jsx:1107–1111` |
| Score suffix (e.g. "(rTSS 42)") | `scoreSuffix` | `todayResult.sessionMetric` | Label + numeric metric for today's primary session (rTSS for runs, tonnage for strength, etc.) | `MobileHome.jsx:1103`; calc at `trainingStress.js:463` |
| **Moon / secondary score** | `moonScore` | `computeRolling30d().score` | 30-day avg of per-day scores | `MobileHome.jsx:1101`; calc at `trainingStress.js:763` |
| Factors list (e.g. "rTSS · good") | `factors` | `todayResult.factors` | Per-metric status flags from today's computeDailyScore — each has status `good` / `warning` / `poor` | `MobileHome.jsx:1113`; source at `trainingStress.js:483 onward` |
| **heroStats[0]: Miles/wk** | `twMi.toFixed(1)` | unified `activities` filtered to this week & runs | `Σ distanceMi` over runs where `date ∈ [Monday, Sunday]` | `MobileHome.jsx:83,85,1127` |
| **heroStats[1]: Sleep /100** | `latestSleepScore` | `arnold:sleep` (newest) | `max(sleep[newest].sleepScore, 100)` (cap at 100) | `MobileHome.jsx:123,1128` |
| **heroStats[2]: Protein g** | `todayProtein` | `nutDailyTotals(today).protein` | Sum of today's protein from cronometer + nutritionLog | `MobileHome.jsx:144,1129`; calc in `core/nutrition.js` |
| **heroStats[3]: Weight lb** | `currentWeight` | `arnold:weight` (newest) | `weight[newest].weightLbs` | `MobileHome.jsx:137,1130` |
| Race days left | `raceDaysLeft` | `arnold:races` (next future) | `ceil((raceDate - now) / 86400000)` | `MobileHome.jsx:1122` |
| Race name + date + distance | `nextRace.name / date / distanceMi / distanceKm` | `arnold:races` filtered to future, sorted asc, [0] | First upcoming | `MobileHome.jsx:157,1311–1313` |

### 3. Sleep Insight (narrative block)

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| Headline + detail | `sleepInsight.hl` / `detail` | `latestSleepScore` | ≥85 "Great sleep — ready to push"; ≥70 "Solid sleep — ready for strength"; else "Light sleep — easy effort today" | `MobileHome.jsx:1134–1139` |

### 4. RUN tiles

| Tile | Today value | 30d avg | Gauge % | Source | File:line |
|---|---|---|---|---|---|
| **Weekly Miles** | `twMi.toFixed(1)` mi | `avg30Mi` (30-day running avg mi/wk) | `avg30Mi / G.weeklyRunDistanceTarget` | unified `activities` | `MobileHome.jsx:85,96,1175` |
| **Avg Pace** | `paceStr` (YTD) | same (no separate 30d) | `goalPaceSecs / avgPaceSecs` capped at 1 | YTD runs, `profile.targetRacePace` (default `9:30`) | `MobileHome.jsx:100–105,1178` |

### 5. STRENGTH tiles

| Tile | Today value | 30d avg | Gauge % | Source | File:line |
|---|---|---|---|---|---|
| **Sessions (week)** | `twStrSessions` | `avg30StrSessions` | `twStr / G.weeklyStrengthTarget` | unified `activities` (non-run) | `MobileHome.jsx:88,97,1190` |
| **Pull-ups** | `G.pullUpsTarget` (goal, not actual!) | `'—'` | `0` | Goals only — **no actual pull-up data feed today** | `MobileHome.jsx:1194` |

> ⚠ Heads-up: the Pull-ups tile currently shows the goal value in the "today" slot and no actual. We'll want to decide how to populate this when we look at the tile behaviors.

### 6. RECOVERY tiles

| Tile | Today value | 30d avg | Gauge % | Source | File:line |
|---|---|---|---|---|---|
| **Sleep Score** | `latestSleepScore` | `avg30Sleep` | `avg30Sleep / G.targetSleepScore` (default 85) | `arnold:sleep`, cleaned via `cleanSleepForAveraging` | `MobileHome.jsx:40,123,127,1201` |
| **HRV** | `latestHRV` (ms) | `avg30HRV` | `avg30HRV / G.targetHRV` (default 70) | `arnold:hrv` (`overnightHRV`) | `MobileHome.jsx:131,133,1204` |

### 7. BODY tiles

| Tile | Today value | 30d avg | Gauge % | Source | File:line |
|---|---|---|---|---|---|
| **Weight** | `currentWeight.toFixed(1)` | `avg30Weight` | `max(0, 1 - abs(avg30Weight - G.targetWeight) / 20)` | `arnold:weight` (`weightLbs`) | `MobileHome.jsx:137,140,1218` |
| **Protein** | `todayProtein` rounded | `avg30Protein` | `avg30Protein / G.dailyProteinTarget` (default 150) | cronometer + nutritionLog via `nutDailyTotals` | `MobileHome.jsx:143,154,1222` |

> Note: the Weight tile inverts trend colors — weight DROP is rendered green (good). `MobileHome.jsx:1210–1215`.

### 8. This Week card

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| Headline | `weeklyHeadline` | `weeklyMiPct` | >0.8 "Strong week"; >0.6 "Building momentum"; else "Light week" | `MobileHome.jsx:1227` |
| Miles (this week) | `twMi.toFixed(1)` | unified `activities` | Σ run distance in this Mon–Sun | `MobileHome.jsx:85,1374` |
| Sessions | `twSessions` | unified `activities` | count(all activities this week) | `MobileHome.jsx:87,1375` |
| Runs | `twSessions - twStrSessions` | unified `activities` | non-strength sessions | `MobileHome.jsx:1376` |
| Time | `weeklyTime` | unified `activities` | `Σ durationSecs / 3600` formatted "Xh Ym" | `MobileHome.jsx:86,1228,1377` |
| Weekly target | `G.weeklyRunDistanceTarget` | Goals | default 50 | `MobileHome.jsx:1171,1379` |

### 9. Annual Timeline

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| **Run miles YTD actual** | `Math.round(totalMi)` | unified `activities` filtered to runs & `date ≥ yearStart` | Σ distanceMi | `MobileHome.jsx:100,109,1387` |
| Run miles goal | `G.annualRunDistanceTarget` | Goals | default 800 | `MobileHome.jsx:1231,1386` |
| **Workouts YTD actual** | `totalSessions` | unified `activities` filtered to YTD | count(all activities YTD) | `MobileHome.jsx:108,110,1389` |
| Workouts goal | `G.annualWorkoutsTarget` | Goals | default 200 | `MobileHome.jsx:1232,1388` |
| Race markers | `allRaces` | `arnold:races` | full races list | `MobileHome.jsx:1235,1385` |

### 10. Today's Plan

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| Plan items (icon / title / detail / AM-PM) | `planItems` | `todayPlanned()` | Reads active weekly planner; maps `type` (run/strength/cross/rest) → icon + fallback text; if no plan exists, falls back to hardcoded "Strength · Upper Body + Easy Run" pair | `MobileHome.jsx:1240–1257`; source at `core/planner.js` |

> Heads-up: the hardcoded fallback on line 1253–1254 shows "Chest, shoulders, triceps · 45 min" and "Recovery · 3 mi @ 10:30 pace" when the planner has nothing for today. We may want to change that to a clearer "No plan set" state.

### 11. Core Summary

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| HRV | `latestHRV.toFixed(0)` | `arnold:hrv` (newest with `overnightHRV`) | — | `MobileHome.jsx:131,1400` |
| RHR | `latestRHR` | `arnold:sleep` (newest with `restingHR`) | — | `MobileHome.jsx:124,1401` |
| Weight | `currentWeight.toFixed(1)` | `arnold:weight` (newest) | — | `MobileHome.jsx:137,1402` |
| Body Fat % | `currentBF.toFixed(1)` | `arnold:weight` (newest `bodyFatPct`) | — | `MobileHome.jsx:138,1403` |

### 12. Labs Summary

| Displayed | Code var | Source | Calc | File:line |
|---|---|---|---|---|
| Lab snapshots | `data.labSnapshots` | **Prop passed from Arnold.jsx** (NOT from useMobileData) | Whatever Arnold.jsx passes in — this is the one Start value that still depends on parent | `MobileHome.jsx:1410` |

---

## Goal defaults (in case `arnold:goals` is empty)

Fallback defaults baked into `MobileHome.jsx` at render time:

| Goal key | Default used | Where used |
|---|---|---|
| `weeklyRunDistanceTarget` | 50 (hero / This Week); 20 (gauge normalization for avg30Mi) | `:1171, 1379, 1177` |
| `weeklyStrengthTarget` | 2 | `:1184` |
| `pullUpsTarget` | `'—'` | `:1194` |
| `targetSleepScore` | 85 | `:1203` |
| `targetHRV` | 70 | `:1206` |
| `dailyProteinTarget` | 150 | `:1224` |
| `targetWeight` | (no default; gauge returns 0.5) | `:1220` |
| `targetRacePace` | `'9:30'` (from profile, not goals) | `:105` |
| `annualRunDistanceTarget` | 800 | `:1231` |
| `annualWorkoutsTarget` | 200 | `:1232` |
| `functionalThresholdPace` | `'8:30'` (in trainingStress) | `trainingStress.js:458` |

**Where goal defaults come from at the source:** `core/goals.js` — `getGoals()`.

---

## Things that might surprise you

1. **The "today" values in tiles are not always today's data.** Sleep and HRV show "newest row in CSV" which could be a few days old if you haven't synced Garmin. `latestSleepScore` / `latestHRV` = newest, not today's.

2. **Weekly math uses Monday as week start.** `dow === 0 ? 6 : dow - 1` — Sunday's "this week" is still the Mon–Sun that just ended. (`MobileHome.jsx:77–81`).

3. **30-day averages are across whatever rows exist in the 30-day window.** If you have 12 sleep rows in 30 days (because you didn't wear the watch one week), `avg30Sleep` is over those 12 rows, not divided by 30.

4. **Run detection is a regex on `activityType`:** `/run/i` — matches "Running", "Trail Run", "Run", etc. Anything that doesn't match that regex counts as "strength" for the strength tiles, which is too loose (a cycling session would currently count as strength). `MobileHome.jsx:83, 84, 93, 100, 117, 126`.

5. **Unified activities deduplication key:** `date|title|time` for CSV, `date|activityType|startTime-or-count` for FIT uploads. Identical same-day same-type same-time sessions collapse into one. (`MobileHome.jsx:48, 62`).

6. **Readiness factors come from `computeDailyScore(today).factors`** — the list of "good / warning / poor" pills under the hero ring. The full factor ledger is at `trainingStress.js:415`+. If a bucket has no data (e.g. no cronometer row for today), the corresponding factor is omitted silently.

7. **`data.labSnapshots` is the only prop Start still needs from Arnold.jsx.** Everything else is self-sourced from storage. If the Labs tile looks stale, it's because Arnold.jsx isn't refreshing it.

8. **The "Pull-ups" tile currently displays the goal as the today value** (not your latest pull-up count). This is a placeholder.

9. **"Today's Plan" has a hardcoded fallback** when the planner has no entry for today — it always shows "Strength · Upper Body + Easy Run" even on a brand-new install. Worth flagging for the user-facing experience.

10. **HeroRail race card reads both `distanceMi` and `distanceKm` from the race object** — order of preference Mi → Km. `MobileHome.jsx:1313`.

---

## Key function references

| Function | File:line | What it does |
|---|---|---|
| `useMobileData()` | `MobileHome.jsx:26` | Single data hook for the Start screen |
| `computeRolling7d(refDate?)` | `trainingStress.js:718` | 7-day weighted readiness score |
| `computeRolling30d(refDate?)` | `trainingStress.js:763` | 30-day averaged readiness score |
| `computeDailyScore(dateStr?)` | `trainingStress.js:415` | Per-day readiness; outputs `score`, `sessionType`, `sessionMetric`, `factors` |
| `computeRTSS({…})` | `trainingStress.js:74` | rTSS for a single run |
| `nutDailyTotals(date)` | `core/nutrition.js` | Protein/calories/etc. for a given day |
| `getGoals()` | `core/goals.js` | Returns user goals with defaults applied |
| `todayPlanned()` | `core/planner.js` | Today's planned workout from the weekly planner |
| `cleanSleepForAveraging(rows)` | `core/parsers/sleepParser.js` | Strips zero-score and invalid sleep rows before averaging |

---

## Quick "where does X come from?" lookup

- **Why is my readiness score blue/No Data?** → `computeRolling7d()` returned 0. Check: are there any activities / sleep / HRV / cronometer rows for the last 7 days?
- **Why is my Pull-ups tile showing the goal?** → It's not wired to actual pull-up data; line 1194 displays `G.pullUpsTarget` verbatim.
- **Why is my Sleep/HRV stale?** → `latestSleepScore` is "newest row in storage", not "today". Pull fresh Garmin CSV.
- **Why is my Avg Pace weird?** → YTD average across every run pace. One bad row pollutes it.
- **Why is my Today's Plan wrong?** → `todayPlanned()` reads from the weekly planner; if empty, hardcoded fallback shows.
- **Why is the Labs tile old?** → It's the only prop-driven field; source is `data.labSnapshots` from Arnold.jsx, not the Start hook.

---

_File: `C:\Users\Superuser\Arnold\MOBILE_START_SCREEN_MAP.md`. Update as the screen evolves._
