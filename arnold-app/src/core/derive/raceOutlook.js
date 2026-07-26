// core/derive/raceOutlook.js — the DUAL-TRACK race outlook. For every race on the athlete's calendar it
// projects fitness forward to race day and returns the predicted finish on two tracks — a high-confidence
// TARGET and an EARNED STRETCH — alongside the CURRENT "if you raced today" baseline, so every surface (the branched
// Berlin/NYC predictions, the Valencia moons, the mobile planning profile) reads ONE consistent set of numbers
// instead of each inventing its own. Pure; grounded in the locked fitness state, never a hand-typed goal.
//
// THE FORWARD MODEL — evidence-anchored, not guessed (see FITNESS_MODEL_ARCHITECTURE.md + the 2026-07 research):
//   • Advanced runners (3+ yr) improve ~2–4%/yr (RunnersConnect). An 11-year runner is advanced — so a 20-week
//     block is ~1–2% on the SPEED ceiling, not a tier.
//   • Volume is the untapped lever: it closes the MARATHON endurance fade (your speed VDOT already implies
//     ~3:49, but 10.7-mi long runs don't yet support it) and pushes toward the upper end of that band. So the
//     TARGET track uses 2.5%/yr, the STRETCH 4.5%/yr, capped at a realistic per-cycle VDOT gain.
//   • TARGET/STRETCH predictions assume the plan builds the volume to race at the projected VDOT (fade closed).
//     CURRENT (projectRace today) still carries the fade — genuinely "if you toed the line today".
//
// A goal is classified against these honestly: 'on-target' (Target reaches it → they coincide), 'stretch' (only the stretch
// reaches it), or 'beyond-cycle' (not this build — it belongs to a later race, e.g. Tokyo). No fabrication:
// the plan never claims a time the fitness math doesn't support.

import { projectRace } from './fitnessProjection.js';
import { raceTimeFromVdot } from '../coaching/vdot.js';
import { clamp } from '../stats.js';

const YEAR_DAYS = 365.25;
const KM_PER_MI = 1.60934;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// The promotion loop's trajectoryAdjust is normalised against its own max step (PROMOTE_STEP_MAX = 0.08) into
// a −1..+1 fraction: +1 = full promotion (you're absorbing over-delivery → project the TARGET track at the
// STRETCH rate), −1 = easing (project conservatively). This is what makes the plan "genuinely explore": as you
// prove capacity, your TARGET climbs toward your CEILING; when you can't absorb, it holds back.
const PROMOTE_ADJ_FULL = 0.08;   // keep in lockstep with promotionLoop.PROMOTE_STEP_MAX

// The unified ladder vocabulary (Emil 2026-07): CURRENT (race today) → TARGET (what the plan builds you to this
// cycle) → STRETCH (the upside you earn) → CEILING (engine potential); GOAL is your chosen time, a marker ON the
// ladder that COINCIDES with TARGET when it's reachable this cycle. Tunable, documented improvement rates below.
export const IMPROVE_TARGET = 0.025;    // /yr — advanced-runner steady rate (RunnersConnect 2–4% band)
export const IMPROVE_STRETCH = 0.045;   // /yr — upper end, earned by the untapped volume lever
export const MAX_CYCLE_VDOT_GAIN = 4;   // VDOT — most you add in ONE build; a full tier (~6) is multi-year

function parseDay(s) { return new Date(String(s).slice(0, 10) + 'T12:00:00'); }
function yearsBetween(a, b) {
  const d = (parseDay(b).getTime() - (a instanceof Date ? a.getTime() : parseDay(a).getTime())) / (YEAR_DAYS * 86400000);
  return Number.isFinite(d) ? d : 0;
}
const raceKm = (r) => num(r.distanceKm) || (num(r.distanceMi) ? num(r.distanceMi) * KM_PER_MI : null);
const raceGoalSecs = (r) => num(r.goalTimeSecs ?? r.goalTime ?? r.goal_time);

/**
 * raceOutlook({ state, races, today, activities, hrMax }) → [{ name, date, weeksOut, distanceKm,
 *   currentSecs, targetSecs, stretchSecs, goalSecs, verdict }] sorted by date, or null when there's no
 *   fitness state to project from (no fabrication).
 * @param state  the locked fitness state (estimateFitnessState) — { vdot, sigma, ... }
 */
export function raceOutlook({ state, races = [], today = new Date(), activities = [], hrMax, careerRaces = [], promotionAdjust = 0 } = {}) {
  if (!state || !(num(state.vdot) > 0)) return null;
  const t = today instanceof Date ? today : parseDay(today);
  // The promotion loop bends the TARGET track: +1 (full promote) lifts it to the STRETCH rate, −1 (ease) makes
  // it conservative. The STRETCH track itself is the fixed aspirational ceiling — promotion moves the realistic
  // line toward it, it doesn't inflate the ceiling.
  const frac = clamp((num(promotionAdjust) || 0) / PROMOTE_ADJ_FULL, -1, 1);
  const effTargetRate = IMPROVE_TARGET * (1 + frac * 0.8);   // ×1.8 at full promote ≈ STRETCH; ×0.2 at full ease
  const out = [];
  for (const r of (Array.isArray(races) ? races : [])) {
    if (!r || !r.date) continue;
    const dKm = raceKm(r);
    if (!(dKm > 0)) continue;
    const yrs = Math.max(0, yearsBetween(t, r.date));
    // Forward VDOT on each track (capped so a long horizon can't fabricate an unreal ceiling).
    const vTarget = Math.min(state.vdot * (1 + effTargetRate * yrs), state.vdot + MAX_CYCLE_VDOT_GAIN);
    const vStretch = Math.min(state.vdot * (1 + IMPROVE_STRETCH * yrs), state.vdot + MAX_CYCLE_VDOT_GAIN);
    // CURRENT — "if raced today"; projectRace carries the endurance fade, RELAXED by career durability (a
    // 16-marathon veteran doesn't blow up like a novice at the same recent volume), so pass the résumé through.
    const cur = (() => { try { return projectRace(state, dKm, { activities, today: t, hrMax, careerRaces }); } catch { return null; } })();
    const targetSecs = raceTimeFromVdot(vTarget, dKm * 1000);
    const stretchSecs = raceTimeFromVdot(vStretch, dKm * 1000);
    const goalSecs = raceGoalSecs(r);
    // GOAL's placement on the ladder: 'on-target' (reachable this cycle → Goal COINCIDES with Target), 'stretch'
    // (only the earned upside reaches it), or 'beyond-cycle' (past the stretch → it belongs to a later race).
    let verdict = 'no-goal';
    if (goalSecs > 0 && targetSecs && stretchSecs) {
      verdict = goalSecs >= targetSecs ? 'on-target'
        : goalSecs >= stretchSecs ? 'stretch'
          : 'beyond-cycle';
    }
    out.push({
      name: r.name || null,
      date: r.date,
      weeksOut: Math.round(yrs * 52 * 10) / 10,
      distanceKm: Math.round(dKm * 100) / 100,
      currentSecs: cur && cur.seconds > 0 ? Math.round(cur.seconds) : null,
      targetSecs: targetSecs ? Math.round(targetSecs) : null,
      stretchSecs: stretchSecs ? Math.round(stretchSecs) : null,
      goalSecs: goalSecs || null,
      verdict,
    });
  }
  out.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return out;
}

export default raceOutlook;
