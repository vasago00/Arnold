// Hub core — COACH INSIGHTS. Turns the hub's learned facts into short, actionable
// Coach-voice clauses, so the intelligence the hub accumulates (heat strain, sweat
// rate, race-readiness, response sensitivities) actually shows up where the athlete
// reads it daily — not just in the HubPanel. Pure: takes hubFacts + today's
// conditions, returns insight objects { kind, tag, severity, text }. The Coach
// (CoachComment) decides which surfaces to speak them on. Unit-tested in
// tests/hubCoachInsights.test.mjs.

const HEAT_REF_C = 20;     // heat cost is measured above this mild reference
const HEAT_HOT_C = 24;     // below this there's no real heat load to coach
const HEAT_MIN_CONF = 0.4; // don't speak a sensitivity we're not reasonably sure of
const HEAT_MIN_PCT = 3;    // ignore a trivially small predicted cost

const SWEAT_MIN_N = 2;     // need ≥2 weigh-in observations before we trust the rate
const FIT_MIN_CONF = 0.3;  // don't speak a low-confidence fitness read
const SENS_MIN_CONF = 0.4; // confidence floor for a learned sensitivity
const SENS_MIN_PCT = 1;    // ignore a trivially small per-unit effect

const DIST_KM = { '5K': 5, '10K': 10, 'HM': 21.0975, 'M': 42.195 };

// "It's hot and you're heat-sensitive" → ease pace + hydrate. Uses the LEARNED
// heatStrain sensitivity (%/°C) × how far today is above the reference.
export function heatInsight(facts, tempC) {
  if (!facts || !Number.isFinite(tempC) || tempC < HEAT_HOT_C) return null;
  const hs = (facts.responses || []).find(r => r.factor === 'heatStrain');
  if (!hs || !(hs.confidence >= HEAT_MIN_CONF) || !(hs.perUnitPct > 0)) return null;
  const strainPct = Math.round(hs.perUnitPct * (tempC - HEAT_REF_C));
  if (strainPct < HEAT_MIN_PCT) return null;
  return {
    kind: 'heat', tag: 'Heat', severity: 'gentle',
    text: `At ${Math.round(tempC)}°C you carry ~${strainPct}% more cardiac strain than a cool day — keep the effort easy and get fluids in early.`,
  };
}

// "Here's what you'll sweat" → match fluids to the session. Uses the LEARNED
// sweat-rate model; quantifies a target when we know the session length.
export function sweatInsight(facts, sessionMins) {
  const s = facts && facts.sweat;
  if (!s || !(s.rateLhr > 0) || !(s.n >= SWEAT_MIN_N)) return null;
  if (Number.isFinite(sessionMins) && sessionMins >= 20) {
    const liters = +(s.rateLhr * (sessionMins / 60)).toFixed(1);
    return {
      kind: 'sweat', tag: 'Hydration', severity: 'neutral',
      text: `Your sweat rate runs ~${s.rateLhr} L/hr — for today's ~${Math.round(sessionMins)} min, aim for ~${liters} L of fluid to finish even.`,
    };
  }
  return {
    kind: 'sweat', tag: 'Hydration', severity: 'neutral',
    text: `Your learned sweat rate is ~${s.rateLhr} L/hr — match fluids to how long you're out.`,
  };
}

// "Where your fitness has you" → race readiness vs the next goal. Uses the fitness
// model's race-equivalent predictions; states the gap to goal when one is set.
export function fitnessInsight(facts, race) {
  if (!facts || !Array.isArray(facts.predictions) || !facts.predictions.length) return null;
  if (!(facts.fitnessConfidence >= FIT_MIN_CONF)) return null;

  // Target the next race's distance when known, else lead with the half.
  let target = 'HM';
  if (race && race.distanceKm > 0) {
    target = facts.predictions
      .map(p => p.dist)
      .reduce((best, d) =>
        Math.abs((DIST_KM[d] ?? 1e9) - race.distanceKm) < Math.abs((DIST_KM[best] ?? 1e9) - race.distanceKm) ? d : best, 'HM');
  }
  const p = facts.predictions.find(x => x.dist === target);
  if (!p || !(p.secs > 0)) return null;
  const conf = Math.round(facts.fitnessConfidence * 100);
  const label = (race && race.label) ? race.label : target;

  if (race && race.goalSecs > 0) {
    const gap = p.secs - race.goalSecs;
    const mins = Math.round(Math.abs(gap) / 60);
    if (mins < 1) {
      return { kind: 'fitness', tag: 'Race readiness', severity: 'positive',
        text: `On current fitness you're right on your ${label} goal (~${p.time}). Hold the plan.` };
    }
    const side = gap > 0 ? 'behind' : 'ahead of';
    return { kind: 'fitness', tag: 'Race readiness', severity: gap > 0 ? 'gentle' : 'positive',
      text: `On current fitness you're tracking ~${p.time} for the ${label} — about ${mins} min ${side} your goal (confidence ${conf}%).` };
  }
  return { kind: 'fitness', tag: 'Fitness', severity: 'neutral',
    text: `Your fitness models a ~${p.time} ${target} right now (confidence ${conf}%).` };
}

// Per-factor phrasing for the OTHER learned sensitivities (sleep / fuel). Heat is
// handled by heatInsight; these surface the next-strongest learned pattern.
const SENS_COPY = {
  sleep:       pct => `Each hour of sleep is worth ~${pct}% in your session quality — protect tonight's.`,
  sleepAcute:  pct => `A short night costs you ~${pct}% per hour lost — bank sleep before key days.`,
  sleepChronic:pct => `Your week's sleep debt is worth ~${pct}%/h to your training — even it out.`,
  fuel:        pct => `Under-fueling costs you ~${pct}% per session — top up carbs around hard days.`,
};

// "Here's a pattern I've learned about you" → the strongest non-heat sensitivity.
export function sensitivityInsight(facts) {
  const rs = (facts && facts.responses) || [];
  const r = rs.find(x => SENS_COPY[x.factor] && x.confidence >= SENS_MIN_CONF && Math.abs(x.perUnitPct) >= SENS_MIN_PCT);
  if (!r) return null;
  return { kind: 'sensitivity', tag: 'Pattern', severity: 'gentle', text: SENS_COPY[r.factor](Math.abs(Math.round(r.perUnitPct))) };
}

// All hub coaching insights for the current context, most actionable first:
// today's conditions (heat → hydration), then where fitness has you (race
// readiness), then the strongest learned pattern. conditions: { tempC,
// sessionMins, race: { label, distanceKm, goalSecs } }.
export function hubCoachInsights(facts, conditions = {}) {
  const out = [];
  const heat = heatInsight(facts, Number(conditions.tempC));
  if (heat) out.push(heat);
  const sweat = sweatInsight(facts, Number(conditions.sessionMins));
  if (sweat) out.push(sweat);
  const fit = fitnessInsight(facts, conditions.race);
  if (fit) out.push(fit);
  const sens = sensitivityInsight(facts);
  if (sens) out.push(sens);
  return out;
}
