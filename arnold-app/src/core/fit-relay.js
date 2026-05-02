// ─── Arnold FIT Relay (Phase 4b — direct activity transport) ────────────────
// A purpose-built channel for moving Garmin FIT activities between devices,
// independent of the encrypted-blob cloud-sync. Modeled after the Cronometer
// live-pull pattern: each device fetches FITs directly from a Worker endpoint
// using the same Bearer token + pairId as cloud-sync, but the FIT payloads
// themselves are plaintext JSON — no per-blob AES-GCM, no LWW races, no
// passphrase dependency.
//
// Why bypass cloud-sync for FITs:
//   FIT activity uploads were the ONE data type that depends entirely on the
//   encrypted-blob round-trip (Cronometer has its own live pull, HC reads
//   directly from Android). When cloud-sync degrades — passphrase mismatch
//   from re-pairing, version-lock from concurrent writes, decrypt errors —
//   FITs become invisible on the receiving device. This relay isolates FITs
//   from those failure modes.
//
// Security model:
//   Same Bearer token as the existing /s/:pairId blob endpoints. HTTPS only.
//   The pairId is the user's per-pairing CSPRNG-generated id; not guessable.
//   FIT payloads are fitness data, not credentials — no need for the heavier
//   PBKDF2-derived AES-GCM treatment. If the token leaks, the user rotates it.
//
// Lifecycle:
//   - Web parses a FIT → dailyLogs.fitActivities update → pushFit()
//   - Phone polls every 60s when foregrounded → pullRecentFits() → merges into
//     dailyLogs.fitActivities (union by id/filename, never erases)
//   - Worker auto-expires FITs after 90 days; the persisted local copy on each
//     device is the long-term store.

const PAIR_ID_KEY = 'arnold:cloud-sync:pair-id';
const ENDPOINT_KEY = 'arnold:cloud-sync:endpoint';
const TOKEN_KEY = 'arnold:cloud-sync:token';
const LAST_PULL_TS_KEY = 'arnold:fit-relay:last-pull-ts';

function getConfig() {
  return {
    endpoint: localStorage.getItem(ENDPOINT_KEY) || '',
    token: localStorage.getItem(TOKEN_KEY) || '',
    pairId: localStorage.getItem(PAIR_ID_KEY) || '',
  };
}

function isConfigured() {
  const c = getConfig();
  return !!(c.endpoint && c.token && c.pairId);
}

// ── Push: web → relay ───────────────────────────────────────────────────────
/**
 * Upload a parsed FIT activity to the relay so paired devices can pull it.
 * Idempotent: re-uploading the same date+filename overwrites the relay copy.
 *
 * @param {string}  date     "YYYY-MM-DD" local
 * @param {string}  filename Original FIT filename (e.g. "22671655244_ACTIVITY.fit")
 * @param {Object}  activity Parsed FIT activity (the object that lands in
 *                           dailyLogs[date].fitActivities[i])
 * @returns {Promise<{ok: boolean, error?: string, bytes?: number}>}
 */
export async function pushFit(date, filename, activity) {
  if (!isConfigured()) return { ok: false, error: 'not_paired' };
  const cfg = getConfig();
  const url = `${cfg.endpoint.replace(/\/$/, '')}/fit/${cfg.pairId}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ date, filename, activity }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    const payload = await res.json().catch(() => ({}));
    return { ok: true, bytes: payload.bytes };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Pull: relay → device ────────────────────────────────────────────────────
/**
 * Fetch all FITs uploaded to the relay within the last `days` days.
 * Returns the raw response array — caller is responsible for merging into
 * local dailyLogs (use mergeFitsIntoDailyLogs below for the standard path).
 *
 * @param {number} days  Default 14 — covers ~2 weeks of training history
 * @returns {Promise<{ok: boolean, fits?: Array, error?: string}>}
 */
export async function pullRecentFits(days = 14) {
  if (!isConfigured()) return { ok: false, error: 'not_paired' };
  const cfg = getConfig();
  const url = `${cfg.endpoint.replace(/\/$/, '')}/fit/${cfg.pairId}/recent?days=${days}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${cfg.token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `${res.status}: ${body.slice(0, 200)}` };
    }
    const payload = await res.json().catch(() => ({}));
    return { ok: true, fits: payload.fits || [] };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ── Merge helper: pulled FITs → local dailyLogs ─────────────────────────────
