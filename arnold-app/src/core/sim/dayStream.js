// Day-stream generator — an autocorrelated sequence of training days for one
// synthetic athlete. A RANDOM WALK (not IID noise) because a real body's signals
// are serially correlated: today's HRV depends on yesterday's, fatigue accumulates
// from recent hard work and decays with rest, recovery debt builds and clears. This
// produces realistic trajectories, so the engine is tested on plausible sequences
// rather than impossible day-to-day whiplash.
//
// Output per day is the RAW signal set; the runner assembles these into the exact
// ctx objects adaptSession / prescribeFuel / composeCalorieTarget expect. Pure
// given an rng + athlete.

// Session templates PER DISCIPLINE: sampling weight + how they map to the engine's
// session shape. `intensityClass` matches the engine's HARD set (tempo/intervals/hiit)
// so eased sessions and fueling brackets are exercised across modalities. MET drives
// the kcal estimate; `dist` is RUN miles only (bike/swim/row leave it null — their
// load is carried by MET × duration, which is what stresses the fuel + calorie math).
// Durations are capped at serious-AMATEUR volumes (long ride ≤ 3.5 h, long run ≤ 2.5 h)
// so the harness pressure-tests the high-burn end without drifting into pro-tour
// territory the app isn't built for.
const DISCIPLINE_TEMPLATES = {
  // Pure runner — the original single-sport profile.
  runner: [
    { w: 3, type: 'rest',          intensityClass: 'rest',      met: 0,   dur: [0, 0],    dist: [0, 0]  },
    { w: 5, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [30, 55],  dist: [3, 7]  },
    { w: 2, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [80, 150], dist: [10, 20], long: true },
    { w: 2, type: 'tempo',         intensityClass: 'tempo',     met: 12,  dur: [35, 70],  dist: [5, 9]  },
    { w: 2, type: 'intervals',     intensityClass: 'intervals', met: 13,  dur: [30, 55],  dist: [4, 7]  },
    { w: 1, type: 'hiit',          intensityClass: 'hiit',      met: 10,  dur: [25, 45],  dist: [0, 0]  },
    { w: 3, type: 'strength',      intensityClass: 'strength',  met: 6,   dur: [40, 70],  dist: [0, 0]  },
    { w: 2, type: 'mobility',      intensityClass: 'mobility',  met: 2.5, dur: [20, 40],  dist: [0, 0]  },
  ],
  // Triathlete — swim/bike/run mix with the long ride as the big-burn stressor.
  triathlete: [
    { w: 2, type: 'rest',          intensityClass: 'rest',      met: 0,   dur: [0, 0],    dist: [0, 0]  },
    { w: 3, type: 'Pool Swim',     intensityClass: 'easy',      met: 7,   dur: [30, 70],  dist: [0, 0]  },
    { w: 2, type: 'Pool Swim',     intensityClass: 'intervals', met: 9,   dur: [35, 60],  dist: [0, 0]  },
    { w: 4, type: 'Cycling',       intensityClass: 'easy',      met: 7,   dur: [45, 120], dist: [0, 0]  },
    { w: 2, type: 'Cycling',       intensityClass: 'easy',      met: 6.5, dur: [150, 210],dist: [0, 0],  long: true },
    { w: 2, type: 'Cycling',       intensityClass: 'tempo',     met: 10,  dur: [45, 90],  dist: [0, 0]  },
    { w: 1, type: 'Cycling',       intensityClass: 'intervals', met: 12,  dur: [40, 70],  dist: [0, 0]  },
    { w: 4, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [30, 60],  dist: [3, 7]  },
    { w: 1, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [80, 130], dist: [10, 16], long: true },
    { w: 2, type: 'tempo',         intensityClass: 'tempo',     met: 12,  dur: [35, 60],  dist: [5, 8]  },
    { w: 2, type: 'strength',      intensityClass: 'strength',  met: 6,   dur: [35, 60],  dist: [0, 0]  },
    { w: 1, type: 'mobility',      intensityClass: 'mobility',  met: 2.5, dur: [20, 40],  dist: [0, 0]  },
  ],
  // Cyclist — bike-dominant, long endurance rides + hard efforts, occasional run.
  cyclist: [
    { w: 3, type: 'rest',          intensityClass: 'rest',      met: 0,   dur: [0, 0],    dist: [0, 0]  },
    { w: 6, type: 'Cycling',       intensityClass: 'easy',      met: 7,   dur: [60, 150], dist: [0, 0]  },
    { w: 3, type: 'Cycling',       intensityClass: 'easy',      met: 6,   dur: [180, 210],dist: [0, 0],  long: true },
    { w: 3, type: 'Cycling',       intensityClass: 'tempo',     met: 10,  dur: [50, 100], dist: [0, 0]  },
    { w: 2, type: 'Cycling',       intensityClass: 'intervals', met: 12,  dur: [45, 80],  dist: [0, 0]  },
    { w: 1, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [25, 45],  dist: [2, 5]  },
    { w: 2, type: 'strength',      intensityClass: 'strength',  met: 6,   dur: [40, 60],  dist: [0, 0]  },
    { w: 2, type: 'mobility',      intensityClass: 'mobility',  met: 2.5, dur: [20, 40],  dist: [0, 0]  },
  ],
  // Hybrid — run + strength-heavy + HIIT/rowing (CrossFit-style mixed).
  hybrid: [
    { w: 3, type: 'rest',          intensityClass: 'rest',      met: 0,   dur: [0, 0],    dist: [0, 0]  },
    { w: 4, type: 'Run (outdoor)', intensityClass: 'easy',      met: 9,   dur: [30, 50],  dist: [3, 6]  },
    { w: 2, type: 'hiit',          intensityClass: 'hiit',      met: 11,  dur: [20, 40],  dist: [0, 0]  },
    { w: 2, type: 'intervals',     intensityClass: 'intervals', met: 12,  dur: [25, 45],  dist: [3, 6]  },
    { w: 5, type: 'strength',      intensityClass: 'strength',  met: 6,   dur: [45, 75],  dist: [0, 0]  },
    { w: 2, type: 'Rowing',        intensityClass: 'tempo',     met: 9,   dur: [20, 45],  dist: [0, 0]  },
    { w: 2, type: 'mobility',      intensityClass: 'mobility',  met: 2.5, dur: [20, 40],  dist: [0, 0]  },
  ],
};
const LABEL = { rest: 'Rest', easy: 'Easy', tempo: 'Tempo', intervals: 'Intervals', hiit: 'HIIT', strength: 'Strength', mobility: 'Mobility' };
const HARD = new Set(['tempo', 'intervals', 'hiit']);

