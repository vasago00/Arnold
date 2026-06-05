// Hub core — the ROUTER. One graded effort in → both ledgers updated + an
// explainable log out. This is the closed loop from INTELLIGENCE_HUB.md:
// grade cleanliness → fitness update (precision damped by confounds) +
// residual → response model. See docs/HUB_CORE.md.
//
// Consumes the attribution engine's result shape:
//   { verdict, divergencePct, effort, acute[], chronic[], ... }
// Pure, unit-tested in tests/hubIngest.test.mjs.

import { observeOutcome } from './responseModel.js';
import { updateFitness } from './fitnessModel.js';

const GRADED_VERDICTS = new Set(['underperformed', 'overperformed', 'as-expected']);

// Grade a checkpoint. Two SEPARATE questions (the cut-4 refinement):
//   • FITNESS precision (obsPrecision) — how much this effort should count as a
//     fitness read. A race is a direct measurement of capability whether or not
//     we predicted it, so this does NOT require a prior expectation. Scaled by
//     cleanliness (confounds) × effort completeness.
//   • RESPONSE eligibility (responseable) — needs an actual residual to attribute
//     (the athlete was SLOWER than expected: divergencePct > 0).
export function gradeCheckpoint(attribution) {
  const acute = (attribution && attribution.acute) || [];
  const confoundLoad = acute.reduce((s, f) => s + (Number.isFinite(f.confidence) ? f.confidence : 0.5), 0);
  const cleanliness = 1 / (1 + confoundLoad);            // no confounds → 1; heavy → →0

  const effort = attribution && attribution.effort;
  const verdict = attribution && attribution.verdict;
  // A maximal effort (hard, or a race that was graded against an expectation)
  // counts fully; tempo half; easy / unknown a quarter.
  const effortFactor = (effort === 'hard' || GRADED_VERDICTS.has(verdict)) ? 1
    : effort === 'tempo' ? 0.5 : 0.25;
  const obsPrecision = cleanliness * effortFactor;

  const div = attribution ? attribution.divergencePct : null;
  const hasExpectation = Number.isFinite(div);
  const responseable = hasExpectation && div > 0;

  const reasons = [
    `cleanliness ${cleanliness.toFixed(2)} (confound load ${confoundLoad.toFixed(2)})`,
    `effort weight ${effortFactor} (${effort || (GRADED_VERDICTS.has(verdict) ? 'race-graded' : 'unknown')})`,
  ];
  if (!hasExpectation) reasons.push('no prior expectation — fitness read only, no residual to attribute');
  return { cleanliness, effortFactor, confoundLoad, obsPrecision, hasExpectation, responseable, reasons };
}

// Route a checkpoint into both ledgers.
//   state = { fitnessModel, responseModel }
//   attribution = attributeOutcome(...) result
//   opts.paramObservations = [{ param, observedValue, halfLifeWeeks? }] — what this
//       effort says about each fitness param (e.g. observed race-equivalent time).
//       The caller derives these from the race result; the router applies them at
//       the graded precision. No paramObservations (e.g. a hybrid/HYROX with no
//       running-equivalent) → fitness untouched.
// Returns { fitnessModel, responseModel, log }.
export function ingestCheckpoint(state, attribution, opts = {}) {
  const ageWeeks = opts.ageWeeks ?? 0;
  const halfLifeWeeks = opts.halfLifeWeeks;
  const paramObservations = opts.paramObservations || [];

  let fitnessModel = state.fitnessModel;
  let responseModel = state.responseModel;

  const grade = gradeCheckpoint(attribution);
  const div = attribution ? attribution.divergencePct : null;

  // ── Fitness ledger ── (a real fitness observation, damped by cleanliness×effort;
  // does NOT require a prior prediction — a first race still seeds fitness)
  const fitness = [];
  if (grade.obsPrecision > 0) {
    for (const po of paramObservations) {
      const r = updateFitness(fitnessModel, po.param, po.observedValue, grade.obsPrecision,
        { ageWeeks, halfLifeWeeks: po.halfLifeWeeks ?? halfLifeWeeks });
      fitnessModel = r.model;
      fitness.push(r.log);
    }
  } else {
    for (const po of paramObservations) fitness.push({ param: po.param, applied: false, reason: 'zero graded precision' });
  }

  // ── Response ledger ── (needs a residual where the athlete was SLOWER than
  // expected; beating expectation despite a confounder is a fitness signal, not
  // proof the confounder helped)
  let response;
  if (grade.responseable) {
    responseModel = observeOutcome(responseModel, div, attribution.acute, { ageWeeks, halfLifeWeeks });
    const moved = (attribution.acute || [])
      .filter(f => f && f.timescale !== 'chronic' && Number.isFinite(f.magnitude) && f.magnitude > 0)
      .map(f => f.factor);
    response = { applied: moved.length > 0, moved, divergence: div };
    if (!moved.length) response.reason = 'underperformed but no acute confounder — a fitness signal';
  } else {
    response = { applied: false, moved: [], divergence: div,
      reason: !grade.hasExpectation ? 'no expectation — no residual to attribute'
        : (Number.isFinite(div) && div <= 0 ? 'met/beat expectation — fitness signal' : 'no divergence') };
  }

  const summary = buildSummary(grade, fitness, response);
  return { fitnessModel, responseModel, log: { grade, fitness, response, summary } };
}

function buildSummary(grade, fitness, response) {
  const fitApplied = fitness.filter(f => f.applied);
  const parts = [`Graded at precision ${grade.obsPrecision.toFixed(2)} (${grade.reasons.join('; ')}).`];
  if (fitApplied.length) parts.push(`Fitness: updated ${fitApplied.map(f => f.param).join(', ')}${fitApplied.some(f => f.clamped) ? ' (some clamped)' : ''}.`);
  else parts.push('Fitness: no param moved.');
  if (response.applied) parts.push(`Response: residual ${(response.divergence * 100).toFixed(1)}% partitioned to ${response.moved.join(' + ')}.`);
  else if (response.reason) parts.push(`Response: ${response.reason}.`);
  return parts.join(' ');
}
