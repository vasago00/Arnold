// ─── core/todayStatus.js — ONE source of truth for "today's workout status" ───
// Multiple surfaces answer "what did the user do / was today's plan done?" — the
// mobile Planned-Workout tile, the web EdgeIQ (TrainingTab) TODAY cell, coach
// lines, etc. Historically each re-derived it inline and they drifted: a logged
// indoor-bike on a planned-run (or no-plan) day showed "Rest day ✓" on web while
// the mobile tile hid the workout. This module centralizes the decision so a
// change here fixes every surface at once.
//
// CONTRACT: any surface that labels today's plan/done state MUST call
// resolveTodayStatus() (or use actualFamilyOf + the maps below) — never re-derive
// a plan-vs-actual label inline. See DESIGN_DECISIONS.md.

import { isRun, isStrength, isHIIT, isMobility, isCycling, isSwim, isSki, isWalk } from './activityClass.js';
import { localDate } from './time.js';

// Plan-type → discipline family / display label. (Kept identical to the maps the
// PlannedWorkoutTile used so importing them is behaviour-preserving.)
export const PLAN_TYPE_FAMILY = {
  easy_run: 'run', long_run: 'run', tempo: 'run', intervals: 'run',
  hiit: 'hiit', strength: 'strength', mobility: 'mobility', cross: 'cross',
  race: 'race', rest: 'rest',
  cycle: 'cycle', swim: 'swim', ski: 'ski', walk: 'walk',
};
export const PLAN_TYPE_LABEL = {
  easy_run: 'Easy run', long_run: 'Long run', tempo: 'Tempo', intervals: 'Intervals',
  hiit: 'HIIT', strength: 'Strength', mobility: 'Mobility', cross: 'Cross-train',
  race: 'Race', rest: 'Rest',
  cycle: 'Cycling', swim: 'Swim', ski: 'Ski', walk: 'Walk/Hike',
};
// Discipline family → display label (used to name what was ACTUALLY done).
export const FAMILY_LABEL = {
  run: 'Run', strength: 'Strength', hiit: 'HIIT', mobility: 'Mobility',
  cross: 'Cross-train', cycle: 'Cycling', swim: 'Swim', ski: 'Ski', walk: 'Walk/Hike',
  race: 'Race',
};

const MIN_PROMOTE_MINUTES = 20; // a session must be >= 20 min to "count" (mobility lower)

export const minutesOf = (a) => (Number(a?.durationSecs) || 0) / 60 || Number(a?.durationMins) || 0;

// Which discipline family an activity ACTUALLY belongs to.
export function actualFamilyOf(a) {
  return isRun(a)      ? 'run'
       : isCycling(a)  ? 'cycle'
       : isSwim(a)     ? 'swim'
       : isSki(a)      ? 'ski'
       : isStrength(a) ? 'strength'
       : isHIIT(a)     ? 'hiit'
       : isWalk(a)     ? 'walk'
       : isMobility(a) ? 'mobility'
       : 'cross';
}

/**
 * Resolve today's canonical workout status from the actual activity record + the
 * plan. Reflects WHAT HAPPENED, never just what was planned.
 *
 * @returns {{
 *   today, plannedType, plannedFamily, plannedLabel,
 *   primary, actualFamily, actualLabel,
 *   done, matchedPlan, offPlan, isRest,
 *   label
 * }}
 *   - done       : a qualifying workout actually happened (>=20 min non-mobility,
 *                  or a plan-matching session; mobility counts for a mobility plan)
 *   - matchedPlan: the qualifying session matches the planned discipline
 *   - offPlan    : a real workout happened that ISN'T the planned discipline
 *                  (covers "planned run, did a ride" AND "no plan, did a ride")
 *   - isRest     : planned rest (or no plan) AND nothing qualifying was done
 *   - label      : the canonical display string every surface should show, e.g.
 *                  "Easy run" · "Cycling" · "Off-plan · Cycling" · "Rest day"
 */
export function resolveTodayStatus({ activities = [], planned = null, today = localDate(), minMinutes = MIN_PROMOTE_MINUTES } = {}) {
  const todayActs = (activities || []).filter(a => (a?.date || '').startsWith(today));
  const sessions = todayActs.filter(a => minutesOf(a) > 0);
  const nonMob = sessions.filter(a => !isMobility(a));
  const primary = (nonMob.length ? nonMob : sessions)
    .sort((a, b) => minutesOf(b) - minutesOf(a))[0] || null;

  // Multi-session view: ALL of today's sessions, annotated + sorted longest-first.
  // `primary` stays the single headline; `secondaries` is everything else; `multi`
  // is true when ≥2 meaningful (non-mobility ≥ minMinutes) sessions happened — the
  // two-a-day case. Surfaces should render primary + secondaries instead of hiding
  // the rest. Additive: every existing field below is unchanged.
  const sessionViews = [...sessions]
    .sort((a, b) => minutesOf(b) - minutesOf(a))
    .map(a => {
      const fam = actualFamilyOf(a);
      const mins = minutesOf(a);
      return {
        activity: a,
        family: fam,
        label: FAMILY_LABEL[fam] || 'Workout',
        minutes: mins,
        meaningful: !isMobility(a) && mins >= minMinutes,
      };
    });
  const secondaries = sessionViews.filter(s => s.activity !== primary);
  const multi = sessionViews.filter(s => s.meaningful).length >= 2;

  const plannedType = planned?.type || null;
  const plannedFamily = plannedType ? (PLAN_TYPE_FAMILY[plannedType] || null) : null;
  const plannedLabel = plannedType ? (PLAN_TYPE_LABEL[plannedType] || plannedType) : null;

  const actualFamily = primary ? actualFamilyOf(primary) : null;
  const primaryMins = primary ? minutesOf(primary) : 0;

  // "Meaningful" = a real, non-mobility session of decent length.
  const meaningful = !!primary && !isMobility(primary) && primaryMins >= minMinutes;
  // Plan satisfied: same discipline as planned, with a sensible duration floor
  // (mobility plans are often short, so a lower bar there).
  const matchedPlan = !!primary && !!plannedFamily && plannedFamily !== 'rest'
    && actualFamily === plannedFamily
    && (plannedFamily === 'mobility' ? primaryMins >= 5 : primaryMins >= minMinutes);

  const done = meaningful || matchedPlan;
  const offPlan = done && !matchedPlan;
  const isRest = !done && (!plannedType || plannedType === 'rest');

  let label;
  if (done) {
    if (matchedPlan) {
      label = plannedLabel;                                  // did the planned thing
    } else if (plannedFamily && plannedFamily !== 'rest') {
      label = `Off-plan · ${FAMILY_LABEL[actualFamily] || 'Workout'}`; // planned X, did Y
    } else {
      label = FAMILY_LABEL[actualFamily] || 'Workout';       // nothing planned, did Y
    }
  } else if (plannedType && plannedType !== 'rest') {
    label = plannedLabel;                                    // planned, not done yet
  } else {
    label = 'Rest day';                                      // rest / open day, nothing done
  }

  return {
    today, plannedType, plannedFamily, plannedLabel,
    primary, actualFamily, actualLabel: actualFamily ? (FAMILY_LABEL[actualFamily] || null) : null,
    done, matchedPlan, offPlan, isRest, label,
    sessions: sessionViews, secondaries, multi,
  };
}
