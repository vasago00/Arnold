// Tests for the energy-expenditure source selectors (Coach Unification — Slice 2).
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { pickExpenditure, pickMaintenance } from '../core/energyExpenditure.js';

test("pickExpenditure: a real device total beats the model (today's burn)", () => {
  const r = pickExpenditure({ deviceTdee: 2180, modelTdee: 2050 });
  assert.equal(r.source, 'device');
  assert.equal(r.value, 2180);
  assert.equal(r.confidence, 'medium');
});

test('pickExpenditure: no device total → model, low confidence', () => {
  const r = pickExpenditure({ deviceTdee: null, modelTdee: 2050 });
  assert.equal(r.source, 'model');
  assert.equal(r.value, 2050);
  assert.equal(r.confidence, 'low');
});

test('pickExpenditure: a zero/blank device total never wins', () => {
  assert.equal(pickExpenditure({ deviceTdee: 0, modelTdee: 1990 }).source, 'model');
});

test('pickMaintenance: confident empirical is ground truth', () => {
  const r = pickMaintenance({ expenditureTdee: 2180, empirical: 2300, empConfidence: 'high' });
  assert.equal(r.source, 'empirical');
  assert.equal(r.value, 2300);
  assert.equal(r.confidence, 'high');
});

test('pickMaintenance: medium-confidence empirical still wins', () => {
  assert.equal(pickMaintenance({ expenditureTdee: 2180, empirical: 2250, empConfidence: 'medium' }).source, 'empirical');
});

test('pickMaintenance: insufficient/absent empirical → falls back to expenditure', () => {
  assert.equal(pickMaintenance({ expenditureTdee: 2180, empirical: null, empConfidence: 'insufficient' }).source, 'expenditure');
  assert.equal(pickMaintenance({ expenditureTdee: 2180, empirical: 2300, empConfidence: 'insufficient' }).value, 2180);
});
