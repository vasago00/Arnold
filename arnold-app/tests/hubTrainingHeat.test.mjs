// Tests for heat-from-training-runs (core/hub/trainingHeat.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { makeResponseModel, sensitivityOf } from '../src/core/hub/responseModel.js';
import {
  heatObservationFromRun, ingestTrainingHeat, ingestTrainingHeatBatch, predictHeatStrain,
} from '../src/core/hub/trainingHeat.js';

test('cool runs teach nothing about heat', () => {
  assert.equal(heatObservationFromRun({ tempC: 15, avgHR: 150 }, { usualHR: 140 }), null);
  assert.equal(heatObservationFromRun({ tempC: 21, avgHR: 150 }, { usualHR: 140 }), null); // below MIN_HOT_C
});

test('a hot run with no HR elevation is not a heat-cost signal', () => {
  assert.equal(heatObservationFromRun({ tempC: 30, avgHR: 138 }, { usualHR: 140 }), null);
});

test('hot run with elevated HR → heatStrain observation', () => {
  const obs = heatObservationFromRun({ tempC: 30, avgHR: 150 }, { usualHR: 140 });
  assert.ok(obs);
  assert.equal(obs.factors[0].factor, 'heatStrain');
  assert.equal(obs.factors[0].magnitude, 10);                 // 30 − 20 ref
  assert.ok(Math.abs(obs.divergence - 0.0714) < 0.001);       // (150−140)/140
});

test('ingestTrainingHeat learns a positive heatStrain sensitivity', () => {
  let m = makeResponseModel();
  const r = ingestTrainingHeat(m, { tempC: 30, avgHR: 150 }, { usualHR: 140 });
  assert.equal(r.learned, true);
  assert.ok(sensitivityOf(r.model, 'heatStrain').value > 0);
});

test('batch ingest skips cool runs, learns from hot ones', () => {
  const runs = [
    { tempC: 14, avgHR: 150, date: '2026-05-01' }, // cool → skipped
    { tempC: 28, avgHR: 150, date: '2026-05-10' },
    { tempC: 32, avgHR: 156, date: '2026-05-20' },
  ];
  const { model, learned } = ingestTrainingHeatBatch(makeResponseModel(), runs, { usualHR: 140 });
  assert.equal(learned, 2);
  assert.ok(sensitivityOf(model, 'heatStrain').value > 0);
});

test('predictHeatStrain scales with temperature', () => {
  let m = makeResponseModel();
  ({ model: m } = ingestTrainingHeat(m, { tempC: 30, avgHR: 150 }, { usualHR: 140 }));
  const mild = predictHeatStrain(m, 22);
  const hot = predictHeatStrain(m, 32);
  assert.ok(hot.strainPct > mild.strainPct, `${hot.strainPct} should exceed ${mild.strainPct}`);
  assert.ok(hot.perDegC > 0);
  assert.equal(predictHeatStrain(m, 20).strainPct, 0); // at reference temp, no heat cost
});

test("Emil's 31°C run elevates strain sensibly", () => {
  let m = makeResponseModel();
  // a string of hot runs through the summer, HR ~7-10% up
  const runs = [
    { tempC: 28, avgHR: 150, date: '2026-06-01' },
    { tempC: 31, avgHR: 153, date: '2026-06-06' },
    { tempC: 33, avgHR: 156, date: '2026-06-12' },
  ];
  ({ model: m } = ingestTrainingHeatBatch(m, runs, { usualHR: 140 }));
  const p = predictHeatStrain(m, 31);
  assert.ok(p.strainPct > 0 && p.strainPct < 30, `plausible strain %, got ${p.strainPct}`);
  assert.ok(p.perDegC > 0);
});
