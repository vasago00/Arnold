// ─── core/seasonPlan.js — continuous multi-marathon coaching engine (Option A) ──
// Emil's season: Berlin (Sep 27), NYC (Nov 1), Valencia (Dec 6) — three marathons
// ~5 weeks apart, all sub-3:40 ambition, run as SUPPORTED EFFORTS inside continuous
// high mileage. No single peak, no full taper: hold consistent weekly volume, shave
// for a short MINI-TAPER (a few days) before each race, take a short RECOVERY window
// after, then keep rolling. The marathon itself IS that week's long run.
//
// This module is PURE (no storage / DOM) so it's unit-testable and the same logic
// can drive a debug hook, a Coach panel, or a scheduled brief. A thin runtime
// wrapper (elsewhere) pulls weeklyMiles / longestRecentMi / ACWR from the activity
// store and calls resolveSeasonPlan().
//
// CONTRACT: the engine reflects what to DO this week given where today sits relative
// to the next/last race + current load — it does not mutate anything.

const DAY = 86400000;

// ── Tunables (continuous-model) ──────────────────────────────────────────────
const MINI_TAPER_DAYS   = 5;     // shave volume within this many days before a race
const RACE_WEEK_DAYS    = 1;     // race is imminent (today/tomorrow)
const RECOVERY_DAYS     = 5;     // easy days after a marathon
// ≤10%/week volume increase — the classic conservative ramp, and still the DEFAULT.
// Exported because core/planTiers.js has to name it as the BASELINE rung of the tier
// triad. The triad's whole premise is that the 10% rule is a population heuristic and
// not the physiological limit; the actual limit is acute:chronic load, i.e. ACWR_HOT
// below. Both live here so the triad derives its rungs from this file's constants
// rather than inventing a second, quietly different, idea of "safe".
export const MAX_RAMP_PCT = 0.10;
export const ACWR_HOT     = 1.3;   // acute:chronic above this = overreaching → hold (don't add)
const ACWR_DANGER         = 1.5;   // above this = high injury risk → cut volume
const ACWR_COLD           = 0.8;   // below this = undertraining (room to build)
const LONGRUN_FLOOR     = 8;     // mi — don't drop a build long-run below this
const LONGRUN_STEP      = 1.5;   // mi/week long-run progression
const LONGRUN_TARGET    = 20;    // mi — marathon-supportive ceiling
const DEFAULT_CEILING   = 50;    // sustainable weekly-mile ceiling (overridable)
const MARATHON_MIN_MI   = 24;    // only races ≥ this (marathons) get a taper/recovery window
// The line Emil drew between "a race that is part of the week" and "a race that IS the
// week's long effort": a half marathon. 13 rather than 13.1 so a course measured or
// entered at 13.0 doesn't fall on the wrong side of it by a rounding error. Exported
// because hub/planGenerator.js shapes the week around exactly this threshold — one
// definition, imported, rather than the same 13 written down in two files that can
// then disagree.
export const HALF_MIN_MI = 13;

function parseDate(s) { return s instanceof Date ? s : new Date(String(s) + 'T12:00:00'); }
function daysBetween(a, b) { return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY); }
function r1(n) { return Math.round(n * 10) / 10; }

// Marathon goal pace in sec/mi from a goal finish time.
export function goalPaceSecs(goalTimeSecs, distanceMi = 26.2) {
  if (!goalTimeSecs || !distanceMi) return null;
  return Math.round(goalTimeSecs / distanceMi);
}

// "+3:09" / "-1:20" formatting for a seconds gap.
export function fmtGap(secs) {
  if (secs == null) return '—';
  const s = Math.abs(Math.round(secs));
  const m = Math.floor(s / 60), ss = s % 60;
  return `${secs < 0 ? '-' : '+'}${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * Per-race feasibility read — "are we on track for the goal time, and if not, is the
 * limiter speed or endurance?" Endurance is the limiter when the aerobic base (long
 * run + weekly volume) can't yet support marathon pace, even if leg-speed is close.
 *
 * @returns {{ gapSecs, verdict:'on-track'|'aggressive'|'unrealistic'|'unknown'|'no-goal',
 *             limiter:'endurance'|'speed'|null, note:string }}
 */
export function marathonFeasibility({ predictedMarathonSecs = null, goalSecs = null, weeklyMiles = 0, longestRecentMi = 0 } = {}) {
  if (!goalSecs) return { gapSecs: null, verdict: 'no-goal', limiter: null, note: 'No goal time set.' };
  const gapSecs = predictedMarathonSecs != null ? Math.round(predictedMarathonSecs - goalSecs) : null;
  // A sub-3:40-class marathon needs an endurance base: long run ≥ ~16 building to 20,
  // and weekly volume ≥ ~38. Below that, endurance is the binding constraint.
  const enduranceShort = (longestRecentMi < 16) || (weeklyMiles < 38);

  if (gapSecs == null) return { gapSecs: null, verdict: 'unknown', limiter: null, note: 'No current race prediction available.' };
  if (gapSecs <= 0 && !enduranceShort) {
    return { gapSecs, verdict: 'on-track', limiter: null, note: 'Predicted pace meets the goal and the endurance base supports it.' };
  }
  if (gapSecs <= 300 || enduranceShort) {
    const limiter = enduranceShort ? 'endurance' : 'speed';
    const note = enduranceShort
      ? `Leg speed is close (gap ${fmtGap(gapSecs)}), but the endurance base is light (long run ${r1(longestRecentMi)}mi, ${Math.round(weeklyMiles)}mpw) — that's the limiter.`
      : `Within ~5 min on pace (gap ${fmtGap(gapSecs)}) — achievable with a sharp, consistent build.`;
    return { gapSecs, verdict: 'aggressive', limiter, note };
  }
  return { gapSecs, verdict: 'unrealistic', limiter: 'speed', note: `Current fitness projects ${fmtGap(gapSecs)} over goal — a stretch in this window.` };
}

