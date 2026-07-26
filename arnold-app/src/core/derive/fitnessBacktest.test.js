// fitnessBacktest.test.js — GROUND-TRUTH back-test against Emil's real Garmin marathon history (2023–2025).
// It encodes the model's promises in executable form: (1) every real marathon is DETECTED as a race and maps
// to a sane VDOT; (2) the CURRENT level reflects only RECENT efforts — a year-old marathon must NOT set today's
// number (Emil's principle); and (3) marathon EXPERIENCE relaxes the unproven-distance fade without touching the
// level. Ranges, not exact values, so honest tuning stays green while a real regression (dropped races,
// stale-data leakage, fabricated numbers) goes red.
import { describe, it, expect } from 'vitest';
import { classifyEffort, effortToVdot } from './fitnessObservation.js';
import { estimateFitnessState } from './fitnessState.js';
import { projectRace } from './fitnessProjection.js';
import { marathonExperience } from './marathonExperience.js';

const parseTime = (t) => { const p = t.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };

// [date, title, distanceMi, time, avgHR, maxHR] — verbatim from Garmin. Every entry is a marathon (>26 mi).
const RAW = [
  ['2025-11-02', 'New York City Marathon', 26.56, '04:07:49', 157, 171],
  ['2025-10-12', 'Chicago Marathon', 26.62, '03:47:43', 156, 174],
  ['2025-08-31', 'Sydney Running', 26.54, '03:47:07', 147, 161],   // generic title + 79% HR: still a race (≥26 mi)
  ['2024-11-03', 'New York City Marathon', 26.77, '03:53:38', 148, 165],
  ['2024-10-13', 'Chicago Marathon', 26.75, '04:44:47', 157, 176],
  ['2024-09-29', 'Berlin Marathon', 26.63, '03:56:04', 154, 173],
  ['2023-11-05', 'New York Marathon', 26.24, '04:51:57', 160, 185],
  ['2023-09-24', 'Berlin Marathon', 26.54, '04:14:31', 96, 173],   // broken HR strap (96 bpm): distance rule rescues it
];
const ACTS = RAW.map(([date, name, distanceMi, time, avgHR, maxHR]) => ({ date, name, distanceMi, durationSecs: parseTime(time), avgHR, maxHR, activityType: 'running', isRun: true }));
const HRMAX = Math.max(...ACTS.map((a) => a.maxHR));   // 185
const MARA = 42.195;

describe('detection — every real marathon is a race with a sane VDOT', () => {
  it('all 8 marathons classify as race (incl. the 79%-HR Sydney and the broken-strap Berlin)', () => {
    for (const a of ACTS) {
      expect(classifyEffort(a, { hrMax: HRMAX })).toBe('race');
      const o = effortToVdot(a, { hrMax: HRMAX });
      expect(o?.kind).toBe('race');
      expect(o.vdot).toBeGreaterThan(28);   // a 4:52 marathon is ~VDOT 30; nothing absurd
      expect(o.vdot).toBeLessThan(45);       // a 3:47 marathon is ~VDOT 41; never the poisoned thousands
    }
  });
});

describe('walk-forward — predict a marathon that HAS recent prior evidence (≤180 d)', () => {
  // Only the tightly-clustered 2025 races have a prior within the current-fitness window. Sydney-2025's prior is
  // a 10-month-old marathon → correctly NOT a current anchor (tested in the recency block instead).
  const targets = [ACTS.find((a) => a.date === '2025-10-12'), ACTS.find((a) => a.date === '2025-11-02')];
  for (const tgt of targets) {
    it(`${tgt.date} projects within a defensible band of the actual ${tgt.name}`, () => {
      const prior = ACTS.filter((a) => a.date < tgt.date);
      const state = estimateFitnessState(prior, { today: tgt.date, hrMax: HRMAX });
      expect(state).toBeTruthy();                       // a marathon <180 d prior exists → a current level
      const p = projectRace(state, MARA, { activities: prior, today: tgt.date, hrMax: HRMAX });
      expect(p.seconds).toBeGreaterThan(3 * 3600 + 20 * 60);    // not an elite fantasy
      expect(p.seconds).toBeLessThan(4 * 3600 + 30 * 60);        // not the old absurdity
      expect(Math.abs(p.seconds - tgt.durationSecs)).toBeLessThan(40 * 60);   // a fitness read, not a race-day oracle
      expect(p.base).toBeLessThanOrEqual(p.seconds);   // the fade never makes the marathon faster than base
    });
  }
});

describe('recency — a stale race does NOT set the current level (Emil’s principle)', () => {
  const TODAY = '2026-07-19';
  it('marathons all ≥8 months old → NO current level (null): the model refuses to call year-old data "current"', () => {
    expect(estimateFitnessState(ACTS, { today: TODAY, hrMax: HRMAX })).toBeNull();
  });
  it('add one fresh tempo → the level re-anchors to the RECENT effort, not the old marathons', () => {
    const withFresh = [...ACTS, { date: '2026-06-20', name: 'tempo', distanceMi: 6.2, durationSecs: Math.round(6.2 * 470), avgHR: 168, maxHR: 185, activityType: 'tempo', isRun: true }];
    const s = estimateFitnessState(withFresh, { today: TODAY, hrMax: HRMAX });
    expect(s).toBeTruthy();
    expect(s.asOf).toBe('2026-06-20');                 // speaks as of the fresh effort
    expect(s.vdot).toBeGreaterThan(38);                 // ~his current speed, from the tempo — not the 2025 blend
    expect(s.vdot).toBeLessThan(45);
  });
});

describe('experience — his marathon career relaxes the fade, but never the level', () => {
  const TODAY = '2026-07-19';
  it('8 finishes → a fully-proven marathoner (expFactor ~1)', () => {
    const e = marathonExperience(ACTS, { today: TODAY });
    expect(e.finishes).toBe(8);
    expect(e.expFactor).toBeGreaterThan(0.8);
  });
  it('the SAME recent level projects a FASTER marathon when the career is present (experience relief)', () => {
    const fresh = { date: '2026-06-20', name: 'tempo', distanceMi: 6.2, durationSecs: Math.round(6.2 * 470), avgHR: 168, maxHR: 185, activityType: 'tempo', isRun: true };
    const s = estimateFitnessState([fresh], { today: TODAY, hrMax: 185 });
    const novice = projectRace(s, MARA, { activities: [fresh], today: TODAY, hrMax: 185 });                 // no career
    const veteran = projectRace(s, MARA, { activities: [fresh, ...ACTS], today: TODAY, hrMax: 185 });       // 8 marathons in history
    expect(veteran.seconds).toBeLessThan(novice.seconds);       // experience relaxes the fade
    expect(veteran.fade).toBeLessThan(novice.fade);
    expect(veteran.vdot).toBe(novice.vdot);                      // ...but the LEVEL is identical (fade-only)
    expect(veteran.experience.finishes).toBe(8);
  });
});
