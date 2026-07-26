// core/coachModel.js — the ON-DEVICE model loader (Stage 3 spike, DEVICE-SIDE).
//
// This is the only piece that touches an actual model runtime. It lazy-loads a small LLM in the
// WebView over WebGPU (the write-once web + Capacitor path from LLM_ON_DEVICE_STRATEGY.md), wraps its
// generate() with the reasoner adapter, and registers it via coachReasoner.registerReasoner(). After
// that, coachReasoner.reasonedNarrative() phrases the coach voice through the model — bounded by
// factCheck, cached once per data-change, deterministic fallback on anything.
//
// SAFE BY CONSTRUCTION:
//   • OPT-IN — does nothing unless the synced pref (or legacy localStorage) says 'on' (never auto-loads).
//   • FEATURE-GATED — no WebGPU → no-op → deterministic voice, unchanged.
//   • CAPABILITY-GATED — a weak GPU (integrated / low VRAM) gets a smaller model and a shrunk KV cache,
//     and if the device is lost anyway we UNREGISTER and fall back to the deterministic voice silently.
//   • LAZY + DYNAMIC import — the model package is only fetched when you turn it on, so the normal
//     build/bundle is untouched if the dependency isn't installed.
//   • FULLY GUARDED — any failure (no GPU, package missing, load error, OOM, device-lost) → we simply
//     don't register a reasoner (or unregister a dead one), and every surface renders the deterministic
//     composer exactly as today.
//
// This module is intentionally NOT imported anywhere by default. Call registerCoachReasoner() once
// at app start (behind the opt-in flag) — see ON_DEVICE_MODEL_SPIKE.md.
//
// NOTE: not node-unit-tested — it needs WebGPU + a model runtime (device-only). The logic it depends
// on (adapter, verifier, cache) is fully tested; this is the thin runtime shim.

import { registerReasoner, getReasoner } from './coachReasoner.js';
import { makeReasoner } from './coachReasonerAdapter.js';
import { storage } from './storage.js';

const PREF_KEY = 'coachLlmPref';       // SYNCED storage key (rides Cloudflare LWW — set in Profile)
const FLAG_KEY = 'arnold:coach:llm';   // legacy / pre-sync localStorage fallback

// Model ladders, heaviest → lightest. We pick a starting rung from the GPU's reported limits, then step
// DOWN on a load failure. Quality note from the LM-Studio + WebLLM spike: 1.5B keeps facts faithfully;
// 0.5B is terser and can drop a figure — but factCheck only allows OMISSION (never invention), so even
// the smallest rung is safe, just plainer. Gemma-2-2B is the top rung: best warmth, but it hangs weak
// integrated GPUs (Intel iGPU → DXGI_ERROR_DEVICE_HUNG), so it's reserved for capable GPUs only.
//
// f16 vs f32: the q4f16_1 builds need the WebGPU `shader-f16` feature. Adreno/Apple/most discrete GPUs
// have it; many Intel iGPUs do NOT — there, every f16 model fails to load (Emil's web "couldn't start").
// The q4f32_1 builds use the same 4-bit weights with f32 compute, so they run WITHOUT shader-f16. We
// detect the feature and start on the matching ladder, and cross over to the other precision as a last
// resort if detection was wrong.
const LADDER_F16 = [
  'gemma-2-2b-it-q4f16_1-MLC',            // strongest voice — capable GPUs (discrete / strong mobile) only
  'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',    // spike winner for faithfulness — the safe default
  'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',    // last resort so it still RUNS on the weakest GPUs (terser)
];
// No shader-f16 (many Intel iGPUs). Same 4-bit weights, f32 math. Skip Gemma here — a no-f16 GPU is by
// definition not a strong modern GPU, so we don't attempt the heavy rung.
const LADDER_F32 = [
  'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
  'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
];
const MODEL_LADDER = LADDER_F16;   // back-compat alias (the default precision)
// The safe default: faithful, and light enough for integrated GPUs. Callers can override via opt.modelId.
const DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

// The precision ladder for a GPU: f32 builds only when shader-f16 is explicitly absent (f16 === false);
// otherwise the f16 ladder (the common, faster case, and the safe default when detection is unknown).
function ladderFor(f16) { return f16 === false ? LADDER_F32 : LADDER_F16; }
const isF32Model = (id) => LADDER_F32.includes(id);

function prefRaw() { try { return storage.get(PREF_KEY); } catch { return null; } }

