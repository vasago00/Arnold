// Tests for the training-responsive fitness estimate (P1). The whole point: the marathon projection must
// MOVE as you train (faster quality efforts, improving aerobic efficiency) — not sit frozen until you race —
// while staying honest (a confidence band that widens when unproven, and a cap against out-claiming
// demonstrated performance). Emil, 2026-07-18.
import { describe, it, expect } from 'vitest';
import { estimateFitness, projectFinishBand } from './fitnessEstimate.js';

const MARA = 42.195;
const run = (date, mi, paceSecPerMi, type = 'run', avgHR = null) =>
  ({ date, distanceMi: mi, durationSecs: Math.round(mi * paceSecPerMi), activityType: type, avgHR });
const easy = (date) => run(date, 6, 9.5 * 60, 'easy_run');
const tempoAt = (date, paceMin) => run(date, 4, paceMin * 60, 'tempo');

describe('the projection responds to TRAINING (the core fix)', () => {
  it('faster tempos over a block → a faster marathon projection', () => {
    const early = ['2026-06-08', '2026-06-15'].map((d) => tempoAt(d, 7.4))
      .concat(['2026-06-05', '2026-06-12', '2026-06-19'].map(easy));
    const later = early.concat(['2026-07-06', '2026-07-13'].map((d) => tempoAt(d, 6.9)))
      .concat(['2026-07-03', '2026-07-10', '2026-07-16'].map(easy));
    const a = projectFinishBand(MARA, early, { today: '2026-06-20' });
    const b = projectFinishBand(MARA, later, { today: '2026-07-18' });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(b.seconds).toBeLessThan(a.seconds);   // improved training → improved prediction
  });

  it('aerobic efficiency improving (faster easy pace at the same HR) is detected', () => {
    const old = ['2026-06-05', '2026-06-12', '2026-06-19'].map((d) => run(d, 6, 9.6 * 60, 'easy_run', 150));
    const now = ['2026-07-06', '2026-07-13', '2026-07-16'].map((d) => run(d, 6, 9.1 * 60, 'easy_run', 150));
    const tempo = ['2026-06-10', '2026-07-12'].map((d) => tempoAt(d, 7.0));
    const fit = estimateFitness(old.concat(now, tempo), { today: '2026-07-18', hrMax: 190 });
    expect(fit).toBeTruthy();
    expect(fit.efficiencyTrend).toBeGreaterThan(0);
  });
});

describe('honesty — confidence band', () => {
  const later = ['2026-07-06', '2026-07-13'].map((d) => tempoAt(d, 6.9))
    .concat(['2026-07-03', '2026-07-10', '2026-07-16'].map(easy));

  it('more recent, consistent evidence → higher confidence and a TIGHTER band', () => {
    const rich = later.concat(['2026-07-01', '2026-07-08', '2026-07-15'].map((d) => tempoAt(d, 6.9)));
    const thin = [tempoAt('2026-07-13', 6.9)];
    const r = projectFinishBand(MARA, rich, { today: '2026-07-18' });
    const t = projectFinishBand(MARA, thin, { today: '2026-07-18' });
    expect(r.confidence).toBeGreaterThan(t.confidence);
    expect(r.halfBandPct).toBeLessThan(t.halfBandPct);
  });

  it('band brackets the point estimate and carries provenance + an as-of date', () => {
    const r = projectFinishBand(MARA, later.concat(['2026-07-08'].map((d) => tempoAt(d, 6.9))), { today: '2026-07-18' });
    expect(r.low).toBeLessThan(r.seconds);
    expect(r.seconds).toBeLessThan(r.high);
    expect(r.asOf).toBeTruthy();
    expect(Array.isArray(r.basis)).toBe(true);
    expect(r.basis.length).toBeGreaterThan(0);
  });

  it('a pure-easy block yields NO projection — a finish must anchor to a real hard effort (Emil\'s rule)', () => {
    const easyOnly = ['2026-07-01', '2026-07-05', '2026-07-09', '2026-07-13'].map(easy);
    // Never manufacture a finish time from easy base miles. No quality effort → null.
    expect(projectFinishBand(MARA, easyOnly, { today: '2026-07-18' })).toBeNull();
    expect(estimateFitness(easyOnly, { today: '2026-07-18' })).toBeNull();
  });
});

describe('the demonstrated-performance CAP (no fantasy times)', () => {
  it('surfaces a ceiling projection when a genuine benchmark exists', () => {
    const block = ['2026-07-06', '2026-07-13'].map((d) => tempoAt(d, 6.9))
      .concat([run('2026-07-11', 13.1, 7.2 * 60, 'race', 175)]);   // a half-marathon benchmark
    const b = projectFinishBand(MARA, block, { today: '2026-07-18', hrMax: 190 });
    expect(b).toBeTruthy();
    expect(b.ceilingSeconds).toBeGreaterThan(0);
  });

  it('returns null only when there is genuinely no usable run', () => {
    expect(projectFinishBand(MARA, [], { today: '2026-07-18' })).toBeNull();
    expect(projectFinishBand(MARA, [{ date: '2026-07-10', distanceMi: 1, durationSecs: 400 }], { today: '2026-07-18' })).toBeNull(); // <3km
  });
});
