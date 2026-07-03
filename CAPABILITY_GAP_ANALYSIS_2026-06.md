# Arnold — Capability Inventory & Gap Analysis
*Snapshot: 2026-06-24 · companion to PRODUCT_AUDIT_2026-06.md (the "why") and EXECUTION_PLAN_2026-06.md (the "how")*

This is a strategic map: **what Arnold is meant to be**, **what exists today**, and **the gaps between them**. It's deliberately high-level — for detail, the two companion docs and the code are the source of truth.

---

## 1. The strategic final state (what we're building toward)

Arnold's wedge is unique: **the only system attempting all four of {deep training analytics · recovery/readiness · performance nutrition · adaptive coaching} at once, locally, with a model that learns the individual and can explain itself.** No incumbent owns that intersection (intervals.icu has analytics but no nutrition or voice; WHOOP/Oura have a clean recovery loop but "made-up" opaque scores; Runna/TrainAsONE adapt plans but are black boxes; Fuelin/MAVR do fueling but bolt onto someone else's engine).

The final state, expressed as six pillars:

1. **Transparency is the hero.** The thing the whole category fails at — *why* is my score what it is, and *how sure are you* — is Arnold's front door, not a line below the fold.
2. **The loop is closed.** Readiness/debt → tomorrow's session auto-adjusts, with the reason shown. A coach, not a scorekeeper.
3. **Nutrition is prescriptive.** "Fuel for *the work required*" — what to eat for tomorrow's session, and a flag when energy availability is low — not just a log and a Replenish tile.
4. **One coach voice.** A single mind that says the same thing on every screen, structured as acknowledge → mechanism → next action.
5. **The coach speaks once, at the right time, about the thing that changed** — event-driven, not reacting to every water log at 8am.
6. **Premium, systematic UI.** WHOOP/Oura-tier polish on a design system that ends the per-card churn — one hero per screen, progressive disclosure.

Layered on top, the **coaching-staff vision** that's now concrete: a continuous multi-race season (Berlin/NYC/Valencia), an engine that prescribes *train more / less / rest / taper* against the real plan, and feasibility reads per race.

---

## 2. What we have today — the engine (Arnold's 9/10 asset)

The intelligence is genuinely ahead of the market. Maturity tags: **Mature** (solid, used) · **Partial** (works, loosely wired/incomplete) · **Stub** (skeleton/design-only).

| Domain | Mature | Partial / Stub |
|---|---|---|
| **Data ingestion & sync** | Garmin (activities/weight/wellness), Cronometer CSV parser, Health Connect, Cloud Sync (E2E-encrypted), FIT/CSV/HRV/weight/sleep parsers, storage engine (IndexedDB + localStorage) | FatSecret API client *(new)*, ICS/PDF import, backup/export orchestration |
| **Training load & fitness** | rTSS/ACWR, fitnessModel, responseModel (per-factor sensitivities), raceFitness (Riegel + learned), sweatModel, bodyModel, Bayesian estimate, hub backfill/accumulate | trainingHeat *(new ledger)*, cycling power/IF, activity signatures, autoPromote |
| **Health systems & scoring** | healthSystems (10 systems, 50+ nutrient targets), DCY readiness pipeline, metricResult *(new typed result)*, recoveryDebt | dataHealth audit, biomarkers, IF context |
| **Intelligence & attribution** | intelligence.js (one user-state model), coachSignals v1 (6 overreaching signals), attribution (race divergence → causes), hubFacts, coachInsights | learnedBaselines, expectedRanges, predictedBands |
| **Coach / messaging** | — | coachBriefs v2, coachingPrompts, narrativeComposer, narrativeGraph/scenarios *(stubs)* |
| **Nutrition & energy** | nutrition totals, energyBalance/TDEE, goalModel (effective targets), raceFueling, supplements | fuelForWork, activityNeeds, sessionRPE, IF |
| **Cut mode / body comp** | cutMode (7-state RED-S-aware classifier), bodyWeight, weight-trend EWMA | — |
| **Race / periodization** | planner, todayStatus *(new SoT for "done today")*, seasonPlan *(new continuous engine)*, seasonCoach *(new live wrapper)* | planLoad/analyzeSeason, raceFormats (HYROX done), tileMetrics predictor; **planGenerator + adaptPlan = stubs** |

**Net:** the sensing and modeling layers are deep and mostly mature. The thin spots are exactly the high-value ones — **prescription** (planGenerator, adaptPlan, fuelForWork) and the **coach composition layer** (multiple partial composers).

---

## 3. What we have today — the product surface

**Platform:** React + Vite 8 (rolldown) on web, Capacitor for Android; responsive web + a separate mobile-first render path (they drift — a known cost). A real design-token layer exists (`theme/tokens.js`, shared `Card`/`Button`/`MetricTile`/`Sparkline`/`ArcDial` primitives), but adoption is partial and most screens are still bespoke inline styles.

**Web tabs (9):** EdgeIQ · Daily · Trend · Calendar · Plan · Labs · Core · Stack · Profile.
**Mobile nav (6):** Start · EdgeIQ · Play · Fuel · Calendar · More(Labs/Sync).

