# Arnold — Family / Color / Signature Map

> Last updated: Phase 4r.maps.1 (May 2026). Bump when colors or signature files change.

Workout families are encoded with stable hex codes and PNG paths shared across multiple files. **All three sources MUST match** — drift causes the same workout to render different colors on different screens.

## Sources

| Map | File | Variable |
|-----|------|----------|
| Calendar tile + drawer | `src/components/CalendarTab.jsx` | `FAMILY_STYLE`, `SIG_FILE` |
| Performance card | `src/components/PlannedWorkoutTile.jsx` | `FAMILY_COLOR`, `SIGNATURE_SRC` |
| Weekly planner | `src/components/WeeklyPlanner.jsx` | `DAY_TYPES`, `PLAN_SIGNATURE` |
| Planner data model | `src/core/planner.js` | `DAY_TYPES` (with `color` field) |

## Color palette (Phase 4r.color.1)

| Family | Hex | Visual | Used for |
|--------|-----|--------|----------|
| `run` (and `easy_run`, `long_run`) | `#60a5fa` | blue | Aerobic running |
| `tempo` | `#fbbf24` | amber | Threshold / tempo work |
| `intervals` (`speed_run`) | `#fb7185` | coral-pink | Track repeats, VO2 |
| `hiit` | `#fb7185` | coral-pink | HYROX-style, anaerobic |
| `strength` | `#a78bfa` | purple | Lifts |
| `mobility` | `#5eead4` | teal | Yoga, stretch, foam-roll |
| `cross` | `#94a3b8` (calendar) / `#34d399` (PlannedWorkoutTile) | gray-blue / green | Bike, swim, ski, other |
| `race` | `#ef4444` | deep red | Race day |
| `rest` | `#64748b` | slate | Rest / unplanned |

> **Drift to watch**: `cross` differs between `FAMILY_STYLE` (gray-blue) and `FAMILY_COLOR` (green). This is intentional for now — CalendarTab uses a neutral cross tone so it doesn't compete with the more saturated families in the grid; PlannedWorkoutTile uses the brighter green for the single workout card. Document any decision to unify.

> **Tempo vs HIIT**: Both used to be amber, which collapsed at small mobile-calendar tile size. Phase 4r.color.1 split HIIT to coral-pink so HIIT and tempo read as distinct effort classes. Don't revert.

> **HIIT vs Race**: HIIT is coral-pink (`#fb7185`), race is deep red (`#ef4444`). Visually distinct because HIIT is pink/salmon and race is brick-red. Don't shift either toward the other.

## Session signature PNGs

All files live in `public/session-signatures/`. Current cache-bust version: `v11` (must match across `SIG_VERSION` constants in all three files).

| Family | PNG file | Notes |
|--------|----------|-------|
| `run` | `easy-run.png` | Canonical generic-run. `run.png` does NOT exist on disk. |
| `easy_run` | `easy-run.png` | Same as run |
| `long_run` | `easy-run.png` | Same as run (no distinct long-run figure yet) |
| `tempo` | `tempo.png` | Forward-leaning runner |
| `intervals`, `speed_run` | `speed.png` | More extreme forward lean |
| `ski` | `ski.png` | Skier silhouette |
| `hiit` | `hiit.png` | Dynamic burst pose |
| `strength` | `strength.png` | Figure with barbell |
| `mobility` | `mobility.png` | Warrior pose (NOT a tai chi figure — the small mobility-done indicator IS a tai chi glyph from Phosphor, but the big PNG is warrior) |
| `cross` | `cross.png` | Generic cross-training silhouette |
| `race` | `race.png` | Runner crossing finish-line tape |

## Cache-bust protocol

`SIG_VERSION = 'v11'` is appended as a query string (`?v11`) to bust browser/WebView caches when PNGs are re-generated. If you replace the source PNGs in `public/session-signatures/`, bump `SIG_VERSION` in ALL THREE files in lockstep:

- `src/components/CalendarTab.jsx`
- `src/components/PlannedWorkoutTile.jsx`
- `src/components/WeeklyPlanner.jsx`

Otherwise users will see the old image until their cache evicts.

## Visual-size correction

Two PNG figures (`mobility.png` warrior pose, `race.png` runner crossing tape) have more whitespace around the figure than the upright runners, so they render ~20% smaller at the same container size. `CalendarTab.jsx` applies a `SIG_SCALE` transform on the `<img>` element:

```js
const SIG_SCALE = {
  mobility: 1.22,
  race:     1.18,
  // everything else = 1.0
};
```

This is a workaround, not a fix. A proper fix would be tight-cropping the source PNGs and bumping `SIG_VERSION` to v12. Defer until visible cosmetic issue justifies the work.

## Short labels (`FAMILY_SHORT` in CalendarTab.jsx)

```
run → 'Run'        long_run → 'Long'    tempo → 'Tempo'    intervals → 'Int'
hiit → 'HIIT'      strength → 'Lift'    mobility → 'Mob'   cross → 'Cross'
race → 'Race'      rest → 'Rest'
```

## Pretty labels (`FAMILY_PRETTY` in CalendarTab.jsx)

```
run → 'Run'              easy_run → 'Easy Run'    long_run → 'Long Run'
tempo → 'Tempo'          intervals → 'Intervals'  speed_run → 'Speed'
ski → 'Ski'              hiit → 'HIIT'            strength → 'Strength'
mobility → 'Mobility'    cross → 'Cross-Training' race → 'Race'
rest → 'Rest'
```

## Activity classification

The function `activityFamily(a)` in `CalendarTab.jsx` (and `core/activityClass.js` for canonical) decides which family a logged activity belongs to. Detection order:

1. Explicit race tag → `race`
2. `isMobility(a)` → `mobility`
3. `isHIIT(a)` → `hiit`
4. `isStrength(a)` → `strength`
5. `isCycling(a) || isSwim(a)` → `cross`
6. Distance ≥ 13.1 mi + isRun → `long_run`
7. Default → `run`

Anything that lands in `run` but had tempo / interval / speed naming patterns gets further classified at the rendering site (e.g. PlannedWorkoutTile checks the activity name for "tempo" / "interval" keywords to pick the right signature).
