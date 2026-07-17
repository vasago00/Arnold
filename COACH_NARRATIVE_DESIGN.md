# COACH_NARRATIVE_DESIGN.md — the Coach's Mouth (2026-07-13)

> **Why this exists.** The Sprints built the coach's *mind* (one voice via `racePhase`,
> the adaptive engine `adaptSession`, the goal model `goalResolve`, the training profile,
> the LivingPlan) and its *data* (transparency, learned effects, prescriptive fuel). What
> was never built is the coach's *mouth*: a narrative layer that READS all of that and
> speaks a reasoned, surface-specific narrative. The lines on Play/Daily/Fuel today are
> still canned template composers (`composeDigest`, `composePlayLine`, the `coachInsights`
> clauses) that never look at the goal model, the profile, tomorrow, or the mechanism. So
> the coach is a **scorekeeper** ("strength done · 51g protein to go · sleep well"), not a
> coach. This is the open, deeper half of backlog **#54**. This doc is the contract we
> agree on BEFORE writing engine code (mock-first).

> Companions: `PLAN_STACK_DESIGN.md` (the gamified Plan-tab redesign the coach narrates),
> `COACHING_PHILOSOPHY_GOAL_BACKWARD.md`, `COACH_UNIFICATION_DESIGN.md`,
> `MODELING_COACHING_UPDATES_2026-07.md` (what's engine-only), `ROADMAP_NEXT_2026-06.md` §B,
> `DESIGN_LESSONS.md` (voice).

---

## PART I — THE ENGINE

## 1. The one principle: ONE BRAIN, MANY MOUTHS

There is exactly **one** reasoning engine — `core/coachNarrative.js`. It takes the whole
picture and emits a ranked set of **coaching beats**. Every surface/tab is a *filter +
renderer* over that single beat-set. Consequences:

- **Consistency is structural, not aspirational.** Web and mobile, Start and Plan, all
  read the same beats — they can't contradict because there's one source.
- **The coach "decides what to bring forward"** = the engine RANKS beats by salience, and
  each surface takes the top-N relevant to *its* job.
- **Explains the data ON that surface.** A beat carries the metric(s) it speaks to, so a
  surface only voices beats whose data is shown there, and connects those numbers instead
  of listing them.

```
   context bundle ─► generators ─► beats[] ─► RECONCILE ─► RANK ─► (per surface) SELECT ─► COMPOSE ─► render
   (goal, profile,   (pure, one           (dedupe,       (salience)  (top-K for      (weave 1–3   (deterministic
    adaptation,       beat each)           suppress                    that surface)   into an arc)  now; LLM
    fuel, labs,                            clashes)                                                  phraser later)
    learned, …)
```

## 2. The Context Bundle (input) — everything the coach can see

Assembled once (memoized on `storageVersion` + the 5-min tick, like CoachComment today),
passed to every generator. Sourced from what ALREADY exists:

| Slice | Source (exists today) | Carries |
|---|---|---|
| `goal` | `goalResolve.buildGoalModel` | A-race (+ anchor fix §11), body/weight (observed rate), training targets, nutrition + EA floor, **conflicts** with trade-offs |
| `profile` | `trainingProfile` / `raceRecipe` | current-vs-goal ingredients, **weak link**, trajectory, finish projection |
| `phase` | `seasonPlan.racePhase` | build/mini-taper/recovery/race-week, weeks-to-race, this-week verdict + why |
| `today` | `computeUserState` (`us`) | sessions done (`todayStatus`), readiness, recovery debt, HRV/sleep, `numbers` |
| `adaptation` | `adaptSession`/`sessionAdapt` | today/tomorrow prescription + reason, `SESSION_INTENT` (type → purpose + dims + loadBearing) |
| `plan` | LivingPlan / `planWeekSummary` | week shape, next key session, done/missed/off-plan |
| `fuel` | `fuelForWork`/`coachRefuel`/`cutMode` | pre-carbs, PM protein, EA/RED-S flag, deficit %, observed loss rate, MPS window |
| `clinical` | `healthSystems`/`biomarkers`/body-comp/`pdfParser` | bloodwork markers, DEXA lean/fat trend, health-system statuses (§8) |
| `learned` | hub `hubFacts`/`coachInsights` | heat %/°C, sweat rate, learned effects + confidence |
| `memory` | `coachMemory` (new, §7) + `narrativeGraph` | what was said, what happened, decisions, seasonal patterns |
| `clock` | now | hour, evening/late-night |

No new *data sources* needed for v1 — the coach simply doesn't look at most of these today.

## 3. The Coaching Beat (the atom)

```js
{
  id: 'strength-durability',            // stable key (dedupe, resolution, memory)
  kind: 'purpose',                       // purpose|knock-on|mechanism|progress|conflict|
                                         // readiness|fuel|clinical|learned|context
  salience: 0..1,                        // how much the coach wants to say this NOW
  surfaces: ['start','play','plan'],     // where it's relevant (matches data shown there)
  claim: { text, data },                 // the sentence + the metric(s) it speaks to
  why: 'raceRecipe.weakLink=durability', // the SIGNAL it traces to (no-fabrication audit)
  tone: 'affirming'|'gentle'|'neutral'|'corrective',
}
```

The four levers you chose (purpose · knock-on · mechanism · progress) are `kind`s, plus the
ones the app already reasons about (conflict, readiness, fuel, clinical, learned).

## 4. The generators — how the coach reasons (grounded, pure)

Each generator is a pure `(ctx) → beat | null`. It returns `null` (silent) unless the data
supports a real claim. v1 catalog, each mapped to an existing signal:

- **`purposeOf(session)`** → what today built toward the goal. Strength → durability/economy
  (`raceRecipe` Blagrove refs) vs `profile.weakLink`. Long run → the endurance the goal needs.
  Intervals → the speed side of feasibility.
- **`knockOn(today, tomorrow)`** → concurrent-training interference, recovery need, what to
  protect — from `adaptation` + `plan` next session.
- **`mechanism(fuel, session)`** → the physiology-backed action: post-strength protein *timing*
  (MPS window, not a bare gap), pre-long carbs, low-EA/RED-S (`fuelForWork`, Mountjoy).
- **`progressVsPlan()`** → strength freq vs target, weekly consistency, volume vs goal peak,
  "behind but on-track" trajectory.
- **`conflict()`** → goal tensions with BOTH trade-offs (existing `goalResolve` conflicts) +
  *explain divergences* ("24% deficit but −0.29 lb/wk → under-logging or TDEE high").
- **`clinical()`** → connect a lab/DEXA to a felt symptom or a training decision (§8).
- **`readiness()`, `learned()`** → adaptive reason + strongest learned effect when today's
  conditions trigger it.

Adding a lever later = adding one generator; the engine and every surface pick it up for free.

## 5. How generators interact — produce → reconcile → compose

Generators never call each other (keeps them pure/testable and keeps no-fabrication clean).
Interaction is three post-generation stages — this is where coherence lives:

1. **Reconcile.** Dedupe beats citing the same metric; **suppress tonal clashes** (a
   `corrective` conflict beat mutes a chirpy `progress` beat that would cheerlead next to a
   warning). Dependencies ("talk protein timing *because* it was a strength day") are
   expressed by generators reading the same `ctx.today.session` — not by wiring.
2. **Rank** by salience (§6).
3. **Compose.** A conductor takes the top 1–3 for the surface and weaves them into one arc
   (lead → support → forward-look) with real connectives, so it reads as a paragraph, not a
   list. In v1 this is deterministic templating; the seam is built so an LLM phraser can
   replace *only* this step later (§9).

## 6. Salience — how the coach decides what leads

```
salience = base(kind)                    // corrective/conflict outranks a nicety
         + urgency(daysToRace, deadline) // taper week > deep base
         + magnitude(gap, effect size)   // a big weak-link gap > a 2% one
         + novelty(saidRecently?)        // don't repeat yesterday (coachMemory / narrativeGraph)
         + preference(userEngagement)    // learned: down-weight beats you ignore (§10)
         + surfaceFit(surface)           // a fuel beat scores higher on Fuel
```

Tight surfaces (Start) take K=1 (the one thing); the Daily diary takes K=2–3 (a paragraph).

## 7. Per-surface narrative contract

Same engine, filtered by each surface's *job* (surfaces don't duplicate — `DESIGN_LESSONS` §5),
rendered in that surface's register:

