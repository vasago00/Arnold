// ─── ARNOLD Weekly Planner ───────────────────────────────────────────────────
// Stores planned training week-by-week. Keyed by Monday-aligned ISO date.
// Pure data layer; UI lives in components/WeeklyPlanner.jsx.

import { storage } from "./storage.js";
import { weekStart } from "./derive/volume.js";
import { isRun, isStrength } from "./activityClass.js";
import { localDate, ymd } from "./time.js";
import { CATEGORY } from "../theme/tokens.js";

// ─── ISO week key ────────────────────────────────────────────────────────────
export function weekKey(date = new Date()) {
  return ymd(weekStart(date));
}

export function nextWeekKey(date = new Date()) {
  const ws = weekStart(date);
  ws.setDate(ws.getDate() + 7);
  return ymd(ws);
}

// ─── Day record ──────────────────────────────────────────────────────────────
// { type: 'easy_run' | 'long_run' | 'tempo' | 'intervals' | 'strength' | 'rest' | 'cross' | 'race',
//   distanceMi?: number, durationMin?: number, intensity?: 'easy'|'mod'|'hard',
//   notes?: string }

// Phase 0.1 — colors sourced from src/theme/tokens.js (CATEGORY). Values unchanged.
export const DAY_TYPES = [
  { id: 'easy_run',  label: 'Easy run',     color: CATEGORY.easy_run,  icon: '◷' },
  { id: 'long_run',  label: 'Long run',     color: CATEGORY.long_run,  icon: '◐' },
  { id: 'tempo',     label: 'Tempo',        color: CATEGORY.tempo,     icon: '▲' },
  { id: 'intervals', label: 'Intervals',    color: CATEGORY.intervals, icon: '⫽' },
  { id: 'strength',  label: 'Strength',     color: CATEGORY.strength,  icon: '◈' },
  { id: 'hiit',      label: 'HIIT',         color: CATEGORY.hiit,      icon: '⚡' },
  { id: 'mobility',  label: 'Mobility',     color: CATEGORY.mobility,  icon: '◍' },
  { id: 'cross',     label: 'Cross-train',  color: CATEGORY.cross,     icon: '◇' },
  { id: 'cycle',     label: 'Cycling',      color: CATEGORY.cycle,     icon: '◉' },
  { id: 'swim',      label: 'Swim',         color: CATEGORY.swim,      icon: '≈' },
  { id: 'ski',       label: 'Ski',          color: CATEGORY.ski,       icon: '❄' },
  { id: 'walk',      label: 'Walk/Hike',    color: CATEGORY.walk,      icon: '⛰' },
  { id: 'rest',      label: 'Rest',         color: CATEGORY.rest,      icon: '○' },
  { id: 'race',      label: 'Race',         color: CATEGORY.race,      icon: '★' },
];

export const DAY_LABELS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ─── Templates ───────────────────────────────────────────────────────────────
export const TEMPLATES = {
  base_week: {
    label: 'Base week',
    days: [
      { type: 'easy_run',  distanceMi: 4 },
      { type: 'strength' },
      { type: 'easy_run',  distanceMi: 4 },
      { type: 'tempo',     distanceMi: 5 },
      { type: 'rest' },
      { type: 'long_run',  distanceMi: 8 },
      { type: 'strength' },
    ],
  },
  build_week: {
    label: 'Build week',
    days: [
      { type: 'easy_run',  distanceMi: 5 },
      { type: 'strength' },
      { type: 'intervals', distanceMi: 5 },
      { type: 'easy_run',  distanceMi: 4 },
      { type: 'rest' },
      { type: 'long_run',  distanceMi: 10 },
      { type: 'strength' },
    ],
  },
  taper_week: {
    label: 'Race taper',
    days: [
      { type: 'easy_run',  distanceMi: 3 },
      { type: 'tempo',     distanceMi: 3 },
      { type: 'rest' },
      { type: 'easy_run',  distanceMi: 2 },
      { type: 'rest' },
      { type: 'race' },
      { type: 'easy_run',  distanceMi: 2 },
    ],
  },
  deload_week: {
    label: 'Deload',
    days: [
      { type: 'easy_run',  distanceMi: 3 },
      { type: 'rest' },
      { type: 'easy_run',  distanceMi: 3 },
      { type: 'cross' },
      { type: 'rest' },
      { type: 'easy_run',  distanceMi: 5 },
      { type: 'rest' },
    ],
  },
};

// ─── Read/write ──────────────────────────────────────────────────────────────
export function getPlannerWeek(weekKeyStr) {
  const all = storage.get('planner') || {};
  return all[weekKeyStr] || { weekStart: weekKeyStr, days: Array(7).fill(null).map(() => ({ type: 'rest' })) };
}

export function savePlannerWeek(weekKeyStr, week) {
  const all = storage.get('planner') || {};
  all[weekKeyStr] = { ...week, weekStart: weekKeyStr, updatedAt: Date.now() };
  storage.set('planner', all, { skipValidation: true });
  return all[weekKeyStr];
}

export function applyTemplate(weekKeyStr, templateId) {
  const tpl = TEMPLATES[templateId];
  if (!tpl) return null;
  return savePlannerWeek(weekKeyStr, { weekStart: weekKeyStr, days: tpl.days.map(d => ({ ...d })) });
}


