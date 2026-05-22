// ─── Predicted Bands assembly (Phase 4r.intel.11 — Layer 3) ────────────────
// Wraps expectedRanges.predictedBandsForFamily with everything it needs to
// build a UI-ready forecast: family + conditions + fatigue + baseline.
//
// API:
//   buildPredictionContext({ family, dateStr }) → ctx
//   getPredictedBands({ family, dateStr }) → { bands, ctx, source }
//
// "Source" tells the UI which inputs were filled in vs. defaulted, so the
// card can render "personalized (n=18)" vs "population norm" annotations.

import { predictedBandsForFamily, EXPECTED_RANGES } from './expectedRanges.js';
import { getBaseline } from './learnedBaselines.js';
import { storage } from './storage.js';
import { parseLocalDate } from './dateUtils.js';
import { fetchWeatherForActivity } from './weather.js';
import { isHIIT, isHardSession } from './activityClass.js';

// ─── helpers ───────────────────────────────────────────────────────────────

const PIN_CACHE_KEY = 'arnold:dropPinCoords';
const PIN_TTL_MS    = 6 * 60 * 60 * 1000;          // 6 hours
const RECENT_ACT_MS = 3 * 24 * 60 * 60 * 1000;     // 3 days

function _validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
      && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
      && Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001;
}

/**
 * Priority order (Phase 4r.intel.11c — travel-aware):
 *   1. Drop-a-pin cache (last 6h, set by user tapping the card button)
 *   2. Most recent activity with GPS in the last 3 days — "where you are now"
 *   3. profile.homeLatitude / homeLongitude — explicit home set by user
 *   4. Any activity with GPS anywhere in history — last resort
 *
 * The flip from home-first to recent-first means traveling for the summer
 * doesn't render predictions against your home weather.
 */
function getHomeCoords() {
  // 1. Drop-a-pin cache (6h TTL)
  try {
    const pin = storage.get(PIN_CACHE_KEY);
    if (pin && Number.isFinite(pin.at) && (Date.now() - pin.at) < PIN_TTL_MS
        && _validCoord(Number(pin.lat), Number(pin.lon))) {
      return { lat: Number(pin.lat), lon: Number(pin.lon), source: 'pin' };
    }
  } catch {}
  // 2. Most recent activity with GPS in the last 3 days
  try {
    const acts = storage.get('activities') || [];
    const cutoff = Date.now() - RECENT_ACT_MS;
    for (let i = acts.length - 1; i >= 0; i--) {
      const a = acts[i];
      const lat = Number(a?.startLatitude ?? a?.lat);
      const lon = Number(a?.startLongitude ?? a?.lon);
      if (!_validCoord(lat, lon)) continue;
      const ad = a?.date && parseLocalDate(a.date);
      if (ad && ad.getTime() >= cutoff) return { lat, lon, source: 'recent-act' };
    }
  } catch {}
  // 3. Profile-set home location
  try {
    const p = storage.get('profile') || {};
    const lat = Number(p.homeLatitude ?? p.lat);
    const lon = Number(p.homeLongitude ?? p.lon);
    if (_validCoord(lat, lon)) return { lat, lon, source: 'home' };
  } catch {}
  // 4. Any historical activity with GPS
  try {
    const acts = storage.get('activities') || [];
    for (let i = acts.length - 1; i >= 0; i--) {
      const a = acts[i];
      const lat = Number(a?.startLatitude ?? a?.lat);
      const lon = Number(a?.startLongitude ?? a?.lon);
      if (_validCoord(lat, lon)) return { lat, lon, source: 'history' };
    }
  } catch {}
  return null;
}

/**
 * User-triggered geolocation pin. Caches in storage with a TTL so subsequent
 * predictions use it. Should only be called from a user-gesture handler
 * (browsers block geolocation requests outside that).
 */