| Surface | Job | Speaks (by salience) | Register |
|---|---|---|---|
| **Start** | the glance | the single highest-salience beat | one line |
| **EdgeIQ** | analytical | leverage + weak-link/progress + a learned effect | depth, 2 beats |
| **Play** | training state | purpose of today + knock-on to tomorrow | warm, forward |
| **Fuel** | fuel state | mechanism (timing) + EA/RED-S + deficit-vs-trend explanation | prescriptive |
| **Plan** | goal & plan (→ the **Stack**, `PLAN_STACK_DESIGN.md`) | trajectory + conflicts + volume/phase why | strategic |
| **Trend** | multi-week load/recovery | sleep-debt/ACWR story with real numbers | analytical |
| **Daily** | the diary | 2–3 beats woven into one reassuring paragraph | warm digest |
| **Calendar** | execution | week shape + next key session + adaptation offers | terse |

All draw from the SAME ranked beat-set → surfaces can't disagree. Cohesion by design.

## 8. No-fabrication contract (the guardrail)

Every beat carries `why` = the signal it traces to. A beat whose signal is missing or
low-confidence is **not generated** — the coach stays silent rather than invent. Phase-E sim
asserts: over a large synthetic-athlete sweep, **every emitted beat's `why` resolves to a
real, in-range signal** — zero fabricated claims. (Same discipline as `fitnessInsight`'s
confidence gate.)

