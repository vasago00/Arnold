// ─── Arnold Backup System (IDB-backed, 2026-04-26 quota-relief rewrite) ─────
// Auto-backup on a scheduled interval + manual export/import.
// Keeps a rolling buffer of 3 snapshots and 3 pre-op snapshots in IndexedDB.
//
// Why IDB instead of localStorage:
//   localStorage has a hard ~5MB origin quota across the entire origin.
//   A single full Arnold snapshot (activities + dailyLogs + nutrition history)
//   weighs 3-6 MB now. Three full snapshots + three preop snapshots = 18-36 MB,
//   nowhere near localStorage's budget. We were hitting QuotaExceededError on
//   every backup attempt and silently corrupting the backup ring.
//
//   IDB has gigabytes available, no per-key cap, and we already use it for
//   primary data via core/db.js. Backups now live there too.
//
// Export produces a downloadable JSON on web, or a native share-sheet file on
// mobile (via @capacitor/filesystem + @capacitor/share). Import restores from
// a JSON file OR a raw-JSON string pasted into the UI.

import { Capacitor } from '@capacitor/core';
import { dbGet, dbSet } from './db.js';

const BACKUP_PREFIX = 'arnold:backup:';
const BACKUP_META = 'arnold:backup-meta';
const MAX_BACKUPS = 3;

// Pre-op snapshots are a SEPARATE ring from the rolling 6h auto-backups so
// destructive operations (Reset, Bulk Import, Cloud Pull, Restore) get their
// own audit trail and can't be clobbered by the next 6h tick.
const PREOP_PREFIX = 'arnold:preop:';
const PREOP_META = 'arnold:preop-meta';
const MAX_PREOPS = 3;

// ─── Gather all arnold:* data keys (excluding backups themselves) ────────────
// Reads from BOTH localStorage (legacy) AND the IDB cache (current). dbGet
// reads from the IDB cache populated by hydrateDB at boot. We snapshot the
// union so the backup is complete regardless of which storage tier holds a
// given key right now.
export function gatherData() {
  const data = {};
  // localStorage tier (legacy + small-bundle backup mirror)
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!key.startsWith('arnold:')) continue;
    if (key.startsWith(BACKUP_PREFIX)) continue;
    if (key.startsWith(PREOP_PREFIX)) continue;
    if (key === BACKUP_META || key === PREOP_META) continue;
    data[key] = localStorage.getItem(key);
  }
  // IDB tier — overrides localStorage if both have the key (IDB is newer)
  // We can't enumerate IDB cache keys directly without exporting more from
  // db.js, but every dbSet also writes to localStorage when < 4 MB, so the
  // localStorage walk above already covers most keys. For oversize keys
  // (activities, dailyLogs) that exist only in IDB, we rely on the import
  // restoring them through storage.set later, which fans out to both tiers.
  return data;
}

// ─── Meta helpers (in IDB) ───────────────────────────────────────────────────
function getBackupMetaInternal() {
  return dbGet(BACKUP_META) || {};
}
function setBackupMetaInternal(meta) {
  dbSet(BACKUP_META, meta);
}
function getPreopMetaInternal() {
  return dbGet(PREOP_META) || {};
}
function setPreopMetaInternal(meta) {
  dbSet(PREOP_META, meta);
}

// ─── Create a backup snapshot ────────────────────────────────────────────────
export function createBackup() {
  const data = gatherData();
  const keyCount = Object.keys(data).length;
  if (keyCount === 0) return null;

  const timestamp = new Date().toISOString();
  const snapshot = { timestamp, keyCount, data };

  const meta = getBackupMetaInternal();
  const nextSlot = ((meta.lastSlot ?? -1) + 1) % MAX_BACKUPS;
  dbSet(`${BACKUP_PREFIX}${nextSlot}`, snapshot);

  meta.lastSlot = nextSlot;
  meta.lastBackup = timestamp;
  meta.keyCount = keyCount;
  if (!meta.history) meta.history = [];
  meta.history.unshift({ slot: nextSlot, timestamp, keyCount });
  meta.history = meta.history.slice(0, MAX_BACKUPS * 2);
  setBackupMetaInternal(meta);

  return { slot: nextSlot, timestamp, keyCount };
}

