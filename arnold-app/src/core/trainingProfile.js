// Training profile — FORWARD-LOOKING (Sprint 3.2b, reoriented 2026-07).
//
// Anchored on WHERE YOU ARE NOW and WHAT THE GOAL DEMANDS — not on a stale past
// race. One object answers:
//   1. Your current build (volume, long run, threshold — from recent data).
//   2. What the GOAL requires (peak volume, long run, threshold weeks — derived
//      from the goal marathon time, evidence-based via volumeModel).
//   3. The WEAK LINK = the biggest gap between the two, and the finish you're
//      currently projected to run vs the goal.
// Your past marathon is optional CONTEXT ("you've run 4:07 before"), never the
// driver — the finish projection comes from CURRENT fitness (injected predictor).
//
// Pure + node-testable (predictor injected; no storage/window import). The async
// resolveTrainingProfile() wires the real predictFinishSecs + storage.

import { buildRaceRecipe } from './raceRecipe.js';
import { goalRequirements } from './volumeModel.js';

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const MARATHON_MIN_MI = 24;

// ── distance of the target race in km (explicit → mi → name inference) ──
function raceDistanceKm(race) {
  if (!race) return null;
  const km = num(race.distanceKm);
  if (km && km > 0) return km;
  const mi = num(race.distanceMi) ?? num(race.distance_mi);
  if (mi && mi > 0) return mi * 1.60934;
  const name = String(race.name || '').toLowerCase();
  if (/marathon|\bfull\b/.test(name) && !/half/.test(name)) return 42.195;
  if (/\bhalf\b/.test(name)) return 21.0975;
  if (/\b10k\b/.test(name)) return 10;
  if (/\b5k\b/.test(name)) return 5;
  return null;
}

// ── parse a recorded race finish (fields OR "h:mm:ss"/"h:mm" string) → secs ──
export function parseRaceFinishSecs(race, distanceKm = null) {
  if (!race) return null;
  const direct = num(race.resultSecs) ?? num(race.timeSecs) ?? num(race.finishSecs) ?? num(race.timeSeconds);
  if (direct && direct > 0) return Math.round(direct);
  const raw = race.result ?? race.time ?? race.finishTime ?? race.chipTime ?? race.finish;
  if (raw == null) return null;
  const parts = String(raw).trim().split(':').map(s => Number(s));
  if (parts.some(p => !Number.isFinite(p))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) {
    // Ambiguous m:ss vs h:mm — a race ≥ ~10 km is hours:minutes, else minutes:seconds.
    const longRace = (distanceKm ?? raceDistanceKm(race) ?? 0) >= 10;
    return longRace ? parts[0] * 3600 + parts[1] * 60 : parts[0] * 60 + parts[1];
  }
  return null;
}

