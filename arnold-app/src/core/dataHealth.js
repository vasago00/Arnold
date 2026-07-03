// dataHealth.js — Phase 1 of DATA_INTEGRITY_PLAN.md. The SINGLE source of truth
// for "is each data source present / fresh / stale / down". Everything that
// needs to know whether data is missing should consult this rather than
// re-deriving it (the bug that fabricated "Fuel 92%" lived in 3 scorers that
// each guessed at gap-handling). Phase 1 surfaces the gaps; later phases make
// scorers consume this and return typed no-data results.
//
// status per source: 'ok' | 'stale' | 'down' | 'never' | 'not-tracked'
//   ok          — data is fresh (within cadence)
//   stale       — configured, but newest data is older than the staleness window
//   down        — configured, and the source's last sync errored
//   never        — configured, but no data has ever landed
//   not-tracked — source isn't configured (omit silently; nothing to warn about)

import { storage } from './storage.js';
import { localDate } from './time.js';
import { isConfigured as isCronometerConfigured } from './cronometer-client.js';
import { isGarminConfigured, getGarminWellnessMeta } from './garmin-client.js';

const DAY = 86400000;

function daysAgo(dateStr, nowStr) {
  try { return Math.round((new Date(nowStr + 'T12:00:00') - new Date(dateStr + 'T12:00:00')) / DAY); }
  catch { return null; }
}

// Newest YYYY-MM-DD date across one or more storage buckets (arrays of {date}).
function latestDate(...keys) {
  let latest = null;
  for (const k of keys) {
    let rows;
    try { rows = storage.get(k); } catch { rows = null; }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const d = r && r.date;
      if (d && (!latest || d > latest)) latest = d;
    }
  }
  return latest;
}

function classify({ configured, lastDate, lastError, staleDays, now }) {
  if (!configured) return 'not-tracked';
  if (lastError) return 'down';
  if (!lastDate) return 'never';
  const age = daysAgo(lastDate, now);
  if (age != null && age >= staleDays) return 'stale';
  return 'ok';
}

/**
 * Snapshot of every data source's availability. Pure read over storage + the
 * per-source sync meta; safe to call on every render.
 * @returns {{ sources: Array, issues: Array, anyIssue: boolean, asOf: string }}
 */
export function dataHealth(now = localDate()) {
  const cronoOK = (() => { try { return isCronometerConfigured(); } catch { return false; } })();
  const garminOK = (() => { try { return isGarminConfigured(); } catch { return false; } })();
  const gMeta = (() => { try { return getGarminWellnessMeta() || {}; } catch { return {}; } })();

  // A Garmin sync error counts as "down" only if it's recent (within 2 days),
  // so an old one-off failure doesn't nag forever.
  const garminRecentError = (gMeta.lastErrorAt && (Date.now() - gMeta.lastErrorAt) < 2 * DAY)
    ? (gMeta.lastError || 'sync error') : null;

  const sources = [];
  const add = (s) => sources.push(s);

  // ── Nutrition (Cronometer) — daily; the one that bit us. No persisted error
  // meta, so detect a down/stale state purely by data age. ──
  {
    const lastDate = latestDate('cronometer', 'nutritionLog');
    const status = classify({ configured: cronoOK, lastDate, lastError: null, staleDays: 2, now });
    add({ id: 'nutrition', label: 'Nutrition · Cronometer', configured: cronoOK, status,
          lastDate, ageDays: lastDate ? daysAgo(lastDate, now) : null, lastError: null, retry: 'cronometer' });
  }

  // ── Sleep & HRV (Garmin wellness) — daily ──
  {
    const lastDate = latestDate('sleep', 'hrv');
    const status = classify({ configured: garminOK, lastDate, lastError: garminRecentError, staleDays: 2, now });
    add({ id: 'wellness', label: 'Sleep & HRV · Garmin', configured: garminOK, status,
          lastDate, ageDays: lastDate ? daysAgo(lastDate, now) : null, lastError: garminRecentError, retry: 'garminWellness' });
  }

  // ── Weight (Garmin) — weigh-ins aren't strictly daily; allow a 7-day window ──
  {
    const lastDate = latestDate('weight');
    const status = classify({ configured: garminOK, lastDate, lastError: null, staleDays: 7, now });
    add({ id: 'weight', label: 'Weight · Garmin', configured: garminOK, status,
          lastDate, ageDays: lastDate ? daysAgo(lastDate, now) : null, lastError: null, retry: 'garminWeight' });
  }

  // ── Activities (Garmin) — sporadic by nature (rest days have none), so NEVER
  // flag "stale" on age; only surface an explicit recent sync error. ──
  {
    const lastDate = latestDate('activities');
    const status = !garminOK ? 'not-tracked' : (garminRecentError ? 'down' : 'ok');
    add({ id: 'activities', label: 'Activities · Garmin', configured: garminOK, status,
          lastDate, ageDays: lastDate ? daysAgo(lastDate, now) : null, lastError: garminRecentError, retry: 'garminActivities' });
  }

  const issues = sources.filter(s => s.status === 'stale' || s.status === 'down' || s.status === 'never');
  return { sources, issues, anyIssue: issues.length > 0, asOf: now };
}

