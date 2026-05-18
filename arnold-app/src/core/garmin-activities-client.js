// ─── Garmin Activities Worker Client ─────────────────────────────────────────
// Auto-pull runs / strength / cycling / etc. from Garmin Connect via the Cloud
// Sync Worker's /garmin/activities/* endpoints. Mirror of garmin-client.js but
// for activities instead of wellness — same auth, same Worker config.
//
// Pipeline:
//   1. List recent activities from Garmin       → /garmin/activities/recent
//   2. Dedupe vs the existing `activities` storage collection (multi-key:
//      activityId in source, filename pattern `{id}_*`, or startTime within ±2 min)
//   3. For each new activity, download the FIT zip → /garmin/activities/{id}/fit
//   4. Unzip in the browser (fflate), extract the .fit blob
//   5. Run through the existing fitParser (no changes there — it already
//      produces the canonical activity shape the rest of Arnold expects)
//   6. Tag source = { type: 'garmin-worker', activityId, activityName }
//   7. Persist into the activities collection
//
// Once live, manual FIT uploads become a fallback / backfill path. Existing
// uploaded activities don't get rewritten — dedup ensures we never overwrite.

import { unzipSync } from 'fflate';
import { storage } from './storage.js';
import { getGarminAuth, isGarminConfigured } from './garmin-client.js';
import { parseFITFile } from './parsers/fitParser.js';

const CFG_ENDPOINT = 'arnold:cloud-sync:endpoint';
const CFG_TOKEN    = 'arnold:cloud-sync:token';

function getWorkerConfig() {
  const endpoint = (localStorage.getItem(CFG_ENDPOINT) || '').replace(/\/$/, '');
  const token    = localStorage.getItem(CFG_TOKEN) || '';
  return { endpoint, token };
}

// ── List recent activities ──────────────────────────────────────────────────

export async function listRecentActivities({ limit = 20, start = 0 } = {}) {
  const auth = getGarminAuth();
  if (!auth) return { ok: false, error: 'no_auth' };
  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) return { ok: false, error: 'no_worker_config' };

  let res;
  try {
    res = await fetch(`${endpoint}/garmin/activities/recent`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass, limit, start }),
    });
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e?.message || e) };
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    return { ok: false, error: body?.error || `http_${res.status}`, detail: body?.detail, status: res.status };
  }
  const activities = Array.isArray(body?.activities) ? body.activities : [];
  return { ok: true, activities, fetchedAt: body?.fetchedAt || Date.now() };
}

// ── Download a single activity's FIT bytes ──────────────────────────────────

async function downloadActivityFitBytes(activityId) {
  const auth = getGarminAuth();
  if (!auth) throw new Error('no_auth');
  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) throw new Error('no_worker_config');

  const res = await fetch(`${endpoint}/garmin/activities/${activityId}/fit`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify({ user: auth.user, pass: auth.pass }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`download_${res.status}:${t.slice(0, 200)}`);
  }
  const zipBuf = new Uint8Array(await res.arrayBuffer());
  // Garmin's ZIP contains a single file like `{activityId}_ACTIVITY.fit`.
  // unzipSync returns { filename: Uint8Array }. Pick the .fit entry.
  const entries = unzipSync(zipBuf);
  const fitName = Object.keys(entries).find(n => /\.fit$/i.test(n));
  if (!fitName) throw new Error('zip_no_fit_entry');
  return { bytes: entries[fitName], filename: fitName };
}

// ── Activity details enrichment ─────────────────────────────────────────────
// FIT files for many Garmin watches don't include time-in-HR-zone or
// totalTrainingLoad (EPOC) — those are computed server-side and live in the
// activity DTO at /activity-service/activity/{id}. This function calls our
// existing /garmin/activities/{id}/details Worker endpoint and merges the
// missing fields into the parsed activity. Called only when the FIT-extracted
// values are null, to avoid unnecessary API calls.
async function fetchActivityDetails(activityId) {
  const auth = getGarminAuth();
  if (!auth) throw new Error('no_auth');
  const { endpoint, token } = getWorkerConfig();
  if (!endpoint || !token) throw new Error('no_worker_config');

  const res = await fetch(`${endpoint}/garmin/activities/${activityId}/details`, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type':  'application/json',
    },
    body: JSON.stringify({ user: auth.user, pass: auth.pass }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`details_${res.status}:${t.slice(0, 200)}`);
  }
  const body = await res.json();
  return body.details || body; // worker wraps as { activityId, details, fetchedAt }
}

