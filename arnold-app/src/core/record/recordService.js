// core/record/recordService.js — the SoR INTEGRATION. Wires the live store to the durable record: seed once,
// then flush (debounced) on every change, loading the prior snapshot so diffs stay incremental across sessions.
//
// Testable CORE: `flushRecord` / `loadPrevSnapshot` run against any backend (tested with the in-memory mock).
// Thin PLATFORM wiring (backend pick, folder grant, change subscription) touches device APIs and is verified
// in-app on rebuild — deliberately isolated so the judgement lives in the tested core, not the wiring.

import { buildWritePlan } from './recordWriter.js';
import { executePlan, memoryBackend, fsaBackend, capacitorBackend } from './recordSink.js';
import { projectSnapshot } from './systemOfRecord.js';

const ROOT = 'data';

/**
 * flushRecord(readKey, backend, prevSnapshot, nowIso) → { changed, snapshot, events?, wrote? }.
 * The heart of the service: compute the write plan from the current store vs the last snapshot, apply it, and
 * return the new snapshot to carry forward. No platform, no clock — both injected. This is what the tests drive.
 */
export async function flushRecord(readKey, backend, prevSnapshot, nowIso, opts = {}) {
  const { changed, snapshot, events, plan } = buildWritePlan(readKey, prevSnapshot, { at: nowIso });
  if (!changed) return { changed: false, snapshot, wrote: [] };
  const wrote = await executePlan(plan, backend, { root: opts.root || ROOT });
  return { changed: true, snapshot, events, wrote };
}

