# The Coaching Team — panel of experts, one voice

> Status: **VISION / DESIGN** (2026-06-01). Not yet built. This is the
> product's soul. Builds ON TOP OF the v2.6 narrative layer (COACH.md) and the
> Plan Generator (PLAN_GENERATOR.md). Read those first — this doc is the layer
> that turns their outputs into expert guidance.

## The vision (user's words)
A professional team of coaches advising Emil — a **run coach**, a **strength
coach**, a **mobility coach**, a **nutritionist**, and a **logistics coach**
(triage when life compresses training: "no time today — what do I cut?") —
who debate among themselves but speak to the athlete as **ONE voice, one
team**. Built on Arnold's edge: more personal metrics than anyone else, fresh
data daily. Grounded in the knowledge of the best run & strength coaches, past
and present. The athlete is **advised and guided, but always in control.**

## Core principle: ADVISE, never override
Every output is a recommendation the athlete can accept, modify, or reject.
The team explains its reasoning and the trade-offs; the human decides. No
silent auto-changes to the plan. "Always in control" is a hard constraint, not
a tone.

## Architecture: experts → arbiter → one voice
Three layers. The bottom already exists; the middle and top are the build.

1. **DOMAIN EXPERTS (specialist reasoners).** One module per coach. Each reads
   the relevant slice of Arnold's data + the Plan Generator's prescription and
   produces a domain recommendation WITH reasoning, confidence, and the
   trade-offs it's weighing.
   - **Run coach** — volume, pace zones, workout structure, polarization,
     fatigue exponent, race-specific sessions. Owns the Plan Generator output.
   - **Strength coach** — lifts, tonnage, frequency, how strength supports (not
     steals from) the run block; deload timing.
   - **Mobility coach** — movement quality, injury-risk flags, prehab,
     decoupling/form trends.
   - **Nutritionist** — fueling for the day's session, cut/surplus state,
     glycogen, protein, race-week carb load, IF window. (Reuses cutMode,
     energyAvailability, glycogen, prefuel, IF.)
   - **Logistics coach** — the triage layer. When readiness, time, or life
     constrains the day, decides what to keep / cut / move and protects the
     week's key sessions. "Only 30 min today" → the team's compromise.

2. **THE ARBITER (the head coach).** Experts conflict by design — the
   nutritionist wants a deficit, the run coach wants glycogen for tomorrow's
   long run; the strength coach wants legs fresh, the run coach wants a
   tempo. The arbiter resolves conflicts against the CURRENT priority (the
   race goal + phase from the Plan Generator), produces ONE coherent plan,
   and surfaces the key trade-off it made so the athlete sees the reasoning.
   This is the v2.6 narrative composer, promoted: leverage point → connected
   threads across domains → the trade-off → ONE action → ONE metric to watch.

3. **ONE VOICE (presentation).** The athlete never sees five cards arguing.
   They see one briefing in the team's voice, with the option to "ask a
   specific coach" (drill into a domain's full reasoning) — the brief cards
   become the evidence/drill-down layer, exactly as v2.6 intends.

## Athlete's training philosophy (Emil — the default lens)
**Primary methodology: ~80% Zone 2 / aerobic-base training.** Emil is a
committed believer in high-volume easy/Z2 running and it has worked for him
historically (2× sub-3:47 marathons). This is the DEFAULT framework the run
coach plans within — heavy aerobic base, low-HR easy mileage, intensity kept
to the disciplined ~20%. Lineage: **Maffetone (MAF / low-HR aerobic base),
Lydiard (aerobic base), Seiler (polarized 80/20)** — all reinforce this.

**Openness clause (explicit user instruction):** Emil stays open to other
approaches, BUT only when the coach **presents the benefits, trade-offs, and
challenges every time** an alternative is proposed. The team may surface, e.g.,
"a threshold block here could buy X, but costs Y and risks Z" — never silently
switch philosophies. Honor the 80/20 default; pitch deviations with the full
ledger and let the athlete decide (ties to "always in control").

## The knowledge base (what makes the advice expert, not generic)
Encode the training philosophies of leading coaches as structured, attributed
methodology — NOT vibes. Lineage to draw on:
- **Maffetone** — MAF method, low-HR aerobic base, fat-adaptation. (Aligns
  with Emil's 80% Z2 default; the run coach's baseline.)
- **Hanson (Hanson Marathon Method)** — cumulative fatigue, moderate-long-run
  cap (~16 mi), high overall frequency.
- **Hal Higdon** — accessible, structured marathon plans (Novice→Advanced);
  good for clear week-by-week scaffolding the Plan Generator can mirror.
- **Daniels** — VDOT + zone definitions (already in tileMetrics), T-pace work.
- **Pfitzinger** — marathon periodization, threshold + medium-long runs.
- **Lydiard** — aerobic base, periodization into sharpening.
- **Seiler** — polarized 80/20 (Emil's core belief).
- **Canova** — race-pace specificity for peak phase.
- **Hudson** — adaptive running.
- Modern strength-for-endurance work.
Each expert cites which principle it's applying so guidance is explainable
("threshold emphasis now, per Daniels' T-pace zone, because…"). When two
philosophies disagree (e.g. Hanson's 16-mi long-run cap vs Pfitzinger's 20–22),
the coach presents the trade-off rather than picking silently.
Open question: how to represent this — rules/heuristics vs a curated knowledge
file vs LLM-with-citations. Likely a blend: structured rules for the math,
curated principles for the philosophy.

## Why Arnold can do this when others can't
The whole metrics stack we've built IS the differentiator: personal fatigue
exponent, LTHR (Arnold-native), ACWR/load, HS scores, cut mode, glycogen, IF,
decoupling/durability, daily readiness. The experts reason over the richest
per-athlete dataset available, refreshed daily — generic plans can't.

## Relationship to what exists / is planned
- **v2.6 narrative layer (COACH.md):** the substrate. Signals already declare
  `narrativeThreads` / `causalUpstream` / `causalDownstream`. The arbiter is
  the narrative composer generalized across domains. BUILD v2.6 FIRST.
- **Plan Generator (PLAN_GENERATOR.md):** the run coach's engine + the source
  of "current priority/phase" the arbiter resolves against.
- **Cut Mode / energyAvailability / glycogen / IF:** the nutritionist's inputs,
  already live.
- **ACWR / readiness / HS:** shared inputs for arbiter conflict-resolution.

## Build stages (incremental — years of runway, sequence matters)
1. **v2.6 narrative layer** — the substrate. (Already specced in COACH.md.)
2. **Plan Generator stages 1–2** — run coach has something to coach toward.
3. **Two experts + arbiter, narrow:** run + nutrition, arbitrated for ONE
   decision type (e.g. "today's session, given readiness + fuel"). Proves the
   experts→arbiter→one-voice loop end to end.
4. **Add experts:** strength, mobility, logistics.
5. **Knowledge base:** encode coach methodologies with attribution.
6. **Conversational ("ask a coach"):** v3 dialogue (COACH.md) — query a
   specific domain, get reasoned answers. Always advisory.

## Non-negotiables (carry into every stage)
- Advisory only; athlete approves changes. Never auto-mutate the plan.
- Every recommendation is explainable (which signal, which principle, what
  trade-off).
- One voice to the athlete; specialists available on demand.
- Reason over the athlete's OWN data first; published methodology is the lens,
  not a substitute for their numbers.
