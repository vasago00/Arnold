// core/derive/fitnessEstimate.js — P1: a TRAINING-RESPONSIVE fitness estimate + confidence band.
//
// THE PROBLEM (Emil, 2026-07-18): the finish-time projection only moved when you logged a race or a
// standard-distance benchmark. A normal build — easy + long + tempo at non-standard distances — left the
// number frozen for weeks, which is demoralizing and wrong: fitness demonstrably improves across a build.
// Every mainstream tool (Garmin/COROS/Runalyze) moves its prediction from ORDINARY training; this closes
// that gap while staying honest.
//
// THE MODEL (see ARNOLD_SCIENCE_AND_STRATEGY_2026.md §1–2, §P1):
//   1. CAPACITY  — recency-weighted equivalent-10k time from every QUALITY effort at ANY distance (not just
//      standard races). As tempo/interval/quality-long paces improve, this drops (faster). This is the part
//      that responds to training.
//   2. EFFICIENCY — aerobic efficiency trend from easy runs (pace at a reference effort improving = fitter),
//      a bounded nudge so consistent base-building moves the number a little even before a hard benchmark.
//   3. CEILING — the best DEMONSTRATED effort (a real race / hard benchmark). The training estimate is
//      capped so it can't out-claim demonstrated performance by more than a small margin unless a recent
//      benchmark confirms it — honesty over optimism.
//   4. CONFIDENCE + BAND — a widening/​narrowing band from how much recent, consistent, proven evidence
//      exists. Unproven fitness shows as a wider band, not a bold single number (the thing Garmin/COROS get
//      wrong). Carries provenance (which efforts drove it) and an as-of date.
//
// PURE + node-testable: no storage/date/window imports. `today` and the distance-exponent are injected.

const KM_PER_MI = 1.60934;
const DAY_MS = 86400000;
const WINDOW_DAYS = 56;      // 8 weeks of evidence
const HALF_LIFE_DAYS = 21;   // recency half-life for weighting efforts
const REF_KM = 10;           // capacity expressed as an equivalent-10k time (seconds)

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';

// A run's distance in km and duration in seconds, tolerant of the various stored shapes.
function runKmSec(a) {
  const mi = num(a && (a.distanceMi ?? a.distance_mi ?? a.miles));
  const km = mi != null ? mi * KM_PER_MI : num(a && (a.distanceKm ?? a.distance_km));
  const sec = num(a && (a.durationSecs ?? a.durationSeconds)) ?? (num(a && a.durationMinutes) != null ? num(a.durationMinutes) * 60 : null);
  return { km: km && km > 0 ? km : null, sec: sec && sec > 0 ? sec : null };
}

// Riegel equivalent: a (distKm, durSec) effort → equivalent time at refKm. k≈1.06 near the anchor.
function riegelEquiv(distKm, durSec, refKm, k = 1.06) {
  return durSec * Math.pow(refKm / distKm, k);
}

function ageDays(dateStr, today) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  if (!Number.isFinite(d) || !Number.isFinite(t)) return Infinity;
  return (t - d) / DAY_MS;
}
const recencyWeight = (days) => Math.pow(0.5, Math.max(0, days) / HALF_LIFE_DAYS);

const HARD_TYPES = new Set(['tempo', 'threshold', 'intervals', 'interval', 'hiit', 'race', 'fartlek', 'speed', 'long_run']);
const isRunAct = (a) => {
  const t = String((a && (a.activityType ?? a.type)) || '').toLowerCase();
  return t.includes('run') || t === '' || HARD_TYPES.has(t);   // permissive; distance/dur gates below do the real filtering
};

/**
 * estimateFitness(activities, opts) → training-responsive fitness state, or null when there's no usable run.
 *   opts.today        — Date | 'YYYY-MM-DD' (required for recency; defaults to now-free: pass it in).
 *   opts.hrMax        — optional; enables HR-based effort/efficiency signals.
 * Returns { equiv10kSec, confidence (0..1), asOf, nQuality, ceilingEquiv10kSec, efficiencyTrend, basis[] }.
 */
