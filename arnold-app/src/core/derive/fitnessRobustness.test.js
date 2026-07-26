// ROBUSTNESS tests — the class of test that was missing, and whose absence let the "1:00 marathon" ship green.
// Every other model test feeds CLEAN, hand-built efforts; real Garmin history contains corrupt rows (GPS
// glitches, treadmill mis-cals, a lap saved as a full activity, unit errors). A single one, unguarded, produced
// a VDOT of thousands and collapsed every prediction to ~60 s. These tests feed the model GARBAGE on purpose
// and assert it stays physiologically sane — the immune system, not the happy path.
import { describe, it, expect } from 'vitest';
import { effortToVdot, classifyEffort } from './fitnessObservation.js';
import { estimateFitnessState } from './fitnessState.js';
import { projectRace } from './fitnessProjection.js';

const T = '2026-07-19';
const OPTS = { today: T, hrMax: 188 };
const run = (o) => ({ activityType: 'running', maxHR: 188, ...o });
// A real, sane anchor to fuse against.
const anchor10k = run({ date: '2026-06-20', distanceMi: 6.214, durationSecs: 49 * 60, avgHR: 178 });
const anchorMara = run({ date: '2025-11-02', distanceMi: 26.56, durationSecs: 4 * 3600 + 7 * 60 + 49, avgHR: 157 });

const POISON = {
  'GPS glitch: 42 km in 6 min': run({ date: '2026-07-01', distanceMi: 26.2, durationSecs: 6 * 60, avgHR: 120 }),
  'teleport: 10 km in 30 s': run({ date: '2026-07-02', distanceMi: 6.2, durationSecs: 30, avgHR: 110 }),
  'unit error: distance already in metres treated as miles': run({ date: '2026-07-03', distanceMi: 42195, durationSecs: 3 * 3600, avgHR: 150 }),
  'zero-duration lap': run({ date: '2026-07-04', distanceMi: 5, durationSecs: 0, avgHR: 150 }),
  'stopped-watch: 42 km in 90 s': run({ date: '2026-07-05', distanceMi: 26.2, durationSecs: 90, avgHR: 130 }),
};

describe('a single corrupt record must never become a level observation', () => {
  for (const [name, bad] of Object.entries(POISON)) {
    it(`rejects — ${name}`, () => {
      expect(effortToVdot(bad, OPTS)).toBeNull();
    });
  }
});

describe('the fused state stays human-range even when garbage is in the history', () => {
  for (const [name, bad] of Object.entries(POISON)) {
    it(`stays sane despite — ${name}`, () => {
      const acts = [anchor10k, anchorMara, bad];
      const s = estimateFitnessState(acts, OPTS);
      expect(s).toBeTruthy();
      expect(s.vdot).toBeGreaterThan(20);
      expect(s.vdot).toBeLessThan(88);                 // never the VDOT-thousands poisoning
      const p = projectRace(s, 42.195, { activities: acts, today: T, hrMax: 188 });
      expect(p.seconds).toBeGreaterThan(2 * 3600);      // a real marathon, never the ~60 s / few-minute collapse
      expect(p.seconds).toBeLessThan(6 * 3600);
    });
  }

  it('the clean-vs-poisoned state is essentially identical (garbage changes nothing)', () => {
    const clean = estimateFitnessState([anchor10k, anchorMara], OPTS);
    const poisoned = estimateFitnessState([anchor10k, anchorMara, POISON['GPS glitch: 42 km in 6 min']], OPTS);
    expect(Math.abs(clean.vdot - poisoned.vdot)).toBeLessThan(0.5);
  });
});

describe('non-run activities are never running-fitness evidence (the ski-poison bug)', () => {
  // A 6-hour Resort Ski covers 45 km; the "≥26 mi = marathon" rule read it as a slow marathon (VDOT 24.9) and
  // anchored the whole state to the floor (Emil's real data). Distance is not the discriminator — the SPORT is.
  const nonRun = {
    'a 6-hour resort ski (45 km)': { date: '2026-02-13', activityType: 'Resort Skiing', isRun: false, distanceMi: 27.89, durationSecs: 21437, avgHR: 83, maxHR: 140 },
    'a long ride (60 km)': { date: '2026-03-01', activityType: 'Cycling', isRun: false, distanceMi: 37, durationSecs: 7200, avgHR: 130, maxHR: 160 },
    'a HYROX / HIIT block': { date: '2026-05-15', activityType: 'HIIT', isRun: false, distanceMi: 5, durationSecs: 3600, avgHR: 160, maxHR: 180 },
    'an open-water swim': { date: '2026-04-01', activityType: 'Open Water Swimming', isRun: false, distanceMi: 2, durationSecs: 3000, avgHR: 140, maxHR: 160 },
  };
  for (const [name, a] of Object.entries(nonRun)) {
    it(`rejects — ${name}`, () => { expect(effortToVdot(a, OPTS)).toBeNull(); });
  }
  it('a real run at the SAME marathon distance is still kept (sport-gated, not distance-gated)', () => {
    const o = effortToVdot({ date: '2026-05-19', activityType: 'running', isRun: true, distanceMi: 26.2, durationSecs: 3 * 3600 + 47 * 60, avgHR: 160 }, OPTS);
    expect(o).toBeTruthy();
    expect(o.kind).toBe('race');
  });
});

describe('a real hard effort near the elite ceiling is still accepted (the gate is not over-tight)', () => {
  it('a 32:00 10K (VDOT ~67, sub-elite but real) is kept, not rejected as an outlier', () => {
    const o = effortToVdot(run({ date: '2026-06-01', distanceMi: 6.214, durationSecs: 32 * 60, avgHR: 185 }), OPTS);
    expect(o).toBeTruthy();
    expect(o.kind).toBe('race');
    expect(o.vdot).toBeGreaterThan(60);
    expect(o.vdot).toBeLessThan(72);      // real and fast — comfortably under the 88 corrupt-data ceiling
  });
});
