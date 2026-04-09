// ─── Heart-rate zones ────────────────────────────────────────────────────────

// Compute %HRmax. Returns null when avg or max are missing.
export function hrPct(avgHR, maxHR) {
  if (!avgHR || !maxHR) return null;
  return avgHR / maxHR;
}

// Map %HRmax → zone label (Z1–Z5). Pure thresholds, no auto-detection.
export function hrZone(pct) {
  if (pct == null) return null;
  if (pct >= 0.9) return 'Z5';
  if (pct >= 0.8) return 'Z4';
  if (pct >= 0.7) return 'Z3';
  if (pct >= 0.6) return 'Z2';
  return 'Z1';
}

// Convenience: avgHR + maxHR → zone label
export function hrZoneFromBpm(avgHR, maxHR) {
  return hrZone(hrPct(avgHR, maxHR));
}
