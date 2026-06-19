// Locks the shared health-system status color (Phase 3.2 parity helper). Pure →
// the web tile/detail/grid and the mobile tile/grid can't drift on these hexes.
import { describe, it, expect } from 'vitest';
import { healthStatusColor, healthFillTint } from './healthTokens.js';
import { STATUS } from '../../theme/tokens.js';

describe('healthStatusColor — good/focus/def vocabulary', () => {
  it('maps good → STATUS.good (#4ade80)', () => {
    expect(healthStatusColor('good')).toBe(STATUS.good);
    expect(healthStatusColor('good')).toBe('#4ade80');
  });
  it('maps focus → STATUS.warn (#fbbf24)', () => {
    expect(healthStatusColor('focus')).toBe(STATUS.warn);
    expect(healthStatusColor('focus')).toBe('#fbbf24');
  });
  it('maps def (and any unknown) → STATUS.bad (#f87171)', () => {
    expect(healthStatusColor('def')).toBe(STATUS.bad);
    expect(healthStatusColor('whatever')).toBe('#f87171');
  });
});

describe('healthFillTint — reproduces every prior inline value exactly', () => {
  it('web/nutrition tiles (base 0.15): good/focus 0.15, def 0.18', () => {
    expect(healthFillTint('good', 0.15)).toBe('rgba(74,222,128,0.15)');
    expect(healthFillTint('focus', 0.15)).toBe('rgba(251,191,36,0.15)');
    expect(healthFillTint('def', 0.15)).toBe('rgba(248,113,113,0.18)');
  });
  it('mobile tiles (base 0.12): good/focus 0.12, def 0.15 — no float noise', () => {
    expect(healthFillTint('good', 0.12)).toBe('rgba(74,222,128,0.12)');
    expect(healthFillTint('focus', 0.12)).toBe('rgba(251,191,36,0.12)');
    expect(healthFillTint('def', 0.12)).toBe('rgba(248,113,113,0.15)');
  });
});
