// ─── Intel Context Builder (Phase 4r.intel.7) ────────────────────────────────
// Single source of truth for the `intelCtx` object that drives the intelligence
// layer. Previously inlined inside Arnold.jsx's LogDay; now lives here so
// MobileHome, EdgeIQ, and any future surface can paint metrics against
// expected ranges with one import.
//
// API:
//   buildIntelContext(activity, opts) → intelCtx
//     activity — the activity record currently being inspected (must have
//       date, durationSecs, family/planType, optional avgTemperature, avgHumidity).
//     opts.activities — full activity list (used for rolling TSS + maxHR fallback).
//     opts.profile — user profile (maxHR, etc.).
//     opts.sleep — sleep array (for prior-night sleepScore lookup).
//     opts.baseline — optional learned baseline {mean, std, n} for this metric.
//
//   makePaint(intelCtx) → { paintM, paintT }
//     paintM(metricId, value, categoryColor) → status-aware text color
//     paintT(metricId, value, categoryTint)  → status-aware background tint
//
// Why separate from expectedRanges.js: that file is the rules engine
// (population norms + heat/humidity/fatigue math). This file is the data-
// assembly layer that gathers ctx from local storage + activity records so
// the rules engine has what it needs.

import { paintMetric as paintMetricStatus } from './expectedRanges.js';
import { parseLocalDate } from './dateUtils.js';
import { isHIIT, isHardSession } from './activityClass.js';
import { getBaseline } from './learnedBaselines.js';

// ─── intel context builder ─────────────────────────────────────────────────

/**
 * Compute compounding fatigue inputs (prior-night sleep score, rolling TSS,
 * consecutive hard days). Pure: depends only on inputs, no side effects.
 */
function computeFatigue(activity, activities, sleepArr) {
  try {
    const actDate = (activity && activity.date && typeof activity.date === 'string')
      ? activity.date : null;
    if (!actDate) return null;
    const sleepEntry = (sleepArr || []).find(s => s && s.date === actDate);
    const sleepScorePrev = (sleepEntry && sleepEntry.sleepScore && sleepEntry.sleepScore > 0)
      ? sleepEntry.sleepScore : null;
    const cur = parseLocalDate(actDate);
    if (!cur) {
      return { sleepScorePrev, rollingTSS7: null, rollingTSS28: null, consecutiveHardDays: 0 };
    }
    const d7  = new Date(cur); d7.setDate(d7.getDate() - 7);
    const d28 = new Date(cur); d28.setDate(d28.getDate() - 28);
    const d2  = new Date(cur); d2.setDate(d2.getDate() - 2);
    let tss7 = 0, tss28 = 0, hardInPrior2 = 0;
    for (const a of (activities || [])) {
      const ad = a && a.date && parseLocalDate(a.date);
      if (!ad || ad >= cur) continue;
      const tss = Number(a.trainingStressScore || a.tss || 0);
      if (ad >= d28) tss28 += tss;
      if (ad >= d7)  tss7  += tss;
      if (ad >= d2) {
        if (isHIIT(a) || isHardSession(a)) hardInPrior2 += 1;
      }
    }
    return {
      sleepScorePrev,
      rollingTSS7: tss7 || null,
      rollingTSS28: tss28 || null,
      consecutiveHardDays: hardInPrior2,
    };
  } catch { return null; }
}

/**
 * Build the intelCtx for an activity. Pass in everything needed; no storage
 * access happens here so the function stays pure and easy to test.
 */
export function buildIntelContext(activity, opts) {
  opts = opts || {};
  const activities = opts.activities || [];
  const sleep      = opts.sleep || [];
  const family     = (activity && (activity.planType || activity.family)) || 'run';
  const durationSec = (activity && (activity.durationSecs ?? activity.durationSec)) ?? null;
  const conditions = {
    tempC:       (activity && (activity.avgTemperature ?? activity.tempC)) ?? null,
    humidityPct: (activity && activity.avgHumidity) ?? null,
  };
  const fatigue = computeFatigue(activity, activities, sleep);
  return {
    family,
    durationSec,
    conditions,
    fatigue,
    baseline: opts.baseline, // metric-specific; resolved lazily by getMetricBaseline
  };
}

// ─── learned-baseline lookup ───────────────────────────────────────────────

