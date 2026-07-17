// Race recipe / build retrospective (Sprint 3.2a) — the spine of the living plan.
//
// Reconstructs the training block that led into your best PAST race ("what worked")
// and compares it to your CURRENT build. The differentiator vs a generic ramp is
// TRAJECTORY ALIGNMENT: it checks where you were at the same weeks-to-race last
// time, so "I look behind" becomes "you're exactly where your proven build was at
// this point." The plan (3.2c) is then built to fill the *named* gap toward the
// recipe, not to chase an arbitrary target.
//
// Pure: `buildRaceRecipe(inputs)` takes activities + races + today; the wrapper
// reads storage. No Emil-specific constants → sim-testable, generalizes.

import { resolveARace } from './aRace.js';   // the ONE canonical A-race resolver (shared with goalResolve)

const MARATHON_MIN_MI = 24;
const KM_PER_MI = 1.60934;
const HARD_RE = /tempo|interval|threshold|speed|hiit|fartlek|track/i;

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// A race counts as a marathon if its distance says so (mi OR km) OR its name
// does. Real race stores are inconsistent: ICS/manual imports may carry only
// distanceKm, and catalog picks like "Berlin Marathon" often have no distance
// field at all — the mi-only check silently missed every one of those, so no
// reference build was ever found and the recipe-path collapsed to a lone finish.
export function isMarathonRace(r) {
  const mi = num(r?.distanceMi) ?? num(r?.distance_mi);
  if (mi != null && mi >= MARATHON_MIN_MI) return true;
  const km = num(r?.distanceKm);
  if (km != null && km >= MARATHON_MIN_MI * KM_PER_MI) return true;   // ≥ ~38.6 km
  const name = String(r?.name || '').toLowerCase();
  return /\bmarathon\b/.test(name) && !/\bhalf\b/.test(name);
}
const isRunAct   = (a) => /run/i.test(a?.type || a?.activityType || '');
const isQualityAct = (a) => HARD_RE.test(a?.intensityClass || a?.type || a?.activityType || '');
const distMi = (a) => num(a?.distanceMi) || num(a?.distance_mi) || 0;

