// ─── Auto-Export to Downloads ───────────────────────────────────────────────
// Writes a Tier C snapshot to the user's Downloads folder as a JSON file.
// This is the ONE persistence layer that survives Chrome's "Clear site data"
// — because the file leaves the origin's sandbox entirely.
//
// Cadence:
//   • On app boot, if the last export is older than STALE_MS, export now.
//   • Every QUIET_WINDOW_MS of no writes, export IF (a) there were changes
//     AND (b) it's been at least MIN_INTERVAL_MS since the last passive
//     export. The MIN_INTERVAL_MS cap stops the Downloads folder from
//     accumulating dozens of files during a heavy-edit session — which was
//     the behavior before April 2026 when this file-per-quiet-window cadence
//     produced ~8 files in an evening. The boot-stale check still catches
//     the "edited lots, then browser wiped itself" recovery case.
//   • On explicit user click (Backup panel → "Export now") — bypasses the
//     MIN_INTERVAL_MS cap via force=true.
//
// Dedup:
//   We hash the snapshot; if the new hash matches the last-exported hash, we
//   skip the download so the user isn't spammed with identical files.
//
// Filename:
//   arnold-tier-c-YYYY-MM-DD-HHmm.json  (unique per export so nothing is
//   overwritten by the browser's download manager).

import { storage, onStorageChange, KEYS } from './storage.js';
import { fullKeysInTier, tierOfFullKey } from './storage-tiers.js';

const LAST_EXPORT_KEY = 'arnold:auto-export:last-ts';
const LAST_HASH_KEY = 'arnold:auto-export:last-hash';
const ENABLED_KEY = 'arnold:auto-export:enabled';

// 24 h between passive exports. If the user just made changes, we also
// trigger on a short quiet window — BUT capped by MIN_INTERVAL_MS below so
// we never do more than one passive export per 24 h.
const STALE_MS = 24 * 60 * 60 * 1000;
const QUIET_WINDOW_MS = 90 * 1000;
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // hard cap on passive exports

let _quietTimer = null;
let _started = false;
let _pendingChanges = false;

// Enabled by default; the user can turn it off via the Backup panel.
export function isEnabled() {
  const v = localStorage.getItem(ENABLED_KEY);
  return v === null ? true : v === '1';
}
export function setEnabled(on) {
  localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
}

function lastExportTs() {
  const v = parseInt(localStorage.getItem(LAST_EXPORT_KEY) || '0', 10);
  return Number.isFinite(v) ? v : 0;
}
export function getLastExportTs() { return lastExportTs(); }

async function sha256Hex(text) {
  try {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

function buildSnapshot() {
  const snap = {
    schema: 'arnold-tier-c-export/1',
    writtenAt: new Date().toISOString(),
    origin: location.origin,
    userAgent: navigator.userAgent,
    keys: {},
  };
  for (const fullKey of fullKeysInTier('C')) {
    const v = storage.get(fullKeyToCollection(fullKey));
    if (v != null) snap.keys[fullKey] = v;
  }
  return snap;
}

// Reverse-lookup: full storage key → collection name. storage.get accepts
// either, but we keep the collection name for readability of the snapshot.
const _reverseKeys = (() => {
  const m = {};
  for (const [col, fk] of Object.entries(KEYS)) m[fk] = col;
  return m;
})();
function fullKeyToCollection(fullKey) { return _reverseKeys[fullKey] || fullKey; }

function stamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick to let the download start cleanly.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Core exporter. Returns { exported, skipped, reason, bytes, hash, filename }.
// The `reason` field lets the Backup Status UI show why a pass was a no-op.
export async function exportTierCNow({ force = false } = {}) {
  if (!isEnabled() && !force) return { skipped: true, reason: 'disabled' };
  try {
    const snap = buildSnapshot();
    if (!Object.keys(snap.keys).length) {
      return { skipped: true, reason: 'empty' };
    }
    const text = JSON.stringify(snap);
    const hash = await sha256Hex(text);
    const lastHash = localStorage.getItem(LAST_HASH_KEY) || '';
    if (hash && hash === lastHash && !force) {
      return { skipped: true, reason: 'unchanged', hash };
    }
    const filename = `arnold-tier-c-${stamp()}.json`;
    triggerDownload(text, filename);
    localStorage.setItem(LAST_EXPORT_KEY, String(Date.now()));
    if (hash) localStorage.setItem(LAST_HASH_KEY, hash);
    _pendingChanges = false;
    return { exported: true, bytes: text.length, hash, filename };
  } catch (e) {
    console.error('[auto-export] failed:', e);
    return { skipped: true, reason: 'error', error: e.message };
  }
}

// Call once on app boot. If the last export is stale, export now; otherwise
// just subscribe to writes so future edits land in a downloaded file.
export async function startAutoExport() {
  if (_started) return;
  _started = true;

  // Initial pass: if stale, export.
  if (Date.now() - lastExportTs() > STALE_MS) {
    await exportTierCNow();
  }

  // Subscribe to storage writes; only Tier C changes arm the quiet-window timer.
  onStorageChange((fullKey) => {
    if (tierOfFullKey(fullKey) !== 'C') return;
    _pendingChanges = true;
    if (_quietTimer) clearTimeout(_quietTimer);
    _quietTimer = setTimeout(() => {
      _quietTimer = null;
      if (!_pendingChanges) return;
      // Daily cap: if we already exported within MIN_INTERVAL_MS, skip.
      // Keep _pendingChanges=true so the next tier-C write rearms the timer
      // and eventually retries once the 24 h window rolls over.
      const sinceLast = Date.now() - lastExportTs();
      if (sinceLast < MIN_INTERVAL_MS) {
        console.log(`[auto-export] skip: last export was ${Math.round(sinceLast / 60000)} min ago (cap: ${MIN_INTERVAL_MS / 60000} min)`);
        return;
      }
      exportTierCNow();
    }, QUIET_WINDOW_MS);
  });
}

// ── Import the other direction ──────────────────────────────────────────────
// Takes a parsed snapshot object (or the raw JSON string) and writes each
// Tier C key back into storage. Used by the Backup panel's Import flow.
export function applyExportedSnapshot(snapshotOrJson) {
  let snap = snapshotOrJson;
  if (typeof snap === 'string') snap = JSON.parse(snap);
  if (!snap || typeof snap !== 'object' || !snap.keys) {
    return { applied: 0, error: 'invalid snapshot' };
  }
  let applied = 0;
  for (const [fullKey, value] of Object.entries(snap.keys)) {
    const col = fullKeyToCollection(fullKey);
    try {
      storage.set(col, value, { skipValidation: true });
      applied++;
    } catch (e) {
      console.warn('[auto-export] apply failed for', fullKey, e);
    }
  }
  return { applied, writtenAt: snap.writtenAt };
}
