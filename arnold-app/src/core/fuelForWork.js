// Fuel for the work required — Phase 2.2 of the uplift. Turns the (now adaptive)
// planned session into a NEXT-session nutrition prescription — pre-session carbs,
// recovery protein — and flags low energy availability (RED-S). This is the
// Fuelin / MAVR whitespace, paid for by the Cronometer integration Arnold already
// has.
//
// `prescribeFuel(session, ctx)` is PURE (no storage, no UI) so it unit-tests like
// adaptPlan. `fuelForToday()` is the thin storage-reading wrapper the tile calls;
// it assembles ctx from the energy-balance + goal-model engines.
//
// Science (citable):
//   • Pre-exercise carbohydrate, 1–4 h prior: 1–4 g/kg  (ACSM/AND/DC 2016 position
//     stand "Nutrition and Athletic Performance"; IOC 2011).
//   • During exercise: 0 g/h <75 min; 30–60 g/h for 1–2.5 h; up to 90 g/h (multiple
//     transportable carbs) beyond ~2.5 h.
//   • Recovery protein: 0.25–0.40 g/kg per serving (~20–40 g).
//   • Energy availability EA = (intake − exercise kcal) / fat-free mass (kg).
//     <30 kcal/kg FFM = low EA (RED-S risk); 30–45 = reduced; ≥45 = optimal
//     (Mountjoy et al. IOC RED-S consensus 2018; Loucks).

import { getCurrentBodyComp, dailyActivityCalories, computeTDEE } from './energyBalance.js';
import { getEffectiveTargets } from './goalModel.js';

const KG_PER_LB = 0.45359;
const HARD = new Set(['tempo', 'intervals', 'hiit', 'threshold', 'speed', 'hard', 'race']);
const NIL  = new Set(['rest', 'mobility', 'recovery']);

// Map a session (intensity + duration) → a fueling demand bracket. Duration and
// intensity both push it up; the higher wins.
function demandBracket(session) {
  const type = session?.type;
  // intensityClass is authoritative — an eased session keeps type:'tempo' but
  // carries intensityClass:'easy', and it should fuel like the easy work it now is.
  const intensity = session?.intensityClass || type;
  const mins = Number(session?.durationMin) || 0;
  if (NIL.has(intensity)) return 'none';

  const isHard = HARD.has(intensity);

  // Duration tiers first.
  let dur = mins >= 150 ? 4 : mins >= 90 ? 3 : mins >= 45 ? 2 : mins > 0 ? 1 : 0;
  // Intensity floor: a hard session is at least a "moderate-hard" demand even if
  // short (a 45-min threshold run taxes glycogen like a longer easy run).
  let inti = isHard ? 3 : 1;

  const tier = Math.max(dur, inti);
  return tier >= 4 ? 'very-high'
       : tier >= 3 ? 'high'
       : tier >= 2 ? 'moderate'
       :             'light';
}

// Pre-session carbohydrate in g/kg, by bracket. Sits inside the 1–4 g/kg window
// (the figure is a pre-session MEAL 2–3 h out, not just the final hour).
const PRE_CARB_G_PER_KG = { none: 0, light: 0.5, moderate: 1.0, high: 1.5, 'very-high': 2.5 };
// During-exercise carbohydrate g/h, by bracket (0 until the session is long enough).
const DURING_CARB_G_PER_HR = { none: 0, light: 0, moderate: 0, high: 40, 'very-high': 75 };

/**
 * prescribeFuel(session, ctx) → next-session nutrition prescription.
 *
 * session: { type, intensityClass?, distanceMi?, durationMin?, label? }
 * ctx:     { bodyMassKg, ffmKg, intakeKcal, activityKcal, dailyCalorieTarget }
 * returns: {
 *   bracket, preCarbsG, duringCarbsPerHr, pmProteinG,
 *   ea: { kcalPerKgFfm, status:'low'|'reduced'|'optimal'|null, flag },
 *   deficitVsTarget,                 // intake − target; negative = under
 *   summary, reason,
 * }
 */
