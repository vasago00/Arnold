// ─── Zones — single source of truth for the athlete's HR zones ──────────────
// Phase 4r.hub.zones — resolves the BEST available zone definition and the two
// metabolic thresholds (LT1 = top of easy/Z2, LT2 = lactate threshold = top of
// tempo). Everything that asks "was this an easy run?" / "what's my Z2 ceiling?"
// must go through resolveZones() so the answer is consistent and correct.
//
// Accuracy ladder (best first) — mirrors professional practice:
//   1. LAB TEST — directly measured LT1/LT2 (blood lactate / metabolic cart).
//      Highest precision, but has a SHELF LIFE (HR anchors stay good ~3 months
//      stable / ~6-10 weeks in a hard build). We store the test + its date and
//      let its CONFIDENCE DECAY (see labConfidence) so the system transitions
//      from "trust the test" to "trust derived zones" automatically as it ages
//      — and a fresh test resets the clock. (Hub recency-weighting principle.)
//   2. GARMIN CUSTOM zones (profile.hrZoneBpm) — user-set bpm boundaries.
//   3. KARVONEN / HRR — derived from true max + resting HR; accounts for
//      fitness, adapts as resting HR drops. Good default.
//   4. %HRmax — crude; ignores resting HR; sets Z2 too high. Last resort.
//
// Lab test is stored at storage 'profile'.labThresholds = {
//   lt1Hr, lt2Hr,                 // bpm anchors (top of easy, lactate threshold)
//   lt1Pace?, lt2Pace?,           // optional pace anchors (stale faster)
//   testedAt,                     // ISO date — drives confidence decay
//   source: 'lab'|'field-test'    // field-test (30min TT) also accepted here
// }

import { storage } from './storage.js';
import { getProfileZoneBpm, karvonenZones } from './derive/hr.js';
import { estimateLt1, hrAtPctReserve, estimateHrMax, easyCeilingCapBpm } from './derive/easyZone.js';   // data-driven LT1 (decoupling) — a ladder rung

const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// The athlete's OWN LT1 from their run data (decoupling). Ranked above Garmin-generic/Karvonen because it's
// measured from real efforts, not a formula — but below a FRESH lab test. Returns null unless it's confident.
function personalLt1({ maxHR, restingHR, runs, today }) {
  if (!(maxHR > 0) || !(restingHR > 0) || maxHR <= restingHR) return null;
  try {
    const rr = (runs || storage.get('activities') || [])
      .filter((a) => a && (a.isRun === true || /run/i.test(String(a.activityType || a.sport || ''))))
      .map((a) => ({ date: a.date, distanceMi: a.distanceMi, durationSecs: a.durationSecs, avgHR: a.avgHR, maxHR: a.maxHR }));
    const est = estimateLt1(rr, { hrMax: maxHR, hrRest: restingHR, today, windowDays: 210 });
    if (est && est.method !== 'fallback' && est.confidence >= 0.45) return est;
  } catch { /* fall through */ }
  return null;
}

// Build the 5-zone bpm frame around an LT1 + LT2 anchor (shared by the lab and personal-data rungs).
function framesFrom(lt1, lt2) {
  return {
    z1Max: Math.round(lt1 * 0.92),                               // recovery
    z2Max: lt1,                                                  // EASY ceiling (aerobic threshold)
    z3Max: Math.round((lt1 + lt2) / 2 + (lt2 - lt1) * 0.25),     // tempo band toward LT2
    z4Max: lt2,                                                  // lactate threshold
  };
}

// HR anchors hold up reasonably for ~3 months stable; a hard build drifts them
// faster. Use a half-life so confidence decays smoothly rather than a cutoff.
const LAB_HALF_LIFE_DAYS = 75;       // ~2.5 months — confidence halves here

