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
  const effectiveFloor = (Number(rmr) || 1500) + (debt >= 2 ? 100 : 0);
  const maintenance = (Number(baseTarget) || 0) + (Number(recoveryAdj) || 0);
  const floored = maintenance < effectiveFloor;
  const derived = Math.round(Math.max(maintenance, effectiveFloor) + (Number(eatBack) || 0) + (Number(flatBonus) || 0));
  return { derived, effectiveFloor, floored };
}

export default composeCalorieTarget;
