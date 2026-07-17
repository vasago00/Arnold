// Tests for the world model (roadmap Stage 1). The phase boundaries here are the exact cases that
// used to need hand-coded `if`s across the generators: the midnight fuel nag, the bedtime "no
// energy", the just-woke "you missed a session". Lock them at the model layer so the whole class is
// closed once, not screen-by-screen.
import { describe, it, expect } from 'vitest';
import {
  buildWorldModel, buildDay, buildWeek, buildSeason, buildBody, buildPerson,
  computeDayPhase, computeSeasonPhase,
} from './worldModel.js';

describe('computeDayPhase — the time-of-day fixes, as one rule', () => {
  it('classifies the clock bands', () => {
    expect(computeDayPhase(3, false)).toBe('sleep');         // 3am — asleep
    expect(computeDayPhase(6, false)).toBe('pre_dawn');      // early wake
    expect(computeDayPhase(9, false)).toBe('morning');
    expect(computeDayPhase(13, false)).toBe('midday');
    expect(computeDayPhase(18, false)).toBe('training_window');
    expect(computeDayPhase(22, false)).toBe('wind_down');    // bedtime
    expect(computeDayPhase(null, false)).toBe('unknown');    // no clock → silent
  });
  it('trained-today collapses the active day to recovery — but sleep/wind-down still win', () => {
    expect(computeDayPhase(13, true)).toBe('recovery');      // trained at midday → recovery
    expect(computeDayPhase(9, true)).toBe('recovery');
    expect(computeDayPhase(22, true)).toBe('wind_down');     // trained but it's bedtime → wind_down wins
    expect(computeDayPhase(3, true)).toBe('sleep');
  });
});

describe('buildDay — the booleans generators gate on', () => {
  it('bedtime: wind-down true, fuel window closed (no "refuel"/"no energy" nag)', () => {
    const d = buildDay({ hour: 22, trainedToday: false, hasPlannedToday: true });
    expect(d.phase).toBe('wind_down');
    expect(d.isWindDown).toBe(true);
    expect(d.fuelWindowOpen).toBe(false);
    expect(d.preWorkout).toBe(false);        // don't tee up a workout at bedtime
  });
  it('just woke: morning true, not flagged as having missed anything', () => {
    const d = buildDay({ hour: 7, trainedToday: false, hasPlannedToday: true });
    expect(d.isMorning).toBe(true);
    expect(d.postWorkout).toBe(false);
    expect(d.preWorkout).toBe(true);         // there's a session ahead, day is open
  });
  it('midnight reset with nothing logged: fuel window closed, not morning', () => {
    const d = buildDay({ hour: 0, trainedToday: false });
    expect(d.phase).toBe('sleep');
    expect(d.fuelWindowOpen).toBe(false);    // the "midnight energy nag" class — silent
    expect(d.isMorning).toBe(false);
  });
  it('logged a session at midday: postWorkout flips (Play tile updates), preWorkout clears', () => {
    const d = buildDay({ hour: 13, trainedToday: true, hasPlannedToday: true });
    expect(d.phase).toBe('recovery');
    expect(d.postWorkout).toBe(true);
    expect(d.preWorkout).toBe(false);
  });
  it('evening is the window where the fuel/EA read is genuinely relevant', () => {
    const d = buildDay({ hour: 18, trainedToday: false });
    expect(d.isEvening).toBe(true);
    expect(d.fuelWindowOpen).toBe(true);
  });
  it('null hour degrades to silence, never a wrong claim', () => {
    const d = buildDay({ hour: null });
    expect(d.phase).toBe('unknown');
    expect(d.isWindDown).toBe(false);
    expect(d.fuelWindowOpen).toBe(false);
    expect(d.isEvening).toBe(false);
  });
});

describe('buildWeek — the plan arc', () => {
  const plan = {
    weekMiTarget: 30, weekMiProjected: 24,
    missed: [{ type: 'tempo', mi: 6 }],
    remaining: [{ type: 'easy_run', mi: 5 }],
    strengthTarget: 3, strengthDone: 2, swappedToStrength: true,
  };
  it('derives adherence + deviation flags from the slice', () => {
    const w = buildWeek({ plan, injuryArea: 'knee' });
    expect(w.hasPlan).toBe(true);
    expect(w.miTarget).toBe(30);
    expect(w.miProjected).toBe(24);
    expect(w.adherencePct).toBe(80);          // 1 - 6/30 = 80%
    expect(w.missedCount).toBe(1);
    expect(w.remainingCount).toBe(1);
    expect(w.reshapedAround).toBe('knee');
    expect(w.deviated).toBe(true);
  });
  it('empty plan → hasPlan false, silent', () => {
    const w = buildWeek({ plan: {} });
    expect(w.hasPlan).toBe(false);
    expect(w.adherencePct).toBe(null);
    expect(w.deviated).toBe(false);
  });
  it('generic injury is not treated as a reshape', () => {
    expect(buildWeek({ plan, injuryArea: 'generic' }).reshapedAround).toBe(null);
  });
});

