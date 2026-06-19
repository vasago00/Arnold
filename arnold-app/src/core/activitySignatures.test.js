// Locks the single signature map (Phase 0.4). Guards the 0.3a dedup.
import { describe, it, expect } from 'vitest';
import { sigSrc, sigFile, SIG_VERSION } from './activitySignatures.js';

describe('activitySignatures — single figure map', () => {
  it('resolves plan-specific keys', () => {
    expect(sigSrc('easy_run')).toBe(`/session-signatures/easy-run.png?${SIG_VERSION}`);
    expect(sigSrc('tempo')).toBe(`/session-signatures/tempo.png?${SIG_VERSION}`);
    expect(sigSrc('intervals')).toBe(`/session-signatures/speed.png?${SIG_VERSION}`);
  });
  it('resolves the new disciplines', () => {
    expect(sigFile('cycle')).toBe('cycle.png');
    expect(sigFile('swim')).toBe('swim.png');
    expect(sigFile('walk')).toBe('walk.png');
    expect(sigFile('ski')).toBe('ski.png');
  });
  it('long_run + run + easy_run all share the easy-run figure', () => {
    expect(sigFile('run')).toBe('easy-run.png');
    expect(sigFile('long_run')).toBe('easy-run.png');
    expect(sigFile('easy_run')).toBe('easy-run.png');
  });
  it('returns null for unknown keys (no silent default)', () => {
    expect(sigSrc('not-a-discipline')).toBe(null);
    expect(sigFile(undefined)).toBe(null);
  });
});
