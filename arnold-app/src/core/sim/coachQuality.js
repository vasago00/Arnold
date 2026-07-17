// core/sim/coachQuality.js — the QUALITY eval harness (roadmap Stage 5).
//
// The invariant sim (coachNarrativeSim.js) proves the coach never CRASHES, LEAKS, or FABRICATES.
// That's necessary but not sufficient: the "0 kcal/kg at midnight" and "front-load protein at
// bedtime" bugs were all *valid* outputs that were simply BAD COACHING. This harness measures
// GOOD coaching — it scores each rendered surface on a rubric and turns "spot it in a screenshot"
// into "fails the eval." It is the machine that also makes model selection (Stage 3/§7) a *measured*
// decision rather than a vibe.
//
// TWO LAYERS, by design:
//   • DETERMINISScoring (this file) — pure, node-testable rubric dimensions that need NO model:
//       grounded · timely · concise · coherent · actionable. These encode the coaching rules we keep
//       hand-checking, so the whole class regresses loudly.
//   • JUDGE seam (JUDGE_RUBRIC + an optional async judge) — the SUBJECTIVE dimensions (naturalness,
//       warmth, non-nagging tone) that genuinely need an LLM. Mirrors the coachPhraser pattern: the
//       harness runs fully without a judge; a real LLM-as-judge slots in later, guarded by a
//       human-calibrated rubric (the eval literature's warning: judges are gameable).
//
// PURE + offline: same seed → same scores; lives in the normal test suite.

import { narrateSurface, allBeats, dayOf } from '../coachNarrative.js';
import { certifiedNarrative } from '../coachFacts.js';
import { factCheck } from '../coachPhraser.js';
import { makeRng } from './prng.js';
import { genContext } from './coachNarrativeSim.js';

const SURFACES = ['start', 'edgeiq', 'play', 'fuel', 'daily', 'plan', 'trend', 'calendar'];

// Mirror of the engine's SURFACE_K (kept local like the sim mirrors its lane sets) — a surface must
// not stack more than its budgeted beats (the "wall of text" Emil flagged).
const QUALITY_K = { start: 1, edgeiq: 2, play: 2, fuel: 2, daily: 2, plan: 2, trend: 2, calendar: 2 };
const LEN_MAX = { start: 420 };            // start is a 1–2 line cockpit; others get a looser bound
const LEN_MAX_DEFAULT = 1000;

// Beats whose validity is TIME-SENSITIVE, and the phases in which each must NOT appear. This is the
// structural encoding of "time-of-day awareness permeates everything" — a regression that lets any
// of these fire in the wrong phase fails `timely`.
const TIME_SENSITIVE = {
  'reds-lowEA':   (day) => day.isWindDown || day.isMorning,     // no "fuel up" nudge at bed / first thing
  'fuel-status':  (day, text) => day.isWindDown && /front-load protein early/i.test(text || ''),
};
// A purpose beat is a pre-workout preview — it must be gone once the athlete has trained.
const purposeAfterTrained = (id, day) => id.startsWith('purpose') && day.postWorkout;

const ACTION_VERB = /\b(add|keep|ease|trim|protect|spread|skew|hold|eat|front-load|back off|absorb|bank|lift|fuel|refuel|sleep|rest|cut|redistribute|take|shift|dial|prioriti[sz]e)\b/i;

// ── pure per-dimension assessors (independently negative-controllable) ─────────────────────────

/** grounded — every number/entity the text says is present in the certified grounding. */
export function assessGrounded(text, grounding) {
  if (!text) return { pass: true, violations: [] };
  const fc = factCheck(text, grounding);
  return fc.ok ? { pass: true, violations: [] }
    : { pass: false, violations: [{ dim: 'grounded', msg: `unsourced ${JSON.stringify({ n: fc.leakedNumbers, e: fc.leakedEntities })}` }] };
}

/** timely — no time-sensitive beat fired in a phase where it doesn't belong. Unknown phase = N/A. */
export function assessTimely(day, ids, text) {
  const out = [];
  if (!day || day.phase === 'unknown') return { pass: true, violations: [] };   // no clock → can't judge, don't fabricate
  for (const id of ids) {
    const rule = TIME_SENSITIVE[id];
    if (rule && rule(day, text)) out.push({ dim: 'timely', msg: `'${id}' fired in phase '${day.phase}'` });
    if (purposeAfterTrained(id, day)) out.push({ dim: 'timely', msg: `purpose '${id}' after training` });
  }
  return { pass: out.length === 0, violations: out };
}

/** concise — within the surface's beat budget and a sane length (no wall of text). */
export function assessConcise(surface, beats, text) {
  const out = [];
  const k = QUALITY_K[surface] ?? 2;
  if (beats.length > k) out.push({ dim: 'concise', msg: `${beats.length} beats > K=${k}` });
  const lenMax = LEN_MAX[surface] ?? LEN_MAX_DEFAULT;
  if ((text || '').length > lenMax) out.push({ dim: 'concise', msg: `len ${text.length} > ${lenMax}` });
  return { pass: out.length === 0, violations: out };
}

/** coherent — no affirming purpose/progress cheerleading composed next to a corrective beat. */
export function assessCoherent(beats, fullById) {
  const hasCorrective = beats.some((b) => fullById.get(b.id)?.tone === 'corrective');
  if (!hasCorrective) return { pass: true, violations: [] };
  const out = [];
  for (const b of beats) {
    const f = fullById.get(b.id);
    if (f && f.tone === 'affirming' && (f.kind === 'progress' || f.kind === 'purpose')) {
      out.push({ dim: 'coherent', msg: `affirming ${f.kind} '${b.id}' with a corrective beat` });
    }
  }
  return { pass: out.length === 0, violations: out };
}

