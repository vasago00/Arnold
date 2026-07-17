// Tests for the race-recipe / build-retrospective analyzer (Sprint 3.2a). The
// headline case is the "behind but on-track" fix: recent volume can be below a
// naive full-build target yet ON your proven trajectory for this weeks-to-race.
import { describe, it, expect } from 'vitest';
import { buildRaceRecipe, windowMetrics, isMarathonRace } from './raceRecipe.js';

describe('isMarathonRace — tolerant detection (mi OR km OR name)', () => {
  it('detects by miles, km, and name; rejects halves/short', () => {
    expect(isMarathonRace({ distanceMi: 26.2 })).toBe(true);
    expect(isMarathonRace({ distanceKm: 42.2 })).toBe(true);
    expect(isMarathonRace({ name: 'Berlin Marathon' })).toBe(true);   // no distance field
    expect(isMarathonRace({ name: 'Brooklyn Half Marathon' })).toBe(false);
    expect(isMarathonRace({ distanceMi: 13.1 })).toBe(false);
    expect(isMarathonRace({ name: '10K Turkey Trot' })).toBe(false);
  });
  it('uses a ~26.2mi run in the activity history as the reference and takes its finish time', () => {
    const acts = [];
    const d = new Date('2025-06-01T12:00:00'), end = new Date('2025-10-25T12:00:00');
    while (d <= end) { const iso = d.toISOString().slice(0,10); if ((d.getDay()+6)%7 === 5) acts.push({ date: iso, type: 'Run', distanceMi: 16 }); d.setDate(d.getDate()+1); }
    acts.push({ date: '2025-11-01', type: 'Run', distanceMi: 26.3, durationSecs: 13080 });   // the marathon, 3:38
    const r = buildRaceRecipe({ activities: acts, races: [], today: '2026-07-05' });
    expect(r.referenceRace?.source).toBe('activity');
    expect(r.referenceRace?.resultSecs).toBe(13080);
    expect(r.recipe).not.toBe(null);
  });

  it('finds a name-only past marathon as the reference build', () => {
    const acts = [];
    const d = new Date('2025-06-01T12:00:00'), end = new Date('2025-11-01T12:00:00');
    while (d <= end) { const iso = d.toISOString().slice(0,10); if ((d.getDay()+6)%7 === 5) acts.push({ date: iso, type: 'Run', distanceMi: 18 }); d.setDate(d.getDate()+1); }
    const r = buildRaceRecipe({ activities: acts, races: [{ name: 'Chicago Marathon', date: '2025-11-01' }], today: '2026-07-05' });
    expect(r.referenceRace?.name).toBe('Chicago Marathon');
    expect(r.recipe).not.toBe(null);
  });
});

// Generate ~miPerWk of running per week over [startISO, endISO]: Mon easy (25%),
// Wed tempo/quality (25%), Sat long (50%). Deterministic.
function weeklyRuns(startISO, endISO, miPerWk) {
  const out = [];
  const d = new Date(startISO + 'T12:00:00'), end = new Date(endISO + 'T12:00:00');
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const dow = (d.getDay() + 6) % 7;               // Mon=0..Sun=6
    if (dow === 0) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.25 });
    if (dow === 2) out.push({ date: iso, type: 'Run', intensityClass: 'tempo', distanceMi: miPerWk * 0.25 });
    if (dow === 5) out.push({ date: iso, type: 'Run', distanceMi: miPerWk * 0.5 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

describe('windowMetrics', () => {
  it('sums weekly volume, long runs, and quality weeks over the window', () => {
    const acts = weeklyRuns('2026-01-01', '2026-04-01', 40);   // ~13 weeks @ 40 mi/wk, 20mi long, tempo weekly
    const m = windowMetrics(acts, '2026-04-01', 16, 13);
    expect(m.avgWeeklyMi).toBeGreaterThan(30);
    expect(m.longestMi).toBeCloseTo(20, 0);        // Sat = 50% of 40
    expect(m.longRuns).toBeGreaterThan(8);         // one 20mi long each week
    expect(m.weeksWithQuality).toBeGreaterThan(8); // tempo each week
  });
});

describe('windowMetrics — cross-training credit (hybrid athletes)', () => {
  it('credits aerobic XT into aerobic volume at 0.75, leaving run-specific fields run-only', () => {
    const acts = [];
    const start = new Date('2026-06-03T12:00:00');   // inside a 4-wk window ending 06-30
    for (let w = 0; w < 4; w++) {
      const mon = new Date(start); mon.setDate(start.getDate() + w * 7);
      acts.push({ date: mon.toISOString().slice(0, 10), type: 'Run', distanceMi: 6, durationSecs: 3600 });   // 10:00/mi
      const wed = new Date(mon); wed.setDate(mon.getDate() + 2);
      acts.push({ date: wed.toISOString().slice(0, 10), type: 'Cycling', distanceMi: 20, durationSecs: 3600 }); // 60-min bike
    }
    const m = windowMetrics(acts, '2026-06-30', 4, 13);
    expect(m.runMi).toBe(24);            // 4 × 6mi runs
    expect(m.xtEquivMi).toBe(18);        // 4 × (3600s / 600s·mi⁻¹ × 0.75) = 4 × 4.5
    expect(m.totalMi).toBe(42);
    expect(m.avgWeeklyMi).toBe(10.5);    // 42 / 4 weeks
    expect(m.longestMi).toBe(6);         // run-only — bike distance ignored
    expect(m.weeksWithQuality).toBe(0);  // a bike is not run-specific quality
  });
});

describe('buildRaceRecipe — trajectory alignment', () => {
  const races = [
    { name: 'Last Marathon', date: '2025-11-01', distanceMi: 26.2 },
    { name: 'Goal Marathon', date: '2026-11-07', distanceMi: 26.2, priority: 'A' },
  ];
  const refBuild = weeklyRuns('2025-06-01', '2025-11-01', 40);   // proven build ~40 mi/wk

  it('reports ON your proven trajectory when recent volume matches the same point last build', () => {
    const current = weeklyRuns('2026-05-01', '2026-07-05', 38);  // ~38 mi/wk now
    const r = buildRaceRecipe({ activities: [...refBuild, ...current], races, today: '2026-07-05' });
    expect(r.referenceRace.name).toBe('Last Marathon');
    expect(r.recipe.avgWeeklyMi).toBeGreaterThan(30);
    expect(r.onTrajectory).toBe(true);                            // 38 ≥ 90% of the ~40 you ran at this point last time
    expect(r.trajectoryNote).toMatch(/proven trajectory/);
    expect(typeof r.weeksOut).toBe('number');
  });

  it('flags BELOW proven trajectory when recent volume has dropped off', () => {
    const current = weeklyRuns('2026-05-01', '2026-07-05', 18);  // ~18 mi/wk now — well down
    const r = buildRaceRecipe({ activities: [...refBuild, ...current], races, today: '2026-07-05' });
    expect(r.onTrajectory).toBe(false);
    expect(r.trajectoryNote).toMatch(/below your proven trajectory/);
    expect(r.gaps.some(g => g.metric === 'weekly volume')).toBe(true);   // and the gap is named
  });

  it('no reference race → no recipe, no trajectory (graceful)', () => {
    const r = buildRaceRecipe({ activities: weeklyRuns('2026-05-01', '2026-07-05', 30), races: [{ name: 'Goal', date: '2026-11-07', distanceMi: 26.2, priority: 'A' }], today: '2026-07-05' });
    expect(r.referenceRace).toBe(null);
    expect(r.recipe).toBe(null);
    expect(r.onTrajectory).toBe(null);
  });
});
