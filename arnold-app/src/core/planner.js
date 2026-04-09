// ─── ARNOLD Weekly Planner ───────────────────────────────────────────────────
// Stores planned training week-by-week. Keyed by Monday-aligned ISO date.
// Pure data layer; UI lives in components/WeeklyPlanner.jsx.

import { storage } from "./storage.js";
import { weekStart } from "./derive/volume.js";

// ─── ISO week key ────────────────────────────────────────────────────────────
export function weekKey(date = new Date()) {
  return weekStart(date).toISOString().slice(0, 10);
}

export function nextWeekKey(date = new Date()) {
  const ws = weekStart(date);
  ws.setDate(ws.getDate() + 7);
  return ws.toISOString().slice(0, 10);
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
