# Arnold — System Architecture

> Last updated: Phase 4r.maps.1 (May 2026). Bump this header when the system shape changes meaningfully.

Arnold is a personal training & health intelligence app that ingests data from Garmin (devices + Connect API), Health Connect (Android body data), Cronometer (nutrition), and manual entry, then renders a cockpit-style view across web + mobile.

## Stack

- **Frontend**: React 19 + Vite 8 (single SPA, shared codebase web/mobile)
- **Mobile shell**: Capacitor 8 (Android only; iOS not currently built)
- **Local storage**: `localStorage` via `core/storage.js` wrapper. IndexedDB via Dexie reserved for future large datasets (not active in current paths)
- **Cloud sync**: Arnold Cloudflare Worker (`arnold-worker`) — auth pass-through to Garmin Connect + Cronometer
- **Native bridge plugins**: `@capacitor/filesystem`, `@capacitor/share`
- **External**: Garmin FIT SDK (FIT parse + workout export), pdfjs-dist (lab PDF parsing), ical.js (calendar import)

## High-level Layers

```
┌─────────────────────────────────────────────────────────────┐
│  UI LAYER                                                    │
│  ├── Arnold.jsx (web tabs + mobile orchestrator)            │
│  ├── components/MobileHome.jsx (Start screen + bottom nav)  │
│  ├── components/CalendarTab.jsx (month grid + day drawer)   │
│  ├── components/PlannedWorkoutTile.jsx (Performance card)   │
│  ├── components/* (NutritionInput, WeeklyPlanner, etc.)     │
│  └── components/workbench/* (custom workout builder)        │
├─────────────────────────────────────────────────────────────┤
│  DERIVATION LAYER                                            │
│  ├── core/dcyMath.js (Daily Composite Yield)                │
│  ├── core/derive/*.js (tile metrics, KRI aggregation)       │
│  ├── core/trainingStress.js (rTSS, TSB, fatigue)            │
│  ├── core/trainingIntelligence.js (load planning, fatigue)  │
│  ├── core/energyBalance.js (TDEE, weight prediction)        │
│  ├── core/nutrition.js (daily totals, baselines)            │
│  ├── core/activityClass.js (run/lift/HIIT/mobility classifier)│
│  └── core/adaptiveZones.js (Karvonen HR zones)              │
├─────────────────────────────────────────────────────────────┤
│  PARSER LAYER                                                │
│  ├── core/fitParser.js (.fit → activity record)             │
│  ├── core/garminParser.js (Connect API responses)           │
│  ├── core/parsers/sleepParser.js                             │
│  ├── core/parsers/icsParser.js (race calendar import)       │
│  ├── core/pdfParser.js (lab PDFs)                            │
│  └── core/cronometerParser.js (CSV exports)                 │
├─────────────────────────────────────────────────────────────┤
│  STORAGE LAYER                                               │
│  ├── core/storage.js (wrapper + KEYS dictionary)            │
│  └── core/memory.js (race catalog, planner)                 │
├─────────────────────────────────────────────────────────────┤
│  SYNC LAYER                                                  │
│  ├── core/cloud-sync.js (Cloudflare Worker pull/push)       │
│  ├── core/garmin-client.js (activities)                     │
│  ├── core/garmin-weight-client.js (body composition)        │
│  ├── core/cronometer-client.js (live nutrition pull)        │
│  └── core/healthSystems.js (HC daily energy)                │
├─────────────────────────────────────────────────────────────┤
│  PLATFORM                                                    │
│  └── Capacitor 8 (Android WebView + native plugins)         │
└─────────────────────────────────────────────────────────────┘
```

## Process Flow — daily user session

1. **Boot**: `Arnold.jsx` loads, hydrates `data` from `localStorage`, kicks off cloud-sync pulls (Garmin, Cronometer, HC). Mobile users land on `MobileHome.jsx` (Start screen).
2. **Sync**: Cloud-sync runs in background. New activities, sleep, HRV, weight, nutrition land in their respective storage keys. Parsers normalize.
3. **Derive**: When a tab loads, derivation functions (`dcyMath.allActivities()`, `weeklyAverages()`, `computeAcuteChronicRatio()`, etc.) compute metrics from raw storage data.
4. **Render**: Tabs render their views. Mobile uses MobileHome's tiles; web uses cockpit panels.
5. **User input**: Workouts get logged (FIT upload or manual), races scheduled, lab PDFs imported, nutrition entered via Cronometer auto-sync or manual.
6. **Persist**: `storage.set()` writes back. Cloud-sync pushes deltas if connected.

## Mobile vs Web

Same React tree, different render paths controlled by `window.innerWidth <= 600` (used by `isMobileApp` in `Arnold.jsx` and `isMobile` in `CalendarTab.jsx`). Specifically:

- **Mobile** (≤600px): `MobileHome` renders the Start screen, the bottom nav (`BottomNavBar`) is fixed, swipe nav between tabs is enabled via `useSwipeNav`, calendar grid uses `MobileDayTile` + inline `DayDrawer` panel.
- **Web** (>600px): `Arnold.jsx` renders the tabs row at the top, no bottom nav, calendar uses `DayTile` (F1 cockpit) + sticky right drawer on wide screens (≥1000px).

See [NAV_MAP.md](./NAV_MAP.md) for the full tab/route map.

## Color & family system

Workout families are encoded with stable hex codes shared across `FAMILY_STYLE` (CalendarTab), `FAMILY_COLOR` (PlannedWorkoutTile), `DAY_TYPES` (WeeklyPlanner), and `planner.js`. See [FAMILY_MAP.md](./FAMILY_MAP.md).

## Session signatures

PNG illustrations per workout family live in `public/session-signatures/`. Resolution paths kept in three maps that must stay in sync: `SIG_FILE` (CalendarTab), `SIGNATURE_SRC` (PlannedWorkoutTile), `PLAN_SIGNATURE` (WeeklyPlanner). `SIG_VERSION` (cache-bust query string) must also match. Current version: `v11`.

## Data sync sequence (FIT upload example)

```
User uploads .fit file
  ↓
fitParser.js → { activity, samples, laps }
  ↓
activityClass.js classifies family (run / hiit / strength / mobility / …)
  ↓
storage.set('activities', […, newActivity])
  ↓
dcyMath recomputes daily score
  ↓
Tile rendering picks up the new activity, signature illustration loads
  ↓
cloud-sync.js pushes activity to Cloudflare Worker (optional)
```

## Build & deploy

- **Web**: `npm run build` → `dist/`, deploy via static host
- **Mobile**: `npm run build:mobile` (vite build + `cap sync android`), then `npx cap run android` or open Android Studio

Build stamp logged to console on boot from `Arnold.jsx` (look for `[arnold-build] Phase ...`). Bump on every phase that ships.
