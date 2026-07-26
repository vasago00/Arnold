// Tests for the zones accuracy ladder (single source of truth for the easy ceiling / LT1). The point
// here is the UNIFICATION: the athlete's own data-driven LT1 (decoupling) is now a ranked rung —
// preferred over Garmin-generic/Karvonen, but still below a FRESH lab test — so the whole app reads ONE
// easy ceiling. These pin the ladder order and the graceful degradation when data is thin.
import { describe, it, expect } from 'vitest';
import { resolveZones, classifyEffort } from './zones.js';
import { buildEasyZone, classifyIntensity } from './derive/easyZone.js';
import realRuns from './record/__fixtures__/real-activities.json';

// synthetic athlete: flat easy plateau (HR 122–142 @ ~10:00/mi) + genuine workouts (150–158 @ ~8:00/mi).
const mk = (nEasy, nHard) => {
  const r = [];
  for (let i = 0; i < nEasy; i++) r.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 10 * 60 * 6, avgHR: 122 + (i % 21), maxHR: 185, isRun: true });
  for (let i = 0; i < nHard; i++) r.push({ date: '2026-06-02', distanceMi: 6, durationSecs: 8 * 60 * 6, avgHR: 150 + (i % 9), maxHR: 185, isRun: true });
  return r;
};

