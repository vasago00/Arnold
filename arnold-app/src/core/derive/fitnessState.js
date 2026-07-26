// core/derive/fitnessState.js — Phase 2 of FITNESS_MODEL_ARCHITECTURE.md: PROCESS + FUSION.
//
// Fuses the Phase-1 level observations (races/tempos/intervals → VDOT, from fitnessObservation.js) into ONE
// current fitness state via a recursive Bayesian (scalar Kalman) filter — the tractable form of the Banister
// impulse-response model. This is where Emil's principle becomes math:
//   • "compound BOTH training and recorded efforts"      → every observation updates the state, weighted by
//                                                           its trust (Kalman gain): a race pulls hard, a
//                                                           tempo moderately.
//   • "races decay; training picks up until another anchor" → between observations the state's uncertainty
//                                                           GROWS (process noise), so an old anchor's pin
//                                                           loosens; and easy-run EFFICIENCY drifts the state
//                                                           between anchors (training compounds).
//   • "decay timescale = the fitness's BUILD time" (Emil) → the uncertainty-growth rate per observation is
//                                                           q = Q0 / T_build, so a marathon anchor (long
//                                                           build) decays far slower than a 5K (short build).
//   • "never a number not anchored to data"              → no level observation → null.
//
// Easy runs never set the LEVEL (Phase 1 returns null for them); here they contribute only a bounded
// efficiency-trend DRIFT and (later) training load. This is what stops base miles from dictating the number.
//
// PURE + node-testable. `today` and `hrMax` injected.

import { effortToVdot } from './fitnessObservation.js';

const KM_PER_MI = 1.60934;
const DAY_MS = 86400000;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// ── Filter constants (documented defaults; Phase 4 back-tests these) ──
const Q0 = 1.0;              // process-noise scale: over T_build days, σ² grows ~1 VDOT² (a race's variance) →
                            // the anchor's influence roughly halves at its build-time. THIS is the decay knob.
// Easy-pace-at-HR is a WEAK, confounded signal (summer heat, terrain, fatigue all slow easy pace without any
// loss of fitness), so it may only NUDGE the level between anchors — never override a demonstrated benchmark.
// Emil's real data forced this: a genuine VDOT-41 runner (a raced half + a tempo) was being dragged to 38 by a
// −4.5%/month easy-pace trend that was really just July heat. Caps cut to a gentle ±1.8%/month, ≤3% per gap.
const DRIFT_CAP_PER_GAP = 0.03;   // max fractional VDOT drift from efficiency between two observations (±3%)
const EFF_RATE_CAP = 0.0006;      // max efficiency trend, fractional VDOT/day (~±1.8%/month)
const SIGMA_FLOOR = 0.5;          // VDOT — never claim more certainty than a single race really gives
const RACE_FLOOR_GAP = 5;         // VDOT — a race >5 below your BEST recent race is a jogged/sub-maximal effort
                                  // (a fun-run), not evidence of lost fitness → excluded as a level anchor.

function ageDays(dateStr, today) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  if (!Number.isFinite(d) || !Number.isFinite(t)) return Infinity;
  return (t - d) / DAY_MS;
}
function gapDays(aStr, bStr) {
  const a = new Date(`${aStr}T12:00:00`).getTime(), b = new Date(`${bStr}T12:00:00`).getTime();
  return (Number.isFinite(a) && Number.isFinite(b)) ? Math.max(0, (b - a) / DAY_MS) : 0;
}

// Build-time (days) an effort's result represents — the decay timescale (Emil). Scales with the AEROBIC
// demand: marathon endurance is slow to build and slow to lose; 5K speed builds/fades fast. Population prior;
// personalized from the athlete's own build history later. For non-race efforts, a general-aerobic default.
export function buildTimeDays(obs) {
  if (obs.kind === 'race' && obs.distanceKm > 0) return clamp(30 + 2.1 * obs.distanceKm, 42, 120);
  if (obs.kind === 'threshold') return 63;   // ~9 wk general threshold build
  if (obs.kind === 'vo2') return 42;          // ~6 wk — top-end sharpens (and fades) fast
  return 56;
}

// Bounded easy-run EFFICIENCY trend, as a fractional VDOT drift PER DAY. Easy runs at a given effort getting
// faster = fitness rising. This is the ONLY way easy base miles move the state (never the level directly).
export function easyEfficiencyRate(activities, opts = {}) {
  const today = opts.today || new Date();
  const hrMax = num(opts.hrMax);
  if (!hrMax) return 0;
  const easy = (activities || []).map((a) => {
    const mi = num(a.distanceMi ?? a.distance_mi); const km = mi != null ? mi * KM_PER_MI : num(a.distanceKm);
    const sec = num(a.durationSecs); const hr = num(a.avgHR ?? a.averageHR);
    if (!km || !sec || !hr) return null;
    const hrPct = hr / hrMax; if (hrPct > 0.82 || hrPct < 0.55) return null;   // easy band only
    return { days: ageDays(a.date, today), cost: (sec / km) * hrPct };          // pace-per-km at a given %HRmax
  }).filter(Boolean).filter((r) => r.days <= 56);
  const recent = easy.filter((r) => r.days <= 21).map((r) => r.cost);
  const older = easy.filter((r) => r.days > 21 && r.days <= 56).map((r) => r.cost);
  if (recent.length < 2 || older.length < 2) return 0;
  const rm = median(recent), om = median(older);
  if (!(om > 0)) return 0;
  const frac = (om - rm) / om;               // recent cheaper (faster at same HR) = positive = fitter
  const spanDays = 21;                        // ~centre-to-centre of the two windows
  return clamp(frac / spanDays, -EFF_RATE_CAP, EFF_RATE_CAP);
}