// ── format seconds → "H:MM" (marathon-style, rounded to the minute) or "MM:SS" ──
export function fmtFinish(secs) {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return null;
  if (secs >= 3600) {
    const totalMin = Math.round(secs / 60);
    return `${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
  }
  const m = Math.floor(secs / 60), s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
// ── format a signed second-gap → "~2 min" / "~45 s" ──
function fmtGain(secs) {
  if (secs == null || secs <= 0) return null;
  if (secs >= 90) return `~${Math.round(secs / 60)} min`;
  return `~${Math.round(secs)} s`;
}

// Ingredient status from the ratio of current-to-recipe.
function statusFor(ratio) {
  if (ratio == null) return 'unknown';
  if (ratio >= 0.95) return 'met';
  if (ratio >= 0.80) return 'close';
  return 'gap';
}

/**
 * buildTrainingProfile — pure. Composes the recipe + an injected finish
 * projector into the recipe-path model consumed by <RecipePath/>.
 *
 * @param i {
 *   activities, races, today, aRaceDate?,
 *   predictFinishSecs?  (distanceKm, activities) => { seconds, source, exponentSource } | null
 * }
 */
export function buildTrainingProfile(i = {}) {
  const today = i.today || new Date().toISOString().slice(0, 10);
  const activities = i.activities || [];
  const races = i.races || [];
  const predict = typeof i.predictFinishSecs === 'function' ? i.predictFinishSecs : null;

  const recipe = buildRaceRecipe({ activities, races, today, aRaceDate: i.aRaceDate || null });
  const { referenceRace, nextARace, weeksOut } = recipe;
  const cur = recipe.current;

  const distKm = raceDistanceKm(nextARace);
  const distMi = distKm ? distKm / 1.60934 : (num(nextARace?.distanceMi) ?? num(nextARace?.distance_mi) ?? 26.2);
  // Goal time lives on the race as `goalTimeSecs` (set in GoalsHub); fall back to
  // any recorded time string. parseRaceFinishSecs alone missed goalTimeSecs → the
  // whole forward-looking model silently disengaged (goalStr null). Real bug, not just tests.
  // Goal time: the race's own goalTimeSecs, else the Performance-goals Marathon
  // target passed in (goals.marathon.targetSecs — where Emil actually set it), else
  // a recorded finish. Without the fallback the profile says "set a goal time" even
  // though the goal IS set, just in the other store — the "not connected" symptom.
  const goalSecs = nextARace
    ? (num(nextARace.goalTimeSecs) ?? num(i.goalSecsFallback) ?? parseRaceFinishSecs(nextARace, distKm))
    : (num(i.goalSecsFallback) ?? null);
  // What the GOAL demands across the key ingredients (marathon-only, evidence-based).
  const req = goalSecs ? goalRequirements(goalSecs, distMi) : null;

  // ── ingredients: current build vs what the GOAL requires (forward-looking) ──
  const ingredients = [];
  if (cur && req) {
    const push = (key, label, unit, now, target) => {
      const ratio = (target && target > 0) ? now / target : null;
      ingredients.push({ key, label, unit, now: now ?? null, target: target ?? null, ratio, status: statusFor(ratio) });
    };
    push('volume',    'Weekly volume',   'mi/wk', cur.avgWeeklyMi,      req.peakMi);
    push('longest',   'Longest run',     'mi',    cur.longestMi,        req.longRunMi);
    push('threshold', 'Threshold weeks', 'wk',    cur.weeksWithQuality, req.thresholdWeeks);
  } else if (cur && (cur.avgWeeklyMi > 0 || cur.longRuns > 0)) {
    // No goal time set → show the current build target-less (still substantive).
    const pushCur = (key, label, unit, now) =>
      ingredients.push({ key, label, unit, now: now ?? null, target: null, ratio: null, status: 'current' });
    pushCur('volume',    'Weekly volume',   'mi/wk', cur.avgWeeklyMi);
    pushCur('longest',   'Longest run',     'mi',    cur.longestMi);
    pushCur('threshold', 'Threshold weeks', 'wk',    cur.weeksWithQuality);
  }

  // Cross-training transparency: aerobic XT credited into current volume.
  const volIng = ingredients.find(g => g.key === 'volume');
  if (volIng && cur && cur.xtEquivMi > 0) volIng.note = `incl. ${cur.xtEquivMi} mi cross-train`;

  // ── weak link: the biggest gap TO THE GOAL (threshold > longest > volume) ──
  const CANDIDATES = ['threshold', 'longest', 'volume'];
  const PRIORITY = { threshold: 3, longest: 2, volume: 1 };
  const weakLink = ingredients
    .filter(g => CANDIDATES.includes(g.key) && (g.status === 'gap' || g.status === 'close') && g.ratio != null)
    .sort((a, b) => (a.ratio - b.ratio) || (PRIORITY[b.key] - PRIORITY[a.key]))[0] || null;

  // ── finish: current projection vs the GOAL (proven race = optional context) ──
  // Use the inferred distance when the race carries no explicit distanceKm/Mi and
  // the name doesn't match (e.g. a race just called "Berlin"): distMi already
  // falls back to the marathon 26.2, so derive projKm from it. Without this the
  // projection silently no-ops and the FINISH ring disappears even with a goal set.
  const projKm = distKm ?? (num(distMi) ? distMi * 1.60934 : null);
  let now = null;
  if (predict && projKm) {
    try {
      const p = predict(projKm, activities);
      if (p && p.seconds > 0) {
        const src = p.source || p.exponentSource || '';
        const confidence = /hub|personal|race/.test(String(src)) ? 'measured' : 'inferred';
        now = { secs: Math.round(p.seconds), str: fmtFinish(p.seconds), confidence };
      }
    } catch { /* projector failure → no finish */ }
  }
  const provenSecs = parseRaceFinishSecs(referenceRace, raceDistanceKm(referenceRace));
  const proven = provenSecs ? { secs: provenSecs, str: fmtFinish(provenSecs), name: referenceRace?.name || null } : null;
  const gapToGoalSecs = (now && goalSecs) ? Math.max(0, now.secs - goalSecs) : null;  // work to do
  const atOrAheadOfGoal = (now && goalSecs) ? now.secs <= goalSecs : null;
  const finish = {
    now,
    goalSecs, goalStr: goalSecs ? fmtFinish(goalSecs) : null,
    gapToGoalSecs, gapToGoalStr: fmtGain(gapToGoalSecs),
    atOrAheadOfGoal,
    proven,   // optional context: your PB / most recent marathon
  };

  // ── one-line coach read (forward-looking: current → goal) ──
  const goalStr = finish.goalStr;
  let headline = null;
  if (!now && !ingredients.length) {
    headline = 'Log a few recent runs and your profile comes into focus.';
  } else if (now && goalStr && atOrAheadOfGoal) {
    headline = `Projected ${now.str} — already at your ${goalStr} goal. Hold the build and sharpen.`;
  } else if (weakLink && goalStr) {
    headline = `${weakLink.label} is the biggest gap to ${goalStr}${proven ? ` (you've run ${proven.str} before)` : ''} — that's what to build.`;
  } else if (now && goalStr) {
    headline = `Projected ${now.str} vs your ${goalStr} goal${finish.gapToGoalStr ? ` — ${finish.gapToGoalStr} to find` : ''}.`;
  } else if (now) {
    headline = `Tracking ${now.str} — set a goal time to see the gap to close.`;
  } else {
    headline = 'Building toward your race.';
  }

  return {
    hasData: !!(now || ingredients.length),
    referenceRace, nextARace, weeksOut,
    ingredients, weakLink, finish, headline,
  };
}

