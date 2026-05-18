# Arnold — Data Flow

> Last updated: Phase 4r.maps.1 (May 2026)

How data gets from external sources into Arnold's screens.

## Sources of truth

| Domain | Primary source | Fallback | Storage key |
|--------|---------------|----------|-------------|
| Activities (workouts/runs) | Garmin Connect API | FIT upload, manual entry | `activities`, `dailyLogs.fitActivities` |
| Heart rate during activity | FIT samples | Garmin API summary | embedded in activity record |
| Sleep | Health Connect (Android) | Garmin Connect sleep | `sleep` |
| HRV | Health Connect, Garmin Connect | `sleep[].overnightHRV` field | `hrv` |
| RHR | Health Connect, Garmin Connect | sleep row | `dailyLogs.rhr` |
| Weight + body comp | Garmin scale (via `arnold-worker`) | Health Connect, manual | `weight`, `arnold:garmin-weight` |
| Nutrition | Cronometer live pull | Manual entries via `nutritionLog` | `nutritionLog`, `cronometer` |
| Lab results | PDF import via `pdfParser.js` | Manual | `labSnapshots`, `clinicalTests` |
| Daily energy expenditure (NEAT) | Health Connect | computed from RMR × NEAT_factor | `hcDailyEnergy` |
| Races | Catalog picker + ICS import + manual | — | `arnold:races` |
| Plans | `WeeklyPlanner` + `Workbench` | — | planner via `core/planner.js` |

## Pipeline — Garmin activity import

```
[Garmin device]
       │
       ├── FIT file (USB / Bluetooth / Garmin Connect)
       │       │
       │       └→ User uploads via Arnold UI
       │              ↓
       │       core/fitParser.js
       │              │
       │              ├── Activity record (sport, duration, distance, hr, power, …)
       │              ├── Per-lap summaries
       │              └── Sample stream (1Hz HR, cadence, GPS)
       │
       └── Garmin Connect API
               │
               └→ core/garmin-client.js (via arnold-worker auth pass-through)
                      ↓
               core/garminParser.js
                      ↓
               normalized activity record (same shape as FIT path)

                      ↓
             [Activity record landing]
                      ↓
       core/activityClass.js classifies → family: run|hiit|strength|mobility|cross|race
                      ↓
       storage.set('activities', […, normalized])
                      ↓
        ┌─────────────┴───────────────┐
        ↓                             ↓
core/dcyMath.allActivities()    Sleep/HRV correlator
        ↓                             ↓
Daily Composite Yield        Recovery / readiness signal
        ↓                             ↓
                Tile rendering (Start screen, Performance card, calendar)
```

## Pipeline — Nutrition (Cronometer)

```
[Cronometer cloud]
       │
       └→ User logs food via Cronometer app
              │
              ↓
core/cronometer-client.js polls live API
       │
       └→ writes nutritionLog entry { meal: 'full-day', macros: {...} }
              │
              ↓
core/nutrition.js dailyTotals(date)
       │
       ├── Precedence: live full-day entry > individual entries > legacy CSV
       │
       └→ totals { calories, protein, carbs, fat, fiber, sugar, water }
              ↓
       weekly aggregates, energy balance, fueling adequacy
              ↓
       Fuel tab + nutrition rings on Start screen
```

## Pipeline — Race day

```
1. Race scheduled
   └→ User picks from catalog OR adds manually
   └→ storage.set('arnold:races', […, raceEntry])
   └→ planner.savePlannerWeek() flips that day to type='race'

2. Pre-race window (7 days out)
   └→ RaceFocusCard on Play tab activates
   └→ PlannedWorkoutTile shows 'race-pre' family on Start

3. Race day morning
   └→ Tile shows finish-line signature, mantra rotates to race pool
   └→ Fueling plan card surfaces gel schedule

4. Activity completes
   └→ FIT/Garmin sync imports the race activity
   └→ raceCompletion detector matches by name + distance + date
   └→ Tile flips to 'race-post' family with finisher stats
```

## Calendar — temporal view

The Calendar tab is a read-mostly aggregator: it doesn't store its own data, just queries activities, planner, sleep, HRV, nutrition, races by date.

```
CalendarTab mounts
    ↓
For each cell in the 6×7 grid:
    activitiesByDate.get(date)   ← getUnifiedActivities() from dcyMath
    plannerByDate.get(date)      ← indexPlannerByDate via core/planner
    racesByDate.get(date)        ← getRaces() filtered + grouped
    sleepByDate.get(date)        ← storage.get('sleep') filtered
    hrvByDate.get(date)          ← storage.get('hrv') filtered
    nutDailyTotals(date)         ← core/nutrition dailyTotals
    ↓
DayTile / MobileDayTile renders with family classification
    ↓
On day tap: DayDrawer renders deeper view (Activity/Fuel/Core/Races sections)
```

## Cloud sync

The Cloudflare Worker `arnold-worker` is purely an auth pass-through. It holds nothing persistent — every request is authenticated and forwarded to Garmin Connect or Cronometer. Worker endpoints:

- `/garmin/activities?days=N` → recent activity list
- `/garmin/weight?days=N` → body composition snapshots
- `/cronometer/today` → today's macros
- `/garmin/sleep?date=Y-M-D` → nightly sleep summary

Client code in `core/cloud-sync.js` orchestrates pulls, deduplicates against local storage, writes deltas back.

## Time / date handling

**Single rule**: every "date" in storage is `YYYY-MM-DD` in LOCAL time. Never UTC. Parsing helpers consolidated in:

- `core/time.js` — `localDate()`, `ymd(date)`, `parseYmd(string)`, week/year helpers
- `core/dateUtils.js` — `parseLocalDate(input)` (more permissive, accepts ISO datetime / M/D/YYYY / Date instance)

**Forbidden pattern**: `new Date('2026-05-18')` — parses as UTC midnight, renders as previous day in timezones west of UTC. Use `parseLocalDate()` or `parseYmd()` instead. Phase 4r.utc.2 swept all known instances; future code reviews should flag any bare-string `new Date` constructor.
