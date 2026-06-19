// Hub core — AMBIENT signal accumulation. Backfill (backfill.js) replays RACE/long
// checkpoints into the fitness + response ledgers. This complements it by sweeping
// EVERY run for the training-only signals that don't need a race:
//   • heatStrain — hot runs with elevated HR → trainingHeat → response.factors.heatStrain
//   • (sweat + body accumulate from weigh-ins via their own live-ingest path, since
//      historical before/after weights generally aren't in activity history.)
// Pure, dependency-injected; unit-tested in tests/hubAccumulate.test.mjs.

import { isRun } from '../activityClass.js';
import { ingestTrainingHeat } from './trainingHeat.js';
import { recordWeighIn } from './bodyModel.js';
import { observeSweat } from './sweatModel.js';

const tempOf = a => {
  const t = Number(a.avgTemperature ?? a.tempC ?? a.weatherTempC);
  return Number.isFinite(t) ? t : null;
};

// The athlete's usual same-discipline avg HR (median across non-race runs) — the
// baseline a hot run's HR is judged against.
export function usualRunHR(activities = []) {
  const hrs = (activities || [])
    .filter(a => a && isRun(a) && Number(a.avgHR) > 0 && !(a.isRace === true || a.type === 'race'))
    .map(a => Number(a.avgHR)).sort((x, y) => x - y);
  if (hrs.length < 3) return null;
  return hrs[Math.floor(hrs.length / 2)];
}

// Sweep all runs → accumulate heatStrain into state.response. Returns a NEW state.
export function accumulateTrainingSignals(state, activities = [], opts = {}) {
  const usualHR = opts.usualHR ?? usualRunHR(activities);
  if (!usualHR) return { state, heatLearned: 0, usualHR: null };

  const runs = (activities || [])
    .filter(a => a && a.date && isRun(a) && Number(a.avgHR) > 0 && tempOf(a) != null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let response = state.response;
  let heatLearned = 0, prevDate = null;
  for (const a of runs) {
    const ageWeeks = prevDate
      ? Math.max(0, (new Date(`${a.date}T12:00:00`) - new Date(`${prevDate}T12:00:00`)) / (7 * 86400000))
      : 0;
    const r = ingestTrainingHeat(response, { tempC: tempOf(a), avgHR: Number(a.avgHR) }, { usualHR }, { ...opts, ageWeeks });
    response = r.model;
    if (r.learned) { heatLearned += 1; prevDate = a.date; }
  }
  return { state: { ...state, response }, heatLearned, usualHR };
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
    .map(w => ({ date: w.date, time: w.time || null, lb: Number(w.weightLbs ?? w.lbs ?? w.value) }))
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
        fluidInL: Number(opts.fluidInL) || 0,
        date: e.date,
      });
      sweat = so.model;
      if (so.observed) sweatLearned += 1;
    }
  }
  return { state: { ...state, body, sweat }, bodyLearned, sweatLearned };
}
