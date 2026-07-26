# On-Device Coach Voice — Spike Runbook (2026-07-17)

> Goal of the spike: get a small LLM **phrasing the coach voice on your device**, gated by everything
> we've built (certified facts → `factCheck` → cache → deterministic fallback). This is the "does it
> load, is it fast enough, does it read better?" experiment — not the final production wiring.
>
> The software is done and tested: `coachReasoner.js` (boundary + cache + fallback),
> `coachReasonerAdapter.js` (prompt builder, 10/10 tests), `coachModel.js` (WebGPU loader). The only
> things that must happen on your machine are: install a runtime, load a model, flip it on, and add a
> few lines to the render site so the phrased text shows.

---

## The pieces (already in the repo)

- **`coachReasoner.js`** — `reasonNarrative()` runs a model over certified facts, verifies output ⊆
  facts, caches once per data-change, falls back to the deterministic composer on ANY failure.
  `reasonedNarrative(ctx, surface)` is the drop-in for `narrateSurface`. `registerReasoner(fn)` is the slot.
- **`coachReasonerAdapter.js`** — `makeReasoner(generate)` turns any `generate({system,user})=>string`
  into that reasoner, building the prompt from the certified facts + the `PHRASER/REASONER_CONTRACT`.
- **`coachModel.js`** — opt-in, WebGPU-gated loader. `registerCoachReasoner()` loads a WebLLM model and
  registers it. No-ops safely if disabled / no WebGPU / package missing.

---

## Step 1 — install a WebGPU runtime (fastest path: WebLLM)

```powershell
cd C:\Users\Superuser\Arnold\arnold-app
npm install @mlc-ai/web-llm
```

WebLLM runs a quantized model in the browser/WebView over **WebGPU**, no native build, no account, no
tokens. (LiteRT-LM JS is the Gemma-native alternative — same shape; swap the `load` fn in `coachModel.js`.)

Model choice for the first run (small = fast first token; size up once it loads):
- `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` — default in `coachModel.js` (~1 GB), your Qwen, quick.
- `gemma-2-2b-it-q4f16_1-MLC` — your Gemma family, a bit heavier.
- Later: a 4B build once you've confirmed load + latency.

## Step 2 — turn it on + register at startup

The loader is **opt-in** so nothing downloads unless you ask. In the app (or DevTools console):

```js
import { setEnabled, registerCoachReasoner } from './core/coachModel.js';
setEnabled(true);                                  // localStorage flag 'arnold:coach:llm' = 'on'
const res = await registerCoachReasoner({ onProgress: p => console.log('[coach-llm]', p.text) });
console.log(res);                                  // { ok: true, reason: 'registered' } on success
```

Call `registerCoachReasoner()` once at app boot (behind `isEnabled()`), e.g. in your top-level effect.
On desktop Chrome/Edge WebGPU is on; on the S25 Ultra WebView, confirm `navigator.gpu` exists (Step 5).

## Step 3 — show the phrased text (the ONE render-site edit)

`reasonedNarrative` is async (inference takes a beat), so render the deterministic voice instantly and
**upgrade** to the phrased version when it resolves. In `CoachComment.jsx`, alongside the existing
deterministic `narrative`:

```jsx
import { reasonedNarrative } from '../core/coachReasoner.js';
import { getReasoner } from '../core/coachReasoner.js';

// after `coachCtx` is built and the deterministic narrative is in hand:
const [phrased, setPhrased] = useState(null);   // { key, text }
useEffect(() => {
  if (!getReasoner() || !coachCtx) return;
  const key = `${surface}|${localDate()}`;       // one phrase per surface per day (cache does the rest)
  let alive = true;
  reasonedNarrative(coachCtx, surface, localDate())
    .then(r => { if (alive && r && r.source === 'reasoner') setPhrased({ key, text: r.text }); })
    .catch(() => {});
  return () => { alive = false; };
}, [surface, storageVersion, tick]);   // recompute when the underlying data changes

// when choosing the body text for a narrative-driven surface, prefer the phrased text:
const shownText = (phrased && phrased.key === `${surface}|${localDate()}`) ? phrased.text : body;
```

Deterministic shows first; the warmer line swaps in ~sub-second once verified. If the model is off or
fails, `phrased` never sets and you see today's exact deterministic voice. (Keep this change small and
behind `getReasoner()` so it's a no-op until the model is registered.)

## Step 4 — A/B and judge it

- Toggle with `setEnabled(false)` / `true` (+ reload) to compare phrased vs deterministic on the same day.
- Every phrased line already passed `factCheck` — it can't have invented a number or named the wrong
  race. If it ever looks wrong, that's a prompt/tone issue, not a safety one; capture the case.
- When you want it scored, we wire the Stage-5 `JUDGE_RUBRIC` to run the model-as-judge over sim days
  and compare Gemma vs Qwen vs MedGemma head-to-head — that's how "which model" becomes a measured call.

## Step 5 — the phone

On the S25 Ultra, the WebView needs WebGPU. Confirm in the app: `console.log(!!navigator.gpu)`. If it's
missing on the installed WebView version, the deterministic voice just stays (safe), and the native
route (LiteRT via a Capacitor plugin, or ML Kit / Gemini Nano) is the fallback — a bigger lift we do
after the WebGPU path proves the value on desktop.

---

## What to watch (from the strategy doc)

- **Load time + model size** — first load downloads + compiles the model (cached after). Note the wait.
- **First-token / full-line latency** — our output is 1–2 sentences, so keep `max_tokens` small (~220).
- **Memory** — a 1.5–2B q4 model is ~1 GB resident on GPU; fine on your hardware, watch the phone.
- **Cost/latency guard is already in** — the reasoner caches per data-change, so the model runs at most
  once per surface per meaningful change, never per render.

## Decision after the spike

If a small model reads clearly better and loads/runs acceptably → size up (4B / MedGemma), wire the
Stage-5 judge to pick the winner, and decide native-vs-WebGPU per platform. If not → the deterministic
voice is already strong; we keep the seam dormant and revisit when runtimes improve. Either way, nothing
in the app regresses: the model only ever *replaces phrasing behind the verifier.*
