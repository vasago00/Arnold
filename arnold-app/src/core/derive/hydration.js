// ─── Sweat loss + hydration replenishment ────────────────────────────────────
// Calibrated against Garmin Connect on 2026-04-08 (579ml actual vs estimate).

import { hrPct } from './hr.js';

// Returns liters of estimated sweat loss for a session, or null if duration
// is missing. Inputs use the same field names as our activity rows.
export function estimateSweatLoss({ durationSecs, avgHR, maxHR, weightLbs = 175 }) {
  if (!durationSecs) return null;
  const hrs = durationSecs / 3600;
  // Intensity bracket based on %HRmax (calibrated)
  const pct = hrPct(avgHR, maxHR) ?? 0.7;
  let rate;
  if (pct >= 0.9)      rate = 1.50;
  else if (pct >= 0.8) rate = 1.15;
  else if (pct >= 0.7) rate = 0.80;
  else if (pct >= 0.6) rate = 0.55;
  else                 rate = 0.35;
  // Weight scaling against 75kg baseline
  const wtKg = weightLbs * 0.4536;
  const wtFactor = wtKg / 75;
  const liters = hrs * rate * wtFactor;
  return Math.round(liters * 100) / 100;
}

// Recommended water replenishment (1.25× sweat loss is the standard)
export function replenishTarget(sweatLossL) {
  if (sweatLossL == null) return null;
  return Math.round(sweatLossL * 1.25 * 100) / 100;
}

// Convenience: build the full hydration row at once
export function hydrationFor(activity, profile = {}) {
  const sweatL = estimateSweatLoss({
    durationSecs: activity?.durationSecs,
    avgHR: activity?.avgHR,
    maxHR: activity?.maxHR || profile.maxHR,
    weightLbs: parseFloat(profile.weight) || 175,
  });
  const replenL = replenishTarget(sweatL);
  return {
    sweatLossL: sweatL,
    replenishL: replenL,
    replenishOz: replenL != null ? Math.round(replenL * 33.814) : null,
    windowHrs: 4,
  };
}
