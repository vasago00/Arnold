// ─── Garmin Wellness Worker Client ───────────────────────────────────────────
// Thin client for the Cloud Sync Worker's /garmin/* endpoints. Pulls Garmin's
// composite scores (Sleep Score, Body Battery, Stress, Training Readiness,
// Daily Summary) — the values Health Connect doesn't expose — and writes them
// into Arnold's existing storage shapes so the rest of the app picks them up
// without further changes.
//
// Mirror of cronometer-client.js: same Worker config, same encrypted-blob
// credential storage, same {ok, error} return shape. Never throws.
//
// Flow:
//   1. App calls fetchGarminDay(date) (or fetchGarminToday())
//   2. Client reads { user, pass } from encrypted garminAuth storage
//   3. POST /garmin/all { user, pass, date } with Bearer SYNC_TOKEN
//   4. Worker authenticates with Garmin once per ~hour (cached OAuth2 token),
//      pulls all five wellness streams in parallel, returns consolidated JSON
//   5. Client normalizes into Arnold schemas:
//      - sleepData[date]   → adds { sleepScore, deepMin, lightMin, remMin,
//                                   awakeMin, totalSleepHrs, restingHR,
//                                   overnightHRV, bodyBatteryChange, … }
//      - dailyLogs[date]   → adds { stressAvg, stressMax, bodyBatteryStart,
//                                   bodyBatteryEnd, trainingReadiness, … }
//   6. Live cache (garminLive) keeps the raw response for diagnostics + the
//      Settings "last sync" indicator.
//
// Sleep is the lone source of truth: when Worker writes a sleep row for a
// date, it CREATES or UPDATES the row in the same `sleepData` collection that
// HC syncs into. Worker rows have `source: 'garmin-worker'`; HC rows have
// `source: 'hc'`. The merge resolver in dailyTotals/sleep selectors prefers
// worker > hc, since Worker has the real sleepScore.

import { storage, KEYS } from './storage.js';

const CFG_ENDPOINT = 'arnold:cloud-sync:endpoint';
const CFG_TOKEN    = 'arnold:cloud-sync:token';

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Auth getters / setters ──────────────────────────────────────────────────

export function getGarminAuth() {
  const v = storage.get('garminAuth');
  if (!v || typeof v !== 'object') return null;
  if (!v.user || !v.pass) return null;
  return { user: String(v.user), pass: String(v.pass) };
}

export function setGarminAuth({ user, pass }) {
  if (!user || !pass) throw new Error('user + pass required');
  storage.set('garminAuth', { user: String(user).trim(), pass: String(pass) }, { skipValidation: true });
}

export function clearGarminAuth() {
  storage.set('garminAuth', null, { skipValidation: true });
}

export function hasGarminAuth() {
  return !!getGarminAuth();
}

// ── Worker config (shared with Cronometer / cloud-sync) ─────────────────────

function getWorkerConfig() {
  const endpoint = (localStorage.getItem(CFG_ENDPOINT) || '').replace(/\/$/, '');
  const token    = localStorage.getItem(CFG_TOKEN) || '';
  return { endpoint, token };
}

export function isGarminConfigured() {
  const { endpoint, token } = getWorkerConfig();
  return !!(endpoint && token && hasGarminAuth());
}

// ── Normalizers: Garmin payload shapes → Arnold canonical shapes ────────────

