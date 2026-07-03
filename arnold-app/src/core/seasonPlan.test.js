// Tests for the continuous multi-marathon coaching engine (Option A).
import { describe, it, expect } from 'vitest';
import { resolveSeasonPlan, marathonFeasibility, goalPaceSecs, fmtGap, racePhase } from './seasonPlan.js';

// Emil's real season — three marathons ~5 weeks apart, sub-3:40 (13200s) each.
const RACES = [
  { name: 'Berlin',   date: '2026-09-27', distanceMi: 26.2, goalTimeSecs: 13200 },
  { name: 'NYC',      date: '2026-11-01', distanceMi: 26.2, goalTimeSecs: 13200 },
  { name: 'Valencia', date: '2026-12-06', distanceMi: 26.2, goalTimeSecs: 13200 },
];

describe('resolveSeasonPlan — build phase', () => {
  it('low base, cold load, race far off → increase ~10% toward ceiling', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-06-22', weeklyMiles: 31, longestRecentMi: 8.3, acwr: null, ceilingMiles: 50 });
    expect(s.phase).toBe('build');
    expect(s.verdict).toBe('increase');
    expect(s.targetWeeklyMiles).toBe(34);     // round(31 * 1.10)
    expect(s.longRunTargetMi).toBe(9.8);      // 8.3 + 1.5
    expect(s.nextRace.name).toBe('Berlin');
  });

  it('high ACWR (>1.5) → cut ~10%', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-07-15', weeklyMiles: 45, longestRecentMi: 16, acwr: { ratio: 1.6 }, ceilingMiles: 50 });
    expect(s.phase).toBe('build');
    expect(s.verdict).toBe('cut');
    expect(s.targetWeeklyMiles).toBe(41);     // round(45 * 0.9 = 40.5)
  });

  it('overreaching ACWR (1.3–1.5) → hold, do not add', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-07-15', weeklyMiles: 45, longestRecentMi: 16, acwr: { ratio: 1.45 }, ceilingMiles: 50 });
    expect(s.verdict).toBe('hold');
    expect(s.targetWeeklyMiles).toBe(45);
  });

  it('at ceiling with load in range → hold', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-07-15', weeklyMiles: 50, longestRecentMi: 18, acwr: { ratio: 1.0 }, ceilingMiles: 50 });
    expect(s.verdict).toBe('hold');
    expect(s.targetWeeklyMiles).toBe(50);
  });
});

describe('resolveSeasonPlan — race windows', () => {
  it('3 days before Berlin → mini-taper, no long run', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-09-24', weeklyMiles: 45, longestRecentMi: 18 });
    expect(s.phase).toBe('mini-taper');
    expect(s.verdict).toBe('taper');
    expect(s.targetWeeklyMiles).toBe(27);     // round(45 * 0.6)
    expect(s.longRunTargetMi).toBe(0);        // the race IS the long run
  });

  it('race day → race-week', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-09-27', weeklyMiles: 45 });
    expect(s.phase).toBe('race-week');
    expect(s.verdict).toBe('taper');
    expect(s.nextRace.daysToNext).toBe(0);
  });

  it('3 days after Berlin → recovery (next race still far)', () => {
    const s = resolveSeasonPlan({ races: RACES, today: '2026-09-30', weeklyMiles: 45, longestRecentMi: 18 });
    expect(s.phase).toBe('recovery');
    expect(s.verdict).toBe('recover');
    expect(s.targetWeeklyMiles).toBe(25);     // round(45 * 0.55)
    expect(s.lastRace.name).toBe('Berlin');
    expect(s.nextRace.name).toBe('NYC');
  });
});

