// ─── Historical weather backfill ────────────────────────────────────────────
// Feeds the environmental HR-drift model (hub/hrDriftModel). Weather is only
// attached to runs at sync time (best-effort), so most HISTORICAL runs have GPS
// coords but no temp/humidity — starving the regression. This sweeps every past
// run that has coordinates, reads its temperature + humidity from Open-Meteo's
// ARCHIVE endpoint (via weather.js), and fills ONLY the missing fields. It never
// overwrites real data, persists incrementally, and throttles to stay polite.
//
// Two layers:
//   • backfillWeather(activities, {fetchFn,…}) — PURE-ish, dependency-injected,
//     unit-tested (no storage, no network): mutates the passed activities in place.
//   • runWeatherBackfill(opts) — the browser glue: reads storage, calls the above
//     with the real fetch, persists, and keeps a one-time guard so it resumes
//     rather than re-hammering the API every boot.

import { storage } from './storage.js';
import { fetchWeatherForActivity } from './weather.js';
import { isRun } from './activityClass.js';

const CFG_STATE = 'arnold:weatherBackfill:state';   // localStorage: { done, filled, remaining, lastRunAt }

// Run start as epoch-ms from date (+ optional start time); local noon when no time.
export function startMsOf(a) {
  const date = a && a.date;
  if (!date || typeof date !== 'string') return null;
  const time = a.startTime || a.time || null;
  const iso = (time && /^\d{1,2}:\d{2}/.test(String(time)))
    ? `${date}T${String(time).length === 4 ? '0' + time : String(time).slice(0, 8)}`
    : `${date}T12:00:00`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Plausible start coordinates, or null (indoor/GPS-stripped runs).
export function coordsOf(a) {
  const lat = Number(a?.startLatitude ?? a?.lat);
  const lon = Number(a?.startLongitude ?? a?.lon ?? a?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lon)
      && Math.abs(lat) > 0.001 && Math.abs(lon) > 0.001
      && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  return null;
}

// A run is backfillable when it's missing temp OR humidity but has coords + a time.
function needsWeather(a) {
  return a && (a.avgTemperature == null || a.avgHumidity == null) && coordsOf(a) && startMsOf(a);
}

// The runs a sweep would touch (runs only — weather HR-drift is a running signal).
export function pendingWeatherBackfill(activities = []) {
  return (activities || []).filter(a => a && (a.isRun === true || isRun(a)) && needsWeather(a));
}

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Fill missing temp/humidity on the given activities IN PLACE. Dependency-injected
 * fetch so it's testable offline. Never overwrites a value that's already present.
 * Stops early after `maxConsecutiveFails` empty fetches (rate-limit / offline) so a
 * bad network doesn't churn the whole list — the guard lets it resume next boot.
 * @returns {{ filled:number, attempted:number, aborted:boolean }}
 */
export async function backfillWeather(activities, opts = {}) {
  const fetchFn = opts.fetchFn || fetchWeatherForActivity;
  const delayMs = opts.delayMs ?? 0;
  const maxPerRun = opts.maxPerRun ?? Infinity;
  const maxConsecutiveFails = opts.maxConsecutiveFails ?? 5;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const pending = pendingWeatherBackfill(activities).slice(0, maxPerRun);
  let filled = 0, attempted = 0, consecFails = 0, aborted = false;
  for (const a of pending) {
    attempted++;
    let wx = null;
    try { wx = await fetchFn({ ...coordsOf(a), startMs: startMsOf(a) }); } catch { wx = null; }
    if (wx) {
      consecFails = 0;
      if (a.avgTemperature == null && Number.isFinite(Number(wx.tempC))) a.avgTemperature = Number(wx.tempC);
      if (a.avgHumidity == null && Number.isFinite(Number(wx.humidityPct))) a.avgHumidity = Number(wx.humidityPct);
      if (!a.weatherSource) a.weatherSource = 'open-meteo-archive';
      filled++;
      if (onProgress) { try { onProgress({ filled, attempted, activity: a }); } catch { /* ignore */ } }
    } else if (++consecFails >= maxConsecutiveFails) {
      aborted = true;   // likely rate-limited or offline — bail; resume next time
      break;
    }
    if (delayMs > 0) await _sleep(delayMs);
  }
  return { filled, attempted, aborted };
}

function readState() {
  try { return JSON.parse(localStorage.getItem(CFG_STATE) || '{}'); } catch { return {}; }
}
function writeState(s) {
  try { localStorage.setItem(CFG_STATE, JSON.stringify(s)); } catch { /* ignore */ }
}

export function getWeatherBackfillState() {
  const st = readState();
  const remaining = pendingWeatherBackfill(storage.get('activities') || []).length;
  return { ...st, remaining };
}

/**
 * Browser glue: read activities, backfill weather, persist, keep a resumable guard.
 * Persists periodically so a partial sweep isn't lost. Best-effort — swallows all
 * errors so boot is never blocked. Pass { force:true } to re-run after done.
 */
export async function runWeatherBackfill(opts = {}) {
  const state = readState();
  const activities = storage.get('activities') || [];
  const pendingCount = pendingWeatherBackfill(activities).length;
  if (state.done && !opts.force && pendingCount === 0) return { skipped: 'already-done', ...state, remaining: 0 };
  if (pendingCount === 0) { writeState({ ...state, done: true }); return { done: true, filled: 0, remaining: 0 }; }

  const delayMs = opts.delayMs ?? 350;               // ~3 req/s — polite to the free API
  const maxPerRun = opts.maxPerRun ?? 500;           // cap one invocation; guard resumes the rest
  let sinceSave = 0;
  const persist = () => { try { storage.set('activities', activities, { skipValidation: true }); } catch { /* ignore */ } };

  const res = await backfillWeather(activities, {
    fetchFn: opts.fetchFn,
    delayMs,
    maxPerRun,
    onProgress: () => { if (++sinceSave >= 20) { sinceSave = 0; persist(); } },   // checkpoint every 20 fills
  });
  persist();   // final flush

  const remaining = pendingWeatherBackfill(storage.get('activities') || []).length;
  writeState({ done: remaining === 0, filled: (state.filled || 0) + res.filled, remaining, aborted: res.aborted });
  return { ...res, remaining, done: remaining === 0 };
}

// Boot hook — kick a one-time backfill a little after startup, off the critical path.
// Guard means it only does real work when there are historical runs missing weather.
export function scheduleWeatherBackfill(delayMs = 8000) {
  if (typeof window === 'undefined') return;
  setTimeout(() => { runWeatherBackfill().catch(() => { /* best-effort */ }); }, delayMs);
  window.weatherBackfill = (o = {}) => runWeatherBackfill({ force: true, ...o });
  window.weatherBackfillState = () => getWeatherBackfillState();
}