/**
 * resolveTrainingProfile — storage-reading wrapper. Wires the real
 * predictFinishSecs + unified activities/races, mirroring resolveRaceRecipe.
 * Kept async + separate so buildTrainingProfile stays pure/testable.
 */
export async function resolveTrainingProfile(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { storage } = await import('./storage.js');
  let activities = [];
  try { const m = await import('./dcyMath.js'); activities = m.allActivities() || []; }
  catch { activities = storage.get('activities') || []; }
  if (!activities.length) { try { activities = storage.get('activities') || []; } catch {} }
  const races = (() => { try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); } catch { return storage.get('races') || []; } })();
  let predictFinishSecs = null;
  try { const tm = await import('./derive/tileMetrics.js'); predictFinishSecs = tm.predictFinishSecs; } catch {}
  // Goal fallback — read the SAME sources LivingPlan uses, in the same order, so
  // the profile and the plan agree (no "set a goal" nag when the plan has one).
  //   1. v2 Performance-goals Marathon target: goals.performance.marathon.targetSecs
  //   2. legacy top-level goals.marathon.targetSecs (via getGoals)
  //   3. Target-marathon-pace goal → marathon time (matches LivingPlan's fallback)
  // Each source in its OWN try so one throwing can't skip the rest. The coach's
  // goal comes FIRST (race.goalTimeSecs ?? sub-3:40 default) — always non-null, so
  // the profile ALWAYS shows a goal and agrees with the coach. buildTrainingProfile
  // still prefers the race's own goalTimeSecs over this, so a real set goal wins.
  let goalSecsFallback = null;
  try { const { getSeasonCoach } = await import('./seasonCoach.js'); const gs = Number(getSeasonCoach()?.inputs?.goalSecs); if (gs > 0) goalSecsFallback = gs; } catch { /* ignore */ }
  if (!goalSecsFallback) { try { const m = (storage.get('goals') || {})?.performance?.marathon; const t = m && typeof m === 'object' ? Number(m.targetSecs) : Number(m); if (t > 0) goalSecsFallback = t; } catch { /* ignore */ } }
  if (!goalSecsFallback) {
    try {
      const { getGoals } = await import('./goals.js');
      const g = getGoals();
      if (g?.marathon && Number(g.marathon.targetSecs) > 0) goalSecsFallback = Number(g.marathon.targetSecs);
      else if (g?.targetRacePace) {
        const [gm, gs] = String(g.targetRacePace).split(':').map(Number);
        const spm = (gm || 0) * 60 + (gs || 0);
        if (spm > 0) goalSecsFallback = Math.round(spm * 26.2188);
      }
    } catch { /* ignore */ }
  }
  // Anchor on the race the user is BUILDING TOWARD (planPrefs.target), not just the
  // soonest marathon — otherwise the profile silently targets a different race than
  // the plan/Adjust panel (e.g. anchors on NY while Emil set the goal on Valencia),
  // and the goal never shows. Matches LivingPlan's target selection.
  let aRaceDate = opts.aRaceDate || null;
  if (!aRaceDate) {
    try { const p = storage.get('planPrefs'); if (p && typeof p.target === 'string' && p.target.startsWith('race:')) aRaceDate = p.target.slice(5); } catch { /* ignore */ }
  }
  return buildTrainingProfile({ today, activities, races, aRaceDate, predictFinishSecs, goalSecsFallback });
}

export default buildTrainingProfile;
