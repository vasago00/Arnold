// core/coaching/personalize.js — the "× your learned model" layer (Pillar 1 · EVOLVE).
// Takes the textbook prescription (Daniels VDOT paces) and bends it with what Arnold has
// MEASURED about this athlete: their heat / sleep / fuel sensitivities (hub response model)
// and the day's context. A hot, under-slept easy run is NOT the table pace — it's the table
// pace slowed by the athlete's own learned costs. Pure + tested.
//
// Design note: only AEROBIC paces (easy/long/marathon) are personalized by conditions —
// threshold/interval are effort-anchored and run to feel. This is intentionally conservative
// (caps the adjustment) so the textbook stays the frame and the learned model is the dial.

const AEROBIC_KEYS = ['easy', 'long', 'marathon'];
const MAX_SLOW = 0.12;   // never slow aerobic pace by more than 12% from conditions

// ctx: { hubFacts, tempC, sleepDebtH }. hubFacts.responses = [{factor, perUnitPct, confidence}].
export function personalizedPaces(basePaces, ctx = {}) {
  if (!basePaces) return basePaces;
  const responses = (ctx.hubFacts && ctx.hubFacts.responses) || [];
  const sensOf = (pred) => {
    const r = responses.find(x => pred(String(x.factor)));
    // Discount by confidence so a barely-learned sensitivity barely moves the pace.
    return r ? Math.max(0, (Number(r.perUnitPct) || 0) / 100) * (Number(r.confidence) || 0) : 0;
  };

  let slow = 0;
  const heatSens = sensOf(f => f === 'heat' || f === 'heatstrain' || f === 'heatStrain'.toLowerCase());
  if (heatSens > 0 && Number(ctx.tempC) > 20) slow += heatSens * (Number(ctx.tempC) - 20);
  const sleepSens = sensOf(f => f.startsWith('sleep'));
  if (sleepSens > 0 && Number(ctx.sleepDebtH) > 0) slow += sleepSens * Number(ctx.sleepDebtH);
  slow = Math.min(slow, MAX_SLOW);

  const out = { ...basePaces };
  if (slow > 0) {
    for (const k of AEROBIC_KEYS) if (out[k] > 0) out[k] = Math.round(out[k] * (1 + slow));
  }
  out.personalization = { slowFrac: +slow.toFixed(3), tempC: ctx.tempC ?? null, sleepDebtH: ctx.sleepDebtH ?? null };
  return out;
}
