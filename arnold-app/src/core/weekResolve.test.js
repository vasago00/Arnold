// Tests for the what-if swap engine — the shared brain behind the swap ladder's action
// and the calendar's drag-to-swap. Pure over a normalised week ({ sessions:[{type,distanceMi}] }).
import { describe, it, expect } from 'vitest';
import { evaluateReschedule, evaluateSubstitute, evaluateSessionMove, classifyDay } from './weekResolve.js';

const D = (...t) => ({ sessions: t.map((x) => (typeof x === 'string' ? { type: x } : x)) });
//                Mon        Tue          Wed        Thu       Fri  Sat        Sun
const WEEK = () => [D('easy_run'), D('intervals'), D('easy_run'), D('tempo'), D(), D('long_run'), D()];

describe('classifyDay', () => {
  it('picks the dominant load', () => {
    expect(classifyDay(D('long_run'))).toBe('hard');
    expect(classifyDay(D('intervals', 'strength'))).toBe('hard');
    expect(classifyDay(D('easy_run'))).toBe('easy');
    expect(classifyDay(D('strength'))).toBe('strength');
    expect(classifyDay(D('mobility'))).toBe('recovery');
    expect(classifyDay(D())).toBe('rest');
  });
});

describe('evaluateReschedule', () => {
  it('clean move onto a rest day → kind move, volume conserved, affirming', () => {
    const r = evaluateReschedule({ normWeek: WEEK(), fromIdx: 2, toIdx: 4 }); // Wed easy → Fri rest
    expect(r.valid).toBe(true);
    expect(r.kind).toBe('move');
    expect(r.volume.before).toBe(r.volume.after);
    expect(r.conflicts).toHaveLength(0);
    expect(r.tone).toBe('affirming');
    expect(r.protectsSessions).toBe(true);
  });

  it('exchanging two load days is a swap and conserves volume', () => {
    const r = evaluateReschedule({ normWeek: WEEK(), fromIdx: 1, toIdx: 3 }); // intervals <-> tempo
    expect(r.kind).toBe('swap');
    expect(r.volume.delta).toBe(0);
    expect(r.summary).toMatch(/Swaps your intervals to Thu and tempo back to Tue/);
  });

  it('flags a hard session landing the day before the long run', () => {
    const r = evaluateReschedule({ normWeek: WEEK(), fromIdx: 3, toIdx: 4 }); // tempo Thu → Fri (eve of Sat long)
    expect(r.conflicts.some((c) => c.kind === 'hard_before_long')).toBe(true);
    expect(r.tone).toBe('gentle');
  });

  it('only reports NEW conflicts the swap introduces, not pre-existing ones', () => {
    // A week that already has back-to-back hard (Tue intervals + Wed tempo). Moving Fri easy
    // elsewhere shouldn't re-report the pre-existing Tue/Wed stack.
    const wk = [D('easy_run'), D('intervals'), D('tempo'), D(), D('easy_run'), D('long_run'), D()];
    const r = evaluateReschedule({ normWeek: wk, fromIdx: 4, toIdx: 3 }); // Fri easy → Thu rest
    expect(r.conflicts.every((c) => c.kind !== 'back_to_back_hard' || !/Tue \+ Wed/.test(c.text))).toBe(true);
  });

  it('preserves run mileage across a swap (with distances)', () => {
    const wk = [D({ type: 'easy_run', distanceMi: 5 }), D({ type: 'intervals', distanceMi: 7 }), D('easy_run'),
      D({ type: 'tempo', distanceMi: 6 }), D(), D({ type: 'long_run', distanceMi: 16 }), D()];
    const r = evaluateReschedule({ normWeek: wk, fromIdx: 1, toIdx: 4 });
    expect(r.volume.before).toBe(r.volume.after);   // total conserved even though a day moved
  });

  it('rejects moving an empty (rest) day', () => {
    expect(evaluateReschedule({ normWeek: WEEK(), fromIdx: 4, toIdx: 0 }).valid).toBe(false);
  });
});

describe('evaluateSessionMove (per-session, off a double day)', () => {
  //              Mon        Tue         Wed (tempo+lift)                 Thu            Fri Sat        Sun
  const WK = () => [D('easy_run'), D('recovery'), D({ type: 'tempo', distanceMi: 5 }, 'strength'), D({ type: 'intervals', distanceMi: 5 }), D(), D({ type: 'long_run', distanceMi: 15 }), D()];

  it('moves ONLY the tempo, leaving the lift on Wed; volume conserved', () => {
    const r = evaluateSessionMove({ normWeek: WK(), fromIdx: 2, fromSessionIdx: 0, toIdx: 4 });
    expect(r.valid).toBe(true);
    expect(r.kind).toBe('sessionMove');
    expect(r.movedType).toBe('tempo');
    expect(r.summary).toMatch(/leaves strength on Wed/);
    expect(r.volume.before).toBe(r.volume.after);
  });

  it('moves ONLY the lift when that session is picked', () => {
    const r = evaluateSessionMove({ normWeek: WK(), fromIdx: 2, fromSessionIdx: 1, toIdx: 4 });
    expect(r.movedType).toBe('strength');
    expect(r.summary).toMatch(/leaves tempo on Wed/);
  });

  it('flags two quality efforts if the target day already has a hard session', () => {
    const r = evaluateSessionMove({ normWeek: WK(), fromIdx: 2, fromSessionIdx: 0, toIdx: 3 }); // tempo → Thu(intervals)
    expect(r.conflicts.some((c) => c.kind === 'double_hard')).toBe(true);
    expect(r.tone).toBe('gentle');
  });

  it('a strength onto a quality day is NOT a double-hard conflict', () => {
    const r = evaluateSessionMove({ normWeek: WK(), fromIdx: 2, fromSessionIdx: 1, toIdx: 3 });
    expect(r.conflicts.some((c) => c.kind === 'double_hard')).toBe(false);
  });

  it('emptying a single-session day marks the source a rest day', () => {
    const wk = [D('easy_run'), D('recovery'), D({ type: 'tempo', distanceMi: 5 }), D('recovery'), D(), D({ type: 'long_run', distanceMi: 15 }), D()];
    const r = evaluateSessionMove({ normWeek: wk, fromIdx: 2, fromSessionIdx: 0, toIdx: 4 });
    expect(r.summary).toMatch(/Wed becomes a rest day/);
  });
});

describe('evaluateSubstitute', () => {
  it('drops the run miles from weekly volume but notes the stimulus is kept', () => {
    const wk = [D('easy_run'), D('intervals'), D('easy_run'), D('tempo'), D(), D({ type: 'long_run', distanceMi: 15 }), D()];
    const s = evaluateSubstitute({ normWeek: wk, dayIdx: 5, modalityLabel: 'a Peloton ride', keeps: 'aerobic endurance' });
    expect(s.volume.delta).toBe(-15);
    expect(s.summary).toMatch(/stimulus is protected/);
    expect(s.summary).toMatch(/Keeps the aerobic endurance/);
  });
});
