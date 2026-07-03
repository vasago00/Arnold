// Tests for the coaching knowledge base (core/coaching/*) — P1.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { vdotFromRace, raceTimeFromVdot, trainingPaces, paceForPct } from '../core/coaching/vdot.js';
import { mafHeartRate, mafZone } from '../core/coaching/maffetone.js';
import { personalizedPaces } from '../core/coaching/personalize.js';
import { observedEasyPaceSecs } from '../core/coaching/observedPace.js';

const TODAY = new Date().toISOString().slice(0, 10);

// ── VDOT (the exact Daniels–Gilbert formula) ─────────────────────────────────
test('vdotFromRace: Daniels anchor — 5K in 19:57 ≈ VDOT 50', () => {
  const vdot = vdotFromRace(19 * 60 + 57, 5000);
  assert.ok(Math.abs(vdot - 50) < 0.6, `got ${vdot}`);
});

test('vdotFromRace: faster time → higher VDOT (monotonic)', () => {
  assert.ok(vdotFromRace(17 * 60, 5000) > vdotFromRace(22 * 60, 5000));
});

test('raceTimeFromVdot round-trips through vdotFromRace', () => {
  for (const [vdot, d] of [[50, 5000], [45, 10000], [60, 21097.5]]) {
    const t = raceTimeFromVdot(vdot, d);
    const back = vdotFromRace(t, d);
    assert.ok(Math.abs(back - vdot) < 0.5, `vdot ${vdot} @ ${d}m → ${t}s → ${back}`);
  }
});

test('raceTimeFromVdot: longer distance → slower time at same VDOT', () => {
  assert.ok(raceTimeFromVdot(50, 42195) > raceTimeFromVdot(50, 5000));
});

// ── Training paces (E/M/T/I/R) ───────────────────────────────────────────────
test('trainingPaces: ordered fastest→slowest interval < threshold < marathon < easy', () => {
  const p = trainingPaces(50);
  assert.ok(p.interval < p.threshold, 'I faster than T');
  assert.ok(p.threshold < p.marathon, 'T faster than M');
  assert.ok(p.marathon < p.easy, 'M faster than E');
  assert.ok(p.rep < p.interval, 'R faster than I');
  // sanity: a VDOT-50 easy pace is a plausible aerobic pace (7–12 min/mi)
  assert.ok(p.easy > 420 && p.easy < 720, `easy ${p.easy}s/mi`);
});

test('paceForPct: higher %VO2max → faster (smaller) pace', () => {
  assert.ok(paceForPct(50, 1.0) < paceForPct(50, 0.70));
});

test('trainingPaces: higher VDOT → faster paces across the board', () => {
  const a = trainingPaces(45), b = trainingPaces(55);
  for (const k of ['easy', 'marathon', 'threshold', 'interval']) assert.ok(b[k] < a[k], `${k} faster at higher VDOT`);
});

// ── Maffetone ────────────────────────────────────────────────────────────────
test('mafHeartRate: 180 − age, with adjustment', () => {
  assert.equal(mafHeartRate(40), 140);
  assert.equal(mafHeartRate(40, { adjustment: -5 }), 135);
  assert.deepEqual(mafZone(40), { max: 140, min: 130 });
});

// ── Personalization (× learned model) ────────────────────────────────────────
test('personalizedPaces: heat sensitivity slows aerobic pace on a hot day', () => {
  const base = { easy: 540, long: 500, interval: 380 };
  const hubFacts = { responses: [{ factor: 'heat', perUnitPct: 0.5, confidence: 1 }] };
  const hot = personalizedPaces(base, { hubFacts, tempC: 30 });
  assert.ok(hot.easy > base.easy, 'easy slowed in heat');
  assert.ok(hot.long > base.long, 'long slowed in heat');
  assert.equal(hot.interval, base.interval, 'interval (effort-anchored) unchanged');
});

test('personalizedPaces: no change when cool / no learned sensitivity', () => {
  const base = { easy: 540, long: 500 };
  assert.equal(personalizedPaces(base, { tempC: 15 }).easy, 540);
  assert.equal(personalizedPaces(base, { hubFacts: { responses: [{ factor: 'heat', perUnitPct: 0.5, confidence: 1 }] }, tempC: 18 }).easy, 540);
});

test('personalizedPaces: confidence discounts the adjustment (unlearned ≈ no move)', () => {
  const base = { easy: 540 };
  const lowConf = personalizedPaces(base, { hubFacts: { responses: [{ factor: 'heat', perUnitPct: 0.5, confidence: 0.05 }] }, tempC: 30 });
  assert.ok(lowConf.easy - 540 <= 2, 'barely-learned sensitivity barely moves pace');
});

// ── Observed easy pace (your data leads) ─────────────────────────────────────
test('observedEasyPaceSecs: HR split picks your aerobic (low-HR) runs, ignores quality', () => {
  const acts = [
    { isRun: true, date: TODAY, avgPaceRaw: '9:40', avgHR: 140, durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '9:50', avgHR: 138, durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '9:30', avgHR: 142, durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '7:00', avgHR: 175, durationSecs: 2400 }, // quality → excluded (HR > MAF cap)
  ];
  const r = observedEasyPaceSecs(acts, { age: 40 }); // MAF 140, cap ~145
  assert.equal(r.source, 'hr');
  assert.ok(Math.abs(r.secs - 580) < 20, `easy median ~9:40, got ${r.secs}`);
});

test('observedEasyPaceSecs: no HR → slower-60% pace split (not the fast quality runs)', () => {
  const acts = [
    { isRun: true, date: TODAY, avgPaceRaw: '9:40', durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '9:50', durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '9:30', durationSecs: 3000 },
    { isRun: true, date: TODAY, avgPaceRaw: '7:00', durationSecs: 2400 },
    { isRun: true, date: TODAY, avgPaceRaw: '6:50', durationSecs: 2400 },
  ];
  const r = observedEasyPaceSecs(acts, {});
  assert.equal(r.source, 'pace-split');
  assert.ok(r.secs > 540, `slower-side easy pace, got ${r.secs}`);
});

test('observedEasyPaceSecs: <3 runs → insufficient (fall back to VDOT)', () => {
  const r = observedEasyPaceSecs([{ isRun: true, date: TODAY, avgPaceRaw: '9:00', durationSecs: 3000 }], {});
  assert.equal(r.source, 'insufficient');
  assert.equal(r.secs, null);
});