// Pull hrTimeInZone_1..5 + activityTrainingLoad off the Garmin activity DTO
// and return them in our canonical {hrZones, totalTrainingLoad} shape.
function extractFromDetails(details) {
  if (!details) return {};
  const summaryDTO = details.summaryDTO || details;
  // Time-in-zone: Garmin uses hrTimeInZone_1..5 (seconds), sometimes nested.
  const zoneVals = [];
  for (let i = 1; i <= 5; i++) {
    const candidates = [
      summaryDTO[`hrTimeInZone_${i}`],
      summaryDTO[`timeInHrZone_${i}`],
      details[`hrTimeInZone_${i}`],
    ];
    const v = candidates.find(x => x != null);
    if (v == null) { zoneVals.length = 0; break; }
    zoneVals.push(Math.round(parseFloat(v) || 0));
  }
  const out = {};
  if (zoneVals.length === 5) out.hrZones = zoneVals;
  // Training load — single number representing EPOC equivalent.
  const tl = summaryDTO.activityTrainingLoad ?? summaryDTO.trainingLoad ?? details.activityTrainingLoad;
  if (typeof tl === 'number' && tl > 0) out.totalTrainingLoad = Math.round(tl);
  // Optionally pick up VO2max if FIT didn't provide it
  const vo2 = summaryDTO.vO2MaxValue ?? details.vO2MaxValue;
  if (typeof vo2 === 'number' && vo2 > 0) out.vO2MaxValue = vo2;
  return out;
}

// ── HR zone bpm boundaries (user profile setting) ───────────────────────────
// Phase 4r.zones.2 — fetch the user's configured Garmin Connect HR zones
// (bpm-based boundaries set in Connect → User Settings → Heart Rate).
// We cache these into `profile.hrZoneBpm` so the rest of Arnold (post-
// workout zone bar synthesis, AI annotation single-zone labels, any
// future zone aggregations) can bin against the SAME boundaries that
// Garmin Connect uses. Without this, %HRmax thresholds drift away from
// the user's customized zones — e.g. 133 bpm at maxHR 165 is %HRmax
// Z4 but Garmin-bpm Z2.
//
// REQUIRES Worker endpoint:
//
//   POST  /garmin/user/hr-zones
//   body  { user, pass }
//   200   { zones: [
//             { zoneNumber: 1, bpmHigh: 122 },
//             { zoneNumber: 2, bpmHigh: 136 },
//             { zoneNumber: 3, bpmHigh: 150 },
//             { zoneNumber: 4, bpmHigh: 162 },
//             { zoneNumber: 5, bpmHigh: 999 }   // optional / sentinel
//           ] }
//
// The Worker proxies Garmin's authenticated
//   GET  https://connect.garmin.com/userprofile-service/userprofile/heart-rate-zones
// (uses the same login/cookie-jar pattern as the existing /activities endpoints).
//
// If the endpoint is missing (Worker not yet updated), this function
// fails silently and the rest of Arnold falls back to %HRmax. No UX
// breakage, no console error.
const HR_ZONES_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // re-fetch weekly