/**
 * racePhase — THE ONE source of the race periodization phase (marathon-anchored,
 * continuous Option-A model). Pure: races + today → phase + race context. Consumed
 * by resolveSeasonPlan AND the legacy coaching surfaces (computeRaceHorizon,
 * analyzeSeason) so the phase rule lives in exactly one place (coach unification).
 *
 * phase ∈ 'build' | 'mini-taper' | 'race-week' | 'recovery'. Only a MARATHON
 * (≥24mi) triggers mini-taper/race-week/recovery; tune-ups (10K/4M/half) are run
 * THROUGH the build (a Saturday 10K must not blank the next week).
 */
export function racePhase({ races = [], today = new Date(), aRaceDate = null } = {}) {
  const t = parseDate(today);
  const sorted = [...races]
    .filter(r => r && r.date)
    .map(r => ({ ...r, _d: parseDate(r.date) }))
    .sort((a, b) => a._d - b._d);
  const future = sorted.filter(r => r._d >= t);
  const past   = sorted.filter(r => r._d < t);
  const nextRace = future[0] || null;
  const lastRace = past[past.length - 1] || null;
  const daysToNext    = nextRace ? daysBetween(t, nextRace._d) : null;
  const daysSinceLast = lastRace ? daysBetween(lastRace._d, t) : null;

  const isMarathon = (r) => (Number(r.distanceMi) || 0) >= MARATHON_MIN_MI;
  // A-RACE MODE: when a goal race is designated (aRaceDate), ONLY it triggers the marathon
  // taper/recovery. The other marathons become supported TUNE-UP efforts the build runs
  // through — so volume keeps climbing toward the goal instead of resetting after each race
  // and leaving the A-race with a smaller peak. Default (no aRaceDate): every marathon tapers.
  const isTaperRace = (r) => aRaceDate ? (r.date === aRaceDate) : isMarathon(r);
  const nextMarathon = future.find(isTaperRace) || null;
  const lastMarathon = [...past].reverse().find(isTaperRace) || null;
  const daysToMarathon    = nextMarathon ? daysBetween(t, nextMarathon._d) : null;
  const daysSinceMarathon = lastMarathon ? daysBetween(lastMarathon._d, t) : null;

  let phase = 'build';
  if (daysToMarathon != null && daysToMarathon <= RACE_WEEK_DAYS) phase = 'race-week';
  else if (daysToMarathon != null && daysToMarathon <= MINI_TAPER_DAYS) phase = 'mini-taper';
  else if (daysSinceMarathon != null && daysSinceMarathon <= RECOVERY_DAYS) phase = 'recovery';

  const tuneUp = (phase === 'build' && nextRace && !isTaperRace(nextRace) && daysToNext != null && daysToNext <= 10)
    ? { name: nextRace.name, distanceMi: nextRace.distanceMi, daysToNext } : null;

  return { phase, nextRace, lastRace, nextMarathon, lastMarathon,
           daysToNext, daysSinceLast, daysToMarathon, daysSinceMarathon, tuneUp };
}

/**
 * The weekly verdict for the continuous block.
 *
 * @param {object} o
 *   races: [{name,date,distanceMi,goalTimeSecs?}]  (any order; future + recent past)
 *   today
 *   weeklyMiles      : current avg weekly mileage (last ~4 wk)
 *   longestRecentMi  : longest run in the last ~4 wk
 *   acwr             : { ratio, zone } from computeAcuteChronicRatio | null
 *   ceilingMiles     : sustainable weekly ceiling (default 50)
 * @returns weekly verdict + targets + next/last-race context
 */