export function dropPin() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ ok: false, error: 'unsupported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos?.coords?.latitude, lon = pos?.coords?.longitude;
        if (!_validCoord(lat, lon)) { resolve({ ok: false, error: 'invalid' }); return; }
        try { storage.set(PIN_CACHE_KEY, { lat, lon, at: Date.now() }, { skipValidation: true }); } catch {}
        resolve({ ok: true, lat, lon });
      },
      err => resolve({ ok: false, error: err?.message || 'denied' }),
      { timeout: 8000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

function computeFatigueForDate(dateStr) {
  try {
    const cur = parseLocalDate(dateStr);
    if (!cur) return null;
    const acts  = storage.get('activities') || [];
    const sleep = storage.get('sleep') || [];
    const d7  = new Date(cur); d7.setDate(d7.getDate() - 7);
    const d28 = new Date(cur); d28.setDate(d28.getDate() - 28);
    const d2  = new Date(cur); d2.setDate(d2.getDate() - 2);
    let tss7 = 0, tss28 = 0, hardInPrior2 = 0;
    for (const a of acts) {
      const ad = a && a.date && parseLocalDate(a.date);
      if (!ad || ad >= cur) continue;
      const tss = Number(a.trainingStressScore || a.tss || 0);
      if (ad >= d28) tss28 += tss;
      if (ad >= d7)  tss7  += tss;
      if (ad >= d2) {
        if (isHIIT(a) || isHardSession(a)) hardInPrior2 += 1;
      }
    }
    // Prior-night sleep score: the sleep record dated `dateStr` is the
    // night BEFORE dateStr (sleeps are stamped by wake-up date).
    const sleepEntry = sleep.find(s => s && s.date === dateStr);
    const sleepScorePrev = (sleepEntry && sleepEntry.sleepScore && sleepEntry.sleepScore > 0)
      ? sleepEntry.sleepScore : null;
    return {
      sleepScorePrev,
      rollingTSS7: tss7 || null,
      rollingTSS28: tss28 || null,
      consecutiveHardDays: hardInPrior2,
    };
  } catch { return null; }
}

async function fetchForecastConditions(dateStr) {
  try {
    const target = parseLocalDate(dateStr);
    if (!target) return null;
    const coords = getHomeCoords();
    if (!coords) return null;
    // Use noon of the target date as the anchor — most workouts happen
    // morning or evening, noon strikes a reasonable midpoint and lets
    // Open-Meteo's hourly index find a sensible row.
    const startMs = new Date(target.getFullYear(), target.getMonth(), target.getDate(), 12, 0, 0).getTime();
    const wx = await fetchWeatherForActivity({ lat: coords.lat, lon: coords.lon, startMs });
    if (wx) wx.locationSource = coords.source || null;
    return wx;
  } catch { return null; }
}

/**
 * Crude last-resort proxy: when no coords are available to forecast against,
 * take the median tempC + humidityPct from the user's last 5 weathered
 * activities. Better than no conditions — at least the band gets seasonally
 * adjusted. Returns null when the user has no weather-tagged history yet.
 */
function recentWeatherProxy() {
  try {
    const acts = storage.get('activities') || [];
    const recent = acts
      .filter(a => Number.isFinite(Number(a?.avgTemperature)) || Number.isFinite(Number(a?.avgHumidity)))
      .slice(-10);
    if (!recent.length) return null;
    const temps = recent.map(a => Number(a.avgTemperature)).filter(Number.isFinite).sort((a, b) => a - b);
    const hums  = recent.map(a => Number(a.avgHumidity)).filter(Number.isFinite).sort((a, b) => a - b);
    const median = arr => arr.length ? arr[Math.floor(arr.length / 2)] : null;
    const tempC = median(temps);
    const humidityPct = median(hums);
    if (tempC == null && humidityPct == null) return null;
    return { tempC, humidityPct, source: 'recent-median' };
  } catch { return null; }
}

export { recentWeatherProxy };

// ─── public API ────────────────────────────────────────────────────────────

/**
 * Build the prediction context for a (family, date). Pure-ish: only reads
 * storage. The weather lookup is in getPredictedBands() so callers that
 * already have conditions can avoid the round trip.
 */
export function buildPredictionContext({ family, dateStr, conditions }) {
  const validFamily = (family && EXPECTED_RANGES[family]) ? family : 'run';
  const fatigue = computeFatigueForDate(dateStr);
  // Pick one representative baseline metric to surface in the UI's "n=" line
  // — avgHR_pctMax is the most universally applicable. (The math itself uses
  // metric-specific baselines via the band fn.)
  let baselineN = 0;
  try {
    const b = getBaseline(validFamily, 'avgHR_pctMax');
    if (b) baselineN = b.n || 0;
  } catch {}
  return {
    family: validFamily,
    conditions: conditions || null,
    fatigue,
    baselineN,
    // baseline NOT set on ctx — predictedBand will resolve it per-metric
    // via blendWithBaseline if we pass it through. Instead we pre-resolve
    // below in getPredictedBands so callers can see "personalized" status
    // per metric.
  };
}

/**
 * Async variant that pulls the forecast for the date when conditions
 * aren't supplied. Returns { bands, ctx, source } where bands have the
 * shape { metricId, min, max, direction } plus baseline annotation.
 *
 * @param {{family:string, dateStr:string, conditions?:{tempC?:number,humidityPct?:number}}} opts
 */
export async function getPredictedBands({ family, dateStr, conditions }) {
  let cond = conditions || null;
  if (!cond) cond = await fetchForecastConditions(dateStr);
  if (!cond) cond = recentWeatherProxy();
  const ctx = buildPredictionContext({ family, dateStr, conditions: cond });

  // Resolve per-metric baselines and inject into the band call so each
  // metric blends with the user's stats individually.
  const familyRanges = EXPECTED_RANGES[ctx.family] || EXPECTED_RANGES.run;
  const bands = [];
  for (const metricId of Object.keys(familyRanges)) {
    let baseline = null;
    try { baseline = getBaseline(ctx.family, metricId); } catch {}
    const bandCtx = baseline ? { ...ctx, baseline } : ctx;
    // Pull the single-metric band so per-metric baselines stick.
    const single = predictedBandsForFamily(ctx.family, bandCtx)
      .find(b => b.metricId === metricId);
    if (single) {
      bands.push({
        ...single,
        baselineN: baseline?.n || 0,
        personalized: !!baseline,
      });
    }
  }

  return {
    bands,
    ctx,
    source: {
      hasConditions: !!cond,
      tempC: cond?.tempC ?? null,
      humidityPct: cond?.humidityPct ?? null,
      condition: cond?.condition ?? null,
      locationSource: cond?.locationSource ?? null,
      hasFatigue: !!ctx.fatigue,
      baselineN: ctx.baselineN || 0,
    },
  };
}

/**
 * Sync variant for callers that already have conditions (or want to skip
 * the network round trip).
 */
export function getPredictedBandsSync({ family, dateStr, conditions }) {
  const ctx = buildPredictionContext({ family, dateStr, conditions });
  const familyRanges = EXPECTED_RANGES[ctx.family] || EXPECTED_RANGES.run;
  const bands = [];
  for (const metricId of Object.keys(familyRanges)) {
    let baseline = null;
    try { baseline = getBaseline(ctx.family, metricId); } catch {}
    const bandCtx = baseline ? { ...ctx, baseline } : ctx;
    const single = predictedBandsForFamily(ctx.family, bandCtx)
      .find(b => b.metricId === metricId);
    if (single) {
      bands.push({
        ...single,
        baselineN: baseline?.n || 0,
        personalized: !!baseline,
      });
    }
  }
  return {
    bands,
    ctx,
    source: {
      hasConditions: !!conditions,
      tempC: conditions?.tempC ?? null,
      humidityPct: conditions?.humidityPct ?? null,
      condition: conditions?.condition ?? null,
      locationSource: conditions?.locationSource ?? null,
      hasFatigue: !!ctx.fatigue,
      baselineN: ctx.baselineN || 0,
    },
  };
}
