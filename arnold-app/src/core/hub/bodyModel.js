// Hub core — BODY + HYDRATION signal routing. Embodies INTELLIGENCE_HUB.md
// principle 1: every data point is valuable, but its MEANING is conditional on
// CONTEXT — so the hub ROUTES each weigh-in to the right ledger. The same scale
// reading is a body-composition fact (fasted morning), a sweat/hydration signal
// (straight off a hot run), or noise (random midday) depending on WHEN it was
// taken and RELATIVE TO WHAT:
//   • fasted-morning → BODY ledger (smoothed weight TREND; one reading barely moves it)
//   • post-activity  → HYDRATION (sweat/fluid loss; NEVER the body trend)
//   • other          → ignored for the trend (too noisy)
// See docs/SIGNAL_LEDGERS.md. Pure logic, unit-tested in tests/hubBody.test.mjs.

import { makeEstimate, updateEstimate, decayPrecision, confidence } from './estimate.js';

const DEFAULT_HALF_LIFE_WEEKS = 3;   // true body mass changes slowly → long memory
const FASTED_BEFORE_HOUR = 10;       // a morning weigh-in
const POST_ACTIVITY_WINDOW_H = 3;    // within 3h of a run end = dehydrated read
const HISTORY_CAP = 60;

// Classify a weigh-in by context. Explicit context wins; else infer from the hour
// of day and proximity to a logged activity.
export function classifyWeighIn(reading = {}) {
  if (reading.context) return reading.context;
  const sinceRun = reading.sinceRunHours;
  if (Number.isFinite(sinceRun) && sinceRun >= 0 && sinceRun <= POST_ACTIVITY_WINDOW_H) return 'post-activity';
  if (Number.isFinite(reading.hour) && reading.hour < FASTED_BEFORE_HOUR) return 'fasted-am';
  return 'other';
}

export function makeBodyModel() {
  return { weight: makeEstimate(0, 0), fasted: [] }; // fasted: [{date, lb}] for deltas + band
}

function weeksBetween(a, b) {
  const da = new Date(`${a}T12:00:00`).getTime(), db = new Date(`${b}T12:00:00`).getTime();
  if (!isFinite(da) || !isFinite(db)) return 0;
  return Math.max(0, (db - da) / (7 * 86400000));
}

// Route one weigh-in. reading = { weightLbs, date, hour?, sinceRunHours?, context? }.
// Returns { model, routed, ... } where routed ∈ body | hydration | other | invalid.
export function recordWeighIn(model, reading, opts = {}) {
  const lb = Number(reading.weightLbs);
  if (!(lb > 0)) return { model, routed: 'invalid', reason: 'no weight' };
  const ctx = classifyWeighIn(reading);
  const halfLifeWeeks = opts.halfLifeWeeks ?? DEFAULT_HALF_LIFE_WEEKS;

  if (ctx === 'fasted-am') {
    const prevFasted = model.fasted[model.fasted.length - 1] || null;
    const ageWeeks = prevFasted ? weeksBetween(prevFasted.date, reading.date) : 0;
    let est = decayPrecision(model.weight, ageWeeks, halfLifeWeeks);
    est = updateEstimate(est, lb, 1.0);                  // clean, full-precision read
    const fasted = [...model.fasted, { date: reading.date, lb }].slice(-HISTORY_CAP);
    const overnight = prevFasted
      ? { fromDate: prevFasted.date, toDate: reading.date, deltaLbs: +(lb - prevFasted.lb).toFixed(2) }
      : null; // a fluid/glycogen signal, NOT body composition
    return { model: { weight: est, fasted }, routed: 'body', context: ctx, trendLbs: +est.value.toFixed(2), overnight };
  }

  if (ctx === 'post-activity') {
    // dehydrated read — never touches the body trend; emit a hydration signal vs
    // today's fasted weight if we have one (net of any rehydration already done).
    const todaysFasted = [...model.fasted].reverse().find(f => f.date === reading.date)
      || model.fasted[model.fasted.length - 1] || null;
    const sweatNetLbs = todaysFasted ? +(todaysFasted.lb - lb).toFixed(2) : null;
    return { model, routed: 'hydration', context: ctx,
      hydration: { type: 'post-activity', weightLbs: lb, sweatNetLbs, vsFastedDate: todaysFasted ? todaysFasted.date : null } };
  }

  return { model, routed: 'other', context: ctx, reason: 'non-fasted, non-post-run — too noisy for the trend' };
}

// The smoothed body-composition trend (the only real "weight").
export function bodyWeight(model, k0 = 2) {
  const e = model.weight;
  if (!e || !(e.precision > 0)) return { value: null, confidence: 0 };
  return { value: +e.value.toFixed(2), confidence: +confidence(e, k0).toFixed(2) };
}

// Personal daily fluctuation from consecutive fasted-morning deltas. Lets the hub
// say "your normal overnight swing is ±X lb" → distinguish noise from a real break.
export function fluctuationBand(model) {
  const f = model.fasted;
  if (f.length < 2) return { meanAbsLbs: null, sdLbs: null, n: 0 };
  const deltas = [];
  for (let i = 1; i < f.length; i++) deltas.push(f[i].lb - f[i - 1].lb);
  const n = deltas.length;
  const meanAbs = deltas.reduce((s, d) => s + Math.abs(d), 0) / n;
  const mean = deltas.reduce((s, d) => s + d, 0) / n;
  const sd = Math.sqrt(deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / n);
  return { meanAbsLbs: +meanAbs.toFixed(2), sdLbs: +sd.toFixed(2), n };
}
