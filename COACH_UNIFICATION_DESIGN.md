# Coach Unification — Design (Sprint 1.1)
*2026-06-24 · design-first before any refactor · approve the shape, then build in slices*

## 1. The problem (why this is P1)
Coaching is computed in many places that overlap and drift. The proven cost: the **same
taper-for-a-tune-up bug had to be fixed in THREE engines this week** —
`seasonPlan.resolveSeasonPlan`, `planLoad.analyzeSeason`, and
`coachSignals.computeRaceHorizon` (→ `CoachComment.composePlanLine`). Every coaching rule
currently has to be fixed N times and the surfaces can contradict each other.

**Redundant domains (computed in >1 place):**
- **Race phase / periodization** → `seasonPlan` + `analyzeSeason` + `computeRaceHorizon` *(3× — the bug)*
- **Readiness verdict** → `coachSignals` (sleep/HRV/RHR) + `coachBriefs.patternLeveragePoint` + `narrativeComposer`
- **Fuel state** → `coachSignals` (EA/glycogen) + `coachBriefs` + `hub/coachInsights` + `CoachComment.classifyFuelState`
- **Training quality** → `coachSignals` (monotony/polarization) + `coachBriefs.patternPolarization`

**Live render surfaces:** `CoachComment` (8 per-surface modes, all screens) · `CalendarTab`
season card (`analyzeSeason`) · `SeasonCoachCard` (mobile Start, `seasonPlan`) · `CoachBeta`
(web briefs) · `LearnedHero` (hub facts). Dormant: `narrativeComposer`/`narrativeGraph`,
`coachingPrompts`, `narrativeScenarios`, likely `CoachLine`/`CoachBeta`.

## 2. Target architecture — one state, one voice
```
   inputs (storage)
        │
        ▼
  computeUserState()        ← KEEP (the day-of physiological/training STATE snapshot)
        │
        ▼
  computeCoachState(us)     ← NEW single orchestrator: the ONE coaching brain
   ├─ race:     getRaceCoach()      (the ONLY race phase/verdict/targets/feasibility — wraps seasonPlan)
   ├─ readiness/fuel/training/recovery: coachSignals (the ONE signal library)
   ├─ briefs:   composeCoachBriefs() (the ONE prioritized trade-off composer)
   └─ learned:  hubCoachInsights()   (learned facts — evidence, not verdicts)
        │
        ▼
  ONE composer → { surfaces: { startMobile, dailyDigest, playState, fuelState, planWeb, calendar, trend, edgeiq } }
        │
        ▼
  each render surface = a THIN adapter that reads coachState.surfaces[x]  (no rules in the component)
```
Principle (DESIGN_DECISIONS law): **one source of truth per verdict.** A component never
re-derives a phase/verdict; it formats what the engine emitted.

## 3. Migration — safe, build-verifiable slices

### Slice 1 — Race/periodization → ONE source *(do first; kills the 3× bug class)*
- New `getRaceCoach()` (in `seasonCoach.js` or a new `coachState.js`) returns the canonical
  `{ phase, verdict, nextRace, nextMarathon, targetWeeklyMiles, longRunTargetMi, feasibility, why }`
  by wrapping `seasonPlan` (the model we already trust + tested).
- `computeRaceHorizon`: keep its shape for consumers, but its **`phase` + `race`** now come
  from `getRaceCoach` (so `CoachComment.composePlanLine` + `classifyFuelState` use the one phase).
- `analyzeSeason`: keep missed-streak/empty-weeks "behind" framing, but its **taper/mode** comes
  from `getRaceCoach`'s verdict (delete its own taper threshold).
- `SeasonCoachCard` + `CalendarTab` card both read `getRaceCoach`.
- **Acceptance:** race phase/taper identical on Start, Calendar, and Plan banner; the
  marathon-only-taper rule lives in exactly one file; existing tests green + a new test that the
  three surfaces agree.

### Slice 2 — De-duplicate the signal domains
- One `computeReadinessVerdict` (sleep+HRV+RHR) consumed by both `coachSignals` and
  `coachBriefs.patternLeveragePoint`/`patternGarminReadiness`. Same for fuel (EA/glycogen) and
  training-quality (monotony/polarization). Move shared computation into the signal library;
  patterns + CoachComment read it.
- **Acceptance:** each domain computed once; no surface shows a verdict that disagrees with another.

### Slice 3 — One voice/composer
- `computeCoachState(us)` emits a `surfaces` map. Convert each `CoachComment` mode
  (`composePlanLine`, `classifyFuelState`, `composePlayLine`, `composeTrendLine`, `composeDigest`,
  `composeLeverageLine`, `composeMobileLibrary`) into a thin adapter over `coachState.surfaces`.
  Promote `coachBriefs` as the trade-off layer; keep `hubCoachInsights` as evidence.
- **Acceptance:** every surface's text comes from the one composer; tone register is consistent.

### Slice 4 — Retire dormant
- Remove/merge `narrativeComposer.js` + `narrativeGraph.js` (fold top-value patterns into briefs),
  `coachingPrompts.js`, `narrativeScenarios.js`, and `CoachLine`/`CoachBeta` if confirmed parked.
- **Acceptance:** no dead coach code; one engine, one voice.

## 4. Keep isolated (do NOT merge)
`cutMode.js` (intention classifier) · `energyBalance.js` (physics/TDEE) ·
`intermittentFasting.js` (intake modifier) · `hub/*` learned models (facts feed evidence).

## 5. Scope call for Sprint 1.1
**Slice 1 is the high-value, low-risk start** — it directly ends the race-phase drift that bit us
three times, touches a bounded set of files, and is fully build-verifiable. **Slices 2–4 are larger**
(the full voice unification) and realistically extend beyond Sprint 1; recommend Slice 1 now,
then Slice 2, and schedule 3–4 explicitly rather than attempting all at once.

**Risks:** `computeRaceHorizon`/`analyzeSeason` have other consumers (briefs, fuel-state,
Calendar totals) — change only the phase/verdict source, not their other outputs. No verification
gate in-sandbox (Emil builds/tests each slice).
