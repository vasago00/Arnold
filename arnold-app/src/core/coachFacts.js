// core/coachFacts.js — CERTIFIED FACTS (roadmap Stage 2).
//
// WHY. Today a generator emits a finished sentence (a "beat"). That's fine for the deterministic
// composer, but the next-level architecture needs the coach's knowledge as TYPED, PROVENANCE-CARRYING
// records so a bounded reasoner can select/phrase over them and a verifier can prove "output ⊆ facts."
// This module promotes each beat into a CertifiedFact WITHOUT changing what the composer renders — the
// beat's own `claim.text` stays the human-facing string; we add the structure around it:
//
//   { id, kind, claim, data, why, validity, confidence, tone, surfaces }
//
//   • claim      — the asserted sentence (unchanged from the beat; the composer still renders THIS)
//   • data       — the grounding numbers/entities the claim rests on (from the beat)
//   • why        — provenance: the signal it traces to (from the beat)
//   • validity   — WHEN/WHERE the claim holds: day.phase + scope (session/today/week/season) + surfaces.
//                  This is freshness made STRUCTURAL — the thing we kept hand-coding as `if (hour…)`.
//   • confidence — 0..1 signal strength (1 for hard deterministic math; the model's own confidence
//                  for learned facts like heat strain; a notch lower for inferences).
//
// PURE + node-testable. It reuses the engine's generators (allBeats) and the ONE phase source (dayOf),
// so certified validity can never drift from the gating the generators already apply. Behaviour of
// narrateSurface is untouched; certifiedNarrative is an ADDITIVE wrapper the reasoner/verifier consume.

import { allBeats, dayOf, narrateSurface } from './coachNarrative.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @typedef {Object} CertifiedFact
 * @property {string} id
 * @property {string} kind
 * @property {string} claim        the asserted sentence (rendered verbatim by the composer)
 * @property {Object} data         grounding numbers/entities
 * @property {string} why          provenance
 * @property {{phase:string,trainedToday:boolean,asOfHour:(number|null),fuelWindowOpen:boolean,scope:string,surfaces:string[]}} validity
 * @property {number} confidence   0..1
 * @property {string} tone
 * @property {string[]} surfaces
 */

// SCOPE — how long a fact stays true, by kind. This is the coarse "validity window" the reasoner uses
// to decide staleness: a purpose note is spent once you train (session); a fuel read is a today thing;
// plan/volume facts hold for the week; a lab flag persists across the season.
const SCOPE = {
  purpose: 'session', knockOn: 'session', readiness: 'session',
  reds: 'today', mechanism: 'today', divergence: 'today', context: 'today',
  planImpact: 'week', progress: 'week',
  learned: 'now', clinical: 'season',
};
export function factScope(beat) { return (beat && SCOPE[beat.kind]) || 'today'; }

// CONFIDENCE — hard deterministic math is certain (1). Learned facts carry the model's own confidence.
// Inferences over a real measurement (a divergence call, a readiness recommendation) sit a notch below.
export function factConfidence(beat, ctx) {
  if (!beat) return 0;
  if (beat.id === 'learned-heat') {
    const c = ctx && ctx.learned && ctx.learned.heat && ctx.learned.heat.confidence;
    return Number.isFinite(+c) ? clamp01(+c) : 0.5;
  }
  if (beat.kind === 'readiness') return 0.9;      // measured score + an adaptation recommendation
  if (beat.kind === 'divergence') return 0.8;     // an inference over a real observed rate
  return 1;                                        // a certified deterministic fact
}

// VALIDITY — the structural freshness window. Reads the SAME day/phase the generators gate on, so a
// certified fact's validity can never contradict the gating that produced it.
export function factValidity(beat, ctx) {
  const d = dayOf(ctx);
  return {
    phase: d.phase,
    trainedToday: d.trainedToday,
    asOfHour: d.hour,
    fuelWindowOpen: d.fuelWindowOpen,
    scope: factScope(beat),
    surfaces: Array.isArray(beat.surfaces) ? beat.surfaces : [],
  };
}

/** Promote one beat into a CertifiedFact (claim text unchanged — the composer still renders it). */
export function certifyBeat(beat, ctx) {
  if (!beat) return null;
  return {
    id: beat.id,
    kind: beat.kind,
    claim: beat.claim && beat.claim.text != null ? beat.claim.text : '',
    data: (beat.claim && beat.claim.data) || {},
    why: beat.why || '',
    validity: factValidity(beat, ctx),
    confidence: factConfidence(beat, ctx),
    tone: beat.tone || 'neutral',
    surfaces: Array.isArray(beat.surfaces) ? beat.surfaces : [],
  };
}

/** The full certified fact-set for a context — every grounded beat, as typed records. */
export function certifiedFacts(ctx) {
  return allBeats(ctx).map((b) => certifyBeat(b, ctx)).filter(Boolean);
}

// factsGrounding — the union of everything the certified set actually asserts, as ONE string suitable
// for coachPhraser.factCheck's `source`. This is the trust-boundary upgrade: a reasoner's output is
// validated against the CERTIFIED FACTS (claims + their grounding data), not merely one composed
// paragraph — so it may draw on any certified fact, and only on certified facts. Numbers hidden in
// `data` (even if the claim phrases them differently) are included so factCheck won't reject them.
export function factsGrounding(facts) {
  const parts = [];
  for (const f of (facts || [])) {
    if (!f) continue;
    if (f.claim) parts.push(f.claim);
    for (const v of Object.values(f.data || {})) {
      if (v == null) continue;
      if (typeof v === 'object') { for (const vv of Object.values(v)) if (vv != null) parts.push(String(vv)); }
      else parts.push(String(v));
    }
  }
  return parts.join(' · ');
}

/**
 * certifiedNarrative(ctx, surface) — the deterministic narrative PLUS the certified facts behind the
 * beats it selected, and their grounding string. ADDITIVE: `text`/`tone`/`beats` are exactly what
 * narrateSurface returns (composer output unchanged); `facts` + `grounding` are the new structured
 * layer the Stage-3 reasoner selects/phrases from and the verifier checks against.
 */
export function certifiedNarrative(ctx, surface) {
  const nv = narrateSurface(ctx, surface);
  if (!nv) return null;
  const pickedIds = new Set((nv.beats || []).map((b) => b.id));
  const facts = certifiedFacts(ctx).filter((f) => pickedIds.has(f.id));
  return { ...nv, facts, grounding: factsGrounding(facts) };
}

export default certifiedFacts;
