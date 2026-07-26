// core/derive/fitnessObservation.js — Phase 1 of FITNESS_MODEL_ARCHITECTURE.md: the OBSERVATION LAYER.
//
// Turns each run into evidence about current fitness, expressed in one currency — Daniels VDOT — using the
// CORRECT intensity for the effort type, not a naïve "Riegel as if it were a race" projection (the bug that
// produced 5:57). Each run → { vdot, variance, kind, date }. Variance encodes how much we trust that run.
//
// THE PHYSIOLOGY (all via the existing, validated coaching/vdot.js):
//   • A RACE / all-out effort is a maximal performance → VDOT directly from the duration-aware curve
//     (vdotFromRace, which already discounts sustainable %VO2max by duration).
//   • A TEMPO/THRESHOLD run is sustained at ~88% VO2max. Its velocity, read at that fixed intensity, implies
//     a VDOT:  VDOT = VO2(velocity) / 0.88.  (NOT a maximal projection — a tempo isn't a failed race.)
//   • INTERVALS/VO2 reps sit at ~100% VO2max → VDOT = VO2(velocity) / 1.00.
//
// EASY runs and LONG steady runs deliberately DO NOT set the LEVEL here (they return null as level evidence).
// An easy run's implied level is bias-prone — depending on how "easy" you actually ran and your HR, it can
// spuriously imply a HIGHER VDOT than a race. Per the architecture, easy runs inform the TREND (efficiency)
// and training LOAD in the process model (Phase 2), and long runs inform DURABILITY (durability.js) — never
// the level. This is what keeps a base-miles week from dragging the number (the anchoring discipline).
//
// PURE + node-testable. VDOT math is reused, not reinvented, so the whole app stays on one fitness scale.

import { vdotFromRace, raceTimeFromVdot } from '../coaching/vdot.js';

const M_PER_MILE = 1609.34;
const KM_PER_MI = 1.60934;
const STANDARD_KM = [5, 10, 21.0975, 42.195];
// Min HRmax fraction for a CROSS-REFERENCED race (logged in the race calendar) to count as an actual race
// effort. Sits below a controlled race (Emil raced halves/10Ks at 81–86%) and above an easy run (~70–76%),
// so a race label mistakenly left on an easy run doesn't anchor fitness. Only applied when HR is present.
const RACE_XREF_HR_FLOOR = 0.78;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';

// vo2AtVelocity (Daniels) — VO2 cost of a velocity in m/min. Kept local so we don't widen vdot.js's API.
const vo2AtVelocity = (vMperMin) => -4.60 + 0.182258 * vMperMin + 0.000104 * vMperMin * vMperMin;

// Non-run sports that must NEVER be read as running evidence — a 6-hour Resort Ski covers 45 km and was being
// scored as a slow marathon (VDOT 24.9), anchoring the whole state to the floor. This is the run-gate.
const NON_RUN = /\b(ski|snowboard|cycl|bik|ride|swim|strength|hiit|walk|hik|row|ellipt|yoga|mobility|breath|skate|hyrox|cardio)\w*/i;

function runVitals(a) {
  // RUN-GATE: only running activities are running-fitness evidence. Honour an explicit run flag first (the app
  // tags each activity isRun/isStrength/…); otherwise reject anything whose type names a non-run sport. Session
  // labels like "tempo"/"intervals" carry no sport word and no isRun flag → they pass (they're runs by context).
  const type = String((a && (a.activityType ?? a.type ?? a.sport ?? a.garminTypeKey)) || '').toLowerCase();
  const isRunTrue = a && (a.isRun === true);
  const isRunFalse = a && (a.isRun === false);
  if (isRunFalse || (!isRunTrue && NON_RUN.test(type))) return null;

  const mi = num(a && (a.distanceMi ?? a.distance_mi ?? a.miles));
  const km = mi != null ? mi * KM_PER_MI : num(a && (a.distanceKm ?? a.distance_km));
  const sec = num(a && (a.durationSecs ?? a.durationSeconds)) ?? (num(a && a.durationMinutes) != null ? num(a.durationMinutes) * 60 : null);
  if (!km || km <= 0 || !sec || sec <= 0) return null;
  const vMperMin = (km * 1000) / (sec / 60);
  // PHYSIOLOGICAL SANITY GATE (the immune system). A corrupt record — a GPS glitch logging 42 km in 6 min, a
  // treadmill mis-cal, a lap stored as a full activity — produces an impossible velocity that, unguarded,
  // becomes a VDOT of thousands and poisons the whole fitness state (the "1:00 marathon" bug). No human sustains
  // faster than ~450 m/min (the ~12:35 5K world-record pace) over ≥1.5 km, so anything past that is bad data,
  // not evidence: drop it. (Slow garbage is caught downstream by the VDOT band in effortToVdot.)
  if (!(vMperMin > 0) || vMperMin > 450) return null;
  // A Garmin race auto-titles with the event name ("Chicago Marathon", "TCS New York City Marathon",
  // "Berlin Marathon", a parkrun, a championship). Those names ARE the race signal — matching only /race/
  // missed every marathon (they say "Marathon", not "race"). Match the vocabulary of racing, not the word.
  const label = String((a && (a.name ?? a.title ?? a.Title)) || '');
  const isRaceFlag = !!(a && (a.isRace === true || /\b(race|marathon|parkrun|championship|half[-\s]?marathon|10\s?k|5\s?k)\b/i.test(label)));
  return { km, sec, vMperMin, avgHR: num(a && (a.avgHR ?? a.averageHR ?? a.avg_hr)), type: String((a && (a.activityType ?? a.type)) || '').toLowerCase(), isRaceFlag };
}