/**
 * estimateFitnessState(activities, { today, hrMax }) → { vdot, sigma, asOf, effRate, nObs, contributions[] }
 * or null when there is no LEVEL observation (anchoring rule). `contributions` records each observation's
 * Kalman gain, so the UI/provenance can show what actually moved the number.
 */
export function estimateFitnessState(activities, opts = {}) {
  const today = opts.today || new Date();
  // Authoritative race dates — controlled-effort races (Emil's 80–84% HRmax races) are recognised as
  // races via the athlete's own calendar, not a fragile HR/name heuristic. Accept a prebuilt Set or a
  // races[] list; either way effortToVdot's classifier consults it.
  const raceDates = opts.raceDates instanceof Set ? opts.raceDates
    : (Array.isArray(opts.races) ? new Set(opts.races.map((r) => String((r && r.date) || '').slice(0, 10)).filter(Boolean)) : null);
  const oOpts = raceDates ? { ...opts, raceDates } : opts;
  // Phase-1 level observations, enriched with distance + build-time, sorted oldest→newest.
  let obs = (Array.isArray(activities) ? activities : [])
    .map((a) => {
      const o = effortToVdot(a, oOpts);
      if (!o || !o.date) return null;
      const mi = num(a.distanceMi ?? a.distance_mi); const km = mi != null ? mi * KM_PER_MI : num(a.distanceKm);
      const withKm = { ...o, distanceKm: km || 0 };
      return { ...withKm, Tbuild: buildTimeDays(withKm) };
    })
    .filter(Boolean)
    // CURRENT-fitness window (Emil): the LEVEL reflects only RECENT efforts. A race decays to near-zero
    // predictive value by ~4–6 months (its build-time), so 180 days is the hard cutoff for a level anchor —
    // an 8-month-old marathon (even a good one) says nothing reliable about today and only leaks staleness in.
    // Older efforts are NOT discarded from the app — they drive DURABILITY/experience (marathonExperience, up
    // to ~3 yr) and back-testing; they just don't set the current number.
    .filter((o) => ageDays(o.date, today) <= 180)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // A race is a fitness FLOOR, not a two-way measurement: a jogged/charity race (Emil's "Run as One JP
  // Morgan" 4-miler, implied VDOT ~30 next to his 41 race efforts) is NOT evidence he got slower — you can
  // always run EASIER than your fitness. Drop any race effort implying a VDOT well below your BEST recent
  // race so it can't drag the level down (that outlier was pulling his estimate from ~40 → 38, i.e. 3:49 →
  // 3:59). Genuine decline still registers — through the process-model drift and a SUSTAINED pattern of
  // slower efforts, not a single easy race. Only races are floored (they're the hard anchors); softer
  // threshold/vo2 evidence already carries higher variance.
  const raceVdots = obs.filter((o) => o.kind === 'race').map((o) => o.vdot);
  if (raceVdots.length) {
    const bestRace = Math.max(...raceVdots);
    const kept = obs.filter((o) => !(o.kind === 'race' && o.vdot < bestRace - RACE_FLOOR_GAP));
    if (kept.length) obs = kept;   // never empty the stream
  }
  if (!obs.length) return null;

  const effRate = easyEfficiencyRate(activities, opts);

  // ── The scalar Kalman filter ──
  let F = obs[0].vdot;
  let sig2 = obs[0].variance;
  let Tgov = obs[0].Tbuild;          // governing build-time (follows the dominant anchor via the gain)
  let tPrev = obs[0].date;
  const contributions = [{ date: obs[0].date, kind: obs[0].kind, vdot: obs[0].vdot, gain: 1 }];

  const predictForward = (toDateStr) => {
    const dt = gapDays(tPrev, toDateStr);
    if (dt <= 0) return;
    F = F * (1 + clamp(effRate * dt, -DRIFT_CAP_PER_GAP, DRIFT_CAP_PER_GAP));   // efficiency drift (training compounds)
    sig2 = sig2 + (Q0 / Tgov) * dt;                                            // build-time-proportional decay
    tPrev = toDateStr;
  };

  for (let i = 1; i < obs.length; i++) {
    const o = obs[i];
    predictForward(o.date);
    const K = sig2 / (sig2 + o.variance);            // Kalman gain ∈ (0,1): race→~1, weaker effort→smaller
    F = F + K * (o.vdot - F);
    sig2 = (1 - K) * sig2;
    Tgov = Tgov * (1 - K) + o.Tbuild * K;            // governing build-time follows the dominant evidence
    contributions.push({ date: o.date, kind: o.kind, vdot: o.vdot, gain: +K.toFixed(3) });
  }
  // Predict from the last observation to today (the number ages toward "now").
  const asOf = tPrev;
  predictForward(typeof today === 'string' ? today : today.toISOString().slice(0, 10));

  const sigma = Math.max(SIGMA_FLOOR, Math.sqrt(Math.max(0, sig2)));
  return {
    vdot: +F.toFixed(1),
    sigma: +sigma.toFixed(2),
    asOf,                                   // date of the most recent LEVEL observation
    effRate: +effRate.toFixed(5),
    nObs: obs.length,
    contributions: contributions.slice(-6),
  };
}

export default estimateFitnessState;
