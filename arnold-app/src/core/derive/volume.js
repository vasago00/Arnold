// ─── Training volume aggregations ────────────────────────────────────────────
// Pure functions over the activities array. All take ISO date strings or
// Date objects and tolerate missing fields gracefully.

import { isRun, isStrength } from '../activityClass.js';

// Get the Monday-aligned start of the week containing `date` (default: today).
export function weekStart(date = new Date()) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Filter activities to those between [start, end] inclusive.
function inRange(activities, start, end) {
  return activities.filter(a => {
    if (!a?.date) return false;
    const d = new Date(a.date + 'T12:00:00');
    return d >= start && d <= end;
  });
}

// Weekly run miles + sessions for the week containing `date`.
export function weeklyRunVolume(activities, date = new Date()) {
  const start = weekStart(date);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  const runs = inRange(activities, start, end).filter(isRun);
  const miles = runs.reduce((s, a) => s + (a.distanceMi || 0), 0);
  const minutes = runs.reduce((s, a) => s + (a.durationSecs || 0), 0) / 60;
  return { sessions: runs.length, miles, minutes };
}

// Weekly strength sessions + minutes
export function weeklyStrengthVolume(activities, date = new Date()) {
  const start = weekStart(date);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  const strength = inRange(activities, start, end).filter(isStrength);
  const minutes = strength.reduce((s, a) => s + (a.durationSecs || 0), 0) / 60;
  return { sessions: strength.length, minutes };
}

// Year-to-date totals (runs + workouts).
export function ytdVolume(activities, year = new Date().getFullYear()) {
  const yearActs = activities.filter(a => a?.date?.startsWith(String(year)));
  const runs = yearActs.filter(isRun);
  const totalMiles = runs.reduce((s, a) => s + (a.distanceMi || 0), 0);
  return {
    runs: runs.length,
    workouts: yearActs.length,
    totalMiles,
    avgMilesPerRun: runs.length ? totalMiles / runs.length : 0,
  };
}

// Helper exports for callers that want the same predicates
export const runs_ = isRun;
export const strength_ = isStrength;
