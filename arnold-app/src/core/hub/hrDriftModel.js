// Hub core — ENVIRONMENTAL HR-DRIFT MODEL (multivariate).
//
// The question: at a matched easy effort, how much does each environmental
// stressor raise your heart rate? Heat, humidity and grade all push HR up on the
// same run, and heat & humidity are CORRELATED (hot summer days are often humid).
// A proportional partition can't separate correlated causes; a multivariate
// regression can — it estimates each effect while holding the others constant, and
// its standard errors tell the truth about identifiability: when two regressors
// always move together the errors widen (low confidence, "need a dry-hot day to
// separate these"); when your data has dry-hot AND humid-hot days they separate.
//
// Model (one row per run):
//   driftFrac = (avgHR − usualHR) / usualHR
//            = β0 + β_heat·(°C over ref) + β_hum·(10%RH over ref) + β_elev·(50 m·mi⁻¹ over floor) + ε
// β_heat is your HR-drift fraction per °C, etc. Confidence per coefficient comes
// from its t-statistic (honest gating, not publication statistics — same spirit as
// stats.js). Pure; unit-tested in tests/hrDriftModel.test.js.

// ── small linear-algebra kit (p is tiny: ≤4) ─────────────────────────────────

// Invert a square matrix via Gauss-Jordan with partial pivoting. Returns null if singular.
function invertMatrix(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    // pivot
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map(row => row.slice(n));
}

// Standard-normal CDF (Abramowitz & Stegun 7.1.26) — for the t→confidence map.
function _normalCdf(z) {
  const s = z < 0 ? -1 : 1; const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}

// Confidence that a coefficient is genuinely non-zero, from its t-stat. Two-sided,
// df-fattened for small samples (so 4 hot runs don't read as certainty). Capped.
export function tConfidence(t, df) {
  const tAbs = Math.abs(t);
  if (!Number.isFinite(tAbs) || df <= 0) return 0;
  const fatten = 1 + 0.7 / Math.max(1, df);          // heavier tails at low df
  const pTwoSided = 2 * (1 - _normalCdf(tAbs / fatten));
  return Math.max(0, Math.min(0.98, 1 - pTwoSided));
}

// ── Ordinary least squares with SEs ──────────────────────────────────────────
// X: n×p design matrix (INCLUDE the intercept column yourself). y: length-n.
// Returns { beta, se, t, n, p, df, r2 } or null if unsolvable.
export function multiOLS(X, y) {
  const n = X.length;
  if (!n || !X[0]) return null;
  const p = X[0].length;
  if (n <= p) return null;                            // need more runs than parameters
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const xi = X[i], yi = y[i];
    for (let a = 0; a < p; a++) {
      Xty[a] += xi[a] * yi;
      for (let b = 0; b < p; b++) XtX[a][b] += xi[a] * xi[b];
    }
  }
  // Tiny ridge (trace-scaled) so a degenerate/collinear column can't make X'X
  // singular; negligible bias, and collinearity still shows as large SE below.
  let tr = 0; for (let a = 0; a < p; a++) tr += XtX[a][a];
  const lambda = 1e-8 * ((tr / p) || 1);
  for (let a = 0; a < p; a++) XtX[a][a] += lambda;
  const inv = invertMatrix(XtX);
  if (!inv) return null;
  const beta = new Array(p).fill(0);
  for (let a = 0; a < p; a++) { let s = 0; for (let b = 0; b < p; b++) s += inv[a][b] * Xty[b]; beta[a] = s; }
  let ssRes = 0;
  for (let i = 0; i < n; i++) { let pred = 0; for (let a = 0; a < p; a++) pred += X[i][a] * beta[a]; const e = y[i] - pred; ssRes += e * e; }
  const df = n - p;
  const sigma2 = ssRes / df;
  const se = new Array(p);
  const t = new Array(p);
  for (let a = 0; a < p; a++) {
    se[a] = Math.sqrt(Math.max(0, sigma2 * inv[a][a]));
    t[a] = se[a] > 0 ? beta[a] / se[a] : 0;
  }
  const yBar = y.reduce((s, v) => s + v, 0) / n;
  let ssTot = 0; for (const v of y) ssTot += (v - yBar) * (v - yBar);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { beta, se, t, n, p, df, r2 };
}

