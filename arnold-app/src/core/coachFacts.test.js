// Tests for certified facts (roadmap Stage 2). The contract: every beat becomes a typed record with
// provenance, a structural validity window, and a confidence — WITHOUT changing what the composer
// renders. And the certified set becomes the trust boundary coachPhraser.factCheck validates against.
import { describe, it, expect } from 'vitest';
import {
  certifiedFacts, certifyBeat, certifiedNarrative, factValidity, factConfidence, factScope, factsGrounding,
} from './coachFacts.js';
import { narrateSurface, allBeats } from './coachNarrative.js';
import { factCheck } from './coachPhraser.js';

// A rich, realistic context: evening (fuel read live), low EA, a cut, plan + strength, heat model.
const richCtx = (hour = 18) => ({
  clock: { hour },
  today: { primarySession: { type: 'easy_run', label: 'Easy run', loadBearing: false }, trainedToday: false, tdee: 2500, injuryArea: 'knee', readiness: { score: 78, band: 'high' }, tempC: 30 },
  adaptation: null, tomorrow: null,
  goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: { direction: 'cut', observedRateLbPerWk: 0.4, targetLb: 170 } },
  fuel: { protein: { today: 105, target: 153, gap: 48 }, calories: { today: 1613, target: 1980, pct: 1613 / 1980 }, ea: { flag: true, valueKcalPerKg: 26, floor: 30, status: 'low' }, deficitPct: 0.19 },
  plan: { weekMiTarget: 31, weekMiProjected: 31, missed: [], remaining: [{ type: 'easy_run', mi: 5 }], swappedToStrength: false, strengthTarget: 3, strengthDone: 2 },
  learned: { heat: { perUnitPct: 0.63, confidence: 0.84 } }, clinical: {}, memory: {},
});

describe('certifyBeat — a beat becomes a typed, provenance-carrying record', () => {
  it('preserves the claim verbatim and carries data/why/validity/confidence', () => {
    const beat = allBeats(richCtx()).find((b) => b.id === 'reds-lowEA');
    const fact = certifyBeat(beat, richCtx());
    expect(fact.id).toBe('reds-lowEA');
    expect(fact.kind).toBe('reds');
    expect(fact.claim).toBe(beat.claim.text);          // claim UNCHANGED — composer still renders this
    expect(fact.data).toEqual(beat.claim.data);
    expect(fact.why).toBe(beat.why);
    expect(fact.confidence).toBe(1);                   // EA math is a hard deterministic fact
    expect(fact.validity.scope).toBe('today');         // a fuel read is a today-scoped fact
    expect(fact.validity.phase).toBe('training_window'); // hour 18, not trained
  });
});

describe('factValidity — freshness is structural (reads the same phase the generators gate on)', () => {
  it('scope maps by kind: session / today / week / season', () => {
    expect(factScope({ kind: 'purpose' })).toBe('session');
    expect(factScope({ kind: 'reds' })).toBe('today');
    expect(factScope({ kind: 'planImpact' })).toBe('week');
    expect(factScope({ kind: 'clinical' })).toBe('season');
    expect(factScope({ kind: 'context' })).toBe('today');   // fuel-status
  });
  it('validity carries the day.phase for the hour', () => {
    expect(factValidity({ kind: 'context', surfaces: ['fuel'] }, { clock: { hour: 22 } }).phase).toBe('wind_down');
    expect(factValidity({ kind: 'context', surfaces: ['fuel'] }, { clock: { hour: 8 } }).phase).toBe('morning');
  });
});

describe('factConfidence — hard facts certain, learned facts carry model confidence', () => {
  it('deterministic math is 1; learned-heat inherits the model; inferences sit below', () => {
    expect(factConfidence({ id: 'fuel-status', kind: 'context' }, {})).toBe(1);
    expect(factConfidence({ id: 'reds-lowEA', kind: 'reds' }, {})).toBe(1);
    expect(factConfidence({ id: 'learned-heat', kind: 'learned' }, { learned: { heat: { confidence: 0.84 } } })).toBe(0.84);
    expect(factConfidence({ id: 'readiness-adapt', kind: 'readiness' }, {})).toBe(0.9);
    expect(factConfidence({ id: 'cut-divergence', kind: 'divergence' }, {})).toBe(0.8);
  });
});

describe('certifiedNarrative — additive: composer output is byte-identical', () => {
  it('text/tone/beats match narrateSurface exactly; facts + grounding are added', () => {
    for (const surface of ['daily', 'fuel', 'play', 'plan']) {
      const plain = narrateSurface(richCtx(), surface);
      const cert = certifiedNarrative(richCtx(), surface);
      if (!plain) { expect(cert).toBe(null); continue; }
      expect(cert.text).toBe(plain.text);              // GOLDEN: rendering unchanged
      expect(cert.tone).toBe(plain.tone);
      expect(cert.beats).toEqual(plain.beats);
      expect(Array.isArray(cert.facts)).toBe(true);
      expect(cert.facts.length).toBe(plain.beats.length);   // one certified fact per selected beat
      expect(cert.facts.every((f) => f.confidence >= 0 && f.confidence <= 1)).toBe(true);
    }
  });
});

describe('the trust boundary — certified facts ground factCheck (output ⊆ facts)', () => {
  it('the composed text passes factCheck against its own certified grounding', () => {
    const cert = certifiedNarrative(richCtx(), 'daily');
    const fc = factCheck(cert.text, cert.grounding);
    expect(fc.ok, JSON.stringify(fc)).toBe(true);          // every number/entity said is a certified fact
  });
  it('grounding admits certified facts and rejects an invented number/entity', () => {
    const cert = certifiedNarrative(richCtx(), 'daily');   // RED-S leads → certifies "Valencia" + EA 26
    // A rephrase that only uses certified numbers/entities is accepted...
    expect(factCheck('You are on line for Valencia at 26 kcal/kg.', cert.grounding).ok).toBe(true);
    // ...but a fabricated race or figure is caught.
    expect(factCheck('You are on line for Berlin.', cert.grounding).ok).toBe(false);
    expect(factCheck('Energy availability is 9 kcal/kg.', cert.grounding).ok).toBe(false);
  });
});
