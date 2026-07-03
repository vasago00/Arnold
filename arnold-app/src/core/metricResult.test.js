// Golden failure-matrix tests for the data-integrity contract (DATA_INTEGRITY_PLAN
// Phase 3). These lock the ONE place the zero-vs-missing decision lives. The
// "Fuel 92% with no food" hallucination is the named regression each scorer that
// routes through here must never reproduce.
import { describe, it, expect } from 'vitest';
import { result, isUsable, scoreAdherence, combineDomain } from './metricResult.js';

describe('scoreAdherence — zero vs missing (the decision that fabricated the bug)', () => {
  it('a REAL logged zero scores LOW (status ok, value 0) — never skipped', () => {
    expect(scoreAdherence(0, 2000, { expected: true })).toEqual({ value: 0, status: 'ok' });
  });
  it('missing + EXPECTED → gap (do not score)', () => {
    expect(scoreAdherence(null, 2000, { expected: true })).toEqual({ value: null, status: 'gap' });
    expect(scoreAdherence(undefined, 2000, { expected: true })).toEqual({ value: null, status: 'gap' });
    expect(scoreAdherence(NaN, 2000, { expected: true })).toEqual({ value: null, status: 'gap' });
  });
  it('missing + NOT expected → not-tracked (omit silently)', () => {
    expect(scoreAdherence(null, 2000, { expected: false })).toEqual({ value: null, status: 'not-tracked' });
  });
  it('no/zero target → no-target (can\'t compute adherence)', () => {
    expect(scoreAdherence(1500, 0)).toEqual({ value: null, status: 'no-target' });
    expect(scoreAdherence(1500, null)).toEqual({ value: null, status: 'no-target' });
  });
  it('normal intake → clipped ratio', () => {
    expect(scoreAdherence(1000, 2000)).toEqual({ value: 0.5, status: 'ok' });
    expect(scoreAdherence(2400, 2000, { cap: 1.1 }).value).toBe(1.1); // capped
    expect(scoreAdherence(2400, 2000, { cap: 1.2 }).value).toBe(1.2);
  });
});

describe('combineDomain — composites stay honest about completeness', () => {
  it('THE BUG: food=0 (real) + water logged must score LOW, NOT ~0.92 from water alone', () => {
    const dom = combineDomain([
      { w: 0.50, r: scoreAdherence(0, 2077, { expected: true }) },   // calories: real 0
      { w: 0.35, r: scoreAdherence(0, 170,  { expected: true }) },   // protein:  real 0
      { w: 0.15, r: scoreAdherence(2.75, 3, { expected: true }) },   // hydration
    ]);
    expect(dom.status).toBe('ok');
    expect(dom.value).toBeLessThan(0.2);   // ~0.14, never 0.92
  });
  it('all factors missing → no-data (never a fabricated number)', () => {
    const dom = combineDomain([
      { w: 0.5, r: scoreAdherence(null, 2000, { expected: true }) },
      { w: 0.5, r: scoreAdherence(null, 170,  { expected: true }) },
    ]);
    expect(dom).toEqual({ value: null, status: 'no-data' });
  });
  it('some present + an EXPECTED gap → partial (flag incompleteness)', () => {
    const dom = combineDomain([
      { w: 0.5, r: scoreAdherence(1000, 2000, { expected: true }) }, // ok
      { w: 0.5, r: scoreAdherence(null, 170,  { expected: true }) }, // gap
    ]);
    expect(dom.status).toBe('partial');
    expect(dom.value).toBe(0.5);   // only the present factor contributes
  });
  it('not-tracked factors are excluded without marking partial', () => {
    const dom = combineDomain([
      { w: 0.5, r: scoreAdherence(1000, 2000, { expected: true }) },  // ok
      { w: 0.5, r: scoreAdherence(null, 170,  { expected: false }) }, // not-tracked
    ]);
    expect(dom.status).toBe('ok');
    expect(dom.value).toBe(0.5);
  });
  it('a full on-target day scores high', () => {
    const dom = combineDomain([
      { w: 0.50, r: scoreAdherence(2050, 2077, { expected: true, cap: 1.1 }) },
      { w: 0.35, r: scoreAdherence(165,  170,  { expected: true, cap: 1.1 }) },
      { w: 0.15, r: scoreAdherence(2.8,  3,    { expected: true, cap: 1.1 }) },
    ]);
    expect(dom.status).toBe('ok');
    expect(dom.value).toBeGreaterThan(0.9);
  });
});

describe('isUsable', () => {
  it('true only for ok results with a value', () => {
    expect(isUsable(result(0.5, 'ok'))).toBe(true);
    expect(isUsable(result(0, 'ok'))).toBe(true);
    expect(isUsable(result(null, 'gap'))).toBe(false);
    expect(isUsable(result(null, 'no-data'))).toBe(false);
    expect(isUsable(null)).toBe(false);
  });
});
