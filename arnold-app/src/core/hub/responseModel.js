// Hub core — the RESPONSE model (the second ledger). Turns the residual of a
// confounded effort into accumulating, per-confounder sensitivity knowledge:
// "for Emil, +1°C above ref ≈ +1.5%; +1h of sleep debt ≈ +1%." Over many efforts
// these become reusable, cited coaching facts. See docs/HUB_CORE.md and
// INTELLIGENCE_HUB.md "Residual → response model".
//
// Consumes the attribution engine's factor shape:
//   { factor, direction, timescale, magnitude, confidence }
// Pure, unit-tested in tests/hubCore.test.mjs.

import { makeEstimate, updateEstimate, decayPrecision, confidence } from './estimate.js';

// factors: { <factorName>: Estimate }, each a sensitivity in FRACTION-PER-UNIT
// of that factor's magnitude (heat → per-°C-over-ref, sleep → per-hour-of-debt).
export function makeResponseModel() {
  return { factors: {} };
}

// Partition `divergence` (a fraction: 0.03 = 3% slower/worse than expected) across
// the ACUTE confounders that were present, and accumulate each slice into that
// factor's sensitivity. Returns a NEW model (immutable update).
//
// Weighting: each acute factor claims a share of the blame proportional to
// magnitude·confidence — a bigger insult, more confidently attributed, owns more
// of the residual. share_i = divergence · w_i/Σw; obsSensitivity_i = share_i/mag_i.
export function observeOutcome(model, divergence, factors = [], opts = {}) {
  const halfLifeWeeks = opts.halfLifeWeeks ?? 26;
  const ageWeeks = opts.ageWeeks ?? 0;

  if (!Number.isFinite(divergence) || divergence === 0) return model;

  const acute = (factors || []).filter(f =>
    f && f.timescale !== 'chronic' &&
    typeof f.factor === 'string' &&
    Number.isFinite(f.magnitude) && f.magnitude > 0);

  if (!acute.length) return model; // unattributed residual → caller's fitness signal

  const weights = acute.map(f => f.magnitude * (Number.isFinite(f.confidence) ? f.confidence : 0.5));
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (!(wSum > 0)) return model;

  const next = { factors: { ...model.factors } };
  acute.forEach((f, i) => {
    const share = divergence * (weights[i] / wSum);     // this factor's slice of the residual
    const obsSensitivity = share / f.magnitude;          // per-unit sensitivity observation
    const obsPrecision = Number.isFinite(f.confidence) ? f.confidence : 0.5;
    let est = next.factors[f.factor] || makeEstimate(0, 0);
    est = decayPrecision(est, ageWeeks, halfLifeWeeks);  // age the prior before blending
    est = updateEstimate(est, obsSensitivity, obsPrecision);
    next.factors[f.factor] = est;
  });
  return next;
}

// Predict the total expected penalty (fraction) from the conditions present today.
// conditions: [{ factor, magnitude }]. Returns { penalty, confidence, byFactor }.
// Lets the coach say "expect ~2% slower: heat ~1.5%, sleep ~0.5%."
export function predictPenalty(model, conditions = [], k0 = 1) {
  let penalty = 0;
  const byFactor = {};
  let confSum = 0, n = 0;
  (conditions || []).forEach(c => {
    if (!c || typeof c.factor !== 'string' || !Number.isFinite(c.magnitude)) return;
    const est = model.factors[c.factor];
    if (!est) return;
    const contrib = est.value * c.magnitude;
    const conf = confidence(est, k0);
    byFactor[c.factor] = { contrib, sensitivity: est.value, confidence: conf };
    penalty += contrib;
    confSum += conf;
    n += 1;
  });
  return { penalty, confidence: n ? confSum / n : 0, byFactor };
}

// Read a factor's current sensitivity + confidence (for the coach / debugging).
export function sensitivityOf(model, factor, k0 = 1) {
  const est = model.factors[factor];
  if (!est) return { value: null, confidence: 0 };
  return { value: est.value, confidence: confidence(est, k0) };
}