export function estimateFitness(activities, opts = {}) {
  const today = opts.today || new Date();
  const hrMax = num(opts.hrMax);
  const runs = (Array.isArray(activities) ? activities : [])
    .filter(isRunAct)
    .map((a) => {
      const { km, sec } = runKmSec(a);
      if (!km || !sec) return null;
      const days = ageDays(a.date, today);
      const paceSecPerKm = sec / km;
      const avgHR = num(a.avgHR ?? a.averageHR ?? a.avg_hr);
      return { a, km, sec, days, paceSecPerKm, avgHR, type: String((a.activityType ?? a.type) || '').toLowerCase() };
    })
    .filter(Boolean)
    .filter((r) => r.days <= WINDOW_DAYS && r.km >= 3);   // 8-week window, ≥3 km to be a usable signal
  if (!runs.length) return null;

  // Easy-pace baseline = median pace of the slower 60% of window runs (a proxy for "easy", HR-free).
  const paces = runs.map((r) => r.paceSecPerKm).sort((x, y) => x - y);
  const slowHalf = paces.slice(Math.floor(paces.length * 0.4));   // drop the fastest 40%
  const easyPace = slowHalf.length ? slowHalf[Math.floor(slowHalf.length / 2)] : paces[Math.floor(paces.length / 2)];

  // A run is a QUALITY (capacity) effort if it's meaningfully harder than easy: fast relative to the easy
  // baseline, OR high-HR (threshold+), OR an explicitly hard type. Distance ≥3 km, ≤30 km (Riegel to 10k
  // is unreliable past that). This is what makes tempos/quality-longs at NON-standard distances count.
  let quality = runs.filter((r) => {
    if (r.km > 30) return false;
    const fast = easyPace > 0 && r.paceSecPerKm <= easyPace * 0.93;   // ≥7% faster than easy
    const hrHigh = hrMax && r.avgHR && r.avgHR / hrMax >= 0.88;
    const hardType = HARD_TYPES.has(r.type) && r.type !== 'long_run';
    return fast || hrHigh || hardType;
  });
  // ANCHORING RULE (Emil, 2026-07-18): a projection must trace to DEMONSTRATED intensity — a race, tempo,
  // interval, or otherwise hard effort. If there is no genuine quality effort (only easy base miles), we
  // return NOTHING rather than manufacture a finish time from easy pace. Never show a number not anchored to
  // real evidence. (This is what produced the nonsense 5:57 — an easy-run extrapolation shown as a result.)
  if (!quality.length) return null;

  // CAPACITY: recency-weighted equiv-10k across quality efforts. Improving quality paces → lower (faster).
  let equiv10kSec = null; let asOf = null; const basis = [];
  if (quality.length) {
    let wsum = 0, esum = 0;
    for (const r of quality) {
      const eq = riegelEquiv(r.km, r.sec, REF_KM, 1.06);
      const w = recencyWeight(r.days);
      wsum += w; esum += eq * w;
      basis.push({ date: r.a.date, type: r.type || 'run', distanceMi: +(r.km / KM_PER_MI).toFixed(1), equiv10kSec: Math.round(eq), weight: +w.toFixed(3) });
      if (!asOf || (r.a.date && r.a.date > asOf)) asOf = r.a.date;
    }
    equiv10kSec = esum / wsum;
  }

  // EFFICIENCY: for easy runs with HR, trend of pace-at-HR (pace × HR proxy) recent-vs-older. Improving
  // (lower recent) → a small speed-up multiplier applied to the capacity estimate. HR-free → no nudge.
  let efficiencyTrend = 0;   // fractional improvement (+ = fitter), bounded ±0.03
  if (hrMax) {
    // Select EASY runs by HR band only (not pace) — the whole point is that improving easy runs get FASTER
    // at the same effort, so a pace filter would exclude the very signal we're measuring.
    const easyHR = runs.filter((r) => r.avgHR && r.avgHR / hrMax <= 0.85 && r.avgHR / hrMax >= 0.6);
    const ef = easyHR.map((r) => ({ days: r.days, cost: r.paceSecPerKm * (r.avgHR / hrMax) }));   // pace-per-km at a given %HRmax
    const recent = ef.filter((e) => e.days <= 21);
    const older = ef.filter((e) => e.days > 21 && e.days <= WINDOW_DAYS);
    if (recent.length >= 2 && older.length >= 2) {
      const avg = (arr) => arr.reduce((s, e) => s + e.cost, 0) / arr.length;
      const rc = avg(recent), oc = avg(older);
      if (oc > 0) efficiencyTrend = clamp((oc - rc) / oc, -0.03, 0.03);   // recent cheaper = positive = fitter
    }
  }
  if (equiv10kSec != null && efficiencyTrend) equiv10kSec *= (1 - efficiencyTrend);

  // CEILING: best DEMONSTRATED effort — the fastest reliable equiv-10k from a genuine hard/long/race effort
  // (any distance ≥5 km). This is the "you have actually shown this" bound.
  let ceilingEquiv10kSec = null; let ceilingAgeDays = Infinity;
  for (const r of runs) {
    if (r.km < 5 || r.km > 42.3) continue;
    const hrHigh = hrMax && r.avgHR && r.avgHR / hrMax >= 0.9;
    const hardType = HARD_TYPES.has(r.type);
    const fast = easyPace > 0 && r.paceSecPerKm <= easyPace * 0.9;
    if (!(hrHigh || hardType || fast)) continue;
    const eq = riegelEquiv(r.km, r.sec, REF_KM, 1.06);
    if (ceilingEquiv10kSec == null || eq < ceilingEquiv10kSec) { ceilingEquiv10kSec = eq; ceilingAgeDays = r.days; }
  }

  if (equiv10kSec == null && ceilingEquiv10kSec == null) return null;
  if (equiv10kSec == null) equiv10kSec = ceilingEquiv10kSec;

  // CAP: don't let the training estimate out-claim the demonstrated ceiling by >2% unless a benchmark is
  // recent (≤21 d). Honesty over optimism — base miles suggest, they don't prove.
  if (ceilingEquiv10kSec != null && equiv10kSec < ceilingEquiv10kSec) {
    const benchFresh = ceilingAgeDays <= 21;
    const floor = benchFresh ? ceilingEquiv10kSec * 0.98 : ceilingEquiv10kSec;
    equiv10kSec = Math.max(equiv10kSec, floor);
  }

  // CONFIDENCE (0..1): more, more-recent, more-consistent quality evidence + a fresh benchmark = tighter.
  const nQ = quality.length;
  const volumeC = clamp(nQ / 6, 0, 1);                                   // ~6 quality efforts → full
  const recencyC = asOf ? clamp(1 - ageDays(asOf, today) / 28, 0, 1) : 0; // last quality effort within 4 wk
  const benchC = ceilingEquiv10kSec != null ? clamp(1 - ceilingAgeDays / 84, 0, 1) : 0; // benchmark within 12 wk
  // consistency: low spread of quality equivs → higher confidence
  let consistencyC = 0.5;
  if (nQ >= 2) {
    const eqs = quality.map((r) => riegelEquiv(r.km, r.sec, REF_KM, 1.06));
    const mean = eqs.reduce((s, e) => s + e, 0) / eqs.length;
    const cv = Math.sqrt(eqs.reduce((s, e) => s + (e - mean) ** 2, 0) / eqs.length) / mean;
    consistencyC = clamp(1 - cv * 4, 0, 1);   // cv 0 → 1.0, cv 0.25 → 0
  }
  const confidence = clamp(0.35 * volumeC + 0.25 * recencyC + 0.25 * benchC + 0.15 * consistencyC, 0, 1);

  return {
    equiv10kSec: Math.round(equiv10kSec),
    ceilingEquiv10kSec: ceilingEquiv10kSec != null ? Math.round(ceilingEquiv10kSec) : null,
    trainingEquiv10kSec: Math.round(equiv10kSec),
    efficiencyTrend: +efficiencyTrend.toFixed(4),
    confidence: +confidence.toFixed(3),
    asOf,
    nQuality: nQ,
    basis: basis.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 6),
  };
}

