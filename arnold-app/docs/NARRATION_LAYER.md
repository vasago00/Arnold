# The Narration Layer — guided "one voice" via a small local model

> Status: **DESIGN + VALIDATED test kit** (2026-06-04). On Gemma 3 4B, the guided
> contract + the tightened prompt below produced a CLEAN note — every number from
> the contract, no invented number, no invented advice, no padding, warm voice —
> after 3 prompt iterations (each fixed one channel: number fabrication → advice
> fabrication → padding). The deterministic number-validator (below) stays as the
> safety backstop. Recipe proven end-to-end on a phone-sized model.
>
> Implements the
> presentation step of COACHING_TEAM.md §3 ("ONE VOICE") as a *guided* narration
> call: a small local LLM phrases pre-decided facts into the coach's voice. It
> does NOT reason, select, interpret, or invent — the Intelligence Hub / arbiter
> does that and hands this layer a finished contract. Read COACHING_TEAM.md and
> INTELLIGENCE_HUB.md first.

## DECISION (2026-06-04): build validated, deployment DEFERRED
We proved this works on a phone-sized model, then decided **not to ship it yet** —
and that's the right call for now. Reasoning:
- The existing templated Coach narrative already delivers the right CONTENT and
  VOICE (~85% of the value) at ~0% cost: deterministic, instant, free, no app
  bloat, no battery, structurally incapable of fabricating.
- The LLM adds PHRASING (warmer, more varied, melts many signals into one flowing
  paragraph) — polish, not capability. Arnold's intelligence lives in the engine,
  which the model never touches.
- It is NOT a learning model. On-device weights are frozen — it renders, it does
  not learn. Personalization/learning belongs in the deterministic engine (response
  model, calibration, personal thresholds), where it's auditable. The LLM never
  makes Arnold smarter.
- Costs to ship: ~2GB app bloat (or a server + privacy/cost), battery/latency, the
  native on-device inference plumbing, and a permanent prompt+validator maintenance
  surface guarding a fabrication tail you can never fully stop caring about in a
  health app.

**Revisit when EITHER trigger fires:**
1. The **arbiter** (COACHING_TEAM.md) is producing template-resistant output —
   multiple experts arbitrated into one nuanced paragraph WITH the trade-off named.
   That combinatorial richness is what templates can't scale to and what an LLM
   phrases gracefully. This is the main trigger.
2. You want **conversational "ask a coach"** (v3 dialogue) — open Q&A genuinely
   needs an LLM; templates can't do it.

Until then: integration would be a renderer behind the EXISTING Coach (contract →
model → number-validator → template fallback), same surfaces, no new voice. The
contract design above is also the arbiter's output shape, so this work feeds the
Coaching Team build regardless. Shelf it, ready.

## What the local-model test proved (2026-06-04)
We tested three phone-realistic models in LM Studio on real Arnold data
(free-form, raw JSON → "write the coach note"):

| Model | Voice | Salience | In-bounds? |
|---|---|---|---|
| Qwen 3 8B | plainest | weak — buried the overreaching rTSS | yes, but vague |
| Phi-4-mini 3.8B | clinical | strong | **no** — leaked JSON keys, invented "a session on Monday" |
| Gemma 3 4B | **warmest** | **best** — caught the A:C 0.43 vs rTSS 171 tension | **no** — misread calorie target as intake; relied on chat memory for "yesterday" |

**All three are faithful on explicit numbers; none is safe doing selection,
interpretation, or free generation.** Each failed in character, and every failure
was the model doing a job it shouldn't:
- **Selection** — Qwen buried the single most important signal (rTSS 171).
- **Interpretation** — Gemma did math on `calorie_target` vs `calories_left` and
  told the athlete he was "slightly high" when he was 380 *under*.
- **Fabrication / out-of-data reach** — Phi invented "Monday"; Gemma's "yesterday"
  only worked because the prior turn was still in the chat (it'll break in a
  stateless per-day call).

**Chosen narrator: Gemma 3 4B** — warmest voice + best instinct for what matters,
phone-sized. Its two errors are exactly what the contract below removes.

