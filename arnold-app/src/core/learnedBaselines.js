// ─── Learned Baselines (Phase 4r.intel.10 — Layer 2 personalization) ────────
// Builds a per-(family × metric) running statistic from the user's last
// 60 days of activities. blendWithBaseline() in expectedRanges.js already
// consumes the {mean, std, n} shape returned by getBaseline(), tilting the
// population norm toward the user's actual signature as n grows.
//
// Why this is "Layer 2": expectedRanges.js Layer 1 is the published norm
// (Daniels/Friel/Seiler). Layer 2 is "you, specifically" — your easy-run
// HR drift on a humid morning is not the same as the textbook 8 BPM, and
// once we have 20+ observations in a bucket we trust your numbers more
// than the textbook.
//
// Storage:
//   key  = 'arnold:learnedBaselines'
//   shape = {
//     [family]: {
//       [metricId]: {
//         observations: [ { date, value } ],   // last 60 days, ±3 SD trimmed
//         mean: number, std: number, n: number,
//         updatedAt: number,
//       }
//     }
//   }
//
// API:
//   recordObservation(family, metricId, value, dateStr)
//   getBaseline(family, metricId) → { mean, std, n }
//   recordActivityObservations(activity) — convenience: extract every
//     intel-relevant metric from a parsed activity and write each one.
//
// Side-effect free reads: getBaseline returns null when n < MIN_OBSERVATIONS
// so the rules engine keeps the population norm during the bootstrap phase.

import { storage } from './storage.js';
import { parseLocalDate } from './dateUtils.js';

const STORAGE_KEY = 'arnold:learnedBaselines';
const WINDOW_DAYS = 60;
const WINDOW_MS   = WINDOW_DAYS * 24 * 60 * 60 * 1000;
const OUTLIER_SD  = 3;
const MIN_OBSERVATIONS = 5;  // below this, return null so Layer 1 wins outright

// ─── helpers ────────────────────────────────────────────────────────────────

function readStore() {
  try { return storage.get(STORAGE_KEY) || {}; } catch { return {}; }
}

function writeStore(s) {
  try { storage.set(STORAGE_KEY, s, { skipValidation: true }); } catch {}
}

function statsOf(obs) {
  const vals = obs.map(o => Number(o.value)).filter(v => Number.isFinite(v));
  const n = vals.length;
  if (n === 0) return { mean: NaN, std: NaN, n: 0 };
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  if (n === 1) return { mean, std: 0, n };
  const variance = vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (n - 1);
  return { mean, std: Math.sqrt(variance), n };
}

function trimOutliers(obs) {
  if (obs.length < 4) return obs.slice();
  const { mean, std } = statsOf(obs);
  if (!Number.isFinite(std) || std === 0) return obs.slice();
  return obs.filter(o => Math.abs(Number(o.value) - mean) <= OUTLIER_SD * std);
}

function pruneWindow(obs, nowMs) {
  const cutoff = nowMs - WINDOW_MS;
  return obs.filter(o => {
    const d = parseLocalDate(o.date);
    return d && d.getTime() >= cutoff;
  });
}

// ─── public API ─────────────────────────────────────────────────────────────

/**
 * Record one (family, metricId, value) observation. Recomputes the
 * rolling stats for that bucket. Idempotent on the same (date, value).
 */
export function recordObservation(family, metricId, value, dateStr) {
  if (!family || !metricId) return;
  if (!Number.isFinite(Number(value))) return;
  if (!dateStr || typeof dateStr !== 'string') return;

  const store = readStore();
  const famSlot = store[family] || (store[family] = {});
  const bucket = famSlot[metricId] || (famSlot[metricId] = { observations: [] });

  // De-dupe by (date, value) so re-running the writer on the same activity
  // doesn't double-count.
  const v = Number(value);
  const dupeIdx = bucket.observations.findIndex(o => o.date === dateStr && Number(o.value) === v);
  if (dupeIdx < 0) bucket.observations.push({ date: dateStr, value: v });

  // Roll the window then trim ±3 SD outliers from THAT window.
  const now = Date.now();
  const windowed = pruneWindow(bucket.observations, now);
  const trimmed  = trimOutliers(windowed);
  const { mean, std, n } = statsOf(trimmed);

  bucket.observations = windowed;  // keep windowed (not trimmed) so an
                                   // outlier two weeks ago can fall off
                                   // naturally without losing context.
  bucket.mean = Number.isFinite(mean) ? mean : null;
  bucket.std  = Number.isFinite(std)  ? std  : null;
  bucket.n    = n;
  bucket.updatedAt = now;

  writeStore(store);
}