const nearStandard = (km) => STANDARD_KM.some((s) => Math.abs(km - s) / s <= 0.05);

/**
 * classifyEffort(run, { hrMax }) → 'race' | 'threshold' | 'vo2' | 'long' | 'easy' | 'other'.
 * Uses HR when available (the reliable signal); falls back to type + distance. Only race/threshold/vo2 are
 * LEVEL evidence; long/easy/other are handled elsewhere (durability, trend, load).
 */
export function classifyEffort(run, opts = {}) {
  const v = runVitals(run);
  if (!v || v.km < 1.5) return 'other';
  const hrMax = num(opts.hrMax);
  const hrPct = (hrMax && v.avgHR) ? v.avgHR / hrMax : null;
  const t = v.type;

  // ── The race hierarchy (Emil 2026-07), in strict precedence ──
  //
  // 0. CONFIRMATION IS AUTHORITATIVE. If the athlete has answered the "did you race this?" prompt, that
  //    answer wins over every heuristic — no guessing over a human's explicit call (Garmin's model). This is
  //    what removes the guesswork entirely: once confirmed, the effort's race-ness is settled forever.
  if (run && run.raceConfirmed === true) return 'race';
  const denied = !!(run && run.raceConfirmed === false);   // confirmed NOT a race → may never be classed 'race'

  // 1. INTENT + unambiguous distance: a marathon-DISTANCE effort (≥26 mi / 41.5 km) IS a race — no HR gate.
  //    Nobody trains at full marathon distance (peak long runs cap ~22 mi), so a 26-mi effort is always a
  //    race, even one paced at 79% HRmax (Emil's Sydney) or with a dead HR strap (his 2023 Berlin read 96 bpm).
  //    A confirmed-NO still overrides (a rare training ultra the athlete says wasn't a race).
  if (v.km >= 41.5 && !denied) return 'race';

  // 2. INTENT (race calendar) + EXECUTION (was it run like a race?). A date in the athlete's own race calendar
  //    makes it a race CANDIDATE — but a logged race must actually have been RACED. Emil logged "Run as One JP
  //    Morgan" then found the day's activity is an easy run (71% HRmax, 10:17/mi): a label on an easy effort is
  //    a data-entry artifact, not a performance. So the calendar rescues a CONTROLLED race (his 81–86%
  //    halves/10Ks the raw HR gate would reject) but NOT an easy run. The gray zone in between doesn't get
  //    silently guessed here — raceConfirmationNeeded() flags it for a one-tap prompt, and the answer becomes
  //    the authoritative case 0 above. (No HR to judge → honor the label; the fitness-floor nets any outlier.)
  const rd = opts.raceDates;
  const dstr = String((run && run.date) || '').slice(0, 10);
  const loggedRace = !!(rd && dstr && (rd instanceof Set ? rd.has(dstr) : !!rd[dstr]));
  if (loggedRace && !denied && (hrPct == null || hrPct >= RACE_XREF_HR_FLOOR)) return 'race';

  // 3. Explicit race flag / type from the source (Garmin auto-titles, planner tags).
  if (!denied && (v.isRaceFlag || t.includes('race'))) return 'race';

  // Shorter standard-distance efforts (5K/10K/half) need a hard-effort HR gate to separate a race from a
  // same-distance easy run — the gate scales down with distance (a 5K race sits at ~95% HRmax, a half at ~88%).
  if (nearStandard(v.km)) {
    // A half raced at 84% HRmax (Emil's Brooklyn Half) is a race effort — 0.85 dropped it by one point. An
    // efficient runner holds a half just below threshold, so 0.83 is the honest floor for the half distance.
    const gate = v.km >= 30 ? 0.78 : v.km >= 15 ? 0.83 : v.km >= 8 ? 0.88 : 0.90;
    if (!denied && (hrPct != null ? hrPct >= gate : v.km >= 30)) return 'race';
  }

  // Type hints win when present (planner-tagged sessions).
  if (/interval|vo2|speed|rep/.test(t)) return 'vo2';
  if (/tempo|threshold/.test(t)) return 'threshold';

  // HR-driven classification (no explicit type).
  if (hrPct != null) {
    if (hrPct >= 0.92 && v.km >= 3 && !denied) return 'race';   // a hard time-trial-like effort (unless denied)
    if (hrPct >= 0.90) return 'vo2';
    if (hrPct >= 0.85) return 'threshold';
    if (v.sec >= 90 * 60 || v.km >= 24) return 'long';
    return 'easy';
  }
  // No HR: fall back to duration/type only, conservatively.
  if (t.includes('long') || v.sec >= 90 * 60 || v.km >= 24) return 'long';
  return 'other';   // without HR or a type/standard-distance signal we can't trust an intensity → not level evidence
}

