// Tests for the multivariate environmental HR-drift model. The point of moving to
// regression is (a) recover each effect while holding the others constant, and
// (b) be HONEST about identifiability — when heat & humidity always co-occur the
// confidence must drop, not fabricate a split. These pin both.
import { describe, it, expect } from 'vitest';
import { multiOLS, tConfidence, buildDriftDesign, learnDriftSensitivities, DRIFT_REF } from '../core/hub/hrDriftModel.js';

const USUAL = 140;
// True per-unit HR-drift fractions we bake into synthetic runs:
const B_HEAT = 0.004;   // per °C over 20     → 0.40 %/°C
const B_HUM  = 0.010;   // per 10 %RH over 50 → 1.00 %/10%RH
const B_ELEV = 0.020;   // per 50 m/mi over 20 → 2.00 %/(50 m·mi⁻¹)

// deterministic pseudo-random in [0,1) — no Math.random, so the test is stable.
function lcg(seed) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

function mkRun(temp, hum, gpm, noise = 0) {
  const xHeat = Math.max(0, temp - DRIFT_REF.tempRefC);
  const xHum = Math.max(0, (hum - DRIFT_REF.humRefPct) / 10);
  const xElev = Math.max(0, (gpm - DRIFT_REF.elevFloorGpm) / 50);
  const drift = B_HEAT * xHeat + B_HUM * xHum + B_ELEV * xElev + noise;
  const miles = 6;
  return { isRun: true, avgHR: Math.round(USUAL * (1 + drift)), avgTemperature: temp, avgHumidity: hum, totalAscentM: gpm * miles, distanceMi: miles, date: '2026-06-01' };
}

describe('multiOLS', () => {
  it('recovers a known 2-regressor fit and guards n<=p', () => {
    // y = 1 + 2·x1 + 3·x2, exact
    const X = [[1, 0, 0], [1, 1, 0], [1, 0, 1], [1, 1, 1], [1, 2, 1], [1, 1, 2]];
    const y = X.map(r => 1 + 2 * r[1] + 3 * r[2]);
    const f = multiOLS(X, y);
    expect(f).not.toBe(null);
    expect(f.beta[0]).toBeCloseTo(1, 3);
    expect(f.beta[1]).toBeCloseTo(2, 3);
    expect(f.beta[2]).toBeCloseTo(3, 3);
    expect(f.r2).toBeCloseTo(1, 6);
    expect(multiOLS([[1, 0]], [1])).toBe(null);   // n<=p → null
  });
});

describe('tConfidence', () => {
  it('rises with |t| and is capped', () => {
    expect(tConfidence(0, 30)).toBeLessThan(0.1);
    expect(tConfidence(5, 30)).toBeGreaterThan(0.8);
    expect(tConfidence(5, 30)).toBeLessThanOrEqual(0.98);
    expect(tConfidence(1, 30)).toBeLessThan(tConfidence(3, 30));
  });
});

describe('learnDriftSensitivities — independent variation separates the effects', () => {
  it('recovers heat, humidity and elevation when the conditions vary independently', () => {
    const rnd = lcg(42);
    const runs = [];
    for (let i = 0; i < 80; i++) {
      const temp = 8 + rnd() * 28;        // 8–36 °C
      const hum = 30 + rnd() * 65;        // 30–95 %RH  (INDEPENDENT of temp)
      const gpm = rnd() < 0.5 ? 0 : rnd() * 80;   // half flat, half hilly
      runs.push(mkRun(temp, hum, gpm, (rnd() - 0.5) * 0.002));  // tiny noise
    }
    const r = learnDriftSensitivities(runs, USUAL);
    // values recovered near truth (per-unit fractions)
    expect(r.factors.heatStrain.value).toBeCloseTo(B_HEAT, 2);
    expect(r.factors.humidity.value).toBeCloseTo(B_HUM, 2);
    expect(r.factors.elevation.value).toBeCloseTo(B_ELEV, 2);
    // and confident, because the data actually separates them
    expect(r.factors.heatStrain.confidence).toBeGreaterThan(0.7);
    expect(r.factors.humidity.confidence).toBeGreaterThan(0.7);
    expect(r.factors.elevation.confidence).toBeGreaterThan(0.7);
  });
});

describe('learnDriftSensitivities — collinearity is handled HONESTLY', () => {
  it('drops confidence when heat & humidity always co-occur (can not be separated)', () => {
    const rnd = lcg(7);
    const runs = [];
    for (let i = 0; i < 60; i++) {
      const temp = 22 + rnd() * 14;        // all > 20 °C so the heat column is always active
      const hum = 50 + 3 * (temp - 20);    // humidity LOCKED to temperature → truly collinear
      runs.push(mkRun(temp, hum, 0, (rnd() - 0.5) * 0.002));
    }
    const r = learnDriftSensitivities(runs, USUAL);
    // The combined thermal effect is real (model explains the variance)...
    expect(r.r2).toBeGreaterThan(0.6);
    // ...but neither coefficient can be pinned alone → honest low confidence.
    const hc = r.factors.heatStrain?.confidence ?? 0;
    const uc = r.factors.humidity?.confidence ?? 0;
    expect(Math.min(hc, uc)).toBeLessThan(0.5);
  });
});

describe('buildDriftDesign — drops unidentifiable columns', () => {
  it('omits a factor with no spread (all runs flat → no elevation column)', () => {
    const runs = [mkRun(30, 80, 0), mkRun(25, 60, 0), mkRun(33, 90, 0), mkRun(22, 55, 0), mkRun(28, 70, 0)];
    const { cols } = buildDriftDesign(runs, USUAL);
    expect(cols).not.toContain('elevation');
    expect(cols).toContain('heatStrain');
  });
});
