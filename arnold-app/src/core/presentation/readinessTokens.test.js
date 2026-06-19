// Locks the shared readiness verdict/ring mapping (Phase 3.1 parity helper).
// Pure → verifiable without UI. Keeps the web Daily hero and mobile Play hero
// from ever drifting on the "one read".
import { describe, it, expect } from 'vitest';
import { ringColor, readinessVerdict } from './readinessTokens.js';

describe('readinessVerdict — score → the one read', () => {
  it('greenlights a strong score', () => {
    expect(readinessVerdict(82)).toEqual({ word: 'Go strong', color: '#4ade80' });
  });
  it('steadies a mid score', () => {
    expect(readinessVerdict(60)).toEqual({ word: 'Go steady', color: '#fbbf24' });
  });
  it('dials back a low score', () => {
    expect(readinessVerdict(30)).toEqual({ word: 'Dial back', color: '#f87171' });
  });
  it('hides the line on an empty day (score 0 or null)', () => {
    expect(readinessVerdict(0).word).toBe(null);
    expect(readinessVerdict(null).word).toBe(null);
  });
  it('uses the SAME 70/45 bands as the ring color', () => {
    // The whole point: word color must equal the ring color at every threshold.
    for (const s of [95, 70, 69, 45, 44, 1]) {
      expect(readinessVerdict(s).color).toBe(ringColor(s));
    }
  });
});
