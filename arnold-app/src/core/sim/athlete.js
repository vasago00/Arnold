// Synthetic-athlete generator for the simulation harness.
//
// Samples a plausible athlete from documented distributions so the engine gets
// pressure-tested across the SPACE of bodies — not just Emil's single physiology.
// Every distribution below is annotated with its rationale so the harness stays
// transparent: you can see (and challenge) exactly what population we're testing.
//
// Ranges are deliberately WIDE (recreational → elite, both sexes, wide body-comp)
// so edge cases the real user never hits still get exercised. Pure given an rng.

const KG_PER_LB = 0.45359;

// RMR via Katch-McArdle: 370 + 21.6 × lean-body-mass(kg). Same formula the app's
// RMR tile uses, so simulated RMRs match the real derivation.
function katchRmr(leanMassLbs) {
  return Math.round(370 + 21.6 * (leanMassLbs * KG_PER_LB));
}

export function generateAthlete(rng) {
  // Sex ~ 50/50. Drives weight, body-fat and HRmax priors.
  const sex = rng.chance(0.5) ? 'M' : 'F';

  // Age 18–60 (the training population). Uniform — we want even coverage, not a
  // realistic age pyramid, so older/younger edges get equal test weight.
  const age = rng.int(18, 60);

  // Weight: sex-specific normal, clamped to a broad healthy-athlete band (lb).
  const weightLbs = sex === 'M'
    ? rng.clampedNormal(178, 22, 120, 250)
    : rng.clampedNormal(145, 20, 95, 220);

  // Body-fat %: sex-specific, clamped to athletic→average (lean elites to higher
  // recreational). Essential-fat floors respected (M≥5, F≥12).
  const bodyFatPct = sex === 'M'
    ? rng.clampedNormal(16, 5, 5, 32)
    : rng.clampedNormal(24, 5, 12, 40);

  const leanMassLbs = weightLbs * (1 - bodyFatPct / 100);
  const rmr = katchRmr(leanMassLbs);

  // Fitness level → sets activity factor (for maintenance TDEE) and training
  // volume in the day-stream. Skewed toward recreational/trained (the realistic mix).
  const fitness = rng.choice(['recreational', 'recreational', 'trained', 'trained', 'elite']);
  const activityFactor = { recreational: 1.5, trained: 1.65, elite: 1.85 }[fitness];

  // HRmax (Tanaka 208 − 0.7·age) with individual spread; HRV baseline (ms, rMSSD)
  // is age/fitness-dependent — fitter + younger trends higher.
  const hrMax = Math.round(rng.clampedNormal(208 - 0.7 * age, 6, 150, 210));
  const hrvBaseline = Math.round(rng.clampedNormal(
    { recreational: 45, trained: 60, elite: 80 }[fitness] - 0.25 * (age - 30),
    12, 18, 130,
  ));

  // Sleep goal 7–9h (individual need).
  const sleepGoalHrs = Math.round(rng.clampedNormal(7.8, 0.6, 6.5, 9.5) * 10) / 10;

  return {
    sex, age, fitness,
    weightLbs: Math.round(weightLbs * 10) / 10,
    bodyFatPct: Math.round(bodyFatPct * 10) / 10,
    leanMassLbs: Math.round(leanMassLbs * 10) / 10,
    bodyMassKg: weightLbs * KG_PER_LB,
    ffmKg: leanMassLbs * KG_PER_LB,
    rmr,
    hrMax,
    hrvBaseline,
    sleepGoalHrs,
    activityFactor,
    // Maintenance TDEE prior (resting) — RMR × activity factor. The day-stream
    // adds a per-day deficit for the calorie-target basis.
    maintenanceTdee: Math.round(rmr * activityFactor),
  };
}

export default generateAthlete;