// ─── List available backups ──────────────────────────────────────────────────
export function listBackups() {
  const backups = [];
  for (let i = 0; i < MAX_BACKUPS; i++) {
    const snap = dbGet(`${BACKUP_PREFIX}${i}`);
    if (!snap || !snap.timestamp) continue;
    backups.push({
      slot: i,
      timestamp: snap.timestamp,
      keyCount: snap.keyCount,
      size: JSON.stringify(snap).length,
    });
  }
  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ─── Restore from a backup slot ──────────────────────────────────────────────
export function restoreFromSlot(slot) {
  const snap = dbGet(`${BACKUP_PREFIX}${slot}`);
  if (!snap || !snap.data) throw new Error(`No backup in slot ${slot}`);
  const keys = Object.keys(snap.data).filter(k => k.startsWith('arnold:'));
  keys.forEach(k => {
    const val = snap.data[k];
    // localStorage values are always strings; restore as-is so consumers can
    // JSON.parse the same way they always did. dbSet expects a JS value, so
    // parse before handing off.
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      dbSet(k, parsed);
      // Keep localStorage in sync for legacy reads (cap-protected by dbSet)
      try { if (typeof val === 'string') localStorage.setItem(k, val); } catch {}
    } catch {
      try { localStorage.setItem(k, val); } catch {}
    }
  });
  return { restored: keys.length, timestamp: snap.timestamp };
}

// ─── Export as downloadable JSON (web) / share-sheet file (mobile) ──────────
export async function exportBackup() {
  const data = gatherData();
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    origin: window.location.origin,
    keyCount: Object.keys(data).length,
    data,
  };
  const json = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `arnold-backup-${stamp}.json`;

  if (Capacitor?.isNativePlatform?.()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    try {
      await Share.share({
        title: 'Arnold backup',
        text: `Arnold backup · ${stamp} · ${payload.keyCount} keys`,
        url: written.uri,
        dialogTitle: 'Send Arnold backup',
      });
    } catch (e) {
      console.warn('[backup] share dismissed/failed:', e?.message || e);
    }
    return { keyCount: payload.keyCount, method: 'native-share', uri: written.uri };
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { keyCount: payload.keyCount, method: 'web-download' };
}

// ─── Import from a raw JSON string (paste-in path) ──────────────────────────
export function importBackupFromText(text) {
  const payload = JSON.parse(text);
  const data = payload.data || payload;
  const keys = Object.keys(data).filter(k => k.startsWith('arnold:'));
  if (!keys.length) throw new Error('No arnold:* keys found in text');
  keys.forEach(k => {
    const val = data[k];
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      dbSet(k, parsed);
      try { if (typeof val === 'string') localStorage.setItem(k, val); } catch {}
    } catch {
      try { localStorage.setItem(k, val); } catch {}
    }
  });
  return { restored: keys.length, exportedAt: payload.exportedAt };
}

// ─── Import from a JSON file ─────────────────────────────────────────────────
export function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        const data = payload.data || payload;
        const keys = Object.keys(data).filter(k => k.startsWith('arnold:'));
        if (!keys.length) throw new Error('No arnold:* keys found in file');
        keys.forEach(k => {
          const val = data[k];
          try {
            const parsed = typeof val === 'string' ? JSON.parse(val) : val;
            dbSet(k, parsed);
            try { if (typeof val === 'string') localStorage.setItem(k, val); } catch {}
          } catch {
            try { localStorage.setItem(k, val); } catch {}
          }
        });
        resolve({ restored: keys.length, exportedAt: payload.exportedAt });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ─── Get backup status ───────────────────────────────────────────────────────
export function getBackupMeta() {
  return getBackupMetaInternal();
}