/**
 * Per-(family, metricId) baseline reader. Returns { mean, std, n } when the
 * user has accumulated at least MIN_OBSERVATIONS for that bucket, else null.
 * Centralized here so MobileHome / EdgeIQ / LogDay all go through the same
 * cache + minimum-n gate.
 */
export function getMetricBaseline(family, metricId) {
  try { return getBaseline(family, metricId); } catch { return null; }
}

// ─── paint helpers ─────────────────────────────────────────────────────────

const TINT_EXPECTED = 'rgba(94,234,212,0.08)';  // teal — in band
const TINT_MILD     = 'rgba(251,191,36,0.10)';  // amber
const TINT_CONCERN  = 'rgba(248,113,113,0.10)'; // red

/**
 * Factory that closes over an intelCtx and returns paintM / paintT helpers
 * matching the inline _paintM / _paintT pattern that LogDay used.
 *
 * paintM:
 *   - 'expected' → returns 'var(--text-primary)' (lets the eye rest)
 *   - 'mild' / 'concern' → returns the status color from expectedRanges
 *   - 'neutral' or exception → returns categoryColor fallback
 *
 * paintT:
 *   - 'expected' → teal wash (affirms in-band)
 *   - 'mild'     → amber wash
 *   - 'concern'  → coral wash
 *   - 'neutral' or exception → categoryTint fallback
 */
export function makePaint(intelCtx) {
  const paintM = (metricId, value, categoryColor) => {
    try {
      // Layer 2 blend: look up the user's per-(family, metricId) baseline
      // and stitch it onto ctx so expectedRanges blendWithBaseline kicks in.
      const baseline = getMetricBaseline(intelCtx && intelCtx.family, metricId);
      const ctxWithBaseline = baseline ? { ...intelCtx, baseline } : intelCtx;
      const result = paintMetricStatus(metricId, value, categoryColor, ctxWithBaseline);
      if (typeof window !== 'undefined' && window.__INTEL_DEBUG__) {
        // eslint-disable-next-line no-console
        console.log(
          '[intel]', metricId,
          'value=', value,
          'status=', result.status,
          'band=', result.expected,
          'family=', intelCtx && intelCtx.family,
          'temp=', intelCtx && intelCtx.conditions && intelCtx.conditions.tempC,
          'hum=', intelCtx && intelCtx.conditions && intelCtx.conditions.humidityPct,
          'fat=', intelCtx && intelCtx.fatigue,
          'dur=', intelCtx && intelCtx.durationSec,
        );
      }
      if (result.status === 'expected') return 'var(--text-primary)';
      return result.color;
    } catch (e) {
      if (typeof window !== 'undefined' && window.__INTEL_DEBUG__) {
        // eslint-disable-next-line no-console
        console.error('[intel] EXCEPTION', metricId, e && e.message);
      }
      return categoryColor;
    }
  };
  const paintT = (metricId, value, categoryTint) => {
    try {
      const baseline = getMetricBaseline(intelCtx && intelCtx.family, metricId);
      const ctxWithBaseline = baseline ? { ...intelCtx, baseline } : intelCtx;
      const result = paintMetricStatus(metricId, value, '#000', ctxWithBaseline);
      if (result.status === 'expected') return TINT_EXPECTED;
      if (result.status === 'mild')     return TINT_MILD;
      if (result.status === 'concern')  return TINT_CONCERN;
      return categoryTint;
    } catch { return categoryTint; }
  };
  return { paintM, paintT };
}

// ─── maxHR fallback chain ──────────────────────────────────────────────────

/**
 * Phase 4r.intel.6 fallback chain for maxHR used to compute %maxHR for the
 * intel layer:
 *   1. getEffectiveMaxHR(profile, activities) — user-set OR recent peak.
 *   2. Highest recorded maxHR across activities (>100 sanity gate).
 *   3. null — caller lets %maxHR derive to null → tile falls to neutral.
 *
 * Caller passes getEffectiveMaxHR so we don't couple this module to derive/.
 */
export function resolveIntelMaxHR(getEffectiveMaxHR, profile, activities) {
  try {
    const fromFn = getEffectiveMaxHR && getEffectiveMaxHR(profile, activities);
    if (fromFn && Number.isFinite(fromFn) && fromFn > 100) return fromFn;
    const maxes = (activities || [])
      .map(a => Number(a && a.maxHR))
      .filter(n => Number.isFinite(n) && n > 100);
    if (maxes.length) return Math.max(...maxes);
    return null;
  } catch { return null; }
}