describe('resolveSeasonPlan — tune-up races are run through, not tapered/recovered', () => {
  const SEASON = [
    { name: 'Queens 10K',  date: '2026-06-20', distanceMi: 6.2 },
    { name: '9/11 Mem 4M', date: '2026-07-11', distanceMi: 4 },
    ...RACES,
  ];
  it('a 10K four days ago does NOT trigger recovery (only marathons do)', () => {
    const s = resolveSeasonPlan({ races: SEASON, today: '2026-06-24', weeklyMiles: 31, longestRecentMi: 8.3, acwr: { ratio: 1.0 } });
    expect(s.phase).toBe('build');
    expect(s.lastRace.name).toBe('Queens 10K');   // still surfaced for context
    expect(s.nextMarathon.name).toBe('Berlin');
  });
  it('a short tune-up ahead → build with a no-taper note', () => {
    const s = resolveSeasonPlan({ races: SEASON, today: '2026-07-05', weeklyMiles: 35, longestRecentMi: 10, acwr: { ratio: 1.0 } });
    expect(s.phase).toBe('build');
    expect(s.tuneUp).toBeTruthy();
    expect(s.tuneUp.name).toContain('4M');
    expect(s.why).toMatch(/no taper/);
  });
});

describe('marathonFeasibility', () => {
  it('on-track when pace meets goal and base supports it', () => {
    const f = marathonFeasibility({ predictedMarathonSecs: 13100, goalSecs: 13200, weeklyMiles: 45, longestRecentMi: 20 });
    expect(f.verdict).toBe('on-track');
    expect(f.limiter).toBe(null);
  });

  it("Emil today: speed close but endurance is the limiter", () => {
    const f = marathonFeasibility({ predictedMarathonSecs: 13389, goalSecs: 13200, weeklyMiles: 31, longestRecentMi: 8.3 });
    expect(f.verdict).toBe('aggressive');
    expect(f.limiter).toBe('endurance');
    expect(f.gapSecs).toBe(189);
  });

  it('aggressive on speed when base is fine but pace is just short', () => {
    const f = marathonFeasibility({ predictedMarathonSecs: 13350, goalSecs: 13200, weeklyMiles: 45, longestRecentMi: 20 });
    expect(f.verdict).toBe('aggressive');
    expect(f.limiter).toBe('speed');
  });

  it('unrealistic when the pace gap is large and base is fine', () => {
    const f = marathonFeasibility({ predictedMarathonSecs: 14000, goalSecs: 13200, weeklyMiles: 45, longestRecentMi: 20 });
    expect(f.verdict).toBe('unrealistic');
  });

  it('no-goal and unknown guards', () => {
    expect(marathonFeasibility({ predictedMarathonSecs: 13000, goalSecs: null }).verdict).toBe('no-goal');
    expect(marathonFeasibility({ predictedMarathonSecs: null, goalSecs: 13200 }).verdict).toBe('unknown');
  });
});

describe('racePhase — the single shared phase source', () => {
  it('marathon 3 days out → mini-taper', () => {
    const r = racePhase({ races: RACES, today: '2026-09-24' });
    expect(r.phase).toBe('mini-taper');
    expect(r.nextMarathon.name).toBe('Berlin');
  });
  it('marathon far + short tune-up ahead → build + tuneUp set (no taper)', () => {
    const SEASON = [{ name: '4-Miler', date: '2026-07-05', distanceMi: 4 }, ...RACES];
    const r = racePhase({ races: SEASON, today: '2026-06-30' });
    expect(r.phase).toBe('build');
    expect(r.tuneUp).toBeTruthy();
    expect(r.tuneUp.name).toBe('4-Miler');
  });
  it('recent marathon → recovery', () => {
    const r = racePhase({ races: RACES, today: '2026-09-30' });
    expect(r.phase).toBe('recovery');
    expect(r.lastMarathon.name).toBe('Berlin');
  });
});

describe('helpers', () => {
  it('goalPaceSecs: 3:40 marathon ≈ 8:24/mi', () => {
    expect(goalPaceSecs(13200)).toBe(504);   // 504s = 8:24
  });
  it('fmtGap formats signed mm:ss', () => {
    expect(fmtGap(189)).toBe('+3:09');
    expect(fmtGap(-100)).toBe('-1:40');
  });
});
