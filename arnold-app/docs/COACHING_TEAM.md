# The Coaching Team — panel of experts, one voice

> Status: **VISION / DESIGN** (2026-06-01). Not yet built. This is the
> product's soul — but it is the VOICE of a deeper core, not the core itself.
> Sits ON TOP OF the **Intelligence Hub** (INTELLIGENCE_HUB.md — the reasoning
> core; build that first), the v2.6 narrative layer (COACH.md), and the Plan
> Generator (PLAN_GENERATOR.md, which is itself a hub application, downstream).
> The experts here are the hub's sub-models given a voice; the arbiter reasons
> over the hub's whole state + confidence. Read INTELLIGENCE_HUB.md first.

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

2. **THE ARBITER (the head coach).** Experts conflict by design. The arbiter
   resolves conflicts, produces ONE coherent plan, and surfaces the key
   trade-off. It is the v2.6 narrative composer promoted to a decision-maker.
   See "## Arbiter — conflict resolution model" below for the actual logic.

3. **ONE VOICE (presentation).** The athlete never sees five cards arguing.
   They see one briefing in the team's voice, with the option to "ask a
   specific coach" (drill into a domain's full reasoning) — the brief cards
   become the evidence/drill-down layer, exactly as v2.6 intends.

## Arbiter — conflict resolution model (the hard part)
The arbiter is the real IP. Most "AI coaches" are thin here because they never
make the experts genuinely disagree and then resolve it transparently. Design:

### Each expert returns a structured RECOMMENDATION, not prose
So the arbiter can reason over it, every expert emits:
```
{ domain, action,                 // what it wants ("fuel +60g carbs tonight")
  rationale, principle,           // why + which methodology (cites knowledge base)
  urgency: 0..1,                  // how time-sensitive (today vs this week)
  confidence: 0..1,               // from the hub's confidence on its inputs
  protects: [goalThread...],      // which goal-threads this serves
  costs: [{thread, severity}],    // what it spends/risks
  flexibility: 0..1 }             // can it move/shrink without losing its point?
```

### Resolution is PHASE-PRIORITIZED, not fixed
There is no static ranking of domains — the priority order is a function of the
**current training phase** (from the Plan Generator / hub) and **proximity to a
key race or checkpoint**. The arbiter loads a priority vector per phase:
- **Base phase:** aerobic volume > strength > freshness > nutrition-cut.
  (Build the engine; a deficit that costs an easy run is fine.)
- **Build phase:** key quality session > volume > strength > cut.
- **Peak phase:** race-pace specificity + the key long run > everything;
  strength demotes to maintenance; no cut.
- **Race / checkpoint week:** FRESHNESS + fueling > all; intensity preserved
  but volume slashed; strength minimal; absolutely no deficit.
- **Recovery / post-race:** recovery > everything; suppress all push.
The same conflict (deficit vs glycogen) resolves OPPOSITE ways in base vs race
week — and that's correct. The phase vector is the arbiter's backbone.

### The resolution algorithm
1. **Hard constraints first (non-negotiable gates).** Injury-risk flags
   (mobility), ACWR over ceiling, illness signals, and the athlete's fixed
   constraints (days/week, non-negotiable strength) are GATES — they remove
   options before any scoring. Safety never loses a trade-off.
