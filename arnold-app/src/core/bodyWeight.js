// Canonical "true body weight" selector — ONE source of truth (Emil 2026-06-17).
// A weigh-in counts toward the body-weight trend (weight tile, RMR/body-comp,
// EdgeIQ) only if it's MORNING-FASTED. Post-workout / intraday readings are
// dehydrated; they understate weight + inflate the loss slope ("phantom cuts")
// and belong to the sweat/hydration path, not here.
//
// A reading is NOT fasted if any of:
//   • its source is a known post-workout source, OR
//   • it is timed AND falls at/after a workout logged that same day (robust:
//     "after a workout" = post-workout, even for an early-morning session), OR
//   • it is timed at/after the 10:00 morning cutoff.
// Untimed readings are treated as fasted (a plain morning weigh-in). Days with
// no fasted reading are omitted, so a post-workout-only day never becomes a data
// point — the trend falls back to the last genuinely fasted day.
import { storage } from './storage.js';

const LB_PER_KG = 2.20462;
export const MORNING_CUTOFF_HOUR = 10;
const NON_FASTED_SOURCES = new Set(['post-run', 'post-workout']);

function lbsOf(r) {
  const v = Number(r?.weightLbs ?? r?.lbs ?? r?.value);
  if (Number.isFinite(v) && v > 0) return v;
  const kg = Number(r?.weightKg);
  return Number.isFinite(kg) && kg > 0 ? kg * LB_PER_KG : null;
}
function toMinutes(v) {
  if (v == null) return null;
  let m = String(v).match(/^(\d{1,2}):(\d{2})/);          // 'HH:MM'
  if (!m) m = String(v).match(/T(\d{2}):(\d{2})/);         // ISO 'YYYY-MM-DDTHH:MM'
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}
function minutesOfDay(r) { return toMinutes(r?.time); }

// Earliest workout start (minutes of day) per date.
function workoutStartByDate(activities) {
  const out = {};
  for (const a of (activities || [])) {
    const d = a?.date; if (!d) continue;
    const m = toMinutes(a.startTimeLocal || a.startTime);
    if (m == null) continue;
    if (out[d] == null || m < out[d]) out[d] = m;
  }
  return out;
}

export function isFastedWeight(r, workoutStartMin) {
  if (!r || NON_FASTED_SOURCES.has(r.source)) return false;
  if (lbsOf(r) == null) return false;
  const m = minutesOfDay(r);
  if (m != null && workoutStartMin != null && m >= workoutStartMin) return false; // after a workout → post-workout
  return m == null || m < MORNING_CUTOFF_HOUR * 60;
}

// One fasted reading per date (earliest). Reads activities (for the post-workout
// correlation) from storage unless opts.activities is supplied.
export function morningWeightRows(rows, opts = {}) {
  const activities = opts.activities !== undefined ? opts.activities : (storage.get('activities') || []);
  const wStart = workoutStartByDate(activities);
  const byDate = {};
  for (const r of (rows || [])) {
    if (!r?.date || !isFastedWeight(r, wStart[r.date])) continue;
    const m = minutesOfDay(r) ?? 9999;
    const ex = byDate[r.date];
    if (!ex || m < ex.m) byDate[r.date] = { row: r, m };
  }
  return Object.values(byDate).map(v => v.row);
}

// Current true body weight (lbs): most recent fasted day. null if none.
export function currentTrueWeightLbs(rows, opts = {}) {
  const src = rows || storage.get('weight') || [];
  const days = morningWeightRows(src, opts)
    .map(r => ({ date: r.date, lbs: lbsOf(r) }))
    .filter(d => d.date && d.lbs)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return days.length ? days[0].lbs : null;
}

// Console diagnostic: run `window.weightDebug()` in devtools to see every weigh-in
// row, whether it counts as fasted (and why), and the resolved true weight.
if (typeof window !== 'undefined') {
  window.weightDebug = function weightDebug() {
    const rows = storage.get('weight') || [];
    const activities = storage.get('activities') || [];
    const wStart = {};
    for (const a of activities) {
      const d = a?.date; if (!d) continue;
      const t = (a.startTimeLocal || a.startTime || '').match(/T?(\d{2}):(\d{2})/);
      const m = t ? parseInt(t[1], 10) * 60 + parseInt(t[2], 10) : null;
      if (m != null && (wStart[d] == null || m < wStart[d])) wStart[d] = m;
    }
    const table = [...rows]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.time || '').localeCompare(a.time || ''))
      .slice(0, 20)
      .map(r => ({
        date: r.date, time: r.time || '(none)', lbs: r.weightLbs ?? r.weightKg, source: r.source || '(none)',
        workoutStart: wStart[r.date] != null ? `${String(Math.floor(wStart[r.date]/60)).padStart(2,'0')}:${String(wStart[r.date]%60).padStart(2,'0')}` : '—',
        fasted: isFastedWeight(r, wStart[r.date]),
      }));
    console.log('%cWeigh-ins (newest 20) — fasted=true counts toward body weight', 'font-weight:bold');
    console.table(table);
    console.log('Resolved TRUE body weight (lbs):', currentTrueWeightLbs(rows));
    return currentTrueWeightLbs(rows);
  };
}