function toDate(s) { const d = new Date(String(s) + 'T12:00:00'); return isNaN(d) ? null : d; }
function daysBetween(fromISO, toISO) { const a = toDate(fromISO), b = toDate(toISO); return (a && b) ? Math.round((b - a) / 86400000) : null; }
function shiftISO(iso, days) { const d = toDate(iso); if (!d) return null; d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
// Monday-anchored ISO week key for grouping weekly volume.
function weekKey(iso) {
  const d = toDate(iso); if (!d) return null;
  const dow = (d.getDay() + 6) % 7;           // Mon=0..Sun=6
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ── Cross-training credit (hybrid-athlete support) ──────────────────────────
// Evidence-based default. Intensity/effort-matched aerobic cross-training
// (bike, swim, row, elliptical, pool-run) maintains the aerobic engine nearly
// 1:1 short-term — studies show ~50% of run volume can be replaced by cycling,
// or exclusive deep-water running sustained, with NO loss of VO2max/5K for
// 4–8 weeks. But specificity means it does NOT build marathon-specific fitness,
// and transfer is imperfect (worse the more trained you are). So we credit
// aerobic XT toward AEROBIC VOLUME at 0.75 of a run-equivalent, and give it
// ZERO credit toward the run-specific ingredients (long run, threshold weeks).
// Strength is a separate lever (durability/economy), not aerobic volume, so it
// is intentionally excluded here. The 0.75 coefficient is a single knob meant
// to become hub-learnable from the athlete's own XT→run-performance response.
// Refs: Foster & Tanaka (Sports Med); Blagrove 2018; DWR reviews (see HANDOVER).
export const CROSS_TRAIN_CREDIT = 0.75;
const AEROBIC_XT_RE = /bike|cycl|spin|swim|row|erg|ellipt|arc\s*trainer|aqua|pool|deep\s*water|water\s*run|hike|hiking/i;
function isAerobicXT(a) {
  if (!a || isRunAct(a)) return false;
  const t = `${a.type || ''} ${a.activityType || ''} ${a.sport || ''}`;
  return AEROBIC_XT_RE.test(t);
}
function paceSecsPerMi(a) {
  const secs = num(a?.durationSecs), mi = distMi(a);
  return (secs && mi > 0) ? secs / mi : null;
}

/**
 * Metrics for the training window of `weeks` ending at `endISO`.
 * Aerobic volume (avgWeeklyMi/peakWeeklyMi) folds in credited cross-training;
 * run-specific fields (longRuns/longestMi/weeksWithQuality) stay RUN-ONLY.
 * @returns { avgWeeklyMi, peakWeeklyMi, weeksWithQuality, longRuns, longestMi, totalMi, runMi, xtEquivMi }
 */
export function windowMetrics(activities, endISO, weeks = 16, minLongMi = 13) {
  const end = toDate(endISO); if (!end) return null;
  const startISO = shiftISO(endISO, -weeks * 7);
  const inWindow = (a) => a && a.date && a.date > startISO && a.date <= endISO;
  const runs = (activities || []).filter(a => inWindow(a) && isRunAct(a));
  const xt   = (activities || []).filter(a => inWindow(a) && isAerobicXT(a));

  // Athlete's easy-run pace (median of window runs) is the currency for turning
  // cross-training TIME into run-equivalent miles; falls back to 9:30/mi.
  const runPaces = runs.map(paceSecsPerMi).filter(p => p && p > 0).sort((a, b) => a - b);
  const easyPaceSecs = runPaces.length ? runPaces[Math.floor(runPaces.length / 2)] : 570;

  const byWeek = new Map();        // run-equivalent miles (run + credited XT) per ISO week
  let runMi = 0, xtEquivMi = 0, longRuns = 0, longestMi = 0;
  const qualityWeeks = new Set();  // RUN quality only (marathon-specific)
  for (const a of runs) {
    const mi = distMi(a); runMi += mi;
    if (mi > longestMi) longestMi = mi;
    if (mi >= minLongMi) longRuns++;
    const wk = weekKey(a.date);
    byWeek.set(wk, (byWeek.get(wk) || 0) + mi);
    if (isQualityAct(a)) qualityWeeks.add(wk);
  }
  for (const a of xt) {
    const secs = num(a.durationSecs);
    if (!secs || secs <= 0) continue;
    const eq = (secs / easyPaceSecs) * CROSS_TRAIN_CREDIT;   // run-equivalent miles, discounted
    xtEquivMi += eq;
    const wk = weekKey(a.date);
    byWeek.set(wk, (byWeek.get(wk) || 0) + eq);
  }
  const totalMi = runMi + xtEquivMi;
  const peakWeeklyMi = byWeek.size ? Math.max(...byWeek.values()) : 0;
  return {
    avgWeeklyMi: Math.round((totalMi / weeks) * 10) / 10,
    peakWeeklyMi: Math.round(peakWeeklyMi * 10) / 10,
    weeksWithQuality: qualityWeeks.size,
    longRuns,
    longestMi: Math.round(longestMi * 10) / 10,
    totalMi: Math.round(totalMi),
    runMi: Math.round(runMi * 10) / 10,
    xtEquivMi: Math.round(xtEquivMi * 10) / 10,
  };
}

// A run activity counts as a marathon if its distance is in the marathon band.
// GPS marathons often read slightly long; the upper bound excludes ultras so a
// 50k doesn't masquerade as the reference build.
const MARATHON_ACT_MIN_MI = 25.5;
const MARATHON_ACT_MAX_MI = 27.5;
export function isMarathonActivity(a) {
  if (!a || !isRunAct(a)) return false;
  const mi = distMi(a);
  return mi >= MARATHON_ACT_MIN_MI && mi <= MARATHON_ACT_MAX_MI;
}

/**
 * findReferenceMarathon — most-recent past marathon across BOTH the race store
 * and the activity history. Returns a normalized reference
 * { name, date, distanceMi?, resultSecs?, source:'race'|'activity' }.
 * resultSecs (the proven finish) comes from the race result if recorded, else
 * the marathon activity's own durationSecs — so the counterfactual works from
 * Garmin data without any manual entry.
 */
export function findReferenceMarathon(races = [], activities = [], today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const durSecsOf = (a) => num(a?.durationSecs) ?? (num(a?.durationMins) != null ? num(a.durationMins) * 60 : null);
  const raceCands = (races || [])
    .filter(r => r?.date && r.date < t && isMarathonRace(r))
    .map(r => ({ ...r, source: 'race' }));
  const actCands = (activities || [])
    .filter(a => a?.date && a.date < t && isMarathonActivity(a))
    .map(a => ({
      name: a.title || a.activityName || a.name || 'your marathon',
      date: a.date,
      distanceMi: distMi(a),
      resultSecs: durSecsOf(a),
      source: 'activity',
    }));
  const ref = [...raceCands, ...actCands].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!ref) return null;
  // Race-source ref with no recorded result → borrow the finish from a marathon
  // activity within ±3 days (the same race, logged on the watch).
  if (ref.source === 'race' && ref.resultSecs == null && ref.result == null && ref.timeSecs == null && ref.finishTime == null) {
    const near = actCands.find(a => Math.abs(daysBetween(a.date, ref.date) ?? 99) <= 3);
    if (near?.resultSecs) return { ...ref, resultSecs: near.resultSecs };
  }
  return ref;
}

/**
 * buildRaceRecipe — the proven build vs the current build, with trajectory alignment.
 * @param i { activities, races, today, aRaceDate?, weeks?, minLongMi? }
 */
export function buildRaceRecipe(i = {}) {
  const today = i.today || new Date().toISOString().slice(0, 10);
  const activities = i.activities || [];
  const races = i.races || [];
  const weeks = i.weeks || 16;
  const minLongMi = i.minLongMi || 13;

  // Reference build = the most recent PAST marathon (a proven, race-tested block).
  // Sourced from BOTH the race store AND the activity history: most amateurs
  // never hand-enter their marathons as "races" — they just show up as a
  // ~26.2mi run in Garmin. Detecting from activities means the recipe lights up
  // from data the user already has, and the activity's own durationSecs gives us
  // the proven finish time for the counterfactual for free.
  const referenceRace = findReferenceMarathon(races, activities, today);
  const recipe = referenceRace ? windowMetrics(activities, referenceRace.date, weeks, minLongMi) : null;

  // Next A-race → weeks-out anchor, via the ONE canonical resolver (core/aRace.js). This USED to
  // prefer the soonest marathon, which named Berlin while the goal was Valencia; the shared resolver
  // prefers the marathon you set a goal time on (you only set a goal on the race you're training for),
  // so goalResolve + this path can never disagree on the A-race again.
  const nextARace = resolveARace(races, today, i.aRaceDate);

  const current = windowMetrics(activities, today, weeks, minLongMi);

  // ── Trajectory alignment (the "behind but on-track" fix) ──
  // Compare your recent 4-wk volume to where the reference build was at the SAME
  // weeks-to-race point, not to a naive full-build target.
  let onTrajectory = null, trajectoryNote = null, weeksOut = null;
  if (referenceRace && nextARace && recipe) {
    weeksOut = Math.max(0, Math.round((daysBetween(today, nextARace.date) || 0) / 7));
    const refAtSamePointEnd = shiftISO(referenceRace.date, -weeksOut * 7);
    const refThen = windowMetrics(activities, refAtSamePointEnd, 4, minLongMi);
    const curRecent = windowMetrics(activities, today, 4, minLongMi);
    const refVol = refThen?.avgWeeklyMi || 0;
    const curVol = curRecent?.avgWeeklyMi || 0;
    if (refVol > 0) {
      onTrajectory = curVol >= refVol * 0.9;   // within 10% of your proven pace at this point
      trajectoryNote = `${weeksOut} wk out from ${nextARace.name || 'your race'}, you're ~${Math.round(curVol)} mi/wk. `
        + `Before ${referenceRace.name || 'your last marathon'} you were ~${Math.round(refVol)} mi/wk at this same point — `
        + (onTrajectory ? `you're on your proven trajectory.` : `you're tracking below your proven trajectory.`);
    }
  }

  // ── Named gaps: current build vs the recipe (what worked) ──
  const gaps = [];
  if (recipe && current) {
    const gap = (label, cur, ref, unit = '') => {
      if (ref > 0 && cur < ref * 0.9) gaps.push({ metric: label, current: cur, recipe: ref, delta: Math.round((cur - ref) * 10) / 10, unit });
    };
    gap('weekly volume', current.avgWeeklyMi, recipe.avgWeeklyMi, 'mi/wk');
    gap('quality weeks', current.weeksWithQuality, recipe.weeksWithQuality, 'wk');
    gap('long runs', current.longRuns, recipe.longRuns, '');
    gap('longest run', current.longestMi, recipe.longestMi, 'mi');
  }

  return { referenceRace, nextARace, weeksOut, recipe, current, onTrajectory, trajectoryNote, gaps };
}

/**
 * resolveRaceRecipe — thin storage-reading wrapper. Uses the unified activity set
 * (stored + FIT) when available; falls back to the raw store. Kept separate so
 * buildRaceRecipe stays pure/testable.
 */
export async function resolveRaceRecipe(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { storage } = await import('./storage.js');
  let activities = [];
  try { const m = await import('./dcyMath.js'); activities = m.allActivities() || []; }
  catch { activities = storage.get('activities') || []; }
  if (!activities.length) { try { activities = storage.get('activities') || []; } catch {} }
  const races = (() => { try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); } catch { return storage.get('races') || []; } })();
  return buildRaceRecipe({ today, activities, races, aRaceDate: opts.aRaceDate || null });
}

export default buildRaceRecipe;
