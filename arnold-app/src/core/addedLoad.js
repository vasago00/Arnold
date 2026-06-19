// Added-load capture — weight vest / pack / rucking load carried during a session.
//
// Per Emil's design call: capture one-tap per session; factor into (a) effort/load
// CONTEXT (the card/coach note "at +6 lb" — HR already reflects the strain, so this
// is honest context, not double-counting) and (b) PACE/POWER EXPECTATIONS (a slower
// weighted pace shouldn't read as lost fitness). Pure data layer; UI in
// components/AddedLoad.jsx. Keyed by the same stable signature as Session-RPE so a
// Garmin re-sync doesn't lose it.

import { storage } from './storage.js';
import { rpeKey } from './sessionRPE.js';

export function getAddedLoad(activity, dateStr) {
  const all = storage.get('addedLoad') || {};
  const e = all[rpeKey(activity, dateStr)];
  return e && Number.isFinite(e.lbs) && e.lbs > 0 ? e.lbs : null;
}

export function setAddedLoad(activity, dateStr, lbs) {
  const all = storage.get('addedLoad') || {};
  const key = rpeKey(activity, dateStr);
  const n = Number(lbs);
  if (!(n > 0)) { delete all[key]; }            // 0 / blank clears it
  else { all[key] = { lbs: Math.round(n * 10) / 10, ts: Date.now() }; }
  try { storage.set('addedLoad', all, { skipValidation: true }); } catch {}
  return n > 0 ? Math.round(n * 10) / 10 : null;
}

// Load as a fraction of bodyweight + the pace cost it implies. Field rule of thumb
// (Pandolf / load-carriage literature, simplified): pace cost ≈ the % of bodyweight
// added (≈1% slower per 1% added mass on flat aerobic running).
export function loadContext(addedLbs, bodyLbs) {
  if (!(addedLbs > 0) || !(bodyLbs > 0)) return null;
  const frac = addedLbs / bodyLbs;
  const pacePenaltyPct = +(frac * 100).toFixed(1);
  return { addedLbs, bodyLbs, fracPct: +(frac * 100).toFixed(1), pacePenaltyPct };
}

// Parse "8:30" /mi → seconds; format back. (Small local helpers so this module
// stays self-contained / node-testable.)
export function paceToSecs(p) {
  if (p == null) return null;
  if (Number.isFinite(+p)) return +p;
  const m = String(p).trim().match(/^(\d+):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
export function secsToPace(s) {
  if (!(s > 0)) return null;
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Unweighted-EQUIVALENT pace: what you'd have run WITHOUT the load. Carrying weight
// makes you slower, so the unweighted pace is faster → multiply by (1 - penalty).
// This is what keeps a weighted run from looking like a fitness regression.
export function unweightedEquivPaceSecs(actualSecsPerMi, addedLbs, bodyLbs) {
  const ctx = loadContext(addedLbs, bodyLbs);
  const a = paceToSecs(actualSecsPerMi);
  if (!ctx || !(a > 0)) return null;
  return Math.round(a * (1 - ctx.pacePenaltyPct / 100));
}
