// ─── Cronometer Worker Client ───────────────────────────────────────────────
// Thin client that calls the Cloud Sync Worker's /cronometer/pull endpoint
// to fetch today's intake (or any date) without requiring a CSV export.
//
// The Worker:
//   - Accepts {user, pass, date, type='servings'} with Bearer auth
//   - Logs into Cronometer on the user's behalf, pulls the servings CSV,
//     and returns {rows, totals, rowCount, fetchedAt, cached}
//   - `totals` is the sum of every nutrient column across the servings rows
//     with keys like "Energy (kcal)", "Protein (g)", "Water (g)", etc.
//
// This module:
//   1. Reads Cronometer creds from storage (synced via cloud-sync blob)
//   2. Reads Worker endpoint + bearer token from cloud-sync pairing config
//   3. Calls the Worker, normalizes totals into the Arnold macro shape,
//      and upserts a full-day entry into arnold:nutrition-log so
//      dailyTotals()/fuelAdequacy() pick it up automatically
//   4. Also caches the raw response under arnold:cronometer-live for
//      diagnostics / staleness UI
//
// No new crypto: the creds live inside the Cloud Sync encrypted blob
// (same passphrase-derived key). Locally they're AES-GCM encrypted at
// rest via the storage.js ENCRYPTED_COLLECTIONS registry.

import { storage, KEYS } from './storage.js';
import { localDate, ymd } from './time.js';

// ── Config ──────────────────────────────────────────────────────────────────

const CFG_ENDPOINT = 'arnold:cloud-sync:endpoint';
const CFG_TOKEN    = 'arnold:cloud-sync:token';

// ── Auth getters / setters ──────────────────────────────────────────────────

export function getCronometerAuth() {
  const v = storage.get('cronometerAuth');
  if (!v || typeof v !== 'object') return null;
  if (!v.user || !v.pass) return null;
  return { user: String(v.user), pass: String(v.pass) };
}

export function setCronometerAuth({ user, pass }) {
  if (!user || !pass) throw new Error('user + pass required');
  storage.set('cronometerAuth', { user: String(user).trim(), pass: String(pass) }, { skipValidation: true });
}

export function clearCronometerAuth() {
  storage.set('cronometerAuth', null, { skipValidation: true });
}

export function hasCronometerAuth() {
  return !!getCronometerAuth();
}

// ── Worker endpoint / token ─────────────────────────────────────────────────

function getWorkerConfig() {
  const endpoint = (localStorage.getItem(CFG_ENDPOINT) || '').replace(/\/$/, '');
  const token    = localStorage.getItem(CFG_TOKEN) || '';
  return { endpoint, token };
}

export function isConfigured() {
  const { endpoint, token } = getWorkerConfig();
  return !!(endpoint && token && hasCronometerAuth());
}

// ── Totals normalization ────────────────────────────────────────────────────
// The Worker returns totals with Cronometer's native column names. Map them
// into Arnold's canonical macro shape (matches NutritionEntry.macros in
// nutrition.js). Everything missing is left at 0 rather than fabricated.

