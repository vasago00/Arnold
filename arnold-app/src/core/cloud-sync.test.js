// Cloud-sync array merge — the identity logic that decides whether a local
// record survives a pull. The bug these pin: mergeArrays keyed on `id || date`
// alone, so a SECOND activity (or weight reading) on a day the remote already
// knew collided on `date` and got silently dropped — permanent, cross-device
// data loss. Identity is now composite (activityId / samplePk / date+time /
// date+signature), so distinct same-day records are kept apart.
import { describe, it, expect } from 'vitest';
import { _mergeArrays as mergeArrays, _recordIdentity as recordIdentity } from './cloud-sync.js';

const SNAP = 1000; // remoteWrittenAt for these scenarios

describe('cloud-sync recordIdentity — distinct records get distinct keys', () => {
  it('keys Garmin activities by their source.activityId (survives across devices)', () => {
    const a = { date: '2026-07-13', source: { activityId: 111 }, activityType: 'Run' };
    const b = { date: '2026-07-13', source: { activityId: 222 }, activityType: 'Run' };
    expect(recordIdentity(a)).not.toBe(recordIdentity(b)); // same day, different runs
  });
  it('separates two same-day manual runs by start time', () => {
    const morning = { date: '2026-07-13', startTime: '06:30', activityType: 'Run', durationSecs: 3600 };
    const evening = { date: '2026-07-13', startTime: '18:00', activityType: 'Run', durationSecs: 2400 };
    expect(recordIdentity(morning)).not.toBe(recordIdentity(evening));
  });
  it('separates two same-day weight readings by samplePk, then by time', () => {
    expect(recordIdentity({ date: '2026-07-13', samplePk: 'a' }))
      .not.toBe(recordIdentity({ date: '2026-07-13', samplePk: 'b' }));
    expect(recordIdentity({ date: '2026-07-13', time: '07:00', weightLbs: 170 }))
      .not.toBe(recordIdentity({ date: '2026-07-13', time: '19:00', weightLbs: 169 }));
  });
});

describe('cloud-sync mergeArrays — no silent same-day loss', () => {
  it('REGRESSION: a genuinely-new second run on a day the remote already has is PRESERVED', () => {
    // remote knows only the evening run; the phone just logged a morning run.
    const remote = [{ date: '2026-07-13', source: { activityId: 'ev' }, activityType: 'Run', durationSecs: 2400 }];
    const local = [
      { date: '2026-07-13', source: { activityId: 'ev' }, activityType: 'Run', durationSecs: 2400 }, // shared
      { date: '2026-07-13', startTime: '06:30', activityType: 'Run', durationSecs: 3600, createdAt: SNAP + 500 }, // NEW, unpushed
    ];
    const merged = mergeArrays(local, remote, SNAP);
    // the new morning run must survive — the old date-only key dropped it
    expect(merged.some(a => a.startTime === '06:30')).toBe(true);
    expect(merged).toHaveLength(2);
  });

  it('remote copy wins on identity match (no duplicate of the shared record)', () => {
    const remote = [{ date: '2026-07-13', source: { activityId: 'ev' }, durationSecs: 2400 }];
    const local  = [{ date: '2026-07-13', source: { activityId: 'ev' }, durationSecs: 2400, createdAt: SNAP + 500 }];
    const merged = mergeArrays(local, remote, SNAP);
    expect(merged).toHaveLength(1);
  });

  it('still propagates deletions — a local-only record older than the snapshot drops', () => {
    const remote = [{ date: '2026-07-13', source: { activityId: 'ev' } }];
    const local  = [
      { date: '2026-07-13', source: { activityId: 'ev' } },
      { date: '2026-07-10', source: { activityId: 'gone' }, createdAt: SNAP - 500 }, // deleted on remote, pre-snapshot
    ];
    const merged = mergeArrays(local, remote, SNAP);
    expect(merged.some(a => a.source?.activityId === 'gone')).toBe(false);
  });

  it('keeps BOTH same-day weight readings when they are distinct', () => {
    const remote = [{ date: '2026-07-13', samplePk: 'am', weightLbs: 170 }];
    const local  = [
      { date: '2026-07-13', samplePk: 'am', weightLbs: 170 },
      { date: '2026-07-13', samplePk: 'pm', weightLbs: 169, createdAt: SNAP + 500 },
    ];
    const merged = mergeArrays(local, remote, SNAP);
    expect(merged).toHaveLength(2);
  });
});
