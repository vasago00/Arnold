// ─── Heart-rate zones ────────────────────────────────────────────────────────
//
// Two binning paths supported:
//
//   1. PREFERRED — bpm boundaries from the user's Garmin Connect HR-zone
//      configuration, cached at `profile.hrZoneBpm`. Garmin lets users
//      customize zone boundaries in bpm (e.g. Z2 = 123-136 Easy), and most
//      runners with structured-training watches do. When this profile
//      cache is present, we bin against those bpm boundaries directly so
//      Arnold's zone labels match what Garmin Connect shows.
//
//   2. FALLBACK — %HRmax thresholds (60/70/80/90) when no bpm boundaries
//      are cached. Coarse but safe — every user has a max HR so this
//      always produces a label.
//
// Resolution: callers pass `profile` to zoneForHr(); the helper picks
// the bpm path when valid boundaries exist, %HRmax otherwise.

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

// Convenience: avgHR + maxHR → zone label (always %HRmax — kept for
// back-compat. New code should call zoneForHr() instead so it can opt
// into bpm boundaries when the profile has them.)
export function hrZoneFromBpm(avgHR, maxHR) {
  return hrZone(hrPct(avgHR, maxHR));
}

// Pull the user's cached bpm zone boundaries from profile, validating
// shape and ordering. Returns `{ z1Max, z2Max, z3Max, z4Max }` or null.
// (Z5 is implicit: anything > z4Max.)
export function getProfileZoneBpm(profile) {
  const z = profile?.hrZoneBpm;
  if (!z || typeof z !== 'object') return null;
  const arr = [z.z1Max, z.z2Max, z.z3Max, z.z4Max].map(Number);
  if (!arr.every(n => Number.isFinite(n) && n > 0)) return null;
  // Boundaries must be strictly increasing or the bin is meaningless.
  if (!(arr[0] < arr[1] && arr[1] < arr[2] && arr[2] < arr[3])) return null;
  return { z1Max: arr[0], z2Max: arr[1], z3Max: arr[2], z4Max: arr[3] };
}

// Bin a single bpm value into Z1..Z5. Prefers profile bpm boundaries
// when given; otherwise falls back to %HRmax via maxHR.
//
// @param {number} bpm        — heart rate in bpm
// @param {object} opts
//        .zoneBpm  — {z1Max,z2Max,z3Max,z4Max} from getProfileZoneBpm()
//        .maxHR    — used for %HRmax fallback
// @returns {'Z1'|'Z2'|'Z3'|'Z4'|'Z5'|null}
export function zoneForHr(bpm, { zoneBpm, maxHR } = {}) {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  if (zoneBpm) {
    if (bpm <= zoneBpm.z1Max) return 'Z1';
    if (bpm <= zoneBpm.z2Max) return 'Z2';
    if (bpm <= zoneBpm.z3Max) return 'Z3';
    if (bpm <= zoneBpm.z4Max) return 'Z4';
    return 'Z5';
  }
  return hrZoneFromBpm(bpm, maxHR);
}

// ─── Karvonen / Heart Rate Reserve ───────────────────────────────────────────
// Phase 4r.zones.4 — derive bpm zone boundaries from maxHR + restingHR using
// the standard Karvonen breakpoints (Garmin's 5-zone model uses 50/60/70/80/90%
// of HRR as zone *floors*, so z1Max = 60% boundary, z2Max = 70%, etc.).
//
// HRR formula: HR_at_pct = restingHR + pct × (maxHR − restingHR).
//
// Why this is the adaptive choice: as fitness improves, restingHR drops, HRR
// widens, and every zone boundary shifts up by a few bpm — your "easy"
// allowance grows alongside your aerobic engine. Age-based formulas (Maffetone
// 180−age, %HRmax) don't track this and stay frozen as you adapt.

export function karvonenZones({ maxHR, restingHR }) {
  if (!Number.isFinite(maxHR) || !Number.isFinite(restingHR)) return null;
  if (maxHR <= restingHR + 30) return null;  // sanity — HRR < 30 is broken data
  const hrr = maxHR - restingHR;
  const at = pct => Math.round(restingHR + pct * hrr);
  return {
    z1Max: at(0.60),  // upper bound of Z1 (50–60% HRR)
    z2Max: at(0.70),
    z3Max: at(0.80),
    z4Max: at(0.90),
  };
}

// 80% trimmed mean — robust against outlier nights (one bad-sleep RHR
// spike, one recovery-day under-reading) without being as flat as a
// median. Drops the top and bottom 10% of samples (floor) before
// averaging the middle.
export function trimmedMean(values, trim = 0.10) {
  const arr = (values || [])
    .map(Number)
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const drop = Math.floor(arr.length * trim);
  const kept = arr.slice(drop, arr.length - drop);
  if (kept.length === 0) return null;
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

// Pull a 28-day trimmed-mean restingHR from the user's nightly sleep
// stream. Returns null if fewer than 7 valid samples are available
// (not enough signal to set zones from).
export function rollingRestingHR(sleepHistory, { days = 28, minSamples = 7 } = {}) {
  if (!Array.isArray(sleepHistory)) return null;
  const cutoffMs = Date.now() - days * 86400 * 1000;
  const samples = sleepHistory
    .filter(s => s?.date && s?.restingHR != null)
    .filter(s => {
      const t = new Date(s.date + 'T12:00:00').getTime();
      return Number.isFinite(t) && t >= cutoffMs;
    })
    .map(s => Number(s.restingHR))
    .filter(n => Number.isFinite(n) && n >= 30 && n <= 100);  // physiological range
  if (samples.length < minSamples) return null;
  const mean = trimmedMean(samples, 0.10);
  return mean == null ? null : Math.round(mean);
}

// Compute the recommended Karvonen zones for the user, using current
// profile maxHR and a 28-day trimmed-mean restingHR. Returns null if
// inputs are missing or sleep history is too thin.
export function recommendedZones({ profile, sleepHistory }) {
  const maxHR = parseFloat(profile?.maxHR);
  if (!Number.isFinite(maxHR) || maxHR <= 0) return null;
  const restingHR = rollingRestingHR(sleepHistory);
  if (restingHR == null) return null;
  const zones = karvonenZones({ maxHR, restingHR });
  if (!zones) return null;
  return {
    ...zones,
    computedFrom: { method: 'karvonen', maxHR, restingHR, samplesDays: 28 },
  };
}
