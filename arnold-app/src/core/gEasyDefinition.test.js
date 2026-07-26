// Tests for the "define easy honestly" coach voice (P4). It reads ctx.easyZone (the reserve-anchored
// model) and must: stay silent without a zone or with too little data; AFFIRM + name the ceiling when
// the athlete holds the 80/20; NUDGE when easy volume slips into the grey zone; and LEAD with a fresh
// hot-drift day, attributing it to fatigue (elevated resting HR) or heat rather than nagging effort.
import { describe, it, expect } from 'vitest';
import { narrateSurface, allBeats } from './coachNarrative.js';

const zone = (over = {}) => ({
  hrMax: 185, hrRest: 46, hrr: 139,
  lt1: { pctHrr: 0.71, confidence: 0.79, method: 'cluster+reaccel' },
  easyCeilingBpm: 145, easyCeilingPctHrr: 0.712, lt2PctHrr: 0.88,
  guardrails: { aerobicCoreBpm: 136, scienceCapBpm: 152 },
  band: { lowBpm: 136, highBpm: 145 }, restElevated: 1,
  distribution: { nRuns: 200, easyShare: 0.90, greyShare: 0.10, hardShare: 0 },
  drift: [], recentDrift: null,
  ...over,
});
const ctx = (z) => ({
  clock: { hour: 9 },
  today: { primarySession: null, trainedToday: false, tdee: 2500 },
  tomorrow: null, goal: { aRace: { name: 'Valencia', daysOut: 120 }, weakLink: null, body: null },
  fuel: { protein: null, calories: null, ea: { flag: false }, deficitPct: null },
  plan: {}, learned: {}, clinical: {}, memory: {}, easyZone: z,
});

describe('gEasyDefinition', () => {
  it('stays silent when there is no easy zone (never fabricates)', () => {
    expect(allBeats(ctx(undefined)).find((b) => b.kind === 'aerobic')).toBeUndefined();
  });

  it('stays silent when there is too little data to be honest', () => {
    const b = allBeats(ctx(zone({ distribution: { nRuns: 5, easyShare: 1, greyShare: 0, hardShare: 0 } })));
    expect(b.find((x) => x.kind === 'aerobic')).toBeUndefined();
  });

  it('affirms and NAMES the personal ceiling when the athlete holds the 80/20', () => {
    const nv = narrateSurface(ctx(zone()), 'daily');
    expect(nv).toBeTruthy();
    expect(nv.text).toMatch(/90% of your running is genuinely easy/);
    expect(nv.text).toMatch(/145 bpm/);
    expect(nv.text).toMatch(/71% of your heart-rate reserve/);
  });

  it('nudges when easy volume slips into the grey zone', () => {
    const nv = narrateSurface(ctx(zone({ distribution: { nRuns: 200, easyShare: 0.60, greyShare: 0.35, hardShare: 0.05 } })), 'daily');
    expect(nv.text).toMatch(/Only 60% of your running is truly easy/);
    expect(nv.text).toMatch(/grey zone/);
  });

  it('leads with a fresh hot-drift day and attributes it to FATIGUE when resting HR is up', () => {
    const nv = narrateSurface(ctx(zone({
      recentDrift: { date: '2026-07-18', hr: 152, ceilingBpm: 145, deltaBpm: 7 },
      drift: [{ date: '2026-07-18', hr: 152, ceilingBpm: 145, deltaBpm: 7 }], restElevated: 5,
    })), 'daily');
    expect(nv.text).toMatch(/ran hot/);
    expect(nv.text).toMatch(/about 7 bpm over your easy ceiling/);
    expect(nv.text).toMatch(/resting HR's up 5 bpm/);
    expect(nv.text).not.toMatch(/heat or a tired day/);   // fatigue path, not the heat path
  });

  it('attributes hot-drift to HEAT when resting HR is normal (no fatigue nag)', () => {
    const nv = narrateSurface(ctx(zone({
      recentDrift: { date: '2026-07-18', hr: 151, ceilingBpm: 145, deltaBpm: 6 },
      drift: [{ date: '2026-07-18', hr: 151, ceilingBpm: 145, deltaBpm: 6 }], restElevated: 1,
    })), 'daily');
    expect(nv.text).toMatch(/heat or a tired day/);
    expect(nv.text).not.toMatch(/resting HR's up/);
  });

  it('softens the number when the estimate is still low-confidence', () => {
    const nv = narrateSurface(ctx(zone({ lt1: { pctHrr: 0.70, confidence: 0.2, method: 'fallback' } })), 'daily');
    expect(nv.text).toMatch(/still firming up/);
    expect(nv.text).not.toMatch(/% of your heart-rate reserve/);
  });
});
