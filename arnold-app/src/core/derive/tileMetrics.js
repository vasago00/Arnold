// ─── Start-Screen Tile Metric Registry (Phase 4b) ──────────────────────────
// Single source of truth for every metric the user can choose to display on
// their Start screen. Each entry is a self-contained record:
//
//   id        — stable string identifier; persisted in storage('startTilePrefs')
//   label     — short user-facing name shown in the tile + the picker
//   category  — 'run' | 'strength' | 'recovery' | 'body'
//   unit      — display unit ('mi', 'bpm', 'g', '%', etc.) or '' if none
//   compute   — (ctx) => { value, sublabel?, color?, sparkline?, hrZones? }
//               returns null if no data yet. ctx has the same shape every
//               metric receives (see buildTileContext below).
//   available — (ctx) => boolean
//               returns true if there's enough data for this metric to be
//               meaningful. Used by the picker to grey out "no data yet"
//               options. Defaults to "compute returned non-null".
//   trendOf   — optional. (ctx) => number — comparable older value for the
//               trend arrow. Tile component computes ↑/↓/→ + delta.
//
// Adding a new metric: write one entry. The picker, the tile renderer, and
// cross-device sync all pick it up automatically.

import { canonicalActivityType } from '../dcyMath.js';
import { isRun, isStrength as isStrengthAct } from '../activityClass.js';
import { timeframesFromCollection, aggregateTimeframes } from './kriAggregate.js';
// Phase 4r.dataspine.4 — Migrated from legacy resolveCalorieTarget to
// the canonical Layer 3 reader getEffectiveTargets (see DATAMODEL.md).
// resolveCalorieTarget is now deprecated/deleted.
import { getEffectiveTargets } from '../goalModel.js';

// Phase 4m.2.7 — VDOT race-time predictor (Jack Daniels' lookup table).
// Used by the Race Predictor metric as a fallback when Garmin doesn't
// emit its own predicted-time block but does emit vO2MaxValue (most
// modern watches do — Forerunner 2xx/9xx, Fenix, Epix, Venu).
//
// Each row is [VDOT, t5k_secs, t10k_secs, tHM_secs, tM_secs]. Values are
// pulled directly from Daniels' published tables (Daniels' Running
// Formula, 4th ed.). Linear interpolation between adjacent rows handles
// non-integer VDOT values cleanly within ±2s of higher-order fits.
const _VDOT_TABLE = [
  [30, 1840, 3826,  8464, 17357],   // 30:40 / 63:46 / 2:21:04 / 4:49:17
  [35, 1552, 3209,  7041, 14431],   // 25:52 / 53:29 / 1:57:21 / 4:00:31
  [40, 1335, 2774,  6080, 12416],   // 22:15 / 46:14 / 1:41:20 / 3:26:56
  [45, 1165, 2429,  5334, 10891],   // 19:25 / 40:29 / 1:28:54 / 3:01:31
  [50, 1034, 2154,  4740,  9668],   // 17:14 / 35:54 / 1:19:00 / 2:41:08
  [55,  929, 1937,  4260,  8684],   // 15:29 / 32:17 / 1:11:00 / 2:24:44
  [60,  843, 1758,  3863,  7892],   // 14:03 / 29:18 / 1:04:23 / 2:11:32
  [65,  771, 1608,  3528,  7225],   // 12:51 / 26:48 /   58:48  / 2:00:25
  [70,  710, 1483,  3240,  6659],   // 11:50 / 24:43 /   54:00  / 1:50:59
];
const _VDOT_FIELD_IDX = { t5k: 1, t10k: 2, tHM: 3, tM: 4 };

export function predictFromVDOT(vdot, field) {
  if (vdot == null || !Number.isFinite(vdot)) return null;
  const idx = _VDOT_FIELD_IDX[field];
  if (!idx) return null;
  if (vdot <= _VDOT_TABLE[0][0]) return _VDOT_TABLE[0][idx];
  if (vdot >= _VDOT_TABLE[_VDOT_TABLE.length - 1][0]) return _VDOT_TABLE[_VDOT_TABLE.length - 1][idx];
  for (let i = 0; i < _VDOT_TABLE.length - 1; i++) {
    const v0 = _VDOT_TABLE[i][0];
    const v1 = _VDOT_TABLE[i + 1][0];
    if (vdot >= v0 && vdot <= v1) {
      const t0 = _VDOT_TABLE[i][idx];
      const t1 = _VDOT_TABLE[i + 1][idx];
      const ratio = (vdot - v0) / (v1 - v0);
      return Math.round(t0 + (t1 - t0) * ratio);
    }
  }
  return null;
}

// Phase 4m.2.9 — Riegel's race-time predictor.
// Peer-reviewed formula (Pete Riegel, American Scientist, 1981):
//
//     T₂ = T₁ × (D₂ / D₁)^1.06
//
// Where T₁/D₁ = a recent run's time/distance, T₂/D₂ = predicted time at the
// target distance. The 1.06 exponent has been validated and gently refined
// across studies (Vickers & Vertosick 2016 published a population-fit value
// of ~1.07); we use the original 1.06.
//
// Compared to VDOT, Riegel naturally reflects current training state because
// the anchor IS your current state. No "VO2max ceiling vs. race-day reality"
// gap to calibrate — what you've been running is what you're forecasted on.
//
// Quality filter: anchor run must be ≥ 3 mi and ≥ 15 minutes. Excludes
// warmups, sprint reps, and casual short runs that would over-extrapolate
// (e.g. predicting a half-marathon from a 1-mile sprint is meaningless).
export function riegelPredictFromRun(run, field) {
  if (!run) return null;
  const D1mi = Number(run.distanceMi || run.distance_mi);
  if (!D1mi || D1mi < 3) return null;
  const T1 = Number(run.durationSecs);
  if (!T1 || T1 < 15 * 60) return null;
  const D1km = D1mi * 1.60934;
  const D2km = _FIELD_TO_KM[field];
  if (!D2km) return null;
  return Math.round(T1 * Math.pow(D2km / D1km, 1.06));
}

// Phase 4r.race.1 — find the best empirical anchor for race-time projection.
// Replaces the previous "use Garmin's racePredictor raw" approach, which is
// driven by VO2max and routinely under-predicts trained runners by 5-20%.
// User reported a HM finish ~25-30 min faster than the tile's prediction.
//
// Priority chain (highest evidence first):
//   1. Race effort at a standard distance — distance within ±5% of 5K/10K/HM/M
//      AND (avg pace was demonstrably fast OR avg HR was in threshold/race zone).
//      Window: last 24 weeks. Bias toward most-recent if multiple qualify.
//   2. Quality long run — distance ≥ 10 mi, within last 8 weeks. No effort
//      filter (Riegel will simply reflect the pace you sustained).
//   3. null — caller should fall back to Garmin's racePredictor.
//
// Returns: { run, tier, label } or null.
//   tier: 'race' | 'long'
//   label: short string for the tile sublabel ('race effort 13.2mi · May 11', etc.)
export function findEmpiricalRaceAnchor(activities) {
  if (!Array.isArray(activities) || !activities.length) return null;
  const today = new Date();
  const daysOld = (dateStr) => {
    if (!dateStr) return Infinity;
    const d = new Date(`${dateStr}T12:00:00`);
    if (!isFinite(d.getTime())) return Infinity;
    return (today - d) / 86400000;
  };
  const STANDARD_KM = [5, 10, 21.1, 42.2];
  const STANDARD_LABEL = { 5: '5K', 10: '10K', 21.1: 'HM', 42.2: 'M' };

  // Build a list of runs with derived pace + km.
  const runs = activities
    .filter(a => isRun(a) && a?.distanceMi && a?.durationSecs)
    .map(a => {
      const km = (Number(a.distanceMi) || Number(a.distance_mi) || 0) * 1.60934;
      const dur = Number(a.durationSecs) || 0;
      const paceSecPerKm = km > 0 ? dur / km : Infinity;
      return { run: a, km, dur, paceSecPerKm };
    });

  // ── Tier 1: race-effort at standard distance ────────────────────────────
  // Distance must be within ±5% of a standard race distance. For "race effort"
  // we use either: avgHR ≥ 85% of maxHR observed in the activity (threshold+
  // zone), OR pace ≤ 92% of the median pace across recent ≥10mi runs (a
  // simple "this was faster than your training" check).
  const longRuns = runs.filter(r => r.km >= 16 && daysOld(r.run.date) <= 84);
  const medianLongPace = (() => {
    if (!longRuns.length) return null;
    const sorted = longRuns.map(r => r.paceSecPerKm).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  })();

  const candidates = runs
    .filter(r => daysOld(r.run.date) <= 168) // 24 weeks
    .map(r => {
      const match = STANDARD_KM.find(std => Math.abs(r.km - std) / std <= 0.05);
      return { ...r, matchedKm: match || null };
    })
    .filter(r => r.matchedKm != null);

  for (const c of candidates.sort((a, b) => (b.run.date || '').localeCompare(a.run.date || ''))) {
    const hrHigh = c.run.maxHR && c.run.avgHR && (c.run.avgHR / c.run.maxHR) >= 0.85;
    const paceFast = medianLongPace && c.paceSecPerKm <= medianLongPace * 0.92;
    if (hrHigh || paceFast) {
      const dateLabel = c.run.date || '';
      return {
        run: c.run,
        tier: 'race',
        label: `race effort · ${STANDARD_LABEL[c.matchedKm]} · ${dateLabel}`,
      };
    }
  }

  // ── Tier 2: quality long run within last 8 weeks ────────────────────────
  // No effort filter — Riegel will inherit whatever pace you sustained. If
  // the long was easy, the projection will be conservative (which is honest
  // — your demonstrated 21k-pace projects to a 1:50 HM, not 1:30).
  const longCandidates = runs
    .filter(r => r.run.distanceMi >= 10 && daysOld(r.run.date) <= 56)
    .sort((a, b) => (b.run.date || '').localeCompare(a.run.date || ''));
  if (longCandidates.length) {
    const c = longCandidates[0];
    const miStr = (Number(c.run.distanceMi) || 0).toFixed(1);
    return {
      run: c.run,
      tier: 'long',
      label: `long run · ${miStr}mi · ${c.run.date || ''}`,
    };
  }

  return null;
}

// Phase 4m.2.8 — Calibrated VDOT predictor (kept available as a secondary
// option; not currently used by the Race Predictor metric, which uses
// Riegel above. Available for future "ceiling forecast" features).
// Raw VDOT assumes you're peaked and properly trained for the distance.
// In reality, race-day finish times depend heavily on training volume and
// long-run readiness. Underprepared runners with high VO2max but low
// weekly mileage will run slower than VDOT predicts.
//
// We apply two penalties on top of the VDOT baseline:
//   1. VOLUME PENALTY — compares trailing 8-week avg weekly km to the
//      "racing target" volume for the distance:
//        Half: ~42 km/wk (~26 mi),  Full: ~84 km/wk (~52 mi)
//      Each percentage-point shortfall adds 0.40% to predicted time,
//      capped at 30% total slowdown.
//   2. LONG-RUN PENALTY — compares longest single run in the last 8 weeks
//      to ~85% of race distance (the "have you been there?" check):
//        Half: ~17 km long run,  Full: ~34 km long run
//      Each percentage-point shortfall adds 0.30%, capped at 20%.
//
// Combined: a runner at 19 mi/wk + 8.4 mi long going into a half marathon
// gets ~18-20% slowdown applied to their VDOT half-time. That puts the
// prediction in race-realistic territory rather than VO2max-ceiling.
//
// FIELD_TO_KM maps the predictor field key to standard race distance.
const _FIELD_TO_KM = { t5k: 5, t10k: 10, tHM: 21.1, tM: 42.2 };

export function calibratedVDOTPredict(vo2max, field, ctx) {
  const baseVDOT = predictFromVDOT(vo2max, field);
  if (baseVDOT == null) return null;
  const raceKm = _FIELD_TO_KM[field];
  if (!raceKm) return baseVDOT;

  // Trailing 8-week training context. Use the same ctx the metric receives
  // so the prediction stays in sync with whatever data is loaded.
  const acts = ctx?.activities || [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 56);
  cutoff.setHours(0, 0, 0, 0);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  let totalKm = 0;
  let longestKm = 0;
  for (const a of acts) {
    if (!isRun(a) || !a?.date || a.date < cutoffStr) continue;
    const km = (Number(a.distanceMi || a.distance_mi) || 0) * 1.60934;
    totalKm += km;
    if (km > longestKm) longestKm = km;
  }
  const avgWeeklyKm = totalKm / 8;

  // Recommended training thresholds for "racing the distance":
  const recommendedWeeklyKm = raceKm * 2.0;     // Half ≈ 42 km/wk
  const recommendedLongKm   = raceKm * 0.85;    // Half ≈ 18 km

  const volumeShortfall  = Math.max(0, 1 - avgWeeklyKm / recommendedWeeklyKm);
  const longRunShortfall = Math.max(0, 1 - longestKm  / recommendedLongKm);

  const volumePenalty  = Math.min(volumeShortfall  * 0.40, 0.30);
  const longRunPenalty = Math.min(longRunShortfall * 0.30, 0.20);
  const totalPenalty   = volumePenalty + longRunPenalty;

  return Math.round(baseVDOT * (1 + totalPenalty));
}

