// REAL-DATA regression guard. Every other model test uses hand-built efforts; this one runs the model over
// Emil's ACTUAL exported history (566 runs, src/core/record/__fixtures__/real-activities.json). Its job is to
// make the "1:00 marathon" collapse — and its whole class — impossible to ship green again: if any change lets
// the model emit a non-physiological time on real data, this fails. This is the test that should have existed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { effortToVdot } from './fitnessObservation.js';
import { estimateFitnessState } from './fitnessState.js';
import { projectRace } from './fitnessProjection.js';
import { raceTimeFromVdot } from '../coaching/vdot.js';

const runs = JSON.parse(readFileSync(new URL('../record/__fixtures__/real-activities.json', import.meta.url)));
const TODAY = '2026-07-19';
const hrMax = runs.reduce((m, a) => { const h = Number(a.maxHR); return Number.isFinite(h) && h > m ? h : m; }, 0);

// Emil's real 2026 race calendar (the dates the app knows are races). Two are hard efforts run at a
// controlled 81–86% HRmax (Brooklyn Half, Queens 10K); one is a jogged charity run ("Run as One", 10:17/mi).
const RACES_2026 = [{ date: '2026-05-16' }, { date: '2026-06-20' }, { date: '2026-04-12' }];

describe('the model stays physiological over Emil’s entire real history', () => {
  it('the fixture is his real, sizable history (not a toy)', () => {
    expect(runs.length).toBeGreaterThan(500);
  });

  it('NO single real run produces an out-of-range VDOT observation (the immune system holds on real data)', () => {
    const bad = runs.map((a) => effortToVdot(a, { hrMax })).filter(Boolean).filter((o) => o.vdot < 20 || o.vdot > 88);
    expect(bad).toEqual([]);
  });

  it('the fused state is a plausible amateur-marathoner VDOT, never the poisoned thousands', () => {
    const s = estimateFitnessState(runs, { today: TODAY, hrMax });
    expect(s).toBeTruthy();
    expect(s.vdot).toBeGreaterThan(30);
    expect(s.vdot).toBeLessThan(55);
  });

  it('every standard-distance projection is a real race time — the 1:00 collapse can never return', () => {
    const s = estimateFitnessState(runs, { today: TODAY, hrMax });
    const secs = (km) => projectRace(s, km, { activities: runs, today: TODAY, hrMax }).seconds;
    // 5K: not the ~60 s collapse, not slower than a walk
    expect(secs(5)).toBeGreaterThan(18 * 60);
    expect(secs(5)).toBeLessThan(40 * 60);
    // marathon: a human amateur band (his real range is ~3:45–4:30); guards both the collapse and fantasy
    expect(secs(42.195)).toBeGreaterThan(3 * 3600 + 15 * 60);
    expect(secs(42.195)).toBeLessThan(4 * 3600 + 50 * 60);
    // monotonic in distance — a longer race is never faster than a shorter one
    expect(secs(42.195)).toBeGreaterThan(secs(21.0975));
    expect(secs(21.0975)).toBeGreaterThan(secs(10));
    expect(secs(10)).toBeGreaterThan(secs(5));
  });
});

// ── Step 1 lock (Emil 2026-07): the fitness read must ANCHOR to his real races and match reality. Before
// this, his controlled-effort races fell under the HR gate → ZERO level observations → no number; and when
// the charity jog leaked in, it dragged the estimate to ~3:59. With the race cross-reference + the fitness-
// floor, the model reproduces his actual results. These bands are pinned to his verified performances:
// Brooklyn Half 1:50:37 · Queens 10K 48:28 · marathon PR 3:47:07. If a change breaks the anchor, this fails.
describe('fitness anchors to Emil’s real races and reproduces his real performances', () => {
  const state = () => estimateFitnessState(runs, { today: TODAY, hrMax, races: RACES_2026 });

  it('produces a number (his controlled races ARE evidence — no more null state)', () => {
    const s = state();
    expect(s).toBeTruthy();
    expect(s.nObs).toBeGreaterThanOrEqual(1);
  });

  it('the VDOT matches his real race fitness (~40), not the jog-dragged ~38', () => {
    const s = state();
    expect(s.vdot).toBeGreaterThanOrEqual(39);
    expect(s.vdot).toBeLessThanOrEqual(42);
  });

  it('predicted half + marathon land on his actual results (within tolerance)', () => {
    const s = state();
    const half = raceTimeFromVdot(s.vdot, 21097.5);
    const mar_ = raceTimeFromVdot(s.vdot, 42195);
    // Brooklyn Half was 1:50:37 (6637 s) — predict within ~2 min.
    expect(half).toBeGreaterThan(6637 - 120);
    expect(half).toBeLessThan(6637 + 120);
    // Marathon PR 3:47:07 (13627 s) — the current read sits right around it (a touch soft is honest).
    expect(mar_).toBeGreaterThan(3 * 3600 + 44 * 60);
    expect(mar_).toBeLessThan(3 * 3600 + 53 * 60);
  });

  it('the jogged charity race (2026-04-12) is FLOORED out — a slow run is not evidence of lost fitness', () => {
    const s = state();
    expect(s.contributions.some((c) => c.date === '2026-04-12')).toBe(false);
    // and it anchors to the real hard races
    expect(s.contributions.some((c) => c.date === '2026-05-16' || c.date === '2026-06-20')).toBe(true);
  });
});
