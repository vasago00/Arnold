// ─── Garmin Weight Client (Phase 4r.energy.4) ───────────────────────────────
// Pull body-composition readings directly from Garmin Connect via the Cloud
// Sync Worker. Replaces the Health Connect path for users with the Worker
// configured, eliminating three failure modes HC introduced:
//
//   1. HC's WeightRecord shape carries only weightKg — no body fat %,
//      no muscle mass, no bone mass, no body water % — even though
//      Garmin Index measures all of them and Garmin Connect surfaces
//      them. HC is a lossy bottleneck.
//
//   2. HC collapses same-day readings to one row by default, so the
//      morning + post-run weigh-ins (the data needed for sweat-rate
//      tracking) get reduced to one number on the way through.
//
//   3. Two-hop sync latency: Garmin Cloud → Garmin Android app → HC →
//      Arnold. PM weigh-ins frequently don't propagate until next day.
//
// Going to the source: one authenticated call to Garmin's weight-service
// endpoint, full body-composition payload with sample timestamps preserved.
//
// REQUIRES Worker endpoint:
//
//   POST  /garmin/weight
//   body  { user, pass, startDate, endDate }
//   200   { weighIns: [
//             {
//               samplePk: 1234567890123,         // Garmin's primary key per reading
//               date: '2026-05-10',              // local date (YYYY-MM-DD)
//               timestampGMT: '2026-05-10T13:05:00.000',
//               timestampLocal: '2026-05-10T09:05:00.000',
//               weight: 85500.0,                  // grams
//               weightDelta: -100.0,              // grams, may be null
//               bmi: 26.5,                        // computed by Garmin server-side
//               bodyFat: 25.5,                    // %
//               bodyWater: 54.4,                  // %
//               boneMass: 4400.0,                 // grams
//               muscleMass: 65200.0,              // grams
//               physiqueRating: 5,
//               visceralFat: 8,
//               metabolicAge: 38,
//               sourceType: 'INDEX_SCALE',        // or MANUAL / IMPORT
//             },
//             ...
//           ] }
//
// The Worker proxies an authenticated GET to:
//   https://connect.garmin.com/weight-service/weight/range/{start}/{end}
// (or `/weight-service/weight/dateRange?startDate=...&endDate=...` depending
// on which Garmin endpoint is more stable for your Worker setup — both
// return the same shape). Uses the same login/cookie-jar pattern as the
// existing /garmin/activities/* endpoints.
//
// If the endpoint isn't deployed yet, this client fails silently and the
// existing HC weight sync continues. Once the Worker route lands, next boot
// pulls the full history and stores it under `weight` with multiple readings
// per day intact.

import { storage } from './storage.js';
import { getGarminAuth, isGarminConfigured } from './garmin-client.js';

const CFG_ENDPOINT = 'arnold:cloud-sync:endpoint';
const CFG_TOKEN    = 'arnold:cloud-sync:token';
const KG_TO_LBS    = 2.20462;
const SYNC_FLAG    = 'arnold:garmin-weight-sync';

function getWorkerConfig() {
  const endpoint = (localStorage.getItem(CFG_ENDPOINT) || '').replace(/\/$/, '');
  const token    = localStorage.getItem(CFG_TOKEN) || '';
  return { endpoint, token };
}

// Format a Date or ISO string as YYYY-MM-DD in LOCAL time. Critical: don't
// use toISOString() which converts to UTC and may flip the date for late-PM
// or early-AM readings near midnight.
function localDateStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function localTimeStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(dt.getTime())) return null;
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

