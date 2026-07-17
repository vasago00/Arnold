// planWeekSummary (Sprint 3, Task #32) — a compact glance at the CURRENT week of
// the living plan, for the mobile home summary strip. Reads the APPLIED planner
// week (what LivingPlan pasted onto the calendar) so the strip stays in sync with
// the calendar — it does NOT re-generate a plan.
//
// Returns the week's day-by-day "headline" session (its shape), the planned
// totals, and the next KEY session (long run / quality / race) from today
// forward — the one piece neither the "This Week" (actual volume) nor the
// "Marathon Coach" (verdict/targets) card already shows.
//
// Pure aside from the planner storage read (via getPlannerWeek). Node-testable
// by seeding storage; the strip component is dumb presentation on top.

import {
  getPlannerWeek, weekKey, nextWeekKey, daySessions, weekPlanTotals, DAY_LABELS,
} from './planner.js';
import { storage } from './storage.js';
import { isRun } from './activityClass.js';

// Recovery days = rest OR mobility (athlete's choice, per the plan's unified
// "Recovery" model). They're flexible: skipping one (resting) is a valid choice,
// so they are NEVER "missed"; only a real RUN/strength on one reads as off-plan.
const RECOVERY_TYPES = new Set(['rest', 'mobility', 'walk', 'recovery']);

// Monday-anchored week start + day offset → ISO date (noon-safe, matches how the
// planner and GoalsHub derive planner-day dates).
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The day's single "headline" session — the hardest/most defining one, so the
// strip shows one glyph per day. Priority: race > long > intervals/hiit > tempo >
// easy > strength-only > recovery.
const HEADLINE_PRIORITY = [
  'race', 'long_run', 'intervals', 'hiit', 'tempo',
  'easy_run', 'cross', 'cycle', 'swim', 'ski', 'strength', 'mobility', 'walk',
];

export function dayHeadline(day) {
  const types = daySessions(day).map(s => s.type);
  if (!types.length) return 'rest';
  for (const t of HEADLINE_PRIORITY) if (types.includes(t)) return t;
  return types[0];
}

// Sessions that count as a "key" session worth surfacing as next-up.
const KEY_TYPES = new Set(['long_run', 'tempo', 'intervals', 'hiit', 'race']);

// Monday-anchored day index for a date (Mon=0 … Sun=6).
function dowIndex(date) {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

function findKey(days, fromIdx) {
  for (let i = fromIdx; i < 7; i++) {
    const key = daySessions(days[i]).find(s => KEY_TYPES.has(s.type));
    if (key) return { idx: i, session: key };
  }
  return null;
}

// PURE core — takes the two week objects + today's Monday-index and returns the
// summary. No storage/DOM, so it's node-testable by passing plain week records.
// `executedDates` (Set/array of ISO dates with a logged activity) drives per-day
// status: done / missed / off-plan.
export function buildPlanWeekSummary({ week, nextWeek = null, todayIdx = 0, weekStart = null, executedDates = [] }) {
  const rawDays = (week?.days || []).slice(0, 7);
  const tIdx = Math.max(0, Math.min(6, todayIdx));
  const execSet = executedDates instanceof Set ? executedDates : new Set(executedDates || []);

  const days = rawDays.map((d, i) => {
    const type = dayHeadline(d);
    const isToday = i === tIdx, isPast = i < tIdx;
    const iso = weekStart ? addDaysISO(weekStart, i) : null;
    const executed = iso ? execSet.has(iso) : false;   // a RUN / strength was logged
    const isRecovery = RECOVERY_TYPES.has(type);
    // status: today (ring) · done (past load day + executed) · missed (past LOAD
    // day, nothing logged) · offplan (past recovery day but a run/strength was
    // logged) · rest (recovery day, flexible — never "missed") · upcoming (future).
    let status;
    if (isToday) status = 'today';
    else if (!isPast) status = isRecovery ? 'rest' : 'upcoming';
    else if (isRecovery) status = executed ? 'offplan' : 'rest';   // recovery is optional
    else status = executed ? 'done' : 'missed';                    // load day
    return { idx: i, label: DAY_LABELS[i], type, isToday, isPast, executed, status };
  });

  const totals = weekPlanTotals(week || {});
  const hasPlan = totals.sessions > 0;

  // Next KEY session: today forward this week, then roll into next week.
  let nextKey = null;
  const hit = findKey(rawDays, tIdx);
  if (hit) {
    nextKey = {
      type: hit.session.type,
      dow: DAY_LABELS[hit.idx],
      distanceMi: Number(hit.session.distanceMi) || null,
      when: hit.idx === tIdx ? 'today' : 'this-week',
    };
  } else if (nextWeek) {
    const nHit = findKey((nextWeek.days || []).slice(0, 7), 0);
    if (nHit) {
      nextKey = {
        type: nHit.session.type,
        dow: DAY_LABELS[nHit.idx],
        distanceMi: Number(nHit.session.distanceMi) || null,
        when: 'next-week',
      };
    }
  }

  return { weekStart, days, totals, hasPlan, nextKey };
}

// Storage wrapper — reads the applied planner weeks and delegates to the pure core.
// `date` defaults to now (injectable for tests / date changes).
export function summarizePlanWeek(date = new Date()) {
  const d0 = date instanceof Date ? date : new Date(date);
  const wkStart = weekKey(d0);
  return buildPlanWeekSummary({
    week: getPlannerWeek(wkStart),
    nextWeek: getPlannerWeek(nextWeekKey(d0)),
    todayIdx: dowIndex(d0),
    weekStart: wkStart,
    executedDates: executedDatesForWeek(wkStart),
  });
}

// Dates in this week (Mon..Sun) that had a REAL training session — a run in the
// activities store OR a strength session in the workouts store. Deliberately
// excludes non-run activities (mobility/walk) so doing mobility on a recovery day
// doesn't read as off-plan. Drives done/missed/off-plan. Best-effort.
function executedDatesForWeek(weekStart) {
  const set = new Set();
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)));
  try { for (const a of (storage.get('activities') || [])) if (a?.date && weekDates.has(a.date) && isRun(a)) set.add(a.date); } catch { /* ignore */ }
  try { for (const w of (storage.get('workouts') || [])) if (w?.date && weekDates.has(w.date)) set.add(w.date); } catch { /* ignore */ }
  return set;
}

// A short human label for the next-key session, e.g. "Sat · 18 mi long run".
const KEY_LABEL = {
  long_run: 'long run', tempo: 'tempo', intervals: 'intervals', hiit: 'HIIT', race: 'race',
};
export function nextKeyLabel(nextKey) {
  if (!nextKey) return null;
  const name = KEY_LABEL[nextKey.type] || nextKey.type;
  const mi = nextKey.distanceMi ? `${nextKey.distanceMi} mi ` : '';
  const when = nextKey.when === 'today' ? 'Today' : nextKey.dow;
  return `${when} ${mi}${name}`;
}

export default summarizePlanWeek;
