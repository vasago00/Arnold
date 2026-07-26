// core/derive/redsScreen.js — REDs (Relative Energy Deficiency in Sport) risk SCREEN, to the 2023 IOC standard.
//
// THE 2023 SHIFT (why this isn't just an EA number). The 2018 model hung on one figure: energy availability
// EA = (intake − exercise kcal) / fat-free mass, with <30 kcal/kg FFM/day = "low". But EA is NOISY — intake is
// under-logged, exercise kcal is estimated — so a low EA reading on its own is a weak signal. The 2023 IOC REDs
// consensus (Mountjoy et al.) moved to a MULTI-INDICATOR model: the body's OUTCOME markers are the arbiter of
// whether an energy deficit is actually doing harm. A reduced EA estimate alongside normal testosterone, a
// non-suppressed resting metabolism, healthy bone, no anaemia and a STABLE WEIGHT is not REDs — it's almost
// certainly under-logging or successful adaptation. A deficit only becomes real when the downstream markers move.
//
// So this screen weights the OUTCOME indicators over the EA calc, grades severity green→yellow→orange→red
// (mirroring the CAT2 traffic-light as a SCREEN), and — always — hands diagnosis to a clinician. It never
// diagnoses; it flags and defers. Pure + node-testable; the caller supplies pre-read numbers.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const RANK = { green: 0, yellow: 1, orange: 2, red: 3 };
const worst = (a, b) => (RANK[a] >= RANK[b] ? a : b);

// Reference thresholds (adult; male-specific where it matters — Emil is a 51 y/o male). Conservative, clinical.
const REF = {
  eaLow: 30, eaReduced: 45,                 // kcal/kg FFM/day (Loucks / IOC)
  rmrSuppressed: 0.90, rmrSevere: 0.80,      // measured/predicted resting metabolic rate ratio
  testosteroneLowMale: 300, testosteroneBorderMale: 350,   // ng/dL (clinically low <~264–300)
  boneOsteopenia: -1.0, boneOsteoporosis: -2.5,             // DEXA T-score (Z-score for <50 y/o, but Emil is 51)
  ferritinLow: 30, ferritinDeficient: 15,    // ng/mL
  hbLowMale: 13.5,                            // g/dL (anaemia)
  vitDInsufficient: 30, vitDDeficient: 20,    // ng/mL
  hsCRPHigh: 3.0,                             // mg/L (systemic inflammation)
  weightLossFlagPctMo: 1.0,                   // % body-mass loss/month, unexplained → concern
};

/**
 * redsScreen(inputs, opts) → { overall:{status,label,summary}, indicators:[...], handoff, asOf }
 * inputs (all optional; missing → that indicator is 'unknown' and excluded):
 *   ea: { median, lowDaysFrac }            — over a recent window
 *   rmrRatio                                — measured/predicted RMR
 *   weightTrendPctPerMonth                  — signed; negative = losing
 *   boneT                                   — DEXA T-score (or Z)
 *   sex ('male'|'female'), age
 *   markers: { testosterone, ferritin, hemoglobin, vitD, hsCRP }
 *   recovery: { hrvDeclining:boolean }
 */
