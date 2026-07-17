# Arnold — Next-Level Coach Architecture (2026-07-16, Emil + Claude)

> **Why this doc.** The current coach is a *beat library*: hand-authored sentence templates with hand-coded
> firing conditions. Every new situation (midnight, post-workout, bedtime) needs another `if`. That approach
> is safe, testable, and deterministic — and it has hit a ceiling: it matches situations, it doesn't *understand*
> the athlete. This doc grounds the next level in **where the field actually is (2024–2026)** and turns it into a
> concrete, staged architecture that keeps our safety guarantees while raising the sophistication ceiling.
> It supersedes the direction sketch in `COACH_NARRATIVE_DESIGN.md` §18.

---

## 0. TL;DR

Build Arnold's coach as a **compound AI system organized as specialist functions under an orchestrator** — the
exact shape Google's *Personal Health Agent* (PHA) uses in production research. Split it cleanly:

- **Deterministic engines = the facts & physiology** (our existing core: `weekResolve`, `sessionAdapt`, `goalResolve`,
  `fuelForWork`, the hub). They *certify* grounded observations. Physiology math never goes in a language model.
- **A bounded LLM = the judgment & the voice.** It reads a curated **world model** + the certified facts, decides
  what *this* athlete needs *now*, and says it naturally — but it can **only speak facts the engine certified**
  (our `coachPhraser.factCheck` is exactly this boundary; the field calls it the *verifier* in a compound system).
- **Memory** makes it personal (structured semantic + episodic + procedural, with recency-weighting and forgetting).
- **A quality evaluation harness** (Monte-Carlo sim + LLM-as-judge) measures *good coaching*, not just *no crash*.
- **A coaching-stance shift**: from *prescriptive scorekeeper* → *facilitative coach* (Motivational Interviewing).
  This is the qualitative leap, and it directly fixes the "stop nagging me" problem.

This is a **re-layering, not a rewrite.** Today's engine becomes the fact layer, the safety oracle, and the fallback.

---

## 1. Where the field is (grounded)