export function isEnabled() {
  try {
    // URL override so you can flip it WITHOUT the Profile toggle (handy for a quick test): ?llm=on/off.
    // Persists to the synced pref (idempotent — only writes when it actually changes).
    const q = (typeof location !== 'undefined' && location.search) ? new URLSearchParams(location.search).get('llm') : null;
    if (q === 'on' || q === 'off') { const want = q === 'on' ? 'on' : 'off'; if (prefRaw() !== want) setEnabled(q === 'on'); }
    const pref = prefRaw();
    if (pref === 'on' || pref === true) return true;
    if (pref === 'off' || pref === false) return false;
    return typeof localStorage !== 'undefined' && localStorage.getItem(FLAG_KEY) === 'on';   // legacy fallback
  } catch { return false; }
}
// Persist to the SYNCED store (so the choice follows the athlete across devices via Cloudflare) plus
// the legacy localStorage flag. Writing the synced key is what cloud-sync picks up and propagates.
export function setEnabled(on) {
  try { storage.set(PREF_KEY, on ? 'on' : 'off', { skipValidation: true }); } catch { /* ignore */ }
  try { localStorage.setItem(FLAG_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
}
export function hasWebGPU() {
  try { return typeof navigator !== 'undefined' && !!navigator.gpu; } catch { return false; }
}

// Ask the GPU adapter how much it can hand a single buffer. Discrete cards report GiB-scale
// maxBufferSize / maxStorageBufferBindingSize; integrated GPUs report far less. We use that as a coarse
// "can this GPU take the heavy model?" signal so we don't try Gemma-2-2B on an Intel iGPU (which hangs).
// Returns { tier: 'high'|'low'|'unknown', maxBufferMB }. Never throws.
export async function gpuCapability() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return { tier: 'unknown', maxBufferMB: 0 };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { tier: 'unknown', maxBufferMB: 0, f16: true };
    const lim = adapter.limits || {};
    const maxBuf = Number(lim.maxBufferSize || lim.maxStorageBufferBindingSize || 0);
    const maxBufferMB = Math.round(maxBuf / (1024 * 1024));
    // ~1 GiB single-buffer headroom is a reasonable line: discrete/strong-mobile clear it; weak iGPUs don't.
    const tier = maxBuf >= 1024 * 1024 * 1024 ? 'high' : (maxBuf > 0 ? 'low' : 'unknown');
    // Does this GPU expose the WebGPU shader-f16 feature the q4f16 models need? Missing on many Intel iGPUs.
    const f16 = !!(adapter.features && typeof adapter.features.has === 'function' && adapter.features.has('shader-f16'));
    return { tier, maxBufferMB, f16 };
  } catch { return { tier: 'unknown', maxBufferMB: 0, f16: true }; }
}

// Choose the starting rung. A capable GPU may start on the top rung (Gemma) for the best voice; anything
// else starts on the safe default (1.5B). f16 selects the precision ladder. An explicit modelId always wins.
export function startModelForTier(tier, explicit, f16 = true) {
  if (explicit) return explicit;
  const ladder = ladderFor(f16);
  return tier === 'high' ? ladder[0] : ladder[Math.min(1, ladder.length - 1)];
}
async function pickStartModel(explicit) {
  if (explicit) return explicit;
  const { tier, f16 } = await gpuCapability();
  return startModelForTier(tier, undefined, f16 !== false);
}

// The try-order from a chosen start: that rung, then every LIGHTER rung below it (never heavier), within
// the SAME precision ladder (auto-detected from the start id). An off-ladder custom id is tried alone.
export function modelTryOrder(start) {
  const L = isF32Model(start) ? LADDER_F32 : LADDER_F16;
  const idx = L.indexOf(start);
  return idx === -1 ? [start, ...LADDER_F16.slice(1)] : L.slice(idx);
}

// The FULL candidate order the loader walks: the same-precision step-down first, then the OTHER precision
// ladder as a last resort (deduped). So if f16 detection was wrong and every f16 rung fails on a no-f16
// GPU, we still cross over and try the f32 builds (and vice-versa) before giving up.
export function candidateOrder(start) {
  const primary = modelTryOrder(start);
  const alt = isF32Model(start) ? LADDER_F16 : LADDER_F32;
  const seen = new Set(primary);
  return [...primary, ...alt.filter((m) => !seen.has(m))];
}

// Classify an error as a GPU resource loss (device lost / hung / removed / OOM) — the only class where
// stepping DOWN the ladder helps. Everything else (missing package, bad config, network) should surface.
export function isGpuLossError(e) {
  const m = String((e && e.message) || e || '').toLowerCase();
  return (m.includes('device') && (m.includes('lost') || m.includes('hung') || m.includes('removed')))
    || m.includes('out of memory') || m.includes('oom');
}