// Sleep: Garmin's response has top-level keys (restingHeartRate, avgOvernightHrv,
// bodyBatteryChange, etc) and a nested `dailySleepDTO`. We pull from both.
function normalizeSleep(garminSleep, date) {
  if (!garminSleep || garminSleep.error) return null;
  const dto = garminSleep.dailySleepDTO || {};
  const scores = dto.sleepScores || {};
  const overall = scores.overall || {};

  const sec = (k) => {
    const v = dto[k];
    return (typeof v === 'number' && v >= 0) ? v : 0;
  };

  // Some fields live at the top level, some inside dailySleepDTO. Garmin has
  // moved these around between API versions, so we check both locations.
  const pickTop = (...keys) => {
    for (const k of keys) {
      if (garminSleep[k] != null) return garminSleep[k];
      if (dto[k] != null)         return dto[k];
    }
    return null;
  };

  const totalSec = sec('sleepTimeSeconds');
  return {
    date,
    source: 'garmin-worker',
    fetchedAt: Date.now(),
    // Score
    sleepScore: (typeof overall.value === 'number') ? overall.value : null,
    sleepScoreLabel: overall.qualifierKey || null,
    // Stage durations (minutes — matches what sleepParser.js produces)
    totalSleepMinutes: Math.round(totalSec / 60),
    deepMinutes:       Math.round(sec('deepSleepSeconds') / 60),
    lightMinutes:      Math.round(sec('lightSleepSeconds') / 60),
    remMinutes:        Math.round(sec('remSleepSeconds') / 60),
    awakeMinutes:      Math.round(sec('awakeSleepSeconds') / 60),
    // Vitals during sleep
    // Both names so any reader works: HC-sync writes `restingHR`, the rest of
    // Arnold reads it under that name (dcy.js → rhrBaseline). Keep the long
    // form too for forward compatibility / clarity.
    restingHR:           pickTop('restingHeartRate'),
    restingHeartRate:    pickTop('restingHeartRate'),
    overnightHRV:        pickTop('avgOvernightHrv', 'avgOvernightHRV'),
    avgSleepStress:      pickTop('avgSleepStress'),
    avgRespiration:      pickTop('averageRespirationValue', 'averageRespiration'),
    lowestRespiration:   pickTop('lowestRespirationValue'),
    highestRespiration:  pickTop('highestRespirationValue'),
    bodyBatteryChange:   pickTop('bodyBatteryChange'),
    awakeCount:          pickTop('awakeCount'),
    restlessMomentsCount: pickTop('restlessMomentsCount'),
    // Window
    sleepStartTimestampGMT: dto.sleepStartTimestampGMT || null,
    sleepEndTimestampGMT:   dto.sleepEndTimestampGMT || null,
    // sleepStart / wakeTime — local-time HH:MM strings derived from the GMT
    // timestamps. Sleep-Regularity tile reads `sleepStart` to compute 7-night
    // bedtime SD; without this, the tile stays blank for Worker-sourced rows.
    sleepStart: gmtToLocalHHMM(dto.sleepStartTimestampGMT),
    wakeTime:   gmtToLocalHHMM(dto.sleepEndTimestampGMT),
    // Convenience compatible with the existing tile registry expectations
    sleepHrs: round2(totalSec / 3600),
  };
}

// Body Battery report — Garmin returns an array; we want the day's record.
// Field names align with what tileMetrics.js morningBodyBattery tile expects.
function normalizeBodyBattery(garminBody) {
  if (!garminBody || garminBody.error) return null;
  const arr = Array.isArray(garminBody) ? garminBody : null;
  const day = arr ? arr[0] : garminBody;
  if (!day) return null;
  // bodyBatteryValuesArray is a list of [timestamp, status, value, version] tuples.
  const samples = Array.isArray(day.bodyBatteryValuesArray) ? day.bodyBatteryValuesArray : [];
  let firstVal = null, lastVal = null, minVal = null, maxVal = null;
  for (const s of samples) {
    const v = Array.isArray(s) ? s[2] : null;
    if (typeof v !== 'number') continue;
    if (firstVal == null) firstVal = v;
    lastVal = v;
    if (minVal == null || v < minVal) minVal = v;
    if (maxVal == null || v > maxVal) maxVal = v;
  }
  return {
    bodyBatteryStart:   firstVal,
    bodyBatteryEnd:     lastVal,
    bodyBatteryMin:     minVal,
    bodyBatteryMax:     maxVal,
    bodyBatteryCharged: typeof day.charged === 'number' ? day.charged : null,
    bodyBatteryDrained: typeof day.drained === 'number' ? day.drained : null,
    bodyBatterySamples: samples.length,
  };
}

// Stress — daily aggregates + intraday histogram.
// Field names align with the tile registry (avgStress / maxStress).
function normalizeStress(garminStress) {
  if (!garminStress || garminStress.error) return null;
  return {
    avgStress: num(garminStress.avgStressLevel),
    maxStress: num(garminStress.maxStressLevel),
    stressRestMinutes: minSec(garminStress.restStressDuration),
    stressLowMinutes:  minSec(garminStress.lowStressDuration),
    stressMedMinutes:  minSec(garminStress.mediumStressDuration),
    stressHighMinutes: minSec(garminStress.highStressDuration),
  };
}

