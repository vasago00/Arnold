// Tests for the fitness OBSERVATION layer (Phase 1 of FITNESS_MODEL_ARCHITECTURE.md). The whole model rests
// on this: each effort must map to a consistent, physiologically-correct VDOT — a race, a tempo, and an
// interval session from the same fitness must land on ~the same number — and easy/long runs must NOT set the
// level (they're trend/durability/load, handled elsewhere). This is the layer whose absence produced 5:57.
import { describe, it, expect } from 'vitest';
import { classifyEffort, effortToVdot, vdotToRaceSecs, raceConfirmationNeeded } from './fitnessObservation.js';

const OPTS = { hrMax: 190 };
const run = (mi, totalSec, type, avgHR) => ({ date: '2026-07-01', distanceMi: mi, durationSecs: totalSec, activityType: type, avgHR });

describe('effort → VDOT is intensity-aware and consistent across effort types', () => {
  it('a 49-min 10K maps to VDOT ≈ 41 (race, maximal curve)', () => {
    const o = effortToVdot(run(6.214, 49 * 60, 'running', 178), OPTS);
    expect(o.kind).toBe('race');
    expect(Math.abs(o.vdot - 41)).toBeLessThanOrEqual(1.5);
  });
  it('a 1:47 half maps to VDOT ≈ 41.7 (race)', () => {
    const o = effortToVdot(run(13.11, 107 * 60, 'running', 176), OPTS);
    expect(o.kind).toBe('race');
    expect(Math.abs(o.vdot - 41.7)).toBeLessThanOrEqual(1.5);
  });
  it('the 10K and half from the same fitness AGREE within ~1.5 VDOT', () => {
    const a = effortToVdot(run(6.214, 49 * 60, 'running', 178), OPTS);
    const b = effortToVdot(run(13.11, 107 * 60, 'running', 176), OPTS);
    expect(Math.abs(a.vdot - b.vdot)).toBeLessThanOrEqual(1.5);
  });
  it('a tempo at threshold pace RECOVERS the same VDOT — not projected as a failed race', () => {
    // A VDOT-41 runner's threshold pace is ~8:02/mi; a tempo there must read ~41, not slower.
    const o = effortToVdot(run(4, Math.round(4 * 482), 'tempo', 168), OPTS);
    expect(o.kind).toBe('threshold');
    expect(Math.abs(o.vdot - 41)).toBeLessThanOrEqual(1.5);
  });
});

describe('trust ordering (variance) — a race is tighter than a tempo, a tempo than a VO2 session', () => {
  it('race < threshold < vo2 variance', () => {
    const race = effortToVdot(run(6.214, 49 * 60, 'running', 178), OPTS);
    const tempo = effortToVdot(run(4, Math.round(4 * 482), 'tempo', 168), OPTS);
    const vo2 = effortToVdot(run(4.5, Math.round(4.5 * 440), 'intervals', 182), OPTS);   // 4.5 mi, off standard distances
    expect(vo2.kind).toBe('vo2');
    expect(race.variance).toBeLessThan(tempo.variance);
    expect(tempo.variance).toBeLessThan(vo2.variance);
  });
});

describe('anchoring discipline — easy/long runs are NOT level evidence', () => {
  it('an easy run classifies easy and returns null (no level)', () => {
    const easy = run(6, Math.round(6 * 9.5 * 60), 'easy_run', 145);
    expect(classifyEffort(easy, OPTS)).toBe('easy');
    expect(effortToVdot(easy, OPTS)).toBeNull();
  });
  it('a long steady run returns null (durability/load, not level)', () => {
    expect(effortToVdot(run(16, Math.round(16 * 9.3 * 60), 'long_run', 150), OPTS)).toBeNull();
  });
  it('a run with no HR and no type/standard-distance signal is not trusted as level', () => {
    expect(effortToVdot({ date: '2026-07-01', distanceMi: 5, durationSecs: 5 * 8.5 * 60 }, {})).toBeNull();
  });
});

