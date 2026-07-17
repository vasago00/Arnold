// Unit tests for the coach's episodic novelty memory (pure core).
import { describe, it, expect } from 'vitest';
import { computeSaidAgoDays, recordShownInto } from './coachMemory.js';

describe('coachMemory — recordShownInto', () => {
  it('appends today once per beat (idempotent within a day) and caps history', () => {
    let s = {};
    s = recordShownInto(s, ['a', 'b'], '2026-07-16');
    expect(s).toEqual({ a: ['2026-07-16'], b: ['2026-07-16'] });
    s = recordShownInto(s, ['a'], '2026-07-16');   // same day → no duplicate
    expect(s.a).toEqual(['2026-07-16']);
    s = recordShownInto(s, ['a'], '2026-07-17');
    expect(s.a).toEqual(['2026-07-16', '2026-07-17']);
    // cap at 6
    for (const d of ['18', '19', '20', '21', '22', '23']) s = recordShownInto(s, ['a'], `2026-07-${d}`);
    expect(s.a.length).toBe(6);
    expect(s.a[0]).toBe('2026-07-18');   // oldest trimmed
  });
  it('never mutates the input store', () => {
    const s = { a: ['2026-07-15'] };
    const next = recordShownInto(s, ['a'], '2026-07-16');
    expect(s.a).toEqual(['2026-07-15']);          // original untouched
    expect(next.a).toEqual(['2026-07-15', '2026-07-16']);
  });
});

describe('coachMemory — computeSaidAgoDays', () => {
  it('uses the most recent PRIOR day only — today never penalises itself', () => {
    const s = { a: ['2026-07-14', '2026-07-16'], b: ['2026-07-16'], c: ['2026-07-15'] };
    const out = computeSaidAgoDays(s, '2026-07-16');
    expect(out.a).toBe(2);         // last prior showing was the 14th
    expect(out.b).toBeUndefined(); // only shown today → no penalty
    expect(out.c).toBe(1);         // yesterday
  });
  it('is robust to junk', () => {
    expect(computeSaidAgoDays(null, '2026-07-16')).toEqual({});
    expect(computeSaidAgoDays({ a: 'nope' }, '2026-07-16')).toEqual({});
    expect(computeSaidAgoDays({ a: ['2026-07-15'] }, null)).toEqual({});
  });
});
