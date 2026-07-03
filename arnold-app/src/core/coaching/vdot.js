// core/coaching/vdot.js — Jack Daniels' VDOT model, implemented from the underlying
// Daniels–Gilbert equations (NOT hand-typed tables, so it's exact + reproducible).
// This is the ADOPTED, validated method (COACHING_PHILOSOPHY_GOAL_BACKWARD.md · Pillar 1);
// the personalization layer (personalize.js) then bends the outputs to the athlete.
//
// Sources:
//   • Daniels & Gilbert, "Oxygen Power" (1979) — the VO2/velocity + %VO2max-vs-duration curves.
//   • Jack Daniels, "Daniels' Running Formula" (3rd ed.) — training intensities E/M/T/I/R.
//
// Equations:
//   velocity v in m/min. Aerobic demand (ml/kg/min):
//     VO2(v)   = -4.60 + 0.182258·v + 0.000104·v²
//   Fraction of VO2max sustainable for a race lasting t minutes:
//     drop(t)  = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
//   VDOT = VO2(v) / drop(t).  Training paces = velocity that elicits a target %VO2max.
//
// ⚠️ VERIFY: the per-zone %VO2max midpoints below are tunable and should be sanity-checked
// against a trusted VDOT calculator (see anchor outputs in the P1 hand-off) before these
// drive real plans. The VDOT number itself is exact from the formula.

const M_PER_MILE = 1609.344;

// Daniels training zones as a fraction of VO2max. Ranges are his; the single value is the
// midpoint we compute at (TUNABLE — flagged for verification). E/M/T/I/R.
// Tuned to reproduce Daniels' published tables at VDOT 50 (hand-checked): T/I/R landed
// exactly at 0.88/1.00/1.06; E and M were a touch fast at 0.70/0.84, so lowered to
// 0.64/0.82 (E→8:51/mi, M→7:17/mi, T→6:51/mi, I→6:10/mi, R→5:53/mi at VDOT 50 — verify).
export const ZONE_PCT = {
  easy:      0.64,   // Easy / Long  (Daniels 59–74%)
  marathon:  0.82,   // Marathon      (75–84%)
  threshold: 0.88,   // Threshold     (83–88%)
  interval:  1.00,   // Interval      (95–100%, vVO2max)
  rep:       1.06,   // Repetition    (mechanical, faster than I)
};

function vo2AtVelocity(v) { return -4.60 + 0.182258 * v + 0.000104 * v * v; }
function dropAtMinutes(t) { return 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); }

// Invert VO2(v) → velocity (m/min) for a given aerobic demand.
function velocityForVO2(vo2) {
  const a = 0.000104, b = 0.182258, c = -(vo2 + 4.60);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

// VDOT from a race performance. distanceMeters + timeSecs → VDOT (one decimal).
export function vdotFromRace(timeSecs, distanceMeters) {
  if (!(timeSecs > 0) || !(distanceMeters > 0)) return null;
  const t = timeSecs / 60;
  const v = distanceMeters / t;
  const vdot = vo2AtVelocity(v) / dropAtMinutes(t);
  return vdot > 0 ? +vdot.toFixed(1) : null;
}

// Predicted race time (secs) at a distance for a given VDOT — solve drop(t)·VDOT = VO2(d/t)
// for t by bisection (monotonic in the racing range). Powers goal-backward (P2).
export function raceTimeFromVdot(vdot, distanceMeters) {
  if (!(vdot > 0) || !(distanceMeters > 0)) return null;
  let lo = 1, hi = 6000; // minutes bounds (1 min … 100 h)
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = distanceMeters / mid;
    const predictedVdot = vo2AtVelocity(v) / dropAtMinutes(mid);
    if (predictedVdot > vdot) lo = mid; else hi = mid;   // faster (shorter t) → higher vdot
  }
  return Math.round(((lo + hi) / 2) * 60);
}

// Training pace (sec/mile) at a target %VO2max for a VDOT.
export function paceForPct(vdot, pct) {
  if (!(vdot > 0)) return null;
  const v = velocityForVO2(pct * vdot);   // m/min
  if (!(v > 0)) return null;
  return Math.round((M_PER_MILE / v) * 60);
}

// The full E/M/T/I/R prescription (sec/mile) for a VDOT.
export function trainingPaces(vdot) {
  if (!(vdot > 0)) return null;
  return {
    easy:      paceForPct(vdot, ZONE_PCT.easy),
    marathon:  paceForPct(vdot, ZONE_PCT.marathon),
    threshold: paceForPct(vdot, ZONE_PCT.threshold),
    interval:  paceForPct(vdot, ZONE_PCT.interval),
    rep:       paceForPct(vdot, ZONE_PCT.rep),
    vdot,
  };
}

// "m:ss" formatter for a sec/mile pace.
export function fmtPaceMi(secPerMi) {
  if (!(secPerMi > 0)) return null;
  const m = Math.floor(secPerMi / 60), s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
