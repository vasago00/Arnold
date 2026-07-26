// Hub core — HEAT FROM TRAINING RUNS. The response ledger normally only learns
// from races (a race-time residual to attribute). But you run in the heat far more
// often than you race in it, and every hot easy run carries a heat signal: at the
// SAME easy effort, heat pushes your HR UP relative to your usual run. That HR
// elevation, regressed against temperature over many runs, is a real personal
// sensitivity — "heat raises my aerobic strain ~X%/°C" — learned without ever racing.
//
// WHY A SEPARATE FACTOR ('heatStrain', not 'heat'):
// The race 'heat' factor is in race-TIME units (% slower per °C). A training run's
// signal is HR-elevation units (% higher HR per °C) — a related but DIFFERENT
// quantity. Feeding HR elevation into the race-time factor would corrupt it, so we
// accumulate it as its own factor and surface it as its own coaching fact. Both
// ride the same precision-weighted, decaying response model. See docs/SIGNAL_LEDGERS.md.
//
// Pure, unit-tested in tests/hubTrainingHeat.test.mjs.

import { observeOutcome, sensitivityOf } from './responseModel.js';

const REF_TEMP_C = 20;        // heat cost is measured ABOVE this mild reference
const MIN_HOT_C = 22;         // only learn from runs warmer than this (below ≈ no heat load)
const HALF_LIFE_WEEKS = 26;   // sensitivity slowly forgets (acclimation/fitness shift)

// Turn one training run into a response observation, or null when it can't teach us
// about heat. run = { tempC, avgHR, isRun?, effort? }. baseline = { usualHR } (the
// athlete's usual same-type easy-run avg HR). opts.refTempC / opts.minHotC override.
export function heatObservationFromRun(run = {}, baseline = {}, opts = {}) {
  const refTempC = opts.refTempC ?? REF_TEMP_C;
  const minHotC = opts.minHotC ?? MIN_HOT_C;
  const tempC = Number(run.tempC);
  const avgHR = Number(run.avgHR);
  const usualHR = Number(baseline.usualHR);

  if (!Number.isFinite(tempC) || tempC < minHotC) return null;   // not a hot run → no heat load
  if (!(avgHR > 0) || !(usualHR > 0)) return null;               // need HR + a usual baseline
  const magnitude = +(tempC - refTempC).toFixed(2);              // °C over reference
  if (!(magnitude > 0)) return null;

  const divergence = (avgHR - usualHR) / usualHR;                // fractional HR elevation vs usual
  if (!(divergence > 0)) return null;                            // HR not elevated → no heat-cost signal

  // Confidence scales with how clearly hot it was: 30°C (≈10 over ref) → ~full,
  // a borderline-warm 22°C → low. Capped at 1.
  const confidence = Math.min(1, magnitude / 10);

  return {
    divergence: +divergence.toFixed(4),
    factors: [{ factor: 'heatStrain', direction: 'hot', timescale: 'acute', magnitude, confidence }],
  };
}

// Fold a training run's heat signal into the response model (returns a NEW model).
// Same observeOutcome machinery as races — just a different factor + source.
export function ingestTrainingHeat(responseModel, run, baseline, opts = {}) {
  const obs = heatObservationFromRun(run, baseline, opts);
  if (!obs) return { model: responseModel, learned: false };
  const model = observeOutcome(responseModel, obs.divergence, obs.factors, {
    halfLifeWeeks: opts.halfLifeWeeks ?? HALF_LIFE_WEEKS,
    ageWeeks: opts.ageWeeks ?? 0,
  });
  return { model, learned: true, divergence: obs.divergence, magnitude: obs.factors[0].magnitude };
}

// Replay a batch of hot runs (chronological) into the response model, decaying the
// prior between runs. runs: [{ tempC, avgHR, date }]. baseline: { usualHR }.
export function ingestTrainingHeatBatch(responseModel, runs = [], baseline = {}, opts = {}) {
  let model = responseModel;
  let learned = 0, prevDate = null;
  const sorted = [...runs].filter(Boolean).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const run of sorted) {
    const ageWeeks = prevDate && run.date ? Math.max(0,
      (new Date(`${run.date}T12:00:00`) - new Date(`${prevDate}T12:00:00`)) / (7 * 86400000)) : 0;
    const r = ingestTrainingHeat(model, run, baseline, { ...opts, ageWeeks });
    model = r.model;
    if (r.learned) { learned += 1; prevDate = run.date || prevDate; }
  }
  return { model, learned };
}

// Predict the heat-strain cost (fractional HR elevation) at a temperature, from the
// learned sensitivity. Returns { strainPct, perDegC, confidence }.
export function predictHeatStrain(responseModel, tempC, opts = {}) {
  const refTempC = opts.refTempC ?? REF_TEMP_C;
  const s = sensitivityOf(responseModel, 'heatStrain');
  if (s.value == null) return { strainPct: null, perDegC: 0, confidence: 0 };
  const mag = Math.max(0, (Number(tempC) || refTempC) - refTempC);
  return {
    strainPct: +(s.value * mag * 100).toFixed(1),
    perDegC: +(s.value * 100).toFixed(2),
    confidence: +s.confidence.toFixed(2),
  };
}