/**
 * Union-merge an array of relay-pulled FITs into the local dailyLogs storage.
 * Preserves every existing local FIT — the merge is keyed by activity id (or
 * filename + startTime fallback). Triggers exactly one storage.set so the
 * change-notifier and cloud-sync push fire at most once per merge batch.
 *
 * @param {Array<{date,filename,activity}>} fits  Output of pullRecentFits().fits
 * @param {Object} storage  The storage object from core/storage.js
 * @returns {{added: number, dates: string[]}}
 */
export function mergeFitsIntoDailyLogs(fits, storage) {
  if (!Array.isArray(fits) || !fits.length) return { added: 0, dates: [] };
  const logs = storage.get('dailyLogs') || [];
  const byDate = new Map();
  for (const log of logs) { if (log?.date) byDate.set(log.date, { ...log }); }

  const fitKey = a => a?.id || `${a?.startTime || ''}|${a?.activityType || ''}|${a?.source?.filename || ''}`;
  let addedCount = 0;
  const touchedDates = new Set();

  for (const entry of fits) {
    const { date, activity } = entry || {};
    if (!date || !activity) continue;
    let log = byDate.get(date);
    if (!log) {
      log = { date, fitActivities: [] };
      byDate.set(date, log);
    }
    if (!Array.isArray(log.fitActivities)) log.fitActivities = [];
    const existingKeys = new Set(log.fitActivities.map(fitKey));
    const incomingKey = fitKey(activity);
    if (!existingKeys.has(incomingKey)) {
      log.fitActivities = [...log.fitActivities, activity];
      addedCount++;
      touchedDates.add(date);
    }
  }

  if (addedCount > 0) {
    const merged = [...byDate.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    storage.set('dailyLogs', merged, { skipValidation: true });
  }

  return { added: addedCount, dates: [...touchedDates] };
}

// ── Periodic poll (foreground only) ─────────────────────────────────────────
let _pollInterval = null;
const POLL_INTERVAL_MS = 60 * 1000; // 60s — same cadence as Cronometer

/**
 * Start a foreground polling loop that pulls recent FITs and merges them.
 * Safe to call multiple times — second call is a no-op.
 *
 * @param {Object} storage    storage from core/storage.js
 * @param {Function} onMerge  Optional callback({added, dates}) after a successful merge
 */
export function startFitPolling(storage, onMerge) {
  if (_pollInterval) return;
  if (!isConfigured()) return;

  const tick = async () => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const result = await pullRecentFits(14);
    if (!result.ok) return; // silent — relay may be down, retry next tick
    const merge = mergeFitsIntoDailyLogs(result.fits, storage);
    try { localStorage.setItem(LAST_PULL_TS_KEY, String(Date.now())); } catch {}
    if (merge.added > 0) {
      console.log(`[fit-relay] pulled ${result.fits.length} FITs, merged ${merge.added} new on ${merge.dates.join(', ')}`);
      if (typeof onMerge === 'function') {
        try { onMerge(merge); } catch {}
      }
    }
  };

  // Run once immediately, then on interval
  tick();
  _pollInterval = setInterval(tick, POLL_INTERVAL_MS);
}

export function stopFitPolling() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}

/**
 * One-shot pull on demand (e.g., user taps a refresh button). Returns the
 * merge result so the UI can toast "merged N new FITs from relay".
 */
export async function pullFitsNow(storage) {
  if (!isConfigured()) return { ok: false, error: 'not_paired' };
  const result = await pullRecentFits(14);
  if (!result.ok) return result;
  const merge = mergeFitsIntoDailyLogs(result.fits, storage);
  try { localStorage.setItem(LAST_PULL_TS_KEY, String(Date.now())); } catch {}
  return { ok: true, ...merge, totalFits: result.fits.length };
}

export function getLastPullTimestamp() {
  const v = parseInt(localStorage.getItem(LAST_PULL_TS_KEY) || '0', 10);
  return isNaN(v) ? 0 : v;
}
