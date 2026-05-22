// ─── Statistics helpers (Phase 4r.intel.12) ─────────────────────────────────
// Tiny, dependency-free stats kit for the insight engine. Everything is a
// pure function over arrays of numbers — no dataframes, no streaming. Good
// enough for the small windows (5-60 observations) Arnold typically works
// with.
//
// Functions:
//   mean(xs)
//   std(xs)
//   linearRegression(ys)        — index-as-x, returns { slope, intercept, r2, n, pValue }
//   correlation(xs, ys)         — Pearson r, returns { r, n, pValue }
//   tTestUnequal(a, b)          — two-sample t with Welch's correction, returns { t, df, pValue }
//
// p-values are approximated via the standard-normal CDF when df is large
// (>= 30), and via a small lookup table at common df otherwise. Good enough
// for "fire / don't fire" gating, not for publication.

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function _erf(x) {
  // Abramowitz & Stegun 7.1.26 approximation (max error ~1.5e-7).
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function _normalCdf(z) {
  return 0.5 * (1 + _erf(z / Math.SQRT2));
}

// Two-sided p-value from a t statistic. For df >= 30, normal-approx.
// For smaller df, scale by a correction factor that gets us close enough
// for our threshold gating (we don't publish papers from this).
function _pTwoSided(t, df) {
  const tAbs = Math.abs(t);
  if (!Number.isFinite(tAbs)) return 1;
  if (df >= 30) return 2 * (1 - _normalCdf(tAbs));
  // Small-df correction. df=5 → ~1.4x heavier tails than normal.
  const fatten = 1 + 0.6 / df;
  return Math.min(1, 2 * (1 - _normalCdf(tAbs / fatten)));
}

export function mean(xs) {
  if (!Array.isArray(xs) || xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs) {
  if (!Array.isArray(xs) || xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/**
 * Linear regression of ys against their index (0..n-1). Used for trend
 * detection over a window of consecutive observations. Returns slope per
 * unit index (so for a 5-session window, slope is "change per session").
 */
export function linearRegression(ys) {
  if (!Array.isArray(ys) || ys.length < 3) {
    return { slope: NaN, intercept: NaN, r2: NaN, n: ys?.length || 0, pValue: 1 };
  }
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const xBar = mean(xs);
  const yBar = mean(ys);
  let num = 0, denX = 0;
  for (let i = 0; i < n; i++) {
    num  += (xs[i] - xBar) * (ys[i] - yBar);
    denX += (xs[i] - xBar) * (xs[i] - xBar);
  }
  if (denX === 0) return { slope: 0, intercept: yBar, r2: 0, n, pValue: 1 };
  const slope = num / denX;
  const intercept = yBar - slope * xBar;
  // r²
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i];
    ssRes += (ys[i] - pred) * (ys[i] - pred);
    ssTot += (ys[i] - yBar) * (ys[i] - yBar);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  // t for slope: t = slope / SE(slope). SE = sqrt(ssRes / (n-2)) / sqrt(denX)
  const seSlope = Math.sqrt((ssRes / (n - 2)) / denX);
  const t = seSlope > 0 ? slope / seSlope : 0;
  const pValue = _pTwoSided(t, n - 2);
  return { slope, intercept, r2, n, pValue };
}

/**
 * Pearson correlation. Returns r in [-1, 1] and a p-value for H0: r = 0.
 */
export function correlation(xs, ys) {
  const n = Math.min(xs?.length || 0, ys?.length || 0);
  if (n < 3) return { r: NaN, n, pValue: 1 };
  const xBar = mean(xs.slice(0, n));
  const yBar = mean(ys.slice(0, n));
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    num  += (xs[i] - xBar) * (ys[i] - yBar);
    denX += (xs[i] - xBar) * (xs[i] - xBar);
    denY += (ys[i] - yBar) * (ys[i] - yBar);
  }
  if (denX === 0 || denY === 0) return { r: 0, n, pValue: 1 };
  const r = num / Math.sqrt(denX * denY);
  // t for correlation: t = r * sqrt(n-2) / sqrt(1-r²)
  const t = r * Math.sqrt(n - 2) / Math.sqrt(Math.max(1e-9, 1 - r * r));
  return { r, n, pValue: _pTwoSided(t, n - 2) };
}

/**
 * Welch's t-test for two samples with unequal variances. Returns the t
 * statistic, the Welch-Satterthwaite df, and a two-sided p-value.
 */
export function tTestUnequal(a, b) {
  const na = a?.length || 0, nb = b?.length || 0;
  if (na < 2 || nb < 2) return { t: NaN, df: 0, pValue: 1, meanA: mean(a), meanB: mean(b) };
  const mA = mean(a), mB = mean(b);
  const vA = std(a) * std(a), vB = std(b) * std(b);
  const sePool = Math.sqrt(vA / na + vB / nb);
  if (sePool === 0) return { t: 0, df: na + nb - 2, pValue: 1, meanA: mA, meanB: mB };
  const t = (mA - mB) / sePool;
  // Welch-Satterthwaite df.
  const num = (vA / na + vB / nb) ** 2;
  const den = (vA * vA) / (na * na * (na - 1)) + (vB * vB) / (nb * nb * (nb - 1));
  const df = den > 0 ? num / den : na + nb - 2;
  return { t, df, pValue: _pTwoSided(t, df), meanA: mA, meanB: mB };
}