// Training Readiness — Garmin returns array (latest first).
// Field names align with the tile registry. Recovery hours is derived from
// `recoveryTime` (minutes) which the readiness payload exposes alongside the
// score breakdown.
function normalizeReadiness(garminReadiness) {
  if (!garminReadiness || garminReadiness.error) return null;
  const r = Array.isArray(garminReadiness) ? garminReadiness[0] : garminReadiness;
  if (!r) return null;
  // recoveryTime is in minutes — convert to hours, round to one decimal.
  const recHours = (typeof r.recoveryTime === 'number' && r.recoveryTime >= 0)
    ? Math.round(r.recoveryTime / 60 * 10) / 10
    : null;
  return {
    trainingReadiness: num(r.score),
    trainingReadinessLevel: r.level || null,
    trainingReadinessFeedback: r.feedbackLong || r.feedbackShort || null,
    recoveryHours: recHours,
    sleepHistoryFactorPercent:  num(r.sleepHistoryFactorPercent),
    recoveryTimeFactorPercent:  num(r.recoveryTimeFactorPercent),
    acwrFactorPercent:          num(r.acwrFactorPercent),
    hrvFactorPercent:           num(r.hrvFactorPercent),
    stressHistoryFactorPercent: num(r.stressHistoryFactorPercent),
  };
}

