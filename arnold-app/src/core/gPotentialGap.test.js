// Behaviour tests for the aerobic-ceiling coach voice (gPotentialGap), exercised through the real narrative
// engine. The guarantees: it speaks the engine-vs-legs upside on strategic surfaces, names the lever, NEVER
// presents the ceiling as the prediction, and stays quiet when there's nothing actionable (the anti-lingering
// discipline) or the VO2max evidence is too weak to trust.
import { describe, it, expect } from 'vitest';
import { narrateSurface } from './coachNarrative.js';

const gap = (over = {}) => ({
  measuredVo2: 47, raceVdot: 41, gapVdot: 6, magnitude: 'large', lever: 'economy+threshold',
  confidence: 0.7, source: 'api', currentStr: '3:55:46', ceilingStr: '3:30:27', reachStr: '3:46:12', gapStr: '25:19', ...over,
});
const ctx = (potentialGap) => ({ clock: { hour: 10 }, today: {}, potentialGap });

describe('gPotentialGap speaks the upside without ever faking the prediction', () => {
  it('a large gap surfaces on plan/edgeiq/play with the engine, the lever, and the ceiling', () => {
    for (const surface of ['plan', 'edgeiq', 'play']) {
      const out = narrateSurface(ctx(gap()), surface);
      expect(out?.text).toBeTruthy();
      expect(out.text).toMatch(/VO₂max 47/);
      expect(out.text).toMatch(/threshold/i);       // names the lever
      expect(out.text).toMatch(/3:30:27/);           // the ceiling, clearly framed as "if it converts"
      expect(out.text).toMatch(/ceiling|upside/i);
    }
  });
  it('stays off the daily "start" surface (that\'s readiness, not strategy)', () => {
    expect(narrateSurface(ctx(gap()), 'start')?.text || '').not.toMatch(/VO₂max/);
  });
});

describe('the anti-lingering discipline — quiet when nothing is actionable', () => {
  it('a small / at-ceiling gap produces no line', () => {
    expect(narrateSurface(ctx(gap({ magnitude: 'small', lever: 'sharpening', gapVdot: 1 })), 'plan')).toBeFalsy();
    expect(narrateSurface(ctx(gap({ magnitude: 'none', lever: 'at-ceiling', gapVdot: 0.3 })), 'plan')).toBeFalsy();
  });
  it('low-confidence VO2max is suppressed (weak evidence never lectures)', () => {
    expect(narrateSurface(ctx(gap({ confidence: 0.3 })), 'plan')).toBeFalsy();
  });
  it('no potentialGap in context → nothing', () => {
    expect(narrateSurface(ctx(undefined), 'plan')).toBeFalsy();
  });
});

describe('data-hygiene branch', () => {
  it('racing above the measured VO2max prompts a re-test rather than a bogus upside', () => {
    const out = narrateSurface(ctx(gap({ magnitude: 'inverted', lever: 'retest', gapVdot: -2, measuredVo2: 39 })), 'plan');
    expect(out?.text).toMatch(/re-?test|recalibrate/i);
  });
});