**Compound AI systems are now the default path to production quality.** The Berkeley BAIR thesis (Zaharia,
Khattab, Zaharia et al., 2024) is that state-of-the-art results come from *systems of interacting components —
models, retrievers, tools, verifiers, control logic* — not monolithic models, precisely because systems give you
**control and trust: output filtering, fact verification, behavior guarantees** that a bare network can't provide
([BAIR](https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/); survey:
[arXiv 2506.04565](https://arxiv.org/html/2506.04565v1)). The pattern that matters most for us is **AlphaGeometry**:
an LLM *proposes*, a *symbolic engine verifies*, iteratively. That is our fact-engine ↔ reasoner ↔ validator loop.

**Neuro-symbolic is the "third wave."** The consensus is to pair *neural fluency* with *symbolic rigor*: LLMs are
weak at rigorous multi-step, constraint-bound reasoning; symbolic/rule engines give guarantees
([IJCAI 2025 survey](https://www.ijcai.org/proceedings/2025/1195.pdf);
[arXiv 2508.13678](https://arxiv.org/html/2508.13678v1)). For us: training-science constraints (load, taper, spacing
conflicts, EA floors, volume conservation) stay in deterministic code; the model never does the physiology.

**Grounding / hallucination control for high-stakes advice is a solved *pattern*, not a solved problem.** The
toolkit: retrieval-augmented generation, **chain-of-verification** (draft → verify each claim → revise; Dhuliawala
et al.), verifier/critic passes, guardrails frameworks, and **"output ⊆ facts"** constraint checking
([application survey, arXiv 2510.24476](https://arxiv.org/html/2510.24476v1); high-stakes tutorial:
[MDPI 2025](https://www.mdpi.com/2073-431X/14/8/332)). Multi-layered defense is the recommendation for anything
health-adjacent.

**Context engineering is the 2025 discipline for state.** Anthropic's guidance: context is a *scarce resource*
("context rot" — recall degrades as tokens grow), so the goal is **"the smallest set of high-signal tokens"**;
use **just-in-time retrieval** (hold lightweight references, load on demand), **structured note-taking** (persistent
memory *outside* the context window), **compaction**, and **sub-agent isolation** (specialists return condensed
1–2k-token summaries) ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).

**Memory has a stabilized taxonomy** — *working / episodic / semantic / procedural* — and the OS-tiered pattern
(MemGPT/**Letta**: core/recall/archival, with the agent calling `memory.insert/search`). Named systems: **Mem0**
(auto-extracted semantic facts), **Zep/Graphiti** (temporal knowledge graph), **LangMem**, **A-Mem**
([Letta/Mem0/Zep guide](https://jobsbyculture.com/blog/ai-agent-memory-systems-guide-2026);
[Mem0, arXiv 2504.19413](https://arxiv.org/pdf/2504.19413); [A-Mem, arXiv 2502.12110](https://arxiv.org/pdf/2502.12110)).
The **production lessons** matter more than the tool choice: *memory hygiene* (forgetting/TTL/decay, dedup, conflict
resolution) and **recency-weighting, not just similarity** ("a fact from 18 months ago that semantically matches can
hurt more than help"). This confirms our earlier call — **structured memory first, a vector/graph store only when
there's unstructured episodic text to retrieve.**

**Agentic reasoning** = ReAct (reason+act with tools), **Reflexion** (self-critique/reflect), planner-executor, and
self-consistency voting. Google's PHA orchestrator literally runs "collaboration, **reflection**, and memory updates."

**Evaluation is the weak link everyone is racing to fix.** LLM-as-judge is standard but *gameable* — "One Token to
Fool LLM-as-a-Judge" ([arXiv 2507.08794](https://arxiv.org/html/2507.08794v1)) and reward-hacking benchmarks show
judges reward superficial cues. The mitigations: **human-calibrated rubrics, ensembles/panels, adversarial checks,
and simulation-based evaluation** ([LLM-as-a-judge survey](https://github.com/CSHaitao/Awesome-LLMs-as-Judges)).

**The domain blueprint already exists.** Google's **Personal Health Agent** (Nature Medicine 2025; PH-LLM) is a
**three-specialist multi-agent** system under an orchestrator: a **Data Science agent** (analyzes wearable
time-series, writes executable code for *statistically valid* answers), a **Domain Expert agent** (grounds in
authoritative sources like NCBI, tailors to the user's profile, "verifiable facts"), and a **Health Coach agent**
(behavior change via **Motivational Interviewing**). The orchestrator dynamically assigns a main + supporting agents
and iterates with reflection + memory updates; evaluation ran at agent *and* system level over ~1,100 expert-hours
across 10 benchmark tasks ([Google Research](https://research.google/blog/the-anatomy-of-a-personal-health-agent/);
[Nature Medicine](https://www.nature.com/articles/s41591-025-03888-0);
[wearable-agents, Nature Comms](https://www.nature.com/articles/s41467-025-67922-y)).
**GPTCoach** ([arXiv 2405.06061](https://arxiv.org/html/2405.06061)) is the fitness-specific cousin: it grounds in
behavior-change theory (transtheoretical model, social-cognitive theory, **FITT**), implements **11 Motivational
Interviewing strategies** ("advise *with permission*"), uses **prompt chaining** (a dialogue-state chain, an MI-strategy
chain, a tool-call chain), pulls wearable data through `describe()`/`visualize()` tools — and crucially, **data
contextualizes advice, it doesn't drive it.** Its safety comes from structured prompting, permission-gating, and
scope limits; it hit 93% MI-consistency vs. vanilla GPT-4.

---

## 2. The core architectural bet

A **compound, neuro-symbolic system with a verification boundary.** Three responsibilities, cleanly separated:

```
        ┌─────────────────────────── ORCHESTRATOR ───────────────────────────┐
        │  routes need → assigns specialists → iterates (reflect) → updates memory │
        └───────┬───────────────────┬────────────────────┬───────────────────┘
                │                   │                    │
   ┌────────────▼─────────┐ ┌───────▼────────┐ ┌─────────▼──────────┐
   │  FACT & ANALYTICS    │ │ DOMAIN         │ │  REASONER (LLM)    │
   │  ENGINE (symbolic)   │ │ KNOWLEDGE +    │ │  judgment + voice  │
   │  our existing core   │ │ RETRIEVAL      │ │  facilitative (MI) │
   │  → CERTIFIED facts   │ │ (grounding)    │ │  plans · reflects  │
   └──────────┬───────────┘ └───────┬────────┘ └─────────┬──────────┘
              │                     │                    │
              └─────────────► VERIFIER  ◄─────────────────┘
                       (output ⊆ certified facts — coachPhraser)
                                    │
                              WORLD MODEL  ◄──► MEMORY (episodic/semantic/procedural)
```

**The rule that makes it safe** (BAIR "control & trust" + neuro-symbolic rigor + grounding): *the model may reason
about **what to say** and **how**, but every claim it emits must trace to a fact the deterministic engine certified.*
The physiology, the numbers, the plan math — never generated, only *reported*. We already built the verifier
(`coachPhraser.factCheck`); this architecture promotes it from "phraser guard" to the **system's trust boundary.**

---

## 3. The World Model (state, not signal slices)

The reason we keep patching time-of-day is that the coach has no *model of the athlete's situation* — just a flat
bag of scalars (`ea`, `hour`, `readiness`). Context-engineering practice says: compute one **high-signal, structured
snapshot** and reason over *that*. Concretely, a first-class object across timescales:

- **`day`** — a real temporal object: phase (`pre-dawn · morning · training-window · midday · recovery · wind-down ·
  sleep`), fuel windows, whether trained-yet, sleep/wake. → "don't nag about food at bedtime" becomes *"the athlete is
  in `wind-down`"*, not `if hour >= 21`. **The symptoms stop needing individual patches.**
- **`week`** — the plan's arc: planned vs done, adherence, what's ahead, deviations (the injury reshape).
- **`season`** — build/peak/taper, weeks-to-goal-race, the block's intent.
- **`body`** — trends (weight, HRV, sleep, load/ACWR), not just today's value.
- **`person`** — the profile the coach *learns*: what they respond to, their stance preferences, recurring patterns
  ("July heat breaks them"), stated goals and values. This is where memory feeds in.

The current `buildCoachContext` becomes the *assembler* of this world model. Generators/reasoner key off the model,
not raw fields — which is the systematic version of the freshness fixes we've been hand-coding.

---

## 4. The layers, mapped to Arnold

**(a) Fact & Analytics engine — we already have the "Data Science agent."** Google's PHA writes code at runtime to get
statistically valid answers from wearable data; *we don't need to*, because our deterministic engines (`weekResolve`,
`sessionAdapt`, `fuelForWork`, the hub models, `todayStatus`) are that analysis, pre-built and unit-tested. The change:
have them emit **certified observations** — a typed record `{ claim, data, why/provenance, validityWindow, confidence }` —
rather than finished sentences. (Today's "beats" are 90% of the way there; strip the prose, keep the facts.)

**(b) Domain knowledge + retrieval — the "Domain Expert agent."** Training-science grounding (Daniels/Canova/RED-S/
recovery), tailored to the athlete's profile and injuries, retrieved just-in-time. Start as a curated, versioned
knowledge base the reasoner can cite; grows into RAG. This is what lets the coach *explain the why* with authority
instead of asserting.

**(c) The Reasoner (bounded LLM) — the "Health Coach agent."** Reads the world model + the certified fact-set +
memory, and decides *what matters now, in what order, in what tone,* then writes one cohesive read. It **plans**
(select), **reflects** (self-critique for consistency/appropriateness — Reflexion), and is **fact-gated** by the
verifier. It never invents a number or a claim; worst case it falls back to the deterministic composer we have.
A/B against that composer, policed by the sim.

**(d) Memory.** Adopt the four-type taxonomy: *working* (this turn), *episodic* (the session/event log — we have
`activities`; add coach-interaction episodes), *semantic* (the athlete profile / preferences / "what works" — the
`person` model), *procedural* (the coach's own learned heuristics + our novelty store). **Structured-first**
(deterministic, sim-testable), with **recency-weighting, TTL/decay, dedup, and conflict resolution** from day one —
these are the production failure modes the field flags. A **temporal knowledge graph (Zep/Graphiti-style)** is the
right home *later* for the seasonal "this happened last July" retrospective; not needed for v1.

**(e) Orchestrator.** Routes by need (a fuel question vs a plan question vs a readiness call), assigns the fact
engine + knowledge + reasoner, runs one reflect pass, and writes memory updates — the PHA loop. On most surface
renders this is cheap and mostly deterministic; the LLM reasoner is invoked when there's genuine synthesis to do
(and can be pre-computed once per day / per meaningful data change, not per render — important for cost/latency).

---

## 5. Trust boundary & safety

Layered, matching the high-stakes guidance:

1. **Symbolic facts only** — physiology/plan/EA math is deterministic; the model can't get it wrong because it
   doesn't compute it.
2. **Output ⊆ certified facts** — `factCheck` rejects any emitted number/entity/claim not in the certified set
   (built, tested, negative-controlled).
3. **Chain-of-verification / reflect pass** — the reasoner self-checks appropriateness + consistency before emit.
4. **Facilitative stance + permission-gating** (from GPTCoach/MI) — advice is offered *with permission*, not
   dictated; this is *safer* and reads better.
5. **Scope limits** — the coach stays in training/fuel/recovery; clinical flags point to a professional, never
   diagnose.

---

## 6. Evaluation — measure *good coaching*

We find issues one screenshot at a time because we can't measure quality. The fix, grounded in the eval literature:

- **Extend the Monte-Carlo sim** (`coachNarrativeSim`) from *invariants* (no crash, no leak, no fabrication) to
  **quality scoring**: generate thousands of athlete-days and score the output with an **LLM-as-judge rubric**
  (appropriate for the time of day? actionable? grounded? right tone? non-nagging?). The "midnight energy nag" class
  gets caught by the eval, not your inbox.
- **Guard the judge** — reward-hacking is real; use a **rubric + a small human-labeled calibration set + an
  adversarial/ensemble check**, and track judge–human agreement so we don't optimize a gameable proxy.
- **Every design change is scored** against whether coaching quality went up — the discipline that lets sophistication
  compound instead of regress.

---

## 7. The coaching-stance shift (the real leap)

The single biggest quality jump isn't an LLM — it's **facilitative over prescriptive coaching**. The evidence
(GPTCoach, Motivational Interviewing, PHA's HC agent) is that *non-directive* coaching — open questions, reflective
listening, affirmations, **advise-with-permission** — is both more effective at behavior change and less annoying.
It directly answers your "stop telling me / stop nagging me" instinct: the coach stops being a scorekeeper that
narrates deficits and becomes a guide that surfaces what matters and lets you drive. This is a *design + prompt +
tone* change that rides on the architecture above, and it's where "Arnold understands me" actually comes from.

---

## 8. Migration path (re-layering, in order — each shippable)

1. **World model** — refactor `buildCoachContext` into the `day/week/season/body/person` snapshot; move the freshness
   gates into `day.phase`. *Retires the whack-a-mole; no LLM yet; fully sim-tested.*
2. **Certified facts** — have generators emit `{claim, data, why, validity, confidence}` records; the deterministic
   composer still renders them (unchanged behavior). *Sets up the boundary.*
3. **Reasoner behind the verifier** — introduce the LLM as selector+synthesizer over the fact-set, gated by
   `factCheck`, A/B against the deterministic composer, policed by the sim. *The sophistication step, safely.*
4. **Memory + personalization** — structured semantic/procedural stores with recency + hygiene; feed `person`.
5. **Quality eval harness** — LLM-as-judge rubric on the sim; human calibration.
6. **Facilitative stance** — rework tone/prompts to MI; permission-gating.
7. **(Later)** domain-knowledge RAG; temporal-graph memory for seasonal retrospective.

Steps 1–2 are pure wins with today's guarantees. The LLM enters at step 3, contained by machinery we've already built.

---

## 9. Trade-offs & risks (honest)

- **Cost/latency** — an LLM reasoner per render is untenable; compute it **once per day / per meaningful data change**,
  cache it, and keep the deterministic path as the instant fallback.
- **Non-determinism** — contained: facts are deterministic and verified; only phrasing/selection varies, and the sim
  + `factCheck` bound it.
- **Eval burden** — a judge is itself a system to maintain and can be gamed; budget for calibration.
- **Regulatory/safety** — health advice carries liability; scope limits, "not medical advice," and the professional
  hand-off must be first-class, not afterthoughts (PHA itself is explicitly framed as research, not a product).
- **Over-reach** — resist making everything an agent. Most of Arnold stays deterministic; the LLM earns its place only
  at selection/synthesis/voice.

---

## Sources

- BAIR, *The Shift from Models to Compound AI Systems* (2024) — https://bair.berkeley.edu/blog/2024/02/18/compound-ai-systems/
- *A Survey of Compound AI Systems* — https://arxiv.org/html/2506.04565v1
- Neuro-symbolic surveys — https://www.ijcai.org/proceedings/2025/1195.pdf · https://arxiv.org/html/2508.13678v1
- Hallucination mitigation (RAG/reasoning/agentic) — https://arxiv.org/html/2510.24476v1 · high-stakes tutorial https://www.mdpi.com/2073-431X/14/8/332
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Agent memory guide (Letta/Mem0/Zep) — https://jobsbyculture.com/blog/ai-agent-memory-systems-guide-2026 · Mem0 https://arxiv.org/pdf/2504.19413 · A-Mem https://arxiv.org/pdf/2502.12110
- LLM-as-a-judge survey — https://github.com/CSHaitao/Awesome-LLMs-as-Judges · *One Token to Fool LLM-as-a-Judge* https://arxiv.org/html/2507.08794v1
- Google Personal Health Agent — https://research.google/blog/the-anatomy-of-a-personal-health-agent/ · Nature Medicine https://www.nature.com/articles/s41591-025-03888-0 · wearable agents https://www.nature.com/articles/s41467-025-67922-y
- GPTCoach — https://arxiv.org/html/2405.06061