function templatesFor(athlete) {
  return DISCIPLINE_TEMPLATES[athlete && athlete.discipline] || DISCIPLINE_TEMPLATES.runner;
}

function pickTemplate(rng, templates) {
  const totalW = templates.reduce((s, t) => s + t.w, 0);
  let r = rng.uniform(0, totalW);
  for (const t of templates) { if ((r -= t.w) <= 0) return t; }
  return templates[0];
}

export function generateDayStream(rng, athlete, nDays = 25) {
  const templates = templatesFor(athlete);
  const days = [];
  // Random-walk state (carried across days).
  let hrvDelta = 0;          // ms vs baseline; AR(1)
  let debtLbs = rng.uniform(0, 1);
  let loadAccum = 0;         // fatigue accumulator

  for (let i = 0; i < nDays; i++) {
    const tpl = pickTemplate(rng, templates);
    const isHard = HARD.has(tpl.intensityClass);
    const isLong = !!tpl.long;

    const durationMin = tpl.dur[1] > 0 ? Math.round(rng.uniform(tpl.dur[0], tpl.dur[1])) : 0;
    const distanceMi  = tpl.dist[1] > 0 ? Math.round(rng.uniform(tpl.dist[0], tpl.dist[1]) * 10) / 10 : null;
    // kcal ≈ MET × mass(kg) × hours (1 MET = 1 kcal/kg/h).
    const activityKcal = Math.round(tpl.met * athlete.bodyMassKg * (durationMin / 60));

    // ── Autocorrelated signals ──
    // HRV: AR(1) around baseline (mean-reverting), knocked down by hard/long work.
    hrvDelta = 0.7 * hrvDelta + rng.normal(0, 6) - (isHard ? 4 : 0) - (isLong ? 3 : 0);
    hrvDelta = Math.max(-30, Math.min(30, Math.round(hrvDelta)));

    // Recovery debt: decays ~20%/day, bumps after hard/long sessions.
    debtLbs = 0.8 * debtLbs + (isHard ? rng.uniform(0.4, 1.1) : 0) + (isLong ? rng.uniform(0.5, 1.3) : 0);
    debtLbs = Math.max(0, Math.min(5, Math.round(debtLbs * 10) / 10));

    // Fatigue accumulator → body-battery-style level 0..3.
    loadAccum = 0.7 * loadAccum + (isHard ? 2 : isLong ? 1.5 : durationMin > 0 ? 0.5 : 0);
    const fatigueLevel = Math.max(0, Math.min(3, Math.round(loadAccum / 2)));

    // Sleep around the athlete's goal (slightly under, as most people run a deficit).
    const sleepHrs = Math.round(rng.clampedNormal(athlete.sleepGoalHrs - 0.3, 1.0, 3, 10) * 10) / 10;

    // Readiness bucket — sampled from a realistic mix, nudged by the day's signals
    // (poor sleep / low HRV / high debt push it down). The sim tests the engine's
    // RESPONSE to readiness, so we feed the bucket directly.
    let rScore = 60 + (sleepHrs - athlete.sleepGoalHrs) * 8 + hrvDelta * 0.8 - debtLbs * 5 - fatigueLevel * 4 + rng.normal(0, 6);
    const readiness = rScore >= 72 ? 'high' : rScore >= 52 ? 'moderate' : 'low';

    // Calorie-target basis: maintenance minus a per-day deficit (0 = maintenance,
    // up to ~750 aggressive). Intake random-walks around (target ± noise), and can
    // go LOW to exercise the low-EA / RED-S path.
    const deficitKcal = Math.round(rng.uniform(0, 750));
    const baseTarget = athlete.maintenanceTdee - deficitKcal;
    const recoveryAdj = debtLbs >= 3 ? 200 : debtLbs >= 2 ? 100 : debtLbs >= 1 ? 50 : 0;
    const intakeKcal = Math.round(rng.clampedNormal(baseTarget + activityKcal * 0.6, 450, 600, 6000));

    days.push({
      dayIndex: i,
      session: {
        type: tpl.type,
        intensityClass: tpl.intensityClass,
        distanceMi,
        durationMin: durationMin || null,
        label: LABEL[tpl.intensityClass] || tpl.type,
      },
      isHard, isLong,
      // adaptSession ctx signals
      readiness, debtLbs, hrvDelta, sleepHrs, sleepGoalHrs: athlete.sleepGoalHrs, fatigueLevel,
      // calorie-target inputs
      baseTarget, recoveryAdj, deficitKcal,
      eatBack: Math.round(activityKcal * 0.6),   // corrected-burn × fraction (sim uses 0.6)
      // fuel ctx
      activityKcal, intakeKcal,
    });
  }
  return days;
}

export default generateDayStream;
