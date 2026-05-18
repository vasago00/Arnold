// ─── Full-sync orchestrator (Phase 4o.fullsync.1) ────────────────────────────
// One entry point that triggers every external sync source the app cares
// about: Cloud Sync (cross-device state), Garmin Worker (activities +
// wellness), Cronometer Worker (nutrition), FIT relay (phone-paired FIT
// pulls). Designed for app boot + visibility-change handlers — all sources
// run in parallel, each one's failure is independent, and per-source
// staleness thresholds keep us friendly to upstream rate limits.
//
// Usage:
//   await syncEverything();             // honors staleness thresholds
//   await syncEverything({ force: true }); // bypasses thresholds (manual sync)
//
// Returns: {
//   ok: boolean,                 // at least one source succeeded
//   ranSources: string[],        // which sources actually ran (skipped sources omitted)
//   results: { [source]: {...} },// per-source result objects
//   skippedFresh: string[],      // sources skipped because last run was fresh
//   skippedNotConfigured: string[], // sources skipped because not configured
//   durationMs: number,
// }

import { storage } from './storage.js';
import { pull as cloudPull, push as cloudPush } from './cloud-sync.js';

// Staleness thresholds — per source, in milliseconds. Sources whose last
// successful run is within this window get skipped on auto runs.
const THRESHOLDS = {
  garminActivities: 30 * 60 * 1000, // 30 min
  garminWellness:   30 * 60 * 1000, // 30 min
  garminWeight:     30 * 60 * 1000, // 30 min — mirrors the client-side TTL
  cronometer:       15 * 60 * 1000, // 15 min
  fitRelay:          5 * 60 * 1000, //  5 min
  // cloudSync push/pull have no threshold — always run, they're cheap
};

// Persistent meta — stamps last-success per source so we can throttle.
const META_KEY = 'fullSyncMeta';

function readMeta() {
  try { return storage.get(META_KEY) || {}; } catch { return {}; }
}
function writeMeta(meta) {
  try { storage.set(META_KEY, meta, { skipValidation: true }); } catch {}
}
function isFresh(source, now = Date.now()) {
  const meta = readMeta();
  const last = meta[source]?.lastOkAt || 0;
  return last > 0 && (now - last) < (THRESHOLDS[source] || 0);
}
function markRan(source, ok, extra = {}) {
  const meta = readMeta();
  meta[source] = {
    ...(meta[source] || {}),
    lastRunAt: Date.now(),
    ...(ok ? { lastOkAt: Date.now() } : {}),
    lastResult: ok ? 'ok' : 'error',
    ...extra,
  };
  writeMeta(meta);
}

/**
 * Run all sync sources. By default honors staleness thresholds; pass
 * `force: true` (manual user gesture) to bypass and run everything.
 *
 * Order: when manual, push first so user's local edits beat server data
 * to the cloud. When auto, pull first so the user reads the freshest
 * server state on open. Worker pulls happen in parallel either way.
 */
