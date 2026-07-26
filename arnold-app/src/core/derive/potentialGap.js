// core/derive/potentialGap.js — the AEROBIC CEILING signal (the "big engine, race legs" gap).
//
// WHY THIS EXISTS. Arnold's finish-time is anchored to demonstrated RACES (Daniels VDOT from real results) —
// that is the number you can trust and the one we show. But a measured VO2max (Garmin's estimate, or a lab
// test) is a DIFFERENT currency: it reads the aerobic ENGINE, before running economy and race execution are
// applied. Emil's races imply VDOT ~41; his Garmin/lab VO2max is ~47–51. That is not a contradiction — it is
// the classic profile of a runner whose engine is ahead of their race times. The GAP is the single most
// actionable coaching signal in the data: the upside is in threshold + economy work, not more easy base.
//
// DISCIPLINE. We NEVER let the measured VO2max drive the finish prediction (that would show a 3:21 marathon he
// has never run — the exact unanchored fabrication the fitness-state rebuild removed). The ceiling is a
// SEPARATE, clearly-labelled "theoretical" marker: what a runner with textbook economy at this VO2max would
// run. The realistic near-term reach closes only PART of the gap and is framed as a target, never a prediction.
//
// PURE. `computePotentialGap` takes plain numbers; `readMeasuredVo2` isolates the (impure) storage read so the
// math stays node-testable. VDOT↔time math is reused from coaching/vdot.js — one fitness scale everywhere.

import { raceTimeFromVdot } from '../coaching/vdot.js';
import { estimateFitnessState } from './fitnessState.js';
import { projectRace } from './fitnessProjection.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';

// How much of the VDOT gap a focused training block can realistically claw back. Economy/threshold gains of
// ~2–3 VDOT points over a cycle are a defensible rule of thumb for a runner with a large untapped engine; we
// take 35% of the gap, capped at 3 points, so the "reach" is ambitious but not a fantasy.
const REACH_FRACTION = 0.35;
const REACH_CAP_VDOT = 3.0;

// Confidence in the ceiling by where the VO2max came from — a lab test is gold; a single noisy activity
// estimate is soft. Decayed by age (a 2-year-old reading is weaker evidence of today's engine).
const SOURCE_CONF = { lab: 0.9, manual: 0.75, api: 0.7, activity: 0.55 };

function ageDays(dateStr, today) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  return (Number.isFinite(d) && Number.isFinite(t)) ? (t - d) / 86400000 : null;
}

/**
 * computePotentialGap({ measuredVo2, source, vo2Date, raceVdot, distanceKm, today }) → gap | null.
 *   {
 *     measuredVo2, raceVdot, gapVdot,          // the two currencies + their spread (VDOT points)
 *     currentSecs, ceilingSecs, reachSecs,     // anchored time, theoretical ceiling, realistic reach (secs)
 *     gapSecs, reachSecs,                       // total upside + the realistic slice
 *     lever, magnitude, confidence, source, asOf
 *   }
 * `currentSecs` comes from raceVdot (anchored). `ceilingSecs` treats the measured VO2max as a VDOT — i.e. the
 * time if economy were textbook. `reachSecs` closes only REACH_FRACTION of the gap.
 */
export function computePotentialGap(opts = {}) {
  const measuredVo2 = num(opts.measuredVo2);
  const raceVdot = num(opts.raceVdot);
  const distanceKm = num(opts.distanceKm);
  if (!(measuredVo2 > 0) || !(raceVdot > 0) || !(distanceKm > 0)) return null;

  const gapVdot = +(measuredVo2 - raceVdot).toFixed(1);
  const D = distanceKm * 1000;
  const baseCurrent = raceTimeFromVdot(raceVdot, D);    // pure Daniels time at the anchored VDOT (no fade)
  if (!(baseCurrent > 0)) return null;

  // Apples-to-apples with the DISPLAYED prediction: if the caller passes the actual anchored finish
  // (`currentSecsOverride`, which already includes the marathon readiness fade), back out that effective fade
  // and apply the SAME multiplier to the ceiling + reach — so the gap is the true marathon upside, not an
  // artefact of comparing a faded current against an unfaded ceiling. Falls back to an explicit `fade` (default 1).
  const override = num(opts.currentSecsOverride);
  const fade = override && override > 0 ? override / baseCurrent : (num(opts.fade) || 1);
  const currentSecs = Math.round(baseCurrent * fade);
  const ceilingSecs = Math.round(raceTimeFromVdot(measuredVo2, D) * fade);
  if (!(currentSecs > 0) || !(ceilingSecs > 0)) return null;

  const reachVdot = raceVdot + clamp(gapVdot * REACH_FRACTION, 0, REACH_CAP_VDOT);
  const reachSecs = Math.round(raceTimeFromVdot(reachVdot, D) * fade);
  const gapSecs = currentSecs - ceilingSecs;   // >0 when the engine is ahead of the legs (the usual case)

  // The lever + how loudly to say it, by the size of the gap.
  let lever, magnitude;
  if (gapVdot >= 4) { lever = 'economy+threshold'; magnitude = 'large'; }        // big engine, convert it
  else if (gapVdot >= 2) { lever = 'threshold'; magnitude = 'moderate'; }         // sharpen it
  else if (gapVdot >= 0.5) { lever = 'sharpening'; magnitude = 'small'; }         // racing near the ceiling
  else if (gapVdot > -1.5) { lever = 'at-ceiling'; magnitude = 'none'; }          // engine ≈ legs → build VO2max itself
  else { lever = 'retest'; magnitude = 'inverted'; }                             // racing ABOVE the reading → stale/low VO2max

  const src = opts.source || 'activity';
  const age = ageDays(opts.vo2Date, opts.today || new Date());
  const ageMult = age == null ? 0.85 : age <= 120 ? 1 : age <= 365 ? 0.85 : 0.65;
  const confidence = +clamp((SOURCE_CONF[src] ?? 0.6) * ageMult, 0.3, 0.95).toFixed(2);

  return {
    measuredVo2, raceVdot, gapVdot,
    currentSecs, ceilingSecs, reachSecs, gapSecs,
    reachVdot: +reachVdot.toFixed(1), fade: +fade.toFixed(3),
    lever, magnitude, confidence, source: src, asOf: opts.vo2Date || null, distanceKm,
  };
}

