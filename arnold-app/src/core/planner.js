// ─── ARNOLD Weekly Planner ───────────────────────────────────────────────────
// Stores planned training week-by-week. Keyed by Monday-aligned ISO date.
// Pure data layer; UI lives in components/WeeklyPlanner.jsx.

import { storage } from "./storage.js";
import { weekStart } from "./derive/volume.js";

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ─── ISO week key ────────────────────────────────────────────────────────────
export function weekKey(date = new Date()) {
  return localDate(weekStart(date));
}

export function nextWeekKey(date = new Date()) {
  const ws = weekStart(date);
  ws.setDate(ws.getDate() + 7);
  return localDate(ws);
}

// ─── Day record ──────────────────────────────────────────────────────────────
// { type: 'easy_run' | 'long_run' | 'tempo' | 'intervals' | 'strength' | 'rest' | 'cross' | 'race',
//   distanceMi?: number, durationMin?: number, intensity?: 'easy'|'mod'|'hard',
//   notes?: string }

export const DAY_TYPES = [
  { id: 'easy_run',  label: 'Easy run',     color: '#60a5fa', icon: '◷' },
  { id: 'long_run',  label: 'Long run',     color: '#3b82f6', icon: '◐' },
  { id: 'tempo',     label: 'Tempo',        color: '#fbbf24', icon: '▲' },
  { id: 'intervals', label: 'Intervals',    color: '#f87171', icon: '⫽' },
  { id: 'strength',  label: 'Strength',     color: '#a78bfa', icon: '◈' },
  { id: 'hiit',      label: 'HIIT',         color: '#fb7185', icon: '⚡' },
  { id: 'mobility',  label: 'Mobility',     color: '#5eead4', icon: '◍' },
  { id: 'cross',     label: 'Cross-train',  color: '#34d399', icon: '◇' },
  { id: 'rest',      label: 'Rest',         color: '#6b7280', icon: '○' },
  { id: 'race',      label: 'Race',         color: '#ef4444', icon: '★' },
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

  const isRest = planned.type === 'rest';
  if (isRest) return { completed: !hasAny, hasAny };
  if (!hasAny) return { completed: false, hasAny: false };

  const pt = planned.type || '';
  const logHasType = (l, re) => logFits(l).some(fd => re.test(fd?.activityType || fd?.type || ''))
    || re.test(l.workout || '')
    || re.test(l.type || '');

  const hasRun = todayActs.some(a => /run/i.test(a.activityType || ''))
    || todayWkts.some(w => /run/i.test(w.type || ''))
    || todayLogs.some(l => logHasType(l, /run/i));
  const hasStrength = todayActs.some(a => /strength|weight/i.test(a.activityType || ''))
    || todayWkts.some(w => /strength/i.test(w.type || ''))
    || todayLogs.some(l => logHasType(l, /strength|weight/i));

  if (/run|tempo|interval|long/.test(pt) && hasRun) return { completed: true, hasAny };
  if (/strength/.test(pt) && hasStrength) return { completed: true, hasAny };

  // Fallback: any activity counts as completion for non-specific plan types
  return { completed: hasAny, hasAny };
}
