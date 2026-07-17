// coachRefuel — turns a logged session + the day's fuel numbers into SPECIFIC,
// actionable coaching (grams, kcal, and the reason), instead of generic "now eat"
// filler. Pure + node-testable. Consumed by CoachComment's Play/Fuel lines.
//
// Grounding (defensible, tunable):
//   • Post-exercise glycogen replenishment is fastest in the first ~60 min; the
//     rate-limiting nutrient is CARBS, ~1.0–1.2 g/kg for a hard/long session,
//     scaling down for easy/short work (Ivy; Burke). We give a single 30-min
//     "get this in now" target, not a per-hour rate, so it's actionable.
//   • Protein ~0.3 g/kg (≈20–40 g) supports muscle repair post-session.
//   • Running energy ≈ 1 kcal per kg per km (a standard field estimate).

const HARD = new Set(['tempo', 'threshold', 'intervals', 'hiit', 'race', 'speed', 'fartlek']);

function round5(x) { return Math.round(x / 5) * 5; }

// Refuel target for a just-finished session.
//   session: { distanceMi?, durationMin?, durationSecs?, intensity?/intensityClass?/type? }
//   bodyKg:  athlete mass (defaults 70)
// → { carbsG, proteinG, kcal, long, hard, load }
export function refuelForSession(session = {}, bodyKg = 70) {
  const kg = Number(bodyKg) > 0 ? Number(bodyKg) : 70;
  const distanceMi = Number(session.distanceMi) || 0;
  const durationMin = Number(session.durationMin)
    || (Number(session.durationSecs) ? Number(session.durationSecs) / 60 : 0)
    || (distanceMi > 0 ? distanceMi * 9 : 0);   // ~9 min/mi fallback when only distance is known
  const intensity = String(session.intensity || session.intensityClass || session.type || '').toLowerCase();
  const hard = HARD.has(intensity);
  const long = distanceMi >= 13 || durationMin >= 90;

  // carbs g/kg for the 30-min window — easy/short 0.5 → hard/long 1.1
  let carbCoef;
  if (long) carbCoef = 1.1;
  else if (hard) carbCoef = 0.9;
  else if (durationMin >= 60) carbCoef = 0.8;
  else if (durationMin >= 40) carbCoef = 0.6;
  else carbCoef = 0.5;

  const carbsG = Math.max(20, round5(kg * carbCoef));
  const proteinG = Math.min(40, Math.max(20, round5(kg * 0.3)));
  const kcal = distanceMi > 0
    ? Math.round(distanceMi * 1.60934 * kg)
    : (durationMin > 0 ? Math.round(durationMin * 11 * (kg / 70)) : 0);

  return { carbsG, proteinG, kcal, long, hard, load: long ? 'long' : hard ? 'hard' : durationMin >= 60 ? 'moderate' : 'easy' };
}

// One-line refuel guidance naming the session + the specifics + the reason.
//   label: human session label ("long run", "tempo", "easy run")
export function refuelPhrase(session, bodyKg, label = 'session') {
  const r = refuelForSession(session, bodyKg);
  const why = r.long ? 'to refill the glycogen that long drained'
    : r.hard ? 'to refill glycogen and repair the hard effort'
    : 'to top up and kickstart recovery';
  const kcalTxt = r.kcal > 0 ? ` (~${r.kcal.toLocaleString()} kcal out)` : '';
  return { text: `That ${label}${kcalTxt} — get ~${r.carbsG}g carbs + ${r.proteinG}g protein in the next 30 min ${why}.`, ...r };
}

// Fuel-gap guidance for the rest of the day, using the REAL remaining gap and
// (optionally) tomorrow's session so the advice is purposeful, not a nag.
//   intake/protein/kcalT/proteinT: today's totals + targets
//   tomorrowLabel: e.g. "intervals", "long run", null
// → { text, kcalGap, proteinGap } | null when nothing useful to say
export function fuelGapAdvice({ intake = 0, protein = 0, kcalT = 0, proteinT = 0, tomorrowLabel = null, tomorrowHard = false } = {}) {
  const kcalGap = Math.max(0, Math.round((kcalT || 0) - (intake || 0)));
  const proteinGap = Math.max(0, Math.round((proteinT || 0) - (protein || 0)));
  if (!kcalT && !proteinT) return null;

  const parts = [];
  if (kcalGap >= 150) parts.push(`${kcalGap.toLocaleString()} kcal`);
  if (proteinGap >= 12) parts.push(`${proteinGap}g protein`);

  // The "why" — tie the remaining gap to tomorrow's demand when it's meaningful.
  let tail;
  if (tomorrowLabel && tomorrowHard) tail = ` — and ${tomorrowLabel} tomorrow needs the tank full. A carb-forward dinner closes it.`;
  else if (tomorrowLabel) tail = ` before ${tomorrowLabel} tomorrow. Dinner covers it.`;
  else tail = ` to land on target. Dinner covers it.`;

  if (!parts.length) {
    return { text: tomorrowHard ? `On target today — keep carbs skewed for ${tomorrowLabel || 'tomorrow'}.` : `On target for the day — hold it here.`, kcalGap, proteinGap };
  }
  return { text: `Still ${parts.join(' and ')} short${tail}`, kcalGap, proteinGap };
}

export default { refuelForSession, refuelPhrase, fuelGapAdvice };