---

## PART II — WHAT MAKES IT A COACH, NOT A GENERATOR

## 9. The LLM seam — brain deterministic, mouth swappable

The *reasoning* (what's true, what matters, what to say) stays **deterministic**, because
that's where no-fabrication is enforceable, testable, offline, private, and free. An LLM's
only legitimate role is as a **phraser**: given the already-selected beats *with their facts
and provenance*, render natural, varied prose under a hard constraint — it may use ONLY the
numbers/claims provided, and we validate it introduced none of its own.

- **v1:** deterministic templating (ship this first — it's the valuable part).
- **v2 (optional):** an LLM phraser slots into the COMPOSE step only. Feed it minimal
  structured beats, **never raw health data** (privacy). Run on-device or on our own edge
  (Cloudflare worker exists; `ai.js`/`coachingPrompts.js` infra exists). Validate output ⊆
  input facts.
- **Rule: the LLM is lipstick; the beats are the brain.** Intelligence never migrates into
  the prompt. The beat→text boundary is designed now so the phraser is a drop-in later.

## 10. How the coach learns and grows — three layers

1. **Physiological (exists).** The hub learns your heat sensitivity (%/°C), sweat rate,
   fatigue exponent, VDOT — so beats already personalize as data accrues ("for *you*, heat
   costs ~0.7%/°C").
2. **Coaching-preference (new, small loop).** The coach watches which beats you act on,
   dismiss, or resolve (goal-conflict choices already stored) and re-weights salience —
   stop nagging fuel if you always ignore it, lean into knock-on warnings if you act on them.
   Feeds `preference(userEngagement)` in §6.
3. **Longitudinal / seasonal (ROADMAP item 5).** Year-over-year retrospective — "the same
   July heat broke you down last year." Aligned build comparisons.

Growth = physiology (have it) + what-coaching-lands (build it) + seasonal memory (roadmap).

## 11. How the coach remembers — the `coachMemory` store

Memory is what separates a coach from a daily commentator; it's distinct from the hub
(physiology). Four kinds:

- **Physiological** — the hub (`hubState`, learned models). Exists.
- **Episodic** — what the coach *said* and what *happened*: a `coachMemory` log of
  `{date, beatId, claim, outcome}`. Powers **novelty** (don't repeat) and **follow-through**
  ("you said you'd protect sleep — you did, readiness's up 8 pts"). Substrate exists:
  `memory.js` + `narrativeGraph.js` (the latent "speak once, right time" engine).
- **Decision** — your resolved trade-offs ("you chose the race over the cut → won't re-nag").
  Already stored (`getGoalResolutions`).
- **Seasonal** — aligned year-over-year builds (feeds layer-3 learning + the Stack's history).

Episodic memory is what makes it feel like *your* coach and not a fresh-every-day narrator.

## 12. Weaving in bloodwork, DEXA & labs

Substrate exists — `healthSystems.js` (biggest module), `biomarkers.js`, Labs/Clinical
modules, the PDF lab parser, DEXA via body-comp — but siloed on the Core/Labs tab. They
become **context slices (`ctx.clinical`) + a `clinical` generator family**. The coach's job
is NOT to recite values (that's the Labs tab) — it's to **connect a lab to a felt experience
or a training decision**:

- Low ferritin/iron → "that's why easy runs feel harder lately, and it caps the adaptation
  you're chasing."
- DEXA lean mass held through the cut → "down 3 lb and it's fat, not muscle — the cut's
  working, keep going." (Ties labs + nutrition + training + goal into one thought.)

**Cadence:** labs are quarterly → these beats are low-frequency / high-salience (novelty +
magnitude). The coach speaks to a fresh result prominently for a few days, then it settles
into background context — exactly how a real coach uses your bloodwork.

## 13. The Plan tab becomes the STACK (see `PLAN_STACK_DESIGN.md`)

Emil's direction: evolve Plan (and quiet Trend) into a **growing annual stack** — you build
layers through the year; on **Jan 1 the stack drops to the ground and becomes a thin new
floor** you build on again. Why it's more than gamification:

- **Physiologically honest.** Endurance compounds over years; last year's peak IS this
  year's floor. You don't restart at zero — you restart higher. The drop = consolidation,
  not loss.
- **It's the visual body of the coach's longitudinal memory (§11) + training profile.** Each
  layer encodes real earned adaptation (a threshold block, a durability block, a long-run
  progression); **the coach narrates the stack**. So the Plan redesign and this narrative
  engine are the *same project* — the Stack is what the Plan-surface beats render into, which
  is why Plan/Trend can go quieter (surfaces stop duplicating).
- **The one tension:** the core user is the analytical, educated athlete who bristles at
  Duolingo-style toy mechanics. The Stack must stay **executive + information-dense** — every
  layer *means* something — beautiful AND rigorous, so it attracts new generations without
  alienating the serious athlete.

Full design lives in `PLAN_STACK_DESIGN.md` (sibling doc); it renders Plan-surface beats.

---

## PART III — THE PATH

## 14. Before / after (the proof)

**Post-strength Daily — today:**
> Good work getting your strength in today. You're ~51g of protein short of today's target.
> Tonight, the real win is sleep.

**Through the engine (purpose → knock-on → mechanism):**
> Strength's in — that's your durability lever, and durability is the exact gap the profile
> flags between you and Valencia. Tomorrow's intervals, so keep tonight easy: lifting into a
> speed session too close blunts both. You're 51g of protein short, but after lifting the
> *timing* beats the number — ~30g before bed is when the work becomes muscle.

**Plan cut-tension — through the engine (conflict + divergence + DEXA):**
> You're cutting ~0.29 lb/wk toward 170 while training 30 mi/wk — a sustainable background
> cut, not a threat to the build. Your intake math says 24% deficit but the scale's only
> moving 0.29 lb/wk, so you're likely under-logging or your burn's lower than modeled — trust
> the scale. The last DEXA says what you're losing is fat, not muscle, so hold the course.

Every clause traces to a signal already in the app. Nothing invented.

## 15. Folded-in fix: anchor the goal model on the RIGHT race

The goal model anchors on the *soonest priority-A* race, so a 5K tune-up hijacks it (the
"NYRR 5K" in the Plan conflict instead of Valencia). As part of Phase B, `buildGoalModel`'s
A-race resolution becomes: explicit `aRaceDate` → future race with `goalTimeSecs` set →
future **marathon** → soonest priority-A → soonest. The narrative can't reason from the right
race until this is right.

## 16. Build phases (mock-first; verify each on real data)

- **Phase A — this doc + the contract.** ← *you are here.* Agree shape, surface table, voice.
- **Phase B — engine + your surface.** Build `core/coachNarrative.js` (context bundle + v1
  generators + reconcile/rank/compose), the A-race anchor fix, and wire **Daily + Play** (and
  optionally **Plan**) to it; retire those canned beats. Show live output on today's strength
  day before moving on.
- **Phase C — extend surfaces.** EdgeIQ / Plan / Trend / Fuel off the same engine; retire
  `composeDigest`/`composePlayLine`/ad-hoc `coachInsights` weaving.
- **Phase D — memory + preference learning.** `coachMemory` (episodic/decision) → novelty +
  follow-through; the engagement-based salience weight.
- **Phase E — no-fabrication sim + tests.** Property test: every beat traces to a real signal;
  surfaces never contradict; salience stable across seeds.
- **Phase F — clinical generators.** Bloodwork/DEXA connected to training/fuel/goal.
- **Phase G — the Stack.** `PLAN_STACK_DESIGN.md` becomes the Plan renderer for Plan-surface
  beats; quiet Trend.
- **Phase H (optional) — LLM phraser.** Drop into the COMPOSE step; validate output ⊆ facts.

Old composers retire surface-by-surface, so the app is never half-spoken.

## 17. RESOLVED decisions (Emil, 2026-07-13)

1. **Voice length.** Start = **1–2 lines** (the one thing). **Daily / Play / Fuel = a few
   lines**, and — key — they must **weave in the metrics displayed on that surface** (name
   the actual numbers the screen shows and connect them; the narrative *explains* the tiles,
   it doesn't float beside them).
2. **Corrective tone = expose the CONSEQUENCE.** A corrective beat must state the impact to
   **performance, to health, AND to the goal** — not a soft hedge. ("Under the EA floor →
   costs bone + hormones + the adaptation you're training for, and pushes the goal further
   out.") Direct, never vague; still warm, never shaming.
3. **Salience = impact × gravity, not a fixed lever order.** No hard-coded purpose>knock-on>…
   ranking. Every lever surfaces *where it's relevant and with a priority set by how much is
   at stake* — a health/goal risk outranks a nicety anywhere; on a clean day, purpose leads.
   So `base(kind)` in §6 encodes GRAVITY (risk/consequence), and magnitude scales it.
4. **Phase B scope = Daily + Play.** (Plan follows in Phase C.)

## 18. Cognitive architecture — the three layers, and when stronger AI / a vector DB enter (Emil + Claude, 2026-07-16)

> Logged from a design conversation. Framing: the generators + salience + composer read like a
> **neurological pathway** the coach navigates within the data. The question "when do we need a
> stronger AI model, and do we need a vector DB for memory?" resolves cleanly once the coach is
> split into **three layers that get different answers.**

**Layer 1 — JUDGMENT (what is true / worth saying).** The generators (`gWeekDrift`, `gEnergyAvailability`,
`gReadiness`, …) deciding a claim is real and grounded. **Stays deterministic permanently — not
because an LLM couldn't phrase it, but because this is the safety-critical layer and everything good
about the design depends on it being auditable.** Every beat carries its `why`; the no-fabrication
contract holds; and it is **property-testable** (the Monte-Carlo sim, §Phase E). The moment reasoning
moves inside a language model we lose all three: claims stop tracing to signals, output stops being
deterministic, and the invariant sweep can't exist. These are the coach's reflexes/nuclei — boringly
reliable by design. Answer to "when a stronger model here": **never.**

**Layer 2 — SELECTION (what matters most, now).** Salience ranking (gravity × magnitude + surface-fit
+ novelty + preference). Today a hand-tuned formula. This is where a **small LEARNED model** eventually
earns its place — a preference/bandit model that watches which beats the athlete acts on vs dismisses
and adjusts `kindWeight` — **but that is small ML, not an LLM** (ranking a dozen scored items needs no
language). This is Phase D and depends on memory existing to learn from.

**Layer 3 — EXPRESSION (how to say it).** Turning selected beats into one warm, non-repetitive
paragraph. **This is where an LLM belongs, and where the design already puts it (Phase H phraser:
"drop into the COMPOSE step; validate output ⊆ facts").** The discipline in that line is the whole
game: the LLM receives the already-selected beats (numbers + `why`), rewrites them, and a validator
asserts every number/claim in the output traces back to an input beat — anything new is rejected.
Voice without hallucination. Elegantly, the **same Monte-Carlo harness becomes the phraser's guardrail**
(generate beats → run phraser → assert no un-sourced fact appears). **Trigger to adopt:** once surfaces
routinely compose 2–3 beats, the deterministic join reads stitched/repetitive across days — we're near
that edge now. Build it **behind** the fact-validator and **A/B against the deterministic composer**,
which stays the fallback and the test oracle. Never replace the composer outright.

**MEMORY — structured index first; a vector DB is downstream of the LLM, not a prerequisite.** The
salience function already reaches for `ctx.memory.saidAgoDays[beatId]` and `ctx.memory.kindWeight[kind]`,
but `buildCoachContext` hands it `{}` — the hooks exist, the store doesn't. (`core/memory.js` is data
plumbing for workouts/races/Garmin, NOT coach memory.) What that memory must *do* is almost entirely
**structured, not semantic**: novelty = recency lookup keyed by beat id; preference = per-kind counters;
decisions = structured records of what the athlete chose; seasonal ("this happened last year", ROADMAP
§5) = a **time-aligned** query (same calendar week / same race-relative week in the prior block). All of
that is a plain indexed store over one athlete's few-thousand daily rows — answered better (and
**deterministically**, so it stays inside the sim) by a Map/date-index than by embeddings. A vector DB
buys fuzzy "find things *like* this" over large unstructured corpora and pays for it in infra, embedding
cost, and non-determinism — a bad trade for structured signal memory.

**When a vector DB DOES earn its place:** downstream of the LLM, once there are two things we don't have
yet — (a) **unstructured episodic text** (journal entries, "how did that run feel" notes, past coach
messages, race reports) and (b) a **conversational / RAG surface** ("ask Arnold") where the model must
retrieve the semantically relevant slice of that history to ground an answer. That's real RAG; embeddings
earn their keep. Reaching for it first solves retrieval before there's content to retrieve.

**Sequencing decision.** (1) Build the **structured coach-memory store** so `saidAgoDays`/`kindWeight`
are real (stops repetition, starts deferring to engagement). (2) Keep the **deterministic engine as
judgment + test oracle.** (3) Introduce the **LLM strictly as a phraser**, gated by the fact-validator,
policed by the Monte-Carlo suite. (4) A **vector store only when** free-text episodic memory + a dialogue
layer exist. The vector DB is a *consequence* of adding conversation + unstructured memory, not a
prerequisite for the coach getting smarter.
