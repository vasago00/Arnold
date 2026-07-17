// Tests for the mobile plan-summary strip core (Task #32). Pure — pass week records.
import { describe, it, expect } from 'vitest';
import { buildPlanWeekSummary, dayHeadline, nextKeyLabel } from './planWeekSummary.js';

// A representative build week: Mon easy, Tue tempo, Wed strength, Thu easy,
// Fri rest, Sat long, Sun mobility.
const buildWeek = () => ({
  weekStart: '2026-07-06',
  days: [
    { sessions: [{ type: 'easy_run', distanceMi: 5 }] },
    { sessions: [{ type: 'tempo', distanceMi: 6 }] },
    { sessions: [{ type: 'strength' }] },
    { sessions: [{ type: 'easy_run', distanceMi: 4 }] },
    { type: 'rest' },
    { sessions: [{ type: 'long_run', distanceMi: 18 }] },
    { sessions: [{ type: 'mobility' }] },
  ],
});

describe('dayHeadline', () => {
  it('picks the hardest session as the day headline', () => {
    expect(dayHeadline({ sessions: [{ type: 'easy_run' }, { type: 'strength' }] })).toBe('easy_run');
    expect(dayHeadline({ sessions: [{ type: 'strength' }, { type: 'long_run' }] })).toBe('long_run');
    expect(dayHeadline({ sessions: [{ type: 'strength' }] })).toBe('strength');
    expect(dayHeadline({ type: 'rest' })).toBe('rest');
    expect(dayHeadline(null)).toBe('rest');
  });
});

describe('buildPlanWeekSummary', () => {
  it('maps the 7-day shape and flags today', () => {
    const s = buildPlanWeekSummary({ week: buildWeek(), todayIdx: 3 });
    expect(s.days.map(d => d.type)).toEqual([
      'easy_run', 'tempo', 'strength', 'easy_run', 'rest', 'long_run', 'mobility',
    ]);
    expect(s.days[3].isToday).toBe(true);
    expect(s.days[0].isPast).toBe(true);
    expect(s.days[5].isPast).toBe(false);
    expect(s.hasPlan).toBe(true);
    expect(s.totals.sessions).toBe(6); // rest day contributes none
  });

  it('finds the next KEY session from today forward (Sat long run)', () => {
    const s = buildPlanWeekSummary({ week: buildWeek(), todayIdx: 3 });
    expect(s.nextKey).toMatchObject({ type: 'long_run', dow: 'Sat', distanceMi: 18, when: 'this-week' });
    expect(nextKeyLabel(s.nextKey)).toBe('Sat 18 mi long run');
  });

  it('marks a key session as "today" when it is today', () => {
    const s = buildPlanWeekSummary({ week: buildWeek(), todayIdx: 1 }); // Tue tempo
    expect(s.nextKey).toMatchObject({ type: 'tempo', when: 'today' });
    expect(nextKeyLabel(s.nextKey)).toBe('Today 6 mi tempo');
  });

  it('rolls into next week when nothing key remains this week', () => {
    const s = buildPlanWeekSummary({
      week: buildWeek(),
      nextWeek: { days: [{ type: 'rest' }, { sessions: [{ type: 'intervals', distanceMi: 5 }] }] },
      todayIdx: 6, // Sun — the long run (Sat) is already past
    });
    expect(s.nextKey).toMatchObject({ type: 'intervals', dow: 'Tue', when: 'next-week' });
  });

  it('classifies day status from executed dates (done/missed/offplan/today/upcoming)', () => {
    const wk = {
      weekStart: '2026-07-06',   // Mon
      days: [
        { sessions: [{ type: 'easy_run', distanceMi: 5 }] },  // Mon 07-06 planned run
        { sessions: [{ type: 'tempo', distanceMi: 6 }] },     // Tue 07-07 planned run
        { type: 'rest' },                                     // Wed 07-08 rest
        { sessions: [{ type: 'easy_run', distanceMi: 4 }] },  // Thu 07-09 planned run
        { sessions: [{ type: 'easy_run', distanceMi: 4 }] },  // Fri 07-10 (today)
        { type: 'rest' },                                     // Sat 07-11 rest
        { sessions: [{ type: 'long_run', distanceMi: 18 }] }, // Sun 07-12 upcoming
      ],
    };
    const s = buildPlanWeekSummary({
      week: wk, weekStart: '2026-07-06', todayIdx: 4,   // Fri
      executedDates: ['2026-07-06', '2026-07-08'],      // Mon logged (done); Wed rest-day ran (off-plan)
    });
    const st = s.days.map(d => d.status);
    expect(st[0]).toBe('done');       // Mon planned + executed
    expect(st[1]).toBe('missed');     // Tue planned, nothing logged
    expect(st[2]).toBe('offplan');    // Wed rest + executed
    expect(st[3]).toBe('missed');     // Thu planned, nothing logged
    expect(st[4]).toBe('today');      // Fri
    expect(st[5]).toBe('rest');       // Sat future rest
    expect(st[6]).toBe('upcoming');   // Sun future planned
  });

  it('empty week → no plan, no next key', () => {
    const s = buildPlanWeekSummary({ week: { days: Array(7).fill({ type: 'rest' }) }, todayIdx: 0 });
    expect(s.hasPlan).toBe(false);
    expect(s.nextKey).toBe(null);
    expect(nextKeyLabel(s.nextKey)).toBe(null);
  });
});
