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
// The shared "is this a marathon" test. Imported rather than re-inlined: aRace.js#isMarathon is
// the same predicate resolveARace uses to pick the race in the first place, and a second local
// copy is how two surfaces start disagreeing about what counts as a marathon. Static import is
// safe — aRace.js is PURE (no storage/date), so this stays node-testable.
import { isMarathon } from './aRace.js';
// ROUND 98 — the ONE finish-time formatter. This file used to define its own, nine lines
// below where the import now sits, and that copy ROUNDED to the nearest minute where
// core/time.js truncates. A 3:48:35 goal was therefore "3:49" in the training profile and
// "3:48" everywhere the profile's number was re-derived — the exact one-minute fork that
// core/time.js's own header comment was written to end, quietly re-opened by a second
// definition. Re-exported (not just imported) because trainingProfile.test.js imports
// fmtFinish FROM HERE; the name stays, the arithmetic is now shared.
import { fmtFinish } from './time.js';
export { fmtFinish } from './time.js';

// "a number, or null if there isn't one". The explicit null/''/whitespace rejection is the whole
// point: `Number(null)` is 0 and `Number('')` is 0, so without it this helper reports a MISSING
// value as a REAL ZERO. Every one of Emil's races except Valencia stores `goalTimeSecs: null`,
// and that was landing here as a goal time of zero seconds — which is not a harmless 0, because:
//
//   • `raceOwnGoal != null` then read TRUE, so a race with no goal time blocked the athlete's
//     stored goals and his plan commitment from ever being consulted (the profile said "set a
//     goal time to see the gap" while a goal was sitting right there in storage);
//   • `num(a) ?? num(b)` chains stopped dead on the first field, because 0 is not nullish — so
//     `resultSecs: null, timeSecs: 12000` reported NO recorded finish, and `distanceMi: null,
//     distance_mi: 26.2` reported no distance.
//
// aRace.js already had this right (`Number(r.goalTimeSecs) > 0`); this file was the outlier.
const num = (x) => {
  if (x === null || x === undefined) return null;
  if (typeof x === 'string' && x.trim() === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
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

// fmtFinish lives in core/time.js — imported and re-exported at the top of this file.
// Note for callers: it returns '' (not null) for a missing/invalid input. Every call site
// here is already guarded by a truthiness check on the seconds, so nothing downstream can
// tell the difference, and '' is falsy exactly where null was.
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
  const potentialGapFor = typeof i.potentialGapFor === 'function' ? i.potentialGapFor : null;

  const recipe = buildRaceRecipe({ activities, races, today, aRaceDate: i.aRaceDate || null });
  const { referenceRace, nextARace, weeksOut } = recipe;
  const cur = recipe.current;

  const MARA_KM = 42.195;
  const raceDistKm = raceDistanceKm(nextARace) ?? (num(nextARace?.distanceMi) ?? num(nextARace?.distance_mi) ? (num(nextARace?.distanceMi) ?? num(nextARace?.distance_mi)) * 1.60934 : null);
  // CRITICAL: resolve the GOAL and the DISTANCE IT BELONGS TO **together**. Projecting one distance and grading
  // against a goal for another is the "1:04 at 3:30" bug — a short tune-up race gets projected (~1:04) while the
  // goal falls back to the marathon performance target (3:30). The pairing below guarantees projKm ≡ goal's
  // distance, so the FINISH ring, the goal gap, and the ingredient requirements are all the same race.
  //   • A COMMITMENT made FOR THIS RACE     → project that race's distance. (see below)
  //   • Race carries its OWN goalTimeSecs  → project that race's distance.
  //   • Else a Performance-goals MARATHON target (goalSecsFallback) → project the MARATHON (that's its distance).
  //   • Else a recorded finish on the race → that race's distance.
  //
  // Why the commitment outranks the race's own goalTimeSecs: they are not the same KIND of fact.
  // `goalTimeSecs` is an aspiration typed on the race record, often months ago and never revised
  // (Emil's Valencia record says 3:30). The commitment is the tier he SELECTED and put on the
  // calendar — the block currently being run is built on it. When those differ, grading the
  // profile against the aspiration while the calendar is built on the commitment is precisely
  // the "surfaces don't talk to each other" complaint: the Training Profile card would report
  // "● committed · Your time 3:40" and the finish ring beside it would grade against 3:30.
  //
  // The guard is narrow on purpose. `committedGoal` is only supplied when the commitment is FOR
  // this exact race (date match, checked in resolveTrainingProfile), and it is only honoured when
  // that race is a MARATHON — because every plan tier is a marathon finish time, and letting one
  // set the goal on a half would re-create the "1:04 at 3:30" bug this block exists to prevent.
  // Goal and distance still resolve together: the goal belongs to THIS race, so does the distance.
  const raceOwnGoal = num(nextARace?.goalTimeSecs);
  const committedGoal = (num(i.committedGoalSecs) != null
    && nextARace && i.committedGoalARaceDate && nextARace.date === i.committedGoalARaceDate
    && isMarathon(nextARace)) ? num(i.committedGoalSecs) : null;
  let goalSecs = null, goalKm = null;
  // `> 0`, not `!= null` — the same guard aRace.js:50 uses to decide whether a race has a goal at
  // all, so "which race is the A-race" and "what is its goal" can never answer that differently.
  // A stored 0 is an empty field, not a goal of zero seconds.
  if (committedGoal > 0) { goalSecs = committedGoal; goalKm = raceDistKm ?? MARA_KM; }
  else if (raceOwnGoal > 0) { goalSecs = raceOwnGoal; goalKm = raceDistKm ?? MARA_KM; }
  else if (num(i.goalSecsFallback) != null) { goalSecs = num(i.goalSecsFallback); goalKm = MARA_KM; }
  else if (nextARace) { const rec = parseRaceFinishSecs(nextARace, raceDistKm); if (rec != null) { goalSecs = rec; goalKm = raceDistKm ?? null; } }
  // The distance we PROJECT and grade at = the goal's distance (or the A-race distance / marathon when no goal).
  const distKm = goalKm ?? raceDistKm ?? MARA_KM;
  const distMi = distKm / 1.60934;
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
  // projKm ≡ distKm, which was paired to the goal's distance above — so the projected finish and the goal it's
  // compared against are always the SAME race/distance (no more short-race projection vs marathon goal).
  const projKm = distKm;
  let now = null;
  if (predict && projKm) {
    try {
      const p = predict(projKm, activities);
      if (p && p.seconds > 0) {
        const src = p.source || p.exponentSource || '';
        const confidence = /hub|personal|race/.test(String(src)) ? 'measured' : 'inferred';
        now = {
          secs: Math.round(p.seconds), str: fmtFinish(p.seconds), confidence,
          // P1 — the DYNAMIC confidence band. lowStr/highStr move with training; confidenceScore/bandPct
          // move with how much recent, consistent, proven evidence exists; asOf is the freshest effort.
          lowSecs: p.low != null ? Math.round(p.low) : null,
          highSecs: p.high != null ? Math.round(p.high) : null,
          lowStr: p.low != null ? fmtFinish(p.low) : null,
          highStr: p.high != null ? fmtFinish(p.high) : null,
          confidenceScore: p.confidence != null ? p.confidence : null,   // 0..1
          bandPct: p.halfBandPct != null ? p.halfBandPct : null,
          asOf: p.asOf || null,
          responsive: String(src) === 'training-blend',   // true once the training-driven estimate is live
        };
        // Aerobic ceiling: a SEPARATE, clearly-labelled marker beside the anchored finish — never the finish
        // itself. Only attached when the gap is meaningful (don't clutter with "you're at your ceiling").
        if (potentialGapFor) {
          try {
            const g = potentialGapFor(projKm, activities);
            if (g && (g.magnitude === 'large' || g.magnitude === 'moderate')) {
              now.potential = { measuredVo2: g.measuredVo2, gapVdot: g.gapVdot, ceilingStr: g.ceilingStr, reachStr: g.reachStr, lever: g.lever, source: g.source, confidence: g.confidence };
            }
          } catch { /* no marker */ }
        }
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
    // Diagnostic: what the ring actually resolved — the A-race it anchored on, the distance it PROJECTED, and
    // the goal (+its distance). Surfaced via window.__profileDebug so a "1:04 at 3:30" mismatch is traceable.
    _debug: {
      nextARaceName: nextARace?.name || null, raceDistKm: raceDistKm != null ? +raceDistKm.toFixed(2) : null,
      raceOwnGoalSecs: raceOwnGoal ?? null, goalSecsFallback: num(i.goalSecsFallback) ?? null,
      // Which of the three won, and whether the commitment was offered at all. Without this a
      // 3:30 on screen is ambiguous between "the race record said so" and "the commitment did".
      committedGoalSecs: num(i.committedGoalSecs) ?? null, committedGoalUsed: committedGoal > 0,
      goalSecs, goalKm: goalKm != null ? +goalKm.toFixed(2) : null, projKm: +projKm.toFixed(2),
      finishSecs: now?.secs ?? null, finishStr: now?.str ?? null, goalStr: finish.goalStr, source: now ? undefined : 'no-projection',
    },
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
  // ── WHICH RACE ──────────────────────────────────────────────────────────────────────
  // Anchor on the race actually being built toward, not just the soonest marathon, or the
  // profile silently targets a different race than the plan does.
  //
  // This used to read ONLY `planPrefs.target`, while raceOutlookLive.js and LivingPlan both
  // resolve through core/aRace.js#resolveARace with `goals.aRaceDate` as the override. Those
  // are different keys, so the moment Emil pinned an A-race in goals without also leaving a
  // `race:` target in planPrefs, this file profiled one race and every other surface profiled
  // another — the exact "surfaces don't talk to each other" complaint. Now:
  //
  //   1. an explicit opts.aRaceDate          (a caller that already knows)
  //   2. resolveARace(...)                    (THE shared definition — the same call the outlook
  //                                            and LivingPlan make, with BOTH explicit pins fed
  //                                            in as its override so there is only one resolver)
  //   3. the COMMITMENT's race                (last resort only — see below)
  //
  // The two explicit pins — `goals.aRaceDate` and the legacy `planPrefs.target` — are funnelled
  // INTO resolveARace rather than checked beside it. resolveARace already treats an explicit date
  // as decisive (aRace.js:43-45), so routing them through it preserves both pins exactly while
  // deleting the parallel path that made this file answer "which race" differently from everyone
  // else. Adding a fourth key here would have re-created the bug in a new place.
  //
  // The commitment is LAST, not first, and that ordering is deliberate. LivingPlan freezes its
  // aRaceDate FROM resolveARace, so in the normal case they already agree and the order is moot.
  // When they disagree, the live calendar is the fresher fact — a race was added, removed, or
  // re-pinned since the block was committed — and the stale commitment must not drag the whole
  // profile onto a race the athlete is no longer building toward. It then also loses the goal
  // question below, because commitmentAppliesTo() returns false, which is the same conclusion
  // the Training Profile card reaches when it says "committed to another race". One story.
  // It still wins over nothing at all: a block running toward a race that has fallen off the
  // calendar is better traced than dropped.
  let commitment = null;
  try { const { getCommitment } = await import('./planCommitment.js'); commitment = getCommitment(); } catch { /* ignore */ }
  let aRaceDate = opts.aRaceDate || null;
  if (!aRaceDate) {
    try {
      const { resolveARace } = await import('./aRace.js');
      const goals = storage.get('goals') || {};
      let pin = goals.aRaceDate || null;
      if (!pin) {
        try { const p = storage.get('planPrefs'); if (p && typeof p.target === 'string' && p.target.startsWith('race:')) pin = p.target.slice(5); } catch { /* ignore */ }
      }
      const a = resolveARace((races || []).filter(r => r && r.date), today, pin);
      if (a?.date) aRaceDate = a.date;
    } catch { /* ignore */ }
  }
  if (!aRaceDate && commitment?.aRaceDate) aRaceDate = commitment.aRaceDate;

  // ── WHICH GOAL TIME ─────────────────────────────────────────────────────────────────
  //   1. THE COMMITMENT. What the athlete chose and put on the calendar. It goes first
  //      because it is the only source here that records a DECISION rather than a default,
  //      a stale form field, or a guess — and it is checked against aRaceDate, so a Berlin
  //      commitment can never set the goal time on a Valencia profile.
  //   2. v2 Performance-goals Marathon target: goals.performance.marathon.targetSecs
  //   3. legacy top-level goals.marathon.targetSecs (via getGoals)
  //   4. Target-marathon-pace goal → marathon time (matches LivingPlan's fallback)
  //   5. the season coach's default — LAST, and only so a profile is never goal-less.
  //
  // The coach used to be FIRST, and that was a bug rather than a preference: getSeasonCoach()
  // called with no arguments returns its own parameter default, a hardcoded 13200. So this
  // always resolved to 3:40 on the first line and sources 2–4 — the athlete's REAL stored
  // goals — were unreachable dead code. That default is also now indistinguishable from a
  // real answer, because 3:40 is a time Emil genuinely typed in as a custom option.
  // Each source keeps its own try so one throwing cannot skip the rest. buildTrainingProfile
  // still prefers the race's own goalTimeSecs over all of this, so a goal set on the race wins.
  let goalSecsFallback = null;
  // The committed time is passed SEPARATELY as well as into the fallback chain. As a fallback it
  // only outranks the athlete's stored goals; as `committedGoalSecs` it also outranks the race's
  // own goalTimeSecs — but only for the race it was made for, and only for a marathon. Both are
  // gated by the same commitmentAppliesTo() check, so there is one decision, used twice.
  let committedGoalSecs = null, committedGoalARaceDate = null;
  try {
    const { commitmentAppliesTo } = await import('./planCommitment.js');
    if (commitment && Number(commitment.goalSecs) > 0
      && (!aRaceDate || commitmentAppliesTo(commitment, aRaceDate))) {
      goalSecsFallback = Number(commitment.goalSecs);
      committedGoalSecs = Number(commitment.goalSecs);
      committedGoalARaceDate = commitment.aRaceDate || aRaceDate || null;
    }
  } catch { /* ignore */ }
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
  if (!goalSecsFallback) {
    try { const { getSeasonCoach } = await import('./seasonCoach.js'); const gs = Number(getSeasonCoach()?.inputs?.goalSecs); if (gs > 0) goalSecsFallback = gs; } catch { /* ignore */ }
  }
  // Aerobic-ceiling gap for the finish (same helper the coach uses → one number). Injected like the predictor
  // so buildTrainingProfile stays pure. Reads the measured VO2max here (storage), computes the gap for whatever
  // distance the profile ends up projecting.
  let potentialGapFor = null;
  try {
    const { resolvePotentialGap, readMeasuredVo2 } = await import('./derive/potentialGap.js');
    const measured = readMeasuredVo2({ storage, activities, clinicalTests: (() => { try { return storage.get('clinicalTests'); } catch { return []; } })() });
    if (measured && measured.value > 0) {
      potentialGapFor = (dKm, acts) => resolvePotentialGap({ activities: acts, today, distanceKm: dKm, measured });
    }
  } catch { /* ignore — no ceiling marker */ }
  const profile = buildTrainingProfile({
    today, activities, races, aRaceDate, predictFinishSecs, goalSecsFallback, potentialGapFor,
    committedGoalSecs, committedGoalARaceDate,
  });
  try { if (typeof window !== 'undefined' && profile && profile._debug) { window.__profileDebug = () => profile._debug; } } catch { /* ignore */ }
  return profile;
}

export default buildTrainingProfile;
