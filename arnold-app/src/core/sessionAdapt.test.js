// Tests for the session-adaptation engine v2 (session agility). Locks the SWAP-FIRST,
// equipment-GATED ladder: swap always leads (even under injury), cross-train substitutes
// are gated to what the athlete OWNS and — under injury — to joint-safe modalities only,
// the week runway is flagged, and an empty profile triggers the ask.
import { describe, it, expect } from 'vitest';
import { buildSessionOptions, intentFor } from './sessionAdapt.js';

const ids = (r) => r.options.map((o) => o.id);
// A generous "has everything" profile for tests that aren't about gating.
const ALL = { pool: true, bike: true, treadmill: true, gym: true, elliptical: true, rower: true };

describe('intentFor', () => {
  it('resolves types + aliases, returns null for unknown', () => {
    expect(intentFor({ type: 'long_run' }).loadBearing).toBe(true);
    expect(intentFor({ type: 'easy' }).label).toBe('Easy run');   // alias
    expect(intentFor({ type: 'nonsense' })).toBe(null);
  });
});

describe('swap is first-class and always leads', () => {
  it('time-constrained long run → swap first (least compromise), reduce moves follow', () => {
    const r = buildSessionOptions({ type: 'long_run', distanceMi: 20 }, { minutesAvailable: 90 },
      { modalities: { treadmill: true, bike: true }, weekOpenDays: 3, openDayLabels: ['Thu', 'Sat'] });
    expect(r.constraintKind).toBe('time');
    expect(r.swapFirst).toBe(true);
    expect(ids(r)[0]).toBe('swap');
    expect(r.options[0].compromise).toBe(0);            // 2+ open days → swapping is free
    expect(ids(r)).toContain('split');                  // equipment-free reduce still there
    expect(ids(r)).toContain('sub_treadmill');          // owned modality offered
    expect(r.skipWarning).toMatch(/Skipping a long run/);
  });

  it('injury that AGGRAVATES the session STILL offers swap first (resting the joint is the point)', () => {
    const r = buildSessionOptions({ type: 'tempo', minutes: 45 }, { injury: 'knee' }, { modalities: ALL, weekOpenDays: 2 });
    expect(r.constraintKind).toBe('injury');
    expect(r.aggravated).toBe(true);
    expect(ids(r)[0]).toBe('swap');                     // <-- the fix: swap is NOT suppressed under injury
    expect(r.options[0].how).toMatch(/[Rr]est/);
    expect(r.injuryNote).toMatch(/Protecting your knee/);
  });
});

describe('equipment gating', () => {
  it("Emil's case — knee + intervals, has Peloton + gym, no pool → swap · bike · gym (no pool, no treadmill)", () => {
    const r = buildSessionOptions({ type: 'intervals', minutes: 50 }, { injury: 'knee' },
      { modalities: { bike: true, gym: true }, weekOpenDays: 2, openDayLabels: ['Thu', 'Sat'] });
    expect(ids(r)).toEqual(['swap', 'sub_bike', 'sub_gym']);
    expect(ids(r)).not.toContain('sub_pool');           // doesn't own a pool
    expect(ids(r)).not.toContain('sub_treadmill');      // treadmill is running impact → not joint-safe
    expect(ids(r)).not.toContain('reduce_reps');        // running-load reduce dropped under injury
    expect(r.timeDecay.note).toMatch(/Thu & Sat are open/);
  });

  it('unknown profile → offers no modality subs, sets the ask', () => {
    const r = buildSessionOptions({ type: 'easy_run', distanceMi: 6 }, { minutesAvailable: 20 }, { weekOpenDays: 1 });
    expect(ids(r).some((id) => id.startsWith('sub_'))).toBe(false);
    expect(r.equipmentAsk).toMatch(/What can you train on/);
    expect(ids(r)).toContain('swap');                   // swap + equipment-free reduce still offered
    expect(ids(r)).toContain('shorten_easy');
  });

  it('known profile → no ask', () => {
    const r = buildSessionOptions({ type: 'easy_run', distanceMi: 6 }, {}, { modalities: { bike: true } });
    expect(r.equipmentAsk).toBe(null);
    expect(ids(r)).toContain('sub_bike');
  });

  it('a tolerated injury (knee + easy) behaves normally — swap present, not forced to offload', () => {
    const r = buildSessionOptions({ type: 'easy_run', distanceMi: 6 }, { injury: 'knee' }, { modalities: ALL });
    expect(r.aggravated).toBe(false);
    expect(r.constraintKind).not.toBe('injury');
    expect(ids(r)).toContain('swap');
    expect(ids(r)).toContain('shorten_easy');           // running-load reduce allowed (tolerated)
    expect(r.injuryNote).toMatch(/tolerates this/);
  });
});

describe('time-decay flag', () => {
  it('full week (0 open) → swap costs more and the note says so', () => {
    const r = buildSessionOptions({ type: 'tempo', minutes: 40 }, {}, { modalities: ALL, weekOpenDays: 0 });
    expect(r.timeDecay.openDays).toBe(0);
    expect(r.timeDecay.note).toMatch(/No open days left/);
    expect(r.options.find((o) => o.id === 'swap').compromise).toBeGreaterThan(0);
  });

  it('one open day → "competes with the long run"', () => {
    const r = buildSessionOptions({ type: 'intervals', minutes: 45 }, {}, { modalities: ALL, weekOpenDays: 1, openDayLabels: ['Fri'] });
    expect(r.timeDecay.note).toMatch(/Only Fri left/);
  });
});

describe('quality + unknown session', () => {
  it('tempo holds intensity (fewer reps) as an equipment-free option', () => {
    const r = buildSessionOptions({ type: 'tempo', minutes: 50 }, { minutesAvailable: 25 }, { modalities: ALL });
    expect(ids(r)[0]).toBe('swap');
    expect(ids(r)).toContain('reduce_reps');
    expect(r.intent.dims).toContain('threshold');
  });

  it('returns null for an unknown session type', () => {
    expect(buildSessionOptions({ type: 'kayak' }, {})).toBe(null);
  });
});
