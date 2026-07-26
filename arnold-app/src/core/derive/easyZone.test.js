// Tests for the reserve-anchored "define easy honestly" model (P4). The POINT of these tests, per Emil,
// is to pin down that the LOGIC holds AND that the DEPENDENCY BETWEEN THE VARIABLES holds — specifically
// that resting HR really enters the calculation (heart-rate reserve, not %HRmax) and that the pieces move
// together the way the physiology says they should.
import { describe, it, expect } from 'vitest';
import {
  pctMax, pctReserve, hrAtPctReserve,
  estimateHrMax, estimateRestingHr, estimateLt1,
  classifyIntensity, buildEasyZone,
} from './easyZone.js';

const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

describe('Karvonen core — the two denominators and the dependency on resting HR', () => {
  it('with resting HR = 0, %HRR collapses to %HRmax (the floor is what distinguishes them)', () => {
    for (const hr of [120, 140, 160, 180]) {
      expect(near(pctReserve(hr, 185, 0), pctMax(hr, 185))).toBe(true);
    }
  });

  it('%HRR is ALWAYS lower than %HRmax for a real resting HR — this is the whole reason reserve exists', () => {
    for (const rest of [40, 46, 55, 70]) {
      for (const hr of [110, 135, 150, 175]) {
        expect(pctReserve(hr, 185, rest)).toBeLessThan(pctMax(hr, 185));
      }
    }
  });

  it('round-trips: hrAtPctReserve is the exact inverse of pctReserve', () => {
    for (const hr of [120, 133, 145, 168]) {
      const p = pctReserve(hr, 185, 46);
      expect(near(hrAtPctReserve(p, 185, 46), hr, 1e-9)).toBe(true);
    }
    for (const p of [0.55, 0.65, 0.72, 0.85]) {
      expect(near(pctReserve(hrAtPctReserve(p, 185, 46), 185, 46), p, 1e-9)).toBe(true);
    }
  });

  it('is monotonic: %HRR rises with HR, and the bpm for a fixed reserve-% rises with resting HR', () => {
    expect(pctReserve(150, 185, 46)).toBeGreaterThan(pctReserve(130, 185, 46));   // harder run → higher %HRR
    // the prescribed bpm for "65% of reserve" = 0.35·rest + 0.65·max → increases with resting HR (∂ = 1−p > 0)
    expect(hrAtPctReserve(0.65, 185, 60)).toBeGreaterThan(hrAtPctReserve(0.65, 185, 46));
    // and rises with HRmax
    expect(hrAtPctReserve(0.65, 195, 46)).toBeGreaterThan(hrAtPctReserve(0.65, 185, 46));
  });

  it('Karvonen backward-check reproduces the real athlete: 65% reserve ≈ his easy mode', () => {
    // HRmax 185, resting 46 → 46 + 0.65·139 = 136.35 ≈ his observed easy-mode HR (135)
    expect(Math.round(hrAtPctReserve(0.65, 185, 46))).toBe(136);
  });
});

describe('input estimators', () => {
  it('HRmax: profile value wins; else the peak per-activity maxHR', () => {
    const runs = [{ maxHR: 170 }, { maxHR: 182 }, { maxHR: 178 }];
    expect(estimateHrMax(runs, { maxHR: 190 })).toBe(190);
    expect(estimateHrMax(runs)).toBe(182);
    expect(estimateHrMax([{ maxHR: 999 }, { maxHR: 40 }])).toBe(null);   // junk rejected → no fabrication
  });

  it('resting HR: median over the window, and the window actually filters by date', () => {
    const series = [
      { date: '2026-07-19', restingHR: 46 }, { date: '2026-07-18', restingHR: 48 },
      { date: '2026-07-10', restingHR: 44 }, { date: '2026-01-01', restingHR: 60 },   // old → excluded by short window
    ];
    expect(estimateRestingHr(series, { today: '2026-07-20', days: 30 })).toBe(46);     // median of 46,48,44
    expect(estimateRestingHr(series, { today: '2026-07-20', days: 400 })).toBe(47);    // median of 44,46,48,60
  });
});

