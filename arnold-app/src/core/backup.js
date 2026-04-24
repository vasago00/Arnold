// ─── Arnold Backup System ────────────────────────────────────────────────────
// Auto-backup on a scheduled interval + manual export/import.
// Keeps a rolling buffer of 3 snapshots in localStorage.
// Export produces a downloadable JSON on web, or a native share-sheet file on
// mobile (via @capacitor/filesystem + @capacitor/share). Import restores from
// a JSON file OR a raw-JSON string pasted into the UI.

import { Capacitor } from '@capacitor/core';

const BACKUP_PREFIX = 'arnold:backup:';
const BACKUP_META = 'arnold:backup-meta';
const MAX_BACKUPS = 3;

// Pre-op snapshots are a SEPARATE ring from the rolling 6h auto-backups so
// destructive operations (Reset, Bulk Import, Cloud Pull, Restore) get their
// own audit trail and can't be clobbered by the next 6h tick.
const PREOP_PREFIX = 'arnold:preop:';
const PREOP_META = 'arnold:preop-meta';
const MAX_PREOPS = 10;

// ─── Gather all arnold:* data keys (excluding backups themselves) ────────────
export function gatherData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('arnold:') && !key.startsWith('arnold:backup')) {
      data[key] = localStorage.getItem(key);
    }
  }
  return data;
}

// ─── Create a backup snapshot ────────────────────────────────────────────────
export function createBackup() {
  const data = gatherData();
  const keyCount = Object.keys(data).length;
  if (keyCount === 0) return null;

  const timestamp = new Date().toISOString();
  const snapshot = JSON.stringify({ timestamp, keyCount, data });

  // Get current meta
  let meta;
  try { meta = JSON.parse(localStorage.getItem(BACKUP_META) || '{}'); }
  catch { meta = {}; }

  // Circular buffer: slot 0, 1, 2
  const nextSlot = ((meta.lastSlot ?? -1) + 1) % MAX_BACKUPS;
  localStorage.setItem(`${BACKUP_PREFIX}${nextSlot}`, snapshot);

  // Update meta
  meta.lastSlot = nextSlot;
  meta.lastBackup = timestamp;
  meta.keyCount = keyCount;
  if (!meta.history) meta.history = [];
  meta.history.unshift({ slot: nextSlot, timestamp, keyCount });
  meta.history = meta.history.slice(0, MAX_BACKUPS * 2); // keep some history
  localStorage.setItem(BACKUP_META, JSON.stringify(meta));

  return { slot: nextSlot, timestamp, keyCount };
}

// ─── List available backups ──────────────────────────────────────────────────
export function listBackups() {
  const backups = [];
  for (let i = 0; i < MAX_BACKUPS; i++) {
    const raw = localStorage.getItem(`${BACKUP_PREFIX}${i}`);
    if (!raw) continue;
    try {
      const snap = JSON.parse(raw);
      backups.push({
        slot: i,
        timestamp: snap.timestamp,
        keyCount: snap.keyCount,
        size: raw.length,
      });
    } catch { /* skip corrupt */ }
  }
  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ─── Restore from a backup slot ──────────────────────────────────────────────
export function restoreFromSlot(slot) {
  const raw = localStorage.getItem(`${BACKUP_PREFIX}${slot}`);
  if (!raw) throw new Error(`No backup in slot ${slot}`);
  const snap = JSON.parse(raw);
  const keys = Object.keys(snap.data).filter(k => k.startsWith('arnold:'));
  keys.forEach(k => localStorage.setItem(k, snap.data[k]));
  return { restored: keys.length, timestamp: snap.timestamp };
}

// ─── Export as downloadable JSON (web) / share-sheet file (mobile) ──────────
//
// WEB path:    creates a Blob, clicks an <a download> — normal browser save.
// MOBILE path: uses @capacitor/filesystem to write the JSON into the app's
//              cache directory, then @capacitor/share to open the native share
//              sheet so the user can email, Drive-upload, USB-transfer, etc.
//              Returns { keyCount, method, uri? } so the caller can show a
//              meaningful toast.
//
// Both paths are async because Capacitor calls are. Callers MUST await.
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

  // ── Mobile (Capacitor native) path ─────────────────────────────────────────
  if (Capacitor?.isNativePlatform?.()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    // Write into Cache so FileProvider-backed Share can expose it. Cache is
    // auto-evictable but that's fine — the user will share it immediately.
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
      // User dismissed or share failed; the file still exists in cache under
      // `written.uri` so we surface the path so the caller can tell the user
      // where to find it manually.
      console.warn('[backup] share dismissed/failed:', e?.message || e);
    }
    return { keyCount: payload.keyCount, method: 'native-share', uri: written.uri };
  }

  // ── Web (browser) path: blob download ─────────────────────────────────────
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
// Mirrors importBackup() below but takes a string instead of a File. Used by
// the "paste backup text" input in BackupPanel as a fallback when file
// transfer from another device isn't available.
export function importBackupFromText(text) {
  const payload = JSON.parse(text);
  const data = payload.data || payload;
  const keys = Object.keys(data).filter(k => k.startsWith('arnold:'));
  if (!keys.length) throw new Error('No arnold:* keys found in text');
  keys.forEach(k => localStorage.setItem(k, data[k]));
  return { restored: keys.length, exportedAt: payload.exportedAt };
}