**Polished surfaces:** EdgeIQ cockpit (KRI matrix + sparklines), Calendar (month grid + day drawer), mobile Start hero + PlannedWorkoutTile, Health Systems grid/tiles, CoachComment, the primitives.
**Functional:** Labs, Clinical (DEXA/VO₂/RMR), Supplements, GoalsHub, NutritionInput, CloudSyncPanel (now incl. FatSecret + Cronometer manual import), PredictedBandsCard, SeasonCoachCard *(new)*, InsightsPanel.
**Rough/parked:** Workbench (single workouts only), HypericeQuickAdd, ImportDiagnostics, the deprecated HubPanel.

---

## 4. Gap analysis — today vs final state, by pillar

| # | Pillar (final state) | Where we are today | The gap | Recent movement |
|---|---|---|---|---|
| 1 | **Transparency is the hero** | The attribution/hub intelligence exists and is correct, but renders as a low-contrast line below the fold (LearnedHero). | Make "what Arnold learned about you — and how sure" a first-class, confidence-aware surface. *Mostly a presentation problem — the hard part is built.* | — (the audit's #1; still open) |
| 2 | **Closed adaptive loop** | Rich readiness/fitness model + a planner, but loosely coupled. Plan is static once made; completion is the only feedback. `planGenerator`/`adaptPlan` are **stubs**. The new `seasonPlan` prescribes weekly *direction* but doesn't yet rewrite the actual plan. | Wire readiness/debt → tomorrow's session auto-adjusts with the reason shown; generate the periodized plan, not just a verdict. | **seasonPlan/seasonCoach + live SeasonCoachCard shipped** — the prescriptive verdict layer now exists; plan *generation/adaptation* still to build. |
| 3 | **Prescriptive nutrition** | Cronometer/FatSecret ingestion + energy/cut models are strong. `fuelForWork`/`activityNeeds` exist but partial; mostly descriptive (log + Replenish). | "Eat *this* for tomorrow's session" + low-EA flags, surfaced. Make the nutrition data pay off beyond a tile. | Data path settled (FatSecret + compliant Cronometer import); prescription still thin. |
| 4 | **One coach voice** | **Fragmented — the core unmet promise.** Multiple composers (CoachComment, coachBriefs, coachSignals, narrative*, planLoad, seasonPlan). This session alone we found the **same taper bug in three separate coaching engines.** | Route every coaching surface through one engine/voice. Highest-leverage cleanup left. | We made the three engines *agree* on marathon-only taper — but they're still three. Unification is queued. |
| 5 | **Event-driven coach** | Coach can talk about sleep at 8am or fire on a water log. `narrativeGraph` (event model) is a stub. | Speak once, at the right time, about the thing that changed. Central to *feeling* intelligent. | — (deferred "living coach" track) |
| 6 | **Premium, systematic UI** | intervals.icu/Runalyze tier: dark, dense, characterful (the low-poly figures are a real brand asset), but bespoke per screen → polish ceiling + churn (~13 rounds on one card). Token layer exists, adoption partial. | WHOOP/Oura polish: one hero per screen, progressive disclosure, full design-system adoption, web/mobile parity. Targeted for end-July. | Tokens + some primitives in place; cockpit/EdgeIQ density refresh prototyped, not built. |

**Cross-cutting (now largely closed this sprint):**

- **Data integrity / "real zero vs missing"** → `metricResult.js` typed results + golden tests. **Closed.**
- **Multi-session / two-a-days** (logging → display) → `todayStatus` exposes all sessions; load already sums them; Start + EdgeIQ render both. **Mostly closed** (planned-doubles pre-tile + per-session metrics remain).
- **Race data as one source of truth** → consolidated 3 drifting stores into one. **Closed.**
- **Nutrition-source compliance** (Cronometer ToS) → stopped scraping; compliant manual CSV import + FatSecret path. **Closed** (FatSecret go-live gated on Premier approval).
- **Multi-race periodization** (Berlin/NYC/Valencia, continuous model) → engine + live panel. **Closed v1.**

---

## 5. The highest-leverage gaps to close next (ranked)

1. **Unify the coach into one engine/voice** (pillar 4). We just proved the cost of *not* doing this — three engines, same bug, three fixes. Route Calendar/Plan/Start/EdgeIQ coaching through `seasonPlan` + one composer. *This also de-risks pillars 2, 3, 5.*
2. **Close the adaptive loop** (pillar 2): build real plan **generation** (periodized weeks from the season engine) and **daily adaptation** (readiness → tomorrow shifts, reason shown). The stubs (`planGenerator`, `adaptPlan`) are where "coach, not scorekeeper" lives.
3. **Make transparency the hero** (pillar 1): promote the learned-about-you + confidence surface. Highest *differentiation* per unit effort — the engine's already built.
4. **Prescriptive fueling** (pillar 3): finish `fuelForWork`/`activityNeeds` and surface "fuel for tomorrow + low-EA flag."
5. **UI/UX systemization** (pillar 6): the end-July batch — cockpit/EdgeIQ density refresh, full primitive adoption, web/mobile parity, rebrand/name.
6. **Event-driven coach** (pillar 5): the "speak once, right time" layer (`narrativeGraph`) — the polish that makes it *feel* alive.

**One-line read:** the **engine is ~9/10 and got deeper this sprint**; the gap to the vision is almost entirely in **prescription + one voice + presentation** — turning the brain that already exists into a coach that adapts the plan, speaks once with one voice, and makes its transparency the thing you see first.