2. **Score remaining options** by: phase-priority weight × urgency × confidence
   − Σ(costs × severity). Low-confidence recommendations carry less weight
   (the hub's confidence directly damps an over-eager expert).
3. **Seek the non-conflicting compromise BEFORE choosing a winner.** Use
   `flexibility`: if the run coach's long run can move a day, or the
   nutritionist's deficit can wait 24h, the arbiter reschedules to satisfy
   both rather than declaring a loser. Most "conflicts" dissolve here — this
   is what a good human coach actually does.
4. **When a true trade-off remains, the phase vector decides** — and the
   arbiter records the loser + the cost, because that becomes the surfaced
   "trade-off" and the metric to watch.
5. **Emit:** ONE coherent day/week + the single most important trade-off in
   plain language ("holding the deficit so tomorrow's long run has fuel —
   watch weight trend, we'll make it up midweek").

### Worked example (base phase)
Nutrition wants −500 kcal (cut on track). Run wants glycogen for tomorrow's
16mi long run (urgency 0.9, protects race-readiness). Strength wants legs
(flexibility 0.8). → Gate check passes. Compromise search: strength moves to
the day after the long run (flexibility high). Deficit vs glycogen is a real
trade-off; base-phase vector ranks the long run's quality above the cut's
daily progress → hold the deficit tonight, resume tomorrow. Surfaced: "Fuel
normal tonight for the 16 — the cut resumes Sunday; net week stays in deficit."

### Openness / control hooks
- Every resolution is explainable down to the phase vector + the gate that
  fired + the trade-off taken. (Powers "ask a coach".)
- When the arbiter overrides the athlete's stated philosophy (e.g. proposing a
  threshold block against the 80/20 default), it MUST present benefits / costs
  / challenges and leave the choice to the athlete — never silently.

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

## Tune-up races as calibration checkpoints (user principle — first-class)
The small races between now and a goal race (e.g. the NYRR series before
Berlin) are NOT just predictions to display — they are **closed-loop
calibration checkpoints**. Each one is a real-world fitness measurement that:
- **Validates or corrects the model.** Compare predicted vs actual finish →
  the error re-tunes the personal fatigue exponent, threshold pace, and the
  durability estimate. A new race effort also becomes a stronger anchor.
- **Re-grades the remaining plan.** A faster-than-predicted tune-up may make
  the goal "comfortably in range" (the coach can dial back risk); a slower one
  triggers an honest replan or a goal-time conversation.
- **Tests coaching proficiency.** Each checkpoint is a chance to show the
  guidance worked — "we targeted X for this 10K, you ran X−; here's what that
  says about Berlin." This is how the athlete builds trust in the team.
The whole point of the tune-up calendar is to use races as checkpoints on the
journey. The plan must be designed AROUND them (taper-lite into a key tune-up,
absorb after), and the adaptive-replan loop fires on every result.

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
### Representation (the hard part) — a structured, attributed principle store
NOT free-text fed to an LLM (unattributable, unverifiable, drifts). NOT pure
hardcoded rules (can't explain or compare philosophies). A **curated principle
store** the experts query — each principle is a structured, cited unit:
```
{ id: 'seiler-polarized-8020',
  coach: 'Seiler',  source: 'Polarized training literature',
  domain: 'run', phase: ['base','build'],
  claim: '~80% of sessions easy (Z1-Z2), ~20% hard (Z4-Z5); avoid the Z3 grey zone.',
  prescribes: { easyPct: 0.80, hardPct: 0.20, greyZone: 'minimize' },
  conditions: 'endurance events; high total volume',
  benefits: ['sustainable aerobic dev','low injury/burnout risk'],
  costs: ['less race-pace specificity late'],
  conflictsWith: ['canova-racepace-heavy'],
  strength: 'strong (well-replicated)' }
```
- The **prescribes** block is machine-usable (the run coach reads numbers).
- The **benefits/costs/conflictsWith** power the openness clause: when two
  principles disagree (Hanson 16mi cap vs Pfitzinger 20-22mi), the coach
  surfaces both with their trade-offs instead of silently picking.
- **claim/coach/source** make every recommendation attributable ("per Seiler's
  80/20, because you're in base").

### How experts use it (retrieval, not generation)
An expert selects principles by `domain` + current `phase` + `conditions`, then
applies the `prescribes` math to the athlete's own numbers. The LLM/narrative
layer only renders the cited result into the team's voice — it never invents
the methodology. So advice is: athlete's data (primary) → principle as lens
(cited) → one-voice phrasing. Three separable, auditable steps.

### Conflict between principles = a feature
When selected principles disagree, that's not a bug to resolve silently — it's
exactly what the arbiter surfaces as a trade-off for the athlete to decide.
The `conflictsWith` edges make these visible. Emil's 80/20 default biases
selection toward Maffetone/Lydiard/Seiler; deviations get pitched with the full
ledger (benefits/costs/challenges) per the control principle.

### Seeding + growth
Start with a curated core (Maffetone, Lydiard, Seiler, Hanson, Higdon,
Daniels, Pfitzinger, Canova). The store is data, not code — new principles
(or refinements as research evolves) are added without touching the engine.
Long-term, the athlete's OWN validated response (from the hub's response model)
becomes personal principles that can override generic ones ("for YOU, heat
costs 1.5%/°C — overrides the generic taper assumption").

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