function normalizeTotals(totalsMap = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = totalsMap[k];
      if (v != null && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  // Cronometer reports Water in grams. Arnold stores water in mL.
  // 1 g H₂O ≈ 1 mL — we can use the value directly.
  const waterMl = pick('Water (g)', 'Water', 'Water (ml)');

  return {
    calories: Math.round(pick('Energy (kcal)', 'Energy')),
    protein:  round1(pick('Protein (g)', 'Protein')),
    carbs:    round1(pick('Carbs (g)', 'Carbohydrates (g)', 'Carbs')),
    fat:      round1(pick('Fat (g)', 'Fat')),
    fiber:    round1(pick('Fiber (g)', 'Fiber')),
    sugar:    round1(pick('Sugars (g)', 'Sugar')),
    water:    Math.round(waterMl),
    // Extended (optional, kept for diagnostics / future DCY use)
    sodium:    Math.round(pick('Sodium (mg)', 'Sodium')),
    potassium: Math.round(pick('Potassium (mg)', 'Potassium')),
    magnesium: Math.round(pick('Magnesium (mg)', 'Magnesium')),
    calcium:   Math.round(pick('Calcium (mg)', 'Calcium')),
    iron:      round1(pick('Iron (mg)', 'Iron')),
    caffeine:  Math.round(pick('Caffeine (mg)', 'Caffeine')),
    alcohol:   round1(pick('Alcohol (g)', 'Alcohol')),
  };
}
function round1(n) { return Math.round(n * 10) / 10; }

// ── Nutrition-log upsert ────────────────────────────────────────────────────
// Write a single "full-day" entry with a deterministic id so repeat pulls
// update in place. dailyTotals() picks the most-recent full-day entry by
// createdAt, so refreshing createdAt on every fetch keeps the live data
// winning over any stale CSV import.

function upsertFullDayEntry(date, macros, meta = {}) {
  const id = `cronometer-live:${date}`;
  const all = storage.get('nutritionLog') || [];
  const idx = all.findIndex(e => e.id === id);
  const nowIso = new Date().toISOString();
  const entry = {
    id,
    name: 'Cronometer — live sync',
    date,
    time: '00:00',
    meal: 'full-day',
    source: 'cronometer-live',
    servings: 1,
    macros: {
      calories: macros.calories || 0,
      protein:  macros.protein  || 0,
      carbs:    macros.carbs    || 0,
      fat:      macros.fat      || 0,
      fiber:    macros.fiber    || 0,
      sugar:    macros.sugar    || 0,
      water:    macros.water    || 0,
    },
    extended: {
      sodium: macros.sodium, potassium: macros.potassium, magnesium: macros.magnesium,
      calcium: macros.calcium, iron: macros.iron, caffeine: macros.caffeine, alcohol: macros.alcohol,
    },
    barcode: null,
    imageUrl: null,
    rawApiData: null,
    createdAt: nowIso, // bump on every pull so this always wins over older full-day entries
    fetchedAt: meta.fetchedAt || Date.now(),
    rowCount:  meta.rowCount ?? null,
    cached:    !!meta.cached,
  };
  if (idx >= 0) all[idx] = entry; else all.unshift(entry);
  storage.set('nutritionLog', all, { skipValidation: true });
  return entry;
}

// ── Per-meal upsert (Phase 4r.signals.1) ────────────────────────────────────
// The Worker's `rows` array gives us per-serving Cronometer entries with
// timestamps. Until now those were thrown into the cronometerLive diagnostics
// cache and otherwise ignored — even though the full-day rollup it sums to
// was being written into nutritionLog. The result: Pre-Training Carbs and
// Post-Training Protein tiles stayed empty because they need wall-clock
// timestamps to bucket food into the ±2h workout window. The meal-timing↔HRV
// and carbs↔Z4-5 correlations had the same blocker.
//
// Fix: also write per-meal rows with proper `timestamp` fields. macroForDate
// in tileMetrics.js prefers the full-day row when present (so daily totals
// don't double-count), so these meal rows coexist cleanly — they only get
// consumed by tiles/signals that need timing.
//
// Row shape from the Worker (Cronometer servings CSV columns):
//   { 'Day': '2026-05-25', 'Time': '07:32 AM', 'Group': 'Breakfast',
//     'Food Name': 'Oatmeal', 'Energy (kcal)': 320, 'Protein (g)': 12, ... }
// We're tolerant about field-name casing.

function parseClockTime(rawTime) {
  // Cronometer time strings: "07:32 AM" / "19:14" / "7:32:00 AM". Return 24h
  // "HH:MM" string or null if unparseable.
  if (!rawTime) return null;
  const s = String(rawTime).trim();
  // Try "H:MM AM/PM" with optional seconds.
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  const ampm = (m[3] || '').toUpperCase();
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  if (h < 0 || h > 23) return null;
  return `${String(h).padStart(2, '0')}:${mm}`;
}

function normalizeRowMacros(row) {
  // Same picker shape as normalizeTotals but per-row.
  const pick = (...keys) => {
    for (const k of keys) {
      const v = row[k];
      if (v != null && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };
  return {
    calories: Math.round(pick('Energy (kcal)', 'Energy')),
    protein:  round1(pick('Protein (g)', 'Protein')),
    carbs:    round1(pick('Carbs (g)', 'Carbohydrates (g)', 'Carbs')),
    fat:      round1(pick('Fat (g)', 'Fat')),
    fiber:    round1(pick('Fiber (g)', 'Fiber')),
    sugar:    round1(pick('Sugars (g)', 'Sugar')),
    water:    Math.round(pick('Water (g)', 'Water', 'Water (ml)')),
    sodium:    Math.round(pick('Sodium (mg)', 'Sodium')),
    potassium: Math.round(pick('Potassium (mg)', 'Potassium')),
    magnesium: Math.round(pick('Magnesium (mg)', 'Magnesium')),
    calcium:   Math.round(pick('Calcium (mg)', 'Calcium')),
    iron:      round1(pick('Iron (mg)', 'Iron')),
    caffeine:  Math.round(pick('Caffeine (mg)', 'Caffeine')),
  };
}

function classifyMeal(group, hh24) {
  // Prefer Cronometer's own Group label when present.
  const g = String(group || '').toLowerCase().trim();
  if (g.startsWith('break')) return 'breakfast';
  if (g.startsWith('lunch')) return 'lunch';
  if (g.startsWith('dinn'))  return 'dinner';
  if (g.startsWith('snack')) return 'snack';
  // Fallback: bucket by hour-of-day so we always emit a value (4-10 break,
  // 10-14 lunch, 14-18 snack, 18-22 dinner, 22-4 snack/late).
  const h = Number(hh24);
  if (!Number.isFinite(h)) return 'other';
  if (h >= 4  && h < 10) return 'breakfast';
  if (h >= 10 && h < 14) return 'lunch';
  if (h >= 14 && h < 18) return 'snack';
  if (h >= 18 && h < 22) return 'dinner';
  return 'snack';
}

function upsertMealEntries(date, rows) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const all = storage.get('nutritionLog') || [];
  // Drop any prior per-meal rows for this date so re-pulls reflect the
  // latest Cronometer state (foods deleted on Cronometer should disappear here).
  const prefix = `cronometer-meal:${date}:`;
  const filtered = all.filter(e => !(typeof e?.id === 'string' && e.id.startsWith(prefix)));

  let added = 0;
  rows.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;
    const rowDate = row['Day'] || row['Date'] || date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rowDate))) return;
    const hhmm = parseClockTime(row['Time'] || row['time']);
    if (!hhmm) return; // skip rows without a usable timestamp — they don't help meal-timing signals
    const [hh, mm] = hhmm.split(':');
    const isoTs = `${rowDate}T${hh}:${mm}:00`;
    const ts = new Date(isoTs);
    if (!isFinite(ts.getTime())) return;
    const macros = normalizeRowMacros(row);
    // Skip rows that contributed nothing (zero macros AND zero water) —
    // probably a placeholder or a parsing miss.
    if (!macros.calories && !macros.protein && !macros.carbs && !macros.fat && !macros.water) return;
    const meal = classifyMeal(row['Group'] || row['group'], hh);
    const id   = `${prefix}${hhmm}:${idx}`;
    filtered.push({
      id,
      name: row['Food Name'] || row['food'] || row['name'] || 'Cronometer entry',
      date: rowDate,
      time: hhmm,
      meal,
      source: 'cronometer-live-meal',
      servings: Number(row['Amount']) || Number(row['Quantity']) || 1,
      macros,
      timestamp: ts.toISOString(),
      createdAt: new Date().toISOString(),
    });
    added++;
  });
  storage.set('nutritionLog', filtered, { skipValidation: true });
  return added;
}

