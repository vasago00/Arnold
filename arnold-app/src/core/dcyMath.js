// ─── DCY math helpers ────────────────────────────────────────────────────────
// TRIMP, EWMA, session stress, daily stress, and fitness/fatigue stocks.
// Public API is re-exported through `dcy.js`. Pure math + storage reads —
// no UI, no side effects.

import { localDate, addDays } from './time.js';
import { computeRTSS, computeTonnage, matchTemplate } from './trainingStress.js';
import { storage } from './storage.js';
import { getGoals } from './goals.js';

// ─── Tunable constants (DCY_SPEC §2, §8) ─────────────────────────────────────
export const TAU_FITNESS = 42;
export const TAU_FATIGUE = 7;
export const ALPHA_FITNESS = 1 - Math.exp(-1 / TAU_FITNESS); // ≈0.0235
export const ALPHA_FATIGUE = 1 - Math.exp(-1 / TAU_FATIGUE); // ≈0.1331
export const TRIMP_Y_MALE = 1.92;
export const TRIMP_Y_FEMALE = 1.67;
export const TRIMP_K = 0.64;
export const TONNAGE_TO_TSS_K = 150;  // empirical — tuned by calibrateTonnage()
export const SEED_WINDOW_DAYS = 60;   // Option B seeding (DCY_SPEC §11.1)

// Recovery-pillar windows (DCY_SPEC §4.1)
export const HRV_ACUTE_DAYS = 7;
export const HRV_CHRONIC_DAYS = 28;
export const RHR_ACUTE_DAYS = 7;
export const RHR_CHRONIC_DAYS = 28;

// Recovery-pillar weights (DCY_SPEC §4.3) — arithmetic mean, not geometric,
// so a missing input degrades R gracefully instead of zeroing it.
export const R_WEIGHT_HRV = 0.45;
export const R_WEIGHT_RHR = 0.30;
export const R_WEIGHT_SLEEP = 0.25;

// Sleep-stage healthy-range midpoints (DCY_SPEC §4.2)
export const DEEP_PCT_TARGET = 0.15;
export const REM_PCT_TARGET = 0.22;

// Late-arriving body-signal lookback (DCY_SPEC §4.4 / design R5)
export const BODY_LOOKBACK_HOURS = 36;

// ─── Fuel-pillar constants (DCY_SPEC §3) ────────────────────────────────────
// Atwater coefficients for macros — used by TEF and any future macro→cal calc.
export const KCAL_PER_G_PROTEIN = 4;
export const KCAL_PER_G_CARB = 4;
export const KCAL_PER_G_FAT = 9;

// Thermic effect of food: ~10% of intake calories.
export const TEF_FACTOR = 0.10;

// Fuel sub-score weights — geometric mean per DCY_SPEC §3.4.
// Calories dominate, protein second, hydration is the gate.
export const N_WEIGHT_CAL = 0.50;
export const N_WEIGHT_PROTEIN = 0.35;
export const N_WEIGHT_HYDRO = 0.15;

// Unit conversion shared across pillars.
export const KG_PER_LB = 0.4536;
export const CM_PER_INCH = 2.54;

// MET activity table — used as a TDEE fallback when an activity row has no
// `calories` field. Values are conservative midpoints per Compendium of
// Physical Activities. Calories ≈ MET · kg · hours.
export const MET_TABLE = {
  run: 9.0, running: 9.0,
  cycle: 7.5, cycling: 7.5, bike: 7.5, biking: 7.5,
  walk: 3.5, walking: 3.5,
  hike: 6.0, hiking: 6.0,
  strength: 5.0, weight: 5.0, gym: 5.0, lifting: 5.0,
  hyrox: 8.0, circuit: 7.0, crossfit: 8.0,
  swim: 7.0, swimming: 7.0,
  yoga: 2.5, mobility: 2.5, stretch: 2.0,
  row: 7.0, rowing: 7.0,
  default: 4.0,
};