/**
 * Returns { mean, std, n } for blendWithBaseline. Returns null below the
 * minimum observation count so callers stay on Layer 1 during bootstrap.
 */
export function getBaseline(family, metricId) {
  if (!family || !metricId) return null;
  const store = readStore();
  const bucket = store[family] && store[family][metricId];
  if (!bucket) return null;
  if (!Number.isFinite(bucket.mean) || !Number.isFinite(bucket.std)) return null;
  if (bucket.n < MIN_OBSERVATIONS) return null;
  return { mean: bucket.mean, std: bucket.std, n: bucket.n };
}

/**
 * Pure helper for tests / debug: dump all buckets.
 */
export function inspectBaselines() {
  return readStore();
}

// ─── activity → observations adapter ────────────────────────────────────────

/**
 * Map a parsed activity to its intel-relevant metric values. Mirrors the
 * metric IDs from expectedRanges.js so blendWithBaseline picks them up.
 */
function metricsFromActivity(activity, opts) {
  opts = opts || {};
  const maxHR = Number(opts.maxHR) || Number(activity?.maxHR) || null;
  const out = {};
  const avgHR = Number(activity?.avgHR);
  if (Number.isFinite(avgHR) && maxHR && maxHR > 100) {
    out.avgHR_pctMax = (avgHR / maxHR) * 100;
  }
  const z45 = Number(activity?.z45Pct);
  if (Number.isFinite(z45)) out.z45Pct = z45;
  const z2 = Number(activity?.z2Pct);
  if (Number.isFinite(z2)) out.z2Pct = z2;
  const aeT = Number(activity?.aerobicTE);
  if (Number.isFinite(aeT)) out.aerobicTE = aeT;
  const anT = Number(activity?.anaerobicTE);
  if (Number.isFinite(anT)) out.anaerobicTE = anT;
  const drift = Number(activity?.cardiacDrift);
  if (Number.isFinite(drift)) out.cardiacDrift = drift;
  const rec = Number(activity?.hrRecovery1m ?? activity?.hrRecovery);
  if (Number.isFinite(rec)) out.hrRecovery1m = rec;
  const decoup = Number(activity?.decoupling);
  if (Number.isFinite(decoup)) out.decoupling = decoup;
  return out;
}

/**
 * One-call write of every intel metric from a freshly parsed activity.
 * Caller passes the activity, profile (for maxHR), and the activity date
 * string. Skips silently when family or date can't be determined — those
 * activities just don't contribute to the baseline.
 */
export function recordActivityObservations(activity, opts) {
  opts = opts || {};
  const family = (activity && (activity.planType || activity.family)) || null;
  const dateStr = activity && activity.date;
  if (!family || !dateStr) return;
  const metrics = metricsFromActivity(activity, opts);
  for (const metricId of Object.keys(metrics)) {
    recordObservation(family, metricId, metrics[metricId], dateStr);
  }
}
// ─── Backfill helper ───────────────────────────────────────────────────────

/**
 * Walk every activity in storage once and record its intel metrics. Designed
 * to run a single time on app boot after Layer 2 ships (or on demand from
 * dev tools). Guarded by a sentinel key so it doesn't re-run on every boot.
 *
 * @param {Array} activities — full activity list (from storage.get('activities')).
 * @param {Object} profile   — current profile (for maxHR fallback).
 * @returns {{ scanned:number, written:number, skipped:boolean }}
 */
const BACKFILL_DONE_KEY = 'arnold:learnedBaselines:backfilledAt';

export function backfillFromActivities(activities, profile) {
  let already;
  try { already = storage.get(BACKFILL_DONE_KEY); } catch { already = null; }
  if (already) return { scanned: 0, written: 0, skipped: true };

  if (!Array.isArray(activities) || !activities.length) {
    return { scanned: 0, written: 0, skipped: false };
  }
  const maxHR = parseFloat(profile?.maxHR) || null;
  let written = 0;
  for (const a of activities) {
    if (!a || !a.date) continue;
    try {
      recordActivityObservations(a, { maxHR });
      written += 1;
    } catch {}
  }
  try { storage.set(BACKFILL_DONE_KEY, Date.now(), { skipValidation: true }); } catch {}
  return { scanned: activities.length, written, skipped: false };
}

