// Tests for the reasoner adapter (Stage 3 spike). Proves the prompt carries exactly the certified
// facts + the draft, and that a wrapped model plugs into reasonNarrative's safety boundary — a
// faithful rewrite is accepted, a hallucinated one is rejected back to the deterministic voice.
import { describe, it, expect } from 'vitest';
import { buildReasonerPrompt, makeReasoner } from './coachReasonerAdapter.js';
import { reasonNarrative } from './coachReasoner.js';

const certified = () => ({
  surface: 'daily',
  text: 'Energy availability (24 kcal/kg FFM) is under the RED-S floor. Add fuel before Valencia.',
  tone: 'corrective',
  facts: [
    { id: 'reds-lowEA', claim: 'Energy availability (24 kcal/kg FFM) is under the RED-S floor.', data: { ea: 24 } },
    { id: 'goal', claim: 'You are building toward Valencia.', data: {} },
  ],
  grounding: 'Energy availability (24 kcal/kg FFM) is under the RED-S floor. Add fuel before Valencia. · 24 · Valencia',
});

describe('buildReasonerPrompt', () => {
  it('lists the certified facts and the draft, with the contract as system', () => {
    const { system, user } = buildReasonerPrompt(certified());
    expect(system).toMatch(/MUST NOT/);                          // the phrasing contract
    expect(user).toMatch(/24 kcal\/kg FFM/);                     // fact 1
    expect(user).toMatch(/building toward Valencia/);            // fact 2
    expect(user).toMatch(/DRAFT to rewrite/);
    expect(user).toMatch(/ONLY the facts above/);
  });
  it('falls back to the draft when no structured facts are attached', () => {
    const { user } = buildReasonerPrompt({ text: 'Some draft.', tone: 'neutral' });
    expect(user).toMatch(/Some draft\./);
  });
});

describe('makeReasoner — wraps a model generate() into a safe reasoner', () => {
  it('a faithful rewrite passes the boundary (source=reasoner)', async () => {
    const generate = async () => 'Heads up — your energy availability is 24 kcal/kg FFM, under the RED-S floor; get fuel in before Valencia.';
    const reasoner = makeReasoner(generate);
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('reasoner');
    expect(r.text).toMatch(/24 kcal\/kg/);
  });
  it('a hallucinated rewrite is rejected → deterministic fallback', async () => {
    const generate = async () => 'Your energy availability is 9 kcal/kg — head to Berlin.';   // 9 + Berlin invented
    const r = await reasonNarrative(certified(), { reasoner: makeReasoner(generate) });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('unsourced');
  });
  it('a model that throws falls back safely', async () => {
    const r = await reasonNarrative(certified(), { reasoner: makeReasoner(() => { throw new Error('oom'); }) });
    expect(r.source).toBe('deterministic');
  });
  it('returns null for a non-function generate (no reasoner → deterministic upstream)', () => {
    expect(makeReasoner(null)).toBe(null);
  });
});
