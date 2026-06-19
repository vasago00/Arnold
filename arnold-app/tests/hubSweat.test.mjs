// Tests for the personal sweat-rate accumulator (core/hub/sweatModel.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  makeSweatModel, grossSweatRate, observeSweat, predictSweatRate,
} from '../src/core/hub/sweatModel.js';

test('grossSweatRate adds fluid intake back to the scale drop', () => {
  // 2 lb net drop + 1 L drunk over 1 h → gross = 2*0.4536 + 1 = 1.907 L/hr
  const r = grossSweatRate({ sweatNetLbs: 2, fluidInL: 1, durationHr: 1 });
  assert.ok(Math.abs(r - 1.907) < 0.01, `got ${r}`);
});

test('grossSweatRate rejects unusable reads', () => {
  assert.equal(grossSweatRate({ sweatNetLbs: 2, fluidInL: 1, durationHr: 0 }), null); // no duration
  assert.equal(grossSweatRate({ sweatNetLbs: -3, fluidInL: 0, durationHr: 1 }), null); // gained weight, no fluid → gross<=0
  assert.equal(grossSweatRate({ sweatNetLbs: NaN, fluidInL: 1, durationHr: 1 }), null);
});

test('observeSweat appends valid obs and skips garbage', () => {
  let m = makeSweatModel();
  ({ model: m } = observeSweat(m, { tempC: 25, sweatNetLbs: 2, fluidInL: 0.5, durationHr: 1, date: '2026-06-01' }));
  assert.equal(m.obs.length, 1);
  const bad = observeSweat(m, { tempC: 25, sweatNetLbs: 2, fluidInL: 0.5, durationHr: 0 });
  assert.equal(bad.observed, false);
  assert.equal(bad.model.obs.length, 1); // unchanged
});

test('one observation → flat prediction (no slope yet)', () => {
  let m = makeSweatModel();
  ({ model: m } = observeSweat(m, { tempC: 20, sweatNetLbs: 2, fluidInL: 0, durationHr: 1 }));
  const lo = predictSweatRate(m, 10);
  const hi = predictSweatRate(m, 30);
  assert.equal(lo.perDegC, 0);            // can't learn a slope from one point
  assert.equal(lo.rateLhr, hi.rateLhr);   // flat
  assert.equal(lo.n, 1);
});

test('hot runs sweat more → learns a positive temperature slope', () => {
  let m = makeSweatModel();
  // mild runs ~1.0 L/hr, hot runs ~1.8 L/hr
  const obs = [
    { tempC: 12, sweatNetLbs: 2.2, fluidInL: 0, durationHr: 1 }, // ~1.0
    { tempC: 14, sweatNetLbs: 2.2, fluidInL: 0, durationHr: 1 },
    { tempC: 30, sweatNetLbs: 4.0, fluidInL: 0, durationHr: 1 }, // ~1.8
    { tempC: 32, sweatNetLbs: 4.0, fluidInL: 0, durationHr: 1 },
  ];
  for (const o of obs) ({ model: m } = observeSweat(m, o));
  const p = predictSweatRate(m, 31);
  assert.ok(p.perDegC > 0, `slope should be positive, got ${p.perDegC}`);
  const cool = predictSweatRate(m, 12).rateLhr;
  const hot = predictSweatRate(m, 31).rateLhr;
  assert.ok(hot > cool, `hot (${hot}) should exceed cool (${cool})`);
});

test('confidence grows with more observations', () => {
  let m1 = makeSweatModel();
  ({ model: m1 } = observeSweat(m1, { tempC: 25, sweatNetLbs: 2, fluidInL: 0.5, durationHr: 1 }));
  let m2 = m1;
  for (let i = 0; i < 5; i++) ({ model: m2 } = observeSweat(m2, { tempC: 25, sweatNetLbs: 2, fluidInL: 0.5, durationHr: 1 }));
  assert.ok(predictSweatRate(m2, 25).confidence > predictSweatRate(m1, 25).confidence);
});

test('predictions are clamped to a plausible band', () => {
  let m = makeSweatModel();
  // extreme single obs; prediction far out of band should clamp into [0.2, 4.0]
  ({ model: m } = observeSweat(m, { tempC: 40, sweatNetLbs: 6, fluidInL: 3, durationHr: 1 }));
  const r = predictSweatRate(m, 40).rateLhr;
  assert.ok(r >= 0.2 && r <= 4.0, `clamped, got ${r}`);
});

test("Emil's hot run use-case routes to a sensible rate", () => {
  // 184.8 → 182.9 fasted-to-post = 1.9 lb net, ~0.9 L drunk during, 8 mi ≈ 1.2 h, 31°C
  let m = makeSweatModel();
  const o = observeSweat(m, { tempC: 31, sweatNetLbs: 1.9, fluidInL: 0.9, durationHr: 1.2, date: '2026-06-06' });
  assert.equal(o.observed, true);
  // gross = 1.9*0.4536 + 0.9 = 1.762 L over 1.2h ≈ 1.47 L/hr
  assert.ok(Math.abs(o.rateLhr - 1.47) < 0.05, `got ${o.rateLhr}`);
});
