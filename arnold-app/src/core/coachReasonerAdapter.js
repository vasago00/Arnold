// core/coachReasonerAdapter.js — turns a raw model `generate()` into a coach REASONER (Stage 3 spike).
//
// coachReasoner.reasonNarrative() takes a `reasoner(payload)` callback and enforces the safety
// boundary (output ⊆ certified facts via factCheck, reflect pass, cache, deterministic fallback). THIS
// module is the other half: it builds the PROMPT from the certified facts + the deterministic draft
// and wraps whatever on-device model runtime you have (LiteRT-LM / WebLLM / a native plugin) — any
// `generate({system, user}) => string` — into that callback. Keeping prompt-building here (beside the
// verifier's REASONER_CONTRACT) means the instruction the model gets and the guard that checks its
// output can't drift.
//
// PURE + node-testable: buildReasonerPrompt is deterministic; makeReasoner wraps a mock generate in
// tests. No model, no network — the real engine is injected by coachModel.js on-device.

import { REASONER_CONTRACT } from './coachReasoner.js';

// The model may ONLY use these facts — list the certified claims explicitly so the instruction and the
// factCheck grounding describe the same set. Numbers/entities not here get rejected by the verifier.
function factLines(certified) {
  const facts = Array.isArray(certified && certified.facts) ? certified.facts : [];
  const lines = facts.map((f) => (f && f.claim ? `- ${f.claim}` : null)).filter(Boolean);
  // Fall back to the composed draft if facts weren't attached (still bounded by factCheck downstream).
  if (!lines.length && certified && certified.text) return [`- ${certified.text}`];
  return lines;
}

/**
 * buildReasonerPrompt(certified) → { system, user }.
 * system = the phrasing contract (rewrite warmly, invent nothing, no longer than the draft).
 * user   = the certified FACTS the model may use + the deterministic DRAFT to rewrite.
 */
export function buildReasonerPrompt(certified, { contract = REASONER_CONTRACT } = {}) {
  const facts = factLines(certified);
  const draft = (certified && certified.text) || '';
  const tone = (certified && certified.tone) || 'neutral';
  const user =
    `FACTS you may use (do not add any others, keep every number exactly):\n${facts.join('\n')}\n\n` +
    `TONE: ${tone}\n\n` +
    `DRAFT to rewrite:\n${draft}\n\n` +
    `Rewrite the DRAFT as one warm, natural paragraph using ONLY the facts above. Same length or shorter. Return only the paragraph.`;
  return { system: contract, user };
}

/**
 * makeReasoner(generate, opts) → an async reasoner(payload) for coachReasoner.reasonNarrative().
 *
 * generate — your on-device model call: ({system, user}) => string | Promise<string>. Provided by
 *            coachModel.js (LiteRT/WebLLM/native). Whatever it returns is then FACT-CHECKED by
 *            reasonNarrative before it can reach the user, so a wrong number/name is discarded.
 *
 * The returned reasoner is what you hand to reasonNarrative({ reasoner }) or registerReasoner().
 */
export function makeReasoner(generate, opts = {}) {
  if (typeof generate !== 'function') return null;
  return async (payload) => {
    const { system, user } = buildReasonerPrompt(payload, opts);
    const out = await generate({ system, user });
    return typeof out === 'string' ? out : '';
  };
}

export default makeReasoner;
