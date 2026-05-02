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

// ─── Activity universe — SINGLE SOURCE OF TRUTH for unified activity reads ─
//
// Every UI surface that wants a deduplicated, source-prioritized view of
// the user's workouts calls this function. Previously useMobileData,
// MobileEdgeIQ, SystemDetailPanel, and Arnold.jsx getUnifiedActivities
// each had their own parallel implementation; drift between them caused
// mile/workout-count discrepancies (CSV-imported runs and FIT-uploaded
// runs of the same physical activity double-counted because their dedup
// keys were different shapes). Consolidated 2026-04 into this one helper.
//
// SOURCE PRIORITY (highest wins):
//   1. `activities` collection (Garmin CSV imports + manual entries).
//      The trusted, full-record source.
//   2. `dailyLogs[date].fitActivities[]` (FIT uploads via Today's
//      Training UploadPill). Filled in ONLY for (date, canonicalType)
//      slots that #1 doesn't already cover.
//
// EXCLUDED: entries with `source: 'health_connect'` — Phase 4a disabled
// HC's exercise sync; any remaining HC rows in storage are stale ghosts.
//
// DEDUP: by (date, canonicalType). Garmin CSV labels a run as
// `activityType: 'Running'` with title `'New York - Fartlek 100'`; a
// FIT upload of the same run uses `activityType: 'Running'`. Both
// collapse via canonicalize(), so today's run counts once not twice.

function canonicalActivityType(s) {
  if (!s) return 'workout';
  const l = String(s).toLowerCase();
  if (/run/.test(l))                                return 'run';
  if (/strength|weight|gym|hyrox|circuit/.test(l))  return 'strength';
  if (/walk/.test(l))                               return 'walk';
  if (/cycle|bike|cycling/.test(l))                 return 'cycling';
  if (/swim/.test(l))                               return 'swim';
  if (/ski/.test(l))                                return 'ski';
  return l;
}

let _activityUniverseCache = { hash: null, list: null };
function activitiesHash() {
  const a = storage.get('activities') || [];
  const d = storage.get('dailyLogs') || [];
  // Sum fitActivities counts across all dailyLogs so adding a FIT to an
  // existing day's log invalidates the cache (without this, the dailyLogs
  // array length stays the same and a stale list is returned forever).
  let fitCount = 0;
  for (const log of d) {
    if (Array.isArray(log?.fitActivities)) fitCount += log.fitActivities.length;
  }
  return `${a.length}:${d.length}:${fitCount}:${a[a.length - 1]?.date || ''}:${d[d.length - 1]?.date || ''}`;
}