// Pick the best MET match for an activity, preferring activityType over name.
// Falls back to MET_TABLE.default if nothing matches.
export function metFor(activityType, activityName) {
  const t = String(activityType || '').toLowerCase();
  const n = String(activityName || '').toLowerCase();
  for (const key of Object.keys(MET_TABLE)) {
    if (key === 'default') continue;
    if (t.includes(key) || n.includes(key)) return MET_TABLE[key];
  }
  return MET_TABLE.default;
}

// Geometric mean with re-normalized weights. `parts` is an array of
// `{w, v}` objects; missing/null values are dropped and the remaining
// weights are renormalized so a missing pillar doesn't zero the product.
// Returns null when no usable parts (caller decides fallback).
export function geomMeanWeighted(parts) {
  const ok = parts.filter((p) => p && p.v != null && !isNaN(p.v) && p.v > 0 && p.w > 0);
  if (ok.length === 0) return null;
  const wSum = ok.reduce((s, p) => s + p.w, 0);
  // ∏ v_i^(w_i / wSum)
  let logSum = 0;
  for (const p of ok) logSum += (p.w / wSum) * Math.log(p.v);
  return Math.exp(logSum);
}

// ─── Pure stat helpers ──────────────────────────────────────────────────────
// Mean of a numeric array with nulls/NaNs skipped. Returns null when empty so
// callers can distinguish "no data" from "average happens to be 0".
export function meanSkipNull(values) {
  if (!Array.isArray(values)) return null;
  let sum = 0, n = 0;
  for (const v of values) {
    const num = Number(v);
    if (v == null || isNaN(num)) continue;
    sum += num; n++;
  }
  return n === 0 ? null : sum / n;
}