// Phase 4m.2 — Nutrition samples helper. Walks nutritionLog full-day entries
// + legacy cronometer collection, returning dated {date, value} pairs for a
// given macro key. Used by Body-category timeframes() functions.
function _nutritionSamples(ctx, key) {
  const samples = [];
  for (const e of (ctx.nutritionLog || [])) {
    if (e?.meal !== 'full-day' || !e?.date) continue;
    // Cronometer Worker writes:
    //   macros.{calories, protein, carbs, fat, fiber, sugar, water}
    //   extended.{sodium, potassium, magnesium, calcium, iron, caffeine, alcohol}
    // Manual entries may use bare `key` or `totals.key`. Walk all paths.
    const v = Number(
      e?.totals?.[key] ??
      e?.macros?.[key] ??
      e?.extended?.[key] ??
      e?.[key]
    );
    if (Number.isFinite(v) && v > 0) samples.push({ date: e.date, value: v });
  }
  // Legacy cronometer collection — walk only if nutritionLog had no full-day rows
  // (otherwise we'd double-count days where both are written).
  if (!samples.length) {
    for (const c of (ctx.cronometer || [])) {
      if (!c?.date) continue;
      // Legacy format may use "Sodium (mg)" style keys in totals
      const legacyKeys = {
        sodium: ['Sodium (mg)', 'sodium'],
        potassium: ['Potassium (mg)', 'potassium'],
        magnesium: ['Magnesium (mg)', 'magnesium'],
      };
      const candidates = legacyKeys[key] || [key];
      let v = null;
      for (const k of candidates) {
        const x = Number(c?.[k] ?? c?.totals?.[k]);
        if (Number.isFinite(x) && x > 0) { v = x; break; }
      }
      if (v != null) samples.push({ date: c.date, value: v });
    }
  }
  return samples;
}

// ── Helpers used by multiple metrics ────────────────────────────────────────

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const startOfWeekMonday = (d = new Date()) => {
  const x = new Date(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  x.setHours(0, 0, 0, 0);
  return x;
};

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
};

const filterByDateGe = (arr, dateObj, dateField = 'date') => {
  const cutoff = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
  return arr.filter(x => x?.[dateField] && x[dateField] >= cutoff);
};

const avg = (arr, key) => {
  const vals = arr.map(x => x?.[key]).filter(v => v != null && !isNaN(v));
  return vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null;
};

const sum = (arr, key) =>
  arr.reduce((s, x) => s + (Number(x?.[key]) || 0), 0);

// True if date string (YYYY-MM-DD) is within the last `days` days from today.
function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const cutoff = daysAgo(days);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;
  return dateStr >= cutoffStr;
}