// ─── Import from a JSON file ─────────────────────────────────────────────────
export function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        const data = payload.data || payload; // support raw or wrapped format
        const keys = Object.keys(data).filter(k => k.startsWith('arnold:'));
        if (!keys.length) throw new Error('No arnold:* keys found in file');
        keys.forEach(k => localStorage.setItem(k, data[k]));
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
  try { return JSON.parse(localStorage.getItem(BACKUP_META) || '{}'); }
  catch { return {}; }
}

// ─── Pre-op snapshot (for destructive operations) ────────────────────────────
// Writes a full snapshot of all arnold:* keys to a separate ring buffer.
// Call this IMMEDIATELY BEFORE any destructive op (Reset, Bulk Import, Pull,
// Restore) so the user always has an explicit rollback point tagged with the
// operation that caused the risk. Returns { slot, timestamp, keyCount, opName }
// or null if nothing to snapshot.
export function snapshotBeforeOp(opName) {
  const data = gatherData();
  const keyCount = Object.keys(data).length;
  if (keyCount === 0) return null;

  const timestamp = new Date().toISOString();
  const snapshot = JSON.stringify({ timestamp, keyCount, opName, data });

  let meta;
  try { meta = JSON.parse(localStorage.getItem(PREOP_META) || '{}'); }
  catch { meta = {}; }

  const nextSlot = ((meta.lastSlot ?? -1) + 1) % MAX_PREOPS;
  localStorage.setItem(`${PREOP_PREFIX}${nextSlot}`, snapshot);

  meta.lastSlot = nextSlot;
  meta.lastOp = { slot: nextSlot, timestamp, keyCount, opName };
  if (!meta.history) meta.history = [];
  meta.history.unshift({ slot: nextSlot, timestamp, keyCount, opName });
  meta.history = meta.history.slice(0, MAX_PREOPS * 2);
  localStorage.setItem(PREOP_META, JSON.stringify(meta));

  console.log(`[Arnold] Pre-op snapshot for "${opName}": slot ${nextSlot}, ${keyCount} keys`);
  return { slot: nextSlot, timestamp, keyCount, opName };
}

// List all pre-op snapshots (newest first).
export function listPreOpSnapshots() {
  const snapshots = [];
  for (let i = 0; i < MAX_PREOPS; i++) {
    const raw = localStorage.getItem(`${PREOP_PREFIX}${i}`);
    if (!raw) continue;
    try {
      const snap = JSON.parse(raw);
      snapshots.push({
        slot: i,
        timestamp: snap.timestamp,
        keyCount: snap.keyCount,
        opName: snap.opName,
        size: raw.length,
      });
    } catch { /* skip corrupt */ }
  }
  return snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// Restore from a pre-op snapshot slot. Overwrites localStorage arnold:* keys.
export function restoreFromPreOpSlot(slot) {
  const raw = localStorage.getItem(`${PREOP_PREFIX}${slot}`);
  if (!raw) throw new Error(`No pre-op snapshot in slot ${slot}`);
  const snap = JSON.parse(raw);
  const keys = Object.keys(snap.data).filter(k => k.startsWith('arnold:'));
  keys.forEach(k => localStorage.setItem(k, snap.data[k]));
  return { restored: keys.length, timestamp: snap.timestamp, opName: snap.opName };
}

// ─── Auto-backup timer ──────────────────────────────────────────────────────
let backupInterval = null;

export function startAutoBackup(intervalMs = 6 * 60 * 60 * 1000) { // default 6 hours
  // Run one immediately on start
  createBackup();

  // Clear any existing interval
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
