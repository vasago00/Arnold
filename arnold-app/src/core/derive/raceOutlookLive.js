// core/derive/raceOutlookLive.js — the ONE live read the UI consumes. Ties the whole decision spine together
// from storage so every surface (training profile, mobile planning profile, the Valencia moons, the plan card)
// shows the SAME numbers instead of each re-deriving its own:
//
//   fitness state (ability)  →  potential gap (ceiling + headroom)  →  promotion loop (push–pull)  →  race
//   outlook (dual-track predictions per race, bent by the promotion verdict).
//
// Impurity (storage reads) is isolated here; every computation underneath is a pure, tested module. Pass a
// `store` to unit-test or preview offline; it defaults to the app storage. Nothing is fabricated — a missing
// input just drops out of the read.

import { storage as appStorage } from '../storage.js';
import { estimateFitnessState, easyEfficiencyRate } from './fitnessState.js';
import { raceOutlook } from './raceOutlook.js';
import { computePotentialGap, readMeasuredVo2 } from './potentialGap.js';
import { getPromotionState } from '../hub/promotionLoop.js';
import { resolveARace } from '../aRace.js';   // THE one A-race definition — shared with goalResolve/raceRecipe/the plan
import { computeAcuteChronicRatio } from '../trainingStress.js';
import { localDate, fmtFinish } from '../time.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const DAY = 86400000;

function detectHrMax(goals, activities) {
  const g = num(goals?.maxHR);
  if (g > 0) return g;
  return (activities || []).reduce((m, a) => { const h = num(a?.maxHR); return h && h > m ? h : m; }, 0) || undefined;
}

// Recent-load delivery ratio: last 2 wk mi/wk vs the prior 4 wk mi/wk (>1 = over-delivering).
function deliveryRatio(activities, todayStr) {
  const now = new Date(todayStr + 'T12:00:00').getTime();
  const mi = (loDays, hiDays) => (activities || [])
    .filter((a) => a && a.isRun && a.date)
    .filter((a) => { const d = new Date(a.date + 'T12:00:00').getTime(); const age = (now - d) / DAY; return age >= loDays && age < hiDays; })
    .reduce((s, a) => s + (num(a.distanceMi) || 0), 0);
  const last2 = mi(0, 14) / 2, prior4 = mi(14, 42) / 4;
  return prior4 > 0 ? last2 / prior4 : null;
}

/**
 * getRaceOutlook({ today, store }) → {
 *   state,                 // fitness state (ability) or null
 *   potential,             // computePotentialGap result (ceiling + lever) or null
 *   promotion,             // getPromotionState verdict + inputs
 *   outlook,               // raceOutlook[] — dual-track per race
 *   aRace, hrMax, asOf
 * } | null when there's no fitness state (no fabrication).
 */