// Attach a device-lost handler so a mid-session GPU hang (the athlete's laptop sleeps, another app grabs
// the GPU, or the model is simply too heavy) tears the reasoner down cleanly instead of hammering a dead
// engine. WebLLM surfaces the underlying GPUDevice a few different ways across versions, so we probe
// defensively. Best-effort: if we can't find the device, generate()'s own try/catch still degrades us.
function wireDeviceLost(engine, onLost) {
  try {
    const dev = (engine && (
      (typeof engine.getGPUDevice === 'function' && engine.getGPUDevice()) ||
      (engine.gpuDevice) ||
      (engine.device)
    )) || null;
    if (dev && dev.lost && typeof dev.lost.then === 'function') {
      dev.lost.then(() => { try { onLost && onLost(); } catch { /* ignore */ } });
    }
  } catch { /* ignore — generate()'s catch is the backstop */ }
}

// Load a WebLLM engine and return a generate({system,user}) => Promise<string>. Dynamic import so the
// bundle doesn't hard-depend on the package until this actually runs. Steps DOWN the model ladder on a
// device-lost/OOM load failure so a weak GPU still ends up with *a* working model rather than an error.
export async function loadWebLlmGenerate({ modelId, onProgress, temperature = 0.5, maxTokens = 180, contextWindowSize = 2048 } = {}) {
  // Bare specifier so Vite resolves the installed package (dynamic → only fetched when this runs).
  // This module isn't imported anywhere by default, so an un-installed package never breaks the build.
  const webllm = await import('@mlc-ai/web-llm');

  const start = await pickStartModel(modelId);
  const order = candidateOrder(start);   // same-precision step-down, then the other precision as last resort

  let engine = null; let lastErr = null; let usedModel = null;
  for (const id of order) {
    try {
      // context_window_size caps the KV cache — the single biggest VRAM lever on a weak GPU. Our notes
      // are short, so 2048 is plenty and far cheaper than the model's native (often 4k–8k) default.
      engine = await webllm.CreateMLCEngine(id, {
        initProgressCallback: (p) => { try { onProgress && onProgress(p); } catch { /* ignore */ } },
      }, { context_window_size: contextWindowSize });
      usedModel = id;
      break;
    } catch (e) {
      // The dynamic import already succeeded, so any error here is model-specific (OOM, device-lost,
      // no shader-f16, unknown-model). Step DOWN / cross precision and keep trying — the last error
      // surfaces only if every candidate fails.
      lastErr = e;
    }
  }
  if (!engine) throw (lastErr || new Error('no-model-loaded'));

  const generate = async ({ system, user }) => {
    const reply = await engine.chat.completions.create({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature, max_tokens: maxTokens,
    });
    return (reply && reply.choices && reply.choices[0] && reply.choices[0].message && reply.choices[0].message.content) || '';
  };
  return { engine, generate, model: usedModel };
}

/**
 * registerCoachReasoner(opts?) → { ok, reason, model? }. Call once at startup. Honors the opt-in flag +
 * WebGPU gate; on success the coach voice starts phrasing through the model (behind factCheck). Idempotent.
 * `load` can be swapped (e.g. a native LiteRT plugin) — anything returning { generate }.
 */
let _inflight = null;      // dedup concurrent registrations (multiple CoachComment instances mount at once)
let _loadedModel = null;   // the model id that's actually live — survives UI remounts (unlike component state)

// The CURRENT live coach-voice state, independent of any component's local status string. The Profile
// toggle reads this on mount so navigating away and back still shows "ready (model)" when the model is
// still registered — instead of a blank status that looks like it unloaded (Emil).
export function coachVoiceStatus() {
  try { return getReasoner() ? { ready: true, model: _loadedModel } : { ready: false, model: null }; }
  catch { return { ready: false, model: null }; }
}
export async function registerCoachReasoner({ force = false, load = loadWebLlmGenerate, ...opts } = {}) {
  if (getReasoner()) return { ok: true, reason: 'already-registered' };
  if (!force && !isEnabled()) return { ok: false, reason: 'disabled' };
  if (!hasWebGPU()) return { ok: false, reason: 'no-webgpu' };
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const loaded = await load(opts);
      const generate = loaded && loaded.generate;
      if (typeof generate !== 'function') return { ok: false, reason: 'no-generate' };
      const reasoner = makeReasoner(generate, opts);
      if (!reasoner) return { ok: false, reason: 'no-generate' };
      registerReasoner(reasoner);
      _loadedModel = loaded.model || null;
      // If the GPU is lost later, pull the reasoner so we silently return to the deterministic voice
      // instead of throwing on every render. wireDeviceLost is best-effort; generate's catch backstops it.
      wireDeviceLost(loaded.engine, () => { try { unregisterCoachReasoner(); } catch { /* ignore */ } });
      return { ok: true, reason: 'registered', model: loaded.model };
    } catch (e) {
      return { ok: false, reason: 'load-failed', error: String(e && e.message || e) };
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export function unregisterCoachReasoner() { registerReasoner(null); _loadedModel = null; }

export default registerCoachReasoner;
