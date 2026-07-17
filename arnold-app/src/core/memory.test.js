// @vitest-environment node
// Tests for the pure part of authoritative race deletion (Task #44): stripping a
// resurrected race day out of the planner so a deleted race stays deleted.
import { describe, it, expect } from 'vitest';
import { clearPlannerRaceDay } from './memory.js';

// A planner keyed by Monday-anchored week start, days Mon..Sun.
const planner = () => ({
  '2026-12-01': {   // Mon 2026-12-01
    weekStart: '2026-12-01',
    days: [
      { sessions: [{ type: 'easy_run', distanceMi: 5 }] }, // Mon
      { type: 'rest' },                                     // Tue
      { type: 'rest' },                                     // Wed
      { type: 'rest' },                                     // Thu
      { type: 'rest' },                                     // Fri
      { sessions: [{ type: 'race', name: 'Berlin' }] },     // Sat 2026-12-06
      { type: 'rest' },                                     // Sun
    ],
  },
});

describe('clearPlannerRaceDay', () => {
  it('removes the race session on the matching date (Sat 12-06)', () => {
    const { planner: out, changed } = clearPlannerRaceDay(planner(), '2026-12-06');
    expect(changed).toBe(true);
    const sat = out['2026-12-01'].days[5];
    expect((sat.sessions || []).some(s => s.type === 'race')).toBe(false);
  });

  it('leaves other days untouched', () => {
    const { planner: out } = clearPlannerRaceDay(planner(), '2026-12-06');
    expect(out['2026-12-01'].days[0].sessions[0].type).toBe('easy_run');
  });

  it('no-op when no race day matches the date', () => {
    const { changed } = clearPlannerRaceDay(planner(), '2026-12-05'); // Fri, no race
    expect(changed).toBe(false);
  });

  it('safe on empty / malformed input', () => {
    expect(clearPlannerRaceDay(null, '2026-12-06').changed).toBe(false);
    expect(clearPlannerRaceDay({}, null).changed).toBe(false);
    expect(clearPlannerRaceDay({ x: { weekStart: '2026-12-01' } }, '2026-12-06').changed).toBe(false);
  });
});
