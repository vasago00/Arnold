// Hub core — race ↔ fitness inversion. Connects REAL logged races to the fitness
// ledger and lets the accumulated fitness make predictions, consistently with the
// app's existing Riegel predictor (tileMetrics.js: T2 = T1·(D2/D1)^k). See
// docs/HUB_CORE.md.
//
// The hub's fitness scalar is the race-equivalent time at a REFERENCE distance
// (default 10 km), normalized by the personal fatigue exponent k. Any race is
// folded to that reference; predictions unfold it back to a target distance. So
// one Estimate captures "current race-equivalent fitness" and k captures
// endurance/durability (supplied from the existing fatigueExponent fit).
//
// Pure, unit-tested in tests/hubRaceFitness.test.mjs.

import { confidence } from './estimate.js';
import { recordCheckpoint } from './hubState.js';

export const RACE_FITNESS_PARAM = 'ref10kEquivSecs';
export const REF_KM = 10;
const KM_PER_MI = 1.60934;
const DEFAULT_K = 1.06; // Riegel's classic exponent; pass the personal k when known

// Riegel-normalize a result to the reference distance: equiv = T·(refKm/D)^k.
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

// Turn a logged race into the fitness observation(s) the router consumes.
// Returns { paramObservations:[{param,observedValue}], meta } or null.
export function observationsFromRace(race, opts = {}) {
  const dt = raceDistanceTime(race);
  if (!dt) return null;
  const k = Number.isFinite(opts.k) ? opts.k : DEFAULT_K;
  const refKm = opts.refKm ?? REF_KM;
  const equiv = raceEquivSecs(dt.distanceKm, dt.actualSecs, k, refKm);
  if (!(equiv > 0)) return null;
  return {
    paramObservations: [{ param: RACE_FITNESS_PARAM, observedValue: equiv, halfLifeWeeks: opts.halfLifeWeeks }],
    meta: { distanceKm: dt.distanceKm, actualSecs: dt.actualSecs, k, refKm, equivSecs: Math.round(equiv) },
  };
}

// Predict a target-distance time from the hub's accumulated fitness scalar:
//   T_target = ref10kEquiv · (targetKm/refKm)^k
// Returns { secs, confidence, refEquivSecs } or null if fitness isn't seeded yet.
export function predictFromFitness(fitnessModel, targetKm, opts = {}) {
  const est = fitnessModel && fitnessModel.params && fitnessModel.params[RACE_FITNESS_PARAM];
  if (!est || !Number.isFinite(est.value) || !(targetKm > 0)) return null;
  const k = Number.isFinite(opts.k) ? opts.k : DEFAULT_K;
  const refKm = opts.refKm ?? REF_KM;
  const secs = est.value * Math.pow(targetKm / refKm, k);
  return { secs: Math.round(secs), confidence: confidence(est, opts.k0 ?? 1), refEquivSecs: Math.round(est.value) };
}

// High-level: fold a real race (+ its attribution) into the hub. Derives the
// fitness observation from the result, then routes through recordCheckpoint so
// BOTH ledgers update (fitness from the equiv time, response from any residual).
// Returns { state, ingest } or { state, ingest:null, skipped } if not a usable race.
export function recordRace(hubState, race, attribution, opts = {}) {
  const obs = observationsFromRace(race, opts);
  if (!obs) return { state: hubState, ingest: null, skipped: 'not a usable running result (need distance ≥1km + time)' };
  const res = recordCheckpoint(hubState, attribution, { ...opts, paramObservations: obs.paramObservations });
  res.fitnessObs = obs.meta;
  return res;
}
