// ─── Origin Private File System (OPFS) Persistence ─────────────────────────
// OPFS gives the app a private, sandboxed filesystem per-origin that is
// separate from localStorage and IndexedDB. On most browsers, clearing
// "Site data" will empty OPFS too — but OPFS survives localStorage.clear()
// from in-app code, survives a browser crash better than IDB, and survives
// DevTools toggles that miss the full site-clear checkbox.
//
// We use OPFS as a THIRD durability layer for Tier C (critical) keys:
//   localStorage (fast synchronous) → IndexedDB (mirror) → OPFS (independent).
//
// Schema:
//   /arnold/tier-c/<sanitized-full-key>.json
//   /arnold/manifest.json   ← { [fullKey]: { bytes, writtenAt, sha256 } }
//
// The manifest lets startup-heal know at a glance what's stored without
// opening every file. Writes are async and fire-and-forget from the caller's
// perspective; the in-memory cache is the source of truth for reads.

const ROOT_DIR = 'arnold';
const TIER_C_DIR = 'tier-c';
const MANIFEST_FILE = 'manifest.json';

let _root = null;            // FileSystemDirectoryHandle for /arnold
let _tierCDir = null;         // FileSystemDirectoryHandle for /arnold/tier-c
let _available = null;        // null = untested, true/false once probed
let _manifest = null;         // cached manifest object
let _writeQueue = Promise.resolve();

function sanitize(fullKey) {
  // OPFS doesn't allow "/" in names; our keys are ASCII so a simple swap works.
  return fullKey.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureRoot() {
  if (_root) return _root;
  if (!(navigator?.storage?.getDirectory)) {
    _available = false;
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    _root = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    _tierCDir = await _root.getDirectoryHandle(TIER_C_DIR, { create: true });
    _available = true;
    return _root;
  } catch (e) {
    console.warn('[opfs] unavailable:', e?.message || e);
    _available = false;
    return null;
  }
}

export async function isAvailable() {
  if (_available != null) return _available;
  await ensureRoot();
  return !!_available;
}

async function readFileText(dir, name) {
  try {
    const h = await dir.getFileHandle(name);
    const f = await h.getFile();
    return await f.text();
  } catch {
    return null;
  }
}

async function writeFileText(dir, name, text) {
  const h = await dir.getFileHandle(name, { create: true });
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
}

async function deleteFile(dir, name) {
  try { await dir.removeEntry(name); } catch {}
}

async function loadManifest() {
  if (_manifest) return _manifest;
  const root = await ensureRoot();
  if (!root) return {};
  const text = await readFileText(root, MANIFEST_FILE);
  _manifest = text ? safeParse(text) : {};
  return _manifest;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

async function persistManifest() {
  const root = await ensureRoot();
  if (!root) return;
  await writeFileText(root, MANIFEST_FILE, JSON.stringify(_manifest || {}));
}

async function sha256Hex(text) {
  try {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

// Write a Tier C value to OPFS. Returns a promise; failures are logged and
// swallowed so OPFS problems never block the primary localStorage write.
export function opfsWrite(fullKey, value) {
  _writeQueue = _writeQueue.then(async () => {
    const root = await ensureRoot();
    if (!root) return;
    try {
      const text = JSON.stringify(value);
      const name = sanitize(fullKey) + '.json';
      await writeFileText(_tierCDir, name, text);
      const manifest = await loadManifest();
      manifest[fullKey] = {
        bytes: text.length,
        writtenAt: Date.now(),
        sha256: await sha256Hex(text),
      };
      _manifest = manifest;
      await persistManifest();
    } catch (e) {
      console.warn('[opfs] write failed for', fullKey, e?.message || e);
    }
  });
  return _writeQueue;
}

// Read a single Tier C value from OPFS (returns null if missing).
export async function opfsRead(fullKey) {
  const root = await ensureRoot();
  if (!root) return null;
  try {
    const text = await readFileText(_tierCDir, sanitize(fullKey) + '.json');
    return text ? safeParse(text) : null;
  } catch { return null; }
}

// Read every Tier C value currently in OPFS. Returns { [fullKey]: value }.
// Used by startup-heal when localStorage/IDB come up empty.
export async function opfsReadAll() {
  const root = await ensureRoot();
  if (!root) return {};
  const out = {};
  try {
    const manifest = await loadManifest();
    for (const fullKey of Object.keys(manifest)) {
      const v = await opfsRead(fullKey);
      if (v != null) out[fullKey] = v;
    }
  } catch (e) {
    console.warn('[opfs] readAll failed:', e?.message || e);
  }
  return out;
}

// Delete a single Tier C key from OPFS (used by tier-aware clear).
export async function opfsDelete(fullKey) {
  const root = await ensureRoot();
  if (!root) return;
  try {
    await deleteFile(_tierCDir, sanitize(fullKey) + '.json');
    const manifest = await loadManifest();
    delete manifest[fullKey];
    _manifest = manifest;
    await persistManifest();
  } catch (e) {
    console.warn('[opfs] delete failed for', fullKey, e?.message || e);
  }
}

// Wipe ALL Tier C OPFS data. Only called by the explicit factory-reset flow.
export async function opfsWipe() {
  const root = await ensureRoot();
  if (!root) return;
  try {
    for await (const [name] of _tierCDir.entries()) {
      await deleteFile(_tierCDir, name);
    }
    _manifest = {};
    await persistManifest();
  } catch (e) {
    console.warn('[opfs] wipe failed:', e?.message || e);
  }
}

// Diagnostics: return the manifest so the Backup Status panel can show what's
// protected in OPFS without reading every file.
export async function opfsInventory() {
  const root = await ensureRoot();
  if (!root) return { available: false, items: {} };
  const manifest = await loadManifest();
  return { available: true, items: manifest };
}