## Principle: the engine decides, the model phrases
The fix is to never give the model anything to decide, interpret, or remember.
It receives a **narration contract** of already-selected, already-interpreted,
already-numbered facts, and its only job is warm phrasing. The three failure
modes map one-to-one onto contract features:

| Failure (observed) | Contract feature that removes it |
|---|---|
| burying the key signal | `must_mention` (engine sets salience + order) |
| misreading numbers | every fact arrives **pre-interpreted + number baked in** — no raw target/intake pairs, no math to do |
| inventing events / reaching to other days | hard "add nothing" rule + the contract is **stateless**: any cross-day comparison is an explicit supplied fact |

Note we also drop the old `NUMBERS USED:` self-audit — in guided mode the engine
already knows every number (it supplied them), and the models' self-audits were
unreliable anyway.

## The narration contract (engine → narrator)
```jsonc
{
  "date": "Wednesday, June 3",
  "tone": "warm, honest, encouraging — never alarmist",
  "max_words": 80,
  "must_mention": [          // ORDERED by priority; every item MUST appear.
    "<one self-contained, already-interpreted fact, number baked in>"
  ],
  "may_mention": [           // optional; model may use for flow, never required.
    "<supporting fact>"
  ],
  "closing": "<pre-written forward line about tomorrow>"
}
```
Rules for the engine when building it:
- **Pre-interpret every number.** Never ship a raw pair the model must reconcile
  (no "target 2600 / left 380" → ship "380 calories under target"). This is the
  single most important rule; it's what broke Gemma.
- **Resolve every value.** Ship "Mobility", never the field `plan_tomorrow`.
- **Pre-compute cross-day context.** "up from 6.2h yesterday" is the ENGINE's
  fact, in `must_mention` — never left to the model's memory.
- **Order `must_mention` by importance.** That's the arbiter's salience call;
  the model just preserves it.
- Keep numbers as the exact strings you want shown ("171 rTSS", "38ms", "6.2h").

## Guided SYSTEM PROMPT (paste into LM Studio's system field)

You are the single voice of Arnold — a personal running and fitness coaching team
(run coach, strength coach, nutritionist) speaking to the athlete as ONE warm,
expert person.

You will receive a NARRATION CONTRACT: a date, a tone, a max word count, an ordered
list of must_mention points, an optional may_mention list, and a closing line.

Your only job: weave the must_mention points into ONE short, warm paragraph in a
coach's voice, then end with the closing line.

Absolute rules:
- Include every must_mention point. Keep every number EXACTLY as written.
- Add NOTHING that is not in the contract — no extra numbers, metrics, advice,
  comparisons, days, or events. If it is not in the contract, it does not exist.
- NEVER introduce a number, percentage, or unit that is not already written in a
  must_mention or may_mention line. If a point has no number, keep it qualitative —
  do NOT attach a figure to make it concrete. (Test learning: Gemma turned a
  number-free "readiness holding steady" into an invented "steady at 75%".)
