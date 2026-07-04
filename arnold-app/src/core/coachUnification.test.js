// Coach-unification lock (Sprint 3.0). racePhase (seasonPlan) is THE one source
// of the periodization phase; resolveSeasonPlan, planLoad.analyzeSeason and
// coachSignals.computeRaceHorizon all delegate to it. This test PROVES they can't
// disagree on the thing that used to drift across the three engines — the taper
// call — including the "tune-up must NOT taper" regression (a non-marathon race
// near-term should never trigger a taper on any surface).
//
// It asserts AGREEMENT against racePhase as ground truth rather than hardcoding
// the day thresholds, so it stays correct if those constants are ever retuned —
// what it locks is the single-source contract, not the numbers.
import { describe, it, expect } from 'vitest';
import { racePhase, resolveSeasonPlan } from './seasonPlan.js';
import { analyzeSeason } from './planLoad.js';
import { computeRaceHorizon } from './coachSignals.js';

const TODAY = '2026-07-01';
const shift = (days) => {
  const d = new Date(TODAY + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
// analyzeSeason needs a non-empty weeks array + a goal to run; the taper call
// itself comes from racePhase regardless of these.
const WEEKS = [{ start: shift(-2), end: shift(4), actual: 20, planned: 25 }];

const scenarios = [
  { name: 'marathon 5d out → taper',        races: [{ name: 'M', date: shift(5),  distanceMi: 26.2 }] },
  { name: 'marathon 15d out',               races: [{ name: 'M', date: shift(15), distanceMi: 26.2 }] },
  { name: 'marathon 60d out → build',       races: [{ name: 'M', date: shift(60), distanceMi: 26.2 }] },
  { name: 'marathon 3d ago → recovery',     races: [{ name: 'M', date: shift(-3), distanceMi: 26.2 }] },
  { name: 'HALF 5d out → tune-up, NO taper', races: [{ name: 'H', date: shift(5),  distanceMi: 13.1 }] },
  { name: 'no races',                        races: [] },
];

describe('coach unification — one taper voice across all three surfaces', () => {
  for (const s of scenarios) {
    it(s.name, () => {
      const rp = racePhase({ races: s.races, today: TODAY });
      const taperTruth = rp.phase === 'race-week' || rp.phase === 'mini-taper';

      // 1. season verdict engine
      const rsp = resolveSeasonPlan({ races: s.races, today: TODAY });
      expect(rsp.verdict === 'taper').toBe(taperTruth);

      // 2. race-horizon coaching signal
      const rh = computeRaceHorizon({ races: s.races, lbsToLose: 0 }, { today: TODAY });
      expect(rh.phase === 'taper' || rh.phase === 'race-week').toBe(taperTruth);

      // 3. calendar season analysis
      const as = analyzeSeason(WEEKS, { races: s.races, today: TODAY, weeklyRunMilesGoal: 30 });
      expect(as?.mode === 'taper').toBe(taperTruth);
    });
  }

  it('a near-term non-marathon race never tapers any surface (tune-up guard)', () => {
    const races = [{ name: 'Parkrun', date: shift(4), distanceMi: 3.1 }];
    expect(racePhase({ races, today: TODAY }).phase).not.toBe('mini-taper');
    expect(resolveSeasonPlan({ races, today: TODAY }).verdict).not.toBe('taper');
    expect(computeRaceHorizon({ races, lbsToLose: 0 }, { today: TODAY }).phase).not.toBe('taper');
    expect(analyzeSeason(WEEKS, { races, today: TODAY, weeklyRunMilesGoal: 30 })?.mode).not.toBe('taper');
  });
});
