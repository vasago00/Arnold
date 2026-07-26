// core/coaching/periodization.js — established marathon periodization CONSTANTS (the
// validated frame). Runtime phase logic lives in core/seasonPlan.js; this is the single
// cited reference for the numbers, so the "dial settings" are documented and tunable in one
// place. The personalization layer (ACWR, recovery velocity, illness) modulates these.
//
// Sources: Daniels' Running Formula (phases, quality density, long-run share); Pfitzinger
// "Advanced Marathoning" (mileage progression, long-run caps); Gabbett (ACWR guardrail).

// Macro-cycle phases toward a goal marathon (worked back from race day in P2).
export const PHASES = ['base', 'build', 'peak', 'taper'];

// Long run as a share of weekly volume, with an absolute cap. Daniels: ≤ 25–30% of the week
// (or 2.5 h), Pfitzinger caps the long run ~ 20–22 mi. Runtime should take the MIN.
export const LONG_RUN = {
  weekShareMax: 0.33,   // ≤ ~1/3 of weekly miles
  absCapMi: 22,         // never prescribe beyond ~22 mi in a build
  floorMi: 8,           // a "long run" isn't a long run below this
  stepMi: 1.5,          // progress ~1–1.5 mi/week
};

// Weekly volume progression + injury guardrail.
export const VOLUME = {
  rampPctPerWeek: 0.10,   // ≤10%/week (established injury-safe progression)
  cutbackEvery: 4,        // a down/recovery week roughly every 4th week
  cutbackPct: 0.80,       // ~20% pull-back on a cutback week
};

// Quality-day density (hard sessions/week) by phase — the rest is easy aerobic.
export const QUALITY_DAYS = { base: 1, build: 2, peak: 2, taper: 1 };

// Taper depth into a goal marathon (fraction of peak weekly volume), by weeks-to-race.
// ~2-week taper: -20% then -40% is a common, evidence-supported shape.
export const TAPER = { weeks: 2, byWeeksOut: { 2: 0.80, 1: 0.55, 0: 0.35 } };

// ACWR guardrail zones (Gabbett) — acute:chronic training-load ratio.
export const ACWR = { hot: 1.3, danger: 1.5, cold: 0.8 };