- Give NO advice, recommendation, reminder, tip, or instruction — about hydration,
  nutrition, stretching, pacing, or anything — UNLESS it is written verbatim in a
  must_mention or closing line. (Test learning: blocked from inventing a number,
  Gemma instead padded with "remember to focus on hydration and continue your
  nutrition plan" — none of which was in the contract.) Warm connective phrasing
  ("nice work", "we'll build on this") is fine; new substantive content is not.
- Do not pad. If the points are few, the paragraph is short. Shorter is correct.
- Do no math and do not reinterpret a fact; phrase it as given.
- Reference no day other than today and the plan named in the closing line.
- may_mention points are optional — use only if they help the flow; add no detail
  beyond them.
- Weave the closing line in naturally as the final sentence — do not prefix it
  with "Plan tomorrow:" or any label.
- Tone as specified: honest, encouraging, never alarmist or clinical.
- At or under max_words. One paragraph. No headings, lists, field names, or quotes
  around words.
- Output ONLY the paragraph. Do not append a "NUMBERS USED" line, notes, or
  anything after the paragraph.

## Worked example A — the HYROX day (paste as the user message)

Here is today's narration contract. Write the coach note.

```json
{
  "date": "Wednesday, June 3",
  "tone": "warm, honest, encouraging — never alarmist",
  "max_words": 80,
  "must_mention": [
    "Today was your first HYROX, so there's no prior session to compare it against yet.",
    "It was a big effort — training load landed at 171 rTSS, in the overreaching zone.",
    "Your acute-to-chronic load is still only 0.43, so this was a hard spike on a light base, not a sign you're overtrained.",
    "On fuel you finished 380 calories under target and 40g short on protein.",
    "Recovery signals are a touch low — HRV 38ms (borderline) and only 6.2h of sleep."
  ],
  "may_mention": [
    "Average heart rate was 159 over the 94-minute session."
  ],
  "closing": "Tomorrow is mobility — lean into the recovery."
}
```

Expected vs the free-form run: the calorie line now reads "380 under target"
(impossible to misread), the overreaching rTSS is surfaced (it's must_mention),
the A:C tension is already resolved for the model, and nothing like "Monday" can
appear.

## Worked example B — sparse rest day (the null-trap, fixed)

Here is today's narration contract. Write the coach note.

```json
{
  "date": "Thursday, June 4",
  "tone": "warm, encouraging",
  "max_words": 55,
  "must_mention": [
    "Today is a rest day.",
    "Sleep bounced back nicely — 7.9h and a sleep score of 88, up from 6.2h yesterday.",
    "Your readiness trend is holding steady."
  ],
  "may_mention": [],
  "closing": "Tomorrow, ease into an easy run."
}
```

Note: the "up from 6.2h yesterday" comparison is now an explicit engine-supplied
fact (not the model's memory), and HRV — which was `null` — simply isn't in the
contract, so the model can neither mention nor invent it.

## What to verify when you re-run on Gemma
- The calorie line says "under target" — no misread.
- The overreaching rTSS appears (salience fixed).
- No invented day/event; no "yesterday" except the supplied one.
- Warm, ≤ max_words, one paragraph, no field names or stray quotes.
If those all hold, the architecture is validated end-to-end on a 4B model.

## How the engine builds the contract (wiring)
- **Now (prototype):** a templating step turns the presentation-layer data
  (the registry values we built) + attribution.js output into `must_mention`
  strings — pre-interpreted, pre-numbered, ordered by a simple priority rule
  (race/overreaching > load tension > fuel gap > recovery). Call the model via
  LM Studio's local server (OpenAI-compatible, `http://localhost:1234`).
- **Later (the real thing):** the **arbiter** (COACHING_TEAM.md) emits exactly
  this contract as its output shape — `must_mention` IS the arbiter's prioritized
  recommendation list, already explainable and number-carrying. The narrator is
  unchanged. So building the contract now also pins down the arbiter's output.
- **Deployment:** prototype against LM Studio; on-device later via Gemma 3 4B /
  Phi-4-mini (MediaPipe LLM / MLC) for privacy + zero cost; or a small server-side
  endpoint if offline isn't required.

## Deterministic guardrail (engine-side) — the real safety net
Prompt rules reduce fabrication but do NOT eliminate it: in the guided test,
Gemma still invented "75%" on a deliberately number-free point. So the durable
fix is NOT a better prompt — it's a deterministic validator the engine runs on
every generated note, because the engine already knows the exact set of numbers
it supplied:

1. Build `allowedNumbers` = every numeric token across the contract's
   must_mention + may_mention + closing (e.g. {171, 0.43, 380, 40, 38, 6.2}).
2. Extract every numeric token from the model's output (regex `/\d+(\.\d+)?/g`).
3. If ANY output number is not in `allowedNumbers` → reject and regenerate
   (optionally with a one-line "you added a number that wasn't provided" nudge),
   up to N retries; then fall back to a plain templated note.

This makes shipping a fabricated number structurally impossible, on ANY model,
regardless of prompt adherence. It is the belt to the prompt's suspenders, and
it's ~10 lines of code. (Optional stricter version: also flag invented
day-names/events with a small keyword check, but the number check catches the
highest-stakes case.)

## Non-negotiables
- The model phrases; it never selects, interprets, computes, or remembers.
- Every number reaches the model already correct and already in display form.
- Cross-day context is supplied, never recalled.
- The contract is the arbiter's output shape (forward-compatible with COACHING_TEAM.md).
- A deterministic number-validator gates every note before it is shown — the
  prompt is not trusted to prevent fabrication on its own.