// Normalize a Garmin weight DTO into Arnold's `weight` storage shape.
// Conservative — drops any reading whose weight is outside the human range
// (30–300 kg) since Garmin occasionally emits a 0g sample for failed
// impedance reads.
function normalizeWeighIn(rec) {
  if (!rec) return null;
  // Date resolution priority (Phase 4r.energy.6):
  //   1. timestampGMT  — numeric epoch ms (Garmin's authoritative reading
  //                       moment, converted to user's LOCAL TZ for display)
  //   2. date          — also numeric epoch ms on Garmin's responses, same
  //                       value as timestampGMT in practice
  //   3. timestampLocal — millis already in local TZ (rare but seen)
  //   4. calendarDate  — YYYY-MM-DD string fallback when no millis are
  //                       available (loses time-of-day; better than nothing)
  //
  // The previous order was timestampLocal || calendarDate || date, which
  // hit the calendarDate string first when timestampLocal was absent —
  // causing `new Date('2026-05-10')` to evaluate as UTC midnight and shift
  // the entry back one local day in EST. Numeric epoch is always safe.
  let dt = null;
  if (Number.isFinite(rec.timestampGMT)) dt = new Date(rec.timestampGMT);
  else if (Number.isFinite(rec.date))    dt = new Date(rec.date);
  else if (rec.timestampLocal)           dt = new Date(rec.timestampLocal);
  else if (rec.calendarDate)             dt = new Date(rec.calendarDate);
  const dateStr = dt && Number.isFinite(dt.getTime()) ? localDateStr(dt) : (rec.calendarDate || null);
  const time    = dt && Number.isFinite(dt.getTime()) ? localTimeStr(dt) : null;
  const date    = dateStr;
  if (!date) return null;

  const weightG = Number(rec.weight);
  if (!Number.isFinite(weightG) || weightG < 30_000 || weightG > 300_000) return null;
  const weightKg  = +(weightG / 1000).toFixed(2);
  const weightLbs = +(weightKg * KG_TO_LBS).toFixed(1);

  const bf = Number(rec.bodyFat);
  const bw = Number(rec.bodyWater);
  const muscleG = Number(rec.muscleMass);
  const boneG = Number(rec.boneMass);
  const bmiV = Number(rec.bmi);

  return {
    date,
    time,
    weightLbs,
    weightKg,
    bodyFatPct:           Number.isFinite(bf) && bf > 0 && bf < 60 ? +bf.toFixed(1) : null,
    bodyWaterPct:         Number.isFinite(bw) && bw > 0 && bw < 90 ? +bw.toFixed(1) : null,
    skeletalMuscleMassLbs: Number.isFinite(muscleG) && muscleG > 5_000 && muscleG < 200_000
                            ? +((muscleG / 1000) * KG_TO_LBS).toFixed(1) : null,
    boneMassLbs:           Number.isFinite(boneG) && boneG > 500 && boneG < 20_000
                            ? +((boneG / 1000) * KG_TO_LBS).toFixed(1) : null,
    bmi:                  Number.isFinite(bmiV) && bmiV >= 10 && bmiV <= 60 ? +bmiV.toFixed(1) : null,
    visceralFat:          Number.isFinite(Number(rec.visceralFat)) ? Math.round(rec.visceralFat) : null,
    metabolicAge:         Number.isFinite(Number(rec.metabolicAge)) ? Math.round(rec.metabolicAge) : null,
    samplePk:             rec.samplePk ? String(rec.samplePk) : null,
    source:               'garmin-worker',
    sourceType:           rec.sourceType || null,
  };
}

