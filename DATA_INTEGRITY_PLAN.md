# DATA_INTEGRITY_PLAN.md — handling missing / stale data the right way

**Status:** proposed (2026-06-19). Trigger: Cronometer outage exposed that with **no food logged** the app showed **Fuel 92% / "Strongly Absorbing"** (Start) and **Nutrition 92** (EdgeIQ) — fabricated favorable numbers on a health app.

## 1. The real problem (why this is the scary one)

It was **not three bugs**. It was **one architectural gap** surfacing in three independent scorers:

- `core/dcy.js` `fuelAdequacy` — `geomMeanWeighted` drops `v===0` factors, so water alone produced N≈0.92.
- `core/dcy.js` `isEmptyDay` — required `water===0`, so hydration masked an empty food day.
- `core/trainingStress.js` nutrition domain — each factor guarded `if (x>0)`, so only hydration scored.

**Root cause:** nothing in the pipeline distinguishes *"this input is missing"* from *"this input is a real low/zero value."* Each scorer re-invents that decision, and several silently turn **missing → favorable number**. Data flows `source → storage → scorer → display` with **no shared contract for absence or staleness**. That is the "piping," and it is the thing to fix — not the symptoms.

For a health app this is the highest-severity failure mode: a user could be told they're well-fuelled when they haven't eaten, and act on it.

## 2. Principles (the contract every layer must honor)

1. **Absence is a value, not a zero.** Every input resolves to one of four states: `fresh`, `stale`, `gap` (expected but absent — e.g. source down), `not-tracked` (never expected). Never collapse to a number silently.
2. **Missing in → missing out.** A score that depends on a missing primary input returns a typed `no-data`/`partial` result, **never** a fabricated number. Propagate the gap; don't paper over it.
3. **"User doesn't track X" ≠ "source X is down."** Configured source + missing expected data = **gap** → surface it. Not configured = omit silently. (The fuel fix already does a version of this via `cronometerAuth`.)
4. **Composites must be honest about completeness.** A daily/readiness score that drops a missing domain must **flag that it is incomplete** — never present "92" as authoritative when nutrition is actually missing.
5. **Show it when it happens.** Source failures and data gaps are surfaced to the user (a banner + per-metric `—`/stale badge), not hidden behind a confident number.

## 3. The standard result shape (extend what `coachSignals.js` already does)

Adopt one shape everywhere a metric is produced:

```
{ value, status, asOf, source }
//  status ∈ 'ok' | 'stale' | 'no-data' | 'partial' | 'not-tracked'
```

And one shared decision helper so the zero-vs-missing call is made in **exactly one place**:

```
scoreAdherence(value, target, { expected })
//  value missing + expected  → { status: 'gap' }      (don't score)
//  value === 0  + expected    → real zero → score it LOW (do NOT skip)
//  value missing + !expected  → { status: 'not-tracked' }
```

Every scorer routes its inputs through this instead of ad-hoc `if (x>0)` guards.

## 4. Three layers

### Layer 1 — `dataHealth()` availability service (NEW, single source of truth)
Returns, per source (nutrition/Cronometer, activities/Garmin, sleep, HRV, weight):
`configured?`, `lastSyncAt`, `lastError`, `expectedCadence`, `todayPresent?`, `freshness` (stale if older than cadence).
Built from signals that **already exist**: `cloud-sync.js` `lastPull`/`lastPullError`, `isCronometerConfigured`/`isGarminConfigured`, and per-day presence in the storage buckets. Everything downstream consults this rather than re-deriving "is there data."

### Layer 2 — scorers consume availability, return typed results
`dcy` (fuel/recovery), `trainingStress` domains, `healthSystems` all read `dataHealth()` and emit `ok | no-data | partial`. A composite never computes a number from a single surviving sub-factor when the primaries are absent. Keep a small registry of *what each composite depends on* so every surface of a metric can be audited together.

### Layer 3 — display: honest states
- `no-data` → `—` with a subtle "needs data" affordance (the `EmptyHint`/`—` vocabulary already exists).
- `stale` → value + age badge ("as of Jun 17").
- `partial` composite → an "incomplete" marker so a high number isn't read as authoritative.
- **Global data-health banner** when a configured source is failing: *"Cronometer hasn't synced since Jun 18 — nutrition metrics paused. [Retry] [Log manually]."*

## 5. Contingency / graceful degradation

- **One source down ≠ app down.** Dependent metrics show `no-data`; everything else keeps working.
- **Don't poison composites** — flag incompleteness instead of inventing a value.
- **Manual fallback** path (log it yourself) surfaced exactly when a source is down.
- **Surface the worker's own retry/backoff state** (it already negative-caches failures post-outage).