export function redsScreen(inputs = {}, opts = {}) {
  const sex = inputs.sex || 'male';
  const ind = [];
  const add = (key, status, label, opt = {}) => { if (status) ind.push({ key, status, label, primary: !!opt.primary, ...opt }); };

  // ── EA (a screening input, NOT an arbiter) ──
  const eaMed = num(inputs.ea && inputs.ea.median);
  const lowFrac = num(inputs.ea && inputs.ea.lowDaysFrac);
  if (eaMed != null) {
    const s = eaMed < REF.eaLow ? 'orange' : eaMed < REF.eaReduced ? 'yellow' : 'green';
    add('ea', s, `Energy availability ≈ ${Math.round(eaMed)} kcal/kg FFM/day (${eaMed < REF.eaLow ? 'low' : eaMed < REF.eaReduced ? 'reduced' : 'optimal'})`, { value: eaMed, screening: true, lowFrac });
  }

  // ── PRIMARY outcome markers (the arbiters) ──
  const rmr = num(inputs.rmrRatio);
  if (rmr != null) add('rmr', rmr < REF.rmrSevere ? 'red' : rmr < REF.rmrSuppressed ? 'orange' : 'green',
    `Resting metabolism ${rmr >= REF.rmrSuppressed ? 'normal' : 'suppressed'} (measured/predicted ${rmr.toFixed(2)})`, { primary: true, value: rmr });

  if (sex === 'male') {
    const t = num(inputs.markers && inputs.markers.testosterone);
    if (t != null) add('testosterone', t < REF.testosteroneLowMale ? 'red' : t < REF.testosteroneBorderMale ? 'orange' : 'green',
      `Testosterone ${t} ng/dL (${t < REF.testosteroneLowMale ? 'low' : t < REF.testosteroneBorderMale ? 'low-normal' : 'normal'})`, { primary: true, value: t });
  }

  const bone = num(inputs.boneT);
  if (bone != null) add('bone', bone <= REF.boneOsteoporosis ? 'red' : bone <= REF.boneOsteopenia ? 'orange' : 'green',
    `Bone density ${bone > REF.boneOsteopenia ? 'healthy' : bone > REF.boneOsteoporosis ? 'low (osteopenic range)' : 'osteoporotic range'} (T ${bone > 0 ? '+' : ''}${bone})`, { primary: true, value: bone });

  const hb = num(inputs.markers && inputs.markers.hemoglobin);
  const fer = num(inputs.markers && inputs.markers.ferritin);
  if (hb != null && hb < REF.hbLowMale) add('anemia', fer != null && fer < REF.ferritinLow ? 'red' : 'orange', `Haemoglobin low (${hb} g/dL)${fer != null && fer < REF.ferritinLow ? ' with low ferritin — iron-deficiency picture' : ''}`, { primary: true, value: hb });

  const wt = num(inputs.weightTrendPctPerMonth);
  if (wt != null && wt <= -REF.weightLossFlagPctMo) add('weight', wt <= -2 ? 'red' : 'orange', `Body mass falling ${Math.abs(wt).toFixed(1)}%/month (unexplained)`, { primary: true, value: wt });
  else if (wt != null) add('weight', 'green', 'Body mass stable', { value: wt });

  // ── SECONDARY markers ──
  if (fer != null && !(hb != null && hb < REF.hbLowMale)) add('ferritin', fer < REF.ferritinDeficient ? 'orange' : fer < REF.ferritinLow ? 'yellow' : 'green', `Ferritin ${fer} ng/mL${fer < REF.ferritinLow ? ' (low iron stores)' : ''}`, { value: fer });
  const vd = num(inputs.markers && inputs.markers.vitD);
  if (vd != null) add('vitD', vd < REF.vitDDeficient ? 'orange' : vd < REF.vitDInsufficient ? 'yellow' : 'green', `Vitamin D ${vd} ng/mL${vd < REF.vitDInsufficient ? ' (insufficient)' : ''}`, { value: vd });
  const crp = num(inputs.markers && inputs.markers.hsCRP);
  if (crp != null && crp > REF.hsCRPHigh) add('inflammation', crp > 10 ? 'orange' : 'yellow', `hsCRP elevated (${crp} mg/L)`, { value: crp });
  if (inputs.recovery && inputs.recovery.hrvDeclining) add('recovery', 'yellow', 'HRV trending down (recovery strain)', {});

  // ── OVERALL severity — outcomes arbitrate. ──
  const primaries = ind.filter((i) => i.primary);
  const worstPrimary = primaries.reduce((s, i) => worst(s, i.status), 'green');
  const secondaries = ind.filter((i) => !i.primary && i.key !== 'ea' && (i.status === 'yellow' || i.status === 'orange'));
  const eaLowish = eaMed != null && eaMed < REF.eaReduced;
  const eaLow = eaMed != null && eaMed < REF.eaLow;

  // The EA calc can only ELEVATE risk when a downstream marker or weight loss corroborates it — never alone.
  // Stable weight + clean outcome markers RULE OUT a real deficit (stable mass IS the ground-truth energy check),
  // so a noisy low-EA estimate there stays green with an under-logging note rather than a false alarm.
  const weightStable = wt == null ? null : wt > -REF.weightLossFlagPctMo;
  const cleanOutcomes = worstPrimary === 'green';
  let overall;
  if (!cleanOutcomes) {
    overall = worstPrimary;                                   // a downstream marker is the real signal
    if (eaLow && overall === 'orange') overall = worst(overall, 'orange');
  } else if (weightStable === false) {
    overall = eaLow ? 'orange' : 'yellow';                    // losing weight unexplained → real concern
  } else if (secondaries.length >= 1) {
    overall = secondaries.some((s) => s.status === 'orange') ? 'orange' : 'yellow';
  } else if (weightStable === null && eaLow) {
    overall = 'yellow';                                        // low EA, no weight to corroborate → watch
  } else {
    overall = 'green';                                        // clean outcomes + stable weight → not a deficit
  }
  let summary;
  if (overall === 'green') {
    summary = (eaLowish || eaLow)
      ? 'No signs of energy deficiency — testosterone, resting metabolism, bone and blood are all healthy and weight is stable. Your EA estimate runs moderate, most likely under-logged intake rather than a real deficit; keep fuel logging honest and it stays a non-issue.'
      : 'No signs of energy deficiency — fuelling supports your training.';
  } else if (overall === 'red') summary = 'Several indicators are consistent with relative energy deficiency — this warrants clinical attention, not a self-fix.';
  else if (!weightStable && weightStable !== null) summary = 'Weight is drifting down with training up — watch fuelling and re-check the markers; not yet a clear deficit.';
  else summary = 'A marker or two worth watching; not a clear deficiency picture. Keep fuelling and recovery honest.';

  const LABEL = { green: 'Well-fuelled', yellow: 'Monitor', orange: 'Elevated concern', red: 'Clinical attention' };

  return {
    overall: { status: overall, label: LABEL[overall], summary },
    indicators: ind,
    handoff: 'This is a screen, not a diagnosis. If concern persists — or any red/orange indicator appears — see a sports physician or registered dietitian; REDs is diagnosed clinically.',
    asOf: opts.asOf || null,
  };
}

