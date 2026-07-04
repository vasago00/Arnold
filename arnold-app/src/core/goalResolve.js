// Unified goal model (Sprint 3.1). Assembles the scattered goal stores
// (goals.js GOAL_DEFS, the races store, body-comp, effective calorie target) into
// ONE structured object the coach reasons from — organized by the four dimensions
// (race / training / body / nutrition), each goal carrying a target + a HORIZON.
//
// `buildGoalModel(inputs)` is PURE — it takes already-resolved values, no storage,
// no DOM — so it unit-tests and pressure-tests (sim) cleanly, and generalizes to
// ANY athlete (the personal→product seam: nothing Emil-specific is baked in).
// `resolveGoalModel()` is the thin storage-reading wrapper the app calls.
//
// 3.1a scope: the assembler + shape + horizons. Conflict detection + trade-offs
// + user resolution land in 3.1b (the `conflicts` array is present but empty here).

import { racePhase, marathonFeasibility } from './seasonPlan.js';

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const MARATHON_MIN_MI = 24;   // matches seasonPlan.isMarathon threshold
const EA_FLOOR_KCAL_PER_KG = 30;   // RED-S guardrail (Mountjoy IOC 2018) — a cited population constant, not user-specific

function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = new Date(fromISO + 'T12:00:00'), b = new Date(toISO + 'T12:00:00');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * buildGoalModel — assemble the unified goal model from resolved inputs.
 *
 * @param {object} i
 *   today:            'YYYY-MM-DD'
 *   goals:            flat goals object (getGoals())
 *   races:            [{name,date,distanceMi,goalTimeSecs?}]
 *   aRaceDate:        explicit A-race date, or null → inferred (next marathon)
 *   currentWeightLbs, currentBodyFatPct
 *   effectiveCalories: today's effective calorie target (getEffectiveTargets)
 *   weeklyMiles, longestRecentMi: current training state
 *   predictedMarathonSecs: current race prediction (for feasibility), or null
 *   targetWeightDate: 'YYYY-MM-DD' deadline for the body-weight goal, or null
 * @returns {GoalModel}
 */
