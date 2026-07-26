// End-to-end SoR pipeline test against an in-memory disk: live store → write plan → sink → files → read back →
// replay to state. This proves the durable memory actually works — appends accumulate across writes, latest.json
// holds current state, the manifest matches, and the append log alone reconstructs everything. The platform
// adapters (FSA/Capacitor) share this exact executePlan path, so what passes here is what runs on disk.
import { describe, it, expect } from 'vitest';
import { executePlan, memoryBackend } from './recordSink.js';
import { buildWritePlan } from './recordWriter.js';
import { replayEvents } from './systemOfRecord.js';

const store = (map) => (cat) => map[cat];

describe('executePlan against a backend', () => {
  it('writes and appends to the right paths, prefixed by root', async () => {
    const be = memoryBackend();
    const res = await executePlan([
      { path: 'latest.json', mode: 'write', content: '{"a":1}' },
      { path: 'log/weight.jsonl', mode: 'append', content: 'line1\n' },
      { path: 'log/weight.jsonl', mode: 'append', content: 'line2\n' },
    ], be, { root: 'data' });
    expect(res.every((r) => r.ok)).toBe(true);
    expect(be.read('data/latest.json')).toBe('{"a":1}');
    expect(be.read('data/log/weight.jsonl')).toBe('line1\nline2\n');   // appends accumulate
  });

  it('reports a failing op without aborting the rest (best-effort durability)', async () => {
    const be = memoryBackend();
    const flaky = { ...be, write: (p) => (p.includes('boom') ? Promise.reject(new Error('disk full')) : be.write(p, 'ok')) };
    const res = await executePlan([
      { path: 'boom.json', mode: 'write', content: 'x' },
      { path: 'fine.json', mode: 'write', content: 'y' },
    ], flaky, { root: 'data' });
    expect(res[0]).toMatchObject({ ok: false });
    expect(res[0].error).toMatch(/disk full/);
    expect(res[1].ok).toBe(true);   // the second op still ran
  });
});

describe('the full pipeline is durable and recoverable', () => {
  it('two writes across days → latest.json is current, and the append log replays to the same state', async () => {
    const be = memoryBackend();

    // Day 1: seed with a run + a weigh-in.
    const s1 = store({ activities: [{ id: 'a1', date: '2026-06-20', km: 10 }], weight: [{ date: '2026-07-18', kg: 72 }] });
    const p1 = buildWritePlan(s1, null, { at: '2026-07-18T12:00:00Z' });
    await executePlan(p1.plan, be, { root: 'data' });

    // Day 2: add a weigh-in; change nothing else. Prior snapshot loaded from latest.json (as the service will).
    const prevSnap = JSON.parse(be.read('data/latest.json'));
    const s2 = store({ activities: [{ id: 'a1', date: '2026-06-20', km: 10 }], weight: [{ date: '2026-07-18', kg: 72 }, { date: '2026-07-19', kg: 71.7 }] });
    const p2 = buildWritePlan(s2, prevSnap, { at: '2026-07-19T12:00:00Z' });
    await executePlan(p2.plan, be, { root: 'data' });

    // latest.json reflects the newest state.
    const latest = JSON.parse(be.read('data/latest.json'));
    expect(latest.categories.weight).toHaveLength(2);

    // The combined append log — everything ever written — replays to exactly the current state.
    const allLog = (be.read('data/log/_all.jsonl') || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const replayed = replayEvents(allLog);
    expect(replayed.weight).toEqual(latest.categories.weight);
    expect(replayed.activities).toEqual(latest.categories.activities);

    // Two day-snapshots exist (point-in-time recovery).
    expect(be.read('data/snapshots/2026-07-18.json')).toBeTruthy();
    expect(be.read('data/snapshots/2026-07-19.json')).toBeTruthy();

    // Day 2's weight log holds only the delta (one appended line), not a re-dump.
    const weightLog = (be.read('data/log/weight.jsonl') || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(weightLog).toHaveLength(2);                 // d1 seeded + d2 appended
    expect(weightLog[1]).toMatchObject({ op: 'upsert', id: '2026-07-19' });
  });
});
