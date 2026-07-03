# Coaching philosophy — established methodology + goal-backward planning

**Status:** north-star design. Created 2026-07-01. Origin: Emil. Supersedes the
"forward-from-current-fitness" generation approach in `PLAN_GENERATOR_SEASON_2.1.md` — the
engine (periodization, A-race, paste) stays; WHAT it optimizes for and HOW paces are
derived change here.

## Two aspects (Emil)
1. **Methodology at par — ADOPT known principles, then EVOLVE + personalize them.** (Corrected
   2026-07-01: not "don't invent" — that undersells Arnold.) The established science (Daniels
   VDOT + E/M/T/I/R paces, Maffetone aerobic base, standard periodization) is the grounded,
   validated **prior**. Arnold's daily-learned model — your real VDOT (Riegel + personal
   fatigue exponent), your easy-pace-at-HR efficiency, your heat/sleep/fuel sensitivities,
   your ACWR + recovery velocity — is the **evidence that updates it**. So the plan is grounded
   like the mainstream apps AND personal because it's built on your data, not a generic
   template. Textbook = the frame; the dial settings = yours. Retire the homegrown pace
   *offsets* / generic ramp; replace with (validated method × your learned model).
2. **Goal-backward + trade-offs.** Don't fit a plan to current fitness — build it BACKWARD
   from the goal, and let the live coach expose the **choices and their consequences** to the
   goal. *All roads are good; not all reach the goal.*

## Pillar 1 — Coaching Knowledge Base (`core/coaching/…`) = validated prior × learned model
Two layers: (a) the textbook encodings (the prior), and (b) a PERSONALIZATION layer that
bends them with Arnold's learned data. Every prescription = method(you).
- **Daniels VDOT:** race time ↔ VDOT ↔ training paces (E/M/T/I/R), full tables, cited.
  *Personalized:* VDOT seeded from your real races (Riegel + your fatigue exponent); paces
  then adjusted by your measured easy-pace-at-HR efficiency and your heat/sleep/fuel
  sensitivities (a hot, under-slept day ≠ the table value).
- **Periodization:** real marathon macro-cycle (Base → Build → Peak → Taper), standard
  mileage %s, long-run caps (~30–35% of week, ≤ ~20–22mi), quality-day rules.
  *Personalized:* the dial settings (ramp rate, quality density, taper depth) modulated by
  your ACWR, learned recovery velocity, and illness state.
- **Maffetone:** 180-age aerobic-HR ceiling as a *starting* option.
  *Personalized:* refined toward your true aerobic threshold from your HR–pace decoupling.
- ACWR (Gabbett) + ≤10%/wk safety rails stay as the injury guardrail on top.
Plan generation consumes THIS (method × learned model) instead of `pacesFromHubFacts` offsets.

## Pillar 2 — Goal-backward planner
Given `{ goalRace, goalTime, today, currentFitness }`:
- **Required fitness:** VDOT needed for the goal time (Pillar 1).
- **Required preparation:** the volume progression, long-run progression, and key-workout
  density that a runner needs to *hold* that VDOT over 26.2 — worked BACK from race day
  (taper → peak weeks → build → now).
- **Feasibility vs reality:** compare required trajectory to current fitness/volume. If the
  needed ramp exceeds the safe rail, say so plainly (extend timeline / lower goal / accept
  risk). Extends the existing `marathonFeasibility` (speed vs endurance limiter).
- Output: a plan whose SHAPE is dictated by the goal, not by "where you are × 1.1".

## Pillar 3 — Trade-off / what-if voice (the live coach)
The adaptability layer. A pure `goalImpact(deviation)` that, for any choice — miss a week
(sick), take a day off, cut a long run, drop volume — recomputes the goal trajectory and
returns the CONSEQUENCE, in the coach's voice:
- "Still on for sub-3:30 — but you've used your slack; no more missed weeks."
- "Sub-3:30 is now a stretch; realistic is ~3:36. Or move the goal to Valencia+2wk."
- "Take today off — costs ~nothing; you're ahead of the required curve this week."
Framed as choices, never judgment. Wired into the coach surfaces + shown when you edit the
plan / miss a session. This is where the Illness & Return-to-Training mode plugs in.

## Build sequence (design-first, cadence-sized)
- **P1 — Knowledge base** (Daniels VDOT + paces, periodization constants, Maffetone). Pure +
  tested. Repoint `planGenerator` paces to VDOT. *Immediate quality lift; Emil's aspect 1.*
- **P2 — Goal-backward planner** (required VDOT + trajectory + feasibility; generate backward
  from the goal). Extends `marathonFeasibility`.
- **P3 — `goalImpact` / what-if voice** + wire into the coach + Illness mode.

## Build log
- **2026-07-01 — P1 DONE (awaiting build):** `core/coaching/` — `vdot.js` (Daniels–Gilbert
  VDOT formula, exact; E/M/T/I/R paces; `raceTimeFromVdot`), `maffetone.js` (180-age),
  `periodization.js` (cited constants), `personalize.js` (× learned model — heat/sleep
  sensitivities slow aerobic paces, confidence-discounted). Wired `planGenerator.pacesFromHubFacts`
  to VDOT (paces = Daniels zones at YOUR fitness). `ZONE_PCT` tuned to Daniels' VDOT-50 table.
  Tests in `tests/coaching.test.mjs`. **VERIFY anchors (VDOT 50): E 8:51 · M 7:17 · T 6:51 ·
  I 6:10 · R 5:53 /mi** against a trusted Daniels calculator; T/I/R matched exactly on
  hand-check, E/M tuned. NEXT: P2 goal-backward, P3 goalImpact/what-if voice.

- **2026-07-01 — P1 evolve: OBSERVED easy pace leads (Emil: "your data leads, VDOT guards").**
  `core/coaching/observedPace.js` — `observedEasyPaceSecs(activities)` = median pace of YOUR
  recent aerobic runs (HR ≤ MAF cap when HR present, else slower-60% pace split). `pacesFromHubFacts`
  now prescribes easy = your observed pace (VDOT zone only as a guardrail: not faster than MP,
  not absurdly slower than E); long = between your easy + MP; quality (T/I) stays VDOT.
  `SeasonPlanGenerator` computes it from your activities + age and feeds it in. So the plan's
  easy pace is what YOUR body does (e.g. 9:40), not the table's 8:51 — and adapts as you log more.
  Tests: observedPace (HR split / pace-split / insufficient) + pace-layer blend. Needs Emil build/test.

## What exists to build on
Daniels VDOT lookup (`tileMetrics.js`), Riegel + personal fatigue exponent (`hub/raceFitness`,
`derive/tileMetrics`), `marathonFeasibility` / `goalPaceSecs` (`seasonPlan.js`), ACWR +
10%/wk rails (`trainingStress`, `seasonPlan`), the periodized generator + A-race
(`hub/planGenerator`). We are extending, not restarting.
