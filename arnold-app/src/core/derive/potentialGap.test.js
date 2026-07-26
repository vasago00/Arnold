// Tests for the aerobic-ceiling / potential-gap signal. The invariants ENFORCE the discipline: the ceiling is a
// separate labelled marker (never the prediction), it stays apples-to-apples with the faded finish, and the gap
// reads out the real coaching lever. Emil's own numbers (race VDOT ~41, measured VO2max ~47–51) are the fixture.
import { describe, it, expect } from 'vitest';
import { computePotentialGap, readMeasuredVo2 } from './potentialGap.js';

const MARA = 42.195;

describe("the engine-vs-legs gap reads out of Emil's real numbers", () => {
  it('VDOT 41 races + VO2max 47 → a ~6-point gap, economy+threshold lever, ceiling faster than current', () => {
    const g = computePotentialGap({ measuredVo2: 47, source: 'api', raceVdot: 41, distanceKm: MARA });
    expect(g.gapVdot).toBeCloseTo(6, 1);
    expect(g.lever).toBe('economy+threshold');
    expect(g.magnitude).toBe('large');
    expect(g.ceilingSecs).toBeLessThan(g.currentSecs);   // the engine is ahead of the legs
    expect(g.reachSecs).toBeLessThan(g.currentSecs);       // realistic reach improves on today
    expect(g.reachSecs).toBeGreaterThan(g.ceilingSecs);    // ...but never beats the theoretical ceiling
    expect(g.gapSecs).toBeGreaterThan(0);
  });

  it('never lets the measured engine masquerade as the prediction (ceiling ≠ current)', () => {
    const g = computePotentialGap({ measuredVo2: 47, raceVdot: 41, distanceKm: MARA });
    expect(g.currentSecs).not.toBe(g.ceilingSecs);
    expect(Math.abs(g.currentSecs - g.ceilingSecs)).toBeGreaterThan(60);
  });
});

describe('apples-to-apples with the displayed (faded) finish', () => {
  it('when the anchored finish is passed, current matches it and the SAME fade hits the ceiling', () => {
    const anchored = 3 * 3600 + 55 * 60 + 46;   // 3:55:46, the faded marathon prediction
    const g = computePotentialGap({ measuredVo2: 47, raceVdot: 41, distanceKm: MARA, currentSecsOverride: anchored });
    expect(g.currentSecs).toBe(anchored);              // shows exactly what the user sees
    expect(g.fade).toBeGreaterThan(1.0);               // a real marathon fade was backed out
    // the ceiling carries the same fade → the gap is the true marathon upside, not an unfaded artefact
    expect(g.ceilingSecs).toBeGreaterThan(3 * 3600 + 25 * 60);
    expect(g.ceilingSecs).toBeLessThan(g.currentSecs);
  });
});

describe('the lever is graded honestly by gap size', () => {
  it('a small gap → sharpening; engine≈legs → build VO2max; racing above the reading → retest', () => {
    expect(computePotentialGap({ measuredVo2: 42, raceVdot: 41, distanceKm: MARA }).lever).toBe('sharpening');
    expect(computePotentialGap({ measuredVo2: 41.2, raceVdot: 41, distanceKm: MARA }).lever).toBe('at-ceiling');
    expect(computePotentialGap({ measuredVo2: 38, raceVdot: 41, distanceKm: MARA }).lever).toBe('retest');
  });
});

describe('confidence reflects source quality and age', () => {
  it('a fresh lab test outranks an old one and a noisy activity estimate', () => {
    const freshLab = computePotentialGap({ measuredVo2: 51, source: 'lab', vo2Date: '2026-07-01', raceVdot: 41, distanceKm: MARA, today: '2026-07-19' });
    const oldLab = computePotentialGap({ measuredVo2: 51, source: 'lab', vo2Date: '2025-03-20', raceVdot: 41, distanceKm: MARA, today: '2026-07-19' });
    const act = computePotentialGap({ measuredVo2: 47, source: 'activity', vo2Date: '2026-07-01', raceVdot: 41, distanceKm: MARA, today: '2026-07-19' });
    expect(freshLab.confidence).toBeGreaterThan(oldLab.confidence);   // age decay
    expect(freshLab.confidence).toBeGreaterThan(act.confidence);      // source quality
  });
});

describe('readMeasuredVo2 honours the priority chain', () => {
  const stor = (map) => ({ get: (k) => map[k] });
  it('manual override wins over api / activity / lab', () => {
    const r = readMeasuredVo2({ storage: stor({ profile: { watchVO2Max: 47, watchVO2MaxAt: '2026-07-10' }, wellness: [{ date: '2026-07-12', garminWatchVO2Max: 46 }] }), activities: [{ date: '2026-07-15', vO2MaxValue: 45 }], clinicalTests: [{ type: 'vo2max', date: '2025-03-20', metrics: { vo2max: 51 } }] });
    expect(r.source).toBe('manual'); expect(r.value).toBe(47);
  });
  it('falls through to the lab test when nothing else is present', () => {
    const r = readMeasuredVo2({ storage: stor({ profile: {}, wellness: [] }), activities: [], clinicalTests: [{ type: 'vo2max', date: '2025-03-20', metrics: { vo2max: 51 } }] });
    expect(r.source).toBe('lab'); expect(r.value).toBe(51);
  });
  it('returns null when there is no VO2max anywhere', () => {
    expect(readMeasuredVo2({ storage: stor({ profile: {}, wellness: [] }), activities: [], clinicalTests: [] })).toBeNull();
  });
});

describe('guards', () => {
  it('null on missing inputs', () => {
    expect(computePotentialGap({ measuredVo2: 47, distanceKm: MARA })).toBeNull();   // no raceVdot
    expect(computePotentialGap({ raceVdot: 41, distanceKm: MARA })).toBeNull();       // no measuredVo2
    expect(computePotentialGap({ measuredVo2: 47, raceVdot: 41 })).toBeNull();         // no distance
  });
});
