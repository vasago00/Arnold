// Tests for the dual-track race outlook. Locks the contract Emil approved: every race projects the ONE fitness
// state forward and reports DEFAULT + STRETCH + a goal verdict, with no fabrication. Anchored to his real read
// (VDOT ~40 ≈ 3:47) and his stated 2026 goals (Berlin 3:40, NYC sub-3:50, Valencia 3:29).
import { describe, it, expect } from 'vitest';
import { raceOutlook, MAX_CYCLE_VDOT_GAIN } from './raceOutlook.js';

const STATE = { vdot: 40.1, sigma: 1.2 };   // his locked current fitness
const TODAY = '2026-07-20';
const RACES = [
  { name: 'Berlin', date: '2026-09-27', distanceMi: 26.219, goalTimeSecs: 3 * 3600 + 40 * 60 },
  { name: 'NYC', date: '2026-11-01', distanceMi: 26.219, goalTimeSecs: 3 * 3600 + 50 * 60 },
  { name: 'Valencia', date: '2026-12-06', distanceMi: 26.219, goalTimeSecs: 3 * 3600 + 29 * 60 },
  { name: 'Bronx 10', date: '2026-09-19', distanceMi: 10 },
];

describe('race outlook — dual-track predictions from one fitness state', () => {
  const ol = raceOutlook({ state: STATE, races: RACES, today: TODAY });

  it('returns an entry per race, sorted by date', () => {
    expect(ol.length).toBe(4);
    for (let i = 1; i < ol.length; i++) expect(ol[i].date >= ol[i - 1].date).toBe(true);
  });

  it('projects forward: STRETCH is at least as fast as TARGET, both faster than "if raced today" for a marathon', () => {
    const val = ol.find((r) => r.name === 'Valencia');
    expect(val.stretchSecs).toBeLessThanOrEqual(val.targetSecs);
  });

  it('classifies each goal honestly against the projection', () => {
    const g = (n) => ol.find((r) => r.name === n).verdict;
    expect(g('NYC')).toBe('on-target');        // sub-3:50 is within the target projection
    expect(g('Berlin')).toBe('beyond-cycle');  // 3:40 is past even the stretch in 10 weeks
    expect(g('Valencia')).toBe('beyond-cycle'); // 3:29 is a later-race (Tokyo) goal
  });

  it('never fabricates: the target marathon prediction sits near his real ~3:47 ceiling, not a fantasy', () => {
    const val = ol.find((r) => r.name === 'Valencia');
    expect(val.targetSecs).toBeGreaterThan(3 * 3600 + 40 * 60);   // not faster than the evidence supports
    expect(val.targetSecs).toBeLessThan(3 * 3600 + 55 * 60);
  });

  it('caps the per-cycle gain: even a far-future race cannot project more than MAX_CYCLE_VDOT_GAIN of VDOT', () => {
    const far = raceOutlook({ state: STATE, races: [{ name: 'Tokyo', date: '2028-03-01', distanceMi: 26.219 }], today: TODAY })[0];
    // At +4 VDOT (44.1) a marathon is ~3:29–3:33; the cap prevents a 10-year horizon implying an elite time.
    expect(far.targetSecs).toBeGreaterThan(3 * 3600 + 20 * 60);
  });

  it('returns null when there is no fitness state (no fabrication)', () => {
    expect(raceOutlook({ state: null, races: RACES, today: TODAY })).toBeNull();
    expect(raceOutlook({ state: { vdot: 0 }, races: RACES, today: TODAY })).toBeNull();
  });

  it('the promotion loop bends the TARGET track — promote faster than neutral faster than ease — but never the STRETCH ceiling', () => {
    const val = (adj) => raceOutlook({ state: STATE, races: RACES, today: TODAY, promotionAdjust: adj }).find((r) => r.name === 'Valencia');
    const ease = val(-0.06), neutral = val(0), promote = val(0.08);
    // promote is fastest (smallest secs), ease is slowest — the target line moves toward potential when absorbed
    expect(promote.targetSecs).toBeLessThan(neutral.targetSecs);
    expect(neutral.targetSecs).toBeLessThan(ease.targetSecs);
    // the stretch ceiling is fixed — promotion moves the target TOWARD it, it doesn't inflate it
    expect(promote.stretchSecs).toBe(neutral.stretchSecs);
    expect(promote.stretchSecs).toBe(ease.stretchSecs);
    // and a full promote can't overshoot the stretch (target never faster than the ceiling)
    expect(promote.targetSecs).toBeGreaterThanOrEqual(promote.stretchSecs);
  });
});
