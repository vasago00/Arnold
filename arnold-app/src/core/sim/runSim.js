// runSim — the Monte-Carlo orchestrator. Generates N synthetic athletes, walks each
// through a day-stream, runs the REAL engine functions (adaptSession, prescribeFuel,
// composeCalorieTarget — imported, not re-implemented) on every day, and checks the
// invariants. Returns a structured, transparent report: total cases, any hard
// violations (with the seed + indices to reproduce), aggregate rates vs their
// margins, and output distributions so a human can eyeball plausibility.
//
// Deterministic: same seed → same run. A reported violation is reproducible.

import { makeRng } from './prng.js';
import { generateAthlete } from './athlete.js';
import { generateDayStream } from './dayStream.js';
import { adaptSession } from '../adaptPlan.js';
import { prescribeFuel } from '../fuelForWork.js';
import { composeCalorieTarget } from '../calorieTargetMath.js';
import { checkCase, checkAggregate, checkFuelMonotonic } from './invariants.js';

export function runSim({ seed = 20260702, nAthletes = 400, daysPerAthlete = 25, maxStoredViolations = 25 } = {}) {
  const rng = makeRng(seed);
  const stats = {
    cases: 0, greenlit: 0, lowEa: 0,
    hardLowReadiness: 0, hardLowReadinessEased: 0,
    actions: { ease: 0, trim: 0, hold: 0, greenlit: 0 },
    brackets: { none: 0, light: 0, moderate: 0, high: 0, 'very-high': 0 },
    targetMin: Infinity, targetMax: -Infinity, targetSum: 0,
    byDiscipline: {},   // { runner:{athletes,cases,hardViolations}, triathlete:{…}, … }
  };
  const hardViolations = [];
  const monotonicViolations = [];
  let hardViolationCount = 0;

  for (let ai = 0; ai < nAthletes; ai++) {
    const athlete = generateAthlete(rng);
    const disc = athlete.discipline || 'runner';
    const db = stats.byDiscipline[disc] || (stats.byDiscipline[disc] = { athletes: 0, cases: 0, hardViolations: 0 });
    db.athletes++;

    // Deterministic structural check (fuel monotonicity) once per athlete.
    for (const mv of checkFuelMonotonic(prescribeFuel, athlete)) {
      hardViolationCount++;
      db.hardViolations++;
      if (monotonicViolations.length < maxStoredViolations) monotonicViolations.push({ athleteIndex: ai, discipline: disc, ...mv });
    }

    const days = generateDayStream(rng, athlete, daysPerAthlete);
    for (const day of days) {
      const debtLevel = day.debtLbs >= 3 ? 3 : day.debtLbs >= 2 ? 2 : day.debtLbs >= 1 ? 1 : 0;

      const adapted = adaptSession(day.session, {
        readiness: day.readiness, debtLbs: day.debtLbs, hrvDelta: day.hrvDelta,
        sleepHrs: day.sleepHrs, sleepGoalHrs: day.sleepGoalHrs, fatigueLevel: day.fatigueLevel,
      });

      const targetArgs = { baseTarget: day.baseTarget, recoveryAdj: day.recoveryAdj, flatBonus: 0, rmr: athlete.rmr, debt: debtLevel };
      const target = composeCalorieTarget({ ...targetArgs, eatBack: day.eatBack });
      const targetNoEatBack = composeCalorieTarget({ ...targetArgs, eatBack: 0 });

      // Fuel the ADAPTED session (eased → less), matching the app's flow.
      const fuel = prescribeFuel(adapted, {
        bodyMassKg: athlete.bodyMassKg, ffmKg: athlete.ffmKg,
        intakeKcal: day.intakeKcal, activityKcal: day.activityKcal,
        dailyCalorieTarget: target.derived,
      });

      const out = { adapted, fuel, target, targetNoEatBack };
      const violations = checkCase(day, out);
      if (violations.length) {
        hardViolationCount += violations.length;
        db.hardViolations += violations.length;
        for (const vio of violations) {
          if (hardViolations.length < maxStoredViolations) {
            hardViolations.push({
              seed, athleteIndex: ai, discipline: disc, dayIndex: day.dayIndex, ...vio,
              snapshot: {
                fitness: athlete.fitness, rmr: athlete.rmr,
                session: day.session.intensityClass, readiness: day.readiness,
                debtLbs: day.debtLbs, eatBack: day.eatBack, derived: target.derived, floor: target.effectiveFloor,
                ea: fuel.ea?.kcalPerKgFfm ?? null,
              },
            });
          }
        }
      }

      // Accumulate stats.
      stats.cases++;
      db.cases++;
      if (stats.actions[adapted.action] != null) stats.actions[adapted.action]++;
      if (adapted.action === 'greenlit') stats.greenlit++;
      if (stats.brackets[fuel.bracket] != null) stats.brackets[fuel.bracket]++;
      if (fuel.ea?.status === 'low') stats.lowEa++;
      if (day.isHard && day.readiness === 'low') {
        stats.hardLowReadiness++;
        if (adapted.action === 'ease' || adapted.action === 'trim') stats.hardLowReadinessEased++;
      }
      if (Number.isFinite(target.derived)) {
        stats.targetMin = Math.min(stats.targetMin, target.derived);
        stats.targetMax = Math.max(stats.targetMax, target.derived);
        stats.targetSum += target.derived;
      }
    }
  }

  const aggregateViolations = checkAggregate(stats);
  const pct = (n) => `${((n / stats.cases) * 100).toFixed(1)}%`;

  return {
    seed, athletes: nAthletes, daysPerAthlete, cases: stats.cases,
    hardViolationCount,
    hardViolations,          // capped sample, each with seed + indices to reproduce
    monotonicViolations,
    aggregateViolations,
    ok: hardViolationCount === 0 && aggregateViolations.length === 0,
    byDiscipline: stats.byDiscipline,   // per-discipline coverage + violation counts (multi-sport transparency)
    summary: {
      actionRates: {
        ease: pct(stats.actions.ease), trim: pct(stats.actions.trim),
        hold: pct(stats.actions.hold), greenlit: pct(stats.actions.greenlit),
      },
      fuelBrackets: Object.fromEntries(Object.entries(stats.brackets).map(([k, n]) => [k, pct(n)])),
      lowEaRate: pct(stats.lowEa),
      hardLowReadinessEasedRate: stats.hardLowReadiness ? `${((stats.hardLowReadinessEased / stats.hardLowReadiness) * 100).toFixed(1)}%` : 'n/a',
      calorieTarget: {
        min: stats.targetMin === Infinity ? null : stats.targetMin,
        max: stats.targetMax === -Infinity ? null : stats.targetMax,
        mean: Math.round(stats.targetSum / Math.max(1, stats.cases)),
      },
    },
  };
}

export default runSim;
