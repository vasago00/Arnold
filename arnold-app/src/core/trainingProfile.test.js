// Tests for the FORWARD-LOOKING training profile (3.2b, reoriented 2026-07).
// The profile is anchored on current-build vs what the GOAL requires; the weak
// link is the biggest gap to the goal; the past marathon is optional CONTEXT.
import { describe, it, expect } from 'vitest';
import { buildTrainingProfile, parseRaceFinishSecs, fmtFinish } from './trainingProfile.js';

// Mon easy + Wed tempo (quality) + Sat long.
function weeklyRuns(startISO, endISO, miPerWk) {
  const out = [];
  const d = new Date(startISO + 'T12:00:00'), end = new Date(endISO + 'T12:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const dow = (d.getDay() + 6) % 7;
    if (dow === 0) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.25 });
    if (dow === 2) out.push({ date: iso, type: 'Run', intensityClass: 'tempo', distanceMi: miPerWk * 0.25 });
    if (dow === 5) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.5 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}
// Mon + Sat only — NO quality (forces a threshold-weeks gap).
function weeklyRunsNoQuality(startISO, endISO, miPerWk) {
  const out = [];
  const d = new Date(startISO + 'T12:00:00'), end = new Date(endISO + 'T12:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const dow = (d.getDay() + 6) % 7;
    if (dow === 0) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.5 });
    if (dow === 5) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.5 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const marathonGoal = [{ name: 'Valencia', date: '2026-12-06', distanceMi: 26.2, priority: 'A', goalTimeSecs: 12600 }];  // 3:30

describe('parseRaceFinishSecs / fmtFinish', () => {
  it('parses h:mm:ss and formats back to h:mm', () => {
    expect(parseRaceFinishSecs({ result: '3:38:00' }, 42)).toBe(13080);
    expect(fmtFinish(13080)).toBe('3:38');
    expect(fmtFinish(15120)).toBe('4:12');
  });
});

describe('buildTrainingProfile — forward-looking (current vs goal)', () => {
  it('weak link = biggest gap TO THE GOAL; finish is current projection vs goal', () => {
    const p = buildTrainingProfile({
      activities: weeklyRunsNoQuality('2026-05-01', '2026-07-05', 30),   // no quality → threshold gap
      races: marathonGoal, today: '2026-07-05',
      predictFinishSecs: () => ({ seconds: 15120, source: 'hub' }),       // 4:12
    });
    expect(p.finish.goalStr).toBe('3:30');
    expect(p.finish.now.str).toBe('4:12');
    expect(p.finish.atOrAheadOfGoal).toBe(false);
    expect(p.finish.gapToGoalSecs).toBe(15120 - 12600);
    expect(p.weakLink.key).toBe('threshold');                            // 0 quality weeks vs goal's target
    expect(p.ingredients.find(g => g.key === 'volume').target).toBe(48); // goal peak, not a past build
    expect(p.headline).toMatch(/gap to 3:30/);
  });

  it('celebrates when the projection is already at/under the goal', () => {
    const p = buildTrainingProfile({
      activities: weeklyRuns('2026-05-01', '2026-07-05', 50),
      races: marathonGoal, today: '2026-07-05',
      predictFinishSecs: () => ({ seconds: 12300, source: 'race' }),      // 3:25 < 3:30
    });
    expect(p.finish.atOrAheadOfGoal).toBe(true);
    expect(p.finish.gapToGoalSecs).toBe(0);
    expect(p.headline).toMatch(/already at your 3:30 goal/);
  });

  it('no goal time → current build shown target-less, no weak link', () => {
    const p = buildTrainingProfile({
      activities: weeklyRuns('2026-05-01', '2026-07-05', 30),
      races: [{ name: 'Race', date: '2026-12-06', distanceMi: 26.2, priority: 'A' }],
      today: '2026-07-05',
      predictFinishSecs: () => ({ seconds: 13000, source: 'inferred' }),
    });
    expect(p.finish.goalStr).toBe(null);
    expect(p.ingredients.every(g => g.status === 'current')).toBe(true);
    expect(p.weakLink).toBe(null);
    expect(p.headline).toMatch(/set a goal time/);
  });

  it('past marathon is optional CONTEXT (not the driver)', () => {
    const marathon = { date: '2025-11-02', type: 'Run', distanceMi: 26.5, durationSecs: 14820 };   // 4:07
    const p = buildTrainingProfile({
      activities: [marathon, ...weeklyRunsNoQuality('2026-05-01', '2026-07-05', 30)],
      races: marathonGoal, today: '2026-07-05',
      predictFinishSecs: () => ({ seconds: 15120, source: 'hub' }),       // 4:12 (from CURRENT fitness)
    });
    expect(p.finish.proven.str).toBe('4:07');       // context only
    expect(p.finish.goalStr).toBe('3:30');          // the goal drives
    expect(p.weakLink.key).toBe('threshold');
    expect(p.headline).toMatch(/you've run 4:07 before/);
  });

  it('anchors on the marathon, not a nearer non-marathon tune-up (the 22:01 bug)', () => {
    const p = buildTrainingProfile({
      activities: weeklyRuns('2026-05-01', '2026-07-05', 40),
      races: [
        { name: 'Tune-up 4M', date: '2026-07-11', distanceMi: 4, priority: 'A' },   // sooner, default-'A'
        { name: 'Valencia', date: '2026-12-06', distanceMi: 26.2, priority: 'A', goalTimeSecs: 12600 },
      ],
      today: '2026-07-05',
      predictFinishSecs: (km) => ({ seconds: km > 30 ? 15120 : 1320, source: 'hub' }),  // marathon vs 4M
    });
    expect(p.nextARace.name).toBe('Valencia');
    expect(p.finish.now.str).toBe('4:12');   // the marathon projection, not the 22-min 4-miler
    expect(p.finish.goalStr).toBe('3:30');
  });

  it('anchors on the CHOSEN race (aRaceDate), not the soonest marathon', () => {
    const p = buildTrainingProfile({
      activities: weeklyRuns('2026-05-01', '2026-07-05', 40),
      races: [
        { name: 'NY Marathon', date: '2026-11-01', distanceMi: 26.2 },                               // sooner, no goal
        { name: 'Valencia Marathon', date: '2026-12-06', distanceMi: 26.2, goalTimeSecs: 12600 },     // chosen, 3:30
      ],
      today: '2026-07-05',
      aRaceDate: '2026-12-06',   // building toward Valencia (planPrefs.target)
      predictFinishSecs: () => ({ seconds: 15120, source: 'hub' }),
    });
    expect(p.nextARace.name).toBe('Valencia Marathon');
    expect(p.finish.goalStr).toBe('3:30');   // reads Valencia's goal, not NY's absence
  });

  it('connects the Performance-goals marathon target via goalSecsFallback', () => {
    const p = buildTrainingProfile({
      activities: weeklyRunsNoQuality('2026-05-01', '2026-07-05', 30),
      races: [{ name: 'Valencia', date: '2026-12-06', distanceMi: 26.2, priority: 'A' }],  // NO goalTimeSecs on the race
      today: '2026-07-05',
      predictFinishSecs: () => ({ seconds: 15120, source: 'hub' }),
      goalSecsFallback: 12600,   // 3:30 from goals.marathon.targetSecs
    });
    expect(p.finish.goalStr).toBe('3:30');
    expect(p.weakLink.key).toBe('threshold');   // targets exist now → weak link computes
  });

  it('is graceful with no data at all', () => {
    const p = buildTrainingProfile({ activities: [], races: [], today: '2026-07-05' });
    expect(p.hasData).toBe(false);
    expect(p.finish.now).toBe(null);
  });
});