// ── Live cache (for UI staleness + diagnostics) ─────────────────────────────

function writeLiveCache(date, payload) {
  const current = storage.get('cronometerLive') || {};
  current[date] = {
    totals:    payload.totals,
    rowCount:  payload.rowCount,
    fetchedAt: payload.fetchedAt,
    cached:    payload.cached,
    // Keep a trimmed row list — useful for meal-timing view without blowing up
    // storage. 40 rows covers a very heavy log day.
    rows: Array.isArray(payload.rows) ? payload.rows.slice(0, 40) : [],
  };
  // Prune entries older than 14 days so this cache never grows unbounded.
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const [d, v] of Object.entries(current)) {
    if ((v?.fetchedAt || 0) < cutoff) delete current[d];
  }
  storage.set('cronometerLive', current, { skipValidation: true });
}

export function getLiveCacheFor(date) {
  const c = storage.get('cronometerLive') || {};
  return c[date] || null;
}

// ── The main fetch ──────────────────────────────────────────────────────────

/**
 * Pull a single day from Cronometer via the Worker.
 * Returns { ok, date, macros, fetchedAt, cached, rowCount, error? }.
 * Never throws — UI-friendly error shape.
 */
export async function fetchCronometerDay(date = localDate(), { type = 'servings', signal } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: 'bad_date', date };
  }
  const auth = getCronometerAuth();
  if (!auth) return { ok: false, error: 'no_auth', date };

  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) return { ok: false, error: 'no_worker_config', date };

  let res;
  try {
    res = await fetch(`${endpoint}/cronometer/pull`, {
      method: 'POST',
      signal,
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass, date, type }),
    });
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e?.message || e), date };
  }

  const bodyText = await res.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { body = null; }

  if (!res.ok) {
    const err = body?.error || `http_${res.status}`;
    return { ok: false, error: err, detail: body?.detail, status: res.status, date };
  }
  if (!body || !body.totals) {
    return { ok: false, error: 'empty_response', date };
  }

  const macros = normalizeTotals(body.totals);
  const meta   = { fetchedAt: body.fetchedAt || Date.now(), rowCount: body.rowCount, cached: !!body.cached };

  // Only upsert nutrition-log if there's actually data (rowCount > 0 OR any macro > 0).
  // An empty day shouldn't wipe out a prior non-empty import.
  const hasData = (body.rowCount || 0) > 0 || macros.calories > 0 || macros.protein > 0;
  let mealRowsWritten = 0;
  if (hasData) {
    upsertFullDayEntry(date, macros, meta);
    // Phase 4r.signals.1 — also write per-meal rows with timestamps. The
    // full-day rollup remains the source of truth for daily totals (so
    // macroForDate doesn't double-count); meal rows feed pre-training /
    // post-training tiles + meal-timing signals.
    mealRowsWritten = upsertMealEntries(date, body.rows || []);
  }

  writeLiveCache(date, { ...body, totals: body.totals, rows: body.rows || [] });

  return {
    ok: true, date, macros,
    fetchedAt: meta.fetchedAt, cached: meta.cached, rowCount: meta.rowCount,
    rows: body.rows || [],
    mealRowsWritten,
    totalsRaw: body.totals,
  };
}

