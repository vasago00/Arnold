// core/perf.js — a featherweight response-time probe for the app. Zero deps, no-op-safe, tiny.
//
// WHY: the mobile app has to feel instant — a laggy screen transition loses people. This gives us a way
// to actually MEASURE where a frame's time goes instead of guessing. Wrap any hot path in `timed(label, fn)`
// and the duration lands in a ring buffer; anything over one 60fps frame (16ms) is flagged to the console
// as it happens. On the device's remote console, type `__arnoldPerf()` for a sorted table (count / avg /
// p95 / max per label), or `__arnoldPerf('coach')` to filter by a label prefix.
//
// It measures SYNCHRONOUS main-thread cost (the stuff that blocks a transition). GPU/model work is async
// and off the main thread; for that, watch whether a label's time is small yet the screen still feels slow
// (→ the cost is GPU/compositor/model, not JS) — see coachModel + the deferred phrasing in CoachComment.

const RING = [];               // recent { label, ms, at } — capped so it never grows unbounded
const CAP = 240;
const FRAME_MS = 16;           // one 60fps frame; a synchronous path over this risks a dropped frame

const now = () => { try { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); } catch { return Date.now(); } };

function record(label, ms) {
  try {
    RING.push({ label, ms: Math.round(ms * 100) / 100, at: Date.now() });
    if (RING.length > CAP) RING.shift();
    if (ms > FRAME_MS && typeof console !== 'undefined' && console.debug) console.debug(`[perf] ${label} ${ms.toFixed(1)}ms`);
  } catch { /* never let instrumentation throw into the caller */ }
}

// timed(label, fn) — runs fn, records how long it took, returns fn's value unchanged (transparent wrapper).
export function timed(label, fn) {
  const t0 = now();
  try { return fn(); }
  finally { record(label, now() - t0); }
}

// timedAsync(label, fn) — same, for an async fn (awaits it; records total wall time).
export async function timedAsync(label, fn) {
  const t0 = now();
  try { return await fn(); }
  finally { record(label, now() - t0); }
}

// mark(label, ms) — record a duration measured elsewhere (e.g. a transition timed by the caller).
export function mark(label, ms) { if (Number.isFinite(ms)) record(label, ms); }

// Run work when the main thread is idle so it never competes with an animation/transition. Falls back to a
// short timeout where requestIdleCallback is absent. Returns nothing cancelable — guard the callback itself.
export function onIdle(fn, timeout = 1500) {
  try {
    if (typeof requestIdleCallback === 'function') { requestIdleCallback(() => { try { fn(); } catch { /* ignore */ } }, { timeout }); return; }
  } catch { /* fall through */ }
  try { setTimeout(() => { try { fn(); } catch { /* ignore */ } }, 1); } catch { /* ignore */ }
}

// perfReport(prefix?) — per-label { count, avgMs, p95Ms, maxMs }, sorted slowest-first. Prints a table when
// a console is present (so `__arnoldPerf()` on the device just works), and returns the rows too.
export function perfReport(prefix) {
  const rows = {};
  for (const e of RING) {
    if (prefix && e.label.indexOf(prefix) !== 0) continue;
    const r = rows[e.label] || (rows[e.label] = { label: e.label, samples: [] });
    r.samples.push(e.ms);
  }
  const out = Object.values(rows).map((r) => {
    const s = r.samples.slice().sort((a, b) => a - b);
    const sum = s.reduce((a, b) => a + b, 0);
    const p95 = s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : 0;
    return { label: r.label, count: s.length, avgMs: Math.round((sum / s.length) * 100) / 100, p95Ms: p95, maxMs: s[s.length - 1] || 0 };
  }).sort((a, b) => b.maxMs - a.maxMs);
  try { if (typeof console !== 'undefined' && console.table) console.table(out); } catch { /* ignore */ }
  return out;
}

export function perfClear() { RING.length = 0; }

// Console handles so you can drive this from the device's remote inspector with no imports.
try {
  if (typeof window !== 'undefined') {
    window.__arnoldPerf = perfReport;
    window.__arnoldPerfRing = () => RING.slice();
    window.__arnoldPerfClear = perfClear;
  }
} catch { /* ignore */ }

export default { timed, timedAsync, mark, onIdle, perfReport, perfClear };