## 6. Guardrails so it cannot silently regress

- The single `scoreAdherence` decision point (no more per-scorer zero handling).
- **Golden failure-matrix tests** across *every* scorer: `{food=0, water>0}`, `{source configured + empty}`, `{stale}`, `{not-tracked}`. These would have caught all three bugs.
- A dev **"Data Health"** panel.
- POSTMORTEMS rule (added 2026-06-19): when a metric must count a hard zero, audit **every** scorer that surfaces it — they don't share code.

## 7. Phasing

- **Phase 0 — DONE.** Patched the three known fuel/nutrition hallucinations (POSTMORTEMS 2026-06-19).
- **Phase 1 — DONE (2026-06-19).** `core/dataHealth.js` (single source of truth: per-source configured/fresh/stale/down/never) + `components/DataHealthBanner.jsx` (visible warning + Retry sync + "affected scores show —, not estimated"), wired into the Start screen (MobileHome) and web EdgeIQ. Surfaces gaps honestly before any scorer refactor.
- **Phase 2 — STARTED (2026-06-21).** Foundation built + self-tested: `core/metricResult.js` — `result()`, `scoreAdherence(value, target, {expected})` (real 0 scores LOW, missing→`gap`/`not-tracked`), and `combineDomain()` (only `ok` factors contribute; an expected gap → `partial`; nothing usable → `no-data`). Self-test reproduces the exact bug: food=0 + water → domain 0.14, NOT 0.92. ALSO (Layer-3 example): weight staleness catch — `currentTrueWeight()` returns the value's date + `weightAsOf()`; Start weight stat now shows "lbs · <date>" when it's a stale fallback. `trainingStress` nutrition domain MIGRATED + behaviorally verified (water-only→no-data; logged-0 macro→scored low; full day→96). `dcy` fuelAdequacy MIGRATED + verified — `fuelResult()` returns `{N, status}`; N stays numeric, `fuelStatus` carried via `dcy()`+`fuelBreakdown`; Start Fuel pill + DcyDetails show "—" on no-data (water-only→N0/no-data; on-target→0.97; food+0protein→0.61 scored not dropped; non-tracker→not-tracked). `healthSystems` AUDITED — does NOT fabricate: `scoreSystem` computes pct=value/target, so an empty day → 0%/deficient (LOW), never a favorable high. No migration (refactoring its micronutrient scoring = risk without reward). **The favorable-fabrication bug class is CLOSED at the source** (the two scorers that had it — trainingStress nutrition, dcy fuel — are migrated + verified). Optional polish — DONE (2026-06-21): MobileEdgeIQ Weight tile shows 'as of <date>' when stale; DataHealthBanner extended to MobileEdgeIQ + Fuel tab (NutritionInput) so the outage is surfaced where the Health Systems grid reads low; Fuel '—' already via DcyDetails. healthSystems scoreSystem intentionally NOT refactored (errs low/safe; banner covers visibility).
- **Phase 3 — DONE (2026-06-21).** Golden failure-matrix tests + dev panel. (1) `core/metricResult.test.js` — the contract: `scoreAdherence` (real 0 → LOW; missing+expected → gap; missing+!expected → not-tracked; no-target; cap) and `combineDomain` (the exact bug: food=0 + water → <0.2 not 0.92; all-missing → no-data; present+gap → partial; not-tracked excluded). (2) The two migrated scorers were refactored to expose a PURE core so their WIRING is unit-testable: `dcy.fuelScore()` and `trainingStress.nutritionScore()` (IO stays in `fuelResult`/`computeDailyScore`). Tests `core/dcy.fuel.test.js` + `core/trainingStress.nutrition.test.js` cover `{food=0,water>0}`, `{nothing}`, `{full day}`, `{food+0 protein → scored low}`, `{not-tracked}`. (3) Extraction surfaced a LATENT re-opening: called in isolation with water but null macros, `nutritionScore` scored 0.83 from hydration alone (the caller had been nulling water). Added an internal water-gate (matching `fuelScore`) so hydration alone can NEVER score nutrition — defense in depth. (4) Dev panel: `window.dataHealthDebug()` prints the per-source availability table + live TYPED scorer outputs for today (no-data/partial → "—"), the dev counterpart to the user banner. All assertions node-verified (vitest can't run in the sandbox — rollup native binary; runs on Windows via `npm test`). esbuild transform + babel scope + full-graph bundle all clean. **The favorable-fabrication bug class is now closed AND locked by tests that would have caught the original three bugs.**
