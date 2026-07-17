// Tests for injury awareness (selective aggravation).
import { describe, it, expect } from 'vitest';
import { sessionAggravatesInjury, injuryNote, injuryLabel } from './injury.js';

describe('sessionAggravatesInjury', () => {
  it('knee: aggravates speed/tempo, tolerates easy & long', () => {
    expect(sessionAggravatesInjury('tempo', 'knee')).toBe(true);
    expect(sessionAggravatesInjury('intervals', 'knee')).toBe(true);
    expect(sessionAggravatesInjury('easy_run', 'knee')).toBe(false);   // the key nuance
    expect(sessionAggravatesInjury('long_run', 'knee')).toBe(false);
  });
  it('IT band aggravates long runs; shin aggravates impact', () => {
    expect(sessionAggravatesInjury('long_run', 'itb')).toBe(true);
    expect(sessionAggravatesInjury('easy_run', 'itb')).toBe(false);
    expect(sessionAggravatesInjury('intervals', 'shin')).toBe(true);
  });
  it('upper-body injuries do NOT restrict running (recorded only)', () => {
    expect(sessionAggravatesInjury('tempo', 'shoulder')).toBe(false);
    expect(sessionAggravatesInjury('intervals', 'neck')).toBe(false);
    expect(sessionAggravatesInjury('long_run', 'arm')).toBe(false);
    expect(injuryLabel('shoulder')).toBe('Shoulder');
  });
  it('unknown area or no type → false', () => {
    expect(sessionAggravatesInjury('tempo', 'nonsense')).toBe(false);
    expect(sessionAggravatesInjury(null, 'knee')).toBe(false);
  });
});

describe('injuryNote', () => {
  it('protects an aggravating session, reassures on a tolerated one', () => {
    expect(injuryNote('knee', 'tempo')).toMatch(/Protecting your knee/);
    expect(injuryNote('knee', 'easy_run')).toMatch(/tolerates this/);
  });
  it('injuryLabel resolves', () => {
    expect(injuryLabel('itb')).toBe('IT band');
    expect(injuryLabel('nope')).toBe(null);
  });
});