export function prescribeFuel(session, ctx = {}) {
  const {
    bodyMassKg = null, ffmKg = null,
    intakeKcal = null, activityKcal = 0, dailyCalorieTarget = null,
  } = ctx;

  const bracket = demandBracket(session);
  const mins = Number(session?.durationMin) || 0;
  const mass = Number(bodyMassKg) > 0 ? Number(bodyMassKg) : null;

  // Pre-session carbs + recovery protein scale with body mass. Round to friendly
  // increments (carbs → 5 g, protein → 5 g).
  const round5 = (g) => Math.round(g / 5) * 5;
  const preCarbsG = mass && bracket !== 'none' ? round5(mass * PRE_CARB_G_PER_KG[bracket]) : 0;
  const duringCarbsPerHr = mins >= 75 ? DURING_CARB_G_PER_HR[bracket] : 0;
  // Recovery protein: 0.3 g/kg, bumped to 0.4 for hard/long sessions; min 20 g.
  const heavy = bracket === 'high' || bracket === 'very-high';
  const pmProteinG = mass && bracket !== 'none'
    ? Math.max(20, round5(mass * (heavy ? 0.4 : 0.3)))
    : 0;

  // Energy availability (RED-S).
  let ea = { kcalPerKgFfm: null, status: null, flag: false };
  if (Number(ffmKg) > 0 && Number.isFinite(Number(intakeKcal))) {
    const v = Math.round((intakeKcal - (Number(activityKcal) || 0)) / ffmKg);
    const status = v < 30 ? 'low' : v < 45 ? 'reduced' : 'optimal';
    ea = { kcalPerKgFfm: v, status, flag: status === 'low' };
  }

  const deficitVsTarget = Number.isFinite(Number(intakeKcal)) && Number.isFinite(Number(dailyCalorieTarget))
    ? Math.round(intakeKcal - dailyCalorieTarget)
    : null;

  // One-line summary, in the acceptance-criteria shape.
  const label = session?.label || session?.type || 'session';
  const parts = [];
  if (preCarbsG > 0) parts.push(`~${preCarbsG} g carbs pre`);
  if (duringCarbsPerHr > 0) parts.push(`${duringCarbsPerHr} g/h carbs during`);
  if (pmProteinG > 0) parts.push(`${pmProteinG} g protein PM`);
  let summary = parts.length ? `${label} → ${parts.join(', ')}.` : `${label} → fuel from normal meals.`;
  if (deficitVsTarget != null) {
    const mag = Math.abs(deficitVsTarget);
    if (mag >= 50) summary += ` You're ~${mag} ${deficitVsTarget < 0 ? 'under' : 'over'} today.`;
  }
  if (ea.flag) summary += ` Low energy availability (EA ${ea.kcalPerKgFfm}) — eat before training.`;

  const reason = bracket === 'none'
    ? 'Recovery day — no targeted pre-load needed.'
    : `${bracket} fueling demand (${mins ? mins + ' min' : 'session'}${heavy ? ', hard' : ''}).`;

  return { bracket, preCarbsG, duringCarbsPerHr, pmProteinG, ea, deficitVsTarget, summary, reason };
}

/**
 * Thin storage-reading wrapper: assemble ctx from the energy-balance + goal-model
 * engines and prescribe for the given (already-adapted) session. Kept separate so
 * `prescribeFuel` stays pure/testable.
 */
export function fuelForToday(session, opts = {}) {
  let ctx = {};
  try {
    const date = opts.date || undefined;
    const comp = getCurrentBodyComp();
    const tdee = computeTDEE(date);
    const targets = getEffectiveTargets(date ? { date } : {});
    ctx = {
      bodyMassKg: comp.weightLbs * KG_PER_LB,
      ffmKg: comp.leanMassLbs * KG_PER_LB,
      intakeKcal: tdee.intakeKcal,
      activityKcal: dailyActivityCalories(date),
      dailyCalorieTarget: targets?.dailyCalories?.effective ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[fuelForWork] ctx assembly fell back:', e?.message || e);
  }
  return prescribeFuel(session, ctx);
}

export default prescribeFuel;
