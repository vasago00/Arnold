// core/record/systemOfRecord.js — Arnold's durable SYSTEM OF RECORD (SoR).
//
// WHY. Today all of Arnold's data lives in one place — the device's encrypted IndexedDB — with a peer-sync
// relay of padded ciphertext. Nothing is inspectable, auditable, or recoverable if the device/key is lost, and
// nothing outside the app (the model's own validation, or a human) can read it. That opacity is how a corrupt
// record silently collapsed every prediction while the tests stayed green. The SoR fixes the class of problem:
// it turns the ephemeral store into a DURABLE, INSPECTABLE MEMORY — an append-only event log (one immutable
// line per data point) plus daily full-state snapshots — written to disk (git-versioned) and mirrored to Drive.
// Current app state becomes a PROJECTION of the log; recovery is a replay; validation reads the same files.
//
// PURE + node-testable. Reads are injected (`readKey`), time is injected (`at`) — no storage/DOM/Date here. The
// platform write sinks (Filesystem, Drive) are separate and call into this to get bytes.

// The data worth remembering — the daily-generated streams + the reference records. Deliberately EXCLUDES
// caches, auth blobs, and ephemeral UI prefs (aiCache, *Auth, *Live, *Meta, startTilePrefs): memory, not noise.
export const RECORD_CATEGORIES = [
  'activities', 'hrv', 'sleep', 'weight', 'wellness', 'hcDailyEnergy',   // sensor / daily streams
  'nutritionLog', 'cronometer', 'supplementsLog',                        // fuel
  'workouts', 'sessionRPE', 'addedLoad', 'dailyLogs',                    // training / logs
  'races', 'careerRaces', 'goals', 'planner', 'profile', 'labSnapshots', 'clinicalTests', // reference + career résumé
  'planChanges',                                                          // intentional plan changes (swap/move/skip)
];

const has = (v) => v != null;
const isArr = Array.isArray;

// Stable identity per category → so the log records CHANGES (upsert/delete of a row), not a re-dump of the whole
// array every time. Falls back to a content key when no explicit id exists. Dates are the natural key for the
// per-day streams (one wellness/weight row per day).
const KEY_FNS = {
  activities: (a) => a.id ?? a.activityId ?? a.garminId ?? `${a.date ?? ''}|${a.distanceMi ?? a.distanceKm ?? ''}|${a.durationSecs ?? ''}`,
  nutritionLog: (r) => r.id ?? `${r.date ?? ''}|${r.name ?? ''}|${r.mealType ?? r.meal ?? ''}|${r.servings ?? ''}`,
  supplementsLog: (r) => r.id ?? `${r.date ?? ''}|${r.name ?? ''}`,
  workouts: (r) => r.id ?? `${r.date ?? ''}|${r.name ?? ''}`,
  sessionRPE: (r) => r.id ?? `${r.date ?? ''}|${r.session ?? ''}`,
  addedLoad: (r) => r.id ?? `${r.date ?? ''}|${r.session ?? ''}`,
  races: (r) => r.id ?? `${r.date ?? ''}|${r.name ?? ''}`,
  labSnapshots: (r) => r.id ?? r.date ?? r.at ?? contentKey(r),
  clinicalTests: (r) => r.id ?? `${r.type ?? ''}|${r.date ?? ''}`,
  planChanges: (r) => r.at ?? `${r.date ?? ''}|${r.kind ?? ''}|${r.fromType ?? ''}`,
  // date-keyed daily streams
  hrv: (r) => r.date, sleep: (r) => r.date, weight: (r) => r.date, wellness: (r) => r.date, hcDailyEnergy: (r) => r.date,
  dailyLogs: (r) => r.date,
};
function contentKey(r) { try { return JSON.stringify(r); } catch { return String(r); } }
function keyOf(cat, row) {
  const f = KEY_FNS[cat];
  const k = f ? f(row) : (row && (row.id ?? row.date)) ?? contentKey(row);
  return k == null || k === '' ? contentKey(row) : String(k);
}

