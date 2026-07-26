// core/hub/promotionLoop.js — the PUSH–PULL exploration controller.
//
// The default plan is built on proven ABILITY (race-VDOT). This is the loop that explores POTENTIAL: it reads
// whether you're delivering MORE than planned and whether your body ABSORBED it, then returns a verdict that
// moves the plan's forward trajectory UP (promote — the coach pushes toward your ceiling), keeps it (hold), or
// eases it (the legs pulling back). This is what turns "explore my potential" from a slogan into a closed loop:
// nothing is promoted on ambition alone — only what you demonstrably absorb becomes proven ability.
//
// First principles (all cited in ARNOLD_SCIENCE_AND_STRATEGY_2026.md / the 2026-07 research):
//   • Over-delivery is progress ONLY if absorbed — Gabbett ACWR (sweet 0.8–1.3, danger >1.5), autonomic
//     readiness (HRV/readiness holding, not falling), and improving efficiency (pace-at-HR).
//   • Exploration is bounded by the POTENTIAL CEILING (potentialGap headroom): lots of headroom → push more
//     freely; near the ceiling → sharpen, don't keep piling on volume.
//   • Safety rails always win: an active niggle or ACWR in the danger zone forces EASE regardless of ambition.
//
// Pure. The thin storage-reading wrapper (getPromotionState) is isolated at the bottom.

import { clamp } from '../stats.js';

// Tunable, documented thresholds — the acceptance knobs for "am I absorbing this?".
export const ACWR_SWEET_LO = 0.8;
export const ACWR_SWEET_HI = 1.3;
export const ACWR_DANGER = 1.5;
export const DELIVER_OVER = 1.02;    // delivering ≥102% of planned load = over-delivering
export const DELIVER_UNDER = 0.90;   // <90% = under-delivering
export const ABSORB_GOOD = 0.4;      // absorption score ≥ this = clearly handling it
export const ABSORB_BAD = -0.3;      // ≤ this = clearly not
export const HEADROOM_MIN = 2;       // VDOT of potential gap worth actively exploring
export const PROMOTE_STEP_MAX = 0.08;// most the trajectory moves up in one promotion (never a leap)
export const EASE_STEP = -0.06;

/**
 * assessAbsorption({ acwr, readinessTrend, efficiencyTrend }) → { score:-1..+1, n }.
 * Fuses the "did your body handle it?" signals. readinessTrend / efficiencyTrend are pre-normalised to
 * −1..+1 by the caller (+ = improving/holding, − = declining). ACWR is mapped here by zone.
 */
export function assessAbsorption({ acwr, readinessTrend, efficiencyTrend } = {}) {
  let sum = 0, n = 0;
  if (acwr != null) {
    const a = acwr >= ACWR_SWEET_LO && acwr <= ACWR_SWEET_HI ? 1
      : acwr < ACWR_SWEET_LO ? 0.3            // undertraining — safe, but not "absorbing hard load"
        : acwr <= ACWR_DANGER ? -0.3          // overreaching zone
          : -1;                               // danger
    sum += a; n++;
  }
  if (readinessTrend != null) { sum += clamp(readinessTrend, -1, 1); n++; }
  if (efficiencyTrend != null) { sum += clamp(efficiencyTrend, -1, 1); n++; }
  return { score: n ? +(sum / n).toFixed(2) : 0, n };
}

/**
 * promotionVerdict({ deliveryRatio, absorption, acwr, injuryActive, headroomVdot }) →
 *   { verdict:'promote'|'hold'|'ease', reason, trajectoryAdjust }.
 * trajectoryAdjust is the fractional move to apply to the plan's forward ramp / improvement assumption
 * (+ up toward potential, − easing). The plan and the race outlook both read it.
 */
export function promotionVerdict({ deliveryRatio, absorption, acwr, injuryActive, headroomVdot } = {}) {
  // ── Safety overrides — the PULL always wins ──
  if (injuryActive) return { verdict: 'ease', reason: 'active niggle — protect first, explore later', trajectoryAdjust: EASE_STEP };
  if (acwr != null && acwr > ACWR_DANGER) return { verdict: 'ease', reason: `ACWR ${(+acwr).toFixed(2)} in the danger zone — back off`, trajectoryAdjust: EASE_STEP };

  const dr = deliveryRatio != null ? deliveryRatio : 1;
  const abs = absorption && absorption.score != null ? absorption.score : 0;
  const room = (headroomVdot || 0) >= HEADROOM_MIN;

  // ── PROMOTE — over-delivering, absorbing it, and there's a ceiling to chase ──
  if (dr >= DELIVER_OVER && abs >= ABSORB_GOOD && room) {
    const step = Math.min(PROMOTE_STEP_MAX, 0.03 + (dr - 1) + abs * 0.04);
    return { verdict: 'promote', reason: 'over-delivering and absorbing it — raising the trajectory toward your ceiling', trajectoryAdjust: +(+step.toFixed(3)) };
  }
  // ── EASE — clearly not absorbing, or under load and not recovered ──
  if (abs <= ABSORB_BAD || (dr < DELIVER_UNDER && abs < 0.2)) {
    return {
      verdict: 'ease',
      reason: dr < DELIVER_UNDER ? 'under recent load and not fully recovered — re-baselining down honestly' : "the signals say you're not absorbing the load — easing",
      trajectoryAdjust: EASE_STEP,
    };
  }
  // ── HOLD — steady, or over-delivering but not yet CONFIRMED absorbed (give it another week) ──
  return {
    verdict: 'hold',
    reason: dr >= DELIVER_OVER ? 'delivering more — holding a week to confirm you absorb it before promoting' : (room ? 'on plan and steady — trajectory holds, ceiling still ahead' : 'on plan and near your current ceiling — sharpen, don’t pile on'),
    trajectoryAdjust: 0,
  };
}

// ─────────────────── Thin storage-reading wrapper (isolates impurity) ───────────────────
// Assembles the real signals from the athlete's data and returns the verdict + the raw inputs, so a surface
// (or a test) can show exactly why. Best-effort: any signal that can't be computed is simply omitted, and the
// pure core degrades gracefully (a missing signal just doesn't vote).
export function getPromotionState(ctx = {}) {
  const s = ctx || {};
  const injuryActive = !!s.injuryActive;
  const acwr = s.acwr != null ? Number(s.acwr) : null;
  const deliveryRatio = s.deliveryRatio != null ? Number(s.deliveryRatio) : null;
  const absorption = assessAbsorption({ acwr, readinessTrend: s.readinessTrend, efficiencyTrend: s.efficiencyTrend });
  const headroomVdot = s.headroomVdot != null ? Number(s.headroomVdot) : null;
  const verdict = promotionVerdict({ deliveryRatio, absorption, acwr, injuryActive, headroomVdot });
  return { ...verdict, inputs: { deliveryRatio, acwr, injuryActive, headroomVdot, readinessTrend: s.readinessTrend ?? null, efficiencyTrend: s.efficiencyTrend ?? null }, absorption };
}

export default promotionVerdict;