// Human phrase for a source's freshness, e.g. "last synced Jun 17 (2 days ago)".
export function freshnessPhrase(src) {
  if (!src) return '';
  if (src.status === 'never') return 'no data has synced yet';
  if (src.lastDate == null) return 'no data';
  const ago = src.ageDays;
  const when = (() => { try { return new Date(src.lastDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return src.lastDate; } })();
  const rel = ago === 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
  return `last data ${when} (${rel})`;
}


// ─── Dev panel (DATA_INTEGRITY_PLAN Phase 3) ──────────────────────────────────
// `dataHealthDebug()` in the console prints the per-source availability table AND
// the live TYPED scorer outputs for today — so the honest no-data/partial/stale
// states are inspectable at a glance (the dev counterpart to the user banner).
if (typeof window !== 'undefined') {
  window.dataHealthDebug = async function dataHealthDebug(dateStr) {
    const dh = dataHealth();
    console.log('%cData Health — per source (' + dh.asOf + ')', 'font-weight:bold');
    console.table(dh.sources.map(s => ({
      source: s.label || s.key, status: s.status, ageDays: s.ageDays ?? '—',
      freshness: freshnessPhrase(s), error: s.lastError || '',
    })));
    if (dh.issues.length) console.warn('Issues:', dh.issues.map(s => (s.label || s.key) + '=' + s.status).join(', '));
    else console.log('%cAll configured sources fresh.', 'color:#34d399');
    // Live typed scorer statuses — proves no fabricated numbers when data is absent.
    const scorerRows = [];
    try {
      const { fuelResult } = await import('./dcy.js');
      const fr = fuelResult(dateStr);
      scorerRows.push({ scorer: 'dcy.fuel', status: fr.status, value: fr.N, shown: (fr.status === 'no-data' || fr.status === 'not-tracked') ? '—' : (fr.N * 100).toFixed(0) + '%' });
    } catch (e) { scorerRows.push({ scorer: 'dcy.fuel', status: 'err', value: String(e?.message || e) }); }
    try {
      const { computeDailyScore } = await import('./trainingStress.js');
      const ds = computeDailyScore(dateStr);
      const nv = ds?.domains?.nutrition;
      scorerRows.push({ scorer: 'trainingStress.nutrition', status: nv == null ? 'no-data' : 'ok', value: nv, shown: nv == null ? '—' : (nv * 100).toFixed(0) + '%' });
    } catch (e) { scorerRows.push({ scorer: 'trainingStress.nutrition', status: 'err', value: String(e?.message || e) }); }
    console.log('%cLive typed scorer outputs (today)', 'font-weight:bold');
    console.table(scorerRows);
    return { dataHealth: dh, scorers: scorerRows };
  };
}
