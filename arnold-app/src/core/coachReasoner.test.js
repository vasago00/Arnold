// Tests for the reasoner seam (roadmap Stage 3). The whole safety story is here: a model may improve
// phrasing but can NEVER make the coach say something untrue, and any failure degrades to the correct
// deterministic voice. Proven with mock reasoners so it's green before a real model exists.
import { describe, it, expect } from 'vitest';
import { reasonNarrative, verifyCandidate, reasonCacheKey, REASONER_CONTRACT } from './coachReasoner.js';

// A certified narrative fixture: the deterministic draft + its grounding (what factCheck validates against).
const certified = () => ({
  surface: 'daily',
  text: 'Energy availability (24 kcal/kg FFM) is under the RED-S floor. Add fuel around today\'s work before Valencia.',
  tone: 'corrective',
  beats: [{ id: 'reds-lowEA', kind: 'reds', why: 'EA' }],
  facts: [{ id: 'reds-lowEA', kind: 'reds', claim: 'EA 24 kcal/kg under floor', data: { ea: 24 } }],
  grounding: 'Energy availability (24 kcal/kg FFM) is under the RED-S floor. Add fuel around today\'s work before Valencia. · 24',
});

describe('no reasoner → deterministic passthrough (today\'s behaviour exactly)', () => {
  it('returns the composer text, tagged deterministic', async () => {
    const r = await reasonNarrative(certified(), {});
    expect(r.source).toBe('deterministic');
    expect(r.text).toBe(certified().text);
  });
});

describe('a faithful rewrite is accepted', () => {
  it('reorders/warms using only certified facts → source=reasoner', async () => {
    const reasoner = () => 'Heads up: your energy availability is 24 kcal/kg FFM, under the RED-S floor — get fuel in around today\'s work for Valencia.';
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('reasoner');
    expect(r.text).toMatch(/24 kcal\/kg/);
  });
});

describe('the verifier blocks unfaithful rewrites → deterministic fallback', () => {
  it('an invented NUMBER is rejected', async () => {
    const reasoner = () => 'Energy availability is 9 kcal/kg — under the floor.';   // 9 not in grounding
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('unsourced');
  });
  it('an invented ENTITY (wrong race) is rejected', async () => {
    const reasoner = () => 'Add fuel around today\'s work before Berlin.';          // Berlin not in grounding
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('unsourced');
  });
  it('a FLIPPED corrective claim is rejected', async () => {
    const reasoner = () => 'Energy availability is 24 kcal/kg FFM — you\'re fine, nothing to worry about.';
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('flipped');
  });
  it('an empty rewrite falls back', async () => {
    const r = await reasonNarrative(certified(), { reasoner: () => '   ' });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('empty');
  });
  it('a ballooning rewrite falls back', async () => {
    const r = await reasonNarrative(certified(), { reasoner: () => certified().text + ' '.repeat(5) + 'x'.repeat(400) });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('too-long');
  });
  it('a THROWING reasoner falls back safely', async () => {
    const r = await reasonNarrative(certified(), { reasoner: () => { throw new Error('model oom'); } });
    expect(r.source).toBe('deterministic');
    expect(r.rejected).toBe('threw');
  });
  it('an async reasoner is awaited', async () => {
    const reasoner = async () => 'EA 24 kcal/kg FFM is under the RED-S floor; fuel up for Valencia.';
    const r = await reasonNarrative(certified(), { reasoner });
    expect(r.source).toBe('reasoner');
  });
});

describe('caching — the model runs at most once per meaningful change', () => {
  it('a second call with the same facts is served from cache (no re-run)', async () => {
    const cache = new Map();
    let calls = 0;
    const reasoner = () => { calls += 1; return 'EA 24 kcal/kg FFM under the RED-S floor — fuel up for Valencia.'; };
    const a = await reasonNarrative(certified(), { reasoner, cache });
    const b = await reasonNarrative(certified(), { reasoner, cache });
    expect(calls).toBe(1);
    expect(b.cached).toBe(true);
    expect(b.text).toBe(a.text);
  });
  it('the cache key changes with the stamp (a new day recomputes)', () => {
    expect(reasonCacheKey(certified(), '2026-07-17')).not.toBe(reasonCacheKey(certified(), '2026-07-18'));
  });
});

describe('verifyCandidate — the pure reflect pass', () => {
  it('passes a sourced, bounded, non-flipped candidate', () => {
    expect(verifyCandidate('EA is 24 kcal/kg, under the floor — fuel for Valencia.', certified()).ok).toBe(true);
  });
  it('exposes the contract for the future model', () => {
    expect(REASONER_CONTRACT).toMatch(/MUST NOT/);
    expect(REASONER_CONTRACT).toMatch(/never flip a claim/i);
  });
});
