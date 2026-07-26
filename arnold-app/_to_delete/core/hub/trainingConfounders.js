// Hub core — TRAINING-RUN CONFOUNDERS beyond heat: HUMIDITY and ELEVATION.
//
// Same method as trainingHeat.js: at a matched easy effort, an environmental
// stressor pushes your HR UP relative to your usual run, and that HR elevation —
// regressed against the stressor over many runs — is a real personal sensitivity
// ("humid air costs me ~X% HR per 10%RH"; "climbing costs me ~Y% HR per 50 m/mi").
// These are the two categories Emil asked to add to "What Arnold has learned
// about you".
//
// KEY DESIGN — these build the per-run FACTOR observation only; they do NOT call
// observeOutcome themselves. accumulate.js gathers whichever confounders are
// present on a run (heatStrain + humidity + elevation) and feeds them TOGETHER
// through ONE observeOutcome so a hot+humid+hilly run has its single HR-elevation
// PARTITIONED across the three by magnitude·confidence — never triple-counted.
// (Heat and humidity are collinear; separate single-factor ingests would each
// claim the full elevation and inflate both. This is the honest isolation.)
//
// Pure, unit-tested in tests/hubAccumulate.test.js.

// ── Humidity ────────────────────────────────────────────────────────────────
const HUM_REF = 50;   // %RH — humidity cost is measured ABOVE this mild reference
const HUM_MIN = 60;   // only learn from runs more humid than this (below ≈ no load)

// run = { avgHumidity | humidityPct | weatherHumidityPct }. Returns a factor obs
// { factor:'humidity', magnitude, confidence } in units of 10 %RH over ref, or null.
export function humidityFactorFromRun(run = {}, opts = {}) {
  const ref = opts.humRef ?? HUM_REF;
  const min = opts.humMin ?? HUM_MIN;
  const hum = Number(run.avgHumidity ?? run.humidityPct ?? run.weatherHumidityPct);
  if (!Number.isFinite(hum) || hum < min) return null;
  const magnitude = +((hum - ref) / 10).toFixed(3);          // 10 %RH units over ref
  if (!(magnitude > 0)) return null;
  // Confidence scales with how humid it clearly was: 90%RH → ~1.0, 60% → ~0.25.
  return { factor: 'humidity', direction: 'hurt', timescale: 'acute', magnitude,
           confidence: Math.min(1, (hum - ref) / 40) };
}

// ── Elevation ───────────────────────────────────────────────────────────────
const ELEV_MIN_GAIN_PER_MI = 20;   // m/mi — below this is flat/rolling (no real climb load)

// run = { totalAscentM | totalAscent | elevationGain | elevGainM, distanceMi }.
// Magnitude is GRADE (gain per mile), not raw gain, so a long flat run doesn't read
// as "hilly" just for accumulating gentle vertical. Units of 50 m/mi over the flat
// floor. Returns { factor:'elevation', magnitude, confidence } or null.
export function elevationFactorFromRun(run = {}, opts = {}) {
  const minGpm = opts.elevMinGainPerMi ?? ELEV_MIN_GAIN_PER_MI;
  const gainM = Number(run.totalAscentM ?? run.totalAscent ?? run.elevationGain ?? run.elevGainM);
  const miles = Number(run.distanceMi ?? run.distance_mi ?? run.miles);
  if (!Number.isFinite(gainM) || !(gainM > 0) || !(miles > 0)) return null;
  const gainPerMi = gainM / miles;
  if (gainPerMi < minGpm) return null;
  const magnitude = +((gainPerMi - minGpm) / 50).toFixed(3);  // 50 m/mi units over the flat floor
  if (!(magnitude > 0)) return null;
  // Confidence scales with the grade: ~100 m/mi (a genuinely hilly route) → ~1.0.
  return { factor: 'elevation', direction: 'hurt', timescale: 'acute', magnitude,
           confidence: Math.min(1, gainPerMi / 100) };
}
