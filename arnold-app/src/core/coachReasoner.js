// core/coachReasoner.js — the REASONER behind the verifier (roadmap Stage 3).
//
// This is the machined slot the on-device LLM (Gemma-E4B via LiteRT — see LLM_ON_DEVICE_STRATEGY.md)
// drops into. It is built and tested NOW with a deterministic stub, so the whole pipeline —
// select → synthesize → VERIFY → cache → fallback — is proven and green before any model exists.
//
// THE CONTRACT (BAIR "control & trust" + neuro-symbolic rigor): the deterministic engine has already
// certified the facts and composed a correct paragraph. A `reasoner` (the LLM, later) may reorder /
// merge / warm those facts into a more natural read — but every number and named entity it emits MUST
// trace to a certified fact (`coachPhraser.factCheck` against the certified grounding), it must pass a
// reflect pass (non-empty, bounded length, no flipped claim), and it is computed at most ONCE per
// meaningful data change (cache keyed by the fact grounding). If ANY of that fails — absent model,
// throw, empty, unsourced, too long, contradiction — we return the deterministic text unchanged. So
// the reasoner can only ever improve phrasing; it can never make the coach say something untrue, and
// the worst case is the (correct) deterministic voice.
//
// PURE core (`reasonNarrative`, `verifyCandidate`) is node-testable with mock reasoners; the live
// shell (`reasonedNarrative` + the registry) wraps certifiedNarrative and an in-memory day cache.

import { factCheck } from './coachPhraser.js';
import { certifiedNarrative } from './coachFacts.js';

// A rewrite must not balloon — keeps the calibrated brevity (same spirit as the phraser bound).
const lenBound = (src) => src.length * 1.6 + 60;

// Reflect pass: the deterministic checks a candidate must survive to be trusted. Grounding is the
// certified fact-set, so this is the "output ⊆ facts" trust boundary plus light sanity.
export function verifyCandidate(candidate, certified) {
  if (typeof candidate !== 'string' || !candidate.trim()) return { ok: false, reason: 'empty' };
  const cand = candidate.trim();
  const fc = factCheck(cand, certified.grounding || '');
  if (!fc.ok) return { ok: false, reason: 'unsourced', leak: fc };
  if (cand.length > lenBound(certified.text || '')) return { ok: false, reason: 'too-long' };
  // Contradiction guard: a corrective read must not be flipped into reassurance by the rewrite.
  if (certified.tone === 'corrective'
    && /\b(above the floor|you'?re fine|no concern|nothing to worry|all good|on track)\b/i.test(cand)) {
    return { ok: false, reason: 'flipped' };
  }
  return { ok: true };
}

// Cache key = the surface + the certified grounding (which changes iff the facts change) + an optional
// caller stamp (e.g. the date, so a new day recomputes even on identical facts). This is the "compute
// once per meaningful data change" guard — the LLM never runs per render.
export function reasonCacheKey(certified, stamp = '') {
  return `${certified.surface || '?'}::${stamp}::${certified.grounding || ''}`;
}

/**
 * reasonNarrative(certified, opts) → { text, tone, beats, source, cached?, rejected? }.
 *
 * certified — a certifiedNarrative() result: { surface, text, tone, beats, facts, grounding }.
 * opts.reasoner — OPTIONAL (payload) => string | Promise<string>. The LLM. Absent → deterministic.
 * opts.cache    — OPTIONAL Map-like (has/get/set) for the once-per-change cache.
 * opts.stamp    — OPTIONAL cache-busting stamp (date).
 *
 * The reasoner receives the STRUCTURED facts (not just text), so a real model can select/merge/emphasize
 * — richer than a blind paragraph rewrite — while the verifier keeps it honest.
 */
export async function reasonNarrative(certified, { reasoner, cache, stamp } = {}) {
  if (!certified) return null;
  const deterministic = { text: certified.text, tone: certified.tone, beats: certified.beats, source: 'deterministic' };
  if (typeof reasoner !== 'function') return deterministic;

  const key = reasonCacheKey(certified, stamp);
  if (cache && typeof cache.has === 'function' && cache.has(key)) {
    return { ...cache.get(key), cached: true };
  }

  let candidate;
  try {
    candidate = await reasoner({
      facts: certified.facts, grounding: certified.grounding,
      text: certified.text, tone: certified.tone, surface: certified.surface,
    });
  } catch { return { ...deterministic, rejected: 'threw' }; }

  const v = verifyCandidate(candidate, certified);
  if (!v.ok) return { ...deterministic, rejected: v.reason };

  const result = { text: candidate.trim(), tone: certified.tone, beats: certified.beats, source: 'reasoner' };
  if (cache && typeof cache.set === 'function') cache.set(key, result);
  return result;
}

// ── registry + live shell ───────────────────────────────────────────────────────────────────
// The native model registers itself here once (registerReasoner). Until then getReasoner() is null
// and every surface renders the deterministic voice — identical to today.
let _reasoner = null;
export function registerReasoner(fn) { _reasoner = typeof fn === 'function' ? fn : null; }
export function getReasoner() { return _reasoner; }

// In-memory, process-lifetime cache. Keyed by surface+grounding(+day), so the model runs at most once
// per meaningful change per surface — not per render (the cost/latency guard from the architecture).
const _cache = new Map();
export function clearReasonerCache() { _cache.clear(); }

/**
 * reasonedNarrative(ctx, surface, stamp?) → the coach read for a surface, model-phrased when a reasoner
 * is registered (and verified), else the deterministic composer. Drop-in for narrateSurface at the
 * render site; with no model registered it returns byte-identical deterministic output.
 */
export async function reasonedNarrative(ctx, surface, stamp) {
  const certified = certifiedNarrative(ctx, surface);
  if (!certified) return null;
  return reasonNarrative(certified, { reasoner: getReasoner(), cache: _cache, stamp });
}

// The system-prompt contract the LLM reasoner MUST be given (kept beside the verifier so prompt and
// guard can't drift). The validator enforces the hard part; this sets the intent.
export const REASONER_CONTRACT =
  'You are a running coach writing ONE short, warm note to an athlete. You are given a set of CERTIFIED ' +
  'FACTS (each with a claim and its data) and a deterministic draft. Rewrite them into a single natural ' +
  'paragraph: you MAY reorder, merge, and choose emphasis, and vary the wording for warmth. You MUST NOT ' +
  'add, remove, or change any fact — keep every number exactly, never introduce a name/place/figure not in ' +
  'the facts, and never flip a claim (e.g. "under the floor" must not become "fine"). No new advice. Keep it ' +
  'the same length or shorter. Return only the paragraph.';

export default reasonNarrative;