describe('resolveZones ladder — data-driven LT1 as a ranked rung', () => {
  it('prefers the athlete’s OWN data-driven LT1 over Karvonen when there is enough of it', () => {
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(200, 24), profile: {}, today: '2026-07-01' });
    expect(r.source).toBe('personal-data');
    expect(r.lt1Method).toMatch(/cluster/);
    expect(r.z2Ceiling).toBeGreaterThanOrEqual(138);
    expect(r.z2Ceiling).toBeLessThanOrEqual(147);
    expect(r.lt2Hr).toBeGreaterThan(r.lt1Hr);          // LT2 sits above LT1
  });

  it('degrades gracefully to Karvonen when the data is too thin/low-confidence', () => {
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(20, 4), profile: {}, today: '2026-07-01' });
    expect(r.source).not.toBe('personal-data');
    expect(r.z2Ceiling).toBeGreaterThan(0);            // still returns a usable ceiling
  });

  it('a FRESH lab test still outranks the data-driven estimate (ground truth wins)', () => {
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(200, 24), profile: { labThresholds: { lt1Hr: 150, lt2Hr: 168, testedAt: '2026-07-01' } }, today: '2026-07-01' });
    expect(r.source).toMatch(/^lab/);
  });

  it('classifyEffort reads the ONE unified ceiling (easy vs not-easy)', () => {
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(200, 24), profile: {}, today: '2026-07-01' });
    expect(classifyEffort(130, r)).toBe('easy');       // below the ceiling
    expect(classifyEffort(160, r)).not.toBe('easy');   // above it
  });

  it('REAL DATA: the easy ceiling is ONE number — resolveZones z2Ceiling ≈ buildEasyZone easyCeilingBpm (≤1 bpm), and both classifiers agree', () => {
    // The "143 vs 136 vs 142" class of bug: the same concept computed by parallel systems. This pins that
    // resolveZones (the SSOT), buildEasyZone (the card), and both effort classifiers stay on one ceiling.
    const runs = realRuns.map((a) => ({ ...a, isRun: true }));
    const profile = { hrZoneBpm: { source: 'karvonen', z1Max: 122, z2Max: 136, z3Max: 150, z4Max: 162 } };
    const zones = resolveZones({ runs, profile, restingHR: 46, today: '2026-07-20' });
    expect(zones.source).toBe('personal-data');                 // data-driven wins over the cached Garmin zone
    const z = buildEasyZone({ runs, restingHrSeries: [], zones }, { today: '2026-07-20', windowDays: 3650 });
    expect(Math.abs(zones.z2Ceiling - z.easyCeilingBpm)).toBeLessThanOrEqual(1);
    expect(classifyEffort(zones.z2Ceiling, zones)).toBe('easy');
    expect(classifyIntensity(zones.z2Ceiling, z)).toBe('easy');
  });

  it('enforces the science cap inside resolveZones (not just easyZone) — z2Ceiling never exceeds ~0.82·HRmax', () => {
    // pathological: an easy plateau crammed near max would push the raw LT1 above the guardrail
    const hot = [];
    for (let i = 0; i < 200; i++) hot.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 9 * 60 * 6, avgHR: 158 + (i % 9), maxHR: 185, isRun: true });
    for (let i = 0; i < 24; i++) hot.push({ date: '2026-06-02', distanceMi: 6, durationSecs: 7 * 60 * 6, avgHR: 176 + (i % 6), maxHR: 185, isRun: true });
    const zones = resolveZones({ runs: hot, restingHR: 46, profile: {}, today: '2026-07-01' });
    if (zones.source === 'personal-data') expect(zones.z2Ceiling).toBeLessThanOrEqual(Math.round(0.82 * 185) + 1);
  });

  it('wires a clinicalTests VO2max ventilatory threshold (VT1/VT2) into the lab rung', () => {
    // The gap this closes: an entered CPET/VO2max test carried metrics.vt1/vt2 but they died in
    // clinicalTests and never reached the ladder. Now the newest lab VT1 anchors the easy ceiling.
    const clinicalTests = [{ type: 'vo2max', date: '2026-07-15', metrics: { vt1: 148, vt2: 168 } }];
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(80, 12), profile: {}, clinicalTests, today: '2026-07-20' });
    expect(r.source).toMatch(/^lab/);      // the lab rung fired off the clinical test
    expect(r.lt1Method).toBe('lab');
  });

  it('fires the lab rung on a VT1-only report by deriving LT2 from the athlete data', () => {
    const clinicalTests = [{ type: 'vo2max', date: '2026-07-15', metrics: { vt1: 150 } }]; // no VT2
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(80, 12), profile: {}, clinicalTests, today: '2026-07-20' });
    expect(r.source).toMatch(/^lab/);
    expect(r.lt2Hr).toBeGreaterThan(r.lt1Hr);   // LT2 filled from real data so the rung can anchor
  });

  it('prefers the FRESHER lab anchor — a recent clinical VT1 over a stale profile.labThresholds', () => {
    const profile = { labThresholds: { lt1Hr: 130, lt2Hr: 150, testedAt: '2025-01-01', source: 'lab' } };
    const clinicalTests = [{ type: 'vo2max', date: '2026-07-15', metrics: { vt1: 150, vt2: 170 } }];
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(80, 12), profile, clinicalTests, today: '2026-07-20' });
    expect(r.source).toMatch(/^lab/);
    expect(r.z2Ceiling).toBeGreaterThan(133);   // the fresh 150 anchor, not the stale 130
  });

  it('ignores clinical tests without a valid VT1 (falls back to the data-driven rung)', () => {
    const clinicalTests = [{ type: 'vo2max', date: '2026-07-15', metrics: { vo2max: 52 } }]; // no VT
    const r = resolveZones({ maxHR: 185, restingHR: 46, runs: mk(200, 24), profile: {}, clinicalTests, today: '2026-07-20' });
    expect(r.source).not.toMatch(/^lab/);
    expect(r.source).toBe('personal-data');
  });

  it('estimates maxHR from the runs when the profile lacks one — the "136 not 145" bug', () => {
    // profile carries a cached Garmin/HRR zone (z2Max 136) but NO maxHR. The data-driven rung must still
    // win by estimating maxHR from the runs' peak, instead of silently falling back to that cached zone.
    const r = resolveZones({ runs: mk(200, 24), restingHR: 46, profile: { hrZoneBpm: { source: 'karvonen', z1Max: 122, z2Max: 136, z3Max: 150, z4Max: 162 } }, today: '2026-07-01' });
    expect(r.maxHR).toBe(185);            // estimated from the runs' peak, not the (absent) profile value
    expect(r.source).toBe('personal-data');
    expect(r.z2Ceiling).not.toBe(136);    // NOT the Garmin fallback
  });
});