// ── reference points (shared with the training-run confounder gates) ─────────
export const DRIFT_REF = {
  tempRefC: 20,       // °C — heat cost measured above this
  humRefPct: 50,      // %RH — humidity cost measured above this
  elevFloorGpm: 20,   // m·mi⁻¹ — below this is flat/rolling
};

// Build the design matrix + y from runs. Each run needs avgHR; the environmental
// columns are 0 when that stressor is absent/mild (so a cool dry flat run still
// contributes an honest baseline row). A column is DROPPED (and reported absent)
// when it has too little spread to identify — no point fitting a slope to a
// constant. Returns { X, y, cols, n } where cols lists which factors are in X
// (after the intercept), in order.
export function buildDriftDesign(runs = [], usualHR, opts = {}) {
  const ref = { ...DRIFT_REF, ...opts };
  const rows = [];
  for (const a of runs) {
    const hr = Number(a && a.avgHR);
    if (!(hr > 0) || !(usualHR > 0)) continue;
    const temp = Number(a.avgTemperature ?? a.tempC ?? a.weatherTempC);
    const hum  = Number(a.avgHumidity ?? a.humidityPct ?? a.weatherHumidityPct);
    const gainM = Number(a.totalAscentM ?? a.totalAscent ?? a.elevationGain ?? a.elevGainM);
    const miles = Number(a.distanceMi ?? a.distance_mi ?? a.miles);
    const xHeat = Number.isFinite(temp) ? Math.max(0, temp - ref.tempRefC) : 0;
    const xHum  = Number.isFinite(hum)  ? Math.max(0, (hum - ref.humRefPct) / 10) : 0;
    const gpm   = (Number.isFinite(gainM) && gainM > 0 && miles > 0) ? gainM / miles : 0;
    const xElev = gpm > 0 ? Math.max(0, (gpm - ref.elevFloorGpm) / 50) : 0;
    rows.push({ y: (hr - usualHR) / usualHR, xHeat, xHum, xElev });
  }
  if (!rows.length) return { X: [], y: [], cols: [], n: 0 };

  // Keep a column only if it has real spread (≥ a few distinct non-zero values),
  // else its slope is unidentifiable and would just add noise/instability.
  const spread = (key) => {
    const nz = rows.map(r => r[key]).filter(v => v > 0);
    if (nz.length < 3) return false;
    return Math.max(...nz) - Math.min(...rows.map(r => r[key])) > 1e-6;
  };
  const cols = [];
  if (spread('xHeat')) cols.push('heatStrain');
  if (spread('xHum'))  cols.push('humidity');
  if (spread('xElev')) cols.push('elevation');

  const colKey = { heatStrain: 'xHeat', humidity: 'xHum', elevation: 'xElev' };
  const X = rows.map(r => [1, ...cols.map(c => r[colKey[c]])]);   // intercept + kept columns
  const y = rows.map(r => r.y);
  return { X, y, cols, n: rows.length };
}

// THE learner: runs → per-factor sensitivities. Returns:
//   { factors: { heatStrain:{value,confidence,perUnitPct}, humidity:{…}, elevation:{…} },
//     n, r2, baselineDrift }
// value = HR-drift FRACTION per unit (per °C / per 10%RH / per 50 m·mi⁻¹). Only
// factors with enough independent variation appear. Never fabricates: thin/collinear
// data yields low confidence rather than a confident wrong number.
export function learnDriftSensitivities(runs = [], usualHR, opts = {}) {
  const { X, y, cols, n } = buildDriftDesign(runs, usualHR, opts);
  const out = { factors: {}, n, r2: 0, baselineDrift: 0 };
  if (!cols.length) return out;
  const fit = multiOLS(X, y);
  if (!fit) return out;
  out.r2 = +fit.r2.toFixed(3);
  out.baselineDrift = +fit.beta[0].toFixed(4);   // intercept — drift not explained by conditions
  cols.forEach((factor, i) => {
    const b = fit.beta[i + 1];                    // +1: skip intercept
    const conf = tConfidence(fit.t[i + 1], fit.df);
    // Only surface a POSITIVE cost (a stressor lowering HR is noise/anti-signal);
    // clamp negatives to a null-ish, low-confidence read.
    const value = b > 0 ? +b.toFixed(5) : 0;
    out.factors[factor] = {
      value,
      confidence: +conf.toFixed(3),
      perUnitPct: +((value) * 100).toFixed(2),
    };
  });
  return out;
}