function median(arr) {
  const xs = (arr || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

/**
 * Confidence (0..1) in a lab/field test given its age. 1.0 fresh → 0.5 at the
 * half-life → trends to 0. Lets the hub blend the test against derived zones:
 * weight the test heavily when new, lean on derived estimates as it ages.
 */
export function labConfidence(testedAt) {
  const d = daysSince(testedAt);
  if (!Number.isFinite(d)) return 0;
  return Math.pow(0.5, d / LAB_HALF_LIFE_DAYS);
}

/**
 * Resolve the athlete's zones + thresholds from the best available source.
 * @param {object} [opts] { maxHR, restingHR, profile } — pass to avoid re-reads.
 * @returns {{
 *   source, z, lt1Hr, lt2Hr, maxHR, restingHR, labConfidence,
 *   z2Ceiling   // the single most-asked number: top of EASY (LT1)
 * }}
 *   z = { z1Max,z2Max,z3Max,z4Max } bpm boundaries (z2Max = easy ceiling).
 */
// Derive a lab anchor from the athlete's ACTUAL clinical tests — the newest VO2max/CPET
// entry whose parsed metrics carry a ventilatory threshold (metrics.vt1 = LT1 bpm, and
// metrics.vt2 = LT2 bpm when the report has it). This is the wiring that lets an entered
// lab test drive the easy ceiling instead of dying in clinicalTests storage. Shape matches
// profile.labThresholds so it feeds the existing lab rung unchanged.
function labFromClinical(clinicalTests) {
  const tests = Array.isArray(clinicalTests) ? clinicalTests : [];
  let best = null;
  for (const t of tests) {
    if (!t || t.type !== 'vo2max' || !t.metrics) continue;
    const vt1 = Number(t.metrics.vt1);
    if (!(vt1 >= 60 && vt1 <= 200)) continue;         // same sanity bound the parser uses
    const vt2 = Number(t.metrics.vt2);
    const cand = {
      lt1Hr: vt1,
      lt2Hr: (vt2 >= 60 && vt2 <= 220) ? vt2 : null,  // some reports omit VT2 — filled from derived below
      testedAt: t.date || null,
      source: 'lab',
    };
    if (!best || String(cand.testedAt || '') > String(best.testedAt || '')) best = cand;
  }
  return best;
}

export function resolveZones(opts = {}) {
  const profile = opts.profile || storage.get('profile') || {};
  let maxHR = Number(opts.maxHR) || Number(profile.maxHR) || null;
  // Estimate max HR from the athlete's own runs (peak recorded maxHR) when the profile doesn't carry one —
  // otherwise Karvonen AND the data-driven rung can't fire, and the ladder silently falls all the way to a
  // cached Garmin/HRR zone. This was the "why is my easy ceiling 136 not 145?" bug (Emil): no profile.maxHR.
  if (!maxHR) {
    const acts = opts.runs || storage.get('activities') || [];
    const runsForMax = acts.filter((a) => a && (a.isRun === true || /run/i.test(String(a.activityType || a.sport || ''))));
    maxHR = estimateHrMax(runsForMax, {}) || null;
  }
  let restingHR = Number(opts.restingHR) || Number(profile.restingHR) || null;
  if (!restingHR) {
    const sleep = storage.get('sleep') || [];
    restingHR = median(sleep.filter(s => Number(s.restingHR) > 0).slice(0, 60).map(s => Number(s.restingHR)));
  }

  // Karvonen as the crude derived baseline; the athlete's OWN data (decoupling) is the PREFERRED derived
  // source and also the better blend partner for an aging lab test. Computed FIRST so we can fill a
  // VT1-only lab report's missing LT2 from real data.
  const karvonen = (maxHR && restingHR) ? karvonenZones({ maxHR, restingHR }) : null;
  const garmin = getProfileZoneBpm(profile);
  const personal = personalLt1({ maxHR, restingHR, runs: opts.runs, today: opts.today });
  const personalLt2 = personal ? Math.round(hrAtPctReserve(clampN(personal.pctHrr + 0.17, 0.80, 0.92), maxHR, restingHR)) : null;

  // ── Lab anchor: the manual profile.labThresholds OR a VO2max/CPET ventilatory threshold from
  //    clinicalTests, whichever is FRESHER. This is what makes an entered lab test actually move the
  //    easy ceiling (previously clinicalTests VT1/VT2 were captured but never reached the ladder). ──
  let clinicalTests = opts.clinicalTests;
  if (clinicalTests === undefined) { try { clinicalTests = storage.get('clinicalTests') || []; } catch { clinicalTests = []; } }
  let lab = profile.labThresholds || null;
  const clinicalLab = labFromClinical(clinicalTests);
  if (clinicalLab && (!lab || String(clinicalLab.testedAt || '') > String(lab.testedAt || ''))) lab = clinicalLab;
  // A VT1-only report (no VT2): keep the lab LT1 as ground truth and derive LT2 from the athlete's own
  // data / Karvonen so the lab rung can still fire instead of falling through to a weaker source.
  if (lab && Number(lab.lt1Hr) > 0 && !(Number(lab.lt2Hr) > 0)) {
    const dLt2 = personalLt2 ?? karvonen?.z4Max ?? (maxHR ? Math.round(maxHR * 0.88) : null);
    if (dLt2 && dLt2 > Number(lab.lt1Hr)) lab = { ...lab, lt2Hr: dLt2, lt2Derived: true };
  }
  const labConf = lab?.testedAt ? labConfidence(lab.testedAt) : 0;

  // ── 1. Lab/field test present → anchor on it, BLENDED toward derived as it ages ──
  if (lab && Number(lab.lt1Hr) > 0 && Number(lab.lt2Hr) > 0) {
    // Blend the test's LT1/LT2 with the derived equivalents by confidence. The derived partner is the
    // athlete's data-driven LT1 when we have it (better than Karvonen), else Karvonen, else a %HRmax guess.
    const dLt1 = personal?.bpm ?? karvonen?.z2Max ?? (maxHR ? Math.round(maxHR * 0.75) : Number(lab.lt1Hr));
    const dLt2 = personalLt2 ?? karvonen?.z4Max ?? (maxHR ? Math.round(maxHR * 0.88) : Number(lab.lt2Hr));
    const blend = (test, derived) => Math.round(test * labConf + derived * (1 - labConf));
    const lt1 = blend(Number(lab.lt1Hr), dLt1);
    const lt2 = blend(Number(lab.lt2Hr), dLt2);
    const z = framesFrom(lt1, lt2);
    return {
      source: labConf >= 0.5 ? 'lab-anchored' : 'lab-aging-blend',
      z, lt1Hr: lt1, lt2Hr: lt2, maxHR, restingHR,
      labConfidence: +labConf.toFixed(2), lt1Confidence: Math.max(labConf, personal?.confidence ?? 0), lt1Method: 'lab',
      z2Ceiling: z.z2Max,
    };
  }

  // ── 2. The athlete's OWN data-driven LT1 (decoupling) — preferred over generic zones ──
  if (personal && personalLt2 > personal.bpm) {
    // Enforce the science guardrail HERE (the single resolver) so z2Ceiling is already capped — every
    // consumer (classifyEffort, buildEasyZone, aiAnnotations, the activity zone-binner) reads one number.
    const cap = easyCeilingCapBpm(maxHR, restingHR);
    const lt1 = cap ? Math.min(personal.bpm, cap) : personal.bpm;
    const z = framesFrom(lt1, Math.max(personalLt2, lt1 + 1));
    return { source: 'personal-data', z, lt1Hr: lt1, lt2Hr: z.z4Max,
             maxHR, restingHR, labConfidence: 0, lt1Confidence: personal.confidence, lt1Method: personal.method,
             z2Ceiling: z.z2Max };
  }
  // ── 3. Garmin custom zones ──
  if (garmin) {
    return { source: 'garmin-custom', z: garmin, lt1Hr: garmin.z2Max, lt2Hr: garmin.z4Max,
             maxHR, restingHR, labConfidence: 0, lt1Confidence: 0.6, lt1Method: 'garmin', z2Ceiling: garmin.z2Max };
  }
  // ── 4. Karvonen ──
  if (karvonen) {
    return { source: 'karvonen', z: karvonen, lt1Hr: karvonen.z2Max, lt2Hr: karvonen.z4Max,
             maxHR, restingHR, labConfidence: 0, lt1Confidence: 0.4, lt1Method: 'karvonen', z2Ceiling: karvonen.z2Max };
  }
  // ── 5. %HRmax crude fallback ──
  if (maxHR) {
    const z = { z1Max: Math.round(maxHR * 0.60), z2Max: Math.round(maxHR * 0.70),
                z3Max: Math.round(maxHR * 0.80), z4Max: Math.round(maxHR * 0.90) };
    return { source: 'pct-hrmax', z, lt1Hr: z.z2Max, lt2Hr: z.z4Max,
             maxHR, restingHR, labConfidence: 0, lt1Confidence: 0.2, lt1Method: 'pct-hrmax', z2Ceiling: z.z2Max };
  }
  return { source: 'none', z: null, lt1Hr: null, lt2Hr: null, maxHR, restingHR, labConfidence: 0, lt1Confidence: 0, lt1Method: 'none', z2Ceiling: null };
}

/**
 * Classify a run's effort from its avg HR against the resolved zones.
 * @returns 'easy' | 'tempo' | 'hard' | null
 *   easy  = at/below LT1 (Z1-Z2)  → judged on zone discipline + efficiency, NOT race time
 *   tempo = between LT1 and LT2 (Z3-low Z4)
 *   hard  = at/above LT2 (race/threshold effort) → race-pace expectation applies
 */
export function classifyEffort(avgHR, zones) {
  const hr = Number(avgHR);
  if (!Number.isFinite(hr) || !zones?.z2Ceiling) return null;
  if (hr <= zones.z2Ceiling) return 'easy';
  if (zones.lt2Hr && hr >= zones.lt2Hr * 0.97) return 'hard';
  return 'tempo';
}

// Save a lab/field test result (call from UI or console when a test comes in).
export function setLabThresholds({ lt1Hr, lt2Hr, lt1Pace, lt2Pace, testedAt, source = 'lab' }) {
  const profile = storage.get('profile') || {};
  const labThresholds = {
    lt1Hr: Number(lt1Hr) || null,
    lt2Hr: Number(lt2Hr) || null,
    lt1Pace: lt1Pace || null,
    lt2Pace: lt2Pace || null,
    testedAt: testedAt || new Date().toISOString().slice(0, 10),
    source,
  };
  storage.set('profile', { ...profile, labThresholds }, { skipValidation: true });
  return labThresholds;
}

if (typeof window !== 'undefined') {
  window.zonesResolved = () => { const r = resolveZones(); console.log('resolved zones:', r); return r; };
  // Convenience for entering a lab/field test from the console:
  //   window.setLabTest({ lt1Hr:138, lt2Hr:158, testedAt:'2026-06-25' })
  window.setLabTest = (t) => { const r = setLabThresholds(t); console.log('lab thresholds saved:', r); return r; };
}
