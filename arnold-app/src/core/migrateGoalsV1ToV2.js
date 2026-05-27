// ─── Phase B Turn 4 — Goals schema migration v1 → v2 ──────────────────────
//
// Phase 4r.dataspine.7 (2026-05-24)
//
// Background:
//   v1: flat fields on the `goals` storage object —
//       goals.targetWeight, goals.dailyCalorieTarget, goals.proteinPct, etc.
//   v2: nested outcome-only structures —
//       goals.body.weight.{targetLbs,targetDate,priority}
//       goals.body.bodyFat.{targetPct,targetDate,priority}
//       goals.recovery.{sleepHoursMin,hrvBaseline,rhrBaseline}
//       goals.performance.{run5K,run10K,halfMarathon,marathon,customStrength[]}
//       goals.races[]
//       goals.schemaVersion = 2
//
// What this migration does:
//   1. No-op if `goals.schemaVersion === 2` AND v2 structures are populated.
//   2. Otherwise, build v2 structures from v1 fields (same logic as
//      GoalsHub's loadGoalsV2 read path).
//   3. Convert manual calorie/protein targets to OVERRIDES so user
//      intent is preserved (otherwise the outcome-only derivation
//      would silently change those numbers).
//   4. Write back: `{ ...existing, ...v2, schemaVersion: 2 }`. v1
//      fields are preserved in storage during the compat window —
//      no destructive delete yet.
//   5. Return a summary log so the boot fingerprint can show what
//      happened.
//
// What this migration does NOT do (deliberately deferred):
//   - Delete the v1 flat fields. Several internal callers still read
//     them as low-priority fallbacks (energyBalance.recommendCalorieTarget
//     reads goals.dailyCalorieTarget with `?? 2000`). When all such
//     reads are migrated to v2 + override-system, a follow-up phase
//     can drop the v1 fields.
//   - Force-rewrite races. GoalsHub already mirrors races to
//     localStorage 'arnold:races' for legacy compat.

import { storage } from './storage.js';
import { setOverride } from './goalModel.js';

const EMPTY_V2 = () => ({
  schemaVersion: 2,
  body:        { weight: null, bodyFat: null, leanMass: null },
  recovery:    { sleepHoursMin: null, hrvBaseline: null, rhrBaseline: null },
  performance: {
    run5K: null, run10K: null, halfMarathon: null, marathon: null,
    customStrength: [],
  },
  races: [],
});

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function buildV2FromV1(v1) {
  const out = EMPTY_V2();
  if (!v1 || typeof v1 !== 'object') return out;

  if (v1.targetWeight) {
    out.body.weight = {
      targetLbs:  num(v1.targetWeight),
      targetDate: v1.targetWeightDate || null,
      priority:   1,
    };
  }
  if (v1.targetBodyFat) {
    out.body.bodyFat = {
      targetPct:  num(v1.targetBodyFat),
      targetDate: v1.targetWeightDate || null,
      priority:   2,
    };
  }
  if (v1.targetSleepHours || v1.targetSleepScore) {
    out.recovery.sleepHoursMin = {
      value:    num(v1.targetSleepHours) || 7.5,
      priority: 1,
    };
  }
  if (v1.targetHRV) {
    out.recovery.hrvBaseline = {
      value:    num(v1.targetHRV),
      priority: 2,
    };
  }
  if (v1.targetRHR) {
    out.recovery.rhrBaseline = {
      value:    num(v1.targetRHR),
      priority: 2,
    };
  }
  // Races mirror from localStorage if present.
  try {
    const racesRaw = localStorage.getItem('arnold:races');
    const races = racesRaw ? JSON.parse(racesRaw) : [];
    if (Array.isArray(races)) {
      out.races = races.map(r => ({
        id:           r.id || `race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name:         r.name || 'Race',
        date:         r.date || null,
        city:         r.city || null,
        type:         r.type || 'other',
        distanceMi:   r.distanceMi != null ? Number(r.distanceMi) : null,
        priority:     (r.priority || 'A').toUpperCase(),
        goalTimeSecs: r.goalTimeSecs != null ? Number(r.goalTimeSecs) : null,
      }));
    }
  } catch { /* ignore */ }

  return out;
}

/**
 * Run the v1 → v2 migration. Idempotent — safe to call every boot.
 * Returns a summary object the boot fingerprint can log:
 *   { migrated: bool, reason?: string, overridesCreated: string[] }
 */
export function migrateGoalsV1ToV2() {
  const goals = storage.get('goals') || {};

  // Already on v2 AND has at least one v2 structure populated? Skip.
  if (goals.schemaVersion === 2 && (goals.body || goals.performance || goals.races)) {
    return { migrated: false, reason: 'already-v2' };
  }

  // Build v2 from whatever's there.
  const v2 = buildV2FromV1(goals);

  // Preserve user intent: if they had a manual calorie / protein target,
  // convert to an override so the outcome-only derivation doesn't
  // silently change those numbers on next boot.
  const overridesCreated = [];
  if (goals.dailyCalorieTarget && num(goals.dailyCalorieTarget) > 0) {
    try {
      setOverride('dailyCalories', num(goals.dailyCalorieTarget));
      overridesCreated.push('dailyCalories');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[migrateGoalsV1ToV2] failed to set dailyCalories override:', e?.message || e);
    }
  }
  if (goals.dailyProteinTarget && num(goals.dailyProteinTarget) > 0) {
    try {
      setOverride('dailyProtein', num(goals.dailyProteinTarget));
      overridesCreated.push('dailyProtein');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[migrateGoalsV1ToV2] failed to set dailyProtein override:', e?.message || e);
    }
  }

  // Write back: v2 structures stamped on top of existing goals; v1
  // flat fields preserved during the compat window. schemaVersion
  // is the canonical signal that migration ran.
  const next = { ...goals, ...v2, schemaVersion: 2 };
  storage.set('goals', next, { skipValidation: true });

  return { migrated: true, overridesCreated };
}