/** actionable — a corrective/gentle read should hand the athlete something to DO (soft dimension). */
export function assessActionable(tone, text) {
  if (tone !== 'corrective' && tone !== 'gentle') return { pass: true, violations: [] };
  return ACTION_VERB.test(text || '') ? { pass: true, violations: [] }
    : { pass: false, violations: [{ dim: 'actionable', msg: `${tone} read has no action cue` }] };
}

// Dimension weights — grounding + timeliness are the load-bearing ones (they map to the real bugs);
// coherence next; brevity + actionability are softer. Score is the weighted fraction passed.
const WEIGHTS = { grounded: 0.30, timely: 0.30, coherent: 0.20, concise: 0.12, actionable: 0.08 };

/**
 * scoreNarrative(ctx, surface) → per-surface quality record. Silence scores 1 (a valid choice), and
 * is marked spoke:false so the aggregate can separate "said nothing" from "said something good".
 */
export function scoreNarrative(ctx, surface) {
  let cn;
  try { cn = certifiedNarrative(ctx, surface); }
  catch (e) { return { surface, spoke: false, score: 0, dims: {}, violations: [{ dim: 'threw', msg: String(e && e.message || e) }] }; }
  if (!cn) return { surface, spoke: false, score: 1, dims: { grounded: true, timely: true, concise: true, coherent: true, actionable: true }, violations: [] };

  const fullById = new Map();
  try { for (const b of allBeats(ctx)) fullById.set(b.id, b); } catch { /* leave empty; coherence just can't flag */ }
  const day = dayOf(ctx);
  const beats = cn.beats || [];
  const ids = beats.map((b) => b.id);

  const parts = {
    grounded: assessGrounded(cn.text, cn.grounding),
    timely: assessTimely(day, ids, cn.text),
    concise: assessConcise(surface, beats, cn.text),
    coherent: assessCoherent(beats, fullById),
    actionable: assessActionable(cn.tone, cn.text),
  };
  const dims = {}; const violations = []; let score = 0;
  for (const [k, r] of Object.entries(parts)) {
    dims[k] = r.pass;
    if (r.pass) score += WEIGHTS[k];
    else violations.push(...r.violations);
  }
  return { surface, spoke: true, score: Math.round(score * 1000) / 1000, dims, violations, text: cn.text };
}

// ── the eval runner ─────────────────────────────────────────────────────────────────────────
/**
 * runQualityEval — samples the sim's athlete-day distribution, scores every spoken surface on the
 * deterministic rubric, and returns per-dimension PASS RATES + a sample of failing cases (seed +
 * caseIndex + surface, so any failure reproduces). This is the coaching-quality baseline; a design
 * change that lowers a pass rate shows up here instead of in Emil's inbox.
 */
export function runQualityEval({ seed = 20260716, nCases = 4000, adversarialFrac = 0.2, maxStored = 25 } = {}) {
  const rng = makeRng(seed);
  const dims = ['grounded', 'timely', 'concise', 'coherent', 'actionable'];
  const passCount = Object.fromEntries(dims.map((d) => [d, 0]));
  let spokenSurfaces = 0, scoreSum = 0, failCount = 0;
  const fails = [];
  for (let i = 0; i < nCases; i++) {
    const adversarial = rng.next() < adversarialFrac;
    const ctx = genContext(rng, { adversarial });
    for (const surface of SURFACES) {
      const r = scoreNarrative(ctx, surface);
      if (!r.spoke) continue;
      spokenSurfaces += 1;
      scoreSum += r.score;
      for (const d of dims) if (r.dims[d]) passCount[d] += 1;
      if (r.violations.length) {
        failCount += 1;
        if (fails.length < maxStored) fails.push({ seed, caseIndex: i, adversarial, surface, violations: r.violations, text: (r.text || '').slice(0, 120) });
      }
    }
  }
  const rate = (n) => (spokenSurfaces ? Math.round((n / spokenSurfaces) * 10000) / 10000 : 1);
  return {
    seed, cases: nCases, spokenSurfaces,
    passRate: Object.fromEntries(dims.map((d) => [d, rate(passCount[d])])),
    meanScore: spokenSurfaces ? Math.round((scoreSum / spokenSurfaces) * 10000) / 10000 : 1,
    failCount, fails,
  };
}

// The system-prompt rubric a future LLM-as-judge is given for the SUBJECTIVE dimensions the
// deterministic rubric can't measure. Kept beside the deterministic scorer so the two can't drift;
// the judge's verdict is advisory and must itself be calibrated against human labels (judges are
// gameable — "One Token to Fool LLM-as-a-Judge"), never an unchecked optimisation target.
export const JUDGE_RUBRIC =
  'You are grading a running coach\'s one-paragraph note to an athlete. Score 1-5 on each: ' +
  '(1) APPROPRIATE for the stated time of day; (2) ACTIONABLE — gives something concrete to do or affirm; ' +
  '(3) NATURAL — reads like a warm human coach, not a metrics dump; (4) NON-NAGGING — surfaces what matters ' +
  'without scolding or repeating; (5) FAITHFUL — says nothing not supported by the provided facts. ' +
  'Return JSON {appropriate,actionable,natural,nonNagging,faithful,notes}. Do not reward length or jargon.';

export default runQualityEval;