describe('race cross-reference + mis-log guard (Emil 2026-07)', () => {
  const RACE_DATES = new Set(['2026-07-01']);
  it('a CONTROLLED race on a logged race date counts (81% HRmax half — the HR gate would reject it, the calendar rescues it)', () => {
    // Brooklyn-Half-shaped: 13.1 mi in 1:50:37 at 153 bpm (81% of 190). The standalone HR gate (0.83) drops it.
    const o = effortToVdot(run(13.11, 6637, 'running', 153), { hrMax: 190, raceDates: RACE_DATES });
    expect(classifyEffort(run(13.11, 6637, 'running', 153), { hrMax: 190, raceDates: RACE_DATES })).toBe('race');
    expect(o.kind).toBe('race');
    expect(Math.abs(o.vdot - 41)).toBeLessThanOrEqual(2);
  });
  it('WITHOUT the race calendar, that same controlled half is NOT read as a race (proves the calendar is what rescues it)', () => {
    expect(classifyEffort(run(13.11, 6637, 'running', 153), { hrMax: 190 })).not.toBe('race');
  });
  it('a MIS-LOGGED race — a race label left on an easy run (71% HRmax, 10:17/mi) — is NOT honored as a race', () => {
    // Emil's "Run as One JP Morgan": 7.4 mi at 10:17/mi, 135 bpm (71%). A race entry over an easy run.
    const easyOnRaceDate = run(7.4, Math.round(7.4 * 617), 'running', 135);
    expect(classifyEffort(easyOnRaceDate, { hrMax: 190, raceDates: RACE_DATES })).toBe('easy');
    expect(effortToVdot(easyOnRaceDate, { hrMax: 190, raceDates: RACE_DATES })).toBeNull();
  });
  it('a marathon-distance effort on a race date stays a race even at easy HR (never demoted by the guard)', () => {
    expect(classifyEffort(run(26.3, 3 * 3600 + 47 * 60, 'running', 140), { hrMax: 190, raceDates: RACE_DATES })).toBe('race');
  });
});

describe('the race hierarchy — confirmation is authoritative, threshold only decides WHEN to ask (Emil 2026-07)', () => {
  const RD = new Set(['2026-07-01']);
  const easyOnRaceDate = () => run(7.4, Math.round(7.4 * 617), 'running', 135);   // 71% HRmax — JP Morgan shape
  const hardHalf = () => run(13.11, 6637, 'running', 153);                         // 81% HRmax — real controlled race

  it('a CONFIRMED race wins over the effort — even an easy-effort run the athlete says was a race', () => {
    expect(classifyEffort({ ...easyOnRaceDate(), raceConfirmed: true }, { hrMax: 190, raceDates: RD })).toBe('race');
  });
  it('a DENIED race is never a race — even a hard standard-distance effort, even a marathon distance', () => {
    expect(classifyEffort({ ...hardHalf(), raceConfirmed: false }, { hrMax: 190, raceDates: RD })).not.toBe('race');
    const denyMarathon = { date: '2026-07-01', distanceMi: 26.3, durationSecs: 3 * 3600 + 47 * 60, activityType: 'running', avgHR: 150, raceConfirmed: false };
    expect(classifyEffort(denyMarathon, { hrMax: 190, raceDates: RD })).not.toBe('race');
  });
  it('a logged race run EASY triggers a confirmation prompt (intent ≠ execution → ask, don’t guess)', () => {
    expect(raceConfirmationNeeded(easyOnRaceDate(), { hrMax: 190, raceDates: RD })).toBe('logged-easy');
  });
  it('a hard standard-distance effort NOT on the calendar offers to log it as a race', () => {
    const hard10k = { date: '2026-07-08', distanceMi: 6.214, durationSecs: 44 * 60, activityType: 'running', avgHR: 178 };   // 94% HRmax, NOT a logged date
    expect(raceConfirmationNeeded(hard10k, { hrMax: 190, raceDates: RD })).toBe('unlogged-hard');
  });
  it('once answered, it is NEVER asked again (the answer is final)', () => {
    expect(raceConfirmationNeeded({ ...easyOnRaceDate(), raceConfirmed: false }, { hrMax: 190, raceDates: RD })).toBeNull();
    expect(raceConfirmationNeeded({ ...easyOnRaceDate(), raceConfirmed: true }, { hrMax: 190, raceDates: RD })).toBeNull();
  });
  it('a genuine controlled race (81% on the calendar) is unambiguous — no prompt, just counted', () => {
    expect(raceConfirmationNeeded(hardHalf(), { hrMax: 190, raceDates: RD })).toBeNull();
    expect(classifyEffort(hardHalf(), { hrMax: 190, raceDates: RD })).toBe('race');
  });
  it('a BAD race (logged, high HR, slow time) needs no prompt — it was raced; it stays a race', () => {
    // A half on the calendar, run HARD (88% HRmax) but slow (2:05) — a bad day, not a mislog.
    const badRace = run(13.11, 125 * 60, 'running', 167);
    expect(raceConfirmationNeeded(badRace, { hrMax: 190, raceDates: RD })).toBeNull();
    expect(classifyEffort(badRace, { hrMax: 190, raceDates: RD })).toBe('race');
  });
});

describe('projection sanity', () => {
  it('VDOT 41 projects to a plausible marathon (3:20–4:00)', () => {
    const m = vdotToRaceSecs(41, 42.195);
    expect(m).toBeGreaterThan(12000);
    expect(m).toBeLessThan(14400);
  });
});