// Convenience: today only
export async function fetchCronometerToday(opts) {
  return fetchCronometerDay(localDate(), opts);
}

// ── Backfill meal rows from the existing diagnostic cache (Phase 4r.signals.1) ─
// The Worker has been caching per-day row arrays in cronometerLive for up to
// 14 days (line ~162). Until now those rows were only consumed for staleness
// diagnostics — never written to nutritionLog. Now that the upsert path
// handles meal rows, we can backfill those cached days in one shot rather
// than waiting for each day to re-sync.
//
// Safe to call repeatedly: upsertMealEntries strips prior meal rows for a
// given date before writing the new set. Idempotent.
export function backfillCronometerMealsFromCache() {
  const cache = storage.get('cronometerLive') || {};
  let totalRowsAdded = 0;
  let daysProcessed = 0;
  for (const [date, payload] of Object.entries(cache)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    if (!rows.length) continue;
    const added = upsertMealEntries(date, rows);
    if (added > 0) {
      daysProcessed++;
      totalRowsAdded += added;
    }
  }
  return { daysProcessed, totalRowsAdded };
}

// Expose helper on window for debug + manual re-trigger.
if (typeof window !== 'undefined') {
  window.backfillCronometerMeals = function () {
    const r = backfillCronometerMealsFromCache();
    console.log(`[cronometer] backfill: ${r.daysProcessed} days · ${r.totalRowsAdded} meal rows written`);
    return r;
  };
  window.mealTimingDebug = function () {
    const log = storage.get('nutritionLog') || [];
    const live = log.filter(e => e?.source === 'cronometer-live-meal');
    const byDate = {};
    for (const e of live) {
      byDate[e.date] = (byDate[e.date] || 0) + 1;
    }
    const dates = Object.keys(byDate).sort();
    console.log('=== MEAL TIMING DEBUG ===');
    console.log(`Total nutritionLog rows: ${log.length}`);
    console.log(`  of which per-meal (cronometer-live-meal): ${live.length}`);
    console.log(`Days with meal rows: ${dates.length}`);
    if (dates.length) {
      console.log(`  range: ${dates[0]} → ${dates[dates.length - 1]}`);
      console.table(dates.map(d => ({ date: d, mealRows: byDate[d] })));
    } else {
      console.warn('No meal rows. Either Cronometer Worker hasn\'t pulled since the meal-timing change, or live cache is empty.');
      console.warn('Try: await window.cronometerSelfTest() — then re-run this debug.');
    }
    return { totalRows: log.length, mealRows: live.length, daysWithMealRows: dates.length };
  };
}

// ── One-shot smoke test (call from DevTools) ────────────────────────────────
export async function cronometerSelfTest() {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  const r = await fetchCronometerToday();
  return r;
}
