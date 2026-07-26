// Hub core — AMBIENT signal accumulation. Backfill (backfill.js) replays RACE/long
// checkpoints into the fitness + response ledgers. This complements it by sweeping
// EVERY run for the training-only signals that don't need a race:
//   • heatStrain — hot runs with elevated HR → response.factors.heatStrain
//   • humidity   — humid runs with elevated HR → response.factors.humidity
//   • elevation  — hilly runs with elevated HR → response.factors.elevation
//   • (sweat + body accumulate from weigh-ins via their own live-ingest path, since
//      historical before/after weights generally aren't in activity history.)
// Pure, dependency-injected; unit-tested in tests/hubAccumulate.test.js.

import { isRun } from '../activityClass.js';
import { learnDriftSensitivities } from './hrDriftModel.js';
import { makeEstimate } from './estimate.js';
import { recordWeighIn } from './bodyModel.js';
import { observeSweat } from './sweatModel.js';

// The athlete's usual same-discipline avg HR (median across non-race runs) — the
// baseline a hot/humid/hilly run's HR is judged against.
export function usualRunHR(activities = []) {
  const hrs = (activities || [])
    .filter(a => a && isRun(a) && Number(a.avgHR) > 0 && !(a.isRace === true || a.type === 'race'))
    .map(a => Number(a.avgHR)).sort((x, y) => x - y);
  if (hrs.length < 3) return null;
  return hrs[Math.floor(hrs.length / 2)];
}

// Sweep all runs → learn the environmental HR-drift sensitivities (heatStrain,
// humidity, elevation) by MULTIVARIATE REGRESSION of each run's HR-drift-vs-usual on
// temperature, humidity and grade TOGETHER (hrDriftModel). Fitting the three jointly
// is what separates correlated heat & humidity when the data supports it (dry-hot AND
// humid-hot days) and honestly collapses their confidence when it doesn't — a truth a
// proportional split can't tell. Each identified sensitivity is written as an Estimate
// carrying the regression's value + confidence, so hubFacts/sensitivityOf/LearnedHero
// consume them completely unchanged. Returns a NEW state.
export function accumulateTrainingSignals(state, activities = [], opts = {}) {
  const usualHR = opts.usualHR ?? usualRunHR(activities);
  if (!usualHR) return { state, heatLearned: 0, humidityLearned: 0, elevationLearned: 0, usualHR: null };

  const runs = (activities || []).filter(a => a && a.date && isRun(a) && Number(a.avgHR) > 0);
  const learned = learnDriftSensitivities(runs, usualHR, opts);

  // Regression sensitivity → Estimate whose confidence() reproduces the regression's:
  // confidence = precision/(precision+1) ⇒ precision = c/(1−c). Value carries straight
  // through. A factor the regression couldn't identify (dropped column / non-positive
  // effect) yields null and simply isn't written — no fabricated number.
  const asEstimate = (s) => {
    if (!s || !(s.value > 0)) return null;
    const c = Math.max(0, Math.min(0.98, s.confidence || 0));
    return makeEstimate(s.value, c < 1 ? c / (1 - c) : 1e6);
  };

  const factors = { ...(state.response && state.response.factors) };
  const heat = asEstimate(learned.factors.heatStrain);
  const hum  = asEstimate(learned.factors.humidity);
  const elev = asEstimate(learned.factors.elevation);
  if (heat) factors.heatStrain = heat;
  if (hum)  factors.humidity   = hum;
  if (elev) factors.elevation  = elev;

  return {
    state: { ...state, response: { ...state.response, factors } },
    heatLearned: heat ? 1 : 0, humidityLearned: hum ? 1 : 0, elevationLearned: elev ? 1 : 0,
    usualHR, driftR2: learned.r2, driftN: learned.n,
  };
}

const hourOf = t => { const m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1] + (+m[2]) / 60) : null; };

// Replay the weight log into the BODY + SWEAT ledgers. Each weigh-in routes through
// bodyModel: a fasted-morning read updates the smoothed body trend; a daytime read
// on a run day is a POST-RUN read → its drop vs that morning (sweatNetLbs) + the
// run's temp/duration becomes a sweat-rate observation. So logging a post-run weight
// is what fills the personal sweat model. fluidInL defaults 0 (gross sweat is then a
// floor — pass opts.fluidInL when known). Pure; unit-tested in tests/hubAccumulate.
export function accumulateBodyAndSweat(state, activities = [], weightLog = [], opts = {}) {
  const entries = (weightLog || [])
    .filter(w => w && w.date && Number.isFinite(Number(w.weightLbs ?? w.lbs ?? w.value)))
    .map(w => ({ date: w.date, time: w.time || null, lb: Number(w.weightLbs ?? w.lbs ?? w.value), fluidInL: Number(w.fluidInL) }))
    .sort((a, b) => a.date === b.date ? String(a.time || '').localeCompare(String(b.time || '')) : a.date.localeCompare(b.date));

  let body = state.body, sweat = state.sweat;
  let bodyLearned = 0, sweatLearned = 0;
  for (const e of entries) {
    const run = (activities || [])
      .filter(a => a && a.date === e.date && Number(a.durationSecs) > 0)
      .sort((a, b) => Number(b.durationSecs) - Number(a.durationSecs))[0] || null;
    const hour = hourOf(e.time);
    // Daytime weigh-in on a run day → treat as post-run (a sweat read); otherwise the
    // body model infers fasted-am (hour<10) vs ignored noise.
    const context = (run && hour != null && hour >= 10) ? 'post-activity' : undefined;
    const r = recordWeighIn(body, { weightLbs: e.lb, date: e.date, hour, context }, opts);
    body = r.model;
    if (r.routed === 'body') bodyLearned += 1;
    if (r.routed === 'hydration' && r.hydration && Number.isFinite(r.hydration.sweatNetLbs) && run) {
      const so = observeSweat(sweat, {
        tempC: Number(run.avgTemperature ?? run.tempC ?? run.weatherTempC),
        durationHr: Number(run.durationSecs) / 3600,
        sweatNetLbs: r.hydration.sweatNetLbs,
        // Prefer the fluid logged ON this weigh-in (gross sweat); fall back to a global
        // opt, then 0 (floor). This is what makes a logged "L drunk" sharpen the model.
        fluidInL: Number.isFinite(e.fluidInL) ? e.fluidInL : (Number(opts.fluidInL) || 0),
        date: e.date,
      });
      sweat = so.model;
      if (so.observed) sweatLearned += 1;
    }
  }
  return { state: { ...state, body, sweat }, bodyLearned, sweatLearned };
}