// ─── Multi-session model (Emil 2026-06-17) ──────────────────────────────────
// A day can hold MULTIPLE planned sessions (hybrid athletes: run + strength +
// core). New shape: day = { sessions: [{ type, distanceMi?, durationMin?,
// slot?: 'AM'|'PM'|'EVE' }] }. Legacy shape (one { type, ... } per day) is still
// read transparently via daySessions() so old stored weeks keep working.
const SESSION_RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'race']);

// Normalize a day record (legacy OR new) → array of real sessions (rest excluded).
export function daySessions(day) {
  if (!day) return [];
  if (Array.isArray(day.sessions)) return day.sessions.filter(s => s && s.type && s.type !== 'rest');
  return (day.type && day.type !== 'rest') ? [{ ...day }] : [];
}

// A planned rest day = no real sessions.
export function dayIsRest(day) {
  return daySessions(day).length === 0;
}

// Sum of planned run miles across all run-type sessions that day.
export function dayRunMiles(day) {
  return daySessions(day).reduce((mi, s) =>
    mi + (SESSION_RUN_TYPES.has(s.type) ? (Number(s.distanceMi) || 0) : 0), 0);
}

// Count of planned sessions that day (rest = 0).
export function dayWorkoutCount(day) {
  return daySessions(day).length;
}

// Build a day record from a sessions array. Stores `sessions` for multi-session
// readers AND mirrors the PRIMARY session as legacy `type`/`distanceMi` so the
// many existing `.type` readers (drawer, day cells, coach) keep working until they
// migrate to daySessions(). Empty → rest.
export function makeDay(sessions) {
  const real = (sessions || []).filter(s => s && s.type && s.type !== 'rest');
  const primary = real[0] || null;
  const out = { sessions: real, type: primary ? primary.type : 'rest' };
  if (primary && Number(primary.distanceMi) > 0) out.distanceMi = Number(primary.distanceMi);
  return out;
}

// Week totals — planned run miles + session count across the 7 days. Powers the
// calendar "totals" column (#2) and on-track read.
export function weekPlanTotals(week) {
  const days = week?.days || [];
  return days.reduce((acc, d) => {
    acc.runMiles += dayRunMiles(d);
    acc.sessions += dayWorkoutCount(d);
    return acc;
  }, { runMiles: 0, sessions: 0 });
}

// ─── Lookup helpers ──────────────────────────────────────────────────────────
// Get today's planned entry from the current week (or null if no plan).
export function todayPlanned(date = new Date()) {
  const wk = getPlannerWeek(weekKey(date));
  const d = new Date(date);
  const dow = d.getDay();
  const idx = dow === 0 ? 6 : dow - 1; // Mon=0, Sun=6
  return wk.days?.[idx] || null;
}

// ─── Plan completion check (3-store merge) ──────────────────────────────────
// Checks garmin-activities, workouts, and daily-logs to determine if today's
// planned session was completed. Returns { completed: bool, hasAny: bool }.
// Previously duplicated in Arnold.jsx (~line 2917) and MobileHome.jsx (~line 542).
export function checkTodayCompletion(dateStr, planned) {
  if (!planned) return { completed: false, hasAny: false };

  const activities = storage.get('activities') || [];
  const workouts = storage.get('workouts') || [];
  const dailyLogs = storage.get('dailyLogs') || [];

  const todayActs = activities.filter(a => a.date === dateStr);
  const todayWkts = workouts.filter(w => w.date === dateStr);
  const todayLogs = dailyLogs.filter(l => l.date === dateStr);

  // Flatten each day-log's FIT activities (new `fitActivities` array, or legacy single `fitData`)
  const logFits = l => (Array.isArray(l.fitActivities) && l.fitActivities.length
    ? l.fitActivities
    : (l.fitData ? [l.fitData] : []));
  const todayHasLog = todayLogs.some(l => logFits(l).length > 0 || l.workout || l.distanceMi || l.duration);
  const hasAny = todayActs.length > 0 || todayWkts.length > 0 || todayHasLog;

  // Multi-session aware: a day is "complete" when every planned modality (run /
  // strength) that was scheduled has a matching logged activity. Rest = no sessions.
  const sessions = daySessions(planned);
  if (sessions.length === 0) return { completed: !hasAny, hasAny };
  if (!hasAny) return { completed: false, hasAny: false };

  const logHasType = (l, re) => logFits(l).some(fd => re.test(fd?.activityType || fd?.type || ''))
    || re.test(l.workout || '')
    || re.test(l.type || '');

  // Use canonical classifiers — HIIT runs count as runs here so a planned
  // HIIT slot matches a Garmin Fartlek/interval run.
  const hasRun = todayActs.some(isRun)
    || todayWkts.some(w => /run/i.test(w.type || ''))
    || todayLogs.some(l => logHasType(l, /run/i));
  const hasStrength = todayActs.some(isStrength)
    || todayWkts.some(w => /strength/i.test(w.type || ''))
    || todayLogs.some(l => logHasType(l, /strength|weight/i));

  const wantRun      = sessions.some(s => /run|tempo|interval|long|race/.test(s.type || ''));
  const wantStrength = sessions.some(s => /strength/.test(s.type || ''));
  if (wantRun && !hasRun) return { completed: false, hasAny };
  if (wantStrength && !hasStrength) return { completed: false, hasAny };
  if (wantRun || wantStrength) return { completed: true, hasAny };

  // Fallback: any activity counts as completion for non-specific plan types
  return { completed: hasAny, hasAny };
}
