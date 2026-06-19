// Tests for hub → Coach insights (core/hub/coachInsights.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import { heatInsight, hubCoachInsights } from '../src/core/hub/coachInsights.js';

const factsHeat = { responses: [{ factor: 'heatStrain', perUnitPct: 1.35, confidence: 0.76 }] };

test('no heat insight on a cool day', () => {
  assert.equal(heatInsight(factsHeat, 15), null);
  assert.equal(heatInsight(factsHeat, 23), null); // below the 24°C threshold
});

test('hot day + learned heat sensitivity → a heat clause with the right magnitude', () => {
  const h = heatInsight(factsHeat, 31);          // 1.35 %/°C × (31−20) ≈ 15%
  assert.ok(h, 'should produce an insight');
  assert.equal(h.kind, 'heat');
  assert.match(h.text, /15% more cardiac strain/);
  assert.match(h.text, /31°C/);
});

test('low-confidence sensitivity is not spoken', () => {
  const shaky = { responses: [{ factor: 'heatStrain', perUnitPct: 1.35, confidence: 0.2 }] };
  assert.equal(heatInsight(shaky, 31), null);
});

test('no learned heat sensitivity → silent even on a hot day', () => {
  assert.equal(heatInsight({ responses: [] }, 33), null);
  assert.equal(heatInsight(null, 33), null);
});

test('hubCoachInsights aggregates (heat present)', () => {
  const out = hubCoachInsights(factsHeat, { tempC: 30 });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'heat');
  assert.equal(hubCoachInsights(factsHeat, { tempC: 12 }).length, 0);
});