// Daily Summary — steps, calories, intensity minutes, floors.
function normalizeSummary(garminSummary) {
  if (!garminSummary || garminSummary.error) return null;
  return {
    steps:            num(garminSummary.totalSteps),
    activeCalories:   num(garminSummary.activeKilocalories),
    totalCalories:    num(garminSummary.totalKilocalories),
    bmrCalories:      num(garminSummary.bmrKilocalories),
    intensityMinutes: num(garminSummary.moderateIntensityMinutes) + 2 * num(garminSummary.vigorousIntensityMinutes),
    moderateMinutes:  num(garminSummary.moderateIntensityMinutes),
    vigorousMinutes:  num(garminSummary.vigorousIntensityMinutes),
    floorsAscended:   num(garminSummary.floorsAscended),
    distanceMeters:   num(garminSummary.totalDistanceMeters),
  };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function minSec(s) {
  if (typeof s !== 'number' || s < 0) return null;
  return Math.round(s / 60);
}
function round2(n) { return Math.round(n * 100) / 100; }

// Convert a GMT timestamp (ISO string or epoch ms) to local-time HH:MM string.
// Returns null when input is falsy / unparseable.
// Used by the sleep normalizer to populate sleepStart / wakeTime fields that
// the Sleep Regularity tile depends on.
function gmtToLocalHHMM(gmtTs) {
  if (gmtTs == null) return null;
  const d = new Date(gmtTs);
  if (!Number.isFinite(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Storage upserts ─────────────────────────────────────────────────────────

// Upsert a Garmin sleep row keyed by date. The sleep collection is one-row-
// per-date (HC's syncSleep dedups with a Map<date, row>), so we merge into
// any existing row instead of adding a duplicate:
//   - If an HC row exists, we layer Worker's authoritative data over it
//     (sleepScore, HRV, RHR, BB change, etc.) and re-tag source='garmin-worker'
//     so HC's next sweep sees ours and skips (see hc-sync.js syncSleep).
//   - If a Worker row already exists, we update it in place with the latest pull.
//   - If nothing exists for that date, we insert.
function upsertSleepRow(row) {
  if (!row || !row.date) return;
  const all = storage.get('sleep') || [];
  const idx = all.findIndex(r => r?.date === row.date);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...row, source: 'garmin-worker' };
  } else {
    all.push(row);
  }
  storage.set('sleep', all);
}

// Upsert a per-date wellness row in the `wellness` collection. The tile
// registry reads from this collection (ctx.wellness in tileMetrics.js) — we
// keep it cleanly separate from dailyLogs (which HC owns for steps + kcal)
// so there's no two-writers race on the same fields.
function upsertWellnessRow(date, patch) {
  if (!patch || !date) return;
  const all = storage.get('wellness') || [];
  const idx = all.findIndex(r => r?.date === date);
  const base = idx >= 0 ? all[idx] : { date };
  const merged = { ...base, ...prune(patch), garminWorkerAt: Date.now() };
  if (idx >= 0) all[idx] = merged;
  else          all.push(merged);
  storage.set('wellness', all, { skipValidation: true });
}

// Drop null/undefined so we don't blow away existing values with blanks
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

// Live cache for UI staleness + diagnostics
function writeLiveCache(date, payload) {
  const cur = storage.get('garminLive') || {};
  cur[date] = {
    fetchedAt: payload.fetchedAt || Date.now(),
    cached:    !!payload.cached,
    // keep trimmed payload (skip the heavy intraday arrays)
    sleepScore: payload?.sleep?.dailySleepDTO?.sleepScores?.overall?.value ?? null,
    bbCharged:  Array.isArray(payload?.body) ? (payload.body[0]?.charged ?? null) : null,
    stressAvg:  payload?.stress?.avgStressLevel ?? null,
    readiness:  Array.isArray(payload?.readiness) ? (payload.readiness[0]?.score ?? null) : null,
  };
  // Prune entries older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [d, v] of Object.entries(cur)) {
    if ((v?.fetchedAt || 0) < cutoff) delete cur[d];
  }
  storage.set('garminLive', cur, { skipValidation: true });
}

function writeMeta(patch) {
  const cur = storage.get('garminWellnessMeta') || {};
  storage.set('garminWellnessMeta', { ...cur, ...patch }, { skipValidation: true });
}

// ── Main fetch ──────────────────────────────────────────────────────────────

/**
 * Pull a single day from Garmin Wellness via the Worker.
 * Returns { ok, date, sleep, summary, fetchedAt, cached, error? }.
 * Never throws — UI-friendly error shape.
 */
export async function fetchGarminDay(date = localDate(), { signal } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'bad_date', date };
  }
  const auth = getGarminAuth();
  if (!auth) return { ok: false, error: 'no_auth', date };

  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) return { ok: false, error: 'no_worker_config', date };

  let res;
  try {
    res = await fetch(`${endpoint}/garmin/all`, {
      method: 'POST',
      signal,
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass, date }),
    });
  } catch (e) {
    writeMeta({ lastError: 'network_error', lastErrorAt: Date.now() });
    return { ok: false, error: 'network_error', detail: String(e?.message || e), date };
  }

  let body;
  try { body = await res.json(); } catch { body = null; }

  if (!res.ok) {
    const err = body?.error || `http_${res.status}`;
    writeMeta({ lastError: err, lastErrorDetail: body?.detail || null, lastErrorAt: Date.now() });
    return { ok: false, error: err, detail: body?.detail, status: res.status, date };
  }
  if (!body) {
    writeMeta({ lastError: 'empty_response', lastErrorAt: Date.now() });
    return { ok: false, error: 'empty_response', date };
  }

  // Normalize each stream
  const sleep    = normalizeSleep(body.sleep, date);
  const bb       = normalizeBodyBattery(body.body);
  const stress   = normalizeStress(body.stress);
  const readiness = normalizeReadiness(body.readiness);
  const summary  = normalizeSummary(body.summary);

  // Persist
  //   sleep      → 'sleep' collection (HC writes here too; Worker source wins)
  //   bb/stress/readiness → 'wellness' collection (read by tile registry)
  //   Garmin's daily summary (steps/kcal) → intentionally NOT persisted; HC
  //                  owns those in hcDailyEnergy (Phase 4a separation).
  if (sleep) upsertSleepRow(sleep);
  upsertWellnessRow(date, { ...(bb || {}), ...(stress || {}), ...(readiness || {}) });
  writeLiveCache(date, { ...body, fetchedAt: body.fetchedAt || Date.now() });
  writeMeta({
    lastSyncAt:   body.fetchedAt || Date.now(),
    lastDate:     date,
    lastError:    null,
    lastErrorAt:  null,
    lastSleepScore: sleep?.sleepScore ?? null,
  });

  return {
    ok: true, date,
    sleep, bb, stress, readiness, summary,
    fetchedAt: body.fetchedAt || Date.now(),
    cached:    !!body.cached,
    raw:       body,
  };
}

export async function fetchGarminToday(opts) {
  return fetchGarminDay(localDate(), opts);
}

// ── Date-range backfill ─────────────────────────────────────────────────────
// Pulls a range of dates serially (parallel pulls on the same Worker would
// just queue behind shared OAuth + rate limits). Returns per-day results.

export async function fetchGarminRange(startDate, endDate, { onProgress } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { ok: false, error: 'bad_date_range' };
  }
  const start = new Date(startDate + 'T00:00:00');
  const end   = new Date(endDate + 'T00:00:00');
  if (end < start) return { ok: false, error: 'reversed_range' };

  const results = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = localDate(d);
    onProgress?.(ds);
    const r = await fetchGarminDay(ds);
    results.push(r);
    // Be polite to Garmin — small spacing between days
    await new Promise(r => setTimeout(r, 250));
  }
  return { ok: true, results, count: results.length };
}