/**
 * raceConfirmationNeeded(run, opts) → reason string | null — the "Did you race this?" trigger (Garmin's model).
 * The threshold's job is not to DECIDE a gray-zone effort, it's to decide when to ASK. Returns a reason when
 * INTENT and EXECUTION disagree AND the athlete hasn't answered yet, so the app prompts once and stores the
 * answer on the activity as `raceConfirmed` (true|false) — which then wins authoritatively in classifyEffort,
 * removing the guesswork for good. Returns null when there's nothing to ask (already answered, or no ambiguity).
 *   'logged-easy'   — on the race calendar but run at EASY effort (Emil's "Run as One"): a real race, or a mislog?
 *   'unlogged-hard' — a near-max effort at a standard race distance that is NOT on the calendar: log it as a race?
 * A BAD race (logged + high HR + slow time) is NOT flagged — it was run as a race, so it needs no confirmation;
 * it stays a race and the fitness-floor keeps its slow time from dragging the level (you had a bad day, not less
 * fitness). Only genuine intent/execution CONFLICTS surface here.
 */
export function raceConfirmationNeeded(run, opts = {}) {
  if (!run || run.raceConfirmed === true || run.raceConfirmed === false) return null;   // answered → never ask again
  const v = runVitals(run);
  if (!v || v.km < 3) return null;
  if (v.km >= 41.5) return null;                       // marathon distance is unambiguous — no prompt
  const hrMax = num(opts.hrMax);
  const hrPct = (hrMax && v.avgHR) ? v.avgHR / hrMax : null;
  if (hrPct == null) return null;                      // no HR → no basis to question the effort
  const rd = opts.raceDates;
  const dstr = String(run.date || '').slice(0, 10);
  const loggedRace = !!(rd && dstr && (rd instanceof Set ? rd.has(dstr) : !!rd[dstr]));
  if (loggedRace && hrPct < RACE_XREF_HR_FLOOR) return 'logged-easy';           // JP Morgan: on the calendar, ran easy
  if (!loggedRace && hrPct >= 0.92 && nearStandard(v.km)) return 'unlogged-hard'; // hard standard-distance, not logged
  return null;
}

// %VO2max the effort was sustained at, by kind. (Race handled separately via the maximal curve.)
const PCT_FOR = { threshold: 0.88, vo2: 1.00 };

// Starting measurement variances (VDOT² units) — how much we trust each kind's LEVEL. Race is the tightest.
// These are documented defaults; Phase 4 back-testing tunes them.
const VAR_FOR = { race: 1.0, threshold: 4.0, vo2: 6.0 };

/**
 * effortToVdot(run, { hrMax }) → { vdot, variance, kind, date } for LEVEL evidence (race/threshold/vo2),
 * or null for easy/long/other (not level evidence — see the header). This is the input stream to the
 * fitness-state filter (Phase 2).
 */
export function effortToVdot(run, opts = {}) {
  const v = runVitals(run);
  if (!v) return null;
  const kind = classifyEffort(run, opts);

  if (kind === 'race') {
    const vdot = vdotFromRace(v.sec, v.km * 1000);   // maximal, duration-aware
    // Same human-range band the threshold/vo2 branches enforce (this was the hole): a real race VDOT sits in
    // ~[20, 88] (88 ≈ the elite-marathon ceiling). Anything outside is corrupt data, not a performance → drop.
    if (!(vdot > 0) || vdot > 88 || vdot < 20) return null;
    return { vdot: +vdot.toFixed(1), variance: VAR_FOR.race, kind, date: run.date || null };
  }
  if (kind === 'threshold' || kind === 'vo2') {
    // Effort sustained at PCT_FOR[kind] of VO2max → VDOT = VO2(velocity) / pct.
    const pct = PCT_FOR[kind];
    const vdot = vo2AtVelocity(v.vMperMin) / pct;
    if (!(vdot > 0) || vdot > 90 || vdot < 20) return null;   // sanity band
    return { vdot: +vdot.toFixed(1), variance: VAR_FOR[kind], kind, date: run.date || null };
  }
  return null;   // easy / long / other → not a LEVEL observation
}

// Convenience: project a VDOT to a race time (secs) — used by the projection layer + tests.
export function vdotToRaceSecs(vdot, distanceKm) {
  if (!(vdot > 0) || !(distanceKm > 0)) return null;
  return raceTimeFromVdot(vdot, distanceKm * 1000);
}

export default effortToVdot;
