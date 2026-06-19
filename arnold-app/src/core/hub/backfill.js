// Hub core — BACKFILL. Replays the athlete's historical races through the hub in
// chronological order so the ledgers start populated instead of cold. This is the
// calibration loop run over history: for each checkpoint, PREDICT from the hub's
// fitness so far → ATTRIBUTE the result → RECORD (fitness + response). The first
// checkpoint has no prediction yet (→ seeds fitness); later ones get an
// expectation (→ residuals teach the response model). See docs/HUB_CORE.md +
// docs/HUB_GO_LIVE.md (Step 1: best-anchor calibration).
//
// Dependency-injected for testability: the caller supplies `attributionFn`
// (the app passes a wrapper around core/attribution.js attributeOutcome; tests
// pass a fake). Pure otherwise, unit-tested in tests/hubBackfill.test.mjs.

import { isRun } from '../activityClass.js';
import { createHubState, recordCheckpoint } from './hubState.js';
import { observationsFromRace, predictFromFitness } from './raceFitness.js';

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

// Select fitness checkpoints from history AND tier them, mirroring the predictor's
// empirical anchor logic (tileMetrics.findEmpiricalRaceAnchor):
//   tier 'race' — a real race effort: an explicitly logged race, OR a
//     standard-distance run that was HARD (avgHR >=85% max, or pace <=92% of the
//     median >=16km long-run pace = "faster than training").
//   tier 'long' — a quality long run (>=10mi) run at training pace.
// Gated on isRun(), so hybrid/HYROX efforts are excluded (not a running read).
// Returns [{ run, tier }].
export function defaultSelectCheckpoints(activities) {
  const runs = (activities || [])
    .filter(a => a && a.date && isRun(a) && distKm(a) > 0 && secsOf(a) > 0)
    .map(a => {
      const km = distKm(a);
      return { run: a, km, paceSecPerKm: secsOf(a) / km, distanceMi: Number(a.distanceMi || a.distance_mi) || (km / KM_PER_MI) };
    });

  const longPaces = runs.filter(r => r.km >= 16).map(r => r.paceSecPerKm).sort((x, y) => x - y);
  const medianLongPace = longPaces.length ? longPaces[Math.floor(longPaces.length / 2)] : null;

  const out = [];
  for (const r of runs) {
    const a = r.run;
    const explicitRace = (a.isRace === true || a.type === 'race') && r.km >= 3;
    const stdMatch = STANDARD_KM.some(std => Math.abs(r.km - std) / std <= 0.05);
    const hrHigh = a.maxHR && a.avgHR && (a.avgHR / a.maxHR) >= 0.85;
    const paceFast = medianLongPace && r.paceSecPerKm <= medianLongPace * 0.92;
    const raceEffort = stdMatch && (hrHigh || paceFast);
    const qualityLong = r.distanceMi >= 10;
    if (explicitRace || raceEffort) out.push({ run: a, tier: 'race' });
    else if (qualityLong) out.push({ run: a, tier: 'long' });
  }
  return out;
}

// The distances (km) the athlete has actually RACED (race-effort checkpoints) — the
// validated anchors a prediction is "sharp" at. Feeds predictFromFitness's
// extrapolation conservatism so far-from-raced targets lean more cautious.
export function racedDistancesKm(activities) {
  return defaultSelectCheckpoints(activities)
    .filter(c => c && c.tier === 'race' && c.run)
    .map(c => distKm(c.run))
    .filter(d => d > 0);
}

// Replay history → final hub state + a trace of what each checkpoint did.
//   opts.attributionFn(race, { expectedSecs }) → attributeOutcome-shaped result   [required]
//   opts.k, opts.kFor, opts.selectCheckpoints, opts.initial
//
// CALIBRATION (Step 1): the fitness ledger prefers RACE EFFORTS. If any race-effort
// checkpoints exist, ONLY they update fitness (each as a full-precision 'hard' read),
// matching the predictor's best-anchor behavior. Quality long runs update fitness
// only as a FALLBACK when no race effort exists. The RESPONSE ledger learns from any
// confounded underperformance regardless of tier. opts.kFor(from,to) gives the
// distance-aware exponent for folding/predicting; opts.k is the constant fallback.
export function backfillHub(activities, opts = {}) {
  const k = Number.isFinite(opts.k) ? opts.k : 1.06;
  const kFor = typeof opts.kFor === 'function' ? opts.kFor : null;
  const select = opts.selectCheckpoints || defaultSelectCheckpoints;
  const attributionFn = opts.attributionFn;
  if (typeof attributionFn !== 'function') throw new Error('backfillHub requires opts.attributionFn');

  let state = opts.initial || createHubState(opts.createOpts);
  const trace = [];

  const checkpoints = select(activities)
    .filter(c => c && c.run && distKm(c.run) > 0 && secsOf(c.run) > 0)
    .sort((a, b) => String(a.run.date).localeCompare(String(b.run.date))); // chronological

  const hasRaceEffort = checkpoints.some(c => c.tier === 'race');

  let prevDate = null;
  for (const { run: race, tier } of checkpoints) {
    const dk = distKm(race);
    const pred = predictFromFitness(state.fitness, dk, { k, kFor });
    const expectedSecs = pred ? pred.secs : null;       // hub's own evolving prediction

    let attribution = attributionFn(race, { expectedSecs });
    if (tier === 'race' && attribution && attribution.effort == null) {
      attribution = { ...attribution, effort: 'hard' };
    }

    const fitnessEligible = tier === 'race' || !hasRaceEffort;
    const obs = fitnessEligible ? observationsFromRace(race, { k, kFor }) : null;

    const ageWeeks = prevDate ? weeksBetween(prevDate, race.date) : 0;
    const { state: nextState, ingest } = recordCheckpoint(state, attribution, {
      k, ageWeeks,
      paramObservations: obs ? obs.paramObservations : [],
    });
    state = nextState;
    prevDate = race.date;
    trace.push({
      date: race.date,
      tier,
      distanceKm: +dk.toFixed(2),
      expectedSecs,
      equivSecs: obs ? obs.meta.equivSecs : null,
      fitnessEligible,
      summary: ingest.summary,
    });
  }

  return { state, trace, count: checkpoints.length };
}
