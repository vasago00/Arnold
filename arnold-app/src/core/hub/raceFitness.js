// Hub core — race ↔ fitness inversion. Connects REAL logged races to the fitness
// ledger and lets the accumulated fitness make predictions, consistently with the
// app's existing Riegel predictor (tileMetrics.js: T2 = T1·(D2/D1)^k). See
// docs/HUB_CORE.md + docs/HUB_GO_LIVE.md (Step 1 calibration).
//
// The hub's fitness scalar is the race-equivalent time at a REFERENCE distance
// (default 10 km). Any race is FOLDED to that reference; predictions UNFOLD it to
// a target distance. The exponent is DISTANCE-AWARE: each conversion uses the
// fatigue exponent appropriate to its own distance span (a gentle ~1.07 for
// 10↔HM, a steep ~1.15 for 10↔M) rather than one global k — which is what kept the
// 10K read optimistic when a longer race was folded down with the marathon-fade k.
// Pass opts.kFor(fromKm,toKm) for the distance-aware exponent; opts.k is the
// constant fallback.
//
// Pure, unit-tested in tests/hubRaceFitness.test.mjs.

import { confidence } from './estimate.js';
import { recordCheckpoint } from './hubState.js';

export const RACE_FITNESS_PARAM = 'ref10kEquivSecs';
export const REF_KM = 10;
const KM_PER_MI = 1.60934;
const DEFAULT_K = 1.06; // Riegel's classic exponent; pass kFor/k when known

// The exponent to use converting between two distances. Distance-aware kFor wins;
// otherwise the constant k; otherwise Riegel's 1.06.
function exponentFor(fromKm, toKm, opts = {}) {
  if (typeof opts.kFor === 'function') {
    const v = opts.kFor(fromKm, toKm);
    if (Number.isFinite(v)) return v;
  }
  return Number.isFinite(opts.k) ? opts.k : DEFAULT_K;
}

// Riegel-normalize a result from distance D to refKm using exponent k:
//   equiv = T · (refKm / D)^k
export function raceEquivSecs(distanceKm, actualSecs, k = DEFAULT_K, refKm = REF_KM) {
  if (!(distanceKm > 0) || !(actualSecs > 0)) return null;
  return actualSecs * Math.pow(refKm / distanceKm, k);
}

// Pull (distanceKm, actualSecs) from a race-like object (mi or km; durationSecs
// or actualSecs). Returns null if it isn't a usable running result.
function raceDistanceTime(race) {
  if (!race) return null;
  const distanceKm = Number(race.distanceKm)
    || (Number(race.distanceMi || race.distance_mi) * KM_PER_MI) || null;
  const actualSecs = Number(race.actualSecs ?? race.durationSecs) || null;
  if (!(distanceKm > 1) || !(actualSecs > 0)) return null;
  return { distanceKm, actualSecs };
}

// Turn a logged race into the fitness observation(s) the router consumes. The fold
// from the race distance to the reference uses the distance-aware exponent for
// THAT span. Returns { paramObservations, meta } or null.
export function observationsFromRace(race, opts = {}) {
  const dt = raceDistanceTime(race);
  if (!dt) return null;
  const refKm = opts.refKm ?? REF_KM;
  const kFold = exponentFor(dt.distanceKm, refKm, opts);
  const equiv = raceEquivSecs(dt.distanceKm, dt.actualSecs, kFold, refKm);
  if (!(equiv > 0)) return null;
  return {
    paramObservations: [{ param: RACE_FITNESS_PARAM, observedValue: equiv, halfLifeWeeks: opts.halfLifeWeeks }],
    meta: { distanceKm: dt.distanceKm, actualSecs: dt.actualSecs, k: kFold, refKm, equivSecs: Math.round(equiv) },
  };
}

// Predict a target-distance time from the hub's accumulated fitness scalar. The
// unfold from the reference to the target uses the distance-aware exponent for
// THAT span. Returns { secs, confidence, refEquivSecs, k } or null.
export function predictFromFitness(fitnessModel, targetKm, opts = {}) {
  const est = fitnessModel && fitnessModel.params && fitnessModel.params[RACE_FITNESS_PARAM];
  if (!est || !Number.isFinite(est.value) || !(targetKm > 0)) return null;
  const refKm = opts.refKm ?? REF_KM;
  const kUnfold = exponentFor(refKm, targetKm, opts);
  let secs = est.value * Math.pow(targetKm / refKm, kUnfold);

  // EXTRAPOLATION CONSERVATISM. The fitness scalar is sharp at the distances you've
  // actually raced, but a prediction far from any of them is an extrapolation that
  // tends optimistic (e.g. a 10K folded down from only a half). When opts.racedKms
  // (your raced distances) is supplied, nudge the time UP in proportion to how far
  // the target sits — in log-distance — from your NEAREST raced distance: 0 at a
  // raced distance, up to +6% at a 2× gap. Internal calls (backfill) omit racedKms
  // → no penalty, so the underlying model stays pure.
  const racedKms = Array.isArray(opts.racedKms) ? opts.racedKms.filter(d => d > 0) : null;
  let extrapPenalty = 0;
  if (racedKms && racedKms.length && secs > 0) {
    const gap = Math.min(...racedKms.map(d => Math.abs(Math.log(targetKm / d))));
    extrapPenalty = Math.min(0.06, (0.05 / Math.LN2) * gap);
    secs *= (1 + extrapPenalty);
  }
  return { secs: Math.round(secs), confidence: confidence(est, opts.k0 ?? 1), refEquivSecs: Math.round(est.value), k: kUnfold, extrapPenalty: +extrapPenalty.toFixed(3) };
}

// High-level: fold a real race (+ its attribution) into the hub. Derives the
// fitness observation from the result, then routes through recordCheckpoint so
// BOTH ledgers update (fitness from the equiv time, response from any residual).
// Returns { state, ingest } or { state, ingest:null, skipped } if not a usable race.
export function recordRace(hubState, race, attribution, opts = {}) {
  const obs = observationsFromRace(race, opts);
  if (!obs) return { state: hubState, ingest: null, skipped: 'not a usable running result (need distance >=1km + time)' };
  const res = recordCheckpoint(hubState, attribution, { ...opts, paramObservations: obs.paramObservations });
  res.fitnessObs = obs.meta;
  return res;
}
