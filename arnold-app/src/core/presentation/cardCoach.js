// Coach-driven activity card (design: docs/ACTIVITY_CARD_DESIGN.md, Option 1).
//
// METRIC MATRIX → per-activity menu. Two things are NEVER repeated on the card:
//   • the hero rail's 3 universal metrics — Effort · Avg HR · Calories, and
//   • Load / rTSS — that number IS the speedometer in the center.
// For each discipline we declare:
//   • macro: FIXED basics (large row1 tiles) — the card renders the first 4 that
//     have data (a power bike fills power/distance/cadence/speed; a power-less
//     indoor ride falls back to duration/maxHR/zone tiles).
//   • micro: an ORDERED pool of supporting metrics (small r2_* tiles). The coach
//     reorders it by ANGLE; the card then renders the first 3–4 that have data.
// Excluding Effort/AvgHR/Calories/Load guarantees nothing repeats the hero/gauge.
//
// Pure. Tile ids match the resolvers in Arnold.jsx; absent tiles drop at render.

// Hero rail + gauge own these — excluded from every card menu below.
export const HERO_UNIVERSAL = ['effort', 'avgHR', 'calories', 'load'];

export const MENU = {
  easy_run:  { macro: ['distance', 'pace', 'z2pct', 'cadence'],
               micro: ['r2_cardiacDrift', 'r2_decoupling', 'r2_aeroTE', 'r2_verticalRatio', 'r2_groundContact', 'r2_vo2max', 'r2_respiration', 'r2_hrRecovery', 'r2_z34pct', 'r2_z1pct', 'r2_elevation'] },
  long_run:  { macro: ['distance', 'pace', 'elevation', 'cardiacDrift'],
               micro: ['r2_durability', 'r2_decoupling', 'r2_z2pct', 'r2_aeroTE', 'r2_verticalRatio', 'r2_groundContact', 'r2_vo2max', 'r2_respiration', 'r2_hrRecovery', 'r2_z1pct'] },
  tempo:     { macro: ['distance', 'pace', 'gap', 'z34pct'],
               micro: ['r2_if', 'r2_hrRecovery', 'r2_aeroTE', 'r2_verticalRatio', 'r2_vo2max', 'r2_respiration', 'r2_maxHR', 'r2_z45pct'] },
  intervals: { macro: ['distance', 'z45pct', 'maxHRHero', 'pace'],
               micro: ['r2_anaerTE', 'r2_hrRecovery', 'r2_aeroTE', 'r2_groundContact', 'r2_vo2max', 'r2_respiration', 'r2_z34pct'] },
  hiit:      { macro: ['duration', 'maxHRHero', 'z45pct', 'anaerTE'],
               micro: ['r2_hrRecovery', 'r2_aeroTE', 'r2_z34pct', 'r2_cardiacDrift'] },
  strength:  { macro: ['sets', 'reps', 'e1rmHero', 'maxHRHero', 'duration'],
               micro: ['r2_anaerTE', 'r2_aeroTE', 'r2_hrRecovery'] },
  mobility:  { macro: ['duration', 'maxHRHero', 'bodyBatt', 'z2pct'],
               micro: ['r2_aeroTE', 'r2_cardiacDrift', 'r2_z1pct'] },
  // Power bike → power/distance/cadence/speed; power-less indoor → duration/maxHR/
  // Z2/Z1. Micro mines the HR signal so an easy spin still fills 3–4 tiles.
  cycle:     { macro: ['avgPower', 'distance', 'cadenceRpm', 'avgSpeed', 'duration', 'maxHRHero', 'z2pct', 'z1pct'],
               micro: ['r2_durability', 'r2_cardiacDrift', 'r2_aeroTE', 'r2_z34pct', 'r2_z45pct', 'r2_if', 'r2_variabilityIndex', 'r2_normPower', 'r2_avgSpeed', 'r2_respiration', 'r2_decoupling', 'r2_hrRecovery'] },
  swim:      { macro: ['distance', 'pace', 'duration', 'maxHRHero'],
               micro: ['r2_z2pct', 'r2_aeroTE', 'r2_z1pct', 'r2_cardiacDrift'] },
  walk:      { macro: ['distance', 'pace', 'elevation', 'maxHRHero'],
               micro: ['r2_z2pct', 'r2_aeroTE', 'r2_z1pct', 'r2_cardiacDrift'] },
  ski:       { macro: ['distance', 'duration', 'elevation', 'maxHRHero'],
               micro: ['r2_z2pct', 'r2_aeroTE', 'r2_z1pct', 'r2_cardiacDrift'] },
  generic:   { macro: ['duration', 'maxHRHero', 'z2pct', 'z1pct'],
               micro: ['r2_aeroTE', 'r2_cardiacDrift', 'r2_z34pct', 'r2_hrRecovery'] },
};

