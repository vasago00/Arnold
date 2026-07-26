// core/record/recordSink.js — SoR write SINK (Phase 2). Executes a write plan (from recordWriter) against a
// pluggable file BACKEND. The plan→backend orchestration is backend-agnostic, so it's fully testable against an
// in-memory mock (recordSink.test.js drives the real pipeline: store → plan → sink → read back → replay). Only
// the thin platform adapters below touch actual device APIs (untestable in node — verified in-app on rebuild).
//
// Backend contract: { write(path, content): Promise, append(path, content): Promise }. Paths are POSIX-style,
// relative to the record root; the sink prefixes the root and the backend creates intermediate dirs.

/**
 * executePlan(plan, backend, { root }) → [{ path, ok, error? }]. Runs each op in order; one op failing doesn't
 * abort the rest (best-effort durability), and every result is reported so the service can surface failures.
 */
export async function executePlan(plan, backend, opts = {}) {
  const root = opts.root || 'data';
  const results = [];
  for (const op of (plan || [])) {
    const path = `${root}/${op.path}`;
    try {
      if (op.mode === 'append') await backend.append(path, op.content);
      else await backend.write(path, op.content);
      results.push({ path: op.path, ok: true });
    } catch (e) {
      results.push({ path: op.path, ok: false, error: String((e && e.message) || e) });
    }
  }
  return results;
}

// ── In-memory backend — for tests AND as a safe fallback when no disk sink is available. ──
export function memoryBackend() {
  const files = new Map();
  return {
    files,
    async write(path, content) { files.set(path, content); },
    async append(path, content) { files.set(path, (files.get(path) || '') + content); },
    read(path) { return files.get(path); },
  };
}

// ── File System Access API backend (desktop web). rootHandle = a FileSystemDirectoryHandle the user granted
// (persist it in IndexedDB so the grant survives reloads). Creates subdirectories on demand. FSA has no native
// append, so append = open keeping existing data + seek to EOF. ──
export function fsaBackend(rootHandle) {
  async function resolve(path, create) {
    const parts = path.split('/').filter(Boolean);
    const file = parts.pop();
    let dir = rootHandle;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return { dir, file };
  }
  return {
    async write(path, content) {
      const { dir, file } = await resolve(path, true);
      const fh = await dir.getFileHandle(file, { create: true });
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
    },
    async append(path, content) {
      const { dir, file } = await resolve(path, true);
      const fh = await dir.getFileHandle(file, { create: true });
      const existing = await fh.getFile();
      const w = await fh.createWritable({ keepExistingData: true });
      await w.seek(existing.size);
      await w.write(content);
      await w.close();
    },
    async read(path) {
      try { const { dir, file } = await resolve(path, false); const fh = await dir.getFileHandle(file); return await (await fh.getFile()).text(); }
      catch { return undefined; }
    },
  };
}

// ── Capacitor Filesystem backend (mobile). fs = @capacitor/filesystem's Filesystem; Directory = its enum.
// Writes under <baseDir>/… in the chosen Directory (Documents by default). appendFile falls back to writeFile
// if the file doesn't exist yet. ──
export function capacitorBackend(fs, Directory, opts = {}) {
  const baseDir = opts.baseDir || 'Arnold';
  const directory = opts.directory || Directory.Documents;
  const full = (path) => `${baseDir}/${path}`;
  async function ensureDir(path) {
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) { try { await fs.mkdir({ path: full(dir), directory, recursive: true }); } catch { /* exists */ } }
  }
  return {
    async write(path, content) { await ensureDir(path); await fs.writeFile({ path: full(path), data: content, directory, encoding: 'utf8' }); },
    async append(path, content) {
      await ensureDir(path);
      try { await fs.appendFile({ path: full(path), data: content, directory, encoding: 'utf8' }); }
      catch { await fs.writeFile({ path: full(path), data: content, directory, encoding: 'utf8' }); }
    },
    async read(path) { try { const r = await fs.readFile({ path: full(path), directory, encoding: 'utf8' }); return r && r.data; } catch { return undefined; } },
  };
}

export default executePlan;