export function buildGoalModel(i = {}) {
  const today = i.today || new Date().toISOString().slice(0, 10);
  const goals = i.goals || {};
  const races = Array.isArray(i.races) ? i.races : [];

  // ── RACE dimension ──
  const rp = racePhase({ races, today, aRaceDate: i.aRaceDate || null });
  const isMarathon = (r) => (num(r?.distanceMi) || 0) >= MARATHON_MIN_MI;
  const aRaceRaw = i.aRaceDate
    ? races.find(r => r.date === i.aRaceDate) || null
    : rp.nextMarathon;
  const aRace = aRaceRaw ? {
    name: aRaceRaw.name || 'Goal race',
    date: aRaceRaw.date,
    distanceMi: num(aRaceRaw.distanceMi),
    goalTimeSecs: num(aRaceRaw.goalTimeSecs),
    daysOut: daysBetween(today, aRaceRaw.date),
  } : null;
  const tuneUps = races
    .filter(r => r?.date >= today && (!aRace || r.date !== aRace.date) && !isMarathon(r))
    .map(r => ({ name: r.name || 'Race', date: r.date, distanceMi: num(r.distanceMi), daysOut: daysBetween(today, r.date) }));
  const feasibility = marathonFeasibility({
    predictedMarathonSecs: num(i.predictedMarathonSecs),
    goalSecs: aRace?.goalTimeSecs ?? null,
    weeklyMiles: num(i.weeklyMiles) || 0,
    longestRecentMi: num(i.longestRecentMi) || 0,
  }).verdict;

  const race = { aRace, tuneUps, phase: rp.phase, feasibility };

  // ── TRAINING dimension (volume/frequency goals — ongoing horizon) ──
  const ongoing = (target, current) => ({ target: num(target), current: current === undefined ? null : num(current), horizon: 'ongoing' });
  const training = {
    weeklyMiles:    ongoing(goals.weeklyRunDistanceTarget, i.weeklyMiles),
    weeklyStrength: ongoing(goals.weeklyStrengthTarget),
    weeklyMobility: ongoing(goals.weeklyMobilitySessions),
    zone2Pct:       ongoing(goals.zone2Pct),
    longestRunMi:   { target: num(goals.longRunTargetMi) ?? null, current: num(i.longestRecentMi), horizon: 'ongoing' },
  };

  // ── BODY dimension (weight/composition — may carry a deadline) ──
  const curW = num(i.currentWeightLbs);
  const tgtW = num(goals.targetWeight);
  const lbsDelta = (curW != null && tgtW != null) ? curW - tgtW : null;   // + = need to lose
  const direction = lbsDelta == null ? 'unknown' : lbsDelta > 0.5 ? 'cut' : lbsDelta < -0.5 ? 'bulk' : 'maintain';
  const by = i.targetWeightDate || goals.targetWeightDate || null;
  const weeksRemaining = by ? Math.max(0.1, (daysBetween(today, by) || 0) / 7) : null;
  const rateLbPerWk = (lbsDelta != null && weeksRemaining) ? Math.round((lbsDelta / weeksRemaining) * 100) / 100 : null;
  const body = {
    weight: { target: tgtW, current: curW, by, daysOut: by ? daysBetween(today, by) : null, weeksRemaining, rateLbPerWk, direction, horizon: by ? 'deadline' : 'ongoing' },
    bodyFat: { target: num(goals.targetBodyFat), current: num(i.currentBodyFatPct), horizon: 'ongoing' },
  };

  // ── NUTRITION dimension (intake/macros + EA guardrail — ongoing) ──
  const nutrition = {
    calories: { target: num(goals.dailyCalorieTarget), effective: num(i.effectiveCalories), horizon: 'ongoing' },
    protein:  { target: num(goals.dailyProteinTarget) },
    carbs:    { target: num(goals.dailyCarbTarget) },
    fat:      { target: num(goals.dailyFatTarget) },
    fiber:    { target: num(goals.dailyFiberTarget) },
    water:    { target: num(goals.dailyWaterTarget) },
    eaFloor:  EA_FLOOR_KCAL_PER_KG,
  };

  const horizonDays = aRace?.daysOut ?? body.weight.daysOut ?? null;

  return {
    race, training, body, nutrition,
    conflicts: [],   // populated in 3.1b (detection + trade-offs + user resolution)
    meta: { asOf: today, horizonDays, dimensions: ['race', 'training', 'body', 'nutrition'] },
  };
}

/**
 * resolveGoalModel — thin storage-reading wrapper. Assembles inputs from the app's
 * stores/services and delegates to the pure buildGoalModel. Kept separate so the
 * assembler stays pure/testable. Failures degrade gracefully (missing input → null).
 */
export async function resolveGoalModel(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const [{ getGoals }, { getCurrentBodyComp }, { getEffectiveTargets }] = await Promise.all([
    import('./goals.js'), import('./energyBalance.js'), import('./goalModel.js'),
  ]);
  const goals = (() => { try { return getGoals() || {}; } catch { return {}; } })();
  const comp = (() => { try { return getCurrentBodyComp(); } catch { return null; } })();
  const races = (() => {
    try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); } catch { return []; }
  })();
  const effectiveCalories = (() => {
    try { return getEffectiveTargets({ date: today })?.dailyCalories?.effective ?? null; } catch { return null; }
  })();

  return buildGoalModel({
    today, goals, races,
    aRaceDate: opts.aRaceDate || goals.aRaceDate || null,
    currentWeightLbs: comp?.weightLbs ?? null,
    currentBodyFatPct: comp?.bodyFatPct ?? null,
    effectiveCalories,
    weeklyMiles: num(opts.weeklyMiles) || 0,
    longestRecentMi: num(opts.longestRecentMi) || 0,
    predictedMarathonSecs: num(opts.predictedMarathonSecs),
    targetWeightDate: goals.targetWeightDate || null,
  });
}

export default buildGoalModel;