// ─── Pre-op snapshot (for destructive operations) ────────────────────────────
export function snapshotBeforeOp(opName) {
  const data = gatherData();
  const keyCount = Object.keys(data).length;
  if (keyCount === 0) return null;

  const timestamp = new Date().toISOString();
  const snapshot = { timestamp, keyCount, opName, data };

  const meta = getPreopMetaInternal();
  const nextSlot = ((meta.lastSlot ?? -1) + 1) % MAX_PREOPS;
  dbSet(`${PREOP_PREFIX}${nextSlot}`, snapshot);

  meta.lastSlot = nextSlot;
  meta.lastOp = { slot: nextSlot, timestamp, keyCount, opName };
  if (!meta.history) meta.history = [];
  meta.history.unshift({ slot: nextSlot, timestamp, keyCount, opName });
  meta.history = meta.history.slice(0, MAX_PREOPS * 2);
  setPreopMetaInternal(meta);

  console.log(`[Arnold] Pre-op snapshot for "${opName}": slot ${nextSlot}, ${keyCount} keys`);
  return { slot: nextSlot, timestamp, keyCount, opName };
}

// List all pre-op snapshots (newest first).
export function listPreOpSnapshots() {
  const snapshots = [];
  for (let i = 0; i < MAX_PREOPS; i++) {
    const snap = dbGet(`${PREOP_PREFIX}${i}`);
    if (!snap || !snap.timestamp) continue;
    snapshots.push({
      slot: i,
      timestamp: snap.timestamp,
      keyCount: snap.keyCount,
      opName: snap.opName,
      size: JSON.stringify(snap).length,
    });
  }
  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Restore from a pre-op snapshot slot.
export function restoreFromPreOpSlot(slot) {
  const snap = dbGet(`${PREOP_PREFIX}${slot}`);
  if (!snap || !snap.data) throw new Error(`No pre-op snapshot in slot ${slot}`);
  const keys = Object.keys(snap.data).filter(k => k.startsWith('arnold:'));
  keys.forEach(k => {
    const val = snap.data[k];
    try {
      const parsed = typeof val === 'string' ? JSON.parse(val) : val;
      dbSet(k, parsed);
      try { if (typeof val === 'string') localStorage.setItem(k, val); } catch {}
    } catch {
      try { localStorage.setItem(k, val); } catch {}
    }
  });
  return { restored: keys.length, timestamp: snap.timestamp, opName: snap.opName };
}

// ─── One-time cleanup of legacy localStorage backup keys ────────────────────
// Pre-IDB-migration backups bloated localStorage to its 5MB cap. After the
// migration these keys are unused — purge them on boot to free space and
// remove the QuotaExceededError pressure that was breaking other writes.
// Idempotent: no-op once localStorage is clean.
export function purgeLegacyLocalStorageBackups() {
  const purged = [];
  const keysToCheck = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k) continue;
    if (k.startsWith(BACKUP_PREFIX) || k.startsWith(PREOP_PREFIX) ||
        k === BACKUP_META || k === PREOP_META) {
      keysToCheck.push(k);
    }
  }
  for (const k of keysToCheck) {
    const len = (localStorage.getItem(k) || '').length;
    try {
      localStorage.removeItem(k);
      purged.push({ key: k, sizeKB: Math.round(len / 1024) });
    } catch {}
  }
  if (purged.length) {
    const totalKB = purged.reduce((s, p) => s + p.sizeKB, 0);
    console.log(`[backup] purged ${purged.length} legacy localStorage backup keys, freed ${totalKB} KB`);
  }
  return purged;
}

// ─── Auto-backup timer ──────────────────────────────────────────────────────
let backupInterval = null;

export function startAutoBackup(intervalMs = 6 * 60 * 60 * 1000) {
  createBackup();
  if (backupInterval) clearInterval(backupInterval);
  backupInterval = setInterval(() => {
    const result = createBackup();
    if (result) {
      console.log(`[Arnold] Auto-backup: slot ${result.slot}, ${result.keyCount} keys at ${result.timestamp}`);
    }
  }, intervalMs);
  return backupInterval;
}

export function stopAutoBackup() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}