// Combine HRV observations from sleep (Garmin Worker) + hrvData (manual CSV).
// Returns newest-first array of { date, overnightHRV, source } where source
// is 'worker' or 'csv'. Worker rows win when both exist for the same date.
function mergedHrvByDate(ctx) {
  const byDate = new Map();
  // Manual CSV imports first (lower priority — overwritten by worker below)
  for (const h of (ctx.hrvData || [])) {
    if (h?.date && h?.overnightHRV != null && !isNaN(Number(h.overnightHRV))) {
      byDate.set(h.date, { date: h.date, overnightHRV: Number(h.overnightHRV), source: 'csv' });
    }
  }
  // Worker sleep rows (higher priority)
  for (const s of (ctx.sleepData || [])) {
    if (s?.date && s?.overnightHRV != null && !isNaN(Number(s.overnightHRV))) {
      byDate.set(s.date, { date: s.date, overnightHRV: Number(s.overnightHRV), source: 'worker' });
    }
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ── Nutrition macro lookup helpers (Phase 4g) ──
// Body-category tiles (Protein, Calories, Carbs, Fat, Fiber, Sodium) need a
// 30-day series for their avg30 number. These helpers walk the nutrition data
// in the same priority order nutDailyTotals uses outside the registry:
//   1. Cronometer full-day entry (Worker source) for the date
//   2. Sum of manual nutritionLog entries
//   3. Legacy `cronometer` collection fallback
function macroForDate(ctx, dateStr, macroKey) {
  const dayLog = (ctx.nutritionLog || []).filter(e => e?.date === dateStr);
  const fullDay = dayLog
    .filter(e => e?.meal === 'full-day')
    .sort((a, b) => (b?.createdAt || '').localeCompare(a?.createdAt || ''))[0];
  if (fullDay) {
    const v = Number(fullDay?.macros?.[macroKey]) || Number(fullDay?.extended?.[macroKey]) || 0;
    if (v > 0) return v;
  }
  if (dayLog.length) {
    const sum = dayLog.reduce((s, e) =>
      s + (Number(e?.macros?.[macroKey]) || Number(e?.[macroKey]) || 0), 0);
    if (sum > 0) return sum;
  }
  const legacy = (ctx.cronometer || []).find(c => c?.date === dateStr);
  if (legacy) {
    const v = Number(legacy?.[macroKey]) || 0;
    if (v > 0) return v;
  }
  return 0;
}

// Returns last 30 days' values for a given macro key, in newest-first order.
// Days with zero (empty intake) are skipped — averaging over them would drag
// the displayed avg30 down for users who don't log every day.
function macroHistory30(ctx, macroKey) {
  const out = [];
  const today = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const v = macroForDate(ctx, ds, macroKey);
    if (v > 0) out.push(v);
  }
  return out;
}

// Pace string "M:SS" → seconds, or null
const paceToSecs = (p) => {
  if (!p) return null;
  const m = String(p).match(/^(\d+):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};
const secsToPace = (s) => {
  if (!s || !isFinite(s)) return null;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};

// Find FIT activity for a given date (used to surface latest run's
// per-session metrics like cadence, GCT, etc.)
const latestRun = (acts) => {
  const runs = (acts || []).filter(isRun)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return runs[0] || null;
};
const latestStrength = (acts) => {
  const strength = (acts || []).filter(isStrengthAct)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return strength[0] || null;
};

// ── Status & trend evaluation ───────────────────────────────────────────────
// Each metric declares:
//   polarity   — what direction is "good": 'higher-better' | 'lower-better' |
//                'target' (closer to target = better) | 'neutral' (no meaningful good/bad)
//   thresholds — {green: [lo,hi], amber: [lo,hi], red: [lo,hi]} ranges. Values outside
//                any band default to 'neutral'. Optional — metrics without thresholds
//                show in default white text.
//   historyOf  — (ctx) => number[] returning the historical values used for
//                the trend computation. Newest-first or oldest-first both fine —
//                deriveTrend filters to the prior 7 entries before today's.
//
// The renderer never inspects these directly. Instead it calls evaluate(metric, ctx)
// which executes compute() and post-hoc enriches the result with auto-derived
// status + trend if compute didn't already supply them.

// Body Battery resilience helper: prefer the highest-fidelity field that's
// actually populated. Garmin's reports/daily endpoint occasionally returns
// sparse intraday samples (bodyBatteryStart/End/Min/Max all null) but always
// gives charged/drained — falling back through this chain means the tile
// shows something useful instead of going blank when one field is missing.
function bodyBatteryDerived(w) {
  if (!w) return null;
  if (typeof w.bodyBatteryStart === 'number') return w.bodyBatteryStart;
  if (typeof w.bodyBatteryMax   === 'number') return w.bodyBatteryMax;
  if (typeof w.bodyBatteryEnd   === 'number') return w.bodyBatteryEnd;
  // Last-resort proxy: charged-drained as a "net day" indicator if no samples.
  // Not a true 0-100 scale — bracket to [0,100] so thresholds still fire.
  if (typeof w.bodyBatteryCharged === 'number' || typeof w.bodyBatteryDrained === 'number') {
    const ch = Number(w.bodyBatteryCharged) || 0;
    const dr = Number(w.bodyBatteryDrained) || 0;
    return Math.max(0, Math.min(100, 50 + (ch - dr)));
  }
  return null;
}

export const STATUS_COLORS = {
  green:   '#4ade80',
  amber:   '#fbbf24',
  red:     '#f87171',
  neutral: null,  // signals "no special color, use default"
};

// Subtle status glyphs rendered next to the trend line below the value.
// Intentionally minimal: a check when optimal, nothing when "fine but not flagged",
// a caution mark when amber, a heavy X when red. Same icon for every metric so
// users learn one visual language across the whole Start screen.
//
// Why these particular characters — they are all in Unicode blocks that font
// engines render as TEXT GLYPHS (not emoji), which means they stay crisp at
// small sizes. The original ☠ skull was emoji-rendered and pixelated on both
// Windows and Android at 9px font-size.
export const STATUS_ICONS = {
  green:   '✓',          // U+2713 CHECK MARK — optimal
  amber:   '!',          // ASCII bang — caution
  red:     '✗',          // U+2717 BALLOT X — danger (text-rendered, always crisp)
  neutral: null,         // nothing rendered
};

function inRange(v, range) {
  if (!Array.isArray(range)) return false;
  // Single range [lo, hi] OR array-of-ranges [[lo,hi], [lo2,hi2], ...]
  if (range.length === 2 && typeof range[0] === 'number') {
    return v >= range[0] && v <= range[1];
  }
  return range.some(r => Array.isArray(r) && r.length === 2 && v >= r[0] && v <= r[1]);
}

// Status derivation from a target-based ratio (used by macros / micronutrients).
// type='window' → green if 90-110% of target, amber if 70-130%, red outside.
// type='higher' → green if >=80% of target, amber if >=50%, red below.
export function statusFromPct(pct, type = 'window') {
  if (pct == null || !isFinite(pct)) return 'neutral';
  if (type === 'higher') {
    if (pct >= 0.8) return 'green';
    if (pct >= 0.5) return 'amber';
    return 'red';
  }
  if (pct >= 0.9 && pct <= 1.1) return 'green';
  if (pct >= 0.7 && pct <= 1.3) return 'amber';
  return 'red';
}

export function deriveStatus(value, thresholds) {
  if (value == null || !isFinite(value) || !thresholds) return 'neutral';
  if (inRange(value, thresholds.green)) return 'green';
  if (inRange(value, thresholds.amber)) return 'amber';
  if (inRange(value, thresholds.red))   return 'red';
  return 'neutral';
}

// Compute trend: compare current value vs average of the prior `window` entries.
// Returns { direction: 'up'|'down'|'flat', delta, isGood }
//   direction — raw movement, not interpreted
//   isGood    — direction interpreted through polarity
//                higher-better: up=good, down=bad
//                lower-better:  down=good, up=bad
//                target:        movement toward target = good (needs target)
//                neutral:       isGood=null (don't color the arrow)
export function deriveTrend(currentValue, history, polarity, target = null, window = 7) {
  if (currentValue == null || !Array.isArray(history) || history.length < 2) return null;
  // Drop the current value from the history (assumed to be at index 0 newest-first
  // or last oldest-first); use the next `window` items as the reference average.
  const numeric = history.map(v => Number(v)).filter(v => isFinite(v));
  if (numeric.length < 2) return null;
  // Heuristic: if the first item equals currentValue, treat array as newest-first.
  const newestFirst = Math.abs(numeric[0] - Number(currentValue)) < 0.01;
  const ref = newestFirst ? numeric.slice(1, 1 + window) : numeric.slice(-window - 1, -1);
  if (ref.length === 0) return null;
  const refAvg = ref.reduce((s, v) => s + v, 0) / ref.length;
  const delta = Number(currentValue) - refAvg;
  const flatThreshold = Math.max(0.5, Math.abs(refAvg) * 0.02);  // ~2% noise band
  let direction;
  if (Math.abs(delta) < flatThreshold) direction = 'flat';
  else direction = delta > 0 ? 'up' : 'down';

  let isGood;
  if (polarity === 'higher-better') {
    isGood = direction === 'up' ? true : direction === 'down' ? false : null;
  } else if (polarity === 'lower-better') {
    isGood = direction === 'down' ? true : direction === 'up' ? false : null;
  } else if (polarity === 'target' && target != null) {
    // Moved toward target → good; away → bad
    const distNow  = Math.abs(Number(currentValue) - target);
    const distRef  = Math.abs(refAvg - target);
    isGood = direction === 'flat' ? null : (distNow < distRef);
  } else {
    isGood = null;
  }
  return { direction, delta: +delta.toFixed(2), isGood };
}

// Evaluator: runs compute() and back-fills status + trend + avg30 if the
// metric provides enough metadata. Used by the tile renderer in MobileHome.jsx.
export function evaluate(metric, ctx) {
  if (!metric) return null;
  let result;
  try { result = metric.compute(ctx); } catch (e) { console.warn(`[evaluate] ${metric.id} compute failed:`, e); return null; }
  if (!result) return null;
  if (result.status == null && metric.thresholds) {
    result.status = deriveStatus(Number(result.value), metric.thresholds);
  }
  // Pull the historical series once and reuse for trend + 30d avg.
  let hist = null;
  if (metric.historyOf) {
    try { hist = metric.historyOf(ctx); } catch { hist = null; }
  }
  if (result.trend == null && Array.isArray(hist) && metric.polarity && metric.polarity !== 'neutral') {
    result.trend = deriveTrend(Number(result.value), hist, metric.polarity, metric.target ?? null);
  }
  // 30-day average — average of the last 30 numeric historical observations.
  // For metrics whose value is a point-in-time observation (HR, HRV, weight,
  // duration, etc.) this is meaningful. For metrics that are themselves
  // already windowed aggregates (Z2 weekly, ACWR), historyOf is null and
  // avg30 stays null — the renderer shows "—" in that slot.
  if (result.avg30 == null && Array.isArray(hist) && hist.length > 0) {
    const recent = hist.slice(0, 30).map(Number).filter(v => isFinite(v));
    if (recent.length >= 1) {
      const avgVal = recent.reduce((s, v) => s + v, 0) / recent.length;
      // Round to match the precision of the headline value where possible.
      const todayVal = Number(result.value);
      const decimals = isFinite(todayVal) && String(result.value).includes('.')
        ? (String(result.value).split('.')[1] || '').length
        : 0;
      result.avg30 = decimals > 0 ? +avgVal.toFixed(decimals) : Math.round(avgVal);
    }
  }
  return result;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const TILE_METRICS = [
  // ═══ RUN — VOLUME ═════════════════════════════════════════════════════
  {
    id: 'weeklyMiles', label: 'Weekly Miles', category: 'run', unit: 'mi',
    subgroup: 'volume',
    polarity: 'higher-better',
    // YTD = cumulative total (volume metric). Week & 8-wk = sum per week.
    ytdMode: 'total',
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(r => parseFloat(r.distanceMi || r.distance_mi) || 0)
      .filter(v => v > 0),
    compute: (ctx) => {
      // For the mobile cockpit: this week's total miles.
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      const wStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const total = (ctx.activities || [])
        .filter(a => isRun(a) && a.date >= wStr)
        .reduce((s, a) => s + (parseFloat(a.distanceMi || a.distance_mi) || 0), 0);
      if (total <= 0) return null;
      return { value: +total.toFixed(1), sublabel: 'this week' };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: (a) => isRun(a),
        valueField: (a) => parseFloat(a.distanceMi || a.distance_mi) || null,
        mode: 'total',
        ytdMode: 'total',
      }
    ),
  },
  {
    id: 'weeklyHours', label: 'Weekly Hours', category: 'run', unit: 'hrs',
    subgroup: 'volume',
    polarity: 'higher-better',
    ytdMode: 'total',
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(r => (r.durationSecs || 0) / 3600)
      .filter(v => v > 0),
    compute: (ctx) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      const wStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const total = (ctx.activities || [])
        .filter(a => isRun(a) && a.date >= wStr)
        .reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
      if (total <= 0) return null;
      return { value: +total.toFixed(1), sublabel: 'this week' };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: (a) => isRun(a),
        valueField: (a) => (a.durationSecs || 0) / 3600 || null,
        mode: 'total',
        ytdMode: 'total',
      }
    ),
  },

  // ═══ RUN — MECHANICAL EFFICIENCY (common to easy + speed) ════════════
  {
    id: 'avgRunHR', label: 'Avg HR (Run)', category: 'run', unit: 'bpm',
    subgroup: 'easy',
    polarity: 'lower-better', // for trend: dropping HR at same paces = improving fitness
    ytdMode: 'avg',
    // No fixed thresholds — context-dependent (Z2 vs tempo). Status stays neutral.
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.avgHR).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r?.avgHR) return null;
      return {
        value: Math.round(r.avgHR),
        sublabel: r.date,
        hrZones: Array.isArray(r.hrZones) && r.hrZones.length === 5 ? r.hrZones : null,
      };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: (a) => isRun(a) && a.avgHR != null,
        valueField: (a) => a.avgHR,
        mode: 'avg',
        ytdMode: 'avg',
      }
    ),
  },
  {
    id: 'cadence', label: 'Cadence', category: 'run', unit: 'spm',
    subgroup: 'mechanical',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [170, 220], amber: [160, 170], red: [0, 160] },
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.avgCadence).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r?.avgCadence) return null;
      return { value: Math.round(r.avgCadence), sublabel: r.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.avgCadence, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'racePredictor', label: 'Race Predictor', category: 'run', unit: '',
    polarity: 'lower-better', // faster predicted time = better
    // Phase 4r.race.1 — historyOf returns empirical Riegel projections from
    // qualifying runs (race-effort or long run ≥ 10mi). The trend arrow now
    // reflects evolving fitness as measured by what the user has ACTUALLY
    // demonstrated, not Garmin's VO2max-derived ceiling.
    historyOf: (ctx) => {
      const acts = (ctx.activities || [])
        .filter(a => isRun(a) && a?.distanceMi && a?.durationSecs)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const out = [];
      for (const a of acts) {
        // Only project from runs that are themselves at least ~5K — Riegel
        // gets noisy below that. Map every qualifying run to its HM
        // projection (the default headline field).
        const dMi = Number(a.distanceMi) || Number(a.distance_mi) || 0;
        if (dMi < 3) continue;
        const proj = riegelPredictFromRun(a, 'tHM');
        if (proj && proj > 0) out.push(proj);
      }
      // Fall back to Garmin's projections if no qualifying activity data.
      if (out.length === 0) {
        return (ctx.activities || [])
          .filter(a => isRun(a) && a?.racePredictor?.tHM)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .map(a => a.racePredictor.tHM);
      }
      return out;
    },
    compute: (ctx) => {
      const fmt = s => {
        if (s == null || !Number.isFinite(s) || s <= 0) return '—';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.round(s % 60);
        return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
                     : `${m}:${String(sec).padStart(2, '0')}`;
      };

      // Phase 4r.race.1 — empirical-first race-time projection.
      // Previous version used Garmin's racePredictor.tHM raw, which is
      // derived from VO2max and systematically under-predicts trained
      // runners (user reported 25-30 min miss on an actual HM).
      // New priority:
      //   1. Empirical anchor (race-effort distance match OR quality long
      //      run) → Riegel projection across all 4 standard distances.
      //   2. Garmin's racePredictor block from most recent FIT — fallback.
      const anchor = findEmpiricalRaceAnchor(ctx.activities || []);
      const empirical = anchor ? {
        t5k:  riegelPredictFromRun(anchor.run, 't5k'),
        t10k: riegelPredictFromRun(anchor.run, 't10k'),
        tHM:  riegelPredictFromRun(anchor.run, 'tHM'),
        tM:   riegelPredictFromRun(anchor.run, 'tM'),
      } : null;

      const garminMostRecent = (ctx.activities || [])
        .filter(a => a?.racePredictor)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const garmin = garminMostRecent?.racePredictor || null;

      // No data at all → tile stays empty.
      if (!empirical && !garmin) return null;

      // Headline source: empirical if available, else Garmin.
      const headline = empirical || garmin;
      const source = empirical ? 'empirical' : 'garmin';

      // Sublabel: surface the alternative source + the gap so the user can
      // sanity-check. If both exist and disagree by >10%, name the delta —
      // makes the "Garmin says 2:00, you trained for 1:30" disagreement
      // visible instead of swept under one number.
      let sublabel;
      if (empirical && garmin?.tHM && headline.tHM) {
        const delta = garmin.tHM - headline.tHM;
        const deltaMin = Math.abs(Math.round(delta / 60));
        const deltaStr = deltaMin >= 1
          ? (delta > 0 ? `Garmin +${deltaMin}min conservative` : `Garmin ${deltaMin}min faster`)
          : 'Garmin agrees';
        sublabel = `${anchor.label} · ${deltaStr}`;
      } else if (empirical) {
        sublabel = anchor.label;
      } else {
        sublabel = `Garmin VO2max-based · no recent race-quality run`;
      }

      return {
        value: fmt(headline.tHM),
        sublabel,
        full: headline,
        source, // 'empirical' or 'garmin' — exposed for any UI that wants to badge it
      };
    },
    // Available if we have ANY data — empirical anchor OR Garmin block.
    available: (ctx) => {
      const acts = ctx.activities || [];
      if (acts.some(a => a?.racePredictor)) return true;
      return findEmpiricalRaceAnchor(acts) != null;
    },
    // Phase 4m.2.5 — Race Predictor dynamically picks the prediction field
    // matching the next race on the docket (5K → t5k, 10K → t10k, Half →
    // tHM, Full → tM). If no upcoming race, fall back to half-marathon as
    // the default forecast distance. Lower = faster = better.
    subgroup: 'load',
    polarity: 'lower-better',
    ytdMode: 'avg',
    formatter: (v) => {
      if (v == null || !Number.isFinite(v) || v <= 0) return '—';
      const h = Math.floor(v / 3600);
      const m = Math.floor((v % 3600) / 60);
      const s = Math.round(v % 60);
      return h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
    },
    // Map the next race's distance (km) to the FIT racePredictor field key.
    // Tolerances match the standard event distances allowing for course
    // marker drift: 5K = 4-7km, 10K = 7-15km, Half = 15-30km, Full = 30km+.
    timeframes: (ctx) => {
      const upcoming = (ctx.races || [])
        .filter(r => {
          const d = r?.date ? new Date(`${r.date}T12:00:00`) : null;
          return d && d >= new Date(new Date().setHours(0,0,0,0));
        })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const next = upcoming[0];
      const km = next ? (Number(next.distanceKm) || Number(next.distance_km) ||
                         (Number(next.distanceMi) ? Number(next.distanceMi) * 1.60934 : null)) : null;
      const fieldKey =
        km == null    ? 'tHM' :       // no race scheduled → default half-marathon forecast
        km <= 7       ? 't5k' :
        km <= 15      ? 't10k' :
        km <= 30      ? 'tHM' :
                        'tM';
      // Phase 4r.race.1 — flipped to empirical-first. Garmin's racePredictor
      // is now the fallback (it under-predicts trained runners by 5-20%
      // because it's VO2max-derived). Riegel anchored on actual pace per
      // run is the primary source. Aggregates over qualifying runs only
      // (≥3mi, ≥15min — filter inside riegelPredictFromRun).
      return timeframesFromCollection(
        ctx.activities,
        {
          filter: a => isRun(a),
          valueField: a => {
            const r = riegelPredictFromRun(a, fieldKey);
            if (r && r > 0) return r;
            // Fall back to Garmin's block for activities that don't qualify
            // for Riegel (warm-ups, sprint reps, casual short runs).
            if (a?.racePredictor && a.racePredictor[fieldKey]) {
              return Number(a.racePredictor[fieldKey]) || null;
            }
            return null;
          },
          mode: 'avg',
          ytdMode: 'avg',
        }
      );
    },
    // Race-name annotation rendered below the tile's label. Tells the user
    // exactly which race the prediction is for (e.g. "for RBC Brooklyn Half").
    descriptionFor: (ctx) => {
      const upcoming = (ctx.races || [])
        .filter(r => {
          const d = r?.date ? new Date(`${r.date}T12:00:00`) : null;
          return d && d >= new Date(new Date().setHours(0,0,0,0));
        })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const next = upcoming[0];
      if (!next) return 'no upcoming race · default Half forecast';
      const name = next.name || 'upcoming race';
      const dateStr = next.date
        ? new Date(`${next.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      return dateStr ? `for ${name} · ${dateStr}` : `for ${name}`;
    },
    // Override label dynamically based on next race. The renderer uses
    // metric.label, so we expose this as a getter via labelFor(ctx). The
    // base label stays generic for users without an upcoming race.
    labelFor: (ctx) => {
      const upcoming = (ctx.races || [])
        .filter(r => {
          const d = r?.date ? new Date(`${r.date}T12:00:00`) : null;
          return d && d >= new Date(new Date().setHours(0,0,0,0));
        })
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const next = upcoming[0];
      if (!next) return 'Race Predictor';
      const km = Number(next.distanceKm) || Number(next.distance_km) ||
                 (Number(next.distanceMi) ? Number(next.distanceMi) * 1.60934 : null);
      const distLabel =
        km == null    ? '' :
        km <= 7       ? '5K' :
        km <= 15      ? '10K' :
        km <= 30      ? 'Half' :
                        'Full';
      return distLabel ? `Race Predictor · ${distLabel}` : 'Race Predictor';
    },
  },
  {
    id: 'aerobicTE', label: 'Aerobic TE', category: 'run', unit: '/5',
    subgroup: 'easy',
    polarity: 'target', target: 3.0,
    ytdMode: 'avg',
    thresholds: { green: [2, 4], amber: [[1, 2], [4, 5]], red: [[0, 1], [5, 10]] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => Number(a.aerobicTrainingEffect) || null,
        mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.aerobicTrainingEffect).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (r?.aerobicTrainingEffect == null) return null;
      return { value: r.aerobicTrainingEffect.toFixed(1), sublabel: r.date };
    },
  },
  {
    id: 'paceHrRatio', label: 'Pace : HR Ratio', category: 'run', unit: '',
    subgroup: 'easy',
    polarity: 'lower-better',
    ytdMode: 'avg',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isRun(a),
        valueField: a => {
          const sec = paceToSecs(a.avgPaceRaw || a.avgPacePerMi);
          return a.avgHR && sec ? +(sec / a.avgHR).toFixed(3) : null;
        },
        mode: 'avg', ytdMode: 'avg',
      }
    ),
    historyOf: (ctx) => (ctx.activities || []).filter(isRun)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => {
        const sec = paceToSecs(r.avgPaceRaw || r.avgPacePerMi);
        return r.avgHR && sec ? +(sec / r.avgHR).toFixed(2) : null;
      }).filter(v => v != null),
    compute: (ctx) => {
      const r = latestRun(ctx.activities);
      if (!r) return null;
      const paceSec = paceToSecs(r.avgPaceRaw || r.avgPacePerMi);
      const hr = r.avgHR;
      if (!paceSec || !hr) return null;
      const ratio = +(paceSec / hr).toFixed(2);
      return { value: ratio, sublabel: r.date };
    },
  },
  {
    id: 'zone2Weekly', label: 'Z2 Weekly', category: 'run', unit: 'min',
    subgroup: 'easy',
    polarity: 'higher-better',
    // Weekly total — sum minutes-in-Z2 across the week's runs.
    ytdMode: 'avg',
    thresholds: { green: [240, 99999], amber: [120, 240], red: [0, 120] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isRun(a) && Array.isArray(a?.hrZones) && a.hrZones.length === 5,
        valueField: a => {
          const z2Secs = a.hrZones[1] || 0;
          return z2Secs > 0 ? z2Secs / 60 : null;  // minutes
        },
        mode: 'total',
        ytdMode: 'avg',  // YTD = avg per week of Z2 minutes
      }
    ),
    historyOf: null, // Trend not meaningful for a "this-week" snapshot
    compute: (ctx) => {
      const monday = startOfWeekMonday();
      const weekRuns = filterByDateGe(ctx.activities || [], monday).filter(isRun);
      const z2Secs = weekRuns.reduce((sum, a) => {
        if (Array.isArray(a?.hrZones) && a.hrZones.length === 5) return sum + (a.hrZones[1] || 0);
        return sum;
      }, 0);
      if (z2Secs === 0) return null;
      const totalSecs = weekRuns.reduce((sum, a) => {
        if (Array.isArray(a?.hrZones)) return sum + a.hrZones.reduce((s, v) => s + v, 0);
        return sum;
      }, 0);
      const z2Mins = Math.round(z2Secs / 60);
      const pct = totalSecs > 0 ? Math.round((z2Secs / totalSecs) * 100) : 0;
      return { value: z2Mins, sublabel: `${pct}% of Z-time` };
    },
    available: (ctx) => (ctx.activities || []).some(a => Array.isArray(a?.hrZones)),
  },
  {
    id: 'aerobicDecoupling', label: 'Aerobic Decoupling', category: 'run', unit: '%',
    subgroup: 'easy',
    polarity: 'lower-better',
    ytdMode: 'avg',
    thresholds: { green: [0, 5], amber: [5, 10], red: [10, 100] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a) && a?.aerobicDecoupling != null,
        valueField: a => Number(a.aerobicDecoupling),
        mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => (ctx.activities || [])
      .filter(a => isRun(a) && a?.aerobicDecoupling != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(a => a.aerobicDecoupling),
    compute: (ctx) => {
      const runs = (ctx.activities || []).filter(a => isRun(a) && a.aerobicDecoupling != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const r = runs[0];
      if (!r) return null;
      const v = r.aerobicDecoupling;
      const status = v < 5 ? 'green' : v < 10 ? 'amber' : 'red';
      return { value: v.toFixed(1), sublabel: r.date, status };
    },
    available: (ctx) => (ctx.activities || []).some(a => a?.aerobicDecoupling != null),
  },
  {
    id: 'acwr', label: 'ACWR', category: 'run', unit: '',
    // Acute:Chronic Workload Ratio. Sweet spot 0.8-1.3, danger zone >1.5.
    polarity: 'target', target: 1.0,
    // Two-sided thresholds: amber and red bands on both sides of the sweet spot.
    thresholds: {
      green: [0.8, 1.3],
      amber: [[0.5, 0.8], [1.3, 1.5]],
      red:   [[0, 0.5], [1.5, 99]],
    },
    // Trend window: 7 days makes sense for the rolling acute load.
    // Phase 4r.design.2 — historyOf now produces a 30-day series of
    // rolling ACWR values (one per day, using each day as the
    // "today" anchor for the 7/28 windows). Previously suppressed
    // because "ACWR is already a window", but the 30d avg of the
    // ratio is genuinely useful — it tells you whether today's
    // load is at typical training balance or atypical.
    historyOf: (ctx) => {
      const acts = (ctx.activities || []).filter(isRun);
      if (!acts.length) return [];
      const out = [];
      const day = (offset) => {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        d.setHours(0, 0, 0, 0);
        return d;
      };
      const isoFromDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      for (let offset = 0; offset < 30; offset++) {
        const anchor = day(offset);
        const cut7  = new Date(anchor); cut7.setDate(cut7.getDate() - 7);
        const cut28 = new Date(anchor); cut28.setDate(cut28.getDate() - 28);
        const anchorIso = isoFromDate(anchor);
        const c7Iso  = isoFromDate(cut7);
        const c28Iso = isoFromDate(cut28);
        let mi7 = 0, mi28 = 0;
        for (const a of acts) {
          if (!a?.date || a.date > anchorIso) continue;
          if (a.date >= c7Iso)  mi7  += (a.distanceMi || 0);
          if (a.date >= c28Iso) mi28 += (a.distanceMi || 0);
        }
        const avg28Weekly = mi28 / 4;
        if (avg28Weekly >= 1) out.push(+(mi7 / avg28Weekly).toFixed(2));
      }
      return out;
    },
    compute: (ctx) => {
      const cutoff7  = daysAgo(7);
      const cutoff28 = daysAgo(28);
      const acts = ctx.activities || [];
      const last7  = filterByDateGe(acts, cutoff7).filter(isRun);
      const last28 = filterByDateGe(acts, cutoff28).filter(isRun);
      const mi7  = last7.reduce((s, a) => s + (a.distanceMi || 0), 0);
      const mi28 = last28.reduce((s, a) => s + (a.distanceMi || 0), 0);
      const avg28Weekly = mi28 / 4;
      if (avg28Weekly < 1) return null;
      const ratio = +(mi7 / avg28Weekly).toFixed(2);
      const status = ratio > 1.5 ? 'red' : ratio > 1.3 ? 'amber' : ratio < 0.5 ? 'amber' : 'green';
      return { value: ratio, sublabel: `${mi7.toFixed(1)} / ${avg28Weekly.toFixed(1)} mi`, status };
    },
    available: (ctx) => (ctx.activities || []).filter(isRun).length >= 4,
    // ACWR is a 28-day rolling number — sparkline shows the rolling-ratio
    // weekly in the same bucket logic used for week aggregates.
    ytdMode: 'avg',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.distanceMi || a.distance_mi || null,
        // ACWR's "value" per week is total miles — but the tile renders the
        // CURRENT 28-day-rolling ratio, not weekly miles. Until we ship a
        // proper rolling-ratio history, the sparkline shows weekly volume.
        mode: 'total', ytdMode: 'avg' }
    ),
    thresholds: { green: [0.8, 1.3], amber: [[0.5, 0.8], [1.3, 1.5]], red: [[0, 0.5], [1.5, 99]] },
  },

  // ═══ RUN — LOAD / FORECAST additions (Phase 4m.2.4) ═══════════════════
  {
    id: 'longRun', label: 'Long Run', category: 'run', unit: 'mi',
    subgroup: 'load',
    polarity: 'higher-better',
    // mode: 'max' picks the longest single run in each week.
    // ytdMode: 'max' headlines the year's biggest run.
    ytdMode: 'max',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isRun(a),
        valueField: a => parseFloat(a.distanceMi || a.distance_mi) || null,
        mode: 'max',
        ytdMode: 'max',
      }
    ),
    compute: (ctx) => {
      const runs = (ctx.activities || []).filter(isRun);
      if (!runs.length) return null;
      const longest = runs.reduce((m, r) => {
        const d = parseFloat(r.distanceMi || r.distance_mi) || 0;
        return d > (m?.d || 0) ? { d, date: r.date } : m;
      }, null);
      return longest ? { value: +longest.d.toFixed(1), sublabel: longest.date } : null;
    },
  },
  {
    id: 'weeklyLoad', label: 'Weekly Load', category: 'run', unit: 'TE',
    subgroup: 'load',
    polarity: 'higher-better',
    // Sum of (aerobic + anaerobic Training Effect) across runs in the week.
    // Garmin TE is a 0-5 scale per session, so a typical week sums to 8-15.
    // Total per week, YTD = avg per week.
    ytdMode: 'avg',
    thresholds: { green: [8, 18], amber: [[4, 8], [18, 25]], red: [[0, 4], [25, 99]] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isRun(a),
        valueField: a => {
          const aero = Number(a.aerobicTrainingEffect) || 0;
          const ana = Number(a.anaerobicTrainingEffect) || 0;
          const total = aero + ana;
          return total > 0 ? total : null;
        },
        mode: 'total',
        ytdMode: 'avg',
      }
    ),
    compute: (ctx) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      weekStart.setHours(0, 0, 0, 0);
      const wStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const total = (ctx.activities || [])
        .filter(a => isRun(a) && a.date >= wStr)
        .reduce((s, a) => s + (Number(a.aerobicTrainingEffect) || 0) + (Number(a.anaerobicTrainingEffect) || 0), 0);
      if (total <= 0) return null;
      return { value: +total.toFixed(1), sublabel: 'this week' };
    },
  },

  // ═══ RUN — SPEED / ANAEROBIC (Phase 4m.2) ═════════════════════════════
  {
    id: 'avgRunPower', label: 'Avg Power', category: 'run', unit: 'W',
    subgroup: 'speed',
    polarity: 'higher-better',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(a => isRun(a) && a.avgPowerW)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.avgPowerW),
    compute: (ctx) => {
      const r = (ctx.activities || []).filter(a => isRun(a) && a.avgPowerW)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (!r?.avgPowerW) return null;
      return { value: Math.round(r.avgPowerW), sublabel: r.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.avgPowerW, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'maxRunHR', label: 'Max HR (Run)', category: 'run', unit: 'bpm',
    subgroup: 'speed',
    polarity: 'higher-better', // higher = real anaerobic stimulus on speed days
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(a => isRun(a) && a.maxHR)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.maxHR),
    compute: (ctx) => {
      const r = (ctx.activities || []).filter(a => isRun(a) && a.maxHR)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (!r?.maxHR) return null;
      return { value: Math.round(r.maxHR), sublabel: r.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.maxHR, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'heartRateRecovery', label: 'HR Recovery', category: 'run', unit: 'bpm',
    subgroup: 'speed',
    polarity: 'higher-better', // bigger drop = better autonomic recovery
    ytdMode: 'avg',
    // Phase 4m.1.5 — fitParser now extracts `hrRecovery` (bpm drop in
    // the 60s after peak HR) from session field or computed from records.
    // Reads canonical field; CSV imports without this field render '—'.
    historyOf: (ctx) => (ctx.activities || []).filter(a => isRun(a) && a.hrRecovery)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.hrRecovery),
    compute: (ctx) => {
      const r = (ctx.activities || []).filter(a => isRun(a) && a.hrRecovery)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (!r?.hrRecovery) return null;
      return { value: Math.round(r.hrRecovery), sublabel: r.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.hrRecovery, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'anaerobicTE', label: 'Anaerobic TE', category: 'run', unit: '/5',
    subgroup: 'speed',
    polarity: 'higher-better',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(a => isRun(a) && a.anaerobicTrainingEffect)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(r => r.anaerobicTrainingEffect),
    compute: (ctx) => {
      const r = (ctx.activities || []).filter(a => isRun(a) && a.anaerobicTrainingEffect)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (!r?.anaerobicTrainingEffect) return null;
      return { value: +r.anaerobicTrainingEffect.toFixed(1), sublabel: r.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: a => isRun(a), valueField: a => a.anaerobicTrainingEffect, mode: 'avg', ytdMode: 'avg' }
    ),
  },

  // ═══ STRENGTH ══════════════════════════════════════════════════════════
  {
    id: 'epoc', label: 'EPOC (Load)', category: 'strength', unit: '',
    polarity: 'neutral',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.totalTrainingLoad).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (s?.totalTrainingLoad == null) return null;
      return { value: Math.round(s.totalTrainingLoad), sublabel: s.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: isStrengthAct, valueField: a => a.totalTrainingLoad, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'avgStrengthHR', label: 'Avg HR (Strength)', category: 'strength', unit: 'bpm',
    polarity: 'neutral',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.avgHR).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.avgHR) return null;
      return {
        value: Math.round(s.avgHR),
        sublabel: s.date,
        hrZones: Array.isArray(s.hrZones) && s.hrZones.length === 5 ? s.hrZones : null,
      };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: isStrengthAct, valueField: a => a.avgHR, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'peakStrengthHR', label: 'Peak HR', category: 'strength', unit: 'bpm',
    polarity: 'neutral',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.maxHR).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.maxHR) return null;
      return { value: Math.round(s.maxHR), sublabel: s.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: isStrengthAct, valueField: a => a.maxHR, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'workRestRatio', label: 'Work : Rest', category: 'strength', unit: '',
    // Total work seconds vs total rest seconds for the latest strength session,
    // expressed as 1:X. The energy system being trained correlates directly
    // with the ratio, so the SUBLABEL surfaces the training effect (Power /
    // Hypertrophy / Endurance) rather than the value being colored as
    // "good/bad" — the user's intent for that session decides which is right.
    polarity: 'neutral', // No good/bad direction — depends on training intent
    ytdMode: 'avg',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isStrengthAct(a) && a?.totalWorkSecs && a?.totalRestSecs,
        valueField: a => +(a.totalRestSecs / a.totalWorkSecs).toFixed(2),
        mode: 'avg', ytdMode: 'avg',
      }
    ),
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .filter(s => s?.totalWorkSecs && s?.totalRestSecs)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => +(s.totalRestSecs / s.totalWorkSecs).toFixed(2)),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.totalWorkSecs || !s?.totalRestSecs) {
        // Surface why the tile is empty: lap/set-typed data is required.
        const hasAny = (ctx.activities || []).some(a => a?.totalWorkSecs);
        if (!hasAny && latestStrength(ctx.activities)) {
          return { value: '—', sublabel: 'Need lap/set data' };
        }
        return null;
      }
      const ratio = s.totalRestSecs / s.totalWorkSecs;
      // Energy-system label per coaching literature.
      let system;
      if (ratio >= 5)        system = 'Power';
      else if (ratio >= 1.5) system = 'Hypertrophy';
      else if (ratio >= 0.5) system = 'Mixed';
      else                   system = 'Endurance';
      // Phase 4r.design.3 — pre-compute avg30 here and format as "1 : X.Y"
      // because evaluate()'s auto-formatter rounds to an integer when
      // result.value isn't numeric (it sees "1 : 1.5", Number() = NaN, and
      // falls through to Math.round). Setting result.avg30 directly bypasses
      // the auto-fill (evaluate() only fills when avg30 == null).
      let avg30 = null;
      try {
        const ratios = (ctx.activities || [])
          .filter(isStrengthAct)
          .filter(a => a?.totalWorkSecs && a?.totalRestSecs)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
          .slice(0, 30)
          .map(a => a.totalRestSecs / a.totalWorkSecs);
        if (ratios.length) {
          const mean = ratios.reduce((s, v) => s + v, 0) / ratios.length;
          avg30 = `1 : ${mean.toFixed(1)}`;
        }
      } catch {}
      return {
        value: `1 : ${ratio.toFixed(1)}`,
        sublabel: `${system} · ${Math.round(s.totalWorkSecs)}s work / ${Math.round(s.totalRestSecs)}s rest`,
        avg30,
      };
    },
    available: (ctx) => (ctx.activities || []).some(a => a?.totalWorkSecs && a?.totalRestSecs),
  },
  {
    id: 'activeStrengthCal', label: 'Active Cal', category: 'strength', unit: 'kcal',
    polarity: 'neutral',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.calories).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.calories) return null;
      return { value: Math.round(s.calories), sublabel: s.date };
    },
    // Session-level avg — week shows avg burn per session, useful as a
    // session-intensity proxy (vs total kcal which is volume-driven).
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: isStrengthAct, valueField: a => a.calories, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'sessionDuration', label: 'Session Duration', category: 'strength', unit: 'min',
    polarity: 'neutral',
    ytdMode: 'avg',
    historyOf: (ctx) => (ctx.activities || []).filter(isStrengthAct)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.durationSecs ? Math.round(s.durationSecs / 60) : null).filter(v => v != null),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.durationSecs) return null;
      const m = Math.round(s.durationSecs / 60);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return {
        value: h > 0 ? `${h}h ${mm}m` : `${m}m`,
        sublabel: s.date,
      };
    },
    // Session-level avg in minutes for the trend.
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      { filter: isStrengthAct, valueField: a => a.durationSecs ? a.durationSecs / 60 : null, mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'preTrainingCarbs', label: 'Pre-Training Carbs', category: 'strength', unit: 'g',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [30, 200], amber: [15, 30], red: [0, 15] },
    // Per-session pre-fuel: sum carbs from nutritionLog entries within
    // the 2hr window before each strength session's start time.
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isStrengthAct(a) && a?.startTime,
        valueField: a => {
          const tMatch = String(a.startTime).match(/(\d{1,2}):(\d{2})/);
          if (!tMatch) return null;
          const [, hh, mm] = tMatch;
          const sessionStart = new Date(`${a.date}T${hh.padStart(2, '0')}:${mm}:00`);
          if (isNaN(sessionStart.getTime())) return null;
          const windowStart = new Date(sessionStart.getTime() - 2 * 60 * 60 * 1000);
          let carbs = 0; let any = false;
          for (const e of (ctx.nutritionLog || [])) {
            if (!e?.timestamp) continue;
            const t = new Date(e.timestamp);
            if (t >= windowStart && t <= sessionStart) {
              carbs += Number(e?.macros?.carbs) || Number(e?.carbs) || 0;
              any = true;
            }
          }
          return any ? carbs : null;
        },
        mode: 'avg', ytdMode: 'avg',
      }
    ),
    // Sum carb intake in 2hr window before latest strength session start.
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.startTime) return null;
      // Build start datetime from session date + start time string
      // (e.g. "2026-04-26" + "07:30") — best-effort, returns null if shape unknown
      const tMatch = String(s.startTime).match(/(\d{1,2}):(\d{2})/);
      if (!tMatch) return null;
      const [, hh, mm] = tMatch;
      const sessionStart = new Date(`${s.date}T${hh.padStart(2, '0')}:${mm}:00`);
      const windowStart = new Date(sessionStart.getTime() - 2 * 60 * 60 * 1000);
      const log = ctx.nutritionLog || [];
      const inWindow = log.filter(e => {
        if (!e?.timestamp) return false;
        const t = new Date(e.timestamp);
        return t >= windowStart && t <= sessionStart;
      });
      if (!inWindow.length) return null;
      const carbs = inWindow.reduce((s, e) => s + (Number(e?.macros?.carbs) || Number(e?.carbs) || 0), 0);
      return { value: Math.round(carbs), sublabel: '2hr pre' };
    },
    available: (ctx) => Array.isArray(ctx.nutritionLog) && ctx.nutritionLog.length > 0,
  },
  {
    id: 'postTrainingProtein', label: 'Post-Training Protein', category: 'strength', unit: 'g',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [25, 100], amber: [15, 25], red: [0, 15] },
    // Per-session post-fuel: sum protein from nutritionLog entries within
    // the 60-min window AFTER each strength session ends.
    timeframes: (ctx) => timeframesFromCollection(
      ctx.activities,
      {
        filter: a => isStrengthAct(a) && a?.startTime && a?.durationSecs,
        valueField: a => {
          const tMatch = String(a.startTime).match(/(\d{1,2}):(\d{2})/);
          if (!tMatch) return null;
          const [, hh, mm] = tMatch;
          const sessionStart = new Date(`${a.date}T${hh.padStart(2, '0')}:${mm}:00`);
          if (isNaN(sessionStart.getTime())) return null;
          const sessionEnd = new Date(sessionStart.getTime() + a.durationSecs * 1000);
          const windowEnd = new Date(sessionEnd.getTime() + 60 * 60 * 1000);
          let protein = 0; let any = false;
          for (const e of (ctx.nutritionLog || [])) {
            if (!e?.timestamp) continue;
            const t = new Date(e.timestamp);
            if (t >= sessionEnd && t <= windowEnd) {
              protein += Number(e?.macros?.protein) || Number(e?.protein) || 0;
              any = true;
            }
          }
          return any ? protein : null;
        },
        mode: 'avg', ytdMode: 'avg',
      }
    ),
    compute: (ctx) => {
      const s = latestStrength(ctx.activities);
      if (!s?.startTime || !s?.durationSecs) return null;
      const tMatch = String(s.startTime).match(/(\d{1,2}):(\d{2})/);
      if (!tMatch) return null;
      const [, hh, mm] = tMatch;
      const sessionStart = new Date(`${s.date}T${hh.padStart(2, '0')}:${mm}:00`);
      const sessionEnd = new Date(sessionStart.getTime() + s.durationSecs * 1000);
      const windowEnd = new Date(sessionEnd.getTime() + 60 * 60 * 1000);
      const log = ctx.nutritionLog || [];
      const inWindow = log.filter(e => {
        if (!e?.timestamp) return false;
        const t = new Date(e.timestamp);
        return t >= sessionEnd && t <= windowEnd;
      });
      if (!inWindow.length) return null;
      const protein = inWindow.reduce((s, e) => s + (Number(e?.macros?.protein) || Number(e?.protein) || 0), 0);
      return { value: Math.round(protein), sublabel: '60min post' };
    },
    available: (ctx) => Array.isArray(ctx.nutritionLog) && ctx.nutritionLog.length > 0,
  },

  // ═══ RECOVERY ══════════════════════════════════════════════════════════
  {
    id: 'overnightHRV', label: 'Overnight HRV', category: 'recovery', unit: 'ms',
    polarity: 'higher-better',
    // Adult-male reference ranges (loose). Without a personal baseline we use
    // typical ranges; long-term, ideally calibrated to user's 90d distribution.
    thresholds: { green: [40, 999], amber: [30, 40], red: [0, 30] },
    // Combine HRV sources by date:
    //   - sleep collection (Phase 4c Garmin Worker): each night has overnightHRV
    //   - hrvData collection (manual Garmin HRV CSV imports): per-day observations
    // Worker source wins on dates where both exist (it's authoritative — same
    // upstream as Garmin Connect itself). Falls back to manual CSV otherwise.
    historyOf: (ctx) => mergedHrvByDate(ctx).map(o => o.overnightHRV),
    compute: (ctx) => {
      const merged = mergedHrvByDate(ctx);
      const recent = merged.filter(o => isWithinDays(o.date, 7));
      if (!recent.length) return null;
      const v = avg(recent, 'overnightHRV');
      const sourceLabels = new Set(recent.map(o => o.source));
      const sourceTag = sourceLabels.size === 1
        ? (sourceLabels.has('worker') ? 'worker · 7d avg' : 'csv · 7d avg')
        : '7d avg';
      return { value: Math.round(v), sublabel: sourceTag };
    },
    ytdMode: 'avg',
    timeframes: (ctx) => {
      const merged = mergedHrvByDate(ctx);
      return timeframesFromCollection(
        merged, { valueField: o => o.overnightHRV, mode: 'avg', ytdMode: 'avg' }
      );
    },
  },
  {
    id: 'rhr', label: 'RHR', category: 'recovery', unit: 'bpm',
    polarity: 'lower-better',
    ytdMode: 'avg',
    thresholds: { green: [0, 55], amber: [55, 65], red: [65, 200] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.sleepData,
      { valueField: s => s?.restingHR, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => [...(ctx.sleepData || [])]
      .filter(s => s?.restingHR)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.restingHR),
    compute: (ctx) => {
      const sleeps = [...(ctx.sleepData || [])]
        .filter(s => s?.restingHR)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!sleeps.length) return null;
      return { value: Math.round(sleeps[0].restingHR), sublabel: sleeps[0].date };
    },
  },
  {
    // Phase 4r.recovery.1 — RHR trend tile.
    // The plain `rhr` tile shows last night's value. This one shows the
    // 7-day running mean and compares it against the 28-day trimmed mean
    // — early-warning signal for overtraining (RHR creeping up while
    // load stays high), illness onset (RHR jumps overnight 24-48h
    // before symptoms), and aerobic adaptation (RHR drifting down over
    // weeks). Same data source as the rhr tile (sleepData.restingHR);
    // different time window and emphasis.
    //
    // Coloring: green when 7-day delta is ±2bpm of 28-day baseline
    // (normal variation), amber when 3-4bpm off, red when ≥5bpm off
    // in either direction. The sign of the delta is in the sublabel
    // so the user sees direction at a glance. Pillar: recovery.
    id: 'rhrTrend', label: 'RHR Trend', category: 'recovery', unit: 'bpm',
    polarity: 'lower-better',
    pillar: 'recovery',
    subgroup: 'hr',
    thresholds: null,  // colored by delta in compute()
    timeframes: (ctx) => timeframesFromCollection(
      ctx.sleepData,
      { valueField: s => s?.restingHR, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => [...(ctx.sleepData || [])]
      .filter(s => s?.restingHR)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.restingHR),
    compute: (ctx) => {
      const samples = [...(ctx.sleepData || [])]
        .filter(s => s?.date && s?.restingHR != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (samples.length < 7) return null;
      const inRange = v => Number.isFinite(v) && v >= 30 && v <= 100;
      // Last 7 days mean (no trim — short window).
      const last7 = samples.slice(0, 7).map(s => Number(s.restingHR)).filter(inRange);
      if (last7.length < 4) return null;
      const avg7 = last7.reduce((s, v) => s + v, 0) / last7.length;
      // 28-day trimmed mean (drop top/bottom 10%).
      const window28 = samples.slice(0, 28).map(s => Number(s.restingHR)).filter(inRange);
      if (window28.length < 7) return null;
      const sorted28 = [...window28].sort((a, b) => a - b);
      const drop = Math.floor(sorted28.length * 0.10);
      const kept28 = sorted28.slice(drop, sorted28.length - drop);
      const trimmed28 = kept28.reduce((s, v) => s + v, 0) / kept28.length;
      const delta = avg7 - trimmed28;
      const absDelta = Math.abs(delta);
      // Best/worst in last 90 days (advisory context).
      const window90 = samples.slice(0, 90).map(s => ({ v: Number(s.restingHR), d: s.date })).filter(x => inRange(x.v));
      let best = window90[0], worst = window90[0];
      for (const x of window90) {
        if (x.v < best.v) best = x;
        if (x.v > worst.v) worst = x;
      }
      // Color logic — small drift is normal, sustained drift in either
      // direction is the signal. Up = warning (overtraining/illness),
      // down = positive (adaptation).
      let color = 'var(--text-secondary, #888)';
      let advisoryTone = null;
      if (absDelta < 2)        { color = '#4ade80';  advisoryTone = 'normal'; }
      else if (absDelta < 3.5) { color = '#fbbf24';  advisoryTone = delta > 0 ? 'monitor_up' : 'monitor_down'; }
      else                     { color = delta > 0 ? '#f87171' : '#60a5fa';
                                 advisoryTone = delta > 0 ? 'flag_up' : 'flag_down'; }
      const sign = delta >= 0 ? '+' : '';
      const advisory = (() => {
        switch (advisoryTone) {
          case 'normal':       return 'normal variation';
          case 'monitor_up':   return 'monitor — sleep, stress';
          case 'monitor_down': return 'aerobic adaptation?';
          case 'flag_up':      return 'consider load / illness';
          case 'flag_down':    return 'fitness improving';
          default:             return null;
        }
      })();
      return {
        value: Math.round(avg7),
        sublabel: `${sign}${delta.toFixed(1)} vs 28d (${Math.round(trimmed28)})${advisory ? ` · ${advisory}` : ''}`,
        color,
        // Extra context the tile expander can show:
        meta: {
          last7Avg:    +avg7.toFixed(1),
          trimmed28:   +trimmed28.toFixed(1),
          delta:       +delta.toFixed(1),
          best90:      best ? { value: best.v, date: best.d } : null,
          worst90:     worst ? { value: worst.v, date: worst.d } : null,
          samplesUsed: { last7: last7.length, last28: window28.length },
        },
      };
    },
    available: (ctx) => Array.isArray(ctx.sleepData)
      && ctx.sleepData.filter(s => s?.restingHR != null).length >= 7,
  },
  {
    id: 'sleepScore', label: 'Sleep Score', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [80, 100], amber: [60, 80], red: [0, 60] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.sleepData,
      { valueField: s => s?.sleepScore, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => [...(ctx.sleepData || [])]
      .filter(s => s?.sleepScore != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(s => s.sleepScore),
    compute: (ctx) => {
      const sleeps = [...(ctx.sleepData || [])]
        .filter(s => s?.sleepScore != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (!sleeps.length) return null;
      return { value: Math.round(Math.min(sleeps[0].sleepScore, 100)), sublabel: sleeps[0].date };
    },
  },
  {
    id: 'morningBodyBattery', label: 'Body Battery', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    thresholds: { green: [70, 100], amber: [50, 70], red: [0, 50] },
    // Field-priority for resilience (Garmin's reports/daily endpoint can return
    // sparse intraday samples, which leaves bodyBatteryStart null even when
    // charged/drained come through fine):
    //   1. bodyBatteryStart  — first intraday sample = true morning value
    //   2. bodyBatteryMax    — peak of the day (almost always morning)
    //   3. bodyBatteryEnd    — most recent sample (current value)
    //   4. derive from charged/drained: assume net change starts from yesterday's end
    historyOf: (ctx) => (ctx.wellness || [])
      .map(w => bodyBatteryDerived(w))
      .filter(v => v != null)
      .sort((_a, _b) => 0) // already ordered by date in collection — keep insertion order
      .reverse(),
    compute: (ctx) => {
      const wm = (ctx.wellness || []).find(w => w?.date === localToday());
      if (!wm) return null;
      const v = bodyBatteryDerived(wm);
      if (v == null) return null;
      const sub = wm.bodyBatteryStart != null ? 'morning'
                : wm.bodyBatteryMax  != null ? 'peak today'
                : wm.bodyBatteryEnd  != null ? 'current'
                : `+${wm.bodyBatteryCharged ?? 0}/-${wm.bodyBatteryDrained ?? 0}`;
      return { value: Math.round(v), sublabel: sub };
    },
    available: (ctx) => (ctx.wellness || []).some(w =>
      w?.bodyBatteryStart != null
      || w?.bodyBatteryMax != null
      || w?.bodyBatteryEnd != null
      || w?.bodyBatteryCharged != null
    ),
    ytdMode: 'avg',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.wellness,
      { valueField: w => bodyBatteryDerived(w), mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'dailyStress', label: 'Daily Stress', category: 'recovery', unit: '/100',
    polarity: 'lower-better',
    ytdMode: 'avg',
    thresholds: { green: [0, 30], amber: [30, 60], red: [60, 100] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.wellness,
      { valueField: w => w?.avgStress, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.avgStress != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.avgStress),
    compute: (ctx) => {
      // Prefer today's row; fall back to the most recent date with avgStress.
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.avgStress != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.avgStress != null) ? today : fallback;
      if (!wm || wm.avgStress == null) return null;
      const sublabel = wm.date === localToday() ? 'today' : wm.date;
      return { value: Math.round(wm.avgStress), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.avgStress != null),
  },
  {
    id: 'trainingReadiness', label: 'Training Readiness', category: 'recovery', unit: '/100',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [70, 100], amber: [40, 70], red: [0, 40] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.wellness,
      { valueField: w => w?.trainingReadiness, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.trainingReadiness != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.trainingReadiness),
    compute: (ctx) => {
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.trainingReadiness != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.trainingReadiness != null) ? today : fallback;
      if (!wm || wm.trainingReadiness == null) return null;
      const sublabel = wm.date === localToday() ? 'today' : wm.date;
      return { value: Math.round(wm.trainingReadiness), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.trainingReadiness != null),
  },
  {
    id: 'recoveryHours', label: 'Recovery Hours', category: 'recovery', unit: 'h',
    polarity: 'lower-better',
    ytdMode: 'avg',
    thresholds: { green: [0, 12], amber: [12, 36], red: [36, 999] },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.wellness,
      { valueField: w => w?.recoveryHours, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => (ctx.wellness || [])
      .filter(w => w?.recoveryHours != null)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.recoveryHours),
    compute: (ctx) => {
      const today = (ctx.wellness || []).find(w => w?.date === localToday());
      const fallback = [...(ctx.wellness || [])]
        .filter(w => w?.recoveryHours != null)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      const wm = (today?.recoveryHours != null) ? today : fallback;
      if (!wm || wm.recoveryHours == null) return null;
      const sublabel = wm.date === localToday() ? 'until baseline' : `as of ${wm.date}`;
      return { value: Math.round(wm.recoveryHours), sublabel };
    },
    available: (ctx) => (ctx.wellness || []).some(w => w?.recoveryHours != null),
  },
  {
    id: 'sleepRegularity', label: 'Sleep Regularity', category: 'recovery', unit: 'min',
    polarity: 'lower-better',
    ytdMode: 'avg',
    thresholds: { green: [0, 30], amber: [30, 60], red: [60, 999] },
    // Per-night sample = the 7-night-prior onset-time SD as of that night.
    // Aggregator then rolls those daily SD samples into week / 8-wk / YTD
    // averages — answers "how consistent has my bedtime been on average
    // across this period?".
    timeframes: (ctx) => {
      const allRows = (ctx.sleepData || []).filter(s => s?.date && (s.bedtime || s.sleepStart));
      if (allRows.length < 3) return null;
      const byDate = new Map();
      for (const s of allRows) {
        const t = String(s.bedtime || s.sleepStart);
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) continue;
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (mins >= 18 * 60) mins -= 24 * 60; // late evening → negative for cleaner SD math
        byDate.set(s.date, mins);
      }
      // For each night with data, compute the SD over the prior 7 nights.
      const samples = [];
      const sortedDates = [...byDate.keys()].sort();
      for (const d of sortedDates) {
        const dt = new Date(`${d}T12:00:00`);
        const window = [];
        for (let j = 0; j < 7; j++) {
          const wd = new Date(dt);
          wd.setDate(dt.getDate() - j);
          const ds = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
          if (byDate.has(ds)) window.push(byDate.get(ds));
        }
        if (window.length < 3) continue;
        const mean = window.reduce((s, v) => s + v, 0) / window.length;
        const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
        samples.push({ date: d, value: Math.round(Math.sqrt(variance)) });
      }
      return aggregateTimeframes(samples, { mode: 'avg', ytdMode: 'avg' });
    },
    // historyOf: rolling 7-night SD computed at each of the last 30 days.
    // Mean of that series = "typical weekly bedtime consistency this month".
    // Averaging windowed-statistics (not raw values) so the 30d avg is
    // meaningful for a derived metric.
    historyOf: (ctx) => {
      const allRows = (ctx.sleepData || []).filter(s => s?.date && (s.bedtime || s.sleepStart));
      if (allRows.length < 3) return [];
      // Build a date→onsetMin map
      const byDate = new Map();
      for (const s of allRows) {
        const t = String(s.bedtime || s.sleepStart);
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) continue;
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        if (mins >= 18 * 60) mins -= 24 * 60;
        byDate.set(s.date, mins);
      }
      // For each day in last 30, compute SD of the 7 prior days that have data
      const out = [];
      const today = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const window = [];
        for (let j = 0; j < 7; j++) {
          const wd = new Date(d);
          wd.setDate(d.getDate() - j);
          const ds = `${wd.getFullYear()}-${String(wd.getMonth() + 1).padStart(2, '0')}-${String(wd.getDate()).padStart(2, '0')}`;
          if (byDate.has(ds)) window.push(byDate.get(ds));
        }
        if (window.length < 3) continue;
        const mean = window.reduce((s, v) => s + v, 0) / window.length;
        const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
        out.push(Math.round(Math.sqrt(variance)));
      }
      return out;
    },
    compute: (ctx) => {
      const recent = filterByDateGe(ctx.sleepData || [], daysAgo(7))
        .filter(s => s?.bedtime || s?.sleepStart);
      if (recent.length < 3) return null;
      const onsetMinutes = recent.map(s => {
        const t = String(s.bedtime || s.sleepStart);
        const m = t.match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
        // Normalize: bedtimes between 6pm-6am → centered around midnight
        // 22:00 = 1320 → -120 (relative to midnight)
        // 02:00 = 120 (already past midnight)
        if (mins >= 18 * 60) mins -= 24 * 60; // late evening → negative
        return mins;
      }).filter(v => v != null);
      if (onsetMinutes.length < 3) return null;
      const m = onsetMinutes.reduce((s, v) => s + v, 0) / onsetMinutes.length;
      const variance = onsetMinutes.reduce((s, v) => s + (v - m) ** 2, 0) / onsetMinutes.length;
      const stdMin = Math.round(Math.sqrt(variance));
      return { value: `±${stdMin}`, sublabel: '7-night SD' };
    },
    available: (ctx) => (ctx.sleepData || []).filter(s => s?.bedtime || s?.sleepStart).length >= 3,
  },

  // ═══ BODY ══════════════════════════════════════════════════════════════
  {
    id: 'totalCal', label: 'Calories', category: 'body', unit: 'kcal',
    subgroup: 'fuel',
    polarity: 'target',
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'calories'), { mode: 'avg', ytdMode: 'avg' }
    ),
    // Both compute and historyOf use macroForDate so the Cronometer Worker's
    // full-day entries are picked up (they were being missed by the raw
    // todayLog reduce, which only summed manual entries).
    historyOf: (ctx) => macroHistory30(ctx, 'calories'),
    compute: (ctx) => {
      const today = localToday();
      const cal = macroForDate(ctx, today, 'calories');
      if (cal <= 0) return null;
      // Phase 4r.dataspine.4 — canonical Layer 3 reader.
      const target = (() => {
        try { return getEffectiveTargets({ date: today }).dailyCalories.effective; }
        catch { return null; }
      })();
      if (!target) return null;
      const pct = cal / target;
      return {
        value: Math.round(cal),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'protein', label: 'Protein', category: 'body', unit: 'g',
    subgroup: 'fuel',
    polarity: 'higher-better', // for protein, going OVER target is fine
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'protein'), { mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => macroHistory30(ctx, 'protein'),
    compute: (ctx) => {
      const today = localToday();
      const p = macroForDate(ctx, today, 'protein');
      if (p <= 0) return null;
      const target = ctx.profile?.dailyProteinTarget || 150;
      const pct = p / target;
      return {
        value: Math.round(p),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'higher'),
      };
    },
  },
  {
    id: 'carbs', label: 'Carbs', category: 'body', unit: 'g',
    subgroup: 'fuel',
    polarity: 'target',
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'carbs'), { mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => macroHistory30(ctx, 'carbs'),
    compute: (ctx) => {
      const today = localToday();
      const c = macroForDate(ctx, today, 'carbs');
      if (c <= 0) return null;
      const target = ctx.profile?.dailyCarbTarget || 250;
      const pct = c / target;
      return {
        value: Math.round(c),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'fat', label: 'Fat', category: 'body', unit: 'g',
    subgroup: 'fuel',
    polarity: 'target',
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'fat'), { mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => macroHistory30(ctx, 'fat'),
    compute: (ctx) => {
      const today = localToday();
      const f = macroForDate(ctx, today, 'fat');
      if (f <= 0) return null;
      const target = ctx.profile?.dailyFatTarget || 70;
      const pct = f / target;
      return {
        value: Math.round(f),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
  },
  {
    id: 'fiber', label: 'Fiber', category: 'body', unit: 'g',
    subgroup: 'quality',
    polarity: 'higher-better',
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'fiber'), { mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => macroHistory30(ctx, 'fiber'),
    compute: (ctx) => {
      const today = localToday();
      const f = macroForDate(ctx, today, 'fiber');
      if (f <= 0) return null;
      const target = ctx.profile?.dailyFiberTarget || 30;
      const pct = f / target;
      return {
        value: Math.round(f),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'higher'),
      };
    },
  },
  {
    id: 'micronutrientScore', label: 'Micros', category: 'body', unit: '%',
    subgroup: 'quality',
    polarity: 'higher-better',
    ytdMode: 'avg',
    thresholds: { green: [80, 100], amber: [50, 80], red: [0, 50] },
    // Per-day score = (# of tracked micros >= RDI) / (# tracked) × 100.
    // Walks both the legacy cronometer collection (uses parens-style keys)
    // AND the nutritionLog full-day extended block (worker shape) so users
    // on either path get a populated tile.
    timeframes: (ctx) => {
      // RDI references (US adult male). Each entry maps both possible field
      // names: legacy "Foo (unit)" and worker-flat camelCase.
      const RDI_FIELDS = [
        { rdi: 90,   keys: ['Vitamin C (mg)', 'vitaminC'] },
        { rdi: 600,  keys: ['Vitamin D (IU)', 'vitaminD'] },
        { rdi: 2.4,  keys: ['Vitamin B12 (µg)', 'vitaminB12'] },
        { rdi: 420,  keys: ['Magnesium (mg)', 'magnesium'] },
        { rdi: 3400, keys: ['Potassium (mg)', 'potassium'] },
        { rdi: 8,    keys: ['Iron (mg)', 'iron'] },
        { rdi: 11,   keys: ['Zinc (mg)', 'zinc'] },
        { rdi: 1000, keys: ['Calcium (mg)', 'calcium'] },
      ];
      const scoreOne = (lookups) => {
        let hit = 0, total = 0;
        for (const { rdi, keys } of RDI_FIELDS) {
          let v = null;
          for (const k of keys) {
            for (const src of lookups) {
              const x = parseFloat(src?.[k]);
              if (isFinite(x)) { v = x; break; }
            }
            if (v != null) break;
          }
          if (v == null) continue;
          total++;
          if (v >= rdi) hit++;
        }
        return total > 0 ? { hit, total } : null;
      };
      const samples = [];
      const seenDates = new Set();
      // 1) nutritionLog full-day entries (Worker source, current path)
      for (const e of (ctx.nutritionLog || [])) {
        if (e?.meal !== 'full-day' || !e?.date) continue;
        const score = scoreOne([e?.extended, e?.macros, e?.totals, e]);
        if (!score) continue;
        seenDates.add(e.date);
        samples.push({ date: e.date, value: Math.round((score.hit / score.total) * 100) });
      }
      // 2) Legacy cronometer collection — only for dates not already covered
      for (const r of (ctx.cronometer || [])) {
        if (!r?.date || seenDates.has(r.date)) continue;
        const score = scoreOne([r?.totals, r]);
        if (!score) continue;
        samples.push({ date: r.date, value: Math.round((score.hit / score.total) * 100) });
      }
      return aggregateTimeframes(samples, { mode: 'avg', ytdMode: 'avg' });
    },
    // Roll-up: percentage of tracked micronutrients hitting their RDI today.
    // Reads from BOTH sources — the modern nutritionLog (Cronometer worker
    // writes here, with extended micros under e.extended) AND the legacy
    // cronometer collection. Mirrors the field-name handling in
    // timeframes() above so users on either path get a populated tile.
    compute: (ctx) => {
      const today = localToday();
      // RDI references (US adult male). Each entry maps both possible
      // field names: legacy "Foo (unit)" and worker-flat camelCase.
      const RDI_FIELDS = [
        { rdi: 90,   keys: ['Vitamin C (mg)', 'vitaminC'] },
        { rdi: 600,  keys: ['Vitamin D (IU)', 'vitaminD'] },
        { rdi: 2.4,  keys: ['Vitamin B12 (µg)', 'vitaminB12'] },
        { rdi: 420,  keys: ['Magnesium (mg)', 'magnesium'] },
        { rdi: 3400, keys: ['Potassium (mg)', 'potassium'] },
        { rdi: 8,    keys: ['Iron (mg)', 'iron'] },
        { rdi: 11,   keys: ['Zinc (mg)', 'zinc'] },
        { rdi: 1000, keys: ['Calcium (mg)', 'calcium'] },
      ];
      // Resolve the value of a field across an ordered list of source
      // objects, returning the first finite numeric hit. Worker entries
      // typically expose micros under `extended`, legacy uses `totals`.
      const lookupVal = (lookups, keys) => {
        for (const k of keys) {
          for (const src of lookups) {
            const x = parseFloat(src?.[k]);
            if (isFinite(x)) return x;
          }
        }
        return null;
      };
      // Try modern nutritionLog full-day entry first, then legacy cronometer.
      const todayLog = (ctx.nutritionLog || []).find(e => e?.meal === 'full-day' && e?.date === today);
      const todayCrono = (ctx.cronometer || []).find(r => r?.date === today);
      const lookups = todayLog
        ? [todayLog?.extended, todayLog?.macros, todayLog?.totals, todayLog]
        : todayCrono
        ? [todayCrono?.totals, todayCrono]
        : null;
      if (!lookups) return null;
      let hit = 0, total = 0;
      for (const { rdi, keys } of RDI_FIELDS) {
        const v = lookupVal(lookups, keys);
        if (v == null) continue;
        total++;
        if (v >= rdi) hit++;
      }
      if (total === 0) return null;
      return { value: Math.round((hit / total) * 100), sublabel: `${hit}/${total} hit` };
    },
    available: (ctx) =>
      (Array.isArray(ctx.nutritionLog) && ctx.nutritionLog.some(e => e?.meal === 'full-day' && (e?.extended || e?.totals))) ||
      (Array.isArray(ctx.cronometer)   && ctx.cronometer.some(r => r?.totals || r?.['Magnesium (mg)'])),
  },
  {
    id: 'weightTrend', label: 'Weight Trend', category: 'body', unit: 'lb',
    subgroup: 'composition',
    // Polarity depends on user's goal direction. Without an explicit "cut"
    // / "bulk" / "maintain" flag in profile, treat as 'target' against the
    // user's targetWeight. If no target set, polarity falls to 'neutral'.
    polarity: 'target',
    ytdMode: 'avg',
    timeframes: (ctx) => timeframesFromCollection(
      ctx.weightData,
      { valueField: w => w?.weightLbs ?? w?.weight, mode: 'avg', ytdMode: 'avg' }
    ),
    historyOf: (ctx) => [...(ctx.weightData || [])]
      .filter(w => w?.weightLbs)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map(w => w.weightLbs),
    compute: (ctx) => {
      const recent = filterByDateGe(ctx.weightData || [], daysAgo(7))
        .filter(w => w?.weightLbs);
      if (!recent.length) return null;
      const v = avg(recent, 'weightLbs');
      const target = ctx.profile?.targetWeight || null;
      return {
        value: v.toFixed(1),
        sublabel: target ? `target ${target}` : '7d avg',
      };
    },
    trendOf: (ctx) => {
      // Prior 7-14d for the trend arrow
      const prev = filterByDateGe(ctx.weightData || [], daysAgo(14))
        .filter(w => w?.weightLbs && w.date < new Date(daysAgo(7)).toISOString().slice(0, 10));
      if (!prev.length) return null;
      return avg(prev, 'weightLbs');
    },
  },
  {
    id: 'sodium', label: 'Sodium', category: 'body', unit: 'mg',
    subgroup: 'quality',
    polarity: 'target',
    ytdMode: 'avg',
    timeframes: (ctx) => aggregateTimeframes(
      _nutritionSamples(ctx, 'sodium'), { mode: 'avg', ytdMode: 'avg' }
    ),
    // Sodium is in nutritionLog full-day entries' `extended` block (cronometer-
    // client.js) — macroForDate handles both the new path and the legacy
    // cronometer collection. Includes 30d history for the avg30 slot.
    historyOf: (ctx) => macroHistory30(ctx, 'sodium'),
    compute: (ctx) => {
      const today = localToday();
      let v = macroForDate(ctx, today, 'sodium');
      // Legacy cronometer used "Sodium (mg)" key in totals — keep that path
      // as a final fallback for old data.
      if (v <= 0) {
        const todayCrono = (ctx.cronometer || []).find(r => r?.date === today);
        const totals = todayCrono?.totals || todayCrono;
        v = totals ? parseFloat(totals['Sodium (mg)']) : 0;
      }
      if (!isFinite(v) || v <= 0) return null;
      const target = ctx.profile?.dailySodiumTarget || 2300;
      const pct = v / target;
      return {
        value: Math.round(v),
        sublabel: `goal ${target}`,
        pct,
        status: statusFromPct(pct, 'window'),
      };
    },
    available: (ctx) => Array.isArray(ctx.cronometer) && ctx.cronometer.some(r => {
      const t = r?.totals || r;
      return t && t['Sodium (mg)'] != null;
    }),
  },

  // ═══ BODY — COMPOSITION (Phase 4m.2) ═══════════════════════════════════
  // Sources: ctx.weightData rows (DEXA / scale / manual). Each row may
  // carry { date, weight, bodyFatPct, leanMass, bmi } depending on source.
  {
    id: 'bodyFatPct', label: 'Body Fat', category: 'body', unit: '%',
    subgroup: 'composition',
    polarity: 'lower-better',
    ytdMode: 'avg',
    // Scale rows often have bodyFatPct stored as 0 when the impedance read
    // failed — guard with > 0 so we don't average in junk samples.
    // Phase 4r.design.2 — add historyOf so the 30d-avg backfill in
    // MetricTile can compute "30d avg" from the last 30 valid samples.
    historyOf: (ctx) => (ctx.weightData || [])
      .filter(r => r?.bodyFatPct != null && Number(r.bodyFatPct) > 0)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 30)
      .map(r => +Number(r.bodyFatPct).toFixed(1)),
    compute: (ctx) => {
      const w = (ctx.weightData || [])
        .filter(r => r?.bodyFatPct != null && Number(r.bodyFatPct) > 0)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      if (!w) return null;
      return { value: +Number(w.bodyFatPct).toFixed(1), sublabel: w.date };
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.weightData,
      { valueField: r => {
          const v = Number(r?.bodyFatPct);
          return Number.isFinite(v) && v > 0 ? v : null;
        },
        mode: 'avg', ytdMode: 'avg' }
    ),
  },
  {
    id: 'leanMass', label: 'Lean Mass', category: 'body', unit: 'lb',
    subgroup: 'composition',
    polarity: 'higher-better',
    ytdMode: 'avg',
    // Priority chain (matches the existing Dashboard UI):
    //   1. r.skeletalMuscleMassLbs — direct from Garmin Index scale
    //   2. derived weightLbs × (1 - bodyFatPct/100)  — for rows with bf% but no muscle field
    // Both must produce a positive result (junk-row guard).
    compute: (ctx) => {
      const sorted = [...(ctx.weightData || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const w of sorted) {
        const direct = Number(w?.skeletalMuscleMassLbs);
        if (Number.isFinite(direct) && direct > 0 && direct < 300) {
          return { value: +direct.toFixed(1), sublabel: w.date };
        }
        const wt = Number(w?.weightLbs ?? w?.weight);
        const bf = Number(w?.bodyFatPct);
        if (Number.isFinite(wt) && wt > 0 && Number.isFinite(bf) && bf > 0) {
          return { value: +(wt * (1 - bf / 100)).toFixed(1), sublabel: w.date };
        }
      }
      return null;
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.weightData,
      {
        valueField: r => {
          const direct = Number(r?.skeletalMuscleMassLbs);
          if (Number.isFinite(direct) && direct > 0 && direct < 300) return direct;
          const wt = Number(r?.weightLbs ?? r?.weight);
          const bf = Number(r?.bodyFatPct);
          if (!Number.isFinite(wt) || wt <= 0 || !Number.isFinite(bf) || bf <= 0) return null;
          return wt * (1 - bf / 100);
        },
        mode: 'avg', ytdMode: 'avg',
      }
    ),
  },
  {
    id: 'bmi', label: 'BMI', category: 'body', unit: '',
    subgroup: 'composition',
    polarity: 'lower-better',
    ytdMode: 'avg',
    // Priority chain:
    //   1. r.bmi from Garmin Index scale row (most reliable, already plausibility-checked)
    //   2. computed from weight + profile height (fallback)
    // Phase 4r.design.2 — add historyOf for the 30d-avg backfill.
    // Mirrors the compute() priority chain: prefer r.bmi when valid,
    // else compute from weightLbs + profile height.
    historyOf: (ctx) => {
      const heightIn = parseFloat(ctx.profile?.heightInches) ||
                       (parseFloat(ctx.profile?.heightFt) * 12 + parseFloat(ctx.profile?.heightIn || 0));
      const sorted = [...(ctx.weightData || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 30);
      const out = [];
      for (const r of sorted) {
        const direct = Number(r?.bmi);
        if (Number.isFinite(direct) && direct >= 10 && direct <= 60) {
          out.push(+direct.toFixed(1));
          continue;
        }
        if (!heightIn) continue;
        const wt = Number(r?.weightLbs ?? r?.weight);
        if (!Number.isFinite(wt) || wt <= 0) continue;
        out.push(+(703 * wt / (heightIn * heightIn)).toFixed(1));
      }
      return out;
    },
    compute: (ctx) => {
      const sorted = [...(ctx.weightData || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const w of sorted) {
        const direct = Number(w?.bmi);
        if (Number.isFinite(direct) && direct >= 10 && direct <= 60) {
          return { value: +direct.toFixed(1), sublabel: w.date };
        }
      }
      // Fallback: compute from weight + profile height
      const heightIn = parseFloat(ctx.profile?.heightInches) ||
                       (parseFloat(ctx.profile?.heightFt) * 12 + parseFloat(ctx.profile?.heightIn || 0));
      if (!heightIn) return null;
      const w = sorted[0];
      const wt = Number(w?.weightLbs ?? w?.weight);
      if (!Number.isFinite(wt) || wt <= 0) return null;
      return { value: +(703 * wt / (heightIn * heightIn)).toFixed(1), sublabel: w.date };
    },
    timeframes: (ctx) => {
      const heightIn = parseFloat(ctx.profile?.heightInches) ||
                       (parseFloat(ctx.profile?.heightFt) * 12 + parseFloat(ctx.profile?.heightIn || 0));
      return timeframesFromCollection(
        ctx.weightData,
        {
          valueField: r => {
            const direct = Number(r?.bmi);
            if (Number.isFinite(direct) && direct >= 10 && direct <= 60) return direct;
            if (!heightIn) return null;
            const wt = Number(r?.weightLbs ?? r?.weight);
            return Number.isFinite(wt) && wt > 0 ? 703 * wt / (heightIn * heightIn) : null;
          },
          mode: 'avg', ytdMode: 'avg',
        }
      );
    },
  },
  {
    id: 'rmr', label: 'RMR', category: 'body', unit: 'kcal',
    subgroup: 'quality',
    polarity: 'higher-better',
    ytdMode: 'avg',
    // Katch-McArdle: RMR = 370 + 21.6 × LBM_kg
    // Walk weight rows newest-first, find one with both weight + non-zero
    // body fat, derive LBM from weight × (1 - bf/100). Skip rows where
    // bf=0 (failed impedance read) so we don't return RMR(weight) by accident.
    compute: (ctx) => {
      const sorted = [...(ctx.weightData || [])]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const w of sorted) {
        const wt = Number(w?.weightLbs ?? w?.weight);
        const bf = Number(w?.bodyFatPct);
        if (!Number.isFinite(wt) || wt <= 0 || !Number.isFinite(bf) || bf <= 0) continue;
        const lbmLbs = wt * (1 - bf / 100);
        const lbmKg = lbmLbs / 2.20462;
        return { value: Math.round(370 + 21.6 * lbmKg), sublabel: w.date };
      }
      return null;
    },
    timeframes: (ctx) => timeframesFromCollection(
      ctx.weightData,
      {
        valueField: r => {
          const wt = Number(r?.weightLbs ?? r?.weight);
          const bf = Number(r?.bodyFatPct);
          // Need both, AND a non-zero body fat — otherwise we'd compute
          // RMR from weight × 1 = weight, which is meaningless.
          if (!Number.isFinite(wt) || wt <= 0 || !Number.isFinite(bf) || bf <= 0) return null;
          const lbmKg = (wt * (1 - bf / 100)) / 2.20462;
          return 370 + 21.6 * lbmKg;
        },
        mode: 'avg', ytdMode: 'avg',
      }
    ),
  },

  // ═══ COACH-SIGNAL VISUALIZATIONS — Phase 4r.narrative.4d ═══════════════
  // These tiles surface the v2 coach-signal block (recovery velocity, TDEE
  // drift, energy availability, glycogen) as visual artifacts. They read
  // pre-computed values from ctx.coachSignals — same single source of truth
  // the Coach narrative uses, so the numbers shown here match the prose
  // exactly. When coachSignals isn't in the ctx (e.g., Start screen if it
  // doesn't yet pass it through), the tile renders as "no data" rather
  // than crashing.

  // ─── Recovery velocity ────────────────────────────────────────────────────
  {
    id: 'recoveryVelocity', label: 'Recovery velocity', category: 'recovery', unit: 'd',
    polarity: 'lower-better',  // shorter days-to-recover = better
    ytdMode: 'avg',
    compute: (ctx) => {
      const rv = ctx?.coachSignals?.recoveryVelocity;
      if (!rv || rv.status === 'insufficient' || rv.avgDaysToRecover == null) return null;
      const status =
        rv.status === 'concerning' ? 'red'
        : rv.status === 'slowing'    ? 'amber'
        : rv.status === 'improving'  ? 'green'
        : null;
      const sub = rv.baselineAvg != null
        ? `${rv.driftPct != null ? (rv.driftPct > 0 ? '+' : '') + rv.driftPct + '% vs ' : 'baseline '}${rv.baselineAvg}d`
        : null;
      return { value: rv.avgDaysToRecover, sublabel: sub, status };
    },
    available: (ctx) => !!(ctx?.coachSignals?.recoveryVelocity && ctx.coachSignals.recoveryVelocity.avgDaysToRecover != null),
  },

  // ─── TDEE drift ───────────────────────────────────────────────────────────
  {
    id: 'tdeeDrift', label: 'TDEE drift', category: 'body', unit: 'kcal',
    polarity: 'neutral', // direction depends on goal — going up could be good (rebounding) or neutral
    ytdMode: 'avg',
    compute: (ctx) => {
      const t = ctx?.coachSignals?.tdeeDrift;
      if (!t || t.status === 'insufficient' || t.recentTdee == null) return null;
      const status =
        t.status === 'starvation' ? 'red'
        : t.status === 'adapting'  ? 'amber'
        : t.status === 'rebounding'? 'green'
        : null;
      const sub = t.driftPct != null && t.baselineTdee != null
        ? `${t.driftPct > 0 ? '+' : ''}${t.driftPct}% vs prior 4w (${t.baselineTdee})`
        : null;
      return { value: t.recentTdee, sublabel: sub, status };
    },
    available: (ctx) => !!(ctx?.coachSignals?.tdeeDrift && ctx.coachSignals.tdeeDrift.recentTdee != null),
  },

  // ─── Energy availability ──────────────────────────────────────────────────
  {
    id: 'energyAvailability', label: 'Energy avail', category: 'body', unit: 'kcal/kg',
    polarity: 'higher-better',  // higher EA = more energy left for non-exercise function
    thresholds: { green: [40, 999], amber: [30, 40], red: [0, 30] },
    ytdMode: 'avg',
    compute: (ctx) => {
      const ea = ctx?.coachSignals?.energyAvailability;
      if (!ea || !Number.isFinite(Number(ea.eaKcalPerKgLBM))) return null;
      const status =
        ea.status === 'deficient' ? 'red'
        : ea.status === 'low'      ? 'amber'
        : ea.status === 'sufficient' ? 'green'
        : null;
      const sub = ea.netKcal != null && ea.lbmKg != null
        ? `${Math.round(ea.netKcal)} net · ${ea.lbmKg.toFixed(1)}kg LBM`
        : null;
      return { value: Math.round(ea.eaKcalPerKgLBM), sublabel: sub, status };
    },
    available: (ctx) => !!(ctx?.coachSignals?.energyAvailability && ctx.coachSignals.energyAvailability.eaKcalPerKgLBM != null),
  },

  // ─── Glycogen state ───────────────────────────────────────────────────────
  {
    id: 'glycogen', label: 'Glycogen', category: 'body', unit: '%',
    polarity: 'higher-better',
    thresholds: { green: [80, 999], amber: [50, 80], red: [0, 50] },
    ytdMode: 'avg',
    compute: (ctx) => {
      const g = ctx?.coachSignals?.glycogen;
      if (!g || !Number.isFinite(Number(g.adequacyRatio))) return null;
      const status =
        g.status === 'critical' ? 'red'
        : g.status === 'depleted'? 'amber'
        : g.status === 'replete' || g.status === 'moderate' ? 'green'
        : null;
      const sub = g.supplied24h != null && g.need24h != null
        ? `${g.supplied24h}g / ${g.need24h}g need · 24h`
        : null;
      const lowConf = g.confidence === 'low';
      return {
        value: Math.round(g.adequacyRatio * 100),
        sublabel: lowConf ? `${sub} · est` : sub,
        status,
        pct: Math.min(1, Math.max(0, g.adequacyRatio)),
      };
    },
    available: (ctx) => !!(ctx?.coachSignals?.glycogen && Number.isFinite(Number(ctx.coachSignals.glycogen.adequacyRatio))),
  },
];

// ── Defaults for new users ──────────────────────────────────────────────────
// Picked to be useful from day one: covers the most-commonly-available
// data for a Garmin + Cronometer + Health Connect setup. User can change
// any of these at any time via the Goals → Customize Start tiles picker.
export const DEFAULT_TILE_PREFS = {
  // Run defaults reflect race-prep diagnostic value: aerobic base volume
  // (Z2), efficiency drift (decoupling), injury risk (ACWR), turnover
  // (cadence). VO/GCT/AnaerobicTE remain in the registry as toggleable
  // options for users who want the biomechanics view, but aren't default.
  run:      ['avgRunHR', 'zone2Weekly', 'aerobicDecoupling', 'acwr'],
  strength: ['avgStrengthHR', 'sessionDuration', 'activeStrengthCal', 'epoc'],
  recovery: ['overnightHRV', 'rhr', 'sleepScore', 'sleepRegularity'],
  body:     ['totalCal', 'protein', 'weightTrend', 'fiber'],
};

// ── Lookup helpers ──────────────────────────────────────────────────────────

const _byId = new Map(TILE_METRICS.map(m => [m.id, m]));
export const getMetric = (id) => _byId.get(id);

export const metricsByCategory = (category) =>
  TILE_METRICS.filter(m => m.category === category);

// ── Validation: clamp user prefs to min 2 / max 4 + drop unknown ids ───────

export function normalizeTilePrefs(prefs) {
  const out = { run: [], strength: [], recovery: [], body: [] };
  for (const cat of Object.keys(out)) {
    const incoming = Array.isArray(prefs?.[cat]) ? prefs[cat] : [];
    const valid = incoming.filter(id => {
      const m = _byId.get(id);
      return m && m.category === cat;
    });
    // Pad with defaults if below min, truncate if above max
    let chosen = valid.slice(0, 4);
    if (chosen.length < 2) {
      const fallback = DEFAULT_TILE_PREFS[cat] || [];
      for (const id of fallback) {
        if (chosen.length >= 2) break;
        if (!chosen.includes(id)) chosen.push(id);
      }
    }
    out[cat] = chosen;
  }
  return out;
}

// ── Context builder ─────────────────────────────────────────────────────────
// Single function that gathers everything any metric might need from storage.
// Called once per render rather than each metric reading storage individually.
export function buildTileContext({ activities, sleepData, hrvData, weightData, nutritionLog, cronometer, dailyLogs, profile, wellness, races, coachSignals }) {
  return {
    activities: activities || [],
    sleepData: sleepData || [],
    hrvData: hrvData || [],
    weightData: weightData || [],
    nutritionLog: nutritionLog || [],
    cronometer: cronometer || [],
    dailyLogs: dailyLogs || [],
    profile: profile || {},
    wellness: wellness || [], // Phase 4 — empty until Garmin Connect Wellness sync ships
    races: races || [],       // Phase 4m.2.5 — used by Race Predictor to pick the right distance
    // Phase 4r.narrative.4d — coachSignals carries pre-computed v2 signals
    // (recovery velocity, TDEE drift, energy availability, glycogen, etc.)
    // for tiles that surface those as visual artifacts. Optional — tiles
    // that depend on it gracefully render null when it's absent.
    coachSignals: coachSignals || null,
  };
}

// Phase 4r.design.3 — protein tile 30d-avg debug. Run in console to see
// exactly what macroForDate/macroHistory30 finds for the last 30 days:
//   shape of nutritionLog rows, dates that returned > 0, dates that
//   returned 0 (and why). Surfaces whether the issue is empty
//   nutritionLog, missing 'full-day' meal rows, or a date format mismatch.
if (typeof window !== 'undefined') {
  // Phase 4r.race.1 — race predictor diagnostic. Surfaces which anchor was
  // picked, what Garmin predicted, and the gap between them. Run after the
  // tile feels off to see why.
  window.racePredictorDebug = function () {
    const _storage = (typeof window !== 'undefined') ? window.__arnoldStorage : null;
    const activities = _storage ? (_storage.get('activities') || []) : [];
    console.log('=== RACE PREDICTOR DEBUG ===');
    console.log('total activities:', activities.length);
    const runs = activities.filter(a => isRun(a) && a?.distanceMi && a?.durationSecs);
    console.log('qualifying run activities:', runs.length);
    const anchor = findEmpiricalRaceAnchor(activities);
    if (anchor) {
      console.log(`anchor picked: tier=${anchor.tier} · ${anchor.label}`);
      console.log('  run:', {
        date: anchor.run.date,
        distanceMi: anchor.run.distanceMi,
        durationSecs: anchor.run.durationSecs,
        avgHR: anchor.run.avgHR,
        maxHR: anchor.run.maxHR,
      });
      console.log('  Riegel projections:', {
        t5k:  riegelPredictFromRun(anchor.run, 't5k'),
        t10k: riegelPredictFromRun(anchor.run, 't10k'),
        tHM:  riegelPredictFromRun(anchor.run, 'tHM'),
        tM:   riegelPredictFromRun(anchor.run, 'tM'),
      });
    } else {
      console.warn('NO empirical anchor found in last 24 weeks. Falling back to Garmin.');
    }
    const garminMostRecent = activities
      .filter(a => a?.racePredictor)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (garminMostRecent) {
      console.log('Garmin racePredictor (most recent):', {
        date: garminMostRecent.date,
        ...garminMostRecent.racePredictor,
      });
    } else {
      console.log('No Garmin racePredictor block found in any activity.');
    }
    return { anchor, garmin: garminMostRecent?.racePredictor };
  };

  window.proteinTileDebug = function () {
    // Phase 4r.process.5 — read through the storage abstraction (which
    // routes to IndexedDB when the Phase 7 engine is attached), NOT
    // localStorage directly. The previous version of this helper read
    // localStorage and reported 0 nutritionLog rows — but the tile
    // pipeline reads through storage.get() which sees the IndexedDB
    // contents. That mismatch led to a false "data is stale" diagnosis.
    // window.__arnoldStorage is wired up in Arnold.jsx at boot.
    const _storage = (typeof window !== 'undefined') ? window.__arnoldStorage : null;
    let nutritionLog = [];
    let cronometer = [];
    if (_storage) {
      try { nutritionLog = _storage.get('nutritionLog') || []; } catch {}
      try { cronometer   = _storage.get('cronometer')   || []; } catch {}
    } else {
      console.warn('window.__arnoldStorage not available — debug results may be incomplete. Reload the app.');
      try { nutritionLog = (window.localStorage && JSON.parse(localStorage.getItem('arnold:nutritionLog') || '[]')) || []; } catch {}
      try { cronometer   = (window.localStorage && JSON.parse(localStorage.getItem('arnold:cronometer') || '[]')) || []; } catch {}
    }
    const ctx = { nutritionLog, cronometer };
    const fullDayRows = nutritionLog.filter(e => e?.meal === 'full-day');
    console.log('=== PROTEIN TILE DEBUG ===');
    console.log('nutritionLog total rows:', nutritionLog.length);
    console.log('  of which meal=full-day:', fullDayRows.length);
    console.log('  unique meal values in nutritionLog:', [...new Set(nutritionLog.map(e => e?.meal))]);
    console.log('  sample full-day row:', fullDayRows[0] || '(none)');
    console.log('cronometer legacy rows:', cronometer.length);
    // Phase 4r.process.4 — surface cronometer date range + most-recent dates
    // so we can tell whether the issue is "data is too old for the window" vs
    // "lookup is mismatched on a date that IS in the window".
    const cronoDates = cronometer
      .map(c => c?.date)
      .filter(Boolean)
      .sort();
    console.log('  cronometer date range:', cronoDates[0] || '—', '→', cronoDates[cronoDates.length - 1] || '—');
    console.log('  most recent 5 cronometer dates:', cronoDates.slice(-5));
    console.log('  type of first cronometer.date:', typeof cronometer[0]?.date, '· raw value:', JSON.stringify(cronometer[0]?.date));
    console.log('  sample cronometer row (newest by date):', cronometer.find(c => c?.date === cronoDates[cronoDates.length - 1]) || '(none)');
    const today = new Date();
    const series = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const v = macroForDate(ctx, ds, 'protein');
      // Also report whether ANY cronometer row exists for that ds, so we
      // can distinguish "no data on that date" from "data exists but
      // protein field missing/wrong key".
      const cronoHit = cronometer.find(c => c?.date === ds);
      series.push({ date: ds, protein: v, found: v > 0, cronoHasRow: !!cronoHit, cronoProteinField: cronoHit?.protein ?? '—' });
    }
    console.table(series);
    const found = series.filter(s => s.found);
    const cronoHitsInWindow = series.filter(s => s.cronoHasRow).length;
    console.log(`30d avg basis: ${found.length}/${series.length} days had protein > 0`);
    console.log(`Cronometer rows present in 30d window: ${cronoHitsInWindow}/${series.length}`);
    if (found.length) {
      const avg = found.reduce((s, x) => s + x.protein, 0) / found.length;
      console.log(`  computed avg: ${avg.toFixed(1)}g (this is what the tile should show)`);
    } else if (cronoHitsInWindow > 0) {
      console.warn('Cronometer rows exist in the 30d window but protein field is empty/zero — field-name mismatch.');
    } else if (cronoDates.length > 0) {
      const newest = cronoDates[cronoDates.length - 1];
      const daysOld = Math.round((today - new Date(newest)) / 86400000);
      console.warn(`Your most recent Cronometer row is ${newest} (${daysOld} days ago). The 30d window starts at ${series[series.length - 1].date} — no overlap. Re-import recent data or enable the live Cronometer Worker.`);
    } else {
      console.warn('No Cronometer data at all. Import a CSV or enable the live Cronometer Worker.');
    }
    return { nutritionLogCount: nutritionLog.length, fullDayCount: fullDayRows.length, cronometerCount: cronometer.length, daysFound: found.length, cronoHitsInWindow };
  };
}
