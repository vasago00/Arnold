// Hub — body/hydration signal routing: the same scale reading means different
// things by context, and the hub routes each to the right ledger. Models Emil's
// real day: 188 (yesterday) -> 184.5 (fasted AM) -> 182.9 (post-run, 31C).
//
// Run with:  node arnold-app/tests/hubBody.test.mjs
// Exit code: 0 on pass, 1 on any failure.

import assert from 'node:assert/strict';
import { classifyWeighIn, makeBodyModel, recordWeighIn, bodyWeight, fluctuationBand } from '../src/core/hub/bodyModel.js';

let passed = 0;
const approx = (a, b, tol = 0.1, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

test('classifyWeighIn: fasted morning vs post-activity vs other vs explicit', () => {
  assert.equal(classifyWeighIn({ weightLbs: 184.5, hour: 7 }), 'fasted-am');
  assert.equal(classifyWeighIn({ weightLbs: 182.9, hour: 9, sinceRunHours: 1 }), 'post-activity', 'just off a run = dehydrated');
  assert.equal(classifyWeighIn({ weightLbs: 185, hour: 15 }), 'other');
  assert.equal(classifyWeighIn({ weightLbs: 185, hour: 7, context: 'post-activity' }), 'post-activity', 'explicit wins');
});

test("Emil's day: overnight drop is fluid, post-run drop is sweat, trend stays put", () => {
  let m = makeBodyModel();

  // yesterday, fasted
  let r = recordWeighIn(m, { weightLbs: 188, date: '2026-06-05', hour: 7 });
  m = r.model;
  assert.equal(r.routed, 'body');

  // this morning, fasted → overnight -3.5 lb routed as a fluid/glycogen signal, NOT fat
  r = recordWeighIn(m, { weightLbs: 184.5, date: '2026-06-06', hour: 7 });
  m = r.model;
  assert.equal(r.routed, 'body');
  approx(r.overnight.deltaLbs, -3.5, 0.01, 'overnight delta');
  // the smoothed TREND resists the single-day swing — it is NOT 184.5
  const trendAfterAM = bodyWeight(m).value;
  assert.ok(trendAfterAM > 185.5 && trendAfterAM < 187, `denoised trend ~186, got ${trendAfterAM}`);

  // post-run, 31C → dehydrated read: routed to HYDRATION, body trend UNCHANGED
  r = recordWeighIn(m, { weightLbs: 182.9, date: '2026-06-06', hour: 9, sinceRunHours: 1 });
  assert.equal(r.routed, 'hydration');
  approx(r.hydration.sweatNetLbs, 1.6, 0.01, 'net sweat vs fasted');
  approx(bodyWeight(r.model).value, trendAfterAM, 0.001, 'post-run read did NOT move the body trend');
});

test('the dehydrated reading never pollutes the trend even if logged naively', () => {
  let m = makeBodyModel();
  m = recordWeighIn(m, { weightLbs: 184.5, date: '2026-06-06', hour: 7 }).model; // trend 184.5
  const before = bodyWeight(m).value;
  const r = recordWeighIn(m, { weightLbs: 182.9, date: '2026-06-06', sinceRunHours: 1 });
  assert.equal(r.routed, 'hydration');
  approx(bodyWeight(r.model).value, before, 0.001, 'trend untouched by post-run weigh-in');
});

test('fluctuation band learns the personal daily swing', () => {
  let m = makeBodyModel();
  for (const [lb, d] of [[188, '2026-06-01'], [184.5, '2026-06-02'], [186, '2026-06-03']]) {
    m = recordWeighIn(m, { weightLbs: lb, date: d, hour: 7 }).model;
  }
  const band = fluctuationBand(m);
  assert.equal(band.n, 2, 'two overnight deltas');
  approx(band.meanAbsLbs, 2.5, 0.01, 'mean |overnight delta| (3.5 and 1.5)');
});

test('a midday (other) weigh-in is ignored for the trend', () => {
  let m = makeBodyModel();
  m = recordWeighIn(m, { weightLbs: 185, date: '2026-06-06', hour: 7 }).model;
  const before = bodyWeight(m).value;
  const r = recordWeighIn(m, { weightLbs: 183, date: '2026-06-06', hour: 15 });
  assert.equal(r.routed, 'other');
  approx(bodyWeight(r.model).value, before, 0.001, 'midday read ignored for trend');
});

console.log(`\nhubBody: ${passed} tests passed`);
