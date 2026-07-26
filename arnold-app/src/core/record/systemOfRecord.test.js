// Tests for the System of Record engine. The guarantees that make it a TRUSTWORTHY memory: a snapshot captures
// the live store; the diff logs only real changes (upsert/delete by stable id); the log alone REPLAYS back to
// the same state (recovery is sound); and the manifest hashes detect drift. These are the invariants that let
// us — and the model's validation — rely on the record instead of an opaque store.
import { describe, it, expect } from 'vitest';
import { projectSnapshot, diffToEvents, eventsToJsonl, replayEvents, buildManifest, stableStringify, hash32 } from './systemOfRecord.js';

// A tiny fake store keyed by category.
const store = (map) => (cat) => map[cat];
const AT = '2026-07-19T12:00:00Z';

describe('projectSnapshot captures the live store', () => {
  it('includes data categories with counts, skips absent ones', () => {
    const s = projectSnapshot(store({ activities: [{ id: 'a1', date: '2026-06-20' }], weight: [{ date: '2026-07-18', kg: 72 }], profile: { name: 'E' } }), { at: AT });
    expect(s.at).toBe(AT);
    expect(s.counts.activities).toBe(1);
    expect(s.counts.weight).toBe(1);
    expect(s.counts.profile).toBe(1);
    expect(s.categories.sleep).toBeUndefined();   // absent → not in the snapshot
  });
});

describe('diffToEvents logs only real changes', () => {
  const base = projectSnapshot(store({ activities: [{ id: 'a1', d: 1 }, { id: 'a2', d: 2 }] }), { at: AT });

  it('first run (no prev) emits an upsert per row — the initial memory', () => {
    const ev = diffToEvents(null, base, AT);
    expect(ev.filter((e) => e.op === 'upsert')).toHaveLength(2);
    expect(ev.every((e) => e.cat === 'activities')).toBe(true);
  });
  it('an unchanged snapshot emits NOTHING (no re-dump churn)', () => {
    expect(diffToEvents(base, base, AT)).toHaveLength(0);
  });
  it('a changed row → one upsert; a removed row → one delete; a new row → one upsert', () => {
    const next = projectSnapshot(store({ activities: [{ id: 'a1', d: 99 }, { id: 'a3', d: 3 }] }), { at: AT });
    const ev = diffToEvents(base, next, AT);
    const byOp = (op) => ev.filter((e) => e.op === op);
    expect(byOp('upsert').map((e) => e.id).sort()).toEqual(['a1', 'a3']);   // a1 changed, a3 new
    expect(byOp('delete').map((e) => e.id)).toEqual(['a2']);                 // a2 removed
    expect(byOp('delete')[0].data).toBeUndefined();
  });
  it('a singleton document (profile) diffs as one @doc row', () => {
    const p0 = projectSnapshot(store({ profile: { name: 'E', hrMax: 188 } }), { at: AT });
    const p1 = projectSnapshot(store({ profile: { name: 'E', hrMax: 190 } }), { at: AT });
    const ev = diffToEvents(p0, p1, AT);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ cat: 'profile', op: 'upsert', id: '@doc' });
  });
});

describe('the log alone replays back to the same state (recovery is sound)', () => {
  it('replay(all events) reproduces the projected categories', () => {
    const snap = projectSnapshot(store({
      activities: [{ id: 'a1', date: '2026-06-20', km: 10 }, { id: 'a2', date: '2026-07-05', km: 21 }],
      weight: [{ date: '2026-07-18', kg: 72 }],
      profile: { name: 'E' },
    }), { at: AT });
    const events = diffToEvents(null, snap, AT);
    const replayed = replayEvents(events);
    // arrays compare order-independently via stable hash of the sets
    expect(hash32(stableStringify(replayed.activities))).toBe(hash32(stableStringify(snap.categories.activities)));
    expect(replayed.weight).toEqual(snap.categories.weight);
    expect(replayed.profile).toEqual(snap.categories.profile);
  });

  it('upserts THEN a delete replay to the correct surviving rows', () => {
    const events = [
      { at: AT, cat: 'weight', op: 'upsert', id: '2026-07-17', data: { date: '2026-07-17', kg: 72.5 } },
      { at: AT, cat: 'weight', op: 'upsert', id: '2026-07-18', data: { date: '2026-07-18', kg: 72.1 } },
      { at: AT, cat: 'weight', op: 'delete', id: '2026-07-17' },
    ];
    expect(replayEvents(events).weight).toEqual([{ date: '2026-07-18', kg: 72.1 }]);
  });
});

describe('jsonl + manifest', () => {
  it('eventsToJsonl is one newline-terminated line per event (appends concatenate cleanly)', () => {
    const jsonl = eventsToJsonl([{ at: AT, cat: 'weight', op: 'upsert', id: 'x', data: { kg: 72 } }, { at: AT, cat: 'weight', op: 'delete', id: 'y' }]);
    const lines = jsonl.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('x');
    expect(jsonl.endsWith('\n')).toBe(true);
    expect(eventsToJsonl([])).toBe('');
  });
  it('manifest hashes detect drift: identical state → identical hash; a change → a different one', () => {
    const s0 = projectSnapshot(store({ weight: [{ date: 'd', kg: 72 }] }), { at: AT });
    const s1 = projectSnapshot(store({ weight: [{ date: 'd', kg: 72 }] }), { at: '2026-07-20T00:00:00Z' });
    const s2 = projectSnapshot(store({ weight: [{ date: 'd', kg: 73 }] }), { at: AT });
    expect(buildManifest(s0).hash).toBe(buildManifest(s1).hash);   // same data, different time → same content hash
    expect(buildManifest(s0).hash).not.toBe(buildManifest(s2).hash);
  });
});
