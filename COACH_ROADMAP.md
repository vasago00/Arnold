# Arnold Coach — Master Executable Roadmap (2026-07-17)

> **What this is.** One ordered, executable plan that merges the *next-level architecture*
> (`NEXT_LEVEL_COACH_ARCHITECTURE.md`, the 8-step re-layering) with **every open item still on the
> books** — the legacy Phase D–H backlog from `COACH_NARRATIVE_DESIGN.md` §18, the deferred pieces
> Emil parked, and the flagged product decisions. Nothing gets dropped in the hand-off from
> "beat library" to "compound coach." Each stage is shippable on its own and leaves the app green.
>
> **The through-line:** today's deterministic engine is not thrown away — it is *promoted*. It
> becomes the fact layer, the safety oracle, and the always-on fallback. The LLM only ever enters
> behind the verifier we already built (`coachPhraser.factCheck`).

---

## 0. Where we are right now (done — the foundation)

These are complete, committed, and green — the machinery the rest of the plan builds on:

- **One narrative engine** (`coachNarrative.js`): pure `narrateSurface(ctx, surface)`; twelve
  generators → beats → reconcile → rank(salience) → topic-dedup → compose. No-fabrication contract.
- **Live assembler** (`coachContext.js`): `buildCoachContext(...)` — storage-coupled shell that
  feeds the pure engine.
- **Surface-specific voices**: `gPlanStatus` (Planner), `gFuelStatus` (Fuel/Daily), plus the Play/
  Daily training voice — each surface says something about *its own* metrics.
- **Goal-race unification** (`core/aRace.js`): one canonical A-race resolver; the Berlin-vs-Valencia
  class of bug is closed systemically (`goalResolve` + `raceRecipe` share it).
- **Novelty memory** (`coachMemory.js`): `saidAgoDays` down-weights what the coach said recently.
- **Fact-validated phraser seam** (`coachPhraser.js`): `factCheck` (output ⊆ facts) + always-safe
  fallback. *This is the future trust boundary.*
- **Monte-Carlo property sim** (`sim/coachNarrativeSim.js`): seeded, invariant-checked,
  negative-controlled — this is the legacy **Phase E**, already done.
- **Freshness + time-band gating** (first pass): `trainedToday` and hour gates on `gPurpose`,
  `gMechanism`, `gEnergyAvailability`, `gFuelStatus`. *These hand-coded gates are exactly what
  Stage 1 below replaces with a real model.*

Legacy phase status against the old plan: **Phase A/B/C done**, **Phase D partial** (novelty done;
preference learning outstanding), **Phase E done**, **Phase F/G/H outstanding**. This roadmap folds
those remaining phases into the architecture stages so there is a single ordered list.

---

## 1. The ordered plan

Stages run top to bottom. Each is a shippable increment; the app stays green throughout. The
right-hand column shows which legacy backlog item each stage absorbs, so nothing is orphaned.

| # | Stage | Absorbs (legacy / deferred / flagged) | LLM? |
|---|-------|----------------------------------------|------|
| 1 | **World model** | The whack-a-mole freshness/time gates | No |
| 2 | **Certified facts** | Beat → `{claim,data,why,validity,confidence}` record | No |
| 3 | **Reasoner behind the verifier** | Phase H (LLM phraser) — *Emil: last, low priority* | Yes |
| 4 | **Memory + personalization** | Phase D remainder (preference learning) | No→ |
| 5 | **Quality eval harness** | LLM-as-judge on the sim (extends Phase E) | Judge |
| 6 | **Facilitative stance** | The "stop nagging me" leap (MI tone) | Prompt |
| 7 | **Clinical generators** | Phase F (bloodwork/DEXA → training/fuel/goal) | No |
| 8 | **The Plan Stack** | Phase G (`PLAN_STACK_DESIGN.md` → Plan renderer) | No |
| — | **Product decisions** | MobileHome Start race card (goal vs next) + others | — |
| 9 | **(Later) RAG + temporal-graph memory** | Domain-knowledge grounding; "last July" retrieval | Yes |

---

### Stage 1 — World model  *(in progress — starting now)*

**Goal.** Replace the flat bag of scalars (`ea`, `hour`, `readiness`) with one high-signal,
structured snapshot the generators reason *over*, so time-of-day and freshness stop needing
individual `if`s.

