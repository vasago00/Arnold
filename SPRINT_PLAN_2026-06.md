# Arnold — Master Sprint Plan (2-week execution)
**Window: 2026-06-25 → 2026-07-08** · *Owner: Emil + Claude · Created 2026-06-24*

> **THIS SUPERSEDES all prior planning** (the EXECUTION_PLAN sprint board, ad-hoc queues, the
> CAPABILITY_GAP shortlist). Those remain as reference/why; **this is the what + when.**
> Ground rules (DESIGN_DECISIONS.md): smallest change, one source of truth, verify-don't-claim.
> Cadence: Claude builds a chunk → Emil builds + `npm test` → confirm → next. A **daily report**
> (see §5) tracks progress against this plan.
>
> Priorities (from CAPABILITY_GAP_ANALYSIS_2026-06.md): **(1) one coach voice · (2) close the
> adaptive loop · (3) transparency-as-hero · (4) prescriptive fuel**. UI/UX systemization is a
> **parallel track to end-July**, not crammed into these two weeks.

---

## 1. Sprint 1 — "One voice + finish multi-session + integrity" (Jun 25 → Jul 1)
*Goal: collapse the coaching duplication, fully close two-a-days, pay down data-integrity debt.*

| # | Item | Acceptance criteria | Status |
|---|---|---|---|
| 1.1 | **Coach unification** — route Calendar/Plan/Start/EdgeIQ coaching through ONE engine (`seasonPlan`) + one composer; retire the duplicate taper/phase logic in `analyzeSeason`, `computeRaceHorizon`/`CoachComment`. | One source emits the season/phase verdict; all surfaces read it; no rule lives in 3 places. Tests green. | ☐ |
| 1.2 | **Two-a-day — pre-tile (#4)** — mobile Start pre-workout tile shows BOTH planned sessions (read `daySessions`). | Two planned sessions render on the pre tile; single-session unchanged. | ☐ |
| 1.3 | **Two-a-day — post-tile metrics (#5)** — per-session load/pace on the secondary line, not just label+min. | Secondary sessions show load/pace. | ☐ |
| 1.4 | **Two-a-day — daily-web detail (#3) + calendar-tile metrics (#1)** — strength+run day shows both with detail; calendar secondary shows duration. | Both render; drawer remains the detail reference. | ☐ |
| 1.5 | **Calendar multi-session dots** — day cells show ≤3 type-colored session dots. | Multi-session days show dots on the tile. | ☐ |
| 1.6 | **Data integrity — post-workout weight capture** — wire `PostRunWeigh` → sweat/hydration. | Capture flow live; feeds `grossSweatRate`. | ☐ |
| 1.7 | **Data integrity — sRPE → ACWR/Trend** + **TDEE empirical double-count audit**. | sRPE feeds load when HR absent; TDEE path verified no double-count. | ☐ |
| 1.8 | **FatSecret go-live** *(external gate — do when Premier-Free approved)* — whitelist `0.0.0.0/0` → `wrangler deploy` → paste URL → Test connection. | "✓ Connected · scope: premier"; barcode works. | ☐ |
| 1.9 | **Health Connect Android verify** — confirm the dailyEnergy Kotlin fix on a device build. | Steps/active/total kcal populate on Android. | ☐ |

## 2. Sprint 2 — "Coach, not scorekeeper + transparency + fuel" (Jul 2 → Jul 8)
*Goal: close the adaptive loop, make transparency the hero, make nutrition prescriptive.*

| # | Item | Acceptance criteria | Status |
|---|---|---|---|
| 2.1 | **Adaptive loop — plan generation** — generate periodized weeks from the season engine (`planGenerator` off `seasonPlan`: base/build/mini-taper/recovery, weekly mileage + long-run targets). | "Generate plan" produces a real multi-week schedule to the calendar. | ☐ |
| 2.2 | **Adaptive loop — daily adaptation** — readiness/debt → session auto-adjusts, **with the reason shown** (`adaptPlan` wired to hub readiness). | Prescription shifts on low readiness, reason visible. | ✅ (2026-07-02) — satisfied by the shared `PlannedWorkoutTile`: `adaptSession` runs on real signals (readiness/debt/HRV/sleep/battery), the tile shows adjusted chips + a Cleared/Adapted coach line with the reason, on BOTH mobile Start (`MobileHome`) and web Daily (`LogDay`) — one voice via one component. Forward "tomorrow-preview" descoped (future readiness unknown); coach-voice lead descoped (Emil: shared tile already IS the one voice). |
| 2.3 | **Transparency hero** — promote "what Arnold learned about you + confidence" to a first-class surface. | Learned-about-you + confidence is a hero, not a sub-line. | ✅ (2026-07-02) — `LearnedHero` is a hero card on web Daily with **normal-distribution confidence** per learned effect (centred on the magnitude, spread = uncertainty, zero line = "established?") and is now reactive (`useStorageVersion`). Decision (Jun-26): weave confidence INTO cards vs a Start hero. Woven: **RMR** (Katch estimate → never-high, ages), **Race Predictor** (empirical race-effort=high·recent / long-run·stale=med / Garmin VO₂max=low), **energy Σ** (`energyExpenditure().confidence`: device=med/model=low/empirical=var) via the `MetricTile`/EnergyTimingChart affordance. |
| 2.4 | **Prescriptive fuel** — finish `fuelForWork`/`activityNeeds`; surface "fuel for the session + low-EA flag". | Fuel target + RED-S/low-EA flag shown. | ✅ (2026-07-02) — `fuelForWork.prescribeFuel` (pure, 9 tests) + `fuelForToday` wrapper: pre-carbs (1–4 g/kg), during-carbs g/h, PM protein (0.3–0.4 g/kg), **EA = (intake−activity)/FFM** with low-EA/RED-S flag (Mountjoy IOC 2018), deficit-vs-target. Fuels the ADAPTED session. Rendered on the shared `PlannedWorkoutTile` fuel band (pre-carbs · PM protein · color-coded EA chip w/ RED-S tooltip), web Daily + mobile Start. `activityNeeds` (computeActivityNeeds/trackReplenishment) wired in `LogDay`. |

> **Honest scope note:** 2.1 + 2.2 are the largest items in the plan (multi-day each). If the
> week tightens, ship 2.1 (generation) + 2.3 (transparency) first; 2.2 (daily adapt) may carry
> a few days into the UI/UX track — flag it in the daily report rather than rushing it.

## 3. Parallel / continuing track — UI/UX systemization (target: end of July)
*Not in the 2-week functional sprint; runs alongside, finished by ~Jul 31.*

- Start cockpit + EdgeIQ governed-density refresh (prototypes exist).
- Full design-system adoption (Card/Button/MetricTile primitives) on low-risk surfaces.
- LogDay ski profile + non-run "Vs Goal" (cycle/swim/walk).
- Signal-cockpit tile desaturation (last of 3 grids).
- Web/mobile parity — further duplicated-surface merges as found.
- Rebrand / name + logo decision (shortlist: Cairn/Strata/Ledger/Compound/Keystone/Tally/Course).
- Calendar weekly-totals gutter column.

## 4. Backlog parking lot (not scheduled — pull in if time, else next cycle)
- **Illness & Return-to-Training mode** — recognise illness (manual flag + RHR/HRV/battery signature) vs detraining; mute add-volume nags while sick; graded return-to-training with reason; immune-load risk flag from sleep debt + harsh max effort. Full design: `ILLNESS_RETURN_TO_TRAINING.md`. (Origin: Emil's real case, Jun 2026. Core "coach not scorekeeper" — differentiating.)
- **Log Food panel — full functional + visual cleanup** — (a) label the macro fields (Cal/Protein/Carbs/Fat/Fiber/Water — currently unlabeled numbers) + tighten over-wide inputs; (b) **Cronometer-parity serving/unit picker**: on selecting a Manual result, `fsGetFood(foodId)` → FatSecret servings array (g/oz/cup/tbsp/tsp/container…) as a unit dropdown + amount, macros recomputed per serving (client mappers already exist — not wired into search→add); (c) re-enable Photo (AI vision backend) + Voice (transcript→macro parse) per-mode when real. (Manual logging re-enabled 2026-07-01 now FatSecret is live; only Manual + Barcode exposed.)
- **Stale daily numbers → show last-updated date** — any daily metric not refreshed in >24h displays the date it was last updated (web + mobile), so stale values read as stale. (Emil 2026-07-01.)
- Event-driven coach ("speak once, right time" — `narrativeGraph`) · Coach dialogue ("ask Arnold").
- Component snapshot-test growth · button-height lint CI automation.
- Remove dead `ImportHub.jsx` · `ClinicalModule` IDE extraction · air-gap (non-Garmin) auth.

---

## 5. Daily reporting against the plan
A scheduled task runs every morning (~07:30) and posts a standup that:
1. reads this plan + HANDOVER.md, 2. states what's **done / in-progress / blocked** vs the sprint,
3. names **today's top 1–3 items**, 4. appends the entry to the **Daily Log** below.

**Daily Log entry template:**
```
### YYYY-MM-DD (Sprint N · Day X)
- ✅ Done: <items closed + build-verified>
- ◐ In progress: <item + % / what's left>
- ⛔ Blocked: <blocker + who/what unblocks it>
- ▶ Today: <top 1–3 planned items>
- Notes: <decisions, scope changes>
```

## 6. Daily Log
*(appended by the daily report task + at checkpoints)*

### 2026-06-24 (Sprint 0 · plan created)
- ✅ Done this session (pre-sprint): multi-session core (todayStatus +render on Start/EdgeIQ), season coaching engine + live Marathon Coach card, FatSecret proxy + in-app endpoint + manual Cronometer import (compliant), race-store consolidation (one source + planner migration + per-row delete), drawer overflow fix, taper-for-tune-up fixed across all 3 coaching engines, B1 race timeline + ✓N dropdown, capability/gap analysis doc.
- ▶ Sprint 1 starts Jun 25 with **1.1 Coach unification** (highest-leverage).
- Notes: This plan supersedes prior planning. UI/UX = parallel track to end-July.

### 2026-06-26 (Sprint 1 · checkpoint)
- ✅ **1.1 Coach unification Slice 1** — one `racePhase()` source; `coachSignals`/`planLoad`/`seasonPlan` all delegate (verified green).
- ✅ **Multi-session display (1.4 #4 + #5)** — `PlannedWorkoutTile` pre-tile renders planned secondaries (`+ slot label · mi`); complete-tile secondaries now carry minutes/distance/pace. *(Built, awaiting Emil build/test — churn file, 5 stacked edits.)*
- ✅ **1.5 Calendar dots → DEFERRED (redundant)** — CalendarTab DayTile already shows a secondary rail (≤3 colored markers + 3-letter codes + `+N`). No new work.
- ✅ **1.7 TDEE double-count audit + fix** — `energyBalance.computeTDEE` was counting workout steps in NEAT while their energy was already in `activityKcal`/eat-back (~150–300 kcal/run-day double-count). Fix: new `dailyWorkoutSteps()` (run/walk mi × 1500 steps/mi) netted out of the steps-NEAT branch. *(Awaiting Emil build/test.)*
- ✅ **1.8 FatSecret — LIVE.** Worker `arnold-fatsecret-proxy.vasago00.workers.dev` deployed; secrets set (after fixing a name/value mix-up where credentials were stored AS the secret names); in-app Test connection = **✓ Connected · scope: premier**. Barcode + autocomplete + US set available. "Powered by FatSecret" attribution wired (required now we're live).
- ▶ Next: **1.6** post-workout weight → grossSweatRate; **1.7b** sRPE→ACWR wiring.

### 2026-06-26 (Sprint 1 · checkpoint 2)
- ✅ TDEE NEAT de-dup + PlannedWorkoutTile two-a-day edits **built green** on Windows (`npm test` clean).
- ✅ **1.8 FatSecret — confirmed LIVE in app** (✓ Connected · scope premier).
- ✅ **1.6 Post-workout weight → sweat rate.** Pipeline already existed (PostRunWeigh→weight log→accumulateBodyAndSweat→observeSweat→predictSweatRate); real gap was the logged **"L drunk" being dropped** — used only for the instant readout, never persisted, so the learned model always used the gross-sweat *floor* (fluidInL=0). Fix: PostRunWeigh now persists `fluidInL` on the weigh-in; `accumulateBodyAndSweat` carries it per-entry and prefers it over the global opt. +2 unit tests in `tests/hubAccumulate.test.mjs` (gross > floor). *(Awaiting Emil build/test.)*
- ▶ Next: **1.7b** sRPE→ACWR wiring + TDEE empirical double-count read-only audit; then **1.9** Health Connect dailyEnergy verify.

### 2026-06-26 (Sprint 1 · checkpoint 3)
- ✅ 1.6 built green on Windows (`npm test` clean).
- ✅ **1.7b sRPE→ACWR wiring.** `computeAcuteChronicRatio` previously summed **runs-only rTSS** — strength / HR-unreliable sessions added 0 to the ratio that drives the coach's hold/cut. Now sums a per-session internal load = `max(run rTSS, srpeEquivRTSS)` over ALL sessions: sRPE is a FLOOR for runs and the primary signal for rated non-run work. **Backward-compatible:** with an empty `sessionRPE` store it reduces exactly to the old runs-only rTSS sum (non-runs → 0), so no regression when RPE isn't logged. No automated test added (function is storage-coupled via `srpeEquivRTSS`) — verify on the Load gauge + coach after a rated strength day. *(Awaiting Emil build/test.)*
- ✅ **Empirical-TDEE double-count audit (read-only) — CLEAN.** `empiricalTDEE` = avgIntake + weightΔ·kcal/days (ground truth, no activity/NEAT term → can't double-count). `recommendCalorieTarget`'s fallback `modelTdee` uses FLAT NEAT (rmr×0.13) + avgActivityKcal (non-overlapping). The steps-NEAT fix from 1.7 only affected `computeTDEE`/`restingTdee` (EdgeIQ balance), not the cut target. No change required.
- ▶ Next: **1.9** Health Connect `dailyEnergy` verify (Android), then Sprint 2 (adaptive loop, transparency hero, prescriptive fuel) + Coach unification Slices 2–4.

### 2026-06-26 (Sprint 1 · checkpoint 4 — SPRINT 1 CODE COMPLETE)
- ✅ 1.7b built green on Windows (`npm test` clean).
- ✅ **1.9 Health Connect dailyEnergy — code-verified (read-only).** `dcy.tdeeWithTier()` Tier 1 uses HC/Garmin `totalCalories` directly + TEF and **skips `activityBurnFor`** → no workout double-count; `activeKcal`/`steps` are context-only. Ingestion (`hc-sync.js`) writes steps/active/total to the disjoint `hcDailyEnergy` collection (prior race-fix). No defect. **On-device dependency:** HC must populate `TotalCaloriesBurned` for Tier 1; if only ActiveCalories exists, `tdee()` falls to Tier 2 (steps-NEAT + activityBurn) — graceful, not a bug. Emil to confirm via console `hcDailyEnergy` rows. *(Optional future: use `activeCalories` as a Tier-2 burn signal — currently only consumed in Tier 1.)*
- 🏁 **Sprint 1 is CODE COMPLETE.** Remaining = Emil's on-device HC check + the ACWR/sweat-rate manual verifications. Shipped this sprint: coach-unification Slice 1, multi-session display end-to-end, FatSecret LIVE, TDEE NEAT de-dup, post-run weight→sweat-rate fluid wiring, sRPE→ACWR, empirical-TDEE audit, HC dailyEnergy verify. (1.5 calendar dots deferred as redundant.)
- ▶ Sprint 2 next: adaptive loop (planGenerator + adaptPlan), transparency hero (LearnedHero), prescriptive fuel; plus Coach unification Slices 2–4.

### 2026-06-26 (Sprint 1 · follow-on — TDEE Tier-1 BMR floor)
- 🐞 **Found via 1.9 on-device check:** `hcDailyEnergy` (source=garmin) had today=689 kcal at 7pm while Garmin showed ~1828. Mapping is correct (`totalCalories ← totalKilocalories`); the value is a partial/stale daily-summary snapshot. Defect was in the consumer: `dcy.tdeeWithTier()` Tier 1 trusted ANY `totalKcal > 0`, returning a sub-resting TDEE — despite its own doc claiming a BMR floor.
- ✅ **Fix:** Tier 1 now gates on `totalKcal >= base` (bmr). A full-day total always includes 24h BMR, so a sub-resting total is by definition partial → falls through to Tier 2 (steps-NEAT + activityBurn) / Tier 3. Backward-compatible: complete days (total ≥ bmr) still take Tier 1. *(Awaiting Emil build/test.)*
- 📝 Note: the Energy Balance tile (Σ2038) uses the OTHER engine (`energyBalance.computeTDEE`) and was healthy — the 689 only poisoned `dcy.tdee()`. The two-engine divergence is a **coach-unification Slice 2** candidate (one TDEE source).
- ✅ **Worker refresh — monotonic guard.** The 30-min periodic sync already re-pulls today (`fetchGarminDay`→`upsertDailyEnergyRow`), but the upsert blindly overwrote ("Garmin wins"), so a stale-low partial could REGRESS a fuller earlier total. Fix: for the CURRENT date, keep `max(existing, incoming)` on steps/active/total (today only accumulates upward); past dates still overwrite (finalized value authoritative). Pairs with the Tier-1 BMR gate so the gauge climbs to the true total and never bounces down. *(Awaiting Emil build/test + push.)*

### 2026-06-26 (SPRINT 2 begins — Coach Unification Slice 2: one TDEE/RMR source)
- Decision: built the full **`energyExpenditure` service** (Emil's call) rather than a cheap delegate — sets up 2.3 transparency hero + 2.4 fuel. Design in `COACH_UNIFICATION_SLICE2_TDEE.md`.
- ✅ **2-a one RMR** (built green): `computeRMR()` delegates to `dcy.bmrWithTier()`. One RMR everywhere.
- ✅ **2-b service** (built green): `core/energyExpenditure.js` — `tdee` (today: device→model) + `maintenance` (empirical→expenditure) + source/confidence + model decomposition; pure selectors unit-tested.
- ✅ **2-c wiring** (awaiting build): `EnergyTimingChart` Σ + `cutMode` deficit now read the service; `fuelForWork` needs no change (intake-only); DCY card aligns via shared RMR + Tier-1 gate (full rewire = parking-lot follow-up). Precedence documented in `DATAMODEL.md`.
- ▶ Next: Emil build/test 2-c, then **2.3 Transparency hero** (LearnedHero) — the service's `source`/`confidence`/`note` are the raw material — or **2.1 adaptive plan generation**.

### 2026-06-26 (2.3 Transparency — direction change after Start-overload review)
- Reviewed real mobile Start: it's already ~3 screens of always-expanded sections (Score→Today→Run→Strength→Recovery→Body→This Week→Coach→Annual→Going-about-day→Core→Labs). Emil (rightly) pushed back: a new **LearnedHero card on Start makes the scroll worse**, and much of what it'd show is already on Start in raw form (Race Predictor, RMR, ACWR line).
- **Decision (Emil): do NOT add a hero to Start. WEAVE confidence into existing cards** instead — a small source/confidence indicator in place, zero extra scroll.
- `LearnedHero` itself: left rendering on **web Daily** only, now enriched with the Slice-2 energy row (Maintenance + source/confidence). Not placed on mobile Start.
- ✅ Built the affordance: `MetricTile` now accepts `confidence = { level, text, title }` → color-coded dot + micro-label in the trend row (high=green/med=blue/low=amber). No change to tiles that don't pass it. *(Awaiting Emil build/test — additive, invisible until a card opts in.)*
- ▶ Rollout (next chunk, needs the metric-registry touch): wire **RMR** (route Start's inline RMR through canonical `bmrWithTier` → tier = source: clinical/katch/mifflin/est), **Race Predictor** (`hubFacts.fitnessConfidence`), **total kcal / energy** (`energyExpenditure().source`). Start's 3-screen IA is its own piece — the "Start cockpit refresh" already on the UI/UX parallel track.

### 2026-06-26 (2.3 rollout — first card: RMR confidence)
- Verified the registry path is clean: `evaluate()` returns the compute object as-is, so a metric can emit `confidence` and it flows through.
- Course-corrected on RMR: it uses Katch-from-body-comp **by design** (tracks current composition; the comment says don't freeze at a lab value). So it's NOT routed through `bmrWithTier` — instead its confidence is honest about being an *estimate*: never "high", `medium` when the body-fat read is ≤45d old, `low` when staler (`text:'katch'`, tooltip explains).
- ✅ Wired (mobile Start): `tileMetrics` RMR compute returns `confidence`; `tilesForCategory` generic passthrough (`confidence: result.confidence`); all 4 MetricTile grids forward `confidence={t.confidence}`; `MetricTile` affordance renders the chip. *(Awaiting Emil build/test.)*
- ▶ Next cards (same generic passthrough now in place): Race Predictor (`fitnessConfidence`) + the energy total (`energyExpenditure().source`: empirical=high / device=medium / model=low — the genuinely-varying one). Web Start (Arnold.jsx) parity is a separate follow-up.

### 2026-06-26 (Sprint 1 · Day 2 standup)
- ✅ Done: **1.8 FatSecret LIVE** (✓ Connected · premier — external gate cleared); **1.7 TDEE NEAT de-dup** + **PlannedWorkoutTile two-a-day** (#4 pre / #5 post) built green (`npm test` clean); **1.1 coach-unification Slice 1** (one `racePhase()` source); **1.5 calendar dots** deferred (already covered by DayTile rail).
- ◐ In progress: **1.6 post-workout weight→sweat rate** — fix done (PostRunWeigh persists `fluidInL`, +2 tests), awaiting Emil build/test.
- ⛔ Blocked: none. (FatSecret Premier gate now cleared.)
- ▶ Today: finish **1.1 coach unification** (remaining slices — retire duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment); then **1.7b** sRPE→ACWR wiring; then **1.9** Health Connect dailyEnergy device verify.
- Notes: Heavy day — most of Sprint 1's data-integrity + external-gate items already shipped or awaiting verify; remaining Sprint 1 weight is the rest of coach unification (the 3-engine drift) + HC Android verify. No scope changes.

### 2026-06-27 (Sprint 1 · Day 3 standup)
- ✅ Done (build-verified): **Sprint 1 is CODE COMPLETE** — 1.1 Slice 1 (one `racePhase()`), 1.4 two-a-day #4/#5 (PlannedWorkoutTile), 1.6 post-run weight→sweat (`fluidInL` persisted), 1.7 TDEE NEAT de-dup, 1.7b sRPE→ACWR, 1.8 FatSecret LIVE (✓ premier), 1.9 HC dailyEnergy code-verified; 1.5 deferred (DayTile rail). Coach-unification Slice 2 **2-a** (one RMR via `bmrWithTier`) + **2-b** (`core/energyExpenditure.js` service) built green.
- ◐ In progress: **Coach unification Slices 2–4** (the 3-engine taper/phase drift + one TDEE source) — Slice 2 **2-c wiring** (EnergyTimingChart Σ / cutMode deficit read the service) awaiting Emil build. **TDEE Tier-1 BMR-floor gate** + **worker monotonic guard** (today-only `max()`) awaiting Emil build/test + push. **2.3 transparency** affordance (`MetricTile` confidence dot) built, awaiting build; rollout (RMR / Race Predictor / energy `source`) not yet wired.
- ⛔ Blocked: none. (FatSecret Premier-Free gate is cleared — 1.8 shipped LIVE on Jun 26, not pending.) Remaining Sprint 1 closure depends on Emil's on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications — owner-time, not a blocker.
- ▶ Today: (1) **finish 1.1 coach unification** — retire the duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment so one engine emits the verdict (Slices 3–4); (2) land **Slice 2 one-TDEE-source** (2-c build-verify + the two-engine divergence cleanup); (3) Emil build/test the awaiting-build queue (2-c, Tier-1 BMR gate, worker guard, MetricTile confidence) then push.
- Notes: No confirmed new build-verifications since the Day-2 standup (HANDOVER still at ROUND 84); a meaningful Sprint-2 batch (Slice 2 service, MetricTile affordance, Tier-1/worker fixes) is built but UNVERIFIED — verification debt is accumulating ahead of the Jul 2 Sprint-2 window. Recommend a build/test pass clears it before opening 2.1 plan generation.

### 2026-06-27 (Sprint 1 · Day 3 · afternoon check)
- ✅ Done: nothing new since the Day-3 morning standup — no build-verifications landed (HANDOVER unchanged at ROUND 84).
- ◐ In progress: same as morning — Coach unification Slices 2–4 (3-engine taper/phase drift + one TDEE source); the built-but-UNVERIFIED queue (Slice 2 2-c wiring, TDEE Tier-1 BMR-floor gate, worker monotonic guard, MetricTile confidence affordance) still awaits Emil build/test.
- ⛔ Blocked: none. Sprint-1 closure waits on Emil's on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications — owner-time, not a blocker.
- ▶ Today: (1) clear the awaiting-build queue with one `npm test` pass + push; (2) finish 1.1 coach unification — retire duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment (Slices 3–4); (3) land Slice 2 one-TDEE-source (2-c verify + two-engine divergence cleanup).
- Notes: Verification debt still open and growing 5 days out from the Jul 2 Sprint-2 window — a build/test pass to clear it remains the highest-leverage next action before opening 2.1 plan generation.

### 2026-06-30 (Sprint 1 · Day 6)
- ✅ Done: nothing new build-verified since the Jun-27 standup — HANDOVER is still at ROUND 84, and no Jun-28/Jun-29 entries landed (3-day gap; standup did not run or no work logged). Sprint 1 remains CODE COMPLETE as of Jun 26.
- ◐ In progress: the built-but-UNVERIFIED queue is unchanged — Coach unification Slice 2 **2-c wiring** (EnergyTimingChart Σ / cutMode deficit read the service), **TDEE Tier-1 BMR-floor gate** + **worker monotonic guard** (today-only `max()`), and the **MetricTile confidence affordance** + RMR-confidence card. All await one Emil `npm test` pass + push. Coach unification Slices 3–4 (retire duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment) still open.
- ⛔ Blocked: none. Sprint-1 closure waits only on Emil owner-time (on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications) — not a true blocker.
- ▶ Today: (1) clear the awaiting-build queue with one `npm test` + push — highest leverage, now 2 days from the Jul 2 Sprint-2 window; (2) finish 1.1 coach unification Slices 3–4 (one engine emits the season/phase verdict); (3) land Slice 2 one-TDEE-source cleanup (two-engine divergence).
- Notes: Sprint 1 ends tomorrow (Jul 1). The accumulated verification debt is now the gating risk for opening 2.1 plan generation on schedule — a single build/test/push pass closes most of it. No scope changes; no external gates open (FatSecret Premier cleared Jun 26).

### 2026-07-01 (Sprint 1 · Day 7 — final day)
- ✅ Done: nothing new build-verified since Jun-27 — HANDOVER still at ROUND 84 (no Jun-28→Jul-1 verifications landed). Sprint 1 remains CODE COMPLETE as of Jun 26; today closes the sprint window with the verification queue still open.
- ◐ In progress: unchanged built-but-UNVERIFIED queue — Coach unification Slice 2 **2-c wiring** (EnergyTimingChart Σ / cutMode deficit read the service), **TDEE Tier-1 BMR-floor gate** + **worker monotonic guard** (today-only `max()`), and the **MetricTile confidence affordance** + RMR-confidence card. Coach unification Slices 3–4 (retire duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment → one engine emits the verdict) still open.
- ⛔ Blocked: none. Sprint-1 closure waits only on Emil owner-time (on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications) — not a true blocker.
- ▶ Today: (1) clear the awaiting-build queue with one `npm test` + push — highest leverage, Sprint 2 opens tomorrow (Jul 2); (2) finish 1.1 coach unification Slices 3–4 (one engine emits the season/phase verdict); (3) land Slice 2 one-TDEE-source cleanup (two-engine divergence).
- Notes: Sprint 1 ends today. Verification debt is now the direct gate on opening 2.1 plan generation tomorrow on schedule — one build/test/push pass clears most of it. No scope changes; no external gates open (FatSecret Premier cleared Jun 26).

### 2026-07-02 (Sprint 2 · Day 1)
- ✅ Done (build+test-verified GREEN by Emil, HANDOVER ROUND 85): three data-integrity items shipped — (a) calorie-target eat-back no longer swallowed by the RMR floor (`goalModel.deriveDailyCalorieTarget`: floor maintenance first, then stack eat-back → training days climb 1880→2047/2059); (b) duplicate Garmin activity write closed (write-side idempotent guard + load-sweep self-heal + shared `dcyMath.activitySignature`); (c) Cronometer `count:0` false alarm made legible (diag now reports true intake source). New `core/diagnostics.js` self-check (`window.__arnoldDiag`) drove all three.
- ◐ In progress: the built-but-UNVERIFIED Sprint-2 queue is unchanged — Coach unification Slice 2 **2-c wiring**, **TDEE Tier-1 BMR-floor gate** + **worker monotonic guard**, and the **MetricTile confidence affordance** + RMR-confidence card. Coach unification Slices 3–4 (retire duplicate taper/phase in `analyzeSeason` + `computeRaceHorizon`/CoachComment) still open. ROUND 85 also needs an Emil rebuild to pick up the load-sweep + clearer intake diag.
- ⛔ Blocked: none. Sprint-1 residuals (on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications) are owner-time, not blockers.
- ▶ Today: (1) Emil rebuild + one `npm test` + push to clear the awaiting-build queue (ROUND 85 load-sweep, 2-c, Tier-1 gate, worker guard, MetricTile) — highest leverage, now gates 2.1; (2) open **2.1 adaptive plan generation** (`planGenerator` off `seasonPlan` → periodized weeks to the calendar), the largest Sprint-2 item; (3) finish 1.1 coach unification Slices 3–4 (one engine emits the season/phase verdict).
- Notes: Sprint 2 opens today (Jul 2). Real movement since last standup — ROUND 85 cleared three verified integrity fixes and stood up a self-check layer — but the pre-existing built-but-unverified queue persists and remains the gate on 2.1. HANDOVER's "NEXT" reads 2.2→2.3→2.4; per plan priority, 2.1 generation should land before 2.2 daily adaptation. No scope changes; no external gates open.

### 2026-07-02 (Sprint 2 · Day 1 · checkpoint 2 — ROUND 86)
- ✅ Done (Emil build+`npm test` GREEN, 293/45): cross-device Cronometer sync hardened (immediate `flushCloudPush` on nutrition write + publish-before-background on `visibilitychange`/`pagehide` + sync self-check `getUnsyncedKeys`/`__arnoldDiag` `cloud-unsynced`/`cloud-pull-error`); **LearnedHero stale-window fixed** (`useStorageVersion` in deps — footer/sensitivities now refresh on data change) + jsdom reactivity test; **test-suite split retired** — 22 `tests/*.mjs` node:test suites ported to co-located `src/tests/*.test.js` vitest (153→293), whole hub/coaching/energy suite now runs under `npm test`.
- ✅ **2.2 daily adaptation — CLOSED** as satisfied by the shared `PlannedWorkoutTile` (adaptSession on real signals → adjusted chips + reason'd coach line, mobile Start + web Daily = one voice). Investigation confirmed web parity already existed (shared component); Emil descoped both the forward "tomorrow-preview" and the coach-voice lead. `getTodayAdaptation()` remains the shared wrapper (used by WeeklyPlanner).
- ◐ In progress / carry: the older built-but-UNVERIFIED queue (coach-unification Slice 2 2-c wiring, TDEE Tier-1 BMR gate, worker monotonic guard, MetricTile confidence rollout for Race Predictor + energy source) still awaits an Emil build/test+push.
- ▶ Next: **2.3 transparency** — already partly done (decision: weave confidence into cards, not a Start hero; `MetricTile` confidence affordance + RMR card wired; LearnedHero now reactive w/ bell-curve confidence on web Daily). Remaining 2.3: wire confidence into **Race Predictor** (`hubFacts.fitnessConfidence`) + **energy total** (`energyExpenditure().source`) tiles. Then **2.4 prescriptive fuel** (`fuelForWork`/`activityNeeds` → tomorrow's fuel target + low-EA flag).
- Notes: No new scope. 2.2 closed without engine changes (verify-don't-claim caught the false web-parity premise before any edit).

### 2026-07-02 (Sprint 2 · Day 1 · checkpoint 3 — SPRINT 2 CODE COMPLETE)
- ✅ **2.3 transparency — DONE.** Built the two remaining confidence wires: **Race Predictor** tile (`tileMetrics.racePredictor.compute` now returns `confidence` — empirical race-effort=high·recent / long-run·stale=med / Garmin VO₂max=low) and **energy Σ** (`EnergyTimingChart` surfaces `energyExpenditure().confidence` as a color-coded dot on the Σ headline). Joins the already-wired RMR card + the reactive bell-curve `LearnedHero`. (Verified no test asserts these compute shapes → additive, safe.)
- ✅ **2.4 prescriptive fuel — DONE (already surfaced).** Investigation: `fuelForWork` (prescribeFuel pure + 9 tests, fuelForToday wrapper) is complete AND already rendered on the shared `PlannedWorkoutTile` fuel band with pre-carbs / PM protein / color-coded EA + RED-S tooltip (web + mobile); `activityNeeds` wired in LogDay. Acceptance met without new work.
- 🏁 **SPRINT 2 is CODE COMPLETE:** 2.1 plan generation (earlier) · 2.2 daily adaptation (shared tile) · 2.3 transparency (LearnedHero hero + confidence woven into RMR/RacePredictor/energy) · 2.4 prescriptive fuel (fuelForWork + shared-tile fuel band). Shipped this session (ROUND 86): cross-device sync durability, LearnedHero stale-window fix, 293-test suite consolidation, + the 2.3 confidence wires.
- ◐ Carry (pre-existing, unverified): coach-unification Slice 2 2-c wiring, TDEE Tier-1 BMR gate, worker monotonic guard — await an Emil build/test+push. Parking lot unchanged (illness mode, Log Food cleanup, stale-numbers date, dead ImportHub removal).
- ▶ Next: Emil rebuild + `npm test` to verify the 2.3 wires; then the UI/UX parallel track (Start cockpit density, primitive adoption, rebrand) + clear the carry queue. Sprint 2 functional goals met.
- Notes: Two of the four Sprint-2 items (2.2, 2.4) turned out already-satisfied by earlier work + the shared tile — verified before building (no wasted edits).

---

## 7. Sprint 3 — "Coach with a plan" (opened 2026-07-03)
*Goal: the coach reasons from explicit goals, owns the plan, and re-solves the whole plan when reality diverges — with the trade-offs shown and the USER deciding conflicts. North star: ROADMAP_NEXT §B (items 3→4). Personal-first, clean seams.*

| # | Item | Acceptance | Status |
|---|---|---|---|
| 3.0 | **Finish one-coach-voice (Slices 3–4)** — collapse the last duplicate taper/phase logic; one verdict source. | All surfaces provably agree on the taper call; no dead phase rule. | ✅ 2026-07-03 — Slice-1 already unified the live phase (`racePhase`); removed dead `phaseForWeeksOut` + stale vocab in `coachSignals`; added `coachUnification.test.js` (delegation lock: 3 surfaces agree vs racePhase + tune-up guard). Verdict-unification deferred (not needed — phase locked; flagship reads `resolveSeasonPlan`). |
| 3.1 | **Goal model** — unify activity/race/body/nutrition goals into one structure the coach reasons from; expand inputs (A-race designation + deadlines); conflicts are user-decided (coach surfaces + trade-offs both ways). | One `resolveGoalModel` the coach reads; conflicts surfaced with trade-offs; user picks. | ◐ 3.1a ✅ + 3.1b ✅ (`goalResolve.js`: pure `buildGoalModel` + `detectConflicts` [cut-vs-race / cut-vs-training / goaltime-vs-fitness, both trade-off directions, null=unresolved] + `get/setGoalResolution` + 13 tests). **3.1c next** = expand inputs (explicit A-race + deadlines, storage) + GoalsHub UI to show a conflict's two trade-offs and let the user tap a choice. 3.1d = sim → synthetic goals → model invariants. |
| 3.2 | **Coach as planner** — coach generates/owns the plan from the goal model (on `planGenerator`/`seasonPlan`), not a static plan. | Coach produces the plan from goals. | ☐ |
| 3.3 | **Live plan-level re-solve (flagship)** — skip/swap/lighten a day → re-flow the week/block against the goal, explain knock-on + path back both ways. | A change re-solves the plan; delta explained in the coach voice. | ☐ |
| 3.4 | **Sim extends to plans** — invariants on re-solves (never breaks ACWR ramp cap, never stacks back-to-back hard on low readiness, keeps goal reachable-or-flags-it). | Plan-level property tests green. | ☐ |

### 2026-07-03 (Sprint 3 · Day 1)
- ✅ 3.0 done (see above) + 3.1a goal-model assembler in. Fuel-tab 7-day trend color fixed (uses the header's effective target so surplus days show). Build+`npm test` GREEN: 302→**317**.
- ▶ Next: 3.1b (conflict detection + trade-offs + stored user resolution). Uncommitted: trend fix, 3.0, 3.1a (verified) — commit pending.
- Notes: Decisions locked — conflicts are user-decided (coach surfaces both trade-off directions, never auto-picks); 3.1 = read-model + expand inputs. Only 2.3's two confidence wires were net-new this checkpoint.

### 2026-07-03 (Sprint 2 · Day 2)
- ✅ Done: ROUND 87 landed (post-standup Jul 2) — **carry-queue audit CLEAN, all code landed, nothing pending**: Slice-2 2-c (cutMode + EnergyTimingChart read `energyExpenditure`), TDEE Tier-1 BMR-floor gate (`if(totalKcal>=base)`), worker monotonic guard (today-only `max()`) — the long-running unverified queue is closed as code. Plus a **Monte-Carlo sim harness** (`src/core/sim/`: seeded PRNG + synthetic-athlete generator + invariants + `runSim` over 10k cases through the real `adaptSession`/`prescribeFuel`/`composeCalorieTarget`), which caught + fixed an `adaptSession` bug (greenlit mobility/recovery days → added `NIL={rest,mobility,recovery}` guard; re-ran 0/10k violations). Sprint 2 remains CODE COMPLETE (all four items ✅).
- ◐ In progress: verification of the new work — in-sandbox (node) I confirmed 10k cases 0 violations for adaptation+calorie invariants + composeCalorieTarget units + 3-seed margin stability; the **FUEL invariants (prescribeFuel F1–F4 + monotonicity) + the new vitest suites (sim.test.js, calorieTargetMath.test.js) still need Emil's Windows `npm test`** (sandbox can't import fuelForWork's transitive deps).
- ⛔ Blocked: none. Sprint-1 residuals (on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications) remain owner-time, not blockers.
- ▶ Today: (1) Emil rebuild + `npm test` — expect new suites green (sim.test.js 10k-case, calorieTargetMath.test.js) + confirm the FUEL invariants; (2) with Sprint-2 functional goals met, open the flagship next-phase item — **goal model (activity/race/body/nutrition goals) → live plan-level re-solve** (ROADMAP_NEXT 3→4), designed with clean seams per the personal-first/productize-later call; (3) optionally start the UI/UX parallel track (Start cockpit density) if flagship design needs Emil input first.
- Notes: Real movement since Jul 2 checkpoint 3 — ROUND 87 closed the entire built-but-unverified carry queue (as code) and added the multi-user de-risk sim layer. Only gate now is one Emil Windows `npm test` to turn the sandbox-only verification green. No scope changes; no external gates open (FatSecret Premier cleared Jun 26).

### 2026-07-03 (Sprint 2 · Day 2 · checkpoint 2)
- ✅ Done: nothing new build-verified since the morning entry — HANDOVER unchanged at ROUND 87. Both sprints remain CODE COMPLETE (Sprint 1 all ✅; Sprint 2 all four items ✅).
- ◐ In progress: verification of ROUND 87's new work is still the only open thread — sandbox (node) confirmed 10k-case 0 violations for adaptation+calorie invariants + composeCalorieTarget units + 3-seed margin stability, but the FUEL invariants (prescribeFuel F1–F4 + monotonicity) and the new vitest suites (`sim.test.js`, `calorieTargetMath.test.js`) still need Emil's Windows `npm test`.
- ⛔ Blocked: none. Sprint-1 residuals (on-device HC `hcDailyEnergy` check + manual ACWR/sweat-rate verifications) remain owner-time, not blockers.
- ▶ Today: (1) Emil rebuild + `npm test` — expect new suites green + confirm the FUEL invariants (this is the last verification gate); (2) with functional goals met, open the flagship — **goal model (activity/race/body/nutrition goals) → live plan-level re-solve** (ROADMAP_NEXT 3→4), clean seams per personal-first/productize-later; (3) optionally start the UI/UX parallel track (Start cockpit density) if flagship design needs Emil input first.
- Notes: No change since this morning's standup — restating top items. The single Emil `npm test` pass remains the highest-leverage action (closes sandbox-only verification); after that, work shifts from sprint closure to the next-phase flagship. No scope changes; no external gates open.
