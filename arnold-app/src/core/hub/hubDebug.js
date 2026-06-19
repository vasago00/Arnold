// Hub core — browser glue + console entry points. Boots the Intelligence Hub from
// the athlete's real stored activities and prints/persists the resulting state.
//   window.hubDebug()   — backfill (read-only) + print predictions + response facts
//   window.hubEnsure()  — load-or-backfill the hub and SAVE it to storage
//   window.hubDebug({ k: 1.12 }) — force a CONSTANT exponent (overrides distance-aware)
//   window.predictorCompare() — leave-one-out: hub vs best-anchor vs your real races
// Also auto-persists once shortly after boot (Step 2 boot-hook).
//
// Wiring only — no rendering. Testable logic lives in backfill.js / hubFacts.js /
// hubBoot.js / raceFitness.js (all node-tested). See docs/HUB_CORE.md + HUB_GO_LIVE.md.

import { storage } from '../storage.js';
import { attributeOutcome } from '../attribution.js';
import { fatigueExponent, predictFinishSecs } from '../derive/tileMetrics.js';
import { isRun } from '../activityClass.js';
import { backfillHub, defaultSelectCheckpoints, racedDistancesKm } from './backfill.js';
import { accumulateTrainingSignals, accumulateBodyAndSweat } from './accumulate.js';
import { predictFromFitness } from './raceFitness.js';
import { ensureHub } from './hubBoot.js';
import { hubFacts } from './hubFacts.js';

// Representative personal endurance exponent (10K->Marathon span), for display.
export function personalK(activities) {
  return buildKFor(activities)(10, 42.195);
}

// DISTANCE-AWARE exponent: for any two distances, the personal fatigue exponent of
// THAT span (gentle for 10<->HM, steep for 10<->M), via the app's fatigueExponent
// fit. Symmetric and clamped to a plausible band.
export function buildKFor(activities) {
  return (fromKm, toKm) => {
    const a = Math.min(fromKm, toKm), b = Math.max(fromKm, toKm);
    try {
      const fit = fatigueExponent(activities || [], { anchorKm: a, targetKm: b });
      const k = fit && Number.isFinite(fit.k) ? fit.k : 1.06;
      return Math.min(1.30, Math.max(1.0, k));
    } catch {
      return 1.06;
    }
  };
}

function attribFn() {
  return (race, { expectedSecs }) => attributeOutcome({ activity: race, expectedSecs, isRaceEffort: true });
}

function exponentOpts(activities, opts) {
  if (Number.isFinite(opts.k)) return { k: opts.k, kFor: null, displayK: opts.k };
  const kFor = buildKFor(activities);
  return { k: undefined, kFor, displayK: kFor(10, 42.195) };
}

// Read-only: backfill a fresh hub from stored history (does not persist).
export function buildHubFromStorage(opts = {}) {
  const activities = storage.get('activities') || [];
  const { k, kFor, displayK } = exponentOpts(activities, opts);
  const result = backfillHub(activities, { ...opts, attributionFn: attribFn(), k, kFor });
  const acc = accumulateTrainingSignals(result.state, activities, opts); // sweep runs for heatStrain
  const weightLog = storage.get('weight') || [];
  const acc2 = accumulateBodyAndSweat(acc.state, activities, weightLog, opts); // body trend + sweat rate
  const racedKms = racedDistancesKm(activities); // for extrapolation conservatism
  return { ...result, state: acc2.state, k: displayK, facts: hubFacts(acc2.state, { k, kFor, racedKms }), heatLearned: acc.heatLearned, sweatLearned: acc2.sweatLearned };
}

// PERSISTING boot: load the hub from storage, or backfill+save it if absent.
export function ensureHubFromStorage(opts = {}) {
  const activities = storage.get('activities') || [];
  const { k, kFor, displayK } = exponentOpts(activities, opts);
  const { state, source } = ensureHub(storage, { ...opts, activities, weightLog: storage.get('weight') || [], attributionFn: attribFn(), k, kFor });
  return { state, source, k: displayK, facts: hubFacts(state, { k, kFor, racedKms: racedDistancesKm(activities) }) };
}

