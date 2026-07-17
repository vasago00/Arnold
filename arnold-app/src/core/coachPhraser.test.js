// Unit tests for the Phase-H phraser seam: fact-check (output ⊆ facts) + the always-safe fallback.
import { describe, it, expect } from 'vitest';
import { factCheck, phraseNarrative } from './coachPhraser.js';

const SRC = "Energy availability (26 kcal/kg FFM) is under the RED-S floor. Add fuel around today's work before anything else. Still on line for Valencia (120d out).";

describe('factCheck (output ⊆ facts)', () => {
  it('accepts a faithful paraphrase (same numbers + entities, reworded)', () => {
    const cand = "You're at 26 kcal/kg FFM — under the RED-S floor. Fuel around today's work first. Valencia is still on (120d out).";
    expect(factCheck(cand, SRC).ok).toBe(true);
  });
  it('accepts DROPPING facts (a shorter summary is fine)', () => {
    expect(factCheck("Energy availability is under the RED-S floor — fuel first.", SRC).ok).toBe(true);
  });
  it('rejects an invented NUMBER', () => {
    const fc = factCheck("EA is 26 kcal/kg, about 4 points under the floor.", SRC);
    expect(fc.ok).toBe(false);
    expect(fc.leakedNumbers).toContain('4');
  });
  it('rejects an invented ENTITY (the Berlin-vs-Valencia class)', () => {
    const fc = factCheck("Under the RED-S floor — still on line for Berlin.", SRC);
    expect(fc.ok).toBe(false);
    expect(fc.leakedEntities).toContain('Berlin');
  });
  it('does not flag sentence-initial capitals or known acronyms in source', () => {
    expect(factCheck("Fuel first. You are under the floor. FFM matters.", SRC).ok).toBe(true);
  });
});

describe('phraseNarrative (always-safe fallback)', () => {
  it('passes through unchanged when no phraser is provided', async () => {
    const r = await phraseNarrative(SRC, {});
    expect(r.text).toBe(SRC);
    expect(r.phrased).toBe(false);
  });
  it('uses a faithful phrasing', async () => {
    const phraser = () => "You're at 26 kcal/kg FFM — under the RED-S floor. Fuel today's work first. Valencia's still on (120d out).";
    const r = await phraseNarrative(SRC, { phraser });
    expect(r.phrased).toBe(true);
    expect(r.text).toMatch(/Fuel today's work first/);
  });
  it('rejects and falls back when the phrasing invents a fact', async () => {
    const r = await phraseNarrative(SRC, { phraser: () => "Under the floor — still on line for Berlin." });
    expect(r.phrased).toBe(false);
    expect(r.text).toBe(SRC);
    expect(r.rejected).toBe('unsourced');
  });
  it('falls back when the phraser throws / returns empty / balloons', async () => {
    expect((await phraseNarrative(SRC, { phraser: () => { throw new Error('x'); } })).rejected).toBe('threw');
    expect((await phraseNarrative(SRC, { phraser: () => '' })).rejected).toBe('empty');
    expect((await phraseNarrative(SRC, { phraser: () => SRC + ' ' + SRC + ' ' + SRC })).rejected).toBe('too-long');
  });
  it('awaits an async phraser', async () => {
    const r = await phraseNarrative(SRC, { phraser: async () => 'Energy availability under the RED-S floor — fuel first.' });
    expect(r.phrased).toBe(true);
  });
});
