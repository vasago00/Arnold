// Hub core — START-TILE PROMOTION (the hub drives what surfaces on Start).
// Replaces the heuristic scoreTile (core/derive/autoPromote.js): instead of scoring
// each tile off its own recent numbers, the HUB decides what's worth surfacing NOW
// from what it KNOWS about this athlete. Manual pins still win (handled by the
// resolver); the hub only fills the open slots.
//
// Signals, strongest first:
//   • RACE PROXIMITY — a race soon makes the predictor + that discipline matter most.
//   • SENSITIVITY × TODAY'S CONDITIONS — a confounder you're proven sensitive to
//     (heat, sleep, …), when today is actually adverse, surfaces its domain. This is
//     the proactive core the old reactive scorer couldn't do.
//   • BODY / HYDRATION movement — a recent meaningful weight/fluid signal.
//   • CURRENT STATUS — a genuine red/amber flag still surfaces (the hub cares about
//     a metric that just went off); this preserves the one useful bit of the old
//     scorer, but now as a hub input rather than the whole decision.
//   • SESSION RELEVANCE — what you trained today touches its category (light).
//   • FRESHNESS — stale tiles pushed back.
//
// Pure + dependency-injected (deriveStatus passed in to avoid importing the huge
// tileMetrics here). Unit-tested in tests/hubPromote.test.mjs.

import { sensitivityOf } from './responseModel.js';

// Hub factor → the Start tile category(ies) it should surface.
const FACTOR_DOMAIN = {
  heat: ['recovery'], heatStrain: ['recovery'],
  sleep: ['recovery'], sleepAcute: ['recovery'], sleepChronic: ['recovery'],
  hrv: ['recovery'], rhr: ['recovery'],
  fuel: ['body'], load: ['run', 'strength'],
};

const SESSION_CATEGORY = {
  run: ['run', 'recovery'], strength: ['strength', 'recovery'], hyrox: ['strength', 'recovery'],
  mixed: ['run', 'strength', 'recovery'], rest: ['recovery', 'body'],
};

// Is today adverse for this factor, given the conditions we have? Unknown → false
// (the sensitivity still gives a small base pull, but no "today is adverse" spike).
function conditionAdverse(factor, conditions = {}) {
  const t = Number(conditions.tempC);
  const sleep = Number(conditions.sleepHrs);
  switch (factor) {
    case 'heat': case 'heatStrain': return Number.isFinite(t) && t >= 24;
    case 'sleep': case 'sleepAcute': case 'sleepChronic': return Number.isFinite(sleep) && sleep < 7;
    default: return false;
  }
}

// Days until the next upcoming race (null if none).
export function nextRaceDays(races = [], today) {
  if (!today) return null;
  const t0 = new Date(`${today}T12:00:00`).getTime();
  let best = null;
  for (const r of races || []) {
    if (!r?.date) continue;
    const d = new Date(`${r.date}T12:00:00`).getTime();
    if (!Number.isFinite(d) || d < t0) continue;
    const days = Math.round((d - t0) / 86_400_000);
    if (best == null || days < best) best = days;
  }
  return best;
}

// Score one tile for hub-driven promotion. hubCtx:
//   { hubState, conditions:{tempC,sleepHrs}, races:[], today, sessionType, deriveStatus }
export function hubScoreTile(metric, tf, computed, hubCtx = {}) {
  const reasons = [];
  let score = 0;
  const { hubState, conditions = {}, races = [], today, sessionType, deriveStatus } = hubCtx;

  // Log-dependent gate: nutrition tiles with nothing logged today say nothing useful.
  if ((metric?.subgroup === 'fuel' || metric?.subgroup === 'quality')) {
    const v = computed?.value;
    if (v == null || v === 0) return { score: 0, reasons: ['no data logged today yet'] };
  }

  // 1. Race proximity.
  const dr = nextRaceDays(races, today);
  if (dr != null && dr <= 21) {
    const near = dr <= 7 ? 5 : 3;
    if (metric.id === 'racePredictor') { score += near; reasons.push(`race in ${dr}d`); }
    else if (metric.category === 'run') { score += near * 0.4; reasons.push('race coming'); }
  }

  // 2. Learned sensitivities × today's conditions.
  const factors = (hubState && hubState.response && hubState.response.factors) || {};
  for (const f of Object.keys(factors)) {
    const s = sensitivityOf(hubState.response, f);
    if (!(s.confidence > 0.25) || !(Math.abs(s.value) > 0)) continue;
    const domains = FACTOR_DOMAIN[f] || [];
    if (!domains.includes(metric.category)) continue;
    const adverse = conditionAdverse(f, conditions);
    score += (adverse ? 3 : 1) * Math.min(1, s.confidence);
    reasons.push(adverse ? `${f}-sensitive · today is adverse` : `${f}-sensitive`);
  }

  // 3. Body / hydration recent movement (the hub flagged it).
  if (metric.category === 'body' && hubCtx.bodySignal) {
    score += 2; reasons.push('weight/hydration moved');
  }

  // 4. Current status — a real red/amber flag still surfaces.
  const cur = tf?.week ?? computed?.value ?? null;
  const status = (cur != null && metric?.thresholds && typeof deriveStatus === 'function')
    ? deriveStatus(cur, metric.thresholds) : 'neutral';
  if (status === 'red') { score += 3; reasons.push('needs attention'); }
  else if (status === 'amber') { score += 1; reasons.push('monitor'); }

  // 5. Today's session relevance (light nudge).
  if ((SESSION_CATEGORY[sessionType] || []).includes(metric.category)) {
    score += 0.5; reasons.push(`today: ${sessionType}`);
  }

  // 6. Freshness penalty.
  const latestDate = tf?.latestSample?.date || null;
  if (latestDate && today) {
    try {
      const ageDays = Math.round(
        (new Date(`${today}T12:00:00`).getTime() - new Date(`${latestDate}T12:00:00`).getTime()) / 86_400_000);
      if (ageDays > 14) { score -= 2; reasons.push(`stale (${ageDays}d old)`); }
    } catch {}
  }

  return { score: +score.toFixed(3), reasons };
}
