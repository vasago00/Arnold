# Arnold — Nav & State Map

> Last updated: Phase 4r.maps.1 (May 2026)

The complete tab/route topology + bottom-nav binding. Defined in `src/Arnold.jsx` (`TABS`, `SWIPE_ORDER`, `handleMobileNav`, `mobileActiveId`) and `src/components/MobileHome.jsx` (`NAV_ITEMS`, `SWIPE_ORDER`, `TAB_TO_NAV_ID`, `TAB_LABEL`, `NAV_TAB_ICON_CMP`, `NAV_ICONS`).

## Web tabs (`Arnold.jsx` TABS)

| id | Label | Icon | Component |
|----|-------|------|-----------|
| `training` | EdgeIQ | ◈ | `Dashboard` |
| `daily` | Daily | ⊕ | `LogDay` |
| `weekly` | Trend | ◈ | `Dashboard` (weekly view) |
| `races` | Calendar | ▦ | `CalendarTab` |
| `goals` | Plan | ◎ | `WeeklyPlanner` + `Workbench` + `GoalsHub` |
| `labs` | Labs | ⬡ | `LabsModule` |
| `clinical` | Core | ◉ | `ClinicalModule` |
| `supplements` | Stack | ◈ | `SupplementsTab` |
| `settings` | Profile | ◎ | `ProfileSettings` |

> Note: the *internal id* `races` is legacy from before the Calendar redesign. The user-facing label everywhere is now "Calendar". Storage / routing still uses `races` for backward compatibility.

## Mobile bottom nav (`MobileHome.jsx` NAV_ITEMS)

| Nav id | Label | Tab routed to | Icon |
|--------|-------|---------------|------|
| `start` | Start | `training` (with `mobileInitView='start'`) | `Icon.PspX` |
| `edgeiq` | EdgeIQ | `weekly` | `Icon.GemSpark` |
| `play` | Play | `activity` | `Icon.Bolt` |
| `fuel` | Fuel | `nutrition_mobile` | `Icon.GasPump` |
| `calendar` | Calendar | `races` | `Icon.Calendar` |
| `core` | Core | `clinical` | `Icon.Pulse` |
| `more` | More | overflow sheet | `Icon.Dots` |

Labs, Daily Log, Plan, Stack, Settings live in the "More" overflow.

## Swipe order

Must match EXACTLY between `Arnold.jsx` line 601 and `MobileHome.jsx` line 320:

```js
['start', 'edgeiq', 'play', 'fuel', 'calendar', 'core']
```

Swipe left advances forward (Start → EdgeIQ → … → Core). Swipe right goes back. End-of-list swipe is a no-op (handled by the bounds check in both handlers).

## Tab → Nav id mapping (TAB_TO_NAV_ID)

For when the user navigates by tab id (e.g. deep-link) and we need to highlight the right bottom-nav slot:

| Tab id | Nav id |
|--------|--------|
| `weekly` | `edgeiq` |
| `activity` | `play` |
| `nutrition_mobile` | `fuel` |
| `clinical` | `core` |
| `races` | `calendar` |
| `labs` | `more` |
| `daily` | `more` |
| `goals` | `more` |
| `supplements` | `more` |
| `settings` | `more` |

## `mobileActiveId` derivation (Arnold.jsx line 583–592)

```
if tab === 'weekly'         → 'edgeiq'
if tab === 'activity'       → 'play'
if tab === 'nutrition_mobile' → 'fuel'
if tab === 'daily'          → 'play'      // legacy daily → play slot
if tab === 'clinical'       → 'core'
if tab === 'races'          → 'calendar'
if tab in (labs|goals|supplements) → 'more'
default → 'start'
```

## Mobile More overflow

Currently surfaces (Arnold.jsx line 1515):
- Labs (`tab='labs'`)
- Cloud Sync (`tab='settings'`)

Future entries should follow the same pattern: `{label, desc, tab}`.

## Selected day state (Calendar)

`CalendarTab` owns `selectedDate` (defaults to `localDate()` = today). On mobile, drawer is always-open; tapping a different day just updates `selectedDate`. On desktop, `drawerOpen` toggles via re-tap.

## Build stamp

Single source: `Arnold.jsx` `console.log('%c[arnold-build] Phase ...')`. Bumped every phase. Look in DevTools console on app boot to confirm which build is live.
