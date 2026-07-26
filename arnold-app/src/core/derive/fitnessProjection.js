// core/derive/fitnessProjection.js — Phase 3 of FITNESS_MODEL_ARCHITECTURE.md: PROJECTION + BAND.
//
// Turns the fused fitness state (fitnessState.js → { vdot, sigma }) into a race finish + an honest band.
// The number and its uncertainty both trace to the model, and the marathon fade is TRANSPARENT (a readiness-
// and durability-graded penalty) instead of a black-box exponent.
//
// DESIGN (Emil's decisions, FITNESS_MODEL_ARCHITECTURE.md §12):
//   • Base projection = the Daniels VDOT curve (assumes you're TRAINED for the distance) — clean physiology.
//   • Marathon fade = MODERATE FIXED + DURABILITY, graded by your ACTUAL long-run readiness. This is the
//     honest reason a 49-min-10K runner can project 3:45 on speed yet 4:05+ on the marathon: the legs
//     haven't proven they can hold it for 26.2. As the long runs come, the penalty shrinks → the number
//     drops. (Short races: no penalty — VDOT predicts them well already.)
//   • Band = the state's own σ mapped through the projection (+ extra width for an unproven distance). It
//     tightens when a benchmark lands, widens as anchors decay — because it IS the model's uncertainty.
//
// PURE + node-testable. `today`, `hrMax`, and `activities` (for long-run readiness + durability) injected.

import { raceTimeFromVdot } from '../coaching/vdot.js';
import { estimateDurability } from './durability.js';
import { marathonExperience } from './marathonExperience.js';   // career durability → relaxes the unproven-distance fade

const KM_PER_MI = 1.60934;
const DAY_MS = 86400000;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';

function ageDays(dateStr, today) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  return (Number.isFinite(d) && Number.isFinite(t)) ? (t - d) / DAY_MS : Infinity;
}

// Longest single run (km) in the last `days` — the "have you been there?" readiness signal.
function longestLongKm(activities, today, days = 70) {
  let best = 0;
  for (const a of (activities || [])) {
    if (ageDays(a.date, today) > days) continue;
    const mi = num(a.distanceMi ?? a.distance_mi); const km = mi != null ? mi * KM_PER_MI : num(a.distanceKm);
    if (km && km > best) best = km;
  }
  return best || null;
}

/**
 * projectRace(state, distanceKm, { activities, today, hrMax }) → projection or null.
 *   { seconds, low, high, confidence, base, fade, readiness, durability, asOf, vdot }
 * `base` is the trained-for-distance Daniels time; `fade` is the transparent readiness+durability penalty.
 */
export function projectRace(state, distanceKm, opts = {}) {
  if (!state || !(state.vdot > 0) || !(distanceKm > 0)) return null;
  const today = opts.today || new Date();
  const base = raceTimeFromVdot(state.vdot, distanceKm * 1000);   // Daniels curve (trained for the distance)
  if (!(base > 0)) return null;

  // ── Marathon "unproven distance" fade — moderate fixed, graded by readiness, adjusted by durability +
  //    career EXPERIENCE (a proven marathoner is not as under-prepared as a novice at the same recent volume) ──
  let fade = 1.0, readiness = null, durab = null, exp = null;
  const isMarathonish = distanceKm >= 30;
  const isHalfish = distanceKm >= 16 && distanceKm < 30;
  if (isMarathonish || isHalfish) {
    const longest = longestLongKm(opts.activities, today);
    readiness = longest != null ? clamp(longest / distanceKm, 0, 1) : null;
    // Moderate fixed penalty, graded by how much of the distance you've actually covered in training.
    // Marathon penalties are the meaningful ones; the half gets a much gentler version.
    const scale = isMarathonish ? 1 : 0.4;
    let p = (readiness == null ? 0.06 : readiness >= 0.75 ? 0.02 : readiness >= 0.5 ? 0.05 : 0.09) * scale;
    // Durability adjusts the fade: proven late-run resilience shrinks it; fading enlarges it.
    durab = (() => { try { return estimateDurability(opts.activities, { today, hrMax: opts.hrMax }); } catch { return null; } })();
    if (durab) {
      if (durab.state === 'durable' || durab.trend === 'improving') p *= 0.6;
      else if (durab.state === 'fading' || durab.trend === 'declining') p *= 1.35;
    }
    // Career experience RELAXES the unproven-distance penalty (only for the marathon — the half doesn't need
    // proving). A seasoned marathoner keeps up to ~55% of the penalty removed; it's never eliminated, because
    // even a veteran who hasn't done recent long runs pays something. The LEVEL is untouched — this is fade only.
    if (isMarathonish) {
      exp = (() => { try { return marathonExperience(opts.activities, { today, careerRaces: opts.careerRaces }); } catch { return null; } })();
      if (exp && exp.expFactor > 0) p *= (1 - 0.55 * exp.expFactor);
    }
    fade = 1 + p;
  }
  const seconds = Math.round(base * fade);

  // ── Band from the state's uncertainty (σ in VDOT) mapped through the projection ──
  const tAtVdot = (v) => raceTimeFromVdot(v, distanceKm * 1000) * fade;
  const slower = tAtVdot(state.vdot - state.sigma);   // lower VDOT → slower time (the high end)
  const faster = tAtVdot(state.vdot + state.sigma);   // higher VDOT → faster time (the low end)
  const fadeUncert = isMarathonish ? 0.03 : (isHalfish ? 0.015 : 0);   // extra width for the fade guess
  const low = Math.round(Math.min(faster, seconds * (1 - fadeUncert)));
  const high = Math.round(Math.max(slower, seconds * (1 + fadeUncert)));

  // Confidence from σ: a tight state (σ≈0.5–1 VDOT, a fresh race) → high; a loose one (σ≈4) → low.
  const confidence = +clamp(1 - (state.sigma - 0.5) / 4, 0.2, 0.95).toFixed(2);

  return {
    seconds, low, high, confidence,
    base: Math.round(base), fade: +fade.toFixed(3),
    readiness: readiness != null ? +readiness.toFixed(2) : null,
    durability: durab ? { state: durab.state, trend: durab.trend, source: durab.source } : null,
    experience: exp ? { finishes: exp.finishes, lastDaysAgo: exp.lastDaysAgo, expFactor: exp.expFactor } : null,
    asOf: state.asOf, vdot: state.vdot, sigma: state.sigma, distanceKm,
  };
}

export default projectRace;
