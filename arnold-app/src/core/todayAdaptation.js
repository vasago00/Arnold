// Today-adaptation selector — Phase 2.1's second surface. The pre-workout tile
// already adapts TODAY's session; this assembles the SAME adaptSession context
// from storage so other surfaces (the weekly planner) can show today's adapted
// state without re-deriving — and therefore can't disagree with the tile.
//
// `readinessScoreFrom` + `readTodaySignals` are extracted verbatim from
// PlannedWorkoutTile.readinessVerdict so the score matches exactly (locked by a
// Node assertion in todayAdaptation.test.js). `getTodayAdaptation` is async only
// because the fatigue signal comes from getPredictedBands.

import { storage } from './storage.js';
import { localDate } from './time.js';
import { adaptSession } from './adaptPlan.js';
import { getPredictedBands } from './predictedBands.js';
import { signaturesForActivities, computeReboundDebt } from './derive/recoverySignature.js';
import { allActivities as getUnifiedActivities } from './dcyMath.js';

// Pure readiness score (0–100) from sleep + HRV signals. Verbatim from the
// pre-workout tile's readinessVerdict scoring.
export function readinessScoreFrom({ sleepHrs = null, hrvDelta = null, hrvNow = null } = {}) {
  let score = 50;
  if (sleepHrs != null) {
    score += sleepHrs >= 7.5 ? 25 : sleepHrs >= 7 ? 15 : sleepHrs >= 6 ? 5 : -15;
  }
  if (hrvDelta != null) {
    score += hrvDelta >= 5 ? 25 : hrvDelta >= 0 ? 15 : hrvDelta >= -5 ? 0 : -20;
  } else if (hrvNow != null) {
    score += hrvNow >= 50 ? 15 : hrvNow >= 40 ? 5 : -5;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

// Read today's sleep + HRV signals from storage. Verbatim from readinessVerdict.
export function readTodaySignals() {
  let sleepHrs = null, hrvNow = null, hrvDelta = null;
  try {
    const sleep = (storage.get('sleep') || [])
      .filter(s => s?.durationMinutes)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (sleep[0]) sleepHrs = +(sleep[0].durationMinutes / 60).toFixed(1);

    const hrv = (storage.get('hrv') || [])
      .filter(h => h?.overnightHRV)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (hrv[0]) {
      hrvNow = Number(hrv[0].overnightHRV);
      const last14 = hrv.slice(0, 14);
      if (last14.length >= 5) {
        const baseline = last14.reduce((s, r) => s + Number(r.overnightHRV), 0) / last14.length;
        hrvDelta = Math.round(hrvNow - baseline);
      }
    }
  } catch { /* defaults */ }
  return { sleepHrs, hrvNow, hrvDelta };
}

/**
 * getTodayAdaptation — assemble the adaptSession ctx for TODAY's planned session
 * from storage and return the adapted prescription. Async (fatigue band fetch).
 *
 * @param {{ profile?, planType?:string, distanceMi?:number, durationMin?:number, label?:string }} opts
 * @returns {Promise<object|null>} adaptSession result, or null when nothing planned.
 */
export async function getTodayAdaptation({ profile, planType, distanceMi, durationMin, label } = {}) {
  if (!planType || planType === 'rest') return null;

  const sig = readTodaySignals();
  const score = readinessScoreFrom(sig);

  let debtLbs = 0;
  try {
    const wh = storage.get('weight') || [];
    const debt = computeReboundDebt(signaturesForActivities(getUnifiedActivities(), wh, { daysBack: 14 }));
    debtLbs = debt?.totalDebtLbs || 0;
  } catch { /* no debt */ }

  let fatigueLevel = 0;
  try {
    const bands = await getPredictedBands({ family: planType, dateStr: localDate() });
    fatigueLevel = Number(bands?.source?.fatigueLevel) || 0;
  } catch { /* no fatigue signal */ }

  // Fall back to the stored profile so every surface uses the same sleep goal.
  const prof = profile || storage.get('profile') || {};
  const ctx = {
    readiness: score >= 75 ? 'high' : score >= 55 ? 'moderate' : 'low',
    debtLbs,
    hrvDelta: sig.hrvDelta,
    sleepHrs: sig.sleepHrs,
    sleepGoalHrs: Number(prof?.sleepGoalHrs) || 7.5,
    fatigueLevel,
  };

  return adaptSession(
    {
      type: planType,
      intensityClass: planType,
      distanceMi: Number(distanceMi) || null,
      durationMin: durationMin || null,
      label,
    },
    ctx,
  );
}

export default getTodayAdaptation;