/**
 * projectFinishBand(distanceKm, activities, opts) → { seconds, low, high, confidence, asOf, source, basis }
 * or null. Projects the training-responsive equiv-10k to `distanceKm` via the personal distance exponent
 * (opts.kFor(fromKm,toKm), else a distance-aware default), and wraps it in a confidence band that widens
 * as confidence falls. `low` = faster/optimistic end, `high` = slower/conservative end.
 */
export function projectFinishBand(distanceKm, activities, opts = {}) {
  if (!distanceKm || distanceKm <= 0) return null;
  const fit = estimateFitness(activities, opts);
  if (!fit) return null;

  const kFor = typeof opts.kFor === 'function'
    ? opts.kFor
    : (fromKm, toKm) => (toKm > fromKm ? clamp(1.06 + 0.06 * Math.log2(toKm / fromKm), 1.0, 1.30) : 1.06);
  const project = (equiv10k) => equiv10k * Math.pow(distanceKm / REF_KM, kFor(REF_KM, distanceKm));

  const seconds = Math.round(project(fit.equiv10kSec));
  // Band width scales inversely with confidence: ~±2.5% when fully proven → ~±9% when unproven.
  const halfBand = clamp(0.025 + (1 - fit.confidence) * 0.065, 0.025, 0.09);
  return {
    seconds,
    low: Math.round(seconds * (1 - halfBand)),    // optimistic (faster)
    high: Math.round(seconds * (1 + halfBand)),   // conservative (slower)
    confidence: fit.confidence,
    halfBandPct: +(halfBand * 100).toFixed(1),
    asOf: fit.asOf,
    source: 'training-blend',
    ceilingSeconds: fit.ceilingEquiv10kSec != null ? Math.round(project(fit.ceilingEquiv10kSec)) : null,
    efficiencyTrend: fit.efficiencyTrend,
    nQuality: fit.nQuality,
    basis: fit.basis,
    distanceKm,
  };
}

export default projectFinishBand;