export async function fetchAndCacheHrZones({ force = false } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  const profile = storage.get('profile') || {};
  const cached  = profile?.hrZoneBpm;
  // TTL gate — skip when fresh, unless force=true.
  if (!force && cached?.fetchedAt && (Date.now() - cached.fetchedAt) < HR_ZONES_TTL_MS) {
    return { ok: true, cached: true, hrZoneBpm: cached };
  }
  const auth = getGarminAuth();
  const { endpoint, token } = getWorkerConfig();
  if (!auth || !endpoint || !token) return { ok: false, error: 'no_config' };

  let res;
  try {
    res = await fetch(`${endpoint}/garmin/user/hr-zones`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${token}`,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ user: auth.user, pass: auth.pass }),
    });
  } catch (e) {
    return { ok: false, error: 'network_error', detail: String(e?.message || e) };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { ok: false, error: `http_${res.status}`, detail: t.slice(0, 200) };
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  const zones = Array.isArray(body?.zones) ? body.zones : null;
  if (!zones || zones.length < 4) return { ok: false, error: 'malformed_response' };

  // Sort by zoneNumber so we always extract Z1..Z4 high-bpm in order,
  // regardless of how the upstream payload is ordered. We only need
  // Z1..Z4 — Z5 is implicit (>Z4 high).
  const sorted = [...zones].sort((a, b) => (a.zoneNumber || 0) - (b.zoneNumber || 0));
  const z1Max = Number(sorted[0]?.bpmHigh ?? sorted[0]?.zoneHighBoundary ?? sorted[0]?.high);
  const z2Max = Number(sorted[1]?.bpmHigh ?? sorted[1]?.zoneHighBoundary ?? sorted[1]?.high);
  const z3Max = Number(sorted[2]?.bpmHigh ?? sorted[2]?.zoneHighBoundary ?? sorted[2]?.high);
  const z4Max = Number(sorted[3]?.bpmHigh ?? sorted[3]?.zoneHighBoundary ?? sorted[3]?.high);
  if (![z1Max, z2Max, z3Max, z4Max].every(n => Number.isFinite(n) && n > 0)
      || !(z1Max < z2Max && z2Max < z3Max && z3Max < z4Max)) {
    return { ok: false, error: 'invalid_boundaries', boundaries: [z1Max, z2Max, z3Max, z4Max] };
  }

  const next = {
    source: 'garmin',
    fetchedAt: Date.now(),
    z1Max, z2Max, z3Max, z4Max,
  };
  storage.set('profile', { ...profile, hrZoneBpm: next });
  return { ok: true, cached: false, hrZoneBpm: next };
}

// Phase 4r.zones.4 — adaptive Karvonen-zone refresh.
// When the user has opted in by setting profile.hrZoneBpm.source = 'karvonen',
// this recomputes zones from current maxHR + 28-day trimmed-mean RHR on a
// weekly cadence. If any boundary has drifted ≥3 bpm vs the cached value
// (typical signal: fitness improvement → RHR drop → HRR widens → zones
// shift up), persist the new boundaries and clear the rebin flag so
// historical activities re-bucket against the updated zones.
//
// Manual or Garmin-synced zones (source: 'manual' / 'garmin') are LEFT
// ALONE — those reflect a deliberate choice, and silently overwriting
// them would be the wrong move. The user opts in/out via the source field.
import { recommendedZones } from './derive/hr.js';

const ZONE_DRIFT_BPM = 3;
const ZONE_RECOMPUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // weekly

// Hoisted here (used by adaptive zones AND by reBinActivitiesWithBpmZones
// further down) so adaptive recompute can clear the flag when zones drift.
const REBIN_FLAG = 'arnold:zones:rebin-against-bpm-2026-05-09';

export async function applyAdaptiveZonesIfDue() {
  const profile = storage.get('profile') || {};
  const current = profile.hrZoneBpm;
  if (current?.source !== 'karvonen') {
    return { ok: true, updated: false, reason: 'not_karvonen' };
  }
  // TTL gate — don't recompute more than weekly.
  if (current?.fetchedAt && (Date.now() - current.fetchedAt) < ZONE_RECOMPUTE_TTL_MS) {
    return { ok: true, updated: false, reason: 'fresh' };
  }
  const sleepHistory = storage.get('sleep') || [];
  const rec = recommendedZones({ profile, sleepHistory });
  if (!rec) return { ok: true, updated: false, reason: 'insufficient_data' };

  const KEYS = ['z1Max', 'z2Max', 'z3Max', 'z4Max'];
  const drifts = KEYS.map(k => ({
    zone: k,
    old: current[k],
    next: rec[k],
    delta: rec[k] - (current[k] || 0),
  }));
  const maxDrift = Math.max(...drifts.map(d => Math.abs(d.delta)));

  if (maxDrift < ZONE_DRIFT_BPM) {
    // Within tolerance — refresh fetchedAt so we don't re-evaluate every
    // boot, but don't disturb the existing values.
    storage.set('profile', { ...profile, hrZoneBpm: { ...current, fetchedAt: Date.now() } });
    return { ok: true, updated: false, reason: 'within_threshold', maxDrift, restingHR: rec.computedFrom.restingHR };
  }

  // Drift exceeds threshold — adopt the new zones.
  const next = {
    source: 'karvonen',
    fetchedAt: Date.now(),
    computedFrom: rec.computedFrom,
    z1Max: rec.z1Max,
    z2Max: rec.z2Max,
    z3Max: rec.z3Max,
    z4Max: rec.z4Max,
  };
  storage.set('profile', { ...profile, hrZoneBpm: next });
  // Force the rebin pass to re-run so existing activities re-bucket
  // against the new boundaries.
  try { localStorage.removeItem(REBIN_FLAG); } catch {}
  return { ok: true, updated: true, before: current, after: next, drifts, maxDrift };
}

// Phase 4r.zones.3 — re-bin hrZones for existing worker-imported activities
// using the user's custom bpm boundaries from profile.hrZoneBpm. Re-downloads
// each activity's FIT, parses it with zoneBpm so Path 0 (raw record bin)
// runs, and persists the new hrZones array. Triggered once after the bpm
// boundaries land in profile (via fetchAndCacheHrZones), and re-runs after
// adaptive Karvonen recompute (Phase 4r.zones.4) clears the flag on drift.
//
// Idempotent: skipped automatically when profile.hrZoneBpm is missing.
// Marker `hrZonesScheme: 'bpm-custom'` is set on each rebinned activity so
// future calls can skip already-correct ones (unless force=true).

export async function reBinActivitiesWithBpmZones({ daysBack = 30, onProgress, force = false } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  const profile = storage.get('profile') || {};
  const z = profile?.hrZoneBpm;
  if (!z) return { ok: false, error: 'no_zone_bpm' };
  const arr = [z.z1Max, z.z2Max, z.z3Max, z.z4Max].map(Number);
  if (!arr.every(n => Number.isFinite(n) && n > 0) || !(arr[0] < arr[1] && arr[1] < arr[2] && arr[2] < arr[3])) {
    return { ok: false, error: 'invalid_zone_bpm' };
  }
  const zoneBpm = { z1Max: arr[0], z2Max: arr[1], z3Max: arr[2], z4Max: arr[3] };

  const all = storage.get('activities') || [];
  const cutoffMs = Date.now() - daysBack * 86400 * 1000;
  // Re-bin: any worker-imported activity in the window whose hrZones
  // wasn't already produced by the bpm-custom binner.
  const targets = all.filter(a => {
    if (!a?.source?.activityId) return false;     // only worker-imported re-fetchable
    if (!a?.date) return false;
    // Phase 4r.utc.1 — anchor at noon-local to avoid UTC-midnight shift
    // that bumped boundary-day activities outside the cutoff window.
    if (new Date(a.date + 'T12:00:00').getTime() < cutoffMs) return false;
    if (force) return true;
    return a.hrZonesScheme !== 'bpm-custom';
  });
  if (!targets.length) return { ok: true, attempted: 0, rebinned: 0 };

  let rebinned = 0;
  const errors = [];
  for (const a of targets) {
    onProgress?.({ activityId: a.source.activityId, date: a.date });
    try {
      const { bytes, filename } = await downloadActivityFitBytes(a.source.activityId);
      const fakeFile = {
        name: filename,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
      const reparsed = await parseFITFile(fakeFile, { zoneBpm });
      if (Array.isArray(reparsed.hrZones) && reparsed.hrZones.length === 5) {
        a.hrZones = reparsed.hrZones;
        a.hrZonesScheme = 'bpm-custom';
        rebinned++;
      } else {
        // FIT had no usable record stream; clear stale hrZones so the
        // synth fallback (which uses bpm boundaries) takes over at display.
        delete a.hrZones;
        a.hrZonesScheme = 'unavailable';
      }
      await new Promise(r => setTimeout(r, 400));  // throttle
    } catch (e) {
      errors.push({ id: a.source.activityId, date: a.date, error: String(e?.message || e) });
    }
  }
  if (rebinned > 0 || errors.length === 0) {
    storage.set('activities', all, { skipValidation: true });
  }
  if (rebinned > 0) {
    try { localStorage.setItem(REBIN_FLAG, '1'); } catch {}
  }
  return { ok: true, attempted: targets.length, rebinned, errors };
}

export function hasRebinnedAgainstBpm() {
  try { return localStorage.getItem(REBIN_FLAG) === '1'; } catch { return false; }
}

// Public: enrich a list of stored activities with details. Idempotent — only
// re-fetches when hrZones or totalTrainingLoad is null. Returns count of
// activities updated.
export async function enrichRecentActivitiesWithDetails({ daysBack = 14, onProgress, force = false } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  const all = storage.get('activities') || [];
  const cutoffMs = Date.now() - daysBack * 86400 * 1000;
  // Find candidates: from last N days, missing zone or load data
  const targets = all.filter(a => {
    if (!a?.source?.activityId) return false; // only worker-imported can be enriched
    if (!a?.date) return false;
    // Phase 4r.utc.1 — anchor at noon-local to avoid UTC-midnight shift
    // that bumped boundary-day activities outside the cutoff window.
    if (new Date(a.date + 'T12:00:00').getTime() < cutoffMs) return false;
    if (force) return true;
    return a.hrZones == null || a.totalTrainingLoad == null;
  });
  if (!targets.length) return { ok: true, attempted: 0, enriched: 0 };

  let enriched = 0;
  const results = [];
  for (const a of targets) {
    onProgress?.({ activityId: a.source.activityId, date: a.date });
    try {
      const details = await fetchActivityDetails(a.source.activityId);
      const extra = extractFromDetails(details);
      if (Object.keys(extra).length) {
        Object.assign(a, extra);
        enriched++;
        results.push({ id: a.source.activityId, date: a.date, fields: Object.keys(extra) });
      }
      await new Promise(r => setTimeout(r, 350)); // be polite
    } catch (e) {
      results.push({ id: a.source.activityId, date: a.date, error: String(e?.message || e) });
    }
  }
  // Persist updates
  if (enriched > 0) {
    storage.set('activities', all, { skipValidation: true });
  }
  return { ok: true, attempted: targets.length, enriched, results };
}

// ── Dedup: is this Garmin activity already in our local collection? ─────────

function isAlreadyImported(activities, garminActivity) {
  const garminId = String(garminActivity.activityId);
  // ±2 min tolerance for start-time matching (legacy imports without ID).
  const garminStart = parseGarminLocalTime(garminActivity.startTimeLocal);
  const tolerance = 2 * 60 * 1000;

  for (const a of activities) {
    if (!a) continue;
    // 1. Direct ID match (Worker-imported activities tag this in source)
    if (a.source?.activityId && String(a.source.activityId) === garminId) return true;
    // 2. Filename pattern match for legacy manual uploads (e.g. "12345678901_ACTIVITY.fit")
    const fn = a.filename || a.source?.filename;
    if (fn) {
      const m = String(fn).match(/^(\d+)_/);
      if (m && m[1] === garminId) return true;
    }
    // 3. Start-time tolerance match — same date AND start time within 2 min.
    if (garminStart && a.date === isoDateOf(garminStart)) {
      const aStart = parseLocalDateTime(a.date, a.time);
      if (aStart && Math.abs(aStart - garminStart) <= tolerance) return true;
    }
  }
  return false;
}

function parseGarminLocalTime(s) {
  // Garmin returns "2026-04-28 06:30:00" (local, no timezone)
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function parseLocalDateTime(date, time) {
  if (!date) return null;
  const ts = (time && /^\d{1,2}:\d{2}/.test(time))
    ? `${date}T${time.length === 4 ? '0' + time : time}`
    : `${date}T00:00:00`;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

function isoDateOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Sync: pull list, dedupe, download new ones, parse, persist ──────────────

export async function syncRecentActivities({ daysBack = 14, limit = 30, onProgress } = {}) {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };

  // 1. Get the recent activity list
  const listRes = await listRecentActivities({ limit });
  if (!listRes.ok) return { ok: false, error: listRes.error, detail: listRes.detail };

  // Filter to within daysBack window so we don't pull years of history
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  const candidates = listRes.activities.filter(a => {
    const t = parseGarminLocalTime(a.startTimeLocal);
    return t != null && t >= cutoff;
  });

  // 2. Dedup
  const existing = storage.get('activities') || [];
  const newOnes = candidates.filter(a => !isAlreadyImported(existing, a));

  // Phase 4r.zones.3 — pass the user's cached bpm zone boundaries to
  // the FIT parser so raw HR records are re-binned against THEM rather
  // than trusting the watch's pre-computed time-in-zone (which uses
  // whatever zone scheme the watch is set to — typically %HRmax — and
  // diverges from Connect's UI when the user customizes zones).
  const profile = storage.get('profile') || {};
  const zoneBpm = (() => {
    const z = profile?.hrZoneBpm;
    if (!z) return null;
    const arr = [z.z1Max, z.z2Max, z.z3Max, z.z4Max].map(Number);
    if (!arr.every(n => Number.isFinite(n) && n > 0)) return null;
    if (!(arr[0] < arr[1] && arr[1] < arr[2] && arr[2] < arr[3])) return null;
    return { z1Max: arr[0], z2Max: arr[1], z3Max: arr[2], z4Max: arr[3] };
  })();

  // 3. Download + parse each new activity
  const results = [];
  for (const ga of newOnes) {
    onProgress?.({ phase: 'downloading', activityId: ga.activityId, name: ga.activityName });
    try {
      const { bytes, filename } = await downloadActivityFitBytes(ga.activityId);
      // parseFITFile expects a File-like object with .arrayBuffer() and .name
      const fakeFile = {
        name: filename,
        size: bytes.byteLength,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      };
      const parsed = await parseFITFile(fakeFile, { zoneBpm });
      // Tag the source so future syncs dedup by activityId
      parsed.source = {
        type: 'garmin-worker',
        activityId: ga.activityId,
        activityName: ga.activityName || null,
        downloadedAt: Date.now(),
      };
      // Phase 4r.zones.3 — when zoneBpm is set, hrZones from the FIT
      // (Path 0 = our custom bin) is authoritative. Fetch DTO only for
      // totalTrainingLoad in that case — never for hrZones, which would
      // overwrite the bpm-binned values with the DTO's %HRmax bins.
      const needsZones = !zoneBpm && parsed.hrZones == null;
      const needsLoad  = parsed.totalTrainingLoad == null;
      if (needsZones || needsLoad) {
        try {
          const details = await fetchActivityDetails(ga.activityId);
          const extra = extractFromDetails(details);
          // Strip hrZones from the DTO extras if we have zoneBpm — DTO
          // bins use %HRmax, not the user's custom bpm boundaries.
          if (zoneBpm) delete extra.hrZones;
          Object.assign(parsed, extra);
        } catch (e) {
          // Non-fatal — the activity still imports, just without enrichment.
          console.warn(`[garmin-enrich] activity ${ga.activityId} failed:`, e?.message || e);
        }
      }

      // Mobility override: if the FIT classified this as 'Strength' but the
      // user-entered activity name on Garmin (or the activityType.typeKey from
      // Garmin's API) indicates mobility/yoga/stretching, retag. Garmin's
      // strength_training sport bucket is broad — many users name their
      // mobility/stretch sessions "Mobility" but record under that sport.
      const nameTokens = [ga.activityName, ga.activityType?.typeKey, ga.activityType?.parentTypeKey]
        .filter(Boolean).join(' ').toLowerCase();
      // Mobility override: a "Strength" sport with mobility-related name
      if (parsed.activityType === 'Strength' &&
          /\b(mobility|stretch|stretching|yoga|pilates|flexibility|breathwork|meditation)\b/.test(nameTokens)) {
        parsed.activityType = 'Mobility';
        parsed.isStrength = false;
        parsed.isMobility = true;
      }
      // HIIT / Run override: Garmin's `sport=training` envelope often gets
      // tagged Strength by fitParser when subSport is missing or generic.
      // The activity name (and Garmin's typeKey) reliably says what it is —
      // "HIIT", "interval", "fartlek", "run", "tempo" all indicate a
      // run/HIIT session that should NOT be classified as resistance.
      else if (parsed.activityType === 'Strength' &&
          /\b(hiit|interval|fartlek|tempo|speed|track|sprint|run|jog|cardio)\b/.test(nameTokens)) {
        const isHiit = /\b(hiit|interval|fartlek|cardio|sprint)\b/.test(nameTokens);
        parsed.activityType = isHiit ? 'HIIT' : 'Run (outdoor)';
        parsed.isStrength = false;
        parsed.isRun = true;
        if (isHiit) parsed.isHIIT = true;
      }
      // ALSO promote a plain "Run" with a HIIT-style name to HIIT — so
      // Today's Plan matches a planned HIIT slot to a Fartlek/intervals run.
      else if ((parsed.activityType === 'Run (outdoor)' || parsed.activityType === 'Run (treadmill)') &&
          /\b(hiit|interval|fartlek|sprint)\b/.test(nameTokens)) {
        parsed.activityType = 'HIIT';
        parsed.isHIIT = true;
        parsed.isRun = true;  // still counts toward run distance/pace
      }
      // Garmin's activity-list payload includes vO2MaxValue per qualifying
      // workout (typically runs/cycling, occasionally rowing). The FIT file
      // doesn't always carry this — it's calculated post-hoc by Garmin's
      // algorithm from sub-maximal HR/pace. Capture it on the parsed activity
      // so the Clinical → VO₂Max tab can surface it as a watch estimate.
      if (typeof ga.vO2MaxValue === 'number' && ga.vO2MaxValue > 0) {
        parsed.vO2MaxValue = ga.vO2MaxValue;
      }
      // Also capture the activity name (less critical but useful for diagnostics)
      if (ga.activityName) parsed.activityName = ga.activityName;
      // Push into activities collection
      const all = storage.get('activities') || [];
      all.push(parsed);
      storage.set('activities', all, { skipValidation: true });
      results.push({ activityId: ga.activityId, name: ga.activityName, ok: true, type: parsed.activityType });
      // Be polite to Garmin — small inter-request gap
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      results.push({ activityId: ga.activityId, name: ga.activityName, ok: false, error: String(e?.message || e) });
    }
  }

  // 4. Update meta for the UI staleness indicator
  const meta = storage.get('garminWellnessMeta') || {};
  storage.set('garminWellnessMeta', {
    ...meta,
    lastActivitySyncAt: Date.now(),
    lastActivitySyncCount: results.filter(r => r.ok).length,
  }, { skipValidation: true });

  return {
    ok: true,
    candidates: candidates.length,
    skipped: candidates.length - newOnes.length,
    attempted: newOnes.length,
    successful: results.filter(r => r.ok).length,
    failed:     results.filter(r => !r.ok).length,
    results,
  };
}

// ── One-shot test (call from DevTools) ──────────────────────────────────────
export async function garminActivitiesSelfTest() {
  if (!isGarminConfigured()) return { ok: false, error: 'not_configured' };
  return listRecentActivities({ limit: 5 });
}
