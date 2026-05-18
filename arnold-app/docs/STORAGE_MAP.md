# Arnold — Storage Map

> Last updated: Phase 4r.maps.1 (May 2026)

All persistent state lives in `localStorage` via the `core/storage.js` wrapper. Keys listed here are the canonical names. Some legacy keys still exist for backward compatibility.

## Core data

| Key | Shape | Owner | Notes |
|-----|-------|-------|-------|
| `activities` | `Array<Activity>` | `cloud-sync` + manual | Primary list. Each entry is one workout (FIT, Garmin API, or manual). |
| `dailyLogs` | `Object<dateStr, DailyLog>` | `cloud-sync` + manual | Per-day rollup. Holds `fitActivities` (legacy), `rhr`, daily energy. |
| `sleep` | `Array<SleepRow>` | HC sync + Garmin | One row per night. Fields: `date`, `totalSleepHours`, `sleepScore`, `overnightHRV`. |
| `hrv` | `Array<HrvRow>` | HC sync + Garmin | Daily HRV rows. Fields: `date`, `overnightHRV`, `dailyHRV`. |
| `weight` | `Array<WeightRow>` | Garmin scale + manual | Body composition entries. Fields: `date`, `weightLbs`, `weightKg`, `bodyFatPct`, optionally `skeletalMuscleMassLbs`. |
| `arnold:garmin-weight` | `Array<WeightRow>` | Garmin worker direct pull | Newer Garmin-only path (Phase 4r.energy.4). |
| `cronometer` | `Array<CronoRow>` | CSV import (legacy) | Legacy daily-totals rows from Cronometer exports. Fallback when `nutritionLog` is empty. |
| `nutritionLog` | `Array<NutritionEntry>` | live API + manual | Per-entry nutrition. `meal: 'full-day'` from live Cronometer pull replaces individual entries for the day. |
| `cronometerLive` | `Object` | live API | Cache of latest Cronometer pull metadata. |
| `arnold:races` | `Array<RaceEntry>` | manual + ICS + catalog | Race calendar. Each: `id`, `name`, `date`, `distanceMi`, `city`, `country`, `url`, `source`. |
| `labSnapshots` | `Array<LabPanel>` | PDF import + manual | Blood panels parsed from PDFs. |
| `clinicalTests` | `Array<ClinicalTest>` | manual + import | DEXA, VO2 max tests, etc. |
| `weatherCache` | `Object` | live API | Weather lookup cache, TTL-bounded. |
| `weatherLocation` | `Object` | navigator.geolocation | Last-known device coordinates. |
| `profile` | `Object` | manual | User profile: height, sex, birthDate, etc. |
| `goals` | `Object` | manual | Targets: daily calories, protein, RHR, weight, etc. |

## Sync metadata

| Key | Purpose |
|-----|---------|
| `garminAuth` | OAuth tokens for Garmin Connect (via arnold-worker) |
| `cronometerAuth` | Cronometer credentials/session |
| `garminWellnessMeta` | Last-sync timestamps for wellness pulls |
| `garminLive` | Most recent Garmin sync state |
| `hcDailyEnergy` | Health Connect daily energy expenditure (NEAT proxy) |
| `importHistory` | Audit log of all import events |

## Planning

| Key | Purpose |
|-----|---------|
| Planner weeks (keyed by Monday `YYYY-MM-DD`) | One `PlannerWeek` per ISO week. 7 days with `type`, `distanceMi`, `durationMin`, `notes`. Stored via `core/planner.js` helpers. |
| `workouts` | Custom Workbench-built workout definitions |

## UI / state

| Key | Purpose |
|-----|---------|
| `startTilePrefs` | User's pinned tile preferences for the Start screen |
| `supplementsCatalog` | Master list of supplements |
| `supplementsStack` | User's daily stack |
| `supplementsLog` | Per-day intake log |
| `arnold:calendar-url` | Saved ICS URL from last sync (Calendar tab) |

## Access patterns

- **Read**: `storage.get(key)` returns the parsed JSON value or `null`.
- **Write**: `storage.set(key, value, opts)` serializes + persists. `opts.skipValidation: true` skips schema validation for known-good blobs (used by Cronometer for raw API responses).
- **Listen**: Some code subscribes to storage changes via a `tick` counter pattern; see `CalendarTab.jsx` for the pattern.

## Migration policy

When a key's schema changes:

1. Bump a migration flag in `Arnold.jsx` (e.g. `arnold:migration-hiit-color-v2`).
2. On boot, check the flag; if missing/old, run the migration synchronously and write the new flag.
3. Migrations should be idempotent (re-runs are no-ops).

Past migrations: HIIT/Strength reclassify (Phase 4r.viz.27), HYROX HIIT relabel, HIIT hrZones rebin, RHR goal default 42.

## Sensitive data

`garminAuth` and `cronometerAuth` hold credentials. Don't log them. Don't backup unencrypted. Don't share in GitHub commits — `.gitignore` should keep them out of any state dump (currently safe because storage is browser-side, not file-system).
