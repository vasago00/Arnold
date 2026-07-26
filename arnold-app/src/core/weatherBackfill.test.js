// Tests for the historical weather backfill (feeds the environmental HR-drift model).
// The network + storage glue (runWeatherBackfill/scheduleWeatherBackfill) is browser-
// only; here we pin the PURE logic: which runs are pending, start-ms/coords parsing,
// and the injected-fetch sweep that fills ONLY missing fields without clobbering data.
import { describe, it, expect } from 'vitest';
import { startMsOf, coordsOf, pendingWeatherBackfill, backfillWeather } from './weatherBackfill.js';

const NYC = { startLatitude: 40.78, startLongitude: -73.97 };

describe('coordsOf / startMsOf', () => {
  it('reads plausible coords and rejects indoor/zero coords', () => {
    expect(coordsOf({ ...NYC })).toEqual({ lat: 40.78, lon: -73.97 });
    expect(coordsOf({ startLatitude: 0, startLongitude: 0 })).toBe(null);
    expect(coordsOf({})).toBe(null);
  });
  it('builds start-ms from date+time, falls back to local noon', () => {
    expect(startMsOf({ date: '2026-07-01', startTime: '06:30' })).toBe(new Date('2026-07-01T06:30').getTime());
    expect(startMsOf({ date: '2026-07-01' })).toBe(new Date('2026-07-01T12:00:00').getTime());
    expect(startMsOf({})).toBe(null);
  });
});

describe('pendingWeatherBackfill', () => {
  it('selects runs with coords + time that are missing temp or humidity', () => {
    const acts = [
      { isRun: true, date: '2026-07-01', ...NYC },                                   // missing both → pending
      { isRun: true, date: '2026-07-02', ...NYC, avgTemperature: 24 },               // missing humidity → pending
      { isRun: true, date: '2026-07-03', ...NYC, avgTemperature: 24, avgHumidity: 60 }, // complete → not pending
      { isRun: true, date: '2026-07-04' },                                           // no coords → not pending
      { isRun: false, date: '2026-07-05', ...NYC },                                  // not a run → not pending
    ];
    const p = pendingWeatherBackfill(acts);
    expect(p.map(a => a.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
});

describe('backfillWeather — fills only the gaps, never clobbers', () => {
  it('fills missing temp+humidity and leaves existing values untouched', async () => {
    const acts = [
      { isRun: true, date: '2026-07-01', ...NYC },
      { isRun: true, date: '2026-07-02', ...NYC, avgTemperature: 99, avgHumidity: 88 }, // already complete
      { isRun: true, date: '2026-07-03', ...NYC, avgTemperature: 30 },                  // only humidity missing
    ];
    const fetchFn = async () => ({ tempC: 25, humidityPct: 70 });
    const res = await backfillWeather(acts, { fetchFn });
    expect(res.filled).toBe(2);                       // #1 (both) and #3 (humidity) — #2 already complete
    expect(acts[0].avgTemperature).toBe(25);
    expect(acts[0].avgHumidity).toBe(70);
    expect(acts[0].weatherSource).toBe('open-meteo-archive');
    expect(acts[1].avgTemperature).toBe(99);          // untouched
    expect(acts[1].avgHumidity).toBe(88);
    expect(acts[2].avgTemperature).toBe(30);          // untouched
    expect(acts[2].avgHumidity).toBe(70);             // filled
  });

  it('aborts after consecutive fetch failures (rate-limit / offline)', async () => {
    const acts = Array.from({ length: 10 }, (_, i) => ({ isRun: true, date: `2026-07-${String(i + 1).padStart(2, '0')}`, ...NYC }));
    const fetchFn = async () => null;                 // every fetch fails
    const res = await backfillWeather(acts, { fetchFn, maxConsecutiveFails: 3 });
    expect(res.aborted).toBe(true);
    expect(res.attempted).toBe(3);                    // stopped early, didn't churn all 10
    expect(res.filled).toBe(0);
  });

  it('respects maxPerRun', async () => {
    const acts = Array.from({ length: 10 }, (_, i) => ({ isRun: true, date: `2026-07-${String(i + 1).padStart(2, '0')}`, ...NYC }));
    const res = await backfillWeather(acts, { fetchFn: async () => ({ tempC: 20, humidityPct: 50 }), maxPerRun: 4 });
    expect(res.attempted).toBe(4);
    expect(res.filled).toBe(4);
  });
});