describe('LT1 estimator — recovers a known inflection, clamps the implausible, falls back honestly', () => {
  // synthetic athlete: a flat easy PLATEAU (HR 122–142 all at ~10 min/mi) then a clear pace RE-ACCELERATION
  // at 150+ (workouts at ~8 min/mi). Truth: LT1 sits at the top of the plateau, ~140.
  const plateauRuns = () => {
    const runs = [];
    for (let i = 0; i < 60; i++) runs.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 60 * (122 + (i % 21)) / 130 * 10 * 6, avgHR: 122 + (i % 21), maxHR: 185 });
    // rewrite pace to be genuinely FLAT across the plateau (10.0 min/mi), independent of HR
    for (const r of runs) r.durationSecs = 10.0 * 60 * r.distanceMi;
    // 8 workouts: HR 150–158, pace 8.0 (25% faster → re-accel)
    for (let i = 0; i < 8; i++) runs.push({ date: '2026-06-02', distanceMi: 6, durationSecs: 8.0 * 60 * 6, avgHR: 150 + (i % 9), maxHR: 185 });
    return runs;
  };

  it('lands the aerobic ceiling at the top of the plateau, expressed on reserve', () => {
    const lt1 = estimateLt1(plateauRuns(), { hrMax: 185, hrRest: 46 });
    expect(lt1.method).toBe('cluster+reaccel');
    expect(lt1.bpm).toBeGreaterThanOrEqual(138);
    expect(lt1.bpm).toBeLessThanOrEqual(147);
    expect(lt1.pctHrr).toBeGreaterThan(0.60);
    expect(lt1.pctHrr).toBeLessThan(0.80);
    // 68 synthetic runs → moderate confidence (his real 566-run history scales this to ~0.8); the point
    // is that confidence GROWS with data volume, not that a small sample is treated as certain.
    expect(lt1.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('clamps an implausible inflection into the physiological %HRR window', () => {
    // pathological: every run crammed up near max → raw inflection would be absurdly high
    const runs = [];
    for (let i = 0; i < 40; i++) runs.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 9 * 60 * 6, avgHR: 176 + (i % 6), maxHR: 185 });
    const lt1 = estimateLt1(runs, { hrMax: 185, hrRest: 46 });
    expect(lt1.clamped).toBe(true);
    expect(lt1.pctHrr).toBeLessThanOrEqual(0.80 + 1e-9);
    expect(lt1.bpm).toBeLessThanOrEqual(Math.round(46 + 0.80 * (185 - 46)));
  });

  it('falls back to a defensible central %HRR when data is too thin, and says so', () => {
    const lt1 = estimateLt1([{ date: '2026-06-01', distanceMi: 5, durationSecs: 3000, avgHR: 135, maxHR: 185 }], { hrMax: 185, hrRest: 46 });
    expect(lt1.method).toBe('fallback');
    expect(near(lt1.pctHrr, 0.70)).toBe(true);
    expect(lt1.confidence).toBeLessThan(0.3);
  });
});

