// Hub core — the FITNESS ledger. Holds fitness parameters as Bayesian Estimates
// (threshold pace, fatigue exponent k, …) and updates them from clean checkpoints
// with sanity clamps so one mislabeled/mis-measured effort can't drift the model
// into nonsense. See docs/HUB_CORE.md and INTELLIGENCE_HUB.md "Guardrails".
//
// Pure, unit-tested in tests/hubIngest.test.mjs.

import { makeEstimate, updateEstimate, decayPrecision, confidence } from './estimate.js';

// Per-parameter guardrails:
//   absMin/absMax    — hard physiologic bounds; an obs outside → REJECT (likely a
//                      mislabeled effort), do not update, flag the trip.
//   maxRatePerWeek   — plausible change rate; an obs implying a faster shift than
//                      this (given elapsed weeks) is CLAMPED to the band, flagged.
const CLAMPS = {
  fatigueExponentK:       { absMin: 1.0, absMax: 1.25 },
  thresholdPaceSecPerKm:  { maxRatePerWeek: 4 },   // ≤ ~4 s/km plausible weekly move
};

// init: { paramName: number | Estimate }. Numbers become naive estimates (precision 0).
export function makeFitnessModel(init = {}) {
  const params = {};
  for (const [k, v] of Object.entries(init)) {
    params[k] = (v && typeof v === 'object' && 'precision' in v) ? v : makeEstimate(v, 0);
  }
  return { params };
}

export function getParam(model, param, k0 = 1) {
  const e = model.params[param];
  return e ? { value: e.value, precision: e.precision, confidence: confidence(e, k0) }
           : { value: null, precision: 0, confidence: 0 };
}

// Update one fitness param from an observation at a given precision. Returns the
// NEW model + an explainable log entry (what moved, by how much, clamps tripped).
export function updateFitness(model, param, observedValue, obsPrecision, opts = {}) {
  const ageWeeks = opts.ageWeeks ?? 0;
  const halfLifeWeeks = opts.halfLifeWeeks ?? 10;

  if (!Number.isFinite(observedValue) || !(obsPrecision > 0)) {
    return { model, log: { param, applied: false, rejected: true, reason: 'invalid observation or precision' } };
  }

  const clamp = CLAMPS[param];
  const prior = model.params[param] || makeEstimate(observedValue, 0);
  let obs = observedValue;
  let clamped = false, reason = null;

  // Absolute physiologic bound → reject impossible values outright.
  if (clamp && ((clamp.absMin != null && obs < clamp.absMin) || (clamp.absMax != null && obs > clamp.absMax))) {
    return {
      model,
      log: { param, prior: prior.value, obs: observedValue, applied: false, rejected: true,
             reason: `outside physiologic bounds [${clamp.absMin}, ${clamp.absMax}]` },
    };
  }

  // Rate bound → clamp to a plausible per-week change band (needs an informed prior).
  if (clamp && clamp.maxRatePerWeek != null && prior.precision > 0) {
    const maxDelta = clamp.maxRatePerWeek * Math.max(ageWeeks, 1);
    const lo = prior.value - maxDelta, hi = prior.value + maxDelta;
    if (obs < lo) { obs = lo; clamped = true; }
    else if (obs > hi) { obs = hi; clamped = true; }
    if (clamped) reason = `rate-clamped to ±${maxDelta} (${clamp.maxRatePerWeek}/wk × ${Math.max(ageWeeks, 1)}wk)`;
  }

  const decayed = decayPrecision(prior, ageWeeks, halfLifeWeeks);
  const updated = updateEstimate(decayed, obs, obsPrecision);
  return {
    model: { params: { ...model.params, [param]: updated } },
    log: { param, prior: prior.value, obs: observedValue, appliedObs: obs, applied: true,
           clamped, reason, value: updated.value, precision: updated.precision },
  };
}