export function allActivities() {
  const h = activitiesHash();
  if (_activityUniverseCache.hash === h && _activityUniverseCache.list) return _activityUniverseCache.list;

  const stored = (storage.get('activities') || []).filter(a => a && a.source !== 'health_connect');
  const dailyLogs = storage.get('dailyLogs') || [];

  // SEMANTICS:
  //   - CSV is authoritative for SESSION COUNT. Two CSV runs on the same day
  //     = two distinct sessions (user explicitly added them, e.g. morning +
  //     evening). They both stay in the unified list.
  //   - FIT entries fill EMPTY slots (date+canon-type with no CSV) — these
  //     are runs that haven't been imported via CSV yet (e.g. today's FIT
  //     before the YTD CSV is re-imported).
  //   - FIT entries can REPLACE a CSV stub (a CSV row with 0 distance and
  //     0/very-short duration) when FIT has real data — fixes the case where
  //     Garmin's batch export pre-creates placeholder rows that block real
  //     sensor data.
  //   - FIT entries that match a real CSV entry (same date, same canon-type,
  //     similar distance) are duplicate sources of the same activity → drop.
  //
  // The previous "keep both if both have real distance" heuristic
  // double-counted runs whenever CSV + FIT covered the same activity, which
  // happens routinely after a YTD CSV import that includes today's run plus
  // today's FIT upload. CSV-authoritative semantics is more predictable.
  const isFit = a => (a?.source === 'fit-daily' || a?.source?.type === 'fit');
  const naturalKey = a => `${a.date}|${a.title || a.activityType || ''}|${a.startTime || a.time || ''}`;
  const slotKey = a => `${a.date}|${canonicalActivityType(a.activityType || a.title)}`;
  const isStub = a => (a?.distanceMi || 0) < 0.1 && (a?.durationSecs || 0) < 60;

  const byNaturalKey = new Map();
  // Track ALL entries (with full data) per slot so we can find a stub to
  // replace when FIT comes in.
  const slotEntries = new Map(); // slotKey -> array of naturalKeys

  // Pass 1: stored CSV/manual activities — every entry kept, multiple per
  // (date, canon-type) slot allowed.
  for (const a of stored) {
    if (!a?.date) continue;
    const nk = naturalKey(a);
    if (byNaturalKey.has(nk)) continue; // exact duplicate within CSV — skip
    byNaturalKey.set(nk, a);
    const sk = slotKey(a);
    if (!slotEntries.has(sk)) slotEntries.set(sk, []);
    slotEntries.get(sk).push(nk);
  }

  // Pass 2: FIT entries from dailyLogs.fitActivities[]
  // FIT parser emits activityType labels like "Run (outdoor)" / "Strength" /
  // "Cycling". Garmin's CSV export uses "Running" / "Strength Training" /
  // "Cycling". Downstream filters in Arnold.jsx (e.g., the weekly Training
  // panel's `runs = a => /running|trail/i.test(a.activityType)`) expect the
  // CSV-style names — so when a FIT entry would surface in the unified list,
  // we relabel it to the Garmin CSV convention. Without this, FIT-only runs
  // get classified as "other" and disappear from weekly run counts.
  const garminStyleType = (rawType) => {
    const canon = canonicalActivityType(rawType);
    switch (canon) {
      case 'run':      return 'Running';
      case 'strength': return 'Strength Training';
      case 'walk':     return 'Walking';
      case 'cycling':  return 'Cycling';
      case 'swim':     return 'Swimming';
      case 'ski':      return 'Resort Skiing';
      default:         return rawType || 'Workout';
    }
  };
  for (const log of dailyLogs) {
    if (!log?.date) continue;
    const fits = Array.isArray(log.fitActivities) && log.fitActivities.length
      ? log.fitActivities
      : (log.fitData ? [log.fitData] : []);
    for (const fd of fits) {
      if (!fd) continue;
      const rawType = fd.activityType || fd.type || 'workout';
      const enriched = {
        date: log.date,
        activityType: garminStyleType(rawType),
        title: fd.title || rawType,
        distanceMi: fd.distanceMi || null,
        distanceKm: fd.distanceKm || (fd.distanceMi ? +(fd.distanceMi * 1.60934).toFixed(2) : null),
        durationSecs: fd.durationSecs || (fd.durationMins ? fd.durationMins * 60 : 0),
        avgPaceRaw: fd.avgPacePerMi || fd.avgPaceRaw || null,
        avgHR: fd.avgHR || null,
        maxHR: fd.maxHR || null,
        calories: fd.calories || null,
        startTime: fd.startTime || fd.time || null,
        source: 'fit-daily',
      };
      const fitNk = naturalKey(enriched);
      const fitSk = slotKey(enriched);
      const fitMi = enriched.distanceMi || 0;
      // Exact natural-key dedup (re-uploading same FIT)
      if (byNaturalKey.has(fitNk)) continue;
      const slotNks = slotEntries.get(fitSk) || [];
      if (slotNks.length === 0) {
        // No CSV in this slot — add FIT as a new entry
        byNaturalKey.set(fitNk, enriched);
        slotEntries.set(fitSk, [fitNk]);
        continue;
      }
      // CSV exists in slot. Check if any CSV entry is a stub we can replace.
      const stubNk = slotNks.find(nk => isStub(byNaturalKey.get(nk)));
      if (stubNk && fitMi >= 0.1) {
        // Replace the stub with this FIT (richer data, same session count)
        byNaturalKey.delete(stubNk);
        byNaturalKey.set(fitNk, enriched);
        slotEntries.set(fitSk, [...slotNks.filter(k => k !== stubNk), fitNk]);
        continue;
      }
      // Else: CSV claims slot with real data → FIT is duplicate source of an
      // existing CSV session. Drop it. (User can re-import the YTD CSV if
      // they want fresher Garmin-side aggregates; otherwise the existing
      // entry stands.)
    }
  }

  const list = [...byNaturalKey.values()].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  _activityUniverseCache = { hash: h, list };
  return list;
}

// Exported for any consumer that needs the same canonicalization rule
// (DCY math, planner readers, etc.) — keeps it in one place.
export { canonicalActivityType };

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