describe('buildEasyZone — the pieces recompute from inputs and resting HR really enters', () => {
  const runs = () => {
    const rs = [];
    for (let i = 0; i < 60; i++) rs.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 10 * 60 * 6, avgHR: 122 + (i % 21), maxHR: 185, activityType: 'running' });
    for (let i = 0; i < 8; i++) rs.push({ date: '2026-06-02', distanceMi: 6, durationSecs: 8 * 60 * 6, avgHR: 150 + (i % 9), maxHR: 185, activityType: 'running' });
    return rs;
  };
  const rhr = (v) => Array.from({ length: 20 }, (_, i) => ({ date: `2026-06-${String(10 + i).padStart(2, '0')}`, restingHR: v }));

  it('reserve is recomputed from inputs (not a constant): hrr === hrMax − restingBaseline', () => {
    const z = buildEasyZone({ runs: runs(), restingHrSeries: rhr(46) }, { today: '2026-07-01', windowDays: 3650 });
    expect(z.hrMax).toBe(185);
    expect(z.hrRest).toBe(46);
    expect(z.hrr).toBe(185 - 46);
  });

  it('the easy ceiling round-trips through reserve to its own %HRR (internal consistency)', () => {
    const z = buildEasyZone({ runs: runs(), restingHrSeries: rhr(46) }, { today: '2026-07-01', windowDays: 3650 });
    expect(near(pctReserve(z.easyCeilingBpm, z.hrMax, z.hrRest), z.easyCeilingPctHrr, 1e-9)).toBe(true);
  });

  it('ENFORCES the science cap: a plateau above the guardrail is pulled down, and runs above it are NOT easy', () => {
    // pathological athlete whose "easy" cluster sits absurdly high (156–164 bpm) — the cap must bite.
    const hot = [];
    for (let i = 0; i < 60; i++) hot.push({ date: '2026-06-01', distanceMi: 6, durationSecs: 9 * 60 * 6, avgHR: 156 + (i % 9), maxHR: 185, activityType: 'running' });
    for (let i = 0; i < 8; i++) hot.push({ date: '2026-06-02', distanceMi: 6, durationSecs: 7 * 60 * 6, avgHR: 172 + (i % 6), maxHR: 185, activityType: 'running' });
    const z = buildEasyZone({ runs: hot, restingHrSeries: rhr(46) }, { today: '2026-07-01', windowDays: 3650 });
    expect(z.easyCeilingBpm).toBeLessThanOrEqual(z.guardrails.scienceCapBpm);   // never above the guardrail
    expect(z.easyCeilingBpm).toBe(z.guardrails.scienceCapBpm);                    // and here it's actually capped
    expect(classifyIntensity(z.guardrails.scienceCapBpm + 4, z)).not.toBe('easy'); // above the cap ≠ easy
  });

  it('RESTING HR CHANGES THE ANSWER: a different resting HR → different reserve → different %HRR reading of the same ceiling', () => {
    const zLow = buildEasyZone({ runs: runs(), restingHrSeries: rhr(46) }, { today: '2026-07-01', windowDays: 3650 });
    const zHigh = buildEasyZone({ runs: runs(), restingHrSeries: rhr(66) }, { today: '2026-07-01', windowDays: 3650 });
    expect(zHigh.hrr).toBeLessThan(zLow.hrr);                          // higher resting HR → smaller reserve
    // the same aerobic ceiling HR is a DIFFERENT fraction of reserve for the two athletes (resting HR is in the math)
    const ceil = zLow.easyCeilingBpm;
    expect(pctReserve(ceil, 185, 66)).not.toBeCloseTo(pctReserve(ceil, 185, 46), 3);
    // the definitely-aerobic floor (65% reserve) also moves with resting HR
    expect(zHigh.guardrails.aerobicCoreBpm).not.toBe(zLow.guardrails.aerobicCoreBpm);
  });

  it('refuses to fabricate: no resting HR available → returns null rather than guessing', () => {
    expect(buildEasyZone({ runs: runs(), restingHrSeries: [] }, { today: '2026-07-01' })).toBe(null);
    // ...but an explicit profile resting HR is enough to proceed
    const z = buildEasyZone({ runs: runs(), restingHrSeries: [], profile: { restingHR: 50 } }, { today: '2026-07-01', windowDays: 3650 });
    expect(z).not.toBe(null);
    expect(z.hrRest).toBe(50);
  });

  it('takes the CANONICAL ceiling from resolveZones when given (unification — one number everywhere)', () => {
    // simulate resolveZones handing down a ceiling of 150 (e.g. a lab/garmin value) — the analysis must use IT.
    const zones = { source: 'garmin-custom', maxHR: 185, restingHR: 46, z2Ceiling: 150, lt2Hr: 168, lt1Confidence: 0.6, lt1Method: 'garmin' };
    const z = buildEasyZone({ runs: runs(), restingHrSeries: rhr(46), zones }, { today: '2026-07-01', windowDays: 3650 });
    expect(z.easyCeilingBpm).toBe(150);              // the canonical number, not a re-computed one
    expect(z.source).toBe('garmin-custom');
    expect(z.lt1.method).toBe('garmin');
  });

  it('computes an easy-PACE band from the easy-classified runs', () => {
    const z = buildEasyZone({ runs: runs(), restingHrSeries: rhr(46) }, { today: '2026-07-01', windowDays: 3650 });
    expect(z.easyPace).toBeTruthy();
    expect(z.easyPace.n).toBeGreaterThanOrEqual(5);
    expect(z.easyPace.fast).toBeLessThanOrEqual(z.easyPace.median);   // p25 (faster) ≤ median
    expect(z.easyPace.median).toBeLessThanOrEqual(z.easyPace.slow);   // median ≤ p75 (slower)
  });
});

describe('classification + guardrails, relative to the PERSONAL zone', () => {
  const zone = { hrMax: 185, hrRest: 46, hrr: 139, lt1: { pctHrr: 0.71 }, lt2PctHrr: 0.88 };

  it('grades easy / grey / hard on reserve relative to LT1 and LT2', () => {
    expect(classifyIntensity(135, zone)).toBe('easy');    // 64% HRR, below LT1
    expect(classifyIntensity(145, zone)).toBe('easy');    // ≈71% HRR, at LT1
    expect(classifyIntensity(152, zone)).toBe('grey');    // above LT1, below LT2 → the black hole
    expect(classifyIntensity(172, zone)).toBe('hard');    // ≥88% HRR → a genuine workout
  });

  it('the definitely-aerobic core (≤65% reserve) always grades easy', () => {
    const coreBpm = Math.round(hrAtPctReserve(0.65, 185, 46));
    expect(classifyIntensity(coreBpm, zone)).toBe('easy');
  });
});
