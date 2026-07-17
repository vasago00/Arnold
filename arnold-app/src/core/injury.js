// Injury awareness (Sprint 3, Emil 2026-07). An active injury is SELECTIVE — it
// aggravates some running stresses but not others. The plan should protect the
// sessions it aggravates and KEEP the ones it tolerates (focus the running on
// what you can do). E.g. a knee tolerates easy aerobic running but not tempo.
//
// Scope: RUNNING sessions only. Strength exercise selection is the user's
// trainer's domain — Arnold does not adapt strength here.
//
// Pure. No storage/window import.

// Each "aggravator" maps to the run session types that carry that stress.
export const AGGRAVATORS = {
  intensity: new Set(['tempo', 'threshold', 'intervals', 'hiit']),  // speed / lactate work
  impact:    new Set(['intervals', 'hiit']),                        // hard pounding / plyometric load
  volume:    new Set(['long_run']),                                 // prolonged / cumulative
};

// A small, editable library of common runner niggles → what they aggravate.
export const INJURY_LIBRARY = {
  // Lower body — restrict specific running stresses.
  knee:     { label: 'Knee',      aggravates: ['intensity'],          note: 'Easy aerobic running is fine — speed/tempo is what aggravates it, so the hard days get protected.' },
  achilles: { label: 'Achilles',  aggravates: ['intensity'],          note: 'Avoid speed; easy flat running is usually tolerated.' },
  calf:     { label: 'Calf',      aggravates: ['intensity', 'impact'],note: 'Speed and hard pounding aggravate it; keep it easy.' },
  shin:     { label: 'Shin',      aggravates: ['impact', 'volume'],   note: 'Cut the pounding and long-run volume; cross-train the aerobic work.' },
  itb:      { label: 'IT band',   aggravates: ['volume'],             note: 'Long runs aggravate it; keep runs shorter for now.' },
  hip:      { label: 'Hip',       aggravates: ['intensity'],          note: 'Speed aggravates it; easy running is usually fine.' },
  foot:     { label: 'Foot',      aggravates: ['impact', 'intensity'],note: 'Offload the pounding — pool/bike the harder sessions.' },
  back:     { label: 'Lower back',aggravates: ['volume', 'impact'],   note: 'Long runs and pounding aggravate it; keep runs shorter and softer.' },
  // Upper body — don't restrict running; recorded so your trainer adapts strength.
  shoulder: { label: 'Shoulder',  aggravates: [],                     note: "Doesn't limit running — your trainer adapts the strength work." },
  neck:     { label: 'Neck',      aggravates: [],                     note: "Doesn't limit running; keep the upper body relaxed on runs." },
  arm:      { label: 'Arm / wrist',aggravates: [],                    note: "Doesn't limit running — flagged so strength work is adjusted." },
};

export function injuryLabel(area) {
  return INJURY_LIBRARY[area]?.label || null;
}

/** Does this session type aggravate the given injury area? */
export function sessionAggravatesInjury(sessionType, area) {
  const inj = INJURY_LIBRARY[area];
  if (!inj || !sessionType) return false;
  return inj.aggravates.some(a => AGGRAVATORS[a]?.has(sessionType));
}

/** A per-session note: protecting vs tolerated. */
export function injuryNote(area, sessionType) {
  const inj = INJURY_LIBRARY[area];
  if (!inj) return null;
  return sessionAggravatesInjury(sessionType, area)
    ? `Protecting your ${inj.label.toLowerCase()} — this session aggravates it.`
    : `Your ${inj.label.toLowerCase()} tolerates this — run it as planned.`;
}

export default INJURY_LIBRARY;
