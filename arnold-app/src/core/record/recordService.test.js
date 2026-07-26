// Tests for the service CORE (flushRecord + loadPrevSnapshot) against the in-memory backend. Proves the
// cross-session loop: seed → persist → reload prior state → incremental append → recover. The platform wiring
// (folder grant, change subscription) is thin and verified in-app; the judgement it depends on is tested here.
import { describe, it, expect } from 'vitest';
import { flushRecord, loadPrevSnapshot } from './recordService.js';
import { memoryBackend } from './recordSink.js';
import { replayEvents } from './systemOfRecord.js';

const store = (map) => (cat) => map[cat];

describe('flushRecord seeds, then writes only deltas', () => {
  it('first flush seeds the record; an unchanged store is a no-op; a change appends the delta', async () => {
    const be = memoryBackend();
    const read1 = store({ activities: [{ id: 'a1', km: 10 }], weight: [{ date: 'd1', kg: 72 }] });

    const seed = await flushRecord(read1, be, null, '2026-07-18T12:00:00Z');
    expect(seed.changed).toBe(true);
    expect(be.read('data/latest.json')).toBeTruthy();

    // reload prior snapshot the way the service does across sessions
    const prev = await loadPrevSnapshot(be);
    expect(prev.categories.weight).toHaveLength(1);

    const noop = await flushRecord(read1, be, prev, '2026-07-19T09:00:00Z');
    expect(noop.changed).toBe(false);
    expect(noop.wrote).toEqual([]);

    const read2 = store({ activities: [{ id: 'a1', km: 10 }], weight: [{ date: 'd1', kg: 72 }, { date: 'd2', kg: 71.6 }] });
    const inc = await flushRecord(read2, be, prev, '2026-07-19T12:00:00Z');
    expect(inc.changed).toBe(true);
    expect(inc.events.filter((e) => e.cat === 'weight')).toHaveLength(1);
  });

  it('after a full session cycle the append log replays to the current latest.json', async () => {
    const be = memoryBackend();
    let prev = null;
    const days = [
      store({ activities: [{ id: 'a1', km: 10 }] }),
      store({ activities: [{ id: 'a1', km: 10 }, { id: 'a2', km: 21 }] }),
      store({ activities: [{ id: 'a2', km: 21 }], weight: [{ date: 'd', kg: 72 }] }),   // a1 removed, weight added
    ];
    let i = 0;
    for (const read of days) { const r = await flushRecord(read, be, prev, `2026-07-${18 + i++}T12:00:00Z`); if (r.changed) prev = r.snapshot; }

    const latest = JSON.parse(be.read('data/latest.json'));
    const all = (be.read('data/log/_all.jsonl') || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const replayed = replayEvents(all);
    // activities: a1 was added then removed, a2 remains
    expect(replayed.activities).toEqual(latest.categories.activities);
    expect(replayed.activities.map((a) => a.id)).toEqual(['a2']);
    expect(replayed.weight).toEqual(latest.categories.weight);
  });
});

describe('loadPrevSnapshot', () => {
  it('returns null on an empty backend (first ever run)', async () => {
    expect(await loadPrevSnapshot(memoryBackend())).toBeNull();
  });
});
