// ─── core/energyExpenditure.js — THE one energy-expenditure service (Coach Unif. Slice 2) ──
//
// Arnold had three TDEE computations that disagreed (we logged 689 vs 2038 for the same
// day). They aren't redundant — they're a CONFIDENCE HIERARCHY, and they answer TWO
// different questions. This module is the single place that composes them, so every
// surface (EdgeIQ balance, DCY card, fuel, cut math, transparency hero) reads ONE answer.
//
// The two questions:
//   • "What did I burn TODAY?"  → today-specific. Device 24/7 total (when present &
//     plausible) beats the activity model. A 4-week empirical average is the WRONG answer
//     here — it would flatten a hard-workout day.
//   • "What's my MAINTENANCE?"  → the stable baseline the cut is built on. Here the
//     empirical TDEE (intake ± real weight change) is ground truth when we have enough
//     data; otherwise we fall back to today's expenditure.
//
// Sources, best → worst:
//   empirical  — back-calculated from intake & weight trend (maintenance only)
//   device     — watch's measured 24/7 total (dcy Tier 1, already gated ≥ RMR)
//   model      — RMR + activity + de-duped NEAT + TEF (always available, decomposable)
//
// Pure selectors (pickExpenditure / pickMaintenance) are unit-tested; the orchestrator
// energyExpenditure(date) wires them to live data. Decomposition always comes from the
// model so callers that need "explain why" / eat-back (restingTdee) have it regardless
// of which source won the headline.

import { localDate } from './time.js';
import { computeTDEE, empiricalTDEE } from './energyBalance.js';
import { tdeeWithTier as _dcyTdeeWithTier } from './dcy.js';

// ── Pure selectors ───────────────────────────────────────────────────────────

// "What did I burn today?" — trust a real device total over the model; never empirical.
// deviceTdee is already null unless dcy produced a plausible Tier-1 (device) total.
export function pickExpenditure({ deviceTdee = null, modelTdee = 0 } = {}) {
  if (deviceTdee != null && deviceTdee > 0) {
    return { value: Math.round(deviceTdee), source: 'device', confidence: 'medium' };
  }
  return { value: Math.round(modelTdee || 0), source: 'model', confidence: 'low' };
}

// "What's my maintenance?" — empirical (ground truth) when confident, else today's
// expenditure as the fallback baseline.
export function pickMaintenance({ expenditureTdee = 0, empirical = null, empConfidence = 'insufficient' } = {}) {
  if (empirical != null && empirical > 0 && (empConfidence === 'high' || empConfidence === 'medium')) {
    return { value: Math.round(empirical), source: 'empirical', confidence: empConfidence };
  }
  return { value: Math.round(expenditureTdee || 0), source: 'expenditure', confidence: 'low' };
}

const _EXP_NOTE = {
  device: 'Measured by your watch',
  model: 'Estimated from your activity model',
};
const _MAINT_NOTE = {
  empirical: 'From your weight trend',
  expenditure: "From today's expenditure",
};

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * The one energy-expenditure answer for a date.
 * @returns {{
 *   date: string,
 *   tdee: number, source: 'device'|'model', confidence: string, note: string,
 *   maintenance: { value: number, source: 'empirical'|'expenditure', confidence: string, note: string },
 *   rmr: number, activityKcal: number, neatKcal: number, tefKcal: number,
 *   restingTdee: number, intakeKcal: number,
 *   candidates: { device: number|null, model: number, empirical: number|null },
 * }}
 */
export function energyExpenditure(dateStr) {
  const date = dateStr || localDate();

  // Model decomposition — always available, decomposable (the "explain why" + eat-back).
  const model = computeTDEE(date);

  // Device total — ONLY a genuine Tier-1 (watch 24/7 total, already gated ≥ RMR in dcy).
  let deviceTdee = null;
  try { const d = _dcyTdeeWithTier(date); if (d && d.tier === 1) deviceTdee = d.value; } catch { /* model stands */ }

  // Empirical maintenance — ground truth when confident.
  let emp = null;
  try { emp = empiricalTDEE(); } catch { /* fall back to expenditure */ }

  const exp = pickExpenditure({ deviceTdee, modelTdee: model.tdee });
  const maint = pickMaintenance({
    expenditureTdee: exp.value,
    empirical: emp?.empiricalTDEE ?? null,
    empConfidence: emp?.confidence ?? 'insufficient',
  });

  return {
    date,
    // Headline = TODAY's expenditure.
    tdee: exp.value,
    source: exp.source,
    confidence: exp.confidence,
    note: _EXP_NOTE[exp.source],
    // Maintenance baseline (for the cut + transparency).
    maintenance: {
      value: maint.value,
      source: maint.source,
      confidence: maint.confidence,
      note: _MAINT_NOTE[maint.source] + (maint.source === 'empirical' && maint.confidence ? ` (${maint.confidence} confidence)` : ''),
    },
    // Decomposition (model) — single source for breakdowns + eat-back.
    rmr: model.rmr,
    activityKcal: model.activityKcal,
    neatKcal: model.neatKcal,
    tefKcal: model.tefKcal,
    restingTdee: model.restingTdee,
    intakeKcal: model.intakeKcal,
    // Raw candidates for transparency / debugging.
    candidates: { device: deviceTdee, model: model.tdee, empirical: emp?.empiricalTDEE ?? null },
  };
}