export function getRaceOutlook({ today = localDate(), store = appStorage } = {}) {
  const get = (k, d) => { try { const v = store.get(k); return v == null ? d : v; } catch { return d; } };
  const activities = get('activities', []);
  // TWO uses of the race list, deliberately separate:
  //   • allRaces — PAST + future — feeds the fitness anchor (a completed race's DATE is what lets a controlled
  //     effort count as level evidence). Filtering these out starves the anchor.
  //   • upcomingRaces — the forward-looking OUTLOOK (a race already run is a result, not a prediction).
  const allRaces = (get('races', []) || []).filter((r) => r && r.date);
  const races = allRaces.filter((r) => String(r.date).slice(0, 10) >= today);
  const careerRaces = get('careerRaces', []) || [];
  const goals = get('goals', {}) || {};
  const clinicalTests = get('clinicalTests', []) || [];
  const profile = get('profile', {}) || {};
  const injury = get('injury', null);

  const hrMax = detectHrMax(goals, activities);
  const state = (() => { try { return estimateFitnessState(activities, { today, hrMax, races: allRaces }); } catch { return null; } })();
  if (!state || !(num(state.vdot) > 0)) return null;

  // Potential ceiling — measured VO2max vs race-VDOT (the marathon is the reference distance for headroom).
  const measured = (() => { try { return readMeasuredVo2({ storage: store, activities, clinicalTests, profile }); } catch { return null; } })();
  const potential = (() => {
    try {
      return measured && measured.value > 0
        ? computePotentialGap({ measuredVo2: measured.value, source: measured.source, vo2Date: measured.date, raceVdot: state.vdot, distanceKm: 42.195, today })
        : null;
    } catch { return null; }
  })();

  // Promotion loop signals.
  const acwr = (() => {
    try { const r = computeAcuteChronicRatio(activities, today, goals.functionalThresholdPace || '8:30', hrMax); return r && r.ratio != null ? r.ratio : null; }
    catch { return null; }
  })();
  const eff = (() => { try { return easyEfficiencyRate(activities, { today }); } catch { return null; } })();
  const efficiencyTrend = eff != null ? Math.max(-1, Math.min(1, eff * 300)) : null;   // + = getting more efficient
  const promotion = getPromotionState({
    acwr,
    deliveryRatio: deliveryRatio(activities, today),
    efficiencyTrend,
    injuryActive: !!injury,
    headroomVdot: potential ? potential.gapVdot : null,
  });

  const outlook = raceOutlook({
    state, races, today, activities, hrMax, careerRaces,
    promotionAdjust: promotion.trajectoryAdjust,
  }) || [];

  // The A-race comes from core/aRace.js — the app's ONE definition of "the race the plan is built toward".
  // This file used to inline its OWN picker (priority-first, season-horizon-aware). That was a PARALLEL
  // SYSTEM: on Emil's calendar — where the race editor defaults every race to priority 'A' — it could name a
  // different race than goalResolve/raceRecipe/the plan, so the outlook and the plan disagreed about what the
  // season was for. resolveARace is order-independent and puts `priority` LAST precisely because it's
  // unreliable; the race you set a GOAL TIME on is the race you're training for. One resolver, one answer.
  const aRace = resolveARace(races, today, goals.aRaceDate || null);

  // The UNIFIED LADDER for the A-race — the one axis every surface renders: CURRENT → TARGET → STRETCH → CEILING,
  // with GOAL a marker on it. `coincide` is Emil's point made mechanical: true when the goal is reachable this
  // cycle (on-target), so the training profile and the season goal are literally the same number.
  const aEntry = aRace ? (outlook.find((o) => o.name === aRace.name) || null) : null;
  const ladder = aEntry ? {
    current: aEntry.currentSecs,
    target: aEntry.targetSecs,
    stretch: aEntry.stretchSecs,
    ceiling: potential ? potential.ceilingSecs : null,
    goal: aEntry.goalSecs,
    goalPlacement: aEntry.verdict,                 // 'on-target' | 'stretch' | 'beyond-cycle' | 'no-goal'
    coincide: aEntry.verdict === 'on-target',      // Goal === Target (reachable this cycle)
    lever: potential ? potential.lever : null,
  } : null;

  return { state, potential, promotion, outlook, ladder, aRace: aRace ? aRace.name : null, hrMax: hrMax || null, asOf: state.asOf || today };
}

// Live inspector.
if (typeof window !== 'undefined') {
  window.raceOutlookDebug = function (opts) {
    const r = getRaceOutlook(opts || {});
    if (!r) { console.log('raceOutlook: no fitness state (need recent race/quality evidence)'); return null; }
    const fmt = (s) => (s ? fmtFinish(s) : '—');   // same formatter the UI uses, so the console can't disagree with the screen
    console.log('=== RACE OUTLOOK (live) ===');
    console.log('CURRENT VDOT', r.state.vdot, '| A-race', r.aRace, '| asOf', r.asOf);
    if (r.ladder) console.log('LADDER →  current', fmt(r.ladder.current), '· target', fmt(r.ladder.target), '· stretch', fmt(r.ladder.stretch), '· ceiling', fmt(r.ladder.ceiling), '· goal', fmt(r.ladder.goal), `(${r.ladder.goalPlacement}${r.ladder.coincide ? ' — goal coincides with target' : ''})`);
    if (r.potential) console.log('lever:', r.potential.lever, `(engine ${r.potential.gapVdot} VDOT ahead of your legs)`);
    console.log('promotion:', r.promotion.verdict, '—', r.promotion.reason);
    console.table((r.outlook || []).map((o) => ({ race: o.name, wks: o.weeksOut, current: fmt(o.currentSecs), target: fmt(o.targetSecs), stretch: fmt(o.stretchSecs), goal: fmt(o.goalSecs), verdict: o.verdict })));
    return r;
  };
}

export default getRaceOutlook;
