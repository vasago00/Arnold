// core/coaching/maffetone.js — Maffetone Aerobic (MAF) heart-rate ceiling.
// The "180 - age" formula for the maximum aerobic-function HR, with Maffetone's own
// adjustments. This is the ADOPTED starting method; personalize.js can later refine the
// true aerobic threshold from the athlete's own HR–pace decoupling (Pillar 1 · evolve).
//
// Source: Philip Maffetone, "The Big Book of Endurance Training and Racing" — the MAF 180 formula.

// Adjustment categories (Maffetone):
//   +5  : experienced (2+ yr training, progressing, no injury/overtraining) — advanced only
//    0  : training consistently (up to 2 yr) with no issues
//   -5  : recovering from illness/injury, on medication, or inconsistent training
//   -10 : recovering from major illness/surgery, or on heavy medication
export function mafHeartRate(age, opts = {}) {
  const a = Number(age);
  if (!(a > 0)) return null;
  let hr = 180 - a;
  const adj = Number(opts.adjustment);
  if (Number.isFinite(adj)) hr += adj;
  return Math.round(hr);
}

// The MAF aerobic training zone: a 10-bpm band topping out at the MAF HR (Maffetone trains
// AT or just below the ceiling). Returns { max, min } bpm.
export function mafZone(age, opts = {}) {
  const max = mafHeartRate(age, opts);
  if (max == null) return null;
  return { max, min: max - 10 };
}
