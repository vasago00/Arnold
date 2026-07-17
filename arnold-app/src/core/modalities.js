// core/modalities.js — the athlete's EQUIPMENT / MODALITY profile: what they can
// actually train on. The GATE for every cross-training substitution the coach offers
// (SESSION_AGILITY_DESIGN §2). Without it the ladder offered "hit the pool" to people
// with no pool; with it, the coach only ever suggests what you own — and asks when it
// doesn't know yet.
//
// Pure data + a thin storage wrapper. `capabilitiesFor()` is pure (no storage) so the
// swap ladder (sessionAdapt v2) and its tests can reason about modalities directly.

import { storage } from './storage.js';

const KEY = 'modalities';

// The modalities we model. Order = display order.
export const MODALITIES = ['pool', 'bike', 'treadmill', 'gym', 'elliptical', 'rower'];

export const MODALITY_LABEL = {
  pool: 'Pool', bike: 'Bike / Peloton', treadmill: 'Treadmill',
  gym: 'Gym (weights)', elliptical: 'Elliptical', rower: 'Rower',
};

// What each modality can STAND IN FOR, and whether it's joint-safe (usable when a run
// is injury-aggravated — the point being to protect the joint, not keep pounding it).
//   trains   — dimensions it can substitute (matches SESSION_INTENT dims vocabulary)
//   jointSafe— impact-free / spares the aggravated joint
//   vo2      — can carry a hard VO₂/threshold stimulus (not just easy aerobic)
export const MODALITY_CAP = {
  pool:       { trains: ['aerobic', 'durability'],       jointSafe: true,  vo2: true,  how: 'deep-water run' },   // ~1:1 aerobic, impact-free
  bike:       { trains: ['aerobic', 'vo2', 'threshold'], jointSafe: true,  vo2: true,  how: 'bike' },
  elliptical: { trains: ['aerobic'],                     jointSafe: true,  vo2: false, how: 'elliptical' },
  rower:      { trains: ['aerobic', 'power'],            jointSafe: true,  vo2: true,  how: 'row' },
  treadmill:  { trains: ['aerobic', 'vo2', 'speed'],     jointSafe: false, vo2: true,  how: 'treadmill' },        // still running impact
  gym:        { trains: ['durability', 'economy'],       jointSafe: true,  vo2: false, how: 'upper-body + core' }, // spares the legs
};

// ── storage ──────────────────────────────────────────────────────────────────
// Returns the stored profile object { pool:bool, ... } or null when never set (unknown).
export function getModalities() {
  try { const m = storage.get(KEY); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : null; }
  catch { return null; }
}

// Normalises to a clean boolean map over the known modalities and persists it.
export function setModalities(next) {
  const clean = {};
  for (const k of MODALITIES) clean[k] = !!(next && next[k]);
  try { storage.set(KEY, clean); } catch { /* best-effort */ }
  return clean;
}

// Has the athlete actually told us what they have? (≥1 owned = configured.) A never-set
// profile (null) reads as UNKNOWN → the coach asks before offering equipment swaps.
export function hasModalityProfile(m = getModalities()) {
  return !!(m && MODALITIES.some((k) => m[k]));
}

// The owned modalities as a list of keys.
export function ownedModalities(m = getModalities()) {
  return m ? MODALITIES.filter((k) => m[k]) : [];
}

// ── pure capability read (for the swap ladder) ─────────────────────────────────
// Given a profile (or owned-keys array) return the capability records the ladder can
// offer, optionally filtered to joint-safe only (injury). Pure — no storage.
export function capabilitiesFor(profileOrKeys, { jointSafeOnly = false } = {}) {
  const keys = Array.isArray(profileOrKeys)
    ? profileOrKeys
    : MODALITIES.filter((k) => profileOrKeys && profileOrKeys[k]);
  return keys
    .filter((k) => MODALITY_CAP[k])
    .filter((k) => (jointSafeOnly ? MODALITY_CAP[k].jointSafe : true))
    .map((k) => ({ key: k, label: MODALITY_LABEL[k], ...MODALITY_CAP[k] }));
}

// The one-time ask, when the coach wants to offer a swap but the profile is empty.
export const MODALITY_ASK = 'What can you train on — pool · bike/Peloton · gym · treadmill · elliptical · rower? Tell me once and I’ll tailor every swap to what you actually have.';

export default getModalities;
