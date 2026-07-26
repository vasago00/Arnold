// Pure calorie-target composition — extracted from goalModel.deriveDailyCalorieTarget
// so the SAME formula the app uses can be exercised directly by unit tests and the
// Monte-Carlo simulation harness (no mirrored copy that can drift out of sync).
//
// The rule (bug fixed 2026-07-01): floor the MAINTENANCE part (TDEE − deficit +
// recovery adjustment) at RMR — never eat below resting — and THEN stack the
// training eat-back + race bonus on top, so a training day always replenishes
// ABOVE the floor rather than having the eat-back swallowed by it.
//
// Pure: no storage, no DOM. Inputs are already-resolved kcal numbers.

/**
 * composeCalorieTarget — combine the resolved pieces into the day's target.
 *
 * @param {object} p
 * @param {number} p.baseTarget   maintenance basis (tdeeBase − dailyDeficit), kcal
 * @param {number} [p.recoveryAdj=0] chronic-recovery-debt add-back, kcal
 * @param {number} [p.eatBack=0]   training replenishment (corrected burn × fraction), kcal
 * @param {number} [p.flatBonus=0] race-proximity flat bonus (carb load), kcal
 * @param {number} p.rmr           resting metabolic rate, kcal (floor basis)
 * @param {number} [p.debt=0]      chronic recovery-debt level (0..3); ≥2 lifts the floor +100
 * @returns {{ derived:number, effectiveFloor:number, floored:boolean }}
 */
export function composeCalorieTarget({ baseTarget, recoveryAdj = 0, eatBack = 0, flatBonus = 0, rmr, debt = 0 }) {
  const rmrN = Number(rmr) || 1500;
  const effectiveFloor = rmrN + (debt >= 2 ? 100 : 0);
  const maintenance = (Number(baseTarget) || 0) + (Number(recoveryAdj) || 0);
  const floored = maintenance < effectiveFloor;
  const raw = Math.round(Math.max(maintenance, effectiveFloor) + (Number(eatBack) || 0) + (Number(flatBonus) || 0));
  // Upper safety guard (relative, per-athlete): never recommend more than ~2.5× RMR.
  // A legitimate big-but-real day (a long ride's eat-back) fits comfortably under this;
  // the cap exists to stop a GLITCHED/mis-recorded long activity — e.g. a phantom
  // 10-hour session — from stacking eat-back into a runaway 8,000–10,000 kcal target.
  // Surfaced by the multi-sport Monte-Carlo (a 6h+ effort broke the 6,000 ceiling with
  // no guard). Never drops below the floor. `capped` is exposed so the UI can flag it.
  const ceiling = Math.round(2.5 * rmrN);
  const capped = raw > ceiling;
  const derived = capped ? Math.max(effectiveFloor, ceiling) : raw;
  return { derived, effectiveFloor, floored, ceiling, capped };
}

/**
 * describeEatBack — the ONE explanation of how "burned" becomes "earned", so the
 * Daily burn tile (e.g. 715 kcal) and the Nutrition "+earned" chip (e.g. +401)
 * tell one coherent story instead of looking like two disagreeing numbers.
 *
 * The chain (all fields already live in goalModel's explain.components):
 *   reportedBurn ──×burnFactor──▶ correctedBurn ──×racePrepFraction──▶ eatBack
 * i.e. the gross tracker burn is (1) corrected for tracker inflation vs your
 * empirical TDEE, then (2) partially eaten back to preserve the race deficit.
 *
 * @param {object} components  goalModel dailyCalories.explain.components
 * @returns {{ earned:number, burned:number, corrected:number, pct:number|null,
 *             burnFactor:number|null, fraction:number|null, window:string|null,
 *             text:string|null }}   pct = earned/burned; text = one-line tooltip.
 */
export function describeEatBack(components = {}) {
  const earned    = Math.round(Number(components.eatBack)      || 0);
  const burned    = Math.round(Number(components.reportedBurn) || 0);
  const corrected = Math.round(Number(components.correctedBurn) || 0);
  const burnFactor = components.burnFactor != null ? Number(components.burnFactor) : null;
  const fraction   = components.racePrepFraction != null ? Number(components.racePrepFraction) : null;
  const window     = components.racePrepWindow || null;
  const pct = burned > 0 ? Math.round((earned / burned) * 100) : null;

  let text = null;
  if (earned > 0 && burned > 0) {
    const parts = [`${earned} kcal added to today's target — ${pct}% of the ${burned} kcal you burned.`];
    const corrected_ = burnFactor != null && burnFactor < 1 && corrected > 0;
    if (corrected_) parts.push(`Burn corrected ×${burnFactor} for tracker inflation (→ ${corrected}),`);
    if (fraction != null) {
      parts.push(`${corrected_ ? 'then' : 'Burn'} ×${fraction} eaten back${window ? ` (${window} window)` : ''} to protect your race-day deficit.`);
    }
    parts.push(`You don't eat back 100% of exercise calories.`);
    text = parts.join(' ');
  }
  return { earned, burned, corrected, pct, burnFactor, fraction, window, text };
}

export default composeCalorieTarget;
