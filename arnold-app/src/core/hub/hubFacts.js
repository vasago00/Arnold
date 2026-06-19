// Hub core — render the hub's state as human-readable coaching FACTS: the
// response-model sensitivities ("for you, heat ~ 0.4%/°C") and the fitness
// model's race-equivalent predictions. Pure (no storage/DOM), so it's node-
// testable; the browser glue lives in hubDebug.js. See docs/HUB_CORE.md.

import { predictFromFitness, RACE_FITNESS_PARAM } from './raceFitness.js';
import { sensitivityOf } from './responseModel.js';
import { predictSweatRate } from './sweatModel.js';
import { confidence } from './estimate.js';

const STD = [
  { label: '5K', km: 5 },
  { label: '10K', km: 10 },
  { label: 'HM', km: 21.0975 },
  { label: 'M', km: 42.195 },
];

// Friendly per-factor phrasing of which confounders this athlete is sensitive to.
const FACTOR_UNIT = {
  heat: '%/°C', heatStrain: '%/°C', sleep: '%/h', sleepAcute: '%/h', sleepChronic: '%/h',
  fuel: '%', hrv: '%', rhr: '%', load: '%',
};

export function fmtTime(secs) {
  if (!(secs > 0)) return '—';
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`;
}

export function hubFacts(state, opts = {}) {
  const k = Number.isFinite(opts.k) ? opts.k : 1.06;
  const kFor = typeof opts.kFor === 'function' ? opts.kFor : null; // distance-aware exponent

  const responses = Object.keys((state.response && state.response.factors) || {})
    .map(f => {
      const s = sensitivityOf(state.response, f);
      return {
        factor: f,
        perUnitPct: +((s.value || 0) * 100).toFixed(2),
        unit: FACTOR_UNIT[f] || '%/unit',
        confidence: +(s.confidence || 0).toFixed(2),
        text: `${f} ≈ ${((s.value || 0) * 100).toFixed(2)}${FACTOR_UNIT[f] || '%/unit'} (confidence ${Math.round((s.confidence || 0) * 100)}%)`,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const seeded = state.fitness && state.fitness.params && state.fitness.params[RACE_FITNESS_PARAM];
  const predictions = seeded
    ? STD.map(d => {
        const p = predictFromFitness(state.fitness, d.km, { k, kFor, racedKms: opts.racedKms });
        return { dist: d.label, secs: p ? p.secs : null, time: fmtTime(p && p.secs) };
      })
    : [];

  // Personal sweat rate (null/n:0 until before/after-run weigh-ins exist).
  const sweat = state.sweat
    ? (() => { const p = predictSweatRate(state.sweat, opts.tempC ?? 20); return p && p.n ? p : null; })()
    : null;

  return {
    refEquivSecs: seeded ? Math.round(seeded.value) : null,
    fitnessConfidence: seeded ? +confidence(seeded).toFixed(2) : 0,
    predictions,
    responses,
    sweat,
  };
}