describe('buildSeason — periodization phase from the A-race horizon', () => {
  it('build / peak / taper by days out', () => {
    expect(computeSeasonPhase(120)).toBe('build');
    expect(computeSeasonPhase(30)).toBe('peak');
    expect(computeSeasonPhase(10)).toBe('taper');
    expect(computeSeasonPhase(null)).toBe('unknown');
  });
  it('carries race name, weeks-to-race, and a block intent', () => {
    const s = buildSeason({ aRace: { name: 'Valencia', daysOut: 143 } });
    expect(s.phase).toBe('build');
    expect(s.weeksToRace).toBe(20);
    expect(s.raceName).toBe('Valencia');
    expect(typeof s.intent).toBe('string');
  });
  it('no race → unknown, no fabrication', () => {
    const s = buildSeason({ aRace: null });
    expect(s.phase).toBe('unknown');
    expect(s.hasRace).toBe(false);
    expect(s.intent).toBe(null);
  });
});

describe('buildBody — trend/direction read', () => {
  it('surfaces weight direction, EA flag, heat stress', () => {
    const b = buildBody({
      body: { direction: 'cut', observedRateLbPerWk: 0.7, targetLb: 165 },
      fuel: { ea: { flag: true, status: 'low' } },
      tempC: 30, readiness: { score: 62, band: 'moderate' },
    });
    expect(b.weightDirection).toBe('cut');
    expect(b.weightRateLbPerWk).toBe(0.7);
    expect(b.eaFlag).toBe(true);
    expect(b.eaStatus).toBe('low');
    expect(b.heatStressed).toBe(true);
    expect(b.readinessBand).toBe('moderate');
  });
  it('cool day is not heat-stressed; missing signals stay null', () => {
    const b = buildBody({ body: null, fuel: {}, tempC: 12 });
    expect(b.heatStressed).toBe(false);
    expect(b.weightDirection).toBe(null);
    expect(b.eaFlag).toBe(false);
  });
});

describe('buildPerson — stable stub shape for Stage 4', () => {
  it('defaults are safe and carry novelty memory through', () => {
    const p = buildPerson({ profile: null, memory: { saidAgoDays: { purpose: 2 } } });
    expect(p.stancePref).toBe(null);
    expect(Array.isArray(p.patterns)).toBe(true);
    expect(p.saidAgoDays.purpose).toBe(2);
  });
});

describe('buildWorldModel — the whole snapshot', () => {
  it('assembles day/week/season/body/person + a back-compat clock', () => {
    const wm = buildWorldModel({
      hour: 22, trainedToday: false, hasPlannedToday: true,
      plan: { weekMiTarget: 30, weekMiProjected: 30, missed: [], remaining: [{ type: 'easy_run', mi: 5 }], strengthTarget: 3, strengthDone: 3 },
      aRace: { name: 'Valencia', daysOut: 143 },
      body: { direction: 'cut', observedRateLbPerWk: 0.6, targetLb: 165 },
      fuel: { ea: { flag: false } },
      readiness: { score: 80, band: 'high' },
      injuryArea: 'knee', tempC: 18,
      memory: { saidAgoDays: {} },
    });
    expect(wm.day.phase).toBe('wind_down');
    expect(wm.week.reshapedAround).toBe('knee');
    expect(wm.season.phase).toBe('build');
    expect(wm.body.weightDirection).toBe('cut');
    // Back-compat: the legacy clock slice still resolves the same way callers expect.
    expect(wm.clock.hour).toBe(22);
    expect(wm.clock.isLateNight).toBe(true);
    expect(wm.clock.isEvening).toBe(false);   // 22:00 is wind-down, not the evening fuel window
  });
  it('never throws on an empty input', () => {
    const wm = buildWorldModel({});
    expect(wm.day.phase).toBe('unknown');
    expect(wm.week.hasPlan).toBe(false);
    expect(wm.season.phase).toBe('unknown');
    expect(wm.clock.hour).toBe(null);
  });
});
