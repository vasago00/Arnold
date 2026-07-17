# Arnold — LLM: Prior Results, On-Device Integration, and No-Account Inference (2026-07-17)

> Emil's three questions: (1) what did our earlier LLM tests show, (2) how do we run an LLM on the
> phone without eating memory, and (3) how do we avoid needing an LLM account + tokens. Short answer
> to (2)+(3): **run the model on-device.** Your Galaxy S25 Ultra ships with a system LLM (Gemini Nano)
> that needs no account, no API key, no tokens, no network — and doesn't even count against our app's
> memory. And because our coach only asks the model to *rephrase certified facts* (a tiny task), a
> small model is plenty.

---

## 1. What we already built and tested (the prior "LLM tests")

The existing LLM path is **cloud Claude**, in `src/core/ai.js`:

- `ai()` / `aiStream()` call Anthropic's Messages API (model `claude-sonnet-4-5`) through our **Cloudflare
  Worker proxy** — the API key lives as a Worker secret (not in the bundle), CORS is avoided, and it's
  rate-limited to **60 calls/hour per token**. A direct-browser call is the fallback.
- It powers the **weekly health summary** (`aiSummary` → `buildFullPrompt`): it packs DEXA, VO2max, RMR,
  the last two blood panels, 7 days of logs, and the supplement stack into one prompt and streams back a
  structured markdown summary (overview, trends, what's improving, what needs attention, 3 actions).
- Note: `coachingPrompts.js` looks AI-ish but is **rules-based**, not an LLM — deterministic daily prompts.

**What the test showed.** The recorded feedback was that the weekly summary "in the coach line is fine" —
i.e. it produced usable, genuinely data-driven summaries; the asks were **branding and colour** (use Coach
branding, drop the yellow warning hue), not quality. There was no formal benchmark table; the honest
takeaway is *"cloud Claude writes a good summary."*

**The catch — and why your questions matter.** That path is **cloud**: it needs the Worker configured, an
Anthropic key, **tokens (cost), a network connection, and it's rate-limited**. That's acceptable for a
rich, occasional, user-initiated *weekly report*. It is the wrong shape for the **always-on coach voice**
we've been building (fires on every Daily/Fuel/Plan render). For that we want no account, no per-call cost,
and offline — which means on-device.

**The lever that makes this easy:** in the Stage 2/3 architecture the LLM's *only* job is to **select and
rephrase over certified facts** — bounded input, ~1–2 sentences out. That is a small-model task. We do
**not** need a Claude-class cloud model for the coach voice; we need a competent phraser.

---

## 2. No account, no tokens: the on-device answer

Two real paths, both with **no API key, no account, no tokens, and offline inference**.

### Path A (recommended) — Gemini Nano via Android AICore + ML Kit GenAI

- The model is **system-provided and shared across apps** through **AICore** (an Android system service), so
  there is **no model download in our app, no account, no API key, no network, and no per-call cost**. It
  runs on the phone's NPU. ([ML Kit GenAI](https://developers.google.com/ml-kit/genai),
  [Android · Gemini Nano](https://developer.android.com/ai/gemini-nano))
- **Your device is explicitly supported.** ML Kit GenAI lists Samsung Galaxy **S25/S26**, Pixel 9/10, OnePlus
  13/15, and others. The Galaxy S25 Ultra (SM-S938U) is in scope. ([ML Kit GenAI](https://developers.google.com/ml-kit/genai))
- **The APIs are exactly our phraser.** ML Kit exposes **Rewrite** ("transform messages across tones/styles"),
  **Proofread**, **Summarize**, Image Description, and a general **Prompt API** (custom text prompt). Our
  phraser is a Rewrite/Prompt call: *"rewrite this coach note warmly, using only these facts."*
  ([ML Kit GenAI overview](https://developers.google.com/ml-kit/genai),
  [Android Developers blog](https://android-developers.googleblog.com/2025/08/the-latest-gemini-nano-with-on-device-ml-kit-genai-apis.html))
- **Memory: effectively free for us.** Nano lives in AICore, not our app heap — we don't pay the model's RAM.
  This is the single biggest reason to prefer Path A on your phone.
- **Cost of adoption:** a **small native Capacitor plugin** that bridges the ML Kit GenAI Kotlin/Java API to
  our JS (Capacitor's WebView can't call ML Kit directly). Android-only; flagship-gated. No iOS equivalent
  today (there we use Path B, or Apple's on-device models later).

### Path B (portable fallback) — a small quantized model in the WebView via WebGPU

- Run a **1–3B, 4-bit** model (e.g. **Gemma-3n**, **Qwen2.5-1.5B**, **Llama-3.2-1B**) locally in the WebView
  using **WebGPU**, via **LiteRT-LM JS** (the successor to MediaPipe's web LLM API, now maintenance-mode) or
  **WebLLM**. **No account, no key, no tokens**, offline after a one-time model download.
  ([MediaPipe LLM Web](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js),
  [WebLLM](https://webllm.mlc.ai/docs/))
- **Cross-platform** (any WebGPU-capable WebView) — no native plugin needed.
- **Costs:** a one-time **~0.6–2 GB model download**, and it uses **real app/WebView memory + battery** while
  loaded; WebGPU-in-WebView is itself flagship-dependent. The MediaPipe web path is maintenance-only → target
  **LiteRT-LM**.

Rough on-device footprints (4-bit): **1B ≈ 0.6–0.8 GB**, **1.5–2B ≈ 1–1.5 GB**, **3B ≈ 1.8–2.2 GB**, plus KV
cache + runtime. Path A avoids all of this by using the shared system model.

---

## 3. Keeping mobile memory small (the rules)

1. **Don't run per render — precompute once per day / per meaningful data change, and cache.** The coach voice
   only needs regenerating when the underlying facts move. (Already in the architecture's cost/latency section.)
2. **Prefer Gemini Nano (Path A):** the model is not in our memory budget at all — AICore owns it.
3. **If we bundle a model (Path B):** pick the smallest that phrases well (**1–1.5B Q4 ≈ 0.7–1 GB**), **load
   lazily, unload right after the daily generate**, run **off the main thread**, and **cap `maxTokens`** — our
   output is one or two sentences, so the KV cache and generation stay tiny.
4. **The task is small by design.** The model rephrases certified facts; it never does physiology or math and
   never holds a big context. Small input + short output = small memory, fast, low battery.

---

## 4. How it plugs into what we've already built (Stages 2–3)

The seam is already in the code — **`coachPhraser.phraseNarrative(source, { phraser })`**. The `phraser`
callback is the *only* place a model ever runs. On-device wiring is just supplying that callback:

- **Path A:** `phraser = (text) => nanoRewrite(text)` via the Capacitor ML Kit plugin.
- **Path B:** `phraser = (text) => litertGenerate(text)` in the WebView.

**Safety is unchanged and is what makes a small on-device model acceptable.** Every candidate goes through
**`factCheck(candidate, grounding)`** — where `grounding` is now the **certified-fact set** we built in
Stage 2. If the model invents a number or a race name, it's rejected and we **fall back to the deterministic
composer text**. So even a small, occasionally-wobbly on-device model can't make the coach lie — worst case
it sounds a touch more mechanical. And on any phone with **no on-device model** (older Android, iOS, no
WebGPU), the deterministic text simply ships as-is. Nothing breaks.

---

## 5. Recommendation

- **Weekly summary:** keep it on **cloud Claude** (rich, occasional, user-initiated — fine to need
  network/tokens there, or make it an opt-in "generate" button).
- **Always-on coach voice:** go **on-device**. Primary = **Gemini Nano via a small Capacitor ML Kit plugin**
  (no account, no tokens, no memory hit, your S25 Ultra is supported). Portable fallback = **LiteRT-LM / WebLLM**
  small model in the WebView for non-Nano devices.
- **Sequence:** this is **Stage 3**. Order of work: (a) finalize the `phraser` callback interface against the
  Stage 2 certified grounding (deterministic + a stub), (b) a **spike** of the Nano Rewrite plugin on your
  phone to sanity-check latency/quality, (c) A/B the phrased vs deterministic output, policed by `factCheck`
  + the Monte-Carlo sim. All of it lands behind the verifier we already built.

---

## 6. Correction — Gemma is the workhorse, Nano is an optional fast-path (2026-07-17)

Emil's pushback (correct): *we already tested Gemma and Qwen in LM Studio, and **Gemma 3 4B** was best —
no hallucinations. So how is Gemini Nano "better"?* It isn't — I overstated §5. Nano is not a better
**model**; a 4B-class Gemma is at least as strong on our task, and you have direct evidence for it. Nano's
pitch was purely **operational** (system-provided, no download, no app-heap on supported phones, no account).
And it turns out that operational edge is now largely **matched by Gemma itself**, so the model you validated
becomes the primary choice.

**What changed the math:** Gemma now ships in a mobile-tuned, cross-platform runtime — **LiteRT-LM** — as the
`litert-community/gemma-4-E4B` build (the current heir to the Gemma 3 4B / 3n line you tested). Measured from
its model card:

- **One model file, 3.66 GB, memory-mapped** (2.24 GB weights + 0.67 GB embeddings). No key, no account, no
  network — fully on-device.
- **RAM footprint is small on GPU:** ~**710 MB on a Galaxy S26 Ultra (GPU)**, ~**961 MB on iPhone 17 Pro (CPU)**;
  ~3.3 GB only on the CPU-XNNPACK path. On the NPU/GPU your phone will use, this is roughly a **~0.7 GB** resident
  cost — not the 2.5–3 GB I implied for a 4B model.
- **Runs everywhere from one model:** Android, iOS, Windows, Linux, macOS, and **Web/WASM via WebGPU**, with
  **JavaScript, Kotlin, Swift, Flutter** APIs. ([litert-community/gemma-4-E4B](https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm),
  [LiteRT-LM mobile deploy](https://gemma4-ai.com/blog/gemma4-mobile-deploy))
- Lighter sibling **E2B** (~2B effective) exists for weaker devices; a 1B for the floor.

So the honest comparison:

| | **Gemma (E4B via LiteRT-LM)** | **Gemini Nano (AICore/ML Kit)** |
|---|---|---|
| Quality on our task | **Validated by you (no hallucinations)** | Unverified for us; likely a notch below E4B |
| Account / tokens / network | None | None |
| App memory | ~0.7 GB (GPU), memory-mapped | **~0 in our heap** (system service owns it) |
| Download | One-time ~3.66 GB (or bundled) | **None** (system-provided) |
| Device coverage | **Android · iOS · desktop · web/WebGPU** | **Android flagships only** (AICore) |
| Control / versioning | **Ours — pinned, testable** | Google's — version can shift under us |

**Revised recommendation:** make **Gemma (E4B via LiteRT-LM) the workhorse** — it's what you validated, it's
cross-platform, and on GPU it's cheap. Treat **Gemini Nano as an optional fast-path** on AICore Androids (its
one real win is *zero app-heap memory*), adopted **only if it clears the same factCheck + sim bar** Gemma passes.
Neither decision is risky, because `factCheck` backstops hallucination either way and the deterministic composer
is the floor.

### The tiered, capability-detected phraser (how it fits a broad device range)

One `phraser` interface, best available runtime chosen at load time — every tier lands behind the SAME
`factCheck(candidate, certifiedGrounding)` boundary, so quality/safety are identical regardless of which ran:

1. **Native LiteRT-LM Gemma E4B** (Android/iOS with GPU/NPU) — best perf, ~0.7 GB, memory-mapped. *Primary.*
2. **LiteRT-LM JS + WebGPU in the WebView** — the **write-once web + Capacitor path**; same Gemma model, no
   native plugin. Covers web and any WebGPU-capable mobile WebView.
3. **Gemini Nano** (AICore Androids) — optional; picked when present *and* quality-passing, for its zero-heap win.
4. **Gemma E2B / a 1B** — weaker devices that can't hold E4B.
5. **Deterministic composer** — no WebGPU / no NPU / iOS-without-WebGPU / old Android. Always available. *Floor.*

### Wiring it for web **and** mobile

- **Web (and the Capacitor WebView):** load the Gemma `.litertlm` with **LiteRT-LM's JS API over WebGPU** — the
  same JavaScript runs in the browser and inside the app's WebView. This is the one-code-path option and gets us
  web + mobile at once wherever WebGPU is present.
- **Native mobile (perf/coverage upgrade):** a thin **Capacitor plugin** calling LiteRT-LM's **Kotlin (Android)**
  / **Swift (iOS)** API, so inference uses the NPU/GPU and the model is memory-mapped (lowest RAM). Same plugin
  shape whether it wraps LiteRT Gemma or ML Kit Nano — the JS side just sees `phraser(text) → string`.
- Model delivery: **download-on-first-use** (with a Wi-Fi/consent gate) or bundle E2B; cache locally; never blocks
  the deterministic path.

Net: we standardize on **Gemma via LiteRT-LM** as the model + runtime (your validated choice, truly
cross-platform), expose it through the existing `phraser` seam, detect device capability to pick native vs
WebGPU-JS vs Nano vs deterministic, and let `factCheck` + the sim keep every tier honest.

---

## 7. The model menu, how we choose, wiring, and lifecycle (2026-07-17)

### 7.1 The candidate menu (on-device text LLMs that actually have LiteRT builds)

Pulled from `huggingface.co/litert-community` (the rest of that org is vision/audio/OCR/image — not relevant).
Text-generation LLMs, by family:

- **Gemma:** `gemma-4-E4B`, `gemma-4-E2B`, `Gemma3-1B-IT`, `gemma-3-270m`; **`MedGemma-1.5-4B-IT`** (health-tuned,
  same 4B size — a strong Arnold-specific candidate); desktop-class `gemma-4-12B / 26B-A4B / 31B` (ignore for phone).
- **Qwen:** `Qwen3-4B`, `Qwen3-4B-Instruct-2507`, `Qwen3-1.7B`, `Qwen3-0.6B`, `Qwen2.5-1.5B/0.5B` (+ Qwen-derived
  TinySwallow-1.5B, VibeThinker, Jan-nano, Polaris-4B).
- **Llama:** `Llama-3.2-3B`, `Llama-3.2-1B`, `TinyLlama-1.1B`.
- **Phi:** `Phi-4-mini-instruct`, `Phi-4-mini-reasoning`.
- **SmolLM:** `SmolLM3-3B`, `SmolLM2-360M/135M`.
- **Others:** `Ministral-3-3B` (Mistral), `OLMo-2-1B`, IBM `granite-4.0-350m`, `DeepSeek-R1-Distill-Qwen-1.5B/7B`.
- **Embeddings (for the Stage-4/9 memory + retrieval layer, NOT the voice):** `embeddinggemma-300m`, `Gecko-110m`.

**Industry cross-check (what's actually shipped on-device / in-browser):** the field consolidates on exactly
these families — **Gemini Nano** (Android AICore; Chrome built-in Prompt/Rewrite APIs), **Apple's ~3B on-device
model** (iOS Foundation Models), **Gemma 3n/4 E2B-E4B**, **Llama-3.2 1B/3B**, **Phi-3.5/Phi-4-mini**, **Qwen
2.5/3 (0.5–4B)**, **SmolLM2/3**. Web runtimes: Chrome built-in AI (Nano), **WebLLM (MLC)**, **transformers.js**,
**MediaPipe/LiteRT-LM Web** — all over WebGPU; the universal engine underneath is **llama.cpp (GGUF)**. Your two
LM-Studio winners (Gemma 4B, Qwen) are squarely in the mainstream, so we ship what the field ships.

### 7.2 How we choose the best for OUR use case

Our use case is narrow: **a phraser** — rewrite a certified-fact paragraph into one warm, natural, ~1–2 sentence
read, using *only* the supplied facts. That means we optimise for a specific profile, not "smartest model":

| Weight | Criterion | Why it matters here |
|---|---|---|
| **Highest** | **Faithfulness / no additions** | The whole safety model — must not invent. (You found Gemma 3 4B best on this.) |
| High | Instruction-following on a constrained rewrite | It has to obey "only these facts, this tone, this length." |
| High | Fluency + tone (warm, non-robotic) | This is literally the product value. |
| High | Footprint + latency on target devices | ~0.7 GB GPU, sub-second, low battery. |
| Med | License for commercial use | Gemma (Gemma license), Qwen/Phi/SmolLM (Apache-2.0/MIT) = clean; Llama (Meta license) = check. |
| Med | LiteRT on-device build exists | So it runs on web + mobile from one asset. |
| Bonus | Domain fit | **MedGemma** is health-tuned at the same 4B. |

We do **not** need reasoning, math, long context, coding, or multilingual — so a 1–4B model is the sweet spot and
bigger is not better (it's just heavier).

**The choice is data-driven, via our own harness — not vibes.** This is exactly what roadmap **Stage 5 (quality
eval)** is for. We run each candidate (Gemma E4B, Qwen3-4B, MedGemma-4B, and a small fallback like Qwen3-0.6B)
through the **Monte-Carlo sim × thousands of real coach contexts**, and score three things:

1. **`factCheck` pass rate** — must be ~100%; any candidate that leaks unsourced numbers/entities is out.
2. **LLM-as-judge rubric** — appropriate for the moment, right tone, non-nagging, actually more natural than the
   deterministic text.
3. **Latency + resident memory** on the target device tier.

The winner per tier is whatever tops that scorecard. So "which model" becomes a **measured** decision we can
re-run any time a new model appears — not a permanent commitment.

### 7.3 What wiring requires

The seam already exists (`coachPhraser.phraseNarrative(source, { phraser })`); wiring = supplying the callback:

- **Web + Capacitor WebView (one code path):** load the `.litertlm` with **LiteRT-LM's JS API over WebGPU**;
  `phraser = (text) => litert.generate(prompt(text))`. Covers web and any WebGPU-capable mobile WebView.
- **Native mobile (perf/coverage):** a thin **Capacitor plugin** over LiteRT-LM **Kotlin (Android)** / **Swift
  (iOS)** (or ML Kit for Nano). Same JS contract: `phraser(text) → string`.
- **Capability detection** at startup picks native → WebGPU-JS → Nano → deterministic.
- **Model delivery:** bundle a small model, or **download-on-first-use** behind a Wi-Fi/consent gate; cache
  locally; **pin the exact version**; never block the deterministic path while loading.
- **Prompt = the `PHRASER_CONTRACT`** we already wrote, fed the certified `grounding`; output re-checked by
  `factCheck`. Nothing new on the safety side.

### 7.4 Do these models degrade? Maintenance, updates, ownership

**No — the weights do not rot.** A model file is deterministic bytes; same input → same output, indefinitely. There
is no physical decay and no self-drift. What changes is the *world around the file*, in four ways — and our
architecture makes three of them nearly free:

1. **Knowledge staleness — mostly irrelevant to us.** A model's training-cutoff world knowledge ages, but **our
   model never supplies facts** — the deterministic engine certifies every number/claim and the model only
   rephrases them. So a "2026" model still phrasing our 2028 facts is fine; it's not being asked what it *knows*.
   This is a direct payoff of the fact/reasoner split.
2. **Ecosystem drift — optional upgrades.** Better/smaller models keep coming (Gemma 4→5, Qwen3→4). Staying put
   just leaves some quality/efficiency on the table; it doesn't break anything. We adopt a new one **only if the
   Stage-5 harness shows a real win.**
3. **Runtime / OS drift — the real (small) maintenance.** LiteRT-LM, WebGPU, and AICore evolve; an OS update can
   change NPU drivers or WebView behaviour. Keeping the **runtime library + native plugin** current and re-testing
   on new OS versions is the actual ongoing task — not the weights.
4. **Vendor re-releases — occasional, optional.** Model makers sometimes ship safety/bug-fix revisions; we pick
   them up on our schedule. (Gemini Nano is the exception: **Google auto-updates it on-device**, so it can shift
   under us — which is exactly why we pin our *own* Gemma as the primary and treat Nano as an optional fast-path.)

**Maintenance model & cadence:**

- **Pin** the model version (immutable) → reproducible output.
- **Gate every change** (model or runtime) behind the eval harness → no silent regressions.
- **Re-evaluate new small models ~2×/year**; upgrade only on a measured win.
- **Track** runtime/OS compatibility and license/deprecation notices.

**Who does what:**

- **The model vendors** (Google / Alibaba / Meta / Microsoft) train, maintain, and release the models — **free**.
  We never train or host weights.
- **Google** maintains and auto-updates **Gemini Nano** on the device (zero work for us, less control).
- **We** (you + me) own the *integration*: pin the version, maintain the LiteRT plugin/runtime, run the eval
  harness as the upgrade gate, and decide when a new model is worth adopting.

**The reassurance:** because the LLM is only a phraser, gated by `factCheck`, with the deterministic composer as
the floor, **model maintenance is low-stakes and optional.** If we never touched the model again, Arnold's coach
keeps working correctly — the phrasing just stays constant. Upgrades are opportunistic quality gains, never
survival requirements. A stale, broken, or even removed model degrades gracefully to the deterministic voice.

---

## Sources

- litert-community/gemma-4-E4B-it (LiteRT-LM; footprints, platforms, no key/account) — https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm
- litert-community/gemma-4-E2B-it (lighter sibling) — https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
- LiteRT-LM Android / iOS / CoreML / AI Edge deploy guide — https://gemma4-ai.com/blog/gemma4-mobile-deploy

- litert-community org — full on-device model listing (Gemma/Qwen/Llama/Phi/SmolLM + MedGemma, embeddings) — https://huggingface.co/litert-community
- MedGemma (health-domain Gemma) — https://huggingface.co/litert-community/MedGemma-1.5-4B-IT
- ML Kit GenAI (on-device, no key/account/network; supported devices incl. Galaxy S25/S26) — https://developers.google.com/ml-kit/genai
- Android · Gemini Nano — https://developer.android.com/ai/gemini-nano
- The latest Gemini Nano with on-device ML Kit GenAI APIs (Android Developers Blog) — https://android-developers.googleblog.com/2025/08/the-latest-gemini-nano-with-on-device-ml-kit-genai-apis.html
- On-device GenAI APIs as part of ML Kit (Gemini Nano) — https://android-developers.googleblog.com/2025/05/on-device-gen-ai-apis-ml-kit-gemini-nano.html
- MediaPipe LLM Inference for Web (WebGPU; maintenance-mode → LiteRT-LM) — https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/web_js
- WebLLM (in-browser WebGPU inference) — https://webllm.mlc.ai/docs/
