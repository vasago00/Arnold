// Tests for the SoR write planner. The guarantees: a first run seeds the full memory; an unchanged store writes
// NOTHING; a real change produces exactly the right append + snapshot + manifest ops; and the plan's paths are
// stable and durable. This is where we prove the durable memory is written correctly, without any disk.
import { describe, it, expect } from 'vitest';
import { buildWritePlan, planBytes } from './recordWriter.js';
import { replayEvents } from './systemOfRecord.js';

const store = (map) => (cat) => map[cat];
const AT = '2026-07-19T12:00:00Z';
const paths = (plan) => plan.map((o) => o.path);
const op = (plan, path) => plan.find((o) => o.path === path);

describe('first run seeds the full memory', () => {
  const { changed, plan, events, snapshot } = buildWritePlan(
    store({ activities: [{ id: 'a1', date: '2026-06-20', km: 10 }], weight: [{ date: '2026-07-18', kg: 72 }], profile: { name: 'E' } }),
    null, { at: AT });

  it('writes per-category logs, the combined log, a daily snapshot, latest + manifest', () => {
    expect(changed).toBe(true);
    expect(paths(plan)).toEqual(expect.arrayContaining([
      'log/activities.jsonl', 'log/weight.jsonl', 'log/profile.jsonl', 'log/_all.jsonl',
      'snapshots/2026-07-19.json', 'latest.json', 'manifest.json',
    ]));
  });
  it('the combined log fully reconstructs the state (memory is self-sufficient)', () => {
    const all = op(plan, 'log/_all.jsonl').content.trim().split('\n').map((l) => JSON.parse(l));
    const replayed = replayEvents(all);
    expect(replayed.weight).toEqual(snapshot.categories.weight);
    expect(replayed.profile).toEqual(snapshot.categories.profile);
  });
  it('append ops end in newline so subsequent appends concatenate cleanly', () => {
    expect(op(plan, 'log/activities.jsonl').content.endsWith('\n')).toBe(true);
    expect(op(plan, 'log/activities.jsonl').mode).toBe('append');
    expect(op(plan, 'latest.json').mode).toBe('write');
  });
});

describe('no churn: an unchanged store writes nothing', () => {
  it('changed=false and an empty plan when nothing moved', () => {
    const read = store({ activities: [{ id: 'a1', km: 10 }] });
    const first = buildWritePlan(read, null, { at: AT });
    const second = buildWritePlan(read, first.snapshot, { at: '2026-07-20T09:00:00Z' });
    expect(second.changed).toBe(false);
    expect(second.plan).toEqual([]);
  });
});

describe('an incremental change writes only the delta + refreshed state', () => {
  const first = buildWritePlan(store({ activities: [{ id: 'a1', km: 10 }], weight: [{ date: 'd1', kg: 72 }] }), null, { at: AT });
  const second = buildWritePlan(store({ activities: [{ id: 'a1', km: 10 }], weight: [{ date: 'd1', kg: 72 }, { date: 'd2', kg: 71.8 }] }), first.snapshot, { at: '2026-07-20T09:00:00Z', day: '2026-07-20' });

  it('appends only the new weight row — activities log is untouched', () => {
    expect(second.changed).toBe(true);
    expect(paths(second.plan)).toContain('log/weight.jsonl');
    expect(paths(second.plan)).not.toContain('log/activities.jsonl');   // unchanged stream → no append
    const ev = second.events.filter((e) => e.cat === 'weight');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ op: 'upsert', id: 'd2' });
  });
  it('still refreshes latest.json, manifest.json and the NEW day snapshot', () => {
    expect(paths(second.plan)).toEqual(expect.arrayContaining(['latest.json', 'manifest.json', 'snapshots/2026-07-20.json']));
  });
});

describe('planBytes', () => {
  it('sums the content length of a plan', () => {
    const { plan } = buildWritePlan(store({ weight: [{ date: 'd', kg: 72 }] }), null, { at: AT });
    expect(planBytes(plan)).toBeGreaterThan(0);
    expect(planBytes([])).toBe(0);
  });
});