**Build.** `core/worldModel.js` — a pure `buildWorldModel(inputs)` returning:

- **`day`** — `{ phase, hour, trainedToday, fuelWindowOpen, ... }` where `phase ∈
  {pre_dawn, morning, training_window, midday, recovery, wind_down, sleep}`. The single source for
  "don't nag about food at bedtime" → *"athlete is in `wind_down`"*.
- **`week`** — planned vs done, adherence, deviations (the injury reshape). Wraps today's plan slice.
- **`season`** — build/peak/taper, weeks-to-A-race, block intent (from `aRace` + periodization).
- **`body`** — trends (weight/HRV/sleep/load-ACWR direction), not just today's value.
- **`person`** — the learned profile stub (stance prefs, recurring patterns). Empty for now;
  Stage 4 fills it.

**Wire.** `buildCoachContext` becomes the *assembler* of the world model; generators key off
`ctx.day.phase` etc. Every current hand-coded gate migrates to a phase read. Context shape stays
backward-compatible so no generator breaks in one shot.

**Verify.** New `worldModel.test.js` (phase boundaries incl. the midnight/bedtime/wake classes that
bit us), updated `coachContext.test.js`, full offline vitest + `node --check`/esbuild parse.

**Ship criterion.** All the freshness bugs we hand-patched are now expressed as phase logic, sim
still green, zero behavior regressions. *Pure win, no LLM, no new risk.*

---

### Stage 2 — Certified facts

**Goal.** Turn generator output from finished prose into a typed, provenance-carrying record —
`{ claim, data, why, validity, confidence }` — while the deterministic composer keeps rendering
them exactly as today (no visible change). This *is* the trust boundary the LLM will sit behind.

**Build.** A `CertifiedFact` shape; generators emit facts, a thin adapter renders facts→beats so
current output is byte-stable. `validity` carries the freshness window (built on Stage 1's
`day.phase`); `confidence` carries signal strength.

**Verify.** Sim asserts every rendered sentence traces to a certified fact (the no-fabrication
invariant gets *stronger*); golden-output test proves composer output unchanged.

---

### Stage 3 — Reasoner behind the verifier  *(the sophistication step — Emil parked LLM for last)*

**Goal.** Introduce a bounded LLM as **selector + synthesizer** over the certified fact-set: it
decides *what matters now, in what order, in what tone*, and writes one cohesive read — but every
number/entity/claim it emits must pass `factCheck` (output ⊆ certified facts), else it falls back to
the deterministic composer. This is legacy **Phase H**, now contained by machinery already built.

**Build.** Wire the model into `coachPhraser.phraseNarrative`; reflect pass (self-critique for
consistency/appropriateness — Reflexion); **compute once per day / per meaningful data change,
cache it, deterministic path is the instant fallback** (cost/latency guardrail). A/B against the
composer, policed by the sim.

**Verify.** `factCheck` negative-controls; sim + LLM-as-judge (Stage 5) score the A/B; latency/cost
budget enforced.

> **Emil's call:** this is explicitly *last among the core stages* — deferred until Stages 1–2, 4–8
> are in. The seam is built so it is a drop-in when we choose to flip it on.

---

### Stage 4 — Memory + personalization  *(legacy Phase D remainder)*

**Goal.** Make the coach personal via the four-type taxonomy — *working* (this turn), *episodic*
(coach-interaction log; extends `coachMemory`), *semantic* (the `person` profile: what they respond
to, stance prefs), *procedural* (learned heuristics + novelty store). **Structured-first**, with
**recency-weighting, TTL/decay, dedup, conflict resolution from day one** (the production failure
modes the field flags).

**Absorbs the deferred bit:** *preference learning* — needs an **engagement signal** (was the beat
acted on / dismissed / dwelt on?). Stage 4 defines and captures that signal, then learns stance
prefs into `person`. This is the dependency that had it parked.

**Verify.** Structured memory is deterministic and sim-testable; hygiene (decay/dedup/conflict) has
explicit tests. Vector/graph store deferred to Stage 9 (only when there's unstructured episodic text
to retrieve).

---

### Stage 5 — Quality eval harness  *(extends the done Phase E)*

**Goal.** Move the sim from *invariants* (no crash/leak/fabrication) to **quality scoring**:
generate thousands of athlete-days, score output with an **LLM-as-judge rubric** (appropriate for
time of day? actionable? grounded? right tone? non-nagging?). The "midnight energy nag" class gets
caught by the eval, not Emil's inbox.