// Angle → global micro priority (intersected with the discipline pool, then the
// rest of the pool fills behind it). No Load (gauge) / Effort / AvgHR / Calories.
const ANGLE_MICRO = {
  aerobic_quality: ['r2_z2pct', 'r2_z1pct', 'r2_cardiacDrift', 'r2_decoupling', 'r2_aeroTE'],
  durability:      ['r2_durability', 'r2_cardiacDrift', 'r2_decoupling', 'r2_elevation', 'r2_aeroTE'],
  threshold:       ['r2_z34pct', 'r2_if', 'r2_hrRecovery', 'r2_aeroTE'],
  intensity:       ['r2_z45pct', 'r2_anaerTE', 'r2_hrRecovery', 'r2_maxHR'],
  recovery:        ['r2_z1pct', 'r2_cardiacDrift', 'r2_aeroTE', 'r2_z2pct'],
  volume:          ['r2_anaerTE', 'r2_aeroTE', 'r2_hrRecovery'],
  power:           ['r2_if', 'r2_normPower', 'r2_variabilityIndex', 'r2_avgSpeed', 'r2_cardiacDrift'],
  effort:          ['r2_z1pct', 'r2_z2pct', 'r2_cardiacDrift', 'r2_aeroTE'],
  result:          ['r2_if', 'r2_avgPace', 'r2_anaerTE', 'r2_maxHR', 'r2_vo2max'],
};

// ── Angle selection — deterministic, from the session's standout signal ──
function pickAngleId(planType, m) {
  switch (planType) {
    case 'easy_run':
      if (m.drift != null && m.drift >= 5) return 'durability';
      if (m.effortPct != null && m.effortPct < 0.60) return 'recovery';
      return 'aerobic_quality';
    case 'long_run':  return (m.drift != null && m.drift >= 5) ? 'durability' : 'aerobic_quality';
    case 'tempo':     return 'threshold';
    case 'intervals': return 'intensity';
    case 'hiit':      return 'intensity';
    case 'strength':  return 'volume';
    case 'mobility':  return 'recovery';
    case 'cycle':
      if (m.hasPower) return 'power';
      return (m.effortPct != null && m.effortPct < 0.65) ? 'recovery' : 'effort';
    case 'swim':      return 'aerobic_quality';
    case 'walk':      return 'recovery';
    case 'ski':       return 'effort';
    case 'race':      return 'result';
    default:          return 'effort';
  }
}

// Full ordered micro candidate list (angle-priority first, then the rest of the
// discipline pool). The CARD renders the first 3–4 of these that have data, so a
// sparse session still fills the row from the pool instead of going bare.
function orderMicro(planType, angleId) {
  const pool = (MENU[planType] || MENU.generic).micro;
  const pri = ANGLE_MICRO[angleId] || [];
  return [
    ...pri.filter(id => pool.includes(id)),
    ...pool.filter(id => !pri.includes(id)),
  ];
}

export function coachCard(planType, m = {}) {
  const menu = MENU[planType] || MENU.generic;
  const angle = pickAngleId(planType, m);
  return { macroIds: menu.macro, microIds: orderMicro(planType, angle), angle };
}

export default coachCard;