// Public: pull recent weight readings from the Worker, normalize, merge into
// `weight` storage. Idempotent — already-seen readings (matched by samplePk
// or by date+time+weight triple) are skipped.
export async function syncRecentWeight({ daysBack = 30, onProgress } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  const auth = getGarminAuth();
  const { endpoint, token } = getWorkerConfig();
  if (!auth || !endpoint || !token) return { ok: false, error: 'no_config' };

  const now = new Date();
  const start = new Date(now.getTime() - daysBack * 86400 * 1000);
  const startDate = localDateStr(start);
  const endDate   = localDateStr(now);
  onProgress?.({ phase: 'fetching', startDate, endDate });

  let res;
  try {
    res = await fetch(`${endpoint}/garmin/weight`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass, startDate, endDate }),
    });
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e?.message || e) };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `http_${res.status}`, detail: t.slice(0, 200), status: res.status };
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  // Phase 4r.energy.6 — Garmin's weight-service/range/{start}/{end}
  // endpoint returns nested shape:
  //   { weighIns: { dailyWeightSummaries: [
  //       { summaryDate, numOfWeightEntries, allWeightMetrics: [
  //           { samplePk, date, calendarDate, weight, bmi, bodyFat,
  //             bodyWater, boneMass, muscleMass, visceralFat,
  //             metabolicAge, sourceType, timestampGMT, weightDelta }
  //         ], latestWeight: {...} }
  //     ] } }
  // We flatten allWeightMetrics across all summaries — that's where the
  // individual readings live (one per Index scale step). `latestWeight`
  // is a duplicate of the most-recent metric, so we skip it.
  //
  // Also tolerate flat array shapes (`weighIns` as array, top-level
  // array, `dateWeightList`, `entries`) for resilience if Garmin's
  // payload format shifts or another endpoint is plugged in later.
  let raw = null;
  if (Array.isArray(body))                       raw = body;
  else if (Array.isArray(body?.weighIns))        raw = body.weighIns;
  else if (Array.isArray(body?.dateWeightList))  raw = body.dateWeightList;
  else if (Array.isArray(body?.entries))         raw = body.entries;
  else if (Array.isArray(body?.weighIns?.dailyWeightSummaries)) {
    // The nested shape — flatten each day's allWeightMetrics.
    raw = [];
    for (const day of body.weighIns.dailyWeightSummaries) {
      const metrics = Array.isArray(day?.allWeightMetrics) ? day.allWeightMetrics : null;
      if (metrics?.length) raw.push(...metrics);
      // Fallback for days where allWeightMetrics is absent but latestWeight
      // has the data (Garmin's payload occasionally omits the array for
      // single-reading days).
      else if (day?.latestWeight) raw.push(day.latestWeight);
    }
  }
  if (!raw) return { ok: false, error: 'malformed_response', detail: JSON.stringify(body).slice(0, 300) };

  const incoming = raw.map(normalizeWeighIn).filter(Boolean);
  if (incoming.length === 0) return { ok: true, fetched: 0, added: 0 };

  // Merge with existing. Dedup priority:
  //   1. samplePk match  → skip (already imported)
  //   2. (date, time, weightLbs) triple match → skip
  // Otherwise insert. Older non-worker entries (HC, manual) at the same
  // (date, time, weight) are REPLACED by the worker entry since it
  // carries richer body-comp data.
  const existing = storage.get('weight') || [];
  const samplePkSet = new Set(
    existing.filter(w => w?.samplePk).map(w => String(w.samplePk))
  );
  const tripleKey = w => `${w?.date || ''}|${w?.time || ''}|${w?.weightLbs || ''}`;
  const tripleMap = new Map();
  for (const w of existing) tripleMap.set(tripleKey(w), w);

  let added = 0, replaced = 0;
  for (const w of incoming) {
    if (w.samplePk && samplePkSet.has(w.samplePk)) continue;  // already imported
    const tk = tripleKey(w);
    const prev = tripleMap.get(tk);
    if (prev) {
      // Same date+time+weight — prefer worker version (richer body-comp).
      if (prev.source === 'garmin-worker') continue;  // already a worker row
      tripleMap.set(tk, w);
      replaced++;
    } else {
      tripleMap.set(tk, w);
      added++;
    }
  }

  const merged = Array.from(tripleMap.values()).sort((a, b) => {
    const dCmp = (b.date || '').localeCompare(a.date || '');
    if (dCmp !== 0) return dCmp;
    return (b.time || '').localeCompare(a.time || '');
  });
  if (added + replaced > 0) {
    storage.set('weight', merged, { skipValidation: true });
    try { localStorage.setItem(`${SYNC_FLAG}:${endDate}`, '1'); } catch {}
  }

  return {
    ok: true,
    fetched: incoming.length,
    added,
    replaced,
    skipped: incoming.length - added - replaced,
    window: { startDate, endDate, daysBack },
  };
}

// TTL check — skip re-sync if we already synced today.
export function hasSyncedWeightToday() {
  try {
    const today = localDateStr(new Date());
    return localStorage.getItem(`${SYNC_FLAG}:${today}`) === '1';
  } catch { return false; }
}