// Index an array-or-object category value by stable id. Object-valued categories (profile, goals, planner) are
// singletons → keyed as the whole document under the category name.
function indexById(cat, value) {
  const m = new Map();
  if (!has(value)) return m;
  if (isArr(value)) { for (const row of value) if (has(row)) m.set(keyOf(cat, row), row); }
  else m.set('@doc', value);   // singleton document
  return m;
}

// Deterministic stringify (sorted keys) so hashing + equality are stable regardless of key order.
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (isArr(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',')}}`;
}
const eq = (a, b) => stableStringify(a) === stableStringify(b);

// FNV-1a 32-bit — a small, dependency-free integrity hash so the manifest can detect silent corruption/drift.
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * projectSnapshot(readKey, { at }) → { schema, at, categories, counts }.
 * The full current-state snapshot: the projection of the live store into one durable, inspectable document.
 * `readKey(category)` returns the stored value (array/object/undefined). `at` is an injected ISO timestamp.
 */
export function projectSnapshot(readKey, opts = {}) {
  const categories = {};
  const counts = {};
  for (const c of RECORD_CATEGORIES) {
    const v = readKey(c);
    if (!has(v)) continue;
    categories[c] = v;
    counts[c] = isArr(v) ? v.length : 1;
  }
  return { schema: 1, at: opts.at ?? null, categories, counts };
}

/**
 * diffToEvents(prevSnapshot, nextSnapshot, at) → [{ at, cat, op:'upsert'|'delete', id, data? }].
 * The immutable append-log lines: what CHANGED between two snapshots, per row, by stable id. A first run
 * (prev = null) emits an upsert for every row — the initial memory. Deletes carry no data.
 */
export function diffToEvents(prevSnapshot, nextSnapshot, at = null) {
  const events = [];
  const prevCats = prevSnapshot?.categories || {};
  const nextCats = nextSnapshot?.categories || {};
  for (const c of RECORD_CATEGORIES) {
    const prev = indexById(c, prevCats[c]);
    const next = indexById(c, nextCats[c]);
    for (const [id, row] of next) {
      const before = prev.get(id);
      if (before === undefined || !eq(before, row)) events.push({ at, cat: c, op: 'upsert', id, data: row });
    }
    for (const id of prev.keys()) if (!next.has(id)) events.push({ at, cat: c, op: 'delete', id });
  }
  return events;
}

// Serialize events to append-only JSONL (one event per line, newline-terminated so appends concatenate cleanly).
export function eventsToJsonl(events) {
  if (!events || !events.length) return '';
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// Replay a stream of events back into per-category state — the RECOVERY path (log ⇒ current state). Proves the
// log is sufficient on its own: snapshot(replay(events)) must equal the snapshot the events were derived from.
export function replayEvents(events) {
  const cats = {};
  for (const e of events || []) {
    if (!RECORD_CATEGORIES.includes(e.cat)) continue;
    (cats[e.cat] ||= new Map());
    if (e.op === 'delete') cats[e.cat].delete(e.id);
    else cats[e.cat].set(e.id, e.data);
  }
  const out = {};
  for (const c of Object.keys(cats)) {
    const m = cats[c];
    out[c] = m.has('@doc') && m.size === 1 ? m.get('@doc') : Array.from(m.values());
  }
  return out;
}

/**
 * buildManifest(snapshot) → integrity + provenance record for the snapshot: per-category counts + hashes and a
 * top-level hash, so drift/corruption is detectable and two devices can compare records cheaply.
 */
export function buildManifest(snapshot) {
  const perCat = {};
  for (const c of RECORD_CATEGORIES) {
    const v = snapshot?.categories?.[c];
    if (!has(v)) continue;
    perCat[c] = { count: isArr(v) ? v.length : 1, hash: hash32(stableStringify(v)) };
  }
  return { schema: snapshot?.schema ?? 1, at: snapshot?.at ?? null, categories: perCat, hash: hash32(stableStringify(perCat)) };
}

export default { RECORD_CATEGORIES, projectSnapshot, diffToEvents, eventsToJsonl, replayEvents, buildManifest, stableStringify, hash32 };
