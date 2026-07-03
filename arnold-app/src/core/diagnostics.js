// core/diagnostics.js — Arnold's SELF-CHECK layer (Emil 2026-07-01: "we need ways of
// detecting this and not relying on me"). Two jobs:
//   1. PROVENANCE — for the key derived numbers (calorie target, intake, activity view),
//      show WHERE each came from and its components, so "why is this 1880?" is one call.
//   2. INVARIANTS — assert things that should always hold (a logged workout feeds eat-back;
//      no duplicate activities; the displayed target isn't a stale static; intake with
//      calories has protein). Anything that fails becomes a surfaced warning.
//
// Pure-ish (reads storage). Exposed on window.__arnoldDiag() for console use; the pure
// check helpers are unit-tested. An in-app "⚠ N issues" surface can consume runDiagnostics()
// later — this is the engine.

import { storage } from './storage.js';
import { localDate } from './time.js';
import { getGoals } from './goals.js';
import { allActivities, activitySignature } from './dcyMath.js';
import { dailyActivityCalories } from './energyBalance.js';
import { deriveDailyCalorieTarget, getEffectiveTargets } from './goalModel.js';
import { dailyTotals } from './nutrition.js';
import { getSyncStatus } from './cloud-sync.js';

// PURE: exact-duplicate detection. Two rows on the same day with the same canonical type,
// duration, AND calories are the SAME physical session written twice (a real morning+evening
// would differ in at least one). Returns the duplicate rows (beyond the first of each group).
export function detectDuplicateActivities(activities, date) {
  const today = (activities || []).filter(a => a && a.date === date && a.source !== 'health_connect');
  const seen = new Set();
  const dups = [];
  for (const a of today) {
    const key = activitySignature(a);
    if (seen.has(key)) dups.push({ key, activity: a });
    else seen.add(key);
  }
  return dups;
}

// PURE: given the resolved numbers, produce the invariant warnings.
export function buildChecks({ duplicateCount, activityKcal, eatBack, effective, derived, legacy, intakeCal, intakeProtein, unsyncedCount, cloudPullError }) {
  const checks = [];
  const add = (id, level, message) => checks.push({ id, level, message });
  if (duplicateCount > 0) add('duplicate-activity', 'error', `${duplicateCount} duplicate activity row(s) today — inflates calories, load, and TSS.`);
  if (activityKcal > 0 && eatBack === 0) add('workout-no-eatback', 'warn', `A workout is logged (${activityKcal} kcal) but eat-back is 0 — your calorie target isn't reflecting training.`);
  if (effective != null && legacy != null && effective === legacy && derived != null && derived !== legacy) add('target-stale-static', 'warn', `Displayed calorie target (${effective}) matches the legacy static goal, not the computed ${derived}.`);
  if (intakeCal > 0 && intakeProtein === 0) add('intake-no-protein', 'warn', `Calories logged today (${intakeCal}) but protein reads 0 — a nutrition-source wire may be off.`);
  // Sync self-checks — surface silent cross-device failures without relying on the user.
  if (unsyncedCount > 0) add('cloud-unsynced', 'warn', `${unsyncedCount} local change(s) haven't reached the cloud relay since the last successful push — other devices won't see them yet.`);
  if (cloudPullError) add('cloud-pull-error', 'warn', `Last cloud pull failed: ${cloudPullError.message || cloudPullError.code || 'unknown'}.`);
  return checks;
}

// Full diagnostic for a date. Reads storage; returns provenance + checks.
export function runDiagnostics(dateStr) {
  const date = dateStr || localDate();
  const out = { date };

  // ── Calorie target provenance ──
  let calT = null;   try { calT = deriveDailyCalorieTarget({ date }); } catch (e) { calT = { error: String(e?.message || e) }; }
  let effective = null; try { effective = getEffectiveTargets({ date })?.dailyCalories?.effective ?? null; } catch {}
  const legacy = Number(getGoals()?.dailyCalorieTarget) || null;
  const eatBack = calT?.components?.eatBack ?? null;
  out.calorieTarget = { effective, derived: calT?.derived ?? null, legacy, components: calT?.components ?? null };

  // ── Activity view ──
  const raw = (storage.get('activities') || []).filter(a => a && a.date === date);
  const dups = detectDuplicateActivities(raw, date);
  let activityKcal = 0; try { activityKcal = dailyActivityCalories(date); } catch {}
  let unifiedCount = null; try { unifiedCount = allActivities().filter(a => a.date === date).length; } catch {}
  out.activity = { rawCount: raw.length, unifiedCount, duplicateCount: dups.length, duplicates: dups.map(d => d.key), activityKcal };

  // ── Intake view ──
  // The MODERN Cronometer path is a LIVE PULL that upserts a `full-day` entry
  // into nutritionLog (id `cronometer-live:<date>`), NOT the legacy `cronometer`
  // CSV store — which stays empty in normal use. Report the TRUE source so an
  // empty CSV store never reads as a false "cronometer broken" alarm. (It did on
  // 2026-07-01: `cronometerCount: 0` looked like a failure when the live
  // full-day entry was present in nutritionLog and the totals were correct.)
  let intake = null; try { intake = dailyTotals(date); } catch {}
  const intakeCal = Number(intake?.calories) || 0;
  const intakeProtein = Number(intake?.protein) || 0;
  const logRows = (storage.get('nutritionLog') || []).filter(x => x.date === date);
  const fullDay = logRows
    .filter(x => x.meal === 'full-day')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] || null;
  const intakeSource = fullDay
    ? (String(fullDay.source || '').startsWith('cronometer') ? 'cronometer-live' : 'full-day')
    : logRows.length > 0 ? 'manual'
    : intake?.source === 'cronometer' ? 'csv-legacy'
    : 'none';
  out.intake = {
    calories: intakeCal, protein: intakeProtein, water: Number(intake?.water) || 0,
    source: intakeSource,
    fullDayEntry: fullDay ? { id: fullDay.id, source: fullDay.source, createdAt: fullDay.createdAt } : null,
    nutritionLogCount: logRows.length,
    cronometerCsvCount: (storage.get('cronometer') || []).filter(x => x.date === date).length,
  };

  // ── Cloud-sync view ──
  // Whether this device's local changes have reached the relay, plus the last
  // pull error. This is what turns a silent cross-device failure (the 2026-07-02
  // Cronometer loss) into a surfaced warning instead of a mystery.
  let sync = null;
  try {
    const s = getSyncStatus();
    sync = {
      paired: s.paired,
      hasPassphrase: s.hasPassphrase,
      lastPull: s.lastPull || 0,
      lastPushOk: s.lastPushOk || 0,
      unsyncedCount: s.unsyncedCount || 0,
      unsyncedKeys: s.unsyncedKeys || [],
      lastPullError: s.lastPullError || null,
    };
  } catch (e) { sync = { error: String(e?.message || e) }; }
  out.sync = sync;

  out.checks = buildChecks({
    duplicateCount: dups.length, activityKcal, eatBack,
    effective, derived: calT?.derived ?? null, legacy,
    intakeCal, intakeProtein,
    unsyncedCount: sync?.unsyncedCount || 0,
    cloudPullError: sync?.lastPullError || null,
  });
  out.ok = out.checks.every(c => c.level !== 'error');
  return out;
}
