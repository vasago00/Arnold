// Hub core — the Bayesian Estimate primitive. Every learned parameter in the
// Intelligence Hub (fitness params, response sensitivities) is held as a value
// + a precision (inverse variance = "how sure we are"). See docs/HUB_CORE.md and
// INTELLIGENCE_HUB.md "Calibration math".
//
// Pure, dependency-free, unit-tested in tests/hubCore.test.mjs.

// A fresh estimate. precision 0 = no information yet (a naive prior).
export function makeEstimate(value = 0, precision = 0) {
  return { value, precision };
}

// Precision-weighted blend of a prior estimate with a new observation:
//   value     = (v·p + obs·op) / (p + op)
//   precision =  p + op
// Properties this gives us for free (no hand-tuned weights):
//   - naive prior (p≈0)         → the observation basically becomes the estimate
//   - well-established prior     → the same observation barely moves it
//   - precision accumulates      → the model gets more sure as evidence stacks
export function updateEstimate(est, obs, obsPrecision) {
  if (!Number.isFinite(obs) || !(obsPrecision > 0)) return est;
  const p = est.precision > 0 ? est.precision : 0;
  const denom = p + obsPrecision;
  return {
    value: (est.value * p + obs * obsPrecision) / denom,
    precision: denom,
  };
}

// Age a stored estimate: its VALUE is unchanged, but we trust it less as it gets
// older — precision halves every `halfLifeWeeks`. This is the smooth form of the
// race-anchor's old hard cutoff (INTELLIGENCE_HUB.md "Recency decay").
export function decayPrecision(est, ageWeeks, halfLifeWeeks) {
  if (!(ageWeeks > 0) || !(halfLifeWeeks > 0)) return est;
  const factor = Math.pow(0.5, ageWeeks / halfLifeWeeks);
  return { value: est.value, precision: est.precision * factor };
}

// Saturating confidence in [0,1): p/(p+k0). k0 is the precision at which we're
// "half confident" — tune per parameter. The coach uses this to decide whether to
// assert ("3:38 marathon") or hedge ("early read, ~3:40, low confidence").
export function confidence(est, k0 = 1) {
  const p = est && est.precision > 0 ? est.precision : 0;
  return p / (p + k0);
}
