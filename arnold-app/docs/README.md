# Arnold — Architecture & Maps

> Last updated: Phase 4r.maps.1 (May 2026)

This folder is the canonical reference for Arnold's internals. If you change the system shape, the colors, the nav, or the storage model, update the relevant doc.

## Index

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — Stack, layers, mobile vs web split, build & deploy.
- **[DATA_FLOW.md](./DATA_FLOW.md)** — Sources of truth, sync pipelines (Garmin, Cronometer, HC), date handling rules.
- **[NAV_MAP.md](./NAV_MAP.md)** — Web tabs + mobile bottom-nav + swipe order. The single source for "where does X live in the UI."
- **[FAMILY_MAP.md](./FAMILY_MAP.md)** — Workout family system: colors, signature PNGs, short/pretty labels, classification rules.
- **[STORAGE_MAP.md](./STORAGE_MAP.md)** — Every `localStorage` key, its shape, owner, and notes.

## When to update

Phase-stamp the change at the top of each doc you touch. Bump build stamp in `Arnold.jsx` per the usual cadence. Internal consistency between docs and code is enforced by Phase 4r.maps.1 — re-run the audit (delegate to Explore agent with the prompt template in this folder) before any major release.

## Audit recipe

When suspicious about drift between files (colors, signature paths, nav ids):

```
Grep for the variable name in src/
Compare each definition site
Flag any divergence
```

The Phase 4r.maps.1 audit found ONE drift (PlannedWorkoutTile's `run.png` reference to a file that doesn't exist) and fixed it. All other maps (NAV_ITEMS, SWIPE_ORDER, FAMILY_STYLE colors, FAMILY_COLOR colors, storage keys) are consistent.