// ── Backfill: fill blanks left by the HC sleep-score migration ──────────────
// On boot, if Garmin is configured, find recent dates where sleepScore is null
// (specifically: HC-sourced rows with null score, post-Phase-4b migration) and
// pull them once. Idempotent — repeat boots won't re-pull dates that succeeded.

export async function backfillRecentBlanks({ daysBack = 14, onProgress, force = false } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };

  const sleepRows = storage.get('sleep') || [];
  const wellnessRows = storage.get('wellness') || [];
  const today = new Date();
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - daysBack);

  // A date is considered "fully covered" only when BOTH:
  //   - sleep row has a sleepScore from the worker, AND
  //   - wellness row has at least bodyBatteryStart OR avgStress (proves
  //     the wellness pull also landed in the right collection).
  // Without the second check we'd skip dates from the pre-fix backfill that
  // wrote wellness data to the wrong storage location, leaving Body Battery
  // and friends blank forever.
  const sleepByDate = new Map(sleepRows.map(r => [r.date, r]));
  const wellnessByDate = new Map(wellnessRows.map(r => [r.date, r]));

  const datesToFill = [];
  for (let d = new Date(cutoff); d <= today; d.setDate(d.getDate() + 1)) {
    const ds = localDate(d);
    if (force) { datesToFill.push(ds); continue; }
    const sr = sleepByDate.get(ds);
    const wr = wellnessByDate.get(ds);
    const sleepCovered = sr?.source === 'garmin-worker' && sr?.sleepScore != null;
    const wellnessCovered = wr && (wr.bodyBatteryStart != null || wr.avgStress != null || wr.trainingReadiness != null);
    if (sleepCovered && wellnessCovered) continue; // both halves done
    datesToFill.push(ds);
  }

  const results = [];
  for (const ds of datesToFill) {
    onProgress?.(ds);
    const r = await fetchGarminDay(ds);
    results.push({
      date: ds, ok: r.ok, error: r.error || null,
      sleepScore: r.sleep?.sleepScore ?? null,
      bodyBatteryStart: r.bb?.bodyBatteryStart ?? null,
      trainingReadiness: r.readiness?.trainingReadiness ?? null,
    });
    await new Promise(r => setTimeout(r, 250));
  }
  return { ok: true, attempted: datesToFill.length, results };
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export function getGarminLiveCacheFor(date) {
  const c = storage.get('garminLive') || {};
  return c[date] || null;
}

export function getGarminWellnessMeta() {
  return storage.get('garminWellnessMeta') || {};
}

// One-shot smoke test (call from DevTools)
export async function garminSelfTest() {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  return fetchGarminToday();
}

// ── Direct VO2Max pull (Phase 4g) ───────────────────────────────────────────
// Fetches the watch's current VO2Max from /userprofile-service/userprofile.
// Tracks the live value Garmin updates after each qualifying run/ride —
// independent of whether we've enriched any single activity. Stored in a
// dedicated slot so the Start screen Core summary can display it instantly.
export async function fetchGarminVO2Max() {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  const auth = getGarminAuth();
  if (!auth) return { ok: false, error: 'no_auth' };
  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) return { ok: false, error: 'no_worker_config' };
  try {
    const res = await fetch(`${endpoint}/garmin/vo2max`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass }),
    });
    let body;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) {
      return { ok: false, error: body?.error || `http_${res.status}`, detail: body?.detail };
    }
    const v = body?.vo2max || null;
    if (v) {
      // Persist into wellness collection's "today" row so any reader can
      // pick it up. Use a dedicated 'garminWatchVO2Max' field keyed by date.
      const wellnessAll = storage.get('wellness') || [];
      const today = localDate();
      const idx = wellnessAll.findIndex(r => r?.date === today);
      const watchVO2 = v.vO2MaxRunning || v.vO2MaxCycling || null;
      const merged = idx >= 0
        ? { ...wellnessAll[idx], date: today, garminWatchVO2Max: watchVO2, garminWatchVO2MaxAt: Date.now() }
        : { date: today, garminWatchVO2Max: watchVO2, garminWatchVO2MaxAt: Date.now() };
      if (idx >= 0) wellnessAll[idx] = merged; else wellnessAll.push(merged);
      storage.set('wellness', wellnessAll, { skipValidation: true });
    }
    return { ok: true, vo2max: v };
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e?.message || e) };
  }
}
