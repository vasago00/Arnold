// ─── ARNOLD Derived Metrics ──────────────────────────────────────────────────
// Single source of truth for every formula computed from raw data.
// Pure functions only — no DOM, no storage, no side effects. This makes them
// trivially testable and prevents the "same formula in three places drift"
// that bit us repeatedly during development.
//
// Convention: every function takes a flat options object and returns a flat
// result object (or a primitive). Null inputs are tolerated and produce null
// outputs, never throws.

export * from './time.js';
export * from './pace.js';
export * from './hr.js';
export * from './hydration.js';
export * from './volume.js';