if (typeof window !== 'undefined') {
  window.hubDebug = (opts = {}) => {
    const { state, trace, count, k, facts } = buildHubFromStorage(opts);
    console.log(`[hub] backfilled ${count} checkpoint(s) from history · k(10->M)=${k.toFixed(3)} (distance-aware)`);
    if (facts.refEquivSecs) {
      console.log(`[hub] fitness: 10K-equiv ${facts.refEquivSecs}s (confidence ${facts.fitnessConfidence}) ->`,
        facts.predictions.map(p => `${p.dist} ${p.time}`).join('  '));
    } else {
      console.log('[hub] fitness not seeded yet - no qualifying race in history');
    }
    const races = trace.filter(t => t.tier === 'race').length;
    console.log(`[hub] checkpoints: ${races} race-effort, ${count - races} long-run (race efforts drive fitness)`);
    if (facts.responses.length) {
      console.log('[hub] response sensitivities (how conditions cost YOU):');
      facts.responses.forEach(r => console.log('   -', r.text));
    } else {
      console.log('[hub] response model empty - no confounded underperformances to learn from yet');
    }
    return { state, trace, facts, k };
  };

  window.hubEnsure = (opts = {}) => {
    const res = ensureHubFromStorage(opts);
    console.log(`[hub] ${res.source} · k(10->M)=${res.k.toFixed(3)} · saved to storage` +
      (res.facts.refEquivSecs ? ` · 10K-equiv ${res.facts.refEquivSecs}s` : ' · not seeded'));
    return res;
  };

  // window.predictorCompare() — LEAVE-ONE-OUT accuracy check: for each real race-effort
  // in history, predict its distance from the OTHER activities (so a race can't predict
  // itself) with BOTH methods, and compare to the actual time. Mean abs % error tells
  // which method has been more accurate for you (hub blend vs best-anchor).
  window.predictorCompare = () => {
    const KM_PER_MI = 1.60934;
    const dkm = a => Number(a.distanceKm) || (Number(a.distanceMi || a.distance_mi) * KM_PER_MI) || 0;
    const ssec = a => Number(a.actualSecs ?? a.durationSecs) || 0;
    const fmt = s => { if (!(s > 0)) return '—'; s = Math.round(s); const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), x = s%60; return h ? `${h}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}` : `${m}:${String(x).padStart(2,'0')}`; };
    const all = storage.get('activities') || [];
    // Use the SAME race-effort detection the hub uses (standard distance + hard, or an
    // explicit race) — your races aren't isRace-flagged, they're detected efforts.
    const races = defaultSelectCheckpoints(all)
      .filter(c => c.tier === 'race' && c.run && dkm(c.run) >= 3 && ssec(c.run) > 0)
      .map(c => c.run)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (!races.length) { console.log('[compare] no race-effort checkpoints found. Run window.racePredictorDebug() to see your anchor.'); return; }
    const hubErr = [], anchErr = [];
    console.log('[compare] leave-one-out — race | actual | HUB (err) | BEST-ANCHOR (err)');
    for (const r of races) {
      const others = all.filter(a => a !== r);
      const distKm = dkm(r), actual = ssec(r);
      const { k, kFor } = exponentOpts(others, {});
      let hp = null, ap = null;
      try { const { state } = backfillHub(others, { attributionFn: attribFn(), k, kFor }); const h = predictFromFitness(state.fitness, distKm, { k, kFor }); hp = h ? h.secs : null; } catch {}
      try { const a = predictFinishSecs(distKm, others); ap = a ? a.seconds : null; } catch {}
      const he = hp ? ((hp - actual) / actual * 100) : null;
      const ae = ap ? ((ap - actual) / actual * 100) : null;
      if (he != null) hubErr.push(Math.abs(he));
      if (ae != null) anchErr.push(Math.abs(ae));
      console.log(`  ${distKm.toFixed(1)}km ${r.date}: ${fmt(actual)} | ${fmt(hp)} (${he==null?'—':(he>0?'+':'')+he.toFixed(1)+'%'}) | ${fmt(ap)} (${ae==null?'—':(ae>0?'+':'')+ae.toFixed(1)+'%'})`);
    }
    const mean = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length) : null;
    const hm = mean(hubErr), am = mean(anchErr);
    console.log(`[compare] MEAN ABS ERROR → hub ${hm==null?'—':hm.toFixed(1)+'%'} · best-anchor ${am==null?'—':am.toFixed(1)+'%'}  (lower = more accurate)`);
    return { races: races.length, hubMeanAbsErrPct: hm, anchorMeanAbsErrPct: am };
  };

  // Boot-hook (Step 2): persist the hub once shortly after startup, after the app
  // has loaded activities into storage. Guarded + silent on failure.
  setTimeout(() => { try { ensureHubFromStorage(); } catch (e) { /* boot-ensure skipped */ } }, 5000);
}
