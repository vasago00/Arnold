// Tests for preference learning + the person model (roadmap Stage 4). The contract: engagement
// signals move salience nudges and stance in the RIGHT direction, recent signals outweigh old ones,
// hygiene holds (dedup/TTL/cap/conflict), and COLD START is perfectly neutral (no history → no change).
import { describe, it, expect } from 'vitest';
import {
  recordEngagementInto, deriveKindWeights, derivePerson, ACTION_VALENCE,
} from './coachPersonalization.js';

const TODAY = '2026-07-17';
const ago = (n) => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ev = (id, kind, action, date, corrective = false) => ({ id, kind, action, date, corrective });

describe('deriveKindWeights — engagement tilts salience the right way', () => {
  it('acting-on a kind tilts it up; dismissing tilts it down; cold start is neutral', () => {
    expect(deriveKindWeights([], TODAY)).toEqual({});                       // cold start → no nudge
    const up = deriveKindWeights([ev('a', 'progress', 'acted', TODAY), ev('b', 'progress', 'acted', ago(1))], TODAY);
    expect(up.progress).toBeGreaterThan(0);
    const down = deriveKindWeights([ev('c', 'reds', 'dismissed', TODAY), ev('d', 'reds', 'dismissed', ago(1))], TODAY);
    expect(down.reds).toBeLessThan(0);
  });
  it('weights are bounded (learning nudges, never dominates)', () => {
    const many = Array.from({ length: 40 }, (_, i) => ev(`x${i}`, 'purpose', 'acted', ago(i % 5)));
    expect(deriveKindWeights(many, TODAY).purpose).toBeLessThanOrEqual(0.2);
  });
  it('`shown` alone carries no preference signal', () => {
    expect(deriveKindWeights([ev('a', 'progress', 'shown', TODAY), ev('b', 'progress', 'shown', ago(2))], TODAY)).toEqual({});
  });
  it('recency: a recent signal outweighs an old opposite one', () => {
    const w = deriveKindWeights([ev('old', 'reds', 'acted', ago(56)), ev('new', 'reds', 'dismissed', TODAY)], TODAY);
    expect(w.reds).toBeLessThan(0);                                          // recent dismissal wins
  });
});

describe('derivePerson — the semantic stance', () => {
  it('repeatedly dismissing directive coaching → facilitative', () => {
    const events = [ev('a', 'reds', 'dismissed', TODAY, true), ev('b', 'readiness', 'dismissed', ago(1), true), ev('c', 'planImpact', 'ignored', ago(2), true)];
    expect(derivePerson(events, TODAY).stancePref).toBe('facilitative');
  });
  it('acting on directive coaching → directive is welcome', () => {
    const events = [ev('a', 'reds', 'acted', TODAY, true), ev('b', 'readiness', 'acted', ago(1), true)];
    expect(derivePerson(events, TODAY).stancePref).toBe('directive');
  });
  it('insufficient / mixed signal → null (no fabricated personalization)', () => {
    expect(derivePerson([], TODAY).stancePref).toBe(null);
    expect(derivePerson([ev('a', 'reds', 'dismissed', TODAY, true)], TODAY).stancePref).toBe(null);   // one weak signal
  });
  it('surfaces the most-rejected kinds as compact patterns', () => {
    const events = [ev('a', 'reds', 'dismissed', TODAY, true), ev('b', 'reds', 'dismissed', ago(1), true)];
    expect(derivePerson(events, TODAY).patterns).toContain('dismisses:reds');
  });
});

describe('recordEngagementInto — hygiene from day one', () => {
  it('dedup + conflict resolution: latest action for a beat/day wins', () => {
    let e = recordEngagementInto([], { id: 'reds-lowEA', kind: 'reds', action: 'shown' }, TODAY);
    e = recordEngagementInto(e, { id: 'reds-lowEA', kind: 'reds', action: 'dismissed' }, TODAY);
    const sameDay = e.filter((x) => x.id === 'reds-lowEA' && x.date === TODAY);
    expect(sameDay.length).toBe(1);
    expect(sameDay[0].action).toBe('dismissed');
  });
  it('TTL: events older than the window are dropped on write', () => {
    const stale = [ev('old', 'reds', 'acted', ago(90))];
    const e = recordEngagementInto(stale, { id: 'new', kind: 'progress', action: 'acted' }, TODAY);
    expect(e.find((x) => x.id === 'old')).toBeUndefined();
    expect(e.find((x) => x.id === 'new')).toBeTruthy();
  });
  it('rejects invalid actions and missing ids', () => {
    expect(recordEngagementInto([], { id: 'a', action: 'nope' }, TODAY)).toEqual([]);
    expect(recordEngagementInto([], { action: 'acted' }, TODAY)).toEqual([]);
  });
  it('valence ladder is ordered acted > expanded > shown > ignored > dismissed', () => {
    expect(ACTION_VALENCE.acted).toBeGreaterThan(ACTION_VALENCE.expanded);
    expect(ACTION_VALENCE.expanded).toBeGreaterThan(ACTION_VALENCE.shown);
    expect(ACTION_VALENCE.shown).toBeGreaterThan(ACTION_VALENCE.ignored);
    expect(ACTION_VALENCE.ignored).toBeGreaterThan(ACTION_VALENCE.dismissed);
  });
});
