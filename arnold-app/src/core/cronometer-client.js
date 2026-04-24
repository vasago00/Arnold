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

// ── Config ──────────────────────────────────────────────────────────────────

const CFG_ENDPOINT = 'arnold:cloud-sync:endpoint';
const CFG_TOKEN    = 'arnold:cloud-sync:token';

// Local date helper — avoids UTC rollover at midnight
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  if (hasData) {
    upsertFullDayEntry(date, macros, meta);
  }

  writeLiveCache(date, { ...body, totals: body.totals, rows: body.rows || [] });

  return {
    ok: true, date, macros,
    fetchedAt: meta.fetchedAt, cached: meta.cached, rowCount: meta.rowCount,
    rows: body.rows || [],
    totalsRaw: body.totals,
  };
}

// Convenience: today only
export async function fetchCronometerToday(opts) {
  return fetchCronometerDay(localDate(), opts);
}

// ── One-shot smoke test (call from DevTools) ────────────────────────────────
export async function cronometerSelfTest() {
  if (!isConfigured()) return { ok: false, error: 'not_configured' };
  const r = await fetchCronometerToday();
  return r;
}