// Load the previously-written full state so cross-session diffs are incremental (not a re-dump every launch).
export async function loadPrevSnapshot(backend, opts = {}) {
  try { const raw = await backend.read(`${opts.root || ROOT}/latest.json`); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

// ── Platform backend selection (impure; verified in-app) ──
export async function pickBackend(env = {}) {
  const cap = env.capacitor || (typeof window !== 'undefined' && window.Capacitor);
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    return { kind: 'capacitor', backend: capacitorBackend(Filesystem, Directory) };
  }
  const handle = env.dirHandle || (await loadDirHandle());
  if (handle) return { kind: 'fsa', backend: fsaBackend(handle) };
  return { kind: 'memory', backend: memoryBackend() };   // no durable sink yet → in-memory (until the folder is granted)
}

// FSA directory-handle persistence (survives reloads) via a tiny IndexedDB store.
const HANDLE_DB = 'arnold-record', HANDLE_STORE = 'handles', HANDLE_KEY = 'root';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(HANDLE_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(HANDLE_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function loadDirHandle() {
  try {
    const db = await idb();
    return await new Promise((res) => { const t = db.transaction(HANDLE_STORE).objectStore(HANDLE_STORE).get(HANDLE_KEY); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); });
  } catch { return null; }
}
async function saveDirHandle(handle) {
  try {
    const db = await idb();
    await new Promise((res) => { const t = db.transaction(HANDLE_STORE, 'readwrite'); t.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY); t.oncomplete = () => res(); t.onerror = () => res(); });
  } catch { /* ignore */ }
}

/** One-time folder grant (desktop). Prompts for a directory, verifies write permission, persists the handle. */
export async function grantFolder() {
  if (typeof window === 'undefined' || !window.showDirectoryPicker) throw new Error('folder grant not supported in this environment');
  const handle = await window.showDirectoryPicker({ id: 'arnold-data', mode: 'readwrite' });
  const perm = handle.requestPermission ? await handle.requestPermission({ mode: 'readwrite' }) : 'granted';
  if (perm !== 'granted') throw new Error('write permission denied');
  await saveDirHandle(handle);
  return handle;
}

/**
 * startRecordService({ storage?, backend?, now?, debounceMs?, env? }) → { kind, stop, flushNow, backend }.
 * Seeds the record, then flushes on every storage change (debounced). Injectable for tests; defaults to the app
 * storage + wall clock + a platform backend.
 */
export async function startRecordService(deps = {}) {
  const storage = deps.storage || (await import('../storage.js')).storage;
  const now = deps.now || (() => new Date().toISOString());
  const readKey = (cat) => { try { return storage.get(cat); } catch { return undefined; } };
  const picked = deps.backend ? { backend: deps.backend, kind: 'injected' } : await pickBackend(deps.env);
  const { backend, kind } = picked;

  let prev = await loadPrevSnapshot(backend);
  const seed = await flushRecord(readKey, backend, prev, now());   // seed / catch-up on launch
  prev = seed.snapshot;

  let timer = null;
  const flush = async () => { timer = null; try { const r = await flushRecord(readKey, backend, prev, now()); if (r.changed) prev = r.snapshot; } catch { /* next change retries */ } };
  const onChange = () => { if (timer) return; timer = setTimeout(flush, deps.debounceMs ?? 10000); };
  const unsub = (storage.onStorageChange ? storage.onStorageChange(onChange) : () => {});

  return { kind, backend, flushNow: flush, stop: () => { if (timer) clearTimeout(timer); if (typeof unsub === 'function') unsub(); } };
}

/**
 * exportSnapshotDownload(readKey, { at }) — the NO-GRANT fallback: project the full current state and trigger a
 * plain browser download (arnold-record-YYYY-MM-DD.json). No folder permission needed — you can hand this file
 * to Claude immediately so the real, live data reaches the model. Browser-only.
 */
export function exportSnapshotDownload(readKey, opts = {}) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return 'not a browser';
  const at = opts.at || new Date().toISOString();
  const snap = projectSnapshot(readKey, { at });
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `arnold-record-${at.slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `downloading arnold-record-${at.slice(0, 10)}.json — ${Object.keys(snap.counts || {}).length} categories`;
}

/**
 * installRecordConsole({ storage? }) — exposes window.__arnoldRecord so the durable memory is usable NOW without
 * any UI: `.grant()` picks the Arnold/data folder (one user click) and starts writing; `.exportNow()` downloads a
 * snapshot; `.status()` reports the sink; `.flushNow()` forces a write. If a folder was granted before, it
 * resumes automatically. This is the concrete "where do I click" answer until the button UI lands.
 */
export async function installRecordConsole(deps = {}) {
  if (typeof window === 'undefined') return;
  const storage = deps.storage || (await import('../storage.js')).storage;
  const readKey = (cat) => { try { return storage.get(cat); } catch { return undefined; } };
  let svc = null;
  window.__arnoldRecord = {
    grant: async () => {
      const handle = await grantFolder();
      if (svc) svc.stop();
      svc = await startRecordService({ storage, env: { dirHandle: handle } });
      await svc.flushNow();
      console.log('%c[record] folder granted → your full store is now written to <folder>/data/latest.json', 'color:#5eead4;font-weight:700');
      return 'granted — the durable record is now writing to your folder /data';
    },
    exportNow: () => exportSnapshotDownload(readKey),
    flushNow: async () => (svc ? svc.flushNow().then(() => 'flushed') : 'no folder granted yet — run .grant() first'),
    status: async () => ({ active: !!svc, sink: svc ? svc.kind : 'none' }),
  };
  // Resume a prior grant automatically (best-effort — browsers may require a fresh click to re-permit writes).
  try {
    const h = await loadDirHandle();
    if (h) { svc = await startRecordService({ storage, env: { dirHandle: h } }); await svc.flushNow(); console.log('%c[record] resumed — writing your Arnold/data record', 'color:#5eead4'); }
    else console.log('%c[record] ready — run window.__arnoldRecord.grant() to pick your Arnold/data folder (or .exportNow() to download a snapshot now)', 'color:#5eead4;font-weight:700');
  } catch { /* user can still call .grant() manually */ }
}

export default startRecordService;