export async function syncEverything({ force = false } = {}) {
  const t0 = Date.now();
  const ranSources = [];
  const results = {};
  const skippedFresh = [];
  const skippedNotConfigured = [];

  // ── Cloud Sync ──
  // Always runs. Order swaps based on `force`:
  //   manual → push first (publish my edits)
  //   auto   → pull first (catch up on remote)
  const runCloudPush = async () => {
    try {
      const r = await cloudPush();
      results.cloudPush = r;
      ranSources.push('cloudPush');
      markRan('cloudPush', !r?.error && !r?.skipped);
    } catch (e) {
      results.cloudPush = { ok: false, error: e?.message || String(e) };
      markRan('cloudPush', false);
    }
  };
  const runCloudPull = async () => {
    try {
      // pull() now de-dupes via in-flight guard (Phase 4o.cloudsync.2),
      // so even if startCloudSync's initial pull is still running, this
      // call piggybacks on the same promise instead of firing a second
      // fetch + decrypt round-trip.
      const r = await cloudPull();
      results.cloudPull = r;
      ranSources.push('cloudPull');
      markRan('cloudPull', !r?.error && !r?.skipped);
    } catch (e) {
      results.cloudPull = { ok: false, error: e?.message || String(e) };
      markRan('cloudPull', false);
    }
  };

  // Phase 4o.cloudsync.7 — ALWAYS pull first, regardless of force.
  // The previous "manual = push first" logic caused data loss: if local
  // data was older than server (e.g. mobile hadn't pulled web's latest
  // changes yet), pushing first uploaded the stale local snapshot,
  // overwriting newer cross-device data on the server. Pull-first is the
  // only safe LWW protocol — read the latest state, merge, then push the
  // merged result. That way local-only edits still get published, but
  // they layer on top of remote rather than clobbering it.
  await runCloudPull();

  // ── Heavy sources — fire in parallel, each gated by staleness ──
  const tasks = [];

  // Garmin Activities (FITs from Worker)
  if (force || !isFresh('garminActivities')) {
    tasks.push((async () => {
      try {
        const { syncRecentActivities } = await import('./garmin-activities-client.js');
        const r = await syncRecentActivities({ daysBack: 14, limit: 30 });
        results.garminActivities = r;
        if (r?.ok) {
          ranSources.push('garminActivities');
          markRan('garminActivities', true, { added: r.added || 0 });
        } else if (r?.error === 'not_configured') {
          skippedNotConfigured.push('garminActivities');
        } else {
          markRan('garminActivities', false, { error: r?.error });
        }
      } catch (e) {
        results.garminActivities = { ok: false, error: e?.message || String(e) };
        markRan('garminActivities', false);
      }
    })());
  } else {
    skippedFresh.push('garminActivities');
  }

  // Garmin Wellness (sleep/HRV/RHR/BB/TR daily rows)
  if (force || !isFresh('garminWellness')) {
    tasks.push((async () => {
      try {
        const { backfillRecentBlanks } = await import('./garmin-client.js');
        const r = await backfillRecentBlanks({ daysBack: 14 });
        results.garminWellness = r;
        if (r?.ok || r?.filled != null) {
          ranSources.push('garminWellness');
          markRan('garminWellness', true, { filled: r?.filled || 0 });
        } else if (r?.error === 'not_configured' || r?.skipped === 'no_auth') {
          skippedNotConfigured.push('garminWellness');
        } else {
          markRan('garminWellness', false, { error: r?.error });
        }
      } catch (e) {
        results.garminWellness = { ok: false, error: e?.message || String(e) };
        markRan('garminWellness', false);
      }
    })());
  } else {
    skippedFresh.push('garminWellness');
  }

  // Cronometer (today's nutrition)
  if (force || !isFresh('cronometer')) {
    tasks.push((async () => {
      try {
        const { fetchCronometerToday } = await import('./cronometer-client.js');
        const r = await fetchCronometerToday();
        results.cronometer = r;
        if (r && !r.error) {
          ranSources.push('cronometer');
          markRan('cronometer', true);
        } else if (r?.error === 'not_configured') {
          skippedNotConfigured.push('cronometer');
        } else {
          markRan('cronometer', false, { error: r?.error });
        }
      } catch (e) {
        results.cronometer = { ok: false, error: e?.message || String(e) };
        markRan('cronometer', false);
      }
    })());
  } else {
    skippedFresh.push('cronometer');
  }

  // Garmin Weight (body-composition readings — Phase 4r.energy.7)
  // First-class source so pull-to-refresh actually re-syncs weight. The
  // client has its own identical TTL gate; force:true bypasses both. Skip
  // result with `skipped: 'fresh'` indicates the client's TTL gate fired,
  // which we surface as a fresh-skip here too.
  if (force || !isFresh('garminWeight')) {
    tasks.push((async () => {
      try {
        const { syncRecentWeight } = await import('./garmin-weight-client.js');
        const r = await syncRecentWeight({ daysBack: 30, force });
        results.garminWeight = r;
        if (r?.ok && r?.skipped !== 'fresh') {
          ranSources.push('garminWeight');
          markRan('garminWeight', true, { added: r.added || 0, replaced: r.replaced || 0 });
        } else if (r?.skipped === 'fresh') {
          skippedFresh.push('garminWeight');
        } else if (r?.error === 'not_configured' || r?.error === 'no_config') {
          skippedNotConfigured.push('garminWeight');
        } else {
          markRan('garminWeight', false, { error: r?.error });
        }
      } catch (e) {
        results.garminWeight = { ok: false, error: e?.message || String(e) };
        markRan('garminWeight', false);
      }
    })());
  } else {
    skippedFresh.push('garminWeight');
  }

  // FIT relay (phone-paired pulls)
  if (force || !isFresh('fitRelay')) {
    tasks.push((async () => {
      try {
        const { pullFitsNow } = await import('./fit-relay.js');
        const r = await pullFitsNow();
        results.fitRelay = r;
        if (r?.ok) {
          ranSources.push('fitRelay');
          markRan('fitRelay', true, { added: r?.added || 0 });
        } else if (r?.error === 'not_paired') {
          skippedNotConfigured.push('fitRelay');
        } else {
          markRan('fitRelay', false, { error: r?.error });
        }
      } catch (e) {
        results.fitRelay = { ok: false, error: e?.message || String(e) };
        markRan('fitRelay', false);
      }
    })());
  } else {
    skippedFresh.push('fitRelay');
  }

  await Promise.all(tasks);

  // Final push uploads the post-merge local state — any cloud-applied
  // changes that also touched local (or any local-only edits made before
  // sync) get republished cleanly. Same order in manual + auto modes
  // since cloudsync.7 made pull-first universal.
  await runCloudPush();

  return {
    ok: ranSources.length > 0,
    ranSources,
    results,
    skippedFresh,
    skippedNotConfigured,
    durationMs: Date.now() - t0,
  };
}

/**
 * Read the last-sync timestamps + status, for status indicator UI.
 * Returns { lastFullSyncAt, perSource: { source: { lastOkAt, lastResult, ... } } }.
 */
export function getFullSyncStatus() {
  const meta = readMeta();
  const lastOk = Object.values(meta)
    .map(m => m?.lastOkAt || 0)
    .reduce((max, t) => Math.max(max, t), 0);
  return {
    lastFullSyncAt: lastOk || null,
    perSource: meta,
  };
}