export function resolveSeasonPlan({ races = [], today = new Date(), weeklyMiles = 0, longestRecentMi = 0, acwr = null, ceilingMiles = DEFAULT_CEILING, aRaceDate = null, maxRampPct = MAX_RAMP_PCT } = {}) {
  const t = parseDate(today);
  // The weekly step is a PARAMETER now, not a hard constant, because the tier triad
  // needs three of them side by side (core/planTiers.js derives each rung's step from
  // a target steady-state ACWR). Omitting it reproduces the 10% rule exactly, so every
  // pre-existing caller behaves identically. Hard-capped at 25%/wk: past roughly there
  // the geometric steady-state ACWR crosses the danger line no matter what the caller
  // believes, and this file is the last place that can refuse.
  const rampPct = Number(maxRampPct) > 0 ? Math.min(0.25, Number(maxRampPct)) : MAX_RAMP_PCT;
  // Phase + race context come from the ONE shared source (racePhase) — every
  // coaching surface now uses it, so the marathon-anchored rule lives in one place.
  const { phase, nextRace, lastRace, nextMarathon, lastMarathon,
          daysToNext, daysSinceLast, daysToMarathon, daysSinceMarathon, tuneUp } = racePhase({ races, today: t, aRaceDate });

  const ratio = acwr && acwr.ratio != null ? acwr.ratio : null;

  let verdict, targetWeeklyMiles, longRunTargetMi, why;

  if (phase === 'race-week' || phase === 'mini-taper') {
    verdict = 'taper';
    targetWeeklyMiles = Math.round(weeklyMiles * 0.6);   // ~40% shave, keep legs sharp
    longRunTargetMi = 0;                                 // the race IS the long run
    why = `${nextMarathon.name} in ${daysToMarathon}d — short mini-taper: cut volume ~40%, keep a little intensity, no new long run. The race is the long run.`;
  } else if (phase === 'recovery') {
    verdict = 'recover';
    targetWeeklyMiles = Math.round(weeklyMiles * 0.55);  // easy week post-marathon
    longRunTargetMi = Math.min(Math.max(longestRecentMi || LONGRUN_FLOOR, 0), 10);
    why = `${daysSinceMarathon}d after ${lastMarathon.name} — easy aerobic only, no hard efforts. Let the legs come back before rebuilding.`;
  } else {
    // BUILD — ramp by ACWR + the 10% rule, capped at the ceiling.
    if (ratio != null && ratio > ACWR_DANGER) {
      verdict = 'cut';
      targetWeeklyMiles = Math.round(weeklyMiles * 0.9);
      why = `ACWR ${ratio} is high (>${ACWR_DANGER}) — pull volume back ~10% this week before it turns into a hole.`;
    } else if (ratio != null && ratio > ACWR_HOT) {
      verdict = 'hold';
      targetWeeklyMiles = Math.round(weeklyMiles);
      why = `ACWR ${ratio} is into overreaching (>${ACWR_HOT}) — hold volume here, don't add load, let it settle.`;
    } else if (weeklyMiles < ceilingMiles) {
      verdict = 'increase';
      targetWeeklyMiles = Math.min(ceilingMiles, Math.round(weeklyMiles * (1 + rampPct)));
      why = `Base (${Math.round(weeklyMiles)}mpw) is below your ${ceilingMiles}-mi ceiling and load is in range — add ~${Math.round(rampPct * 100)}% this week.`;
    } else {
      verdict = 'hold';
      targetWeeklyMiles = Math.round(weeklyMiles);
      why = `At/around your ${ceilingMiles}-mi ceiling with load in range — hold here and let the fitness consolidate.`;
    }
    // Long-run progression toward marathon-supportive, anchored to the build.
    const base = Math.max(LONGRUN_FLOOR, longestRecentMi || LONGRUN_FLOOR);
    longRunTargetMi = Math.min(LONGRUN_TARGET, r1(base + LONGRUN_STEP));
    // "Race it hard inside the week, no taper" is the right instruction for a 5K or a
    // 10-miler and flatly the wrong one for a supported MARATHON, which A-race mode
    // routes through here as a tune-up so the build doesn't reset around it. The week
    // does dip (planGenerator cuts it to ~60% and strips the quality); saying "no
    // taper" while the plan tapers is the plan contradicting itself in its own text.
    if (tuneUp) {
      const tuneMi = Number(tuneUp.distanceMi) || 0;
      const dist = tuneUp.distanceMi ? ` (${tuneUp.distanceMi}M)` : '';
      why += tuneMi >= MARATHON_MIN_MI
        ? ` ${tuneUp.name}${dist} in ${tuneUp.daysToNext}d — a supported marathon inside the build: easy running only into it, and the race is this week's long run. The build resumes after, it does not restart.`
        : tuneMi >= HALF_MIN_MI
          ? ` ${tuneUp.name}${dist} in ${tuneUp.daysToNext}d — race it hard; it takes over as this week's long run, with an easy 48h either side.`
          : ` Tune-up ${tuneUp.name}${dist} in ${tuneUp.daysToNext}d — race it as a hard effort within the week, no taper. It counts inside the week's mileage; the long run stands.`;
    }
  }

  return {
    today: t,
    phase,
    verdict,
    nextRace: nextRace ? { name: nextRace.name, date: nextRace.date, distanceMi: nextRace.distanceMi, daysToNext } : null,
    nextMarathon: nextMarathon ? { name: nextMarathon.name, date: nextMarathon.date, distanceMi: nextMarathon.distanceMi, daysToMarathon } : null,
    lastRace: lastRace ? { name: lastRace.name, date: lastRace.date, daysSinceLast } : null,
    tuneUp,
    weeklyMiles: Math.round(weeklyMiles),
    targetWeeklyMiles,
    longRunTargetMi,
    acwr: ratio,
    rampPct,
    why,
  };
}