// Clip a number to [lo, hi]. Nulls pass through unchanged.
export function clip(x, lo, hi) {
  if (x == null || isNaN(x)) return null;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// ─── TRIMP ──────────────────────────────────────────────────────────────────
// TRIMP = (durationMin) · HRR · 0.64 · e^(y · HRR),  HRR ∈ [0,1]
// Returns a TSS-equivalent number (same scale as rTSS).
export function trimp({ durationSecs, avgHR, hrRest, hrMax, sex } = {}) {
  if (!durationSecs || !avgHR || !hrRest || !hrMax) return 0;
  if (hrMax <= hrRest) return 0;
  let hrr = (avgHR - hrRest) / (hrMax - hrRest);
  if (hrr <= 0) return 0;
  if (hrr > 1) hrr = 1;
  const y = sex === 'F' ? TRIMP_Y_FEMALE : TRIMP_Y_MALE;
  const mins = durationSecs / 60;
  return +(mins * hrr * TRIMP_K * Math.exp(y * hrr)).toFixed(2);
}

// ─── Session context bundle ─────────────────────────────────────────────────
// Read once per pipeline invocation — cheap to rebuild but avoids re-reading
// storage for every activity in a loop.
export function buildSessionContext() {
  const profile = storage.get('profile') || {};
  const goals = getGoals();
  const sleep = storage.get('sleep') || [];
  const hrvData = storage.get('hrv') || [];
  const templates = storage.get('strengthTemplates') || [];

  const latestSleep = [...sleep].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const hrRest = Number(
    latestSleep?.restingHR
    ?? hrvData.find((h) => h.restingHR)?.restingHR
    ?? profile.restingHR
    ?? 55
  );
  const age = parseFloat(profile.age) || null;
  const hrMax = parseFloat(profile.maxHR) || (age ? 220 - age : null) || 190;
  const sex = profile.sex === 'F' ? 'F' : 'M';
  const ftpPace = goals.functionalThresholdPace || '8:30';
  const bodyweight = parseFloat(goals.targetWeight) || parseFloat(profile.weight) || 175;

  return { hrRest, hrMax, sex, age, ftpPace, bodyweight, templates };
}

// ─── Per-activity stress (TSS-equivalent scale) ─────────────────────────────
// Dispatch: run → rTSS, HR present → TRIMP, strength → tonnage/K.
export function sessionStress(activity, ctx) {
  if (!activity) return 0;
  const c = ctx || buildSessionContext();
  const type = String(activity.activityType || '').toLowerCase();
  const name = String(activity.activityName || '').toLowerCase();
  const avgHR = Number(activity.avgHeartRate ?? activity.avgHR) || null;
  const durationSecs = Number(activity.durationSecs) || 0;

  if (/run/.test(type) && activity.avgPaceRaw && durationSecs > 0) {
    const { rTSS } = computeRTSS({ durationSecs, avgPaceRaw: activity.avgPaceRaw, avgHR, ftpPace: c.ftpPace });
    if (rTSS != null) return rTSS;
  }
  if (durationSecs > 0 && avgHR && c.hrRest && c.hrMax) {
    const t = trimp({ durationSecs, avgHR, hrRest: c.hrRest, hrMax: c.hrMax, sex: c.sex });
    if (t > 0) return t;
  }
  if (/strength|weight|gym|hyrox|circuit/.test(type) || /hyrox|circuit/.test(name)) {
    const tpl = matchTemplate(activity, c.templates);
    if (tpl) {
      const { totalTonnage } = computeTonnage(tpl, null, c.bodyweight);
      if (totalTonnage > 0) return +(totalTonnage / TONNAGE_TO_TSS_K).toFixed(2);
    }
    if (activity.tonnage > 0) return +(activity.tonnage / TONNAGE_TO_TSS_K).toFixed(2);
  }
  return 0;
}

// ─── Activity universe (merged stored + daily FIT, matches computeDailyScore)
let _activityUniverseCache = { hash: null, list: null };
function activitiesHash() {
  const a = storage.get('activities') || [];
  const d = storage.get('dailyLogs') || [];
  return `${a.length}:${d.length}:${a[a.length - 1]?.date || ''}:${d[d.length - 1]?.date || ''}`;
}
export function allActivities() {
  const h = activitiesHash();
  if (_activityUniverseCache.hash === h && _activityUniverseCache.list) return _activityUniverseCache.list;
  const stored = storage.get('activities') || [];
  const dailyLogs = storage.get('dailyLogs') || [];
  const fitActs = [];
  for (const l of dailyLogs) {
    if (!l?.date) continue;
    const fits = Array.isArray(l.fitActivities) && l.fitActivities.length
      ? l.fitActivities
      : (l.fitData ? [l.fitData] : []);
    for (const fd of fits) if (fd) fitActs.push({ ...fd, date: l.date, source: 'daily_fit' });
  }
  const list = [...stored.filter((a) => a.source !== 'health_connect'), ...fitActs];
  _activityUniverseCache = { hash: h, list };
  return list;
}

// ─── Daily stress sum ───────────────────────────────────────────────────────
export function dailyStress(dateStr) {
  const date = dateStr || localDate();
  const acts = allActivities().filter((a) => a.date === date);
  if (acts.length === 0) return 0;
  const ctx = buildSessionContext();
  let sum = 0;
  for (const a of acts) sum += sessionStress(a, ctx);
  return +sum.toFixed(2);
}

// ─── EWMA (continuous) ──────────────────────────────────────────────────────
// α = 1 − exp(−1/τ). Single pass over a date-sorted series.
export function ewmaSeries(series, tau, seed = 0) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const alpha = 1 - Math.exp(-1 / tau);
  let prev = seed;
  const out = new Array(series.length);
  for (let i = 0; i < series.length; i++) {
    prev = alpha * (Number(series[i].value) || 0) + (1 - alpha) * prev;
    out[i] = { date: series[i].date, value: prev };
  }
  return out;
}

// ─── Daily-stress series (earliest activity → refDate, gap-filled with 0) ───
function dailyStressSeries(refDate) {
  const ref = refDate || localDate();
  const acts = allActivities();
  if (acts.length === 0) return [];
  let start = acts[0].date;
  for (const a of acts) if (a.date && a.date < start) start = a.date;
  if (!start || start > ref) return [];
  const ctx = buildSessionContext();
  const perDate = Object.create(null);
  for (const a of acts) {
    if (!a.date || a.date > ref) continue;
    perDate[a.date] = (perDate[a.date] || 0) + sessionStress(a, ctx);
  }
  const series = [];
  let cursor = start;
  while (cursor <= ref) {
    series.push({ date: cursor, value: perDate[cursor] || 0 });
    cursor = addDays(cursor, 1);
  }
  return series;
}

