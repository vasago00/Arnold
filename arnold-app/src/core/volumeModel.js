// Goal-driven volume (Sprint 3.2c follow-up). The plan's peak weekly mileage
// should be set by WHAT THE GOAL REQUIRES, not echoed from the athlete's current
// weeklyRunDistanceTarget. A sub-3:30 marathon and a 4:30 marathon need very
// different peak volumes; capping both at 1.4× current volume makes targeting a
// goal do nothing.
//
// Evidence basis: peak weekly mileage for amateur marathoners scales with goal
// pace — faster goals demand more aerobic volume. Anchored on widely-used
// coaching consensus (Daniels/Pfitzinger-style guidance) at 8:00/mi ≈ 3:30 →
// ~48 mi/wk peak, ~+1.5 mi per 10 s/mi faster, clamped to a sane amateur band.
// This is a defensible DEFAULT and a single knob — like CROSS_TRAIN_CREDIT it's
// meant to become hub-learnable from the athlete's own tolerated volume later.

import { fmtFinish } from './time.js';

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/**
 * recommendedPeakMi — target peak weekly volume for a marathon goal time.
 * @param goalTimeSecs finish-time goal in seconds
 * @param distanceMi   race distance (marathon-only for v1; returns null for < 24 mi)
 * @returns integer peak mi/wk, or null when not applicable
 */
export function recommendedPeakMi(goalTimeSecs, distanceMi = 26.2) {
  const secs = num(goalTimeSecs), d = num(distanceMi);
  if (!(secs > 0) || !(d >= 24)) return null;      // marathon goals only (v1)
  const paceSec = secs / d;                         // seconds per mile at goal pace
  const peak = 48 + (480 - paceSec) * 0.15;         // anchor: 8:00/mi (3:30) → 48
  return Math.round(Math.max(30, Math.min(70, peak)));
}

/**
 * goalRequirements — what a marathon GOAL demands across the key ingredients, so
 * the training profile can be FORWARD-LOOKING (current build vs what the goal
 * needs) instead of anchored on a stale past race. All evidence-anchored bands:
 *   • peak weekly volume  — recommendedPeakMi (goal-pace scaled)
 *   • longest run         — marathon-specific endurance, 18–22 mi, mild scale
 *   • threshold weeks     — distinct quality weeks across a ~16-wk build, 8–12
 * Marathon-only (returns null otherwise).
 * @returns { peakMi, longRunMi, thresholdWeeks } | null
 */
export function goalRequirements(goalTimeSecs, distanceMi = 26.2) {
  const peakMi = recommendedPeakMi(goalTimeSecs, distanceMi);
  if (peakMi == null) return null;
  const longRunMi = Math.max(18, Math.min(22, Math.round(peakMi * 0.42)));
  const thresholdWeeks = Math.max(8, Math.min(12, Math.round(peakMi / 5)));
  return { peakMi, longRunMi, thresholdWeeks };
}

/**
 * volumeReadout — the peak + a one-line "what the goal needs" note, plus a gap
 * flag comparing the current base to the recommended peak.
 * @returns { peakMi, note, gapMi, behind } | null
 */
export function volumeReadout({ goalTimeSecs, distanceMi = 26.2, currentWeeklyMi = 0 } = {}) {
  const peakMi = recommendedPeakMi(goalTimeSecs, distanceMi);
  if (peakMi == null) return null;
  const cur = num(currentWeeklyMi) || 0;
  const gapMi = Math.max(0, peakMi - cur);
  const goalStr = fmtFinish(goalTimeSecs);   // the ONE finish-time formatter (core/time.js)
  return {
    peakMi, gapMi,
    behind: cur > 0 && cur < peakMi * 0.9,
    note: `Peak ${peakMi} mi/wk — what a ${goalStr} marathon needs.`,
  };
}

export default recommendedPeakMi;
