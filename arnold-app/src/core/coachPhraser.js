// core/coachPhraser.js — the COMPOSE-step phraser seam (COACH_NARRATIVE_DESIGN Phase H).
//
// The reasoning + selection layers stay deterministic and sim-tested; this is the ONE place an LLM
// is allowed in — as a PHRASER that rewrites the already-composed paragraph for warmth / flow /
// variety, and NOTHING else. The safety mechanism is the whole point of Phase H ("validate output ⊆
// facts"): the deterministic composition is the source of truth, and a rewrite is accepted only if
// it introduces NO fact the source didn't already assert — no new number, no new named entity. If
// the rewrite adds anything, throws, comes back empty, or balloons in length, we DISCARD it and keep
// the deterministic text. So the coach can never fabricate through the phraser: the worst case is it
// sounds a little more mechanical (the deterministic voice), never that it says something untrue.
//
// This module is PURE and has NO model dependency. `phraseNarrative` takes an OPTIONAL `phraser`
// callback (sync or async): with none, it's an identity passthrough = today's behaviour exactly. The
// real LLM call slots in later as that callback — behind this guard, policed by the same Monte-Carlo
// suite (the compose-integrity invariant is this validator's oracle).

// Every number in a string, normalised (drop grouping commas; keep decimals). Numbers are the
// highest-stakes fabrication risk (a wrong EA value, mileage, or race distance), and reliably
// extractable — so they're the hard check.
function numbersIn(str) {
  return (String(str == null ? '' : str).replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) || []);
}

// Proper-noun-ish tokens (a hallucinated race/place name is the entity risk we actually hit —
// "Berlin" vs "Valencia"). Flags mid-sentence Capitalised words; sentence-initial words are skipped
// (they're capitalised by grammar, not because they're names) as are common function words.
const STOP = new Set(
  ('The A An And Or But So Then Now Today Tonight Tomorrow Yesterday You Your Yours We Our I It Its ' +
   'That This These Those If At As Add Trust Keep Backing Net Bottom One Two Three Day Days Week Weeks ' +
   'Sleep Energy Readiness Strength Heat Recovered Cleared Go Ease Eat Hold Still Under Over About Near')
    .split(/\s+/),
);
function properNouns(str) {
  const tokens = String(str == null ? '' : str).split(/\s+/);
  const out = [];
  let sentenceStart = true;
  for (const raw of tokens) {
    const w = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');   // strip surrounding punctuation
    if (w && /^[A-Z][a-zA-Z]{2,}$/.test(w) && !sentenceStart && !STOP.has(w)) out.push(w);
    sentenceStart = /[.!?]$/.test(raw);
  }
  return out;
}

/**
 * factCheck(candidate, source) → { ok, leakedNumbers, leakedEntities }.
 * The candidate is grounded iff every number and every proper-noun it contains also appears in the
 * source. DROPPING facts is fine (the LLM may summarise); INVENTING them is not.
 */
export function factCheck(candidate, source) {
  const srcNums = new Set(numbersIn(source));
  const leakedNumbers = [...new Set(numbersIn(candidate))].filter((n) => !srcNums.has(n));
  const srcLower = String(source == null ? '' : source).toLowerCase();
  const leakedEntities = [...new Set(properNouns(candidate))].filter((w) => !srcLower.includes(w.toLowerCase()));
  return { ok: leakedNumbers.length === 0 && leakedEntities.length === 0, leakedNumbers, leakedEntities };
}

/**
 * phraseNarrative(source, { phraser, surface }) → { text, phrased, rejected? }.
 *
 * source   — the deterministic composition from narrateSurface (the ground truth).
 * phraser  — optional (source, { surface }) => string | Promise<string>. The LLM rewrite.
 *
 * Returns the phrased text ONLY when it passes fact-check AND a length sanity bound; otherwise the
 * deterministic source, tagged with why it was rejected. Always safe, always non-null-when-source.
 */
export async function phraseNarrative(source, { phraser, surface } = {}) {
  const src = typeof source === 'string' ? source : '';
  if (!phraser || !src.trim()) return { text: src, phrased: false };
  let candidate;
  try { candidate = await phraser(src, { surface }); }
  catch { return { text: src, phrased: false, rejected: 'threw' }; }
  if (typeof candidate !== 'string' || !candidate.trim()) return { text: src, phrased: false, rejected: 'empty' };
  const fc = factCheck(candidate, src);
  if (!fc.ok) return { text: src, phrased: false, rejected: 'unsourced', leak: fc };
  // A phrasing rewrites for flow — it must not balloon (keeps the calibrated brevity).
  if (candidate.trim().length > src.length * 1.5 + 40) return { text: src, phrased: false, rejected: 'too-long' };
  return { text: candidate.trim(), phrased: true };
}

// The system-prompt contract the LLM phraser MUST be given (kept here so the guard and the prompt
// can't drift). The validator enforces the hard part; the prompt sets the intent.
export const PHRASER_CONTRACT =
  'Rewrite the coach note below to read as one warm, natural paragraph. You MAY reorder, merge, and ' +
  'smooth the sentences and vary the wording. You MUST NOT add, remove, or change any fact: keep every ' +
  'number exactly, never introduce a name, place, or figure that is not already present, and never ' +
  'flip a claim (e.g. "under the floor" must not become "above"). Do not add new advice. Keep it about ' +
  'the same length or shorter. Return only the rewritten paragraph.';

export default phraseNarrative;
