// ─── safeCompute — try/catch with built-in diagnostic ──────────────────────
//
// Phase 4r.hygiene.1 (2026-05-24)
//
// The silent-catch pattern (`try { … } catch { return null }`) is the most
// common bug-hider in the codebase. The intelHeadline shape-mismatch bug
// (POSTMORTEMS.md 2026-05-24) was undetectable from the running app
// because the catch swallowed the error and the conditional render hid
// the null result. A console warn would have surfaced it within seconds.
//
// This helper wraps the pattern with a forced diagnostic so silent
// failures look loud in DevTools. Use it ANYWHERE you'd write
// `try { fn() } catch { return null }`.
//
// Usage:
//   const eff = safeCompute('intelHeadline:getEffectiveTargets',
//                           () => getEffectiveTargets({ date: today }));
//   if (!eff) return null;
//
// The label is what shows up in DevTools as `[intelHeadline:...] failed: …`.
// Pick something specific enough that you'd recognise the call site at a
// glance — `surface:operation` format works well.
//
// `fallback` defaults to null so callers don't need to think about it for
// the common "return null on failure" case. Pass a different default if
// the consumer expects a specific shape (e.g. `[]` for array-returning
// helpers).

export function safeCompute(label, fn, fallback = null) {
  try {
    return fn();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[${label}] failed:`, e?.message || e);
    return fallback;
  }
}

// Convenience variant for the array-returning case (synthesizer, insights,
// generators) — saves callers from passing `[]` explicitly every time.
export function safeComputeArray(label, fn) {
  return safeCompute(label, fn, []);
}
