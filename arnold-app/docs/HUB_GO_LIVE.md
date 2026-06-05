# Hub Go-Live Plan — make the Intelligence Hub live, accurate, and visible

> Status: **PLAN** (2026-06-04). The hub core is built + tested (39/39) and boots
> from real data via `window.hubDebug()`, but it is (a) not persisted, (b) showing
> a conservative prediction (~56:48 10K vs Emil's real ~49:23), and (c) not visible
> in the UI. This plan closes those three gaps. Read HUB_CORE.md + the
> "Intelligence Hub" entries in HANDOVER.md first.

## Definition of done
After this chapter, opening the app: the hub loads/persists itself, shows a prediction
that matches the Races page (~49:23, your best-anchor fitness — not the conservative
training-average), and surfaces its facts (predictions + "for you, heat ~X%/°C") in a
caveated UI tile. The Trend "Race Predictor" inconsistency is gone because both read
the hub.

## Sequencing (pure-logic first — low risk; app/render edits last — flaky mount)
Do the steps in this order. Steps 1–2 are node-testable with ZERO app-build risk;
steps 3–4 touch Arnold.jsx / components, so do them when the sandbox mount is stable,
minimally, and verify (babel parse + NUL-strip + Read-tool tail).

---

## Step 1 — Calibration: best-anchor, not training-average  (pure logic, testable)
PROBLEM: the hub blends every qualifying run equally, so easy long runs drag the
fitness scalar slow (56:48). The Races page is accurate (49:23) because it anchors on
the SINGLE BEST demonstrated effort (findEmpiricalRaceAnchor tier-1: standard-distance
hard effort, or quality long run). Align the hub with that.
- Make race-effort anchors dominate: a standard-distance run that's fast (pace ≤92% of
  median ≥16km long-run pace, or avgHR ≥85% max) should enter the fitness ledger at
  HIGH precision; easy long runs at LOW precision (a conservative floor). Today both
  enter at the same ~0.25 effortFactor (attribution.effort=null for HR-less runs) →
  diluted. Fix options:
  • have `defaultSelectCheckpoints` / the backfill tag each checkpoint with a tier
    (race-effort | long) and pass a higher effortFactor / precision for race-effort, OR
  • compute a per-checkpoint `effort` hint (hard if it qualifies as race-effort) and
    feed it into the attribution/grade so obsPrecision reflects it.
- ALSO wire personal `k`: replace the 1.06 default with the app's `fatigueExponent`
  (tileMetrics.js) so longer-distance predictions match the Races page.
- TEST: a fixture where a fast 10K effort + several easy long runs yields a hub 10K
  prediction within ~1-2% of the best-anchor (predictRaceFinish) number, NOT the
  training-average. Add to tests/hubRaceFitness or a new tests/hubCalibration.test.mjs.
- VERIFY: `window.hubDebug()` 10K-equiv should drop from ~56:48 toward ~49:xx.

## Step 2 — Persist + boot  (mostly logic; one small app hook)
- New `core/hub/hubBoot.js` (node-testable with an injected store): `ensureHub(store,
  {activities, attributionFn, k})` → loadHubState; if absent (or a cheap freshness
  check says stale), backfill from activities + saveHubState; return state.
  `recordRaceLive(store, race, attribution, opts)` → recordRace + saveHubState.
- Hook at app boot: a single guarded call (mirror the existing debug-import pattern) so
  the hub is ensured once on load. Keep the Arnold.jsx touch to ONE line/import.
- Decide freshness: simplest first cut = backfill-and-save on boot if no persisted
  state, else load; re-backfill only when activity count changes materially. (Optimize
  later; correctness > cleverness.)
- TEST: ensureHub on an empty store backfills+saves; on a populated store loads without
  re-backfilling; recordRaceLive persists an incremental update.

## Step 3 — Surface in the UI  (render edit — do when mount stable)
- A small read-only "Intelligence / Hub" card (Trend or EdgeIQ) rendering `hubFacts`:
  the distance predictions + top response sensitivities, WITH a caveat badge:
  "training-anchored · confidence X" until a real race calibrates it. Reuse the
  presentation-layer registry/renderer style for consistency.
- Keep it additive + behind a guard (no behavior change if hub state is empty).
- VERIFY: rebuild from Windows; eyeball the card on web + mobile.

## Step 4 — Unify the predictor (fold in the Races/Trend inconsistency)
- Once Step 1 makes the hub prediction trustworthy, route the Trend `racePredictor`
  metric (tileMetrics.js L898/L1015) AND ideally the Races page through
  `predictFromFitness(hub.fitness, targetKm, {k})` → ONE number everywhere. This is the
  HANDOVER "PREDICTOR INCONSISTENCY" item; the hub is its single source of truth.
- Keep the Trend ARROW (trajectory) if useful, but the headline number comes from the hub.
- VERIFY: Races page and Trend show the SAME Queens-10K time.

## Risks / notes
- Sandbox mount truncates files mid-write (recurring this project). Steps 1–2 are
  node-tested so they're safe; for steps 3–4, after each Arnold.jsx/component edit:
  strip NULs, babel-parse, and confirm the tail via the Read tool; re-emit via bash
  heredoc if the mount truncated.
- Accuracy still ultimately wants a REAL race effort in the data; Step 1 gets us to the
  best-anchor number from what exists, but a logged race is what makes it authoritative
  and starts populating the response ledger with confounded residuals.
- After Steps 1–4, the NEXT chapter is the Coaching Team (COACHING_TEAM.md), which reads
  this now-live hub and speaks via the validated (parked) narration layer.