**Guard the judge** (reward-hacking is real): rubric + small human-labeled calibration set +
adversarial/ensemble check; track judge–human agreement so we don't optimize a gameable proxy.

**Why here:** it must exist *before* Stage 6 tone work and *before* flipping on Stage 3, so every
change is scored against whether coaching quality actually went up.

---

### Stage 6 — Facilitative stance  *(the real qualitative leap — "stop nagging me")*

**Goal.** Shift from *prescriptive scorekeeper* → *facilitative coach* (Motivational Interviewing):
open questions, reflective listening, affirmations, **advise-with-permission**. GPTCoach hit 93%
MI-consistency doing this; it is both more effective at behavior change and less annoying. Rides on
Stages 1–5 (a design + prompt + tone change), scored by Stage 5's judge.

---

### Stage 7 — Clinical generators  *(legacy Phase F)*

**Goal.** Bloodwork / DEXA connected to training/fuel/goal — `gClinical` filled in. Strict scope
limits: surface flags, **never diagnose**; clinical concerns route to a professional. First-class
"not medical advice" + hand-off (per the safety section of the architecture doc).

---

### Stage 8 — The Plan Stack  *(legacy Phase G)*

**Goal.** `PLAN_STACK_DESIGN.md` becomes the Plan-surface renderer, so the Planner's coach voice
sits on a purpose-built plan view rather than a generic tile. Pairs with the `gPlanStatus` voice
already shipped.

---

### Product decisions (resolve alongside, not blocking)

- **MobileHome Start race card — goal race vs next race.** Currently flagged: the Start card can
  show the *soonest* race while the coach speaks to the *goal* race (the same split that caused the
  Berlin/Valencia bug at the data layer). Decision needed: does the Start card headline the goal
  race, the next race, or both with clear labels? Now that `core/aRace.js` exists, either is a
  small, safe change — this is a UX call, not an engineering one.
- Any surface still reading a non-canonical race source gets swept onto `resolveARace` as found
  (audit hook — should be clean after unification, but verify per surface as we touch it).

---

### Stage 9 — (Later) domain RAG + temporal-graph memory

Curated, versioned training-science knowledge base → RAG so the coach can *cite the why* with
authority (Daniels/Canova/RED-S/recovery), and a **temporal knowledge graph** (Zep/Graphiti-style)
for the seasonal "this happened last July" retrospective. Not needed until the reasoner is earning
its place and there's unstructured knowledge/episodic text to retrieve.

---

## 2. Dependency order (why this sequence)

```
Stage 1 (world model) ─┬─► Stage 2 (certified facts) ─► Stage 3 (reasoner)   [Emil: last]
                       │
                       ├─► Stage 4 (memory) ──────────► feeds person → Stage 6
                       │
                       └─► Stage 5 (eval) ─────────────► gates Stage 3 flip + scores Stage 6
                                                          │
                                              Stage 6 (facilitative stance)
Independent tracks (any time after Stage 1): Stage 7 (clinical) · Stage 8 (plan stack) · product decisions
```

- **1 before everything** — the world model is the substrate; freshness/time correctness is a
  precondition for trusting anything downstream.
- **2 before 3** — the reasoner needs certified facts to be safe.
- **5 before flipping 3 on, and before 6** — you can't improve tone or trust the LLM without a way
  to *measure* coaching quality.
- **4 feeds 6** — facilitative coaching is far better when it knows the person.
- **3 is deferred to last of the core stages** per Emil, even though it slots after 2 — the seam is
  ready whenever we choose.

---

## 3. Guardrails that hold across every stage

- **Physiology/plan/EA math is deterministic** — the model never computes it, only reports it.
- **Output ⊆ certified facts** — `factCheck` is the hard gate for anything the LLM emits.
- **Build-blind protocol** — Emil rebuilds on Windows; we verify statically (esbuild parse / node
  --check / offline ESM harnesses) and keep the sim green before every commit.
- **Deterministic fallback is always present** — worst case, the coach speaks the composer's output.
- **Each stage ships green** — no stage lands until its tests + the sim pass offline.

---

*Next action: Stage 1 — building `core/worldModel.js` and rewiring `buildCoachContext` onto it.*
