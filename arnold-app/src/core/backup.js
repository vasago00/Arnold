// ─── Arnold Backup System ────────────────────────────────────────────────────
// Auto-backup on a scheduled interval + manual export/import.
// Keeps a rolling buffer of 3 snapshots in localStorage.
// Export produces a downloadable JSON; import restores from one.

const BACKUP_PREFIX = 'arnold:backup:';
const BACKUP_META = 'arnold:backup-meta';
const MAX_BACKUPS = 3;

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

// ─── Export as downloadable JSON ─────────────────────────────────────────────
export function exportBackup() {
  const data = gatherData();
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    origin: window.location.origin,
    keyCount: Object.keys(data).length,
    data,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `arnold-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return payload.keyCount;
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
