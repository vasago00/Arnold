// Hub core — BACKFILL. Replays the athlete's historical races through the hub in
// chronological order so the ledgers start populated instead of cold. This is the
// calibration loop run over history: for each checkpoint, PREDICT from the hub's
// fitness so far → ATTRIBUTE the result → RECORD (fitness + response). The first
// checkpoint has no prediction yet (→ seeds fitness); later ones get an
// expectation (→ residuals teach the response model). See docs/HUB_CORE.md.
//
// Dependency-injected for testability: the caller supplies `attributionFn`
// (the app passes a wrapper around core/attribution.js attributeOutcome; tests
// pass a fake). Pure otherwise, unit-tested in tests/hubBackfill.test.mjs.

import { isRun } from '../activityClass.js';
import { createHubState } from './hubState.js';
import { recordRace, predictFromFitness } from './raceFitness.js';

const KM_PER_MI = 1.60934;
const STANDARD_KM = [5, 10, 21.0975, 42.195]; // 5K, 10K, HM, M

const distKm = a => Number(a.distanceKm) || (Number(a.distanceMi || a.distance_mi) * KM_PER_MI) || null;
const secsOf = a => Number(a.actualSecs ?? a.durationSecs) || null;

function weeksBetween(aDate, bDate) {
  const a = new Date(`${aDate}T12:00:00`).getTime();
  const b = new Date(`${bDate}T12:00:00`).getTime();
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, (b - a) / (7 * 86400000));
}

// Select fitness checkpoints from history, mirroring the predictor's empirical
// anchor logic (tileMetrics.findEmpiricalRaceAnchor) — so we pick the SAME kind
// of efforts the app already trusts, not name-tagged "races". A run qualifies if:
//   1. it's an explicitly logged race (isRace flag / type 'race'), OR
//   2. it's at a standard race distance AND a hard effort (avgHR ≥85% max, or
//      pace ≤92% of the median ≥16km long-run pace — "faster than training"), OR
//   3. it's a quality long run (≥10 mi) — Riegel inherits its pace honestly.
// Gated on isRun(), so hybrid/HYROX efforts are excluded (not a running read).
export function defaultSelectCheckpoints(activities) {
  const runs = (activities || [])
    .filter(a => a && a.date && isRun(a) && distKm(a) > 0 && secsOf(a) > 0)
    .map(a => {
      const km = distKm(a);
      return { run: a, km, paceSecPerKm: secsOf(a) / km, distanceMi: Number(a.distanceMi || a.distance_mi) || (km / KM_PER_MI) };
    });

  const longPaces = runs.filter(r => r.km >= 16).map(r => r.paceSecPerKm).sort((x, y) => x - y);
  const medianLongPace = longPaces.length ? longPaces[Math.floor(longPaces.length / 2)] : null;

  return runs.filter(r => {
    const a = r.run;
    const explicitRace = (a.isRace === true || a.type === 'race') && r.km >= 3;
    const stdMatch = STANDARD_KM.some(std => Math.abs(r.km - std) / std <= 0.05);
    const hrHigh = a.maxHR && a.avgHR && (a.avgHR / a.maxHR) >= 0.85;
    const paceFast = medianLongPace && r.paceSecPerKm <= medianLongPace * 0.92;
    const raceEffort = stdMatch && (hrHigh || paceFast);
    const qualityLong = r.distanceMi >= 10;
    return explicitRace || raceEffort || qualityLong;
  }).map(r => r.run);
}

// Replay history → final hub state + a trace of what each checkpoint did.
//   opts.attributionFn(race, { expectedSecs }) → attributeOutcome-shaped result   [required]
//   opts.k, opts.selectCheckpoints, opts.initial (start from an existing state)
export function backfillHub(activities, opts = {}) {
  const k = Number.isFinite(opts.k) ? opts.k : 1.06;
  const select = opts.selectCheckpoints || defaultSelectCheckpoints;
  const attributionFn = opts.attributionFn;
  if (typeof attributionFn !== 'function') throw new Error('backfillHub requires opts.attributionFn');

  let state = opts.initial || createHubState(opts.createOpts);
  const trace = [];

  const checkpoints = select(activities)
    .filter(a => distKm(a) > 0 && secsOf(a) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))); // chronological

  let prevDate = null;
  for (const race of checkpoints) {
    const dk = distKm(race);
    const pred = predictFromFitness(state.fitness, dk, { k });
    const expectedSecs = pred ? pred.secs : null;       // hub's own evolving prediction
    const attribution = attributionFn(race, { expectedSecs });
    const ageWeeks = prevDate ? weeksBetween(prevDate, race.date) : 0;

    const r = recordRace(state, race, attribution, { k, ageWeeks });
    if (r.ingest) {
      state = r.state;
      prevDate = race.date;
      trace.push({
        date: race.date,
        distanceKm: +dk.toFixed(2),
        expectedSecs,
        equivSecs: r.fitnessObs ? r.fitnessObs.equivSecs : null,
        summary: r.ingest.summary,
      });
    }
  }

  return { state, trace, count: checkpoints.length };
}
