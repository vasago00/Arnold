// Adaptive plan — Phase 2.1 of the uplift. Closes the loop: the hub's readiness +
// recovery signals reshape the PRESCRIBED session, with the reason shown. This is
// TrainAsONE/Runna's core hook, on Arnold's deterministic engine.
//
// Pure: takes a planned session + a readiness context, returns the adjusted
// prescription. No storage, no UI — unit-tested in adaptPlan.test.js. The
// pre-workout tile / plan view map their existing readiness signals to `ctx` and
// render `{ action, reason }`.

const HARD = new Set(['tempo', 'intervals', 'hiit', 'threshold', 'speed', 'hard', 'race']);

// Pick the single dominant limiter (worst signal) → the reason we SHOW.
function dominantLimiter({ readiness, debtLbs, hrvDelta, sleepHrs, sleepGoalHrs, fatigueLevel }) {
  const out = [];
  if (debtLbs >= 2)                                          out.push({ sev: 3, why: `${debtLbs.toFixed(1)} lb recovery residual` });
  else if (debtLbs >= 1)                                     out.push({ sev: 1, why: `${debtLbs.toFixed(1)} lb residual from recent sessions` });
  if (Number.isFinite(hrvDelta) && hrvDelta <= -12)          out.push({ sev: 3, why: `HRV ${hrvDelta} below your baseline` });
  else if (Number.isFinite(hrvDelta) && hrvDelta <= -6)      out.push({ sev: 1, why: `HRV a touch low` });
  if (Number.isFinite(sleepHrs) && Number.isFinite(sleepGoalHrs) && sleepHrs < sleepGoalHrs - 1.5)
                                                             out.push({ sev: 2, why: `short on sleep (${sleepHrs}h)` });
  // Body-battery / fatigue model (the header battery icon). Folding it in here
  // keeps the coach honest: a depleted battery can no longer co-exist with a
  // "recovered / cleared" verdict, because any fatigue ≥2 lifts sev ≥2, which
  // both blocks the greenlit path (needs sev===0) and eases a hard session.
  if (Number(fatigueLevel) >= 3)                            out.push({ sev: 3, why: `battery reads heavily depleted` });
  else if (Number(fatigueLevel) >= 2)                       out.push({ sev: 2, why: `battery reads depleted` });
  else if (Number(fatigueLevel) >= 1)                       out.push({ sev: 1, why: `battery a touch low` });
  if (readiness === 'low')                                   out.push({ sev: 2, why: `low readiness this morning` });
  out.sort((a, b) => b.sev - a.sev);
  return out[0] || null;
}

// Cut a planned volume (distance or duration) by `frac` (0..1), rounded sensibly.
function cutVolume(planned, frac) {
  const out = { ...planned };
  if (Number(planned.distanceMi) > 0) out.distanceMi = Math.max(1, Math.round(planned.distanceMi * (1 - frac) * 10) / 10);
  if (Number(planned.durationMin) > 0) out.durationMin = Math.max(10, Math.round(planned.durationMin * (1 - frac) / 5) * 5);
  return out;
}

/**
 * adaptSession(planned, ctx) → adjusted prescription.
 *
 * planned: { type, intensityClass?, distanceMi?, durationMin?, label? }
 * ctx:     { readiness:'low'|'moderate'|'high', debtLbs, hrvDelta, sleepHrs, sleepGoalHrs, fatigueLevel:0..3 }
 * returns: { ...session, action:'ease'|'trim'|'hold'|'greenlit', eased:bool, reason:string|null }
 */
export function adaptSession(planned, ctx = {}) {
  if (!planned || planned.type === 'rest') {
    return { ...planned, action: 'hold', eased: false, reason: null };
  }
  const {
    readiness = 'moderate', debtLbs = 0,
    hrvDelta = null, sleepHrs = null, sleepGoalHrs = null, fatigueLevel = 0,
  } = ctx;

  const isHard = HARD.has(planned.intensityClass) || HARD.has(planned.type);
  const lim = dominantLimiter({ readiness, debtLbs, hrvDelta, sleepHrs, sleepGoalHrs, fatigueLevel });
  const sev = lim ? lim.sev : 0;

  // Hard session + a strong limiter → EASE: drop intensity to aerobic, cut volume.
  if (isHard && sev >= 2) {
    const eased = cutVolume(planned, 0.25);
    eased.intensityClass = 'easy';
    return { ...eased, action: 'ease', eased: true, reason: `Eased to Z2 — ${lim.why}.` };
  }

  // Hard session + a mild limiter → TRIM: keep the session, cut ~15%.
  if (isHard && sev >= 1) {
    const trimmed = cutVolume(planned, 0.15);
    return { ...trimmed, action: 'trim', eased: true, reason: `Trimmed ~15% — ${lim.why}.` };
  }

  // Strong morning, no debt → green-light the full session.
  if (readiness === 'high' && debtLbs < 0.5 && sev === 0) {
    return { ...planned, action: 'greenlit', eased: false, reason: `Recovered — cleared for the full ${planned.label || planned.type}.` };
  }

  // Otherwise hold the plan as written.
  return { ...planned, action: 'hold', eased: false, reason: null };
}

export default adaptSession;