// ── Resolver (impure — reads storage, computes the inputs, runs the screen). Wired by the coach + the UI. ──

const KG_PER_LB = 0.453592;
function ageDays(dateStr, todayStr) { const d = new Date(`${dateStr}T12:00:00`).getTime(), t = new Date(`${todayStr}T12:00:00`).getTime(); return (Number.isFinite(d) && Number.isFinite(t)) ? (t - d) / 86400000 : Infinity; }
function pickMarker(markers, include, exclude) {
  for (const [k, v] of Object.entries(markers || {})) {
    if (!include.test(k) || (exclude && exclude.test(k))) continue;
    const val = (v && typeof v === 'object') ? (v.value ?? v.val ?? v.result) : v;
    const n = Number(val); if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * resolveRedsScreen({ storage, today }) → the screen for the athlete, from their real record. Guarded end-to-end.
 * EA is computed over the last ~60 days (intake − exercise kcal) / FFM; markers from the latest lab panel;
 * RMR/bone from clinical tests; weight trend from the weight log.
 */
export function resolveRedsScreen(ctx = {}) {
  const storage = ctx.storage;
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const get = (k) => { try { return storage.get(k); } catch { return null; } };
  try {
    const profile = get('profile') || {};
    const sex = /female|\bf\b/i.test(String(profile.sex || profile.gender || '')) ? 'female' : 'male';
    const age = (() => { const b = profile.birthDate; if (!b) return null; const m = String(b).match(/(\d{4})/); return m ? (new Date(`${today}T12:00:00`).getFullYear() - +m[1]) : null; })();

    const ct = {}; for (const t of (get('clinicalTests') || [])) if (t && t.type) ct[t.type] = t.metrics || {};
    const rmrRatio = (ct.rmr && num(ct.rmr.rmr) && num(ct.rmr.predicted)) ? +(num(ct.rmr.rmr) / num(ct.rmr.predicted)).toFixed(2) : null;
    const boneT = ct.dexa ? (num(ct.dexa.tScore) ?? num(ct.dexa.zScore)) : null;
    const ffmKg = (ct.dexa && num(ct.dexa.leanMass)) ? num(ct.dexa.leanMass) * KG_PER_LB : null;

    // Energy availability over the last 60 logged days.
    let ea = null;
    if (ffmKg > 0) {
      const ei = {}; for (const e of (get('nutritionLog') || [])) { const mac = e.macros || {}; const kc = num(mac.calories ?? mac.kcal); if (e.date && kc) ei[e.date] = (ei[e.date] || 0) + kc * (num(e.servings) || 1); }
      const eee = {}; for (const a of (get('activities') || [])) { const c = num(a.calories); if (a.date && c) eee[a.date] = (eee[a.date] || 0) + c; }
      const vals = Object.keys(ei).filter((d) => ei[d] > 800 && ageDays(d, today) <= 60).map((d) => (ei[d] - (eee[d] || 0)) / ffmKg);
      if (vals.length >= 5) { const sorted = vals.slice().sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)]; ea = { median: +median.toFixed(0), lowDaysFrac: +(vals.filter((v) => v < 30).length / vals.length).toFixed(2), n: vals.length }; }
    }

    // Weight trend (%/month) over the last ~120 days.
    let weightTrendPctPerMonth = null;
    const wlog = (get('weight') || []).map((w) => ({ date: w.date, kg: num(w.weightKg ?? w.kg ?? w.weight) })).filter((w) => w.date && w.kg && ageDays(w.date, today) <= 120).sort((a, b) => a.date.localeCompare(b.date));
    if (wlog.length >= 2) { const a = wlog[0], b = wlog[wlog.length - 1]; const months = Math.max(ageDays(a.date, b.date) / 30.44, 0.5); weightTrendPctPerMonth = +(((b.kg - a.kg) / a.kg) * 100 / months).toFixed(2); }

    // Latest bloodwork markers.
    const labs = (get('labSnapshots') || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const mk = (labs[0] && labs[0].markers) || {};
    const markers = {
      testosterone: pickMarker(mk, /testosterone/i, /free/i),
      ferritin: pickMarker(mk, /ferritin/i),
      hemoglobin: pickMarker(mk, /h(a)?emoglobin/i),
      vitD: pickMarker(mk, /vitamin\s*d/i),
      hsCRP: pickMarker(mk, /crp/i),
    };

    return redsScreen({ ea, rmrRatio, weightTrendPctPerMonth, boneT, sex, age, markers, recovery: {} }, { asOf: today });
  } catch { return null; }
}

export default redsScreen;
