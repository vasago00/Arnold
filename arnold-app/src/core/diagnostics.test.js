// Vitest suite for the self-check layer (core/diagnostics.js) — the invariant
// logic that keeps silent data-flow failures from going unnoticed, PLUS the
// shared activity signature and the cloud-sync self-checks.
//
// NOTE: this lives under src/ (not tests/) on purpose — vitest.config.js only
// includes `src/**/*.test.js(x)` and EXCLUDES `tests/**`, so a file in tests/
// never runs under `npm test`. Co-locating here is what makes these count.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { detectDuplicateActivities, buildChecks } from './diagnostics.js';
import { activitySignature } from './dcyMath.js';

const T = '2026-07-01';

// ── detectDuplicateActivities ────────────────────────────────────────────────
test('detectDuplicateActivities: two identical Strength rows → one duplicate', () => {
  const acts = [
    { date: T, activityType: 'Strength', durationSecs: 3180, calories: 291 },
    { date: T, activityType: 'Strength', durationSecs: 3180, calories: 291 },
  ];
  assert.equal(detectDuplicateActivities(acts, T).length, 1);
});

test('detectDuplicateActivities: two DIFFERENT sessions (morning+evening) are NOT duplicates', () => {
  const acts = [
    { date: T, activityType: 'Run', durationSecs: 2400, calories: 400 },
    { date: T, activityType: 'Run', durationSecs: 3600, calories: 620 },
  ];
  assert.equal(detectDuplicateActivities(acts, T).length, 0);
});

test('detectDuplicateActivities: health_connect ghost rows are ignored', () => {
  const acts = [
    { date: T, activityType: 'Strength', durationSecs: 3180, calories: 291 },
    { date: T, activityType: 'Strength', durationSecs: 3180, calories: 291, source: 'health_connect' },
  ];
  assert.equal(detectDuplicateActivities(acts, T).length, 0);
});

// ── activitySignature (shared by the checker AND the Garmin write guard) ──────
test('activitySignature: identical sessions on the SAME day collide', () => {
  const a = { date: T, activityType: 'Strength', durationSecs: 3197, calories: 291 };
  const b = { date: T, activityType: 'Strength', durationSecs: 3197, calories: 291 };
  assert.equal(activitySignature(a), activitySignature(b));
});

test('activitySignature: same session on a DIFFERENT day is NOT a duplicate', () => {
  const a = { date: T,            activityType: 'Strength', durationSecs: 3197, calories: 291 };
  const b = { date: '2026-07-02', activityType: 'Strength', durationSecs: 3197, calories: 291 };
  assert.notEqual(activitySignature(a), activitySignature(b));
});

test('activitySignature: morning vs evening (different duration) differ', () => {
  const a = { date: T, activityType: 'Run', durationSecs: 2400, calories: 400 };
  const b = { date: T, activityType: 'Run', durationSecs: 3600, calories: 620 };
  assert.notEqual(activitySignature(a), activitySignature(b));
});

// ── buildChecks: data invariants ─────────────────────────────────────────────
test('buildChecks: flags a duplicate activity as an error', () => {
  const c = buildChecks({ duplicateCount: 1, activityKcal: 582, eatBack: 100, effective: 2000, derived: 2000, legacy: 1750, intakeCal: 500, intakeProtein: 40 });
  assert.ok(c.some(x => x.id === 'duplicate-activity' && x.level === 'error'));
});

test('buildChecks: flags a workout that fed 0 eat-back', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 582, eatBack: 0, effective: 1880, derived: 1880, legacy: 1750, intakeCal: 0, intakeProtein: 0 });
  assert.ok(c.some(x => x.id === 'workout-no-eatback'));
});

test('buildChecks: flags a target that equals the legacy static instead of the computed one', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 0, eatBack: null, effective: 1750, derived: 1900, legacy: 1750, intakeCal: 0, intakeProtein: 0 });
  assert.ok(c.some(x => x.id === 'target-stale-static'));
});

test('buildChecks: flags calories logged with zero protein', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 0, eatBack: null, effective: 1880, derived: 1880, legacy: 1750, intakeCal: 1500, intakeProtein: 0 });
  assert.ok(c.some(x => x.id === 'intake-no-protein'));
});

test('buildChecks: clean inputs → no warnings', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 500, eatBack: 200, effective: 2000, derived: 2000, legacy: 1750, intakeCal: 1800, intakeProtein: 120 });
  assert.equal(c.length, 0);
});

// ── buildChecks: cloud-sync self-checks ──────────────────────────────────────
test('buildChecks: flags local changes that never reached the relay', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 0, eatBack: null, effective: 1880, derived: 1880, legacy: 1750, intakeCal: 0, intakeProtein: 0, unsyncedCount: 2 });
  assert.ok(c.some(x => x.id === 'cloud-unsynced' && x.level === 'warn'));
});

test('buildChecks: flags a failed cloud pull (e.g. passphrase mismatch)', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 0, eatBack: null, effective: 1880, derived: 1880, legacy: 1750, intakeCal: 0, intakeProtein: 0, cloudPullError: { code: 'decrypt_failed', message: 'Passphrase mismatch' } });
  assert.ok(c.some(x => x.id === 'cloud-pull-error'));
});

test('buildChecks: synced + no pull error → no sync warnings', () => {
  const c = buildChecks({ duplicateCount: 0, activityKcal: 0, eatBack: null, effective: 1880, derived: 1880, legacy: 1750, intakeCal: 0, intakeProtein: 0, unsyncedCount: 0, cloudPullError: null });
  assert.equal(c.length, 0);
});
