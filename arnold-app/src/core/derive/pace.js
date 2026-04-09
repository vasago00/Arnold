// ─── Pace conversions ────────────────────────────────────────────────────────

import { parseTimeStr } from './time.js';

// "9:30" or "9:30/mi" → seconds per mile
export function paceToSecs(v) {
  if (!v) return null;
  return parseTimeStr(String(v).split('/')[0]);
}

// seconds → "m:ss" pace string
export function secsToPace(s) {
  if (s == null || isNaN(s)) return null;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Pace as a fraction of goal (≥1.0 means at-or-better).
// Returns null when either side is missing.
export function pacePct(actual, goal) {
  const a = paceToSecs(actual);
  const g = paceToSecs(goal);
  if (a == null || g == null || a === 0) return null;
  return Math.min(g / a, 1);
}