/**
 * readMeasuredVo2({ storage, activities, clinicalTests, profile }) → { value, source, date } | null.
 * The SAME priority chain MobileHome uses (manual watch → direct API → activity DTO → lab test), isolated here
 * so both surfaces agree on one VO2max. Impure (reads storage); kept thin so computePotentialGap stays pure.
 */
export function readMeasuredVo2(ctx = {}) {
  const { storage, activities, clinicalTests } = ctx;
  const profile = ctx.profile || (() => { try { return storage?.get?.('profile') || {}; } catch { return {}; } })();

  // 1. Manual watch override (most accounts can only get the number this way).
  const manual = num(profile?.watchVO2Max);
  if (manual > 0) return { value: Math.round(manual * 10) / 10, source: 'manual', date: profile?.watchVO2MaxAt ? String(profile.watchVO2MaxAt).slice(0, 10) : null };

  // 2. Direct API pull stored on wellness rows.
  const wellness = (() => { try { return storage?.get?.('wellness') || []; } catch { return []; } })();
  const apiRow = [...wellness].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .find((w) => num(w?.garminWatchVO2Max) > 0);
  if (apiRow) return { value: Math.round(num(apiRow.garminWatchVO2Max) * 10) / 10, source: 'api', date: apiRow.date || null };

  // 3. Latest per-activity VO2max estimate.
  const actRow = [...(activities || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .find((a) => num(a?.vO2MaxValue ?? a?.vo2Max ?? a?.vO2Max ?? a?.estimatedVo2Max) > 0);
  if (actRow) { const v = num(actRow.vO2MaxValue ?? actRow.vo2Max ?? actRow.vO2Max ?? actRow.estimatedVo2Max); return { value: Math.round(v * 10) / 10, source: 'activity', date: actRow.date || null }; }

  // 4. Lab clinical test — the historical anchor / last resort.
  const tests = clinicalTests || (() => { try { return storage?.get?.('clinicalTests') || []; } catch { return []; } })();
  const lab = [...tests].filter((t) => t?.type === 'vo2max' && num(t?.metrics?.vo2max) > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  if (lab) return { value: Math.round(num(lab.metrics.vo2max) * 10) / 10, source: 'lab', date: lab.date || null };

  return null;
}

const hms = (s) => { if (!Number.isFinite(s)) return null; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.round(s % 60); return (h > 0 ? h + ':' : '') + String(m).padStart(h > 0 ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0'); };

/**
 * resolvePotentialGap({ activities, today, distanceKm, measured, hrMax }) → gap (with formatted strings) | null.
 * The ONE orchestration both the coach and the training profile call, so they can never disagree on the gap:
 * race-anchored VDOT (fitness state) + the anchored finish (projection) + the measured VO2max → computePotentialGap.
 * `measured` is `{ value, source, date }` from readMeasuredVo2 (caller does the storage read). Fully guarded.
 */
export function resolvePotentialGap(ctx = {}) {
  try {
    const acts = ctx.activities || [];
    const measured = ctx.measured;
    const distanceKm = num(ctx.distanceKm);
    if (!acts.length || !measured || !(num(measured.value) > 0) || !(distanceKm > 0)) return null;
    const hrMax = ctx.hrMax || acts.reduce((m, a) => { const h = Number(a && a.maxHR); return Number.isFinite(h) && h > m ? h : m; }, 0) || undefined;
    const state = estimateFitnessState(acts, { today: ctx.today, hrMax, races: ctx.races });
    if (!state || !(state.vdot > 0)) return null;
    const proj = projectRace(state, distanceKm, { activities: acts, today: ctx.today, hrMax });
    const g = computePotentialGap({
      measuredVo2: measured.value, source: measured.source, vo2Date: measured.date,
      raceVdot: state.vdot, distanceKm, today: ctx.today,
      currentSecsOverride: proj ? proj.seconds : null,
    });
    if (!g) return null;
    return { ...g, currentStr: hms(g.currentSecs), ceilingStr: hms(g.ceilingSecs), reachStr: hms(g.reachSecs), gapStr: hms(g.gapSecs) };
  } catch { return null; }
}

export default computePotentialGap;