// ─── F / G stocks with caching ──────────────────────────────────────────────
let _stockCache = { hash: null, byDate: Object.create(null) };
function getStocks(refDate) {
  const ref = refDate || localDate();
  const h = activitiesHash();
  if (_stockCache.hash !== h) _stockCache = { hash: h, byDate: Object.create(null) };
  if (_stockCache.byDate[ref]) return _stockCache.byDate[ref];

  const series = dailyStressSeries(ref);
  if (series.length === 0) {
    const empty = { F: 0, G: 0, series: [] };
    _stockCache.byDate[ref] = empty;
    return empty;
  }
  const seedWindow = series.slice(0, Math.min(SEED_WINDOW_DAYS, series.length));
  const seed = seedWindow.reduce((s, p) => s + p.value, 0) / (seedWindow.length || 1);
  const fSeries = ewmaSeries(series, TAU_FITNESS, seed);
  const gSeries = ewmaSeries(series, TAU_FATIGUE, seed);
  const last = (arr) => arr[arr.length - 1]?.value ?? 0;
  const result = {
    F: +last(fSeries).toFixed(2),
    G: +last(gSeries).toFixed(2),
    series, fSeries, gSeries,
    seed: +seed.toFixed(2),
    firstDate: series[0].date,
    lastDate: series[series.length - 1].date,
  };
  _stockCache.byDate[ref] = result;
  return result;
}

export function fitnessStock(refDate) { return getStocks(refDate).F; }
export function fatigueStock(refDate) { return getStocks(refDate).G; }

// ─── Calibration report — tonnage ↔ TRIMP alignment ─────────────────────────
// Walks recent history and reports the multiplier that best aligns rTSS,
// TRIMP, and tonnage-per-TSS for this specific user's data.
export function calibrateTonnage() {
  const ctx = buildSessionContext();
  const acts = allActivities();
  const runs = [];
  const strengthPaired = [];
  for (const a of acts) {
    const type = String(a.activityType || '').toLowerCase();
    const avgHR = Number(a.avgHeartRate ?? a.avgHR) || null;
    const dur = Number(a.durationSecs) || 0;
    if (!avgHR || !dur) continue;
    if (/run/.test(type) && a.avgPaceRaw) {
      const { rTSS } = computeRTSS({ durationSecs: dur, avgPaceRaw: a.avgPaceRaw, avgHR, ftpPace: ctx.ftpPace });
      const tr = trimp({ durationSecs: dur, avgHR, hrRest: ctx.hrRest, hrMax: ctx.hrMax, sex: ctx.sex });
      if (rTSS > 0 && tr > 0) runs.push({ date: a.date, rTSS, trimp: tr, ratio: rTSS / tr });
    } else if (/strength|weight|gym|hyrox|circuit/.test(type)) {
      const tpl = matchTemplate(a, ctx.templates);
      if (!tpl) continue;
      const { totalTonnage } = computeTonnage(tpl, null, ctx.bodyweight);
      const tr = trimp({ durationSecs: dur, avgHR, hrRest: ctx.hrRest, hrMax: ctx.hrMax, sex: ctx.sex });
      if (totalTonnage > 0 && tr > 0) strengthPaired.push({ date: a.date, tonnage: totalTonnage, trimp: tr, k: totalTonnage / tr });
    }
  }
  const avg = (arr, key) => arr.length ? +(arr.reduce((s, x) => s + x[key], 0) / arr.length).toFixed(2) : null;
  return {
    runs: { count: runs.length, rTssPerTrimp: avg(runs, 'ratio'), samples: runs.slice(0, 5) },
    strength: { count: strengthPaired.length, tonnagePerTrimpK: avg(strengthPaired, 'k'), samples: strengthPaired.slice(0, 5) },
    currentConstants: { TRIMP_K, TONNAGE_TO_TSS_K, TAU_FITNESS, TAU_FATIGUE, ALPHA_FITNESS, ALPHA_FATIGUE },
  };
}
