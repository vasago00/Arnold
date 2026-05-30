// ─── CoachComment — Phase 4r.narrative.5.fix.25 ────────────────────────────
//
// The ambient Coach. Instead of a dedicated Coach tab (retired), the Coach
// speaks contextually on the screens where its observation is actionable:
//
//   surface='edgeiq' → the leverage point + today's action
//   surface='daily'  → today's fueling call
//   surface='plan'   → training adjustment
//   surface='trend'  → recovery read
//
// One subtle, sigil-marked line per surface. The Coach only speaks when it
// has something relevant to THAT surface — if no matching observation fires,
// the component renders nothing (no empty box). This is the "Arnold is the
// coach, not in the audience" model: guidance woven into the status screens,
// not parked on a page you have to visit.
//
// Visual register: deliberately quiet. The Convergent Wedge sigil (teal,
// constant) + a small state dot + one line in the Coach's voice. No tinted
// alert frame — it reads as a margin note from a trusted advisor, not a
// banner. Severity lives only in the dot color.
//
// All surfaces share one computeUserState pass (memoized on storageVersion),
// so the Coach is internally consistent: the fueling line on Daily and the
// leverage line on EdgeIQ reflect the same tick of data.

import React, { useMemo, useState, useEffect } from 'react';
import { storage } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { safeCompute } from '../core/safeCompute.js';
import { computeUserState, synthesizeRecommendations } from '../core/intelligence.js';
import { composeNarrative } from '../core/narrativeComposer.js';
import { activityLabel, activityKind } from '../core/activityClass.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { CoachSigil } from './CoachSigil.jsx';
import { getIFProfile, isInFastingWindow } from '../core/intermittentFasting.js';

const COACH_TEAL = '#5eead4';

// ─── Surface registry — Phase 4r.narrative.5.fix.28 ────────────────────────
// Surfaces are named after the REAL screens, per format. The same `tab` id
// renders different screens on web vs mobile (the legacy tab-id trap), so we
// don't key off tab ids — each call site passes the explicit screen surface.
//
// Screen inventory + dedicated Coach decision (user-confirmed 2026-05-27):
//
//   MOBILE                                  WEB
//   ──────                                  ───
//   start         the one thing (leverage)  edgeiq_web   leverage + action
//   edgeiq_mobile recovery/readiness read   trend        recovery/trend read
//   fuel          fueling decision          daily        fueling + action
//   play          session readiness + fuel  plan         training adjustment / goal
//   calendar      race-aware (future)       calendar     race-aware (future)
//
// Note: there is NO "Train" screen. Play (mobile) is the training-execution
// screen; it draws from the Train pillar internally, but the screen is "Play."
//
//   mode 'leverage' — narrative's single leverage point + action sentence.
//   mode 'pillar'   — highest-severity ACTIONABLE synth card whose pillar is
//                     in the listed set (cards are severity-sorted).
const SURFACE_CONFIG = {
  // ── Mobile screens (Phase 4r.coach.cadence) ──────────────────────────────
  // Per-screen cadence per user spec:
  //   Start  → brief cross-dimensional brief (leverage point)
  //   EdgeIQ → library / depth: echoes Start + accentuates a 2nd signal
  //   Play   → state-aware training journey (post/pre/logged/rest/open)
  //   Fuel   → state-aware nutrition journey (post-workout/race-week/morning…)
  start:         { mode: 'leverage' },
  edgeiq_mobile: { mode: 'library' },
  play:          { mode: 'playState' },
  fuel:          { mode: 'fuelState' },

  // ── Web screens — Phase 4r.coach.amplify ────────────────────────────────
  // Now that the dedicated Coach tab is retired, each web surface gets its
  // own dedicated voice instead of falling back to a generic pillar pick.
  edgeiq_web:    { mode: 'leverage' },                              // the one thing
  trend:         { mode: 'trendState' },                            // multi-week trend story
  daily:         { mode: 'pillar', pillars: ['Fuel'] },             // legacy (web Daily uses daily_digest now)
  plan:          { mode: 'planState' },                             // race horizon + goal trajectory

  // ── Daily diary digest — Phase 4r.narrative.5.fix.33 ──────────────
  // The Daily screen is the diary, not a dashboard of warnings. Instead
  // of three terse per-section lines (readiness/training/nutrition) it
  // gets ONE warm, cohesive Coach paragraph in the hero's right column.
  // The voice is reassuring by design: acknowledge what you did today
  // (training, fuel), then point at rest + tomorrow. No red labels, no
  // mechanical tags — a coach who's glad you showed up. See `composeDigest`.
  daily_digest:  { mode: 'digest' },

  // ── Per-section surfaces (legacy — kept for any caller still using
  // them, but the Daily screen now uses daily_digest instead) ──
  readiness:     { mode: 'pillar', pillars: ['Recover', 'Body'] },  // by the readiness hero
  training:      { mode: 'pillar', pillars: ['Train'] },            // by the session panel
  nutrition:     { mode: 'pillar', pillars: ['Fuel'] },             // by the nutrition panel

  // ── Both (race-aware comes with the HYROX work) ──
  calendar:      { mode: 'pillar', pillars: ['Goal'] },
};

// Map a coach-signal state OR a synth-card severity to a dot color.
function dotColorForState(state) {
  if (state === 'severe' || state === 'concerning' || state === 'critical' || state === 'concern') return '#f87171';
  if (state === 'moderate' || state === 'slowing' || state === 'adapting' || state === 'depleted' ||
      state === 'rising' || state === 'grey-zone' || state === 'hot' || state === 'impaired' ||
      state === 'mixed' || state === 'low' || state === 'warning' || state === 'attention') return '#fbbf24';
  if (state === 'mild' || state === 'sparse-easy' || state === 'info') return '#fbbf24aa';
  if (state === 'positive') return '#4ade80';
  return COACH_TEAL;
}

// ─── Warm daily digest — Phase 4r.narrative.5.fix.33 ───────────────────────
// Composes ONE cohesive, reassuring paragraph for the Daily diary. The whole
// soul of the Coach here is to make you want to come back tomorrow — it leads
// with what you DID (showed up, fueled), frames a rest day as a good call, and
// only ever nudges gently. It never opens with a deficit and never shouts in
// red. Three soft beats, joined into a single flowing sentence-paragraph:
//   1. Training — named if you trained, warmly reframed if you rested.
//   2. Fuel     — affirmed when on target, gently rounded when close.
//   3. Rest/forward — sleep as the win, then "come back at it tomorrow."
function joinList(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  if (a.length === 2) return `${a[0]} and ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, and ${a[a.length - 1]}`;
}

// Lower-case a session label for mid-sentence use, but keep all-caps acronyms
// (HIIT, HYROX) intact — "your hiit in today" reads wrong; "your HIIT" is right.
function phraseLabel(label) {
  const s = String(label || '');
  return /^[A-Z0-9]+$/.test(s) ? s : s.toLowerCase();
}

function composeDigest({ us, sessions, hour }) {
  if (!us) return null;
  const n = us.numbers || {};
  const beats = [];
  // Phase 4r.coach.digest.fix.1 — time-of-day awareness so the diary doesn't
  // say "tomorrow" when there are 6 hours left of today, and doesn't say
  // "tonight, the win is sleep" when it's 8am. Hour comes from the memo's
  // local clock (already passes through the 5-min tick).
  const isEvening   = typeof hour === 'number' && hour >= 17;
  const isLateNight = typeof hour === 'number' && hour >= 21;

  // ── Beat 1 · today's training ──
  const trainedToday = Array.isArray(sessions) && sessions.length > 0;
  if (trainedToday) {
    const kinds = [...new Set(sessions.map(activityLabel).filter(Boolean))];
    if (kinds.length >= 2) {
      beats.push(`Strong day — you stacked ${joinList(kinds.map(phraseLabel))}.`);
    } else {
      beats.push(`Good work getting your ${phraseLabel(kinds[0] || 'session')} in today.`);
    }
  } else {
    // Phase 4r.coach.digest.fix.2 — Daily digest now reads the planner before
    // declaring a rest day. Previously, when today had no completed session
    // AND yesterday you trained, the digest fell straight into "A rest day
    // today" — ignoring an Easy / Long / Strength session sitting on today's
    // plan. The fix mirrors what classifyPlayState already does for the Play
    // tab: check upcomingPlan.todayPlanned for a non-rest, not-done plan and
    // surface it instead of pretending today is empty.
    const todayPlan = us?.coachSignals?.upcomingPlan?.todayPlanned || null;
    const plannedNonRest = todayPlan && todayPlan.intensityClass && todayPlan.intensityClass !== 'rest' && !todayPlan.done;
    const plannedRest = todayPlan?.intensityClass === 'rest';
    const since = n.daysSinceLastActivity;
    if (plannedNonRest) {
      // Prefer the workout label (e.g. "Easy 6mi") over the bare intensity
      // class. phraseLabel lower-cases except for all-caps acronyms (HIIT).
      const rawLabel = todayPlan.label || `${todayPlan.intensityClass} session`;
      const label = phraseLabel(rawLabel);
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      if (isLateNight) {
        beats.push(`The ${label} on today's plan didn't happen — tomorrow's a clean reset.`);
      } else if (isEvening) {
        beats.push(`Still room for that ${label} on the plan today — even a shortened version counts.`);
      } else {
        beats.push(`${cap} on the plan today — when you're ready.`);
      }
    } else if (plannedRest || since === 1) {
      // Explicit rest in the plan, OR yesterday's session as the proxy.
      beats.push(`A rest day today — and after yesterday's work, that's exactly what the body wanted.`);
    } else if (since != null && since >= 3) {
      beats.push(`It's been ${since} days since your last session — no pressure; whenever you're ready, an easy one will feel great.`);
    } else {
      beats.push(`An easy day today, and that's perfectly fine.`);
    }
  }

  // ── Beat 2 · fuel (only speak if there's something logged) ──
  const intake  = n.todayIntake  || 0;
  const protein = n.todayProtein || 0;
  const pTarget = n.proteinTarget || 0;
  if (intake > 0) {
    if (pTarget > 0 && protein >= pTarget * 0.9) {
      beats.push(`Fuel was right where it needs to be — protein on target.`);
    } else if (protein > 0 && pTarget > 0) {
      const gap = Math.max(0, Math.round(pTarget - protein));
      // Phase 4r.coach.digest.fix.1 — gap is the REMAINING TODAY target. The
      // earlier wording said "more protein tomorrow rounds it out" which
      // implied tomorrow's target — wrong; tomorrow has its own target.
      // Now: still-daytime → frame as something to land today; late night
      // → acknowledge the day is closed and frame as a clean reset.
      if (gap >= 10) {
        beats.push(isLateNight
          ? `On the fuel side you came in ~${gap}g of protein short of today's target — tomorrow we hit it cleanly.`
          : isEvening
          ? `On the fuel side you're close — about ${gap}g of protein still to land today's target tonight.`
          : `On the fuel side you're close — another ${gap}g of protein gets you to today's target.`);
      } else {
        beats.push(`Fuel's in good shape today.`);
      }
    } else {
      beats.push(`Fuel's logged.`);
    }
  }

  // ── Beat 3 · rest + forward (time-of-day aware) ──
  // recoveryDebt is a clean 0..N integer from computeUserState; sleepAvg7d /
  // sleepGoalHrs are reliable numbers. We avoid reaching into signal internals.
  const sleepShort = (n.sleepAvg7d != null && n.sleepGoalHrs)
    && n.sleepAvg7d < (n.sleepGoalHrs - 1);
  const debtHeavy = (us.recoveryDebt || 0) >= 2 || sleepShort;
  // Phase 4r.coach.digest.fix.1 — only frame as "tonight" when it actually is
  // evening; otherwise speak in a way that matches the time of day.
  if (debtHeavy) {
    beats.push(isLateNight
      ? `Tonight's sleep is the lever — bank it and come back fresh tomorrow.`
      : isEvening
      ? `Tonight, the real win is sleep — that's what turns today's effort into progress.`
      : `Sleep is the lever this week — prioritize it tonight.`);
  } else if (trainedToday) {
    beats.push(isEvening
      ? `Now's the time to recover well and come back at it tomorrow.`
      : `Refuel + rest as the day winds down; tomorrow's session benefits.`);
  } else {
    beats.push(isEvening
      ? `Rest, refuel, and you'll be set to go tomorrow.`
      : `An easy day's groundwork still counts — keep the rhythm steady.`);
  }

  const tone = debtHeavy ? 'gentle' : (trainedToday ? 'positive' : 'neutral');
  return { text: beats.join(' '), tone };
}

// ─── Cadence-aware mobile Coach — Phase 4r.coach.cadence ───────────────────
// Mobile Play and Fuel speak differently through the day. The "state" is the
// most relevant moment in your training/fueling journey RIGHT NOW. Session
// windows (pre/post a workout) win first; clock-of-day is the fallback. The
// composers are warm and reassuring — same Coach voice as the Daily digest.

function sessionEndMs(a) {
  // Activities arrive from FIT/Garmin/manual with varying shapes; try the
  // common ones. If we can't pin a real end time we return null and the
  // classifier falls back to the date-only "logged today" bucket.
  const startStr = a?.startTimeUtc || a?.startTimeLocal || a?.startTime || a?.timestamp;
  if (!startStr) return null;
  const startMs = new Date(startStr).getTime();
  if (!Number.isFinite(startMs)) return null;
  const durSec = Number(a?.durationSecs)
    || (Number(a?.durationMinutes) ? Number(a.durationMinutes) * 60 : 0);
  return startMs + (durSec || 0) * 1000;
}

function nextPlannedAfterToday(upcomingPlan) {
  const arr = upcomingPlan?.next7Days || [];
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i];
    if (d?.intensityClass && d.intensityClass !== 'rest') return d;
  }
  return null;
}

function planLabel(plan) {
  if (!plan) return 'session';
  return plan.label || phraseLabel(plan.planned || 'session');
}

// ── Play state classifier ──────────────────────────────────────────────────
// Returns { kind, ctx } where kind is one of:
//   post_workout        — within ~75 min after a logged session today
//   pre_workout         — planned today + clock close to a typical workout slot
//   logged_earlier      — trained today but >75 min ago
//   planned_morning     — planned today, not done, morning
//   planned_midday      — planned today, not done, midday
//   planned_evening     — planned today, not done, evening
//   rest_day_planned    — today is explicit rest in the plan
//   open_morning        — no plan, nothing done, morning
//   open_midday         — no plan, nothing done, midday
//   evening_done        — late day wrap-up regardless of plan/session
function classifyPlayState({ sessions, upcomingPlan, nowMs, hour }) {
  const todayPlan = upcomingPlan?.todayPlanned || null;
  const trainedToday = sessions.length > 0;

  // Post-workout window first (75 min keeps the refuel call active).
  for (const a of sessions) {
    const end = sessionEndMs(a);
    if (end && (nowMs - end) >= 0 && (nowMs - end) <= 75 * 60 * 1000) {
      return { kind: 'post_workout', ctx: { session: a } };
    }
  }

  // Evening wrap-up — covers the "analytics later in the day" beat.
  if (hour >= 21) return { kind: 'evening_done', ctx: { trainedToday, todayPlan, nextPlanned: nextPlannedAfterToday(upcomingPlan) } };

  // Logged earlier today (>75 min ago, or no end-time but date matches).
  if (trainedToday) return { kind: 'logged_earlier', ctx: { session: sessions[0], todayPlan } };

  // Planned today, not done. Bucket by clock so the line evolves.
  if (todayPlan && todayPlan.intensityClass && todayPlan.intensityClass !== 'rest' && !todayPlan.done) {
    if (hour < 11) return { kind: 'planned_morning', ctx: { plan: todayPlan } };
    if (hour < 16) return { kind: 'planned_midday',  ctx: { plan: todayPlan } };
    return                  { kind: 'planned_evening', ctx: { plan: todayPlan } };
  }

  // Rest day per plan.
  if (todayPlan?.intensityClass === 'rest') {
    return { kind: 'rest_day_planned', ctx: { nextPlanned: nextPlannedAfterToday(upcomingPlan) } };
  }

  // Open day — no plan, nothing logged.
  if (hour < 11) return { kind: 'open_morning', ctx: {} };
  if (hour < 16) return { kind: 'open_midday',  ctx: {} };
  return                 { kind: 'open_evening', ctx: {} };
}

function composePlayLine({ kind, ctx }) {
  const tag = (s) => s; // hook for future per-state tag colors
  switch (kind) {
    case 'post_workout': {
      const lbl = phraseLabel(activityLabel(ctx.session) || 'session');
      return { tag: 'Refuel', body: `Strong ${lbl}. The refuel window is open — protein + carbs in the next 30 minutes.`, tone: 'positive' };
    }
    case 'logged_earlier': {
      const lbl = phraseLabel(activityLabel(ctx.session) || 'session');
      return { tag: 'Today done', body: `Today's ${lbl} is logged. Recovery is the work now — sleep tonight is the multiplier.`, tone: 'positive' };
    }
    case 'planned_morning': {
      const lbl = planLabel(ctx.plan);
      return { tag: 'On deck', body: `Today: ${lbl}. Loosen up and eat well early; we'll check readiness as it gets closer.`, tone: 'neutral' };
    }
    case 'planned_midday': {
      const lbl = planLabel(ctx.plan);
      return { tag: 'Coming up', body: `${lbl} ahead. Top off carbs about an hour out and settle the body.`, tone: 'neutral' };
    }
    case 'planned_evening': {
      const lbl = planLabel(ctx.plan);
      return { tag: 'Tonight', body: `${lbl} this evening — stay easy until then, sip water and electrolytes.`, tone: 'neutral' };
    }
    case 'rest_day_planned': {
      const nxt = ctx.nextPlanned;
      const nxtLine = nxt ? ` Tomorrow's ${planLabel(nxt).toLowerCase()} will need you fresh.` : '';
      return { tag: 'Rest day', body: `Rest day — let recovery do its job.${nxtLine}`, tone: 'positive' };
    }
    case 'evening_done': {
      const nxt = ctx.nextPlanned;
      const nxtLine = nxt ? `Tomorrow: ${planLabel(nxt).toLowerCase()}.` : `Tomorrow is open.`;
      return { tag: 'Wrap-up', body: `Day winding down. ${nxtLine} Sleep is the lever.`, tone: 'neutral' };
    }
    case 'open_morning':
      return { tag: 'Open day', body: `No plan locked in — read the body. An easy run or a rest day both land well today.`, tone: 'neutral' };
    case 'open_midday':
      return { tag: 'Open day', body: `Half the day's gone, still no session — a short easy one or rest, your call.`, tone: 'neutral' };
    case 'open_evening':
      return { tag: 'Today', body: `Quiet day on the training side. Tomorrow is a fresh start.`, tone: 'neutral' };
    default:
      return { tag: 'Today', body: 'Read the body and pick the right next move.', tone: 'neutral' };
  }
}

// ── Fuel state classifier ──────────────────────────────────────────────────
// Phase 4r.coach.cadence.fix.1 — race week is a MODIFIER, not a top-level
// state. Treating it as a top-level state made the same line play all day
// during race week (Emil's screenshot showed "RACE WEEK …" at 7pm,
// unchanged from morning). The day still has a morning→midday→evening
// cadence; race week just colours each beat with the "keep loading carbs"
// frame instead of generic fueling.
function classifyFuelState({ us, sessions, raceHorizon, nowMs, hour }) {
  const n = us.numbers || {};

  // ── Modifier: race week ──
  const raceWeek =
    !!raceHorizon &&
    (raceHorizon.phase === 'race-week' ||
     (raceHorizon.daysOut != null && raceHorizon.daysOut >= 0 && raceHorizon.daysOut <= 5));
  const raceCtx = raceWeek
    ? { name: raceHorizon.race?.name || null, daysOut: raceHorizon.daysOut, type: raceHorizon.race?.type || null }
    : null;

  // ── Post-workout refuel wins regardless of clock or race week ──
  for (const a of sessions) {
    const end = sessionEndMs(a);
    if (end && (nowMs - end) >= 0 && (nowMs - end) <= 60 * 60 * 1000) {
      return { kind: 'post_workout_refuel', ctx: { session: a, raceWeek, raceCtx } };
    }
  }

  const intake  = Number(n.todayIntake)  || 0;
  const protein = Number(n.todayProtein) || 0;
  const kcalT   = Number(n.goalTarget)    || 0;
  const proteinT = Number(n.proteinTarget) || 0;
  const intakePct  = kcalT > 0 ? intake / kcalT : 0;
  const proteinPct = proteinT > 0 ? protein / proteinT : 0;

  // Phase 4r.if.coach.2 — surface IF state on every baseCtx so downstream
  // composers can skip "morning fuel" nags before the eating window opens.
  const ifProfile = getIFProfile();
  const ifCtx = {
    isIF: !!ifProfile?.isIF,
    isInFastingWindow: isInFastingWindow(hour),
    eatingWindowStart: ifProfile?.typicalEatingWindowStart || null,
  };
  const baseCtx = { intake, protein, kcalT, proteinT, intakePct, proteinPct, raceWeek, raceCtx, if: ifCtx };

  if (hour < 11) {
    return { kind: intakePct < 0.15 ? 'morning_open' : 'morning_started', ctx: baseCtx };
  }
  if (hour < 16) {
    if (proteinPct < 0.45) return { kind: 'midday_behind_protein', ctx: baseCtx };
    return                  { kind: 'midday_on_track',        ctx: baseCtx };
  }
  if (hour < 21) {
    if (intakePct < 0.75) return { kind: 'evening_under_target', ctx: baseCtx };
    if (intakePct > 1.05) return { kind: 'evening_over_target',  ctx: baseCtx };
    return                       { kind: 'evening_on_target',    ctx: baseCtx };
  }
  return { kind: 'late_wrap', ctx: baseCtx };
}

// ── Race-week copy that swaps in per time-of-day kind so the line still
// evolves through the day on race week instead of being one stuck banner.
function composeFuelLineRaceWeek({ kind, ctx }) {
  const d = ctx.raceCtx?.daysOut;
  const tDay = d == null ? 'race week' : d === 0 ? 'Race day' : `T-${d}`;
  switch (kind) {
    case 'post_workout_refuel':
      return { tag: `${tDay} refuel`, body: `Refuel hard — ~50g carbs + 25g protein in the next 30 minutes to top off glycogen.`, tone: 'positive' };
    case 'morning_open':
      return { tag: `${tDay} breakfast`, body: `Start loading — oats + fruit + juice with breakfast. Carbs are the priority all day.`, tone: 'neutral' };
    case 'morning_started':
      return { tag: `${tDay} morning`, body: `Carbs flowing — keep them coming with a mid-morning snack (banana, toast, dates).`, tone: 'positive' };
    case 'midday_behind_protein':
    case 'midday_on_track':
      return { tag: `${tDay} lunch`, body: `Anchor lunch with rice, pasta, or potatoes. Protein moderate, carbs high.`, tone: 'neutral' };
    case 'evening_under_target':
      return { tag: `${tDay} dinner`, body: `Still room to load — starch-heavy dinner (pasta, rice, potatoes) closes the day right.`, tone: 'neutral' };
    case 'evening_on_target':
      return { tag: `${tDay} dinner`, body: `Top off with a starch-heavy dinner. Sip electrolytes, light on protein.`, tone: 'positive' };
    case 'evening_over_target':
      return { tag: `${tDay} dinner`, body: `Past target on calories — that's fine this week. Keep the carb skew; ease protein and fat.`, tone: 'neutral' };
    case 'late_wrap':
      return { tag: `${tDay} wrap`, body: `Day's loading done. Sleep is the next fuel; tomorrow we keep going.`, tone: 'neutral' };
    default:
      return { tag: tDay, body: `Keep carbs steady across the day.`, tone: 'neutral' };
  }
}

function composeFuelLine({ kind, ctx }) {
  if (ctx?.raceWeek) return composeFuelLineRaceWeek({ kind, ctx });
  switch (kind) {
    case 'post_workout_refuel':
      return { tag: 'Refuel', body: `Refuel window: ~30g carbs + 30g protein in the next 30 minutes.`, tone: 'positive' };
    case 'morning_open': {
      // Phase 4r.if.coach.1 — IF users don't eat breakfast. The default
      // "Frontload protein at breakfast" line was wrong for them. When the
      // user is in their detected fasting window, reframe to acknowledge
      // the eating window rather than nag about a meal they don't take.
      if (ctx?.if?.isInFastingWindow) {
        const openHour = ctx.if.eatingWindowStart;
        const openTxt = openHour != null ? ` (≈${openHour > 12 ? openHour - 12 : openHour}${openHour >= 12 ? 'pm' : 'am'})` : '';
        return {
          tag: 'Today',
          body: `Fasting window. Target ${ctx.kcalT || '—'} kcal · ${ctx.proteinT || '—'}g protein once the window opens${openTxt}.`,
          tone: 'neutral',
        };
      }
      return { tag: 'Today', body: `Today's target: ${ctx.kcalT || '—'} kcal · ${ctx.proteinT || '—'}g protein. Frontload protein at breakfast.`, tone: 'neutral' };
    }
    case 'morning_started':
      return { tag: 'On track', body: `Solid start — keep the protein flow going.`, tone: 'positive' };
    case 'midday_behind_protein': {
      const gap = Math.max(0, Math.round(ctx.proteinT - ctx.protein));
      return { tag: 'Protein', body: `${Math.round(ctx.protein)} of ${ctx.proteinT}g protein logged. Anchor lunch with ~35g — ${gap}g still to go.`, tone: 'gentle' };
    }
    case 'midday_on_track':
      return { tag: 'On pace', body: `${Math.round(ctx.intake)} / ${ctx.kcalT} kcal · protein tracking. Keep the rhythm.`, tone: 'positive' };
    case 'evening_under_target': {
      const left = Math.max(0, Math.round(ctx.kcalT - ctx.intake));
      return { tag: 'Tonight', body: `~${left} kcal left to land target — make dinner protein-dense.`, tone: 'gentle' };
    }
    case 'evening_on_target':
      return { tag: 'On target', body: `Near target — light dinner with protein lands it.`, tone: 'positive' };
    case 'evening_over_target':
      return { tag: 'Past target', body: `Past target — a lighter, protein-led dinner closes the day clean.`, tone: 'gentle' };
    case 'late_wrap':
      return { tag: 'Wrap-up', body: `Day's fueling: ${Math.round(ctx.intake)} / ${ctx.kcalT} kcal. Sleep is the next fuel.`, tone: 'neutral' };
    default:
      return { tag: 'Today', body: 'Fuel steadily — protein first, carbs around training.', tone: 'neutral' };
  }
}

// ─── Web Plan composer — race-horizon + goal trajectory aware ─────────────
// Plan is the long-arc surface. Voice is "where are we in the arc + what
// phase needs from you." Race horizon wins when present; otherwise goal-
// progress framing.
function composePlanLine({ us, raceHorizon }) {
  if (raceHorizon?.race && raceHorizon.daysOut != null && raceHorizon.daysOut >= 0) {
    const days = raceHorizon.daysOut;
    const name = raceHorizon.race.name || 'Race';
    const dayPart = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
    switch (raceHorizon.phase) {
      case 'race-week':
        return { tag: 'Race week', body: `${name} ${dayPart}. Final phase — carb load, sleep, sharpen, no new stimulus.`, tone: 'neutral' };
      case 'taper':
        return { tag: 'Taper', body: `${name} ${dayPart} — taper phase: dial volume back, keep intensity sharp.`, tone: 'neutral' };
      case 'peak':
        return { tag: 'Peak block', body: `${name} ${dayPart} — peak block: race-pace work and recovery discipline.`, tone: 'neutral' };
      case 'build':
        return { tag: 'Build phase', body: `${name} ${dayPart} — base building: weekly mileage and consistency are the levers.`, tone: 'neutral' };
      case 'recovery':
        return { tag: 'Post-race', body: `Recovering from ${name} — easy days, eat well, no pressure.`, tone: 'positive' };
      default:
        return { tag: 'Long arc', body: `${name} ${dayPart} — foundation phase: aerobic base, sleep, body comp.`, tone: 'neutral' };
    }
  }
  // Cut-mode-aware framing (task #218). When no race is imminent, the cut
  // state classifier carries more specific signal than the legacy trajectory
  // tone — it distinguishes intentional cuts (quiet), stalled cuts (refeed
  // call), crash cuts (ease back), acute cuts (refuel today), and under-
  // fueled-without-goal (RED-S alarm). Use its recommendation as the Plan
  // line when state is meaningful.
  const cm = us?.cutMode;
  if (cm?.state && cm.state !== 'maintenance' && cm.state !== 'unknown' && cm.recommendation) {
    const tagMap = {
      background_cut: 'Cut on pace',
      stalled_cut:    'Cut stalled',
      crash_cut:      'Cut too steep',
      acute_cut:      'Intake drop',
      under_fueled:   'Under-fueled',
      surplus:        'Surplus',
    };
    const toneMap = {
      background_cut: 'positive',
      stalled_cut:    'gentle',
      crash_cut:      'gentle',
      acute_cut:      'gentle',
      under_fueled:   'gentle',
      surplus:        'neutral',
    };
    return {
      tag:  tagMap[cm.state] || 'Plan',
      body: cm.recommendation,
      tone: toneMap[cm.state] || 'neutral',
    };
  }

  // Goal-progress framing when no race AND no actionable cut state.
  const gp = us?.coachSignals?.goalProgress;
  const tone = us?.trajectory;
  if (tone === 'on-pace')   return { tag: 'On pace', body: `Goal trajectory is on pace — keep the pattern.`, tone: 'positive' };
  if (tone === 'ahead')     return { tag: 'Ahead', body: `Ahead of pace — sustainable as long as recovery holds.`, tone: 'positive' };
  if (tone === 'behind')    return { tag: 'Behind goal', body: `Trajectory below pace. Tighten intake by ~150 kcal/day or extend the target date.`, tone: 'gentle' };
  if (tone === 'stalled')   return { tag: 'Stalled', body: `Weight is stalled. Recalibrate target rate or look for hidden intake.`, tone: 'gentle' };
  if (gp?.note)             return { tag: 'Plan', body: gp.note, tone: 'neutral' };
  return { tag: 'Plan', body: `The long arc is open — what's the next race or milestone?`, tone: 'neutral' };
}

// ─── Web Trend composer — multi-week trend story ──────────────────────────
// Trend is the analytical surface. Voice is "what the trends say across 7-30
// days." Most pressing trend wins; positive affirmation when stable.
function composeTrendLine({ us }) {
  const cs = us?.coachSignals || {};
  const debt = cs.sleepDebt?.status;
  const hrv  = cs.hrvDepression?.status;
  const rhr  = cs.rhrDrift?.status;
  const mono = cs.monotonyStrain?.status;
  const vel  = cs.recoveryVelocity?.status;

  if (debt === 'severe')                  return { tag: 'Recovery trend', body: `Sleep debt has stacked across the week — banking sleep is the highest-yield change this stretch.`, tone: 'gentle' };
  if (hrv === 'depressed' || hrv === 'concerning') return { tag: 'HRV trend', body: `HRV running below baseline — load may be ahead of recovery. Easier days restore the signal.`, tone: 'gentle' };
  if (rhr === 'rising')                    return { tag: 'RHR drift', body: `RHR drifting up week over week — common early sign of accumulated fatigue or illness.`, tone: 'gentle' };
  if (vel === 'slowing')                   return { tag: 'Recovery slowing', body: `Recovery velocity after hard sessions is slowing — bouncing back is taking longer than your baseline.`, tone: 'gentle' };
  if (mono === 'high-monotony' || mono === 'concerning') return { tag: 'Monotony', body: `Training has been monotonous — same effort every day. Hard/easy contrast restores progression.`, tone: 'neutral' };
  if (debt === 'paid' && (hrv === 'stable' || hrv === 'positive')) {
    return { tag: 'Trends solid', body: `Recovery paid + HRV steady — adaptation window is open. Build into it.`, tone: 'positive' };
  }
  return { tag: 'Trends', body: `Last 7–30 days holding steady across recovery and load.`, tone: 'neutral' };
}

// ── EdgeIQ mobile "library" composer — echoes Start, accentuates a 2nd signal
// Start gives the one thing; EdgeIQ goes one layer deeper with the leverage's
// context PLUS a different signal you haven't heard about yet. Two sentences.
function composeMobileLibrary({ narrative, cards }) {
  const lp = narrative?.leveragePoint;
  const story = narrative?.story;
  const aligned = narrative?.alignedFallback || !lp;

  if (aligned) {
    const open = story?.macroContext?.text || story?.opening || 'Systems aligned — nothing pulling against your goals today.';
    return { tag: 'On track', body: open, tone: 'positive' };
  }

  const opening = story?.opening || story?.action?.text || `${lp.label} is the lever today.`;
  const lpLabelLower = String(lp.label || '').toLowerCase();
  // Find a secondary card whose topic doesn't overlap the leverage label.
  const secondary = (cards || []).find(c => {
    const t = `${c.title || ''} ${c.detail || ''} ${c.pillar || ''}`.toLowerCase();
    return !t.includes(lpLabelLower);
  });
  const secLine = secondary
    ? (secondary.recommendation || secondary.title || secondary.detail || '').trim()
    : '';
  const body = secLine ? `${opening} ${secLine}` : opening;
  return { tag: lp.label, body, tone: lp.state, dot: dotColorForState(lp.state) };
}

export function CoachComment({ surface = 'edgeiq', onOpen, style }) {
  const storageVersion = useStorageVersion();
  // Phase 4r.coach.cadence.fix.1 — time-of-day tick. The Coach state machine
  // routes off `hour`, but the memo only fires on storage writes. Without a
  // periodic tick the line gets "stuck" all morning even though the bucket
  // crossed into midday. 5 minutes is the sweet spot — fine-grained enough
  // that bucket transitions feel live, cheap enough that we don't recompute
  // userState every tick (the JS work is < 50ms on a modern phone).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const computed = useMemo(() => safeCompute('CoachComment:compute', () => {
    const data = {
      activities:   storage.get('activities')   || [],
      sleep:        storage.get('sleep')        || [],
      hrv:          storage.get('hrv')          || [],
      weight:       storage.get('weight')       || [],
      cronometer:   storage.get('cronometer')   || [],
      nutritionLog: storage.get('nutritionLog') || [],
      wellness:     storage.get('wellness')     || [],
      planner:      storage.get('planner')      || null,
      profile:      { ...(storage.get('profile') || {}), ...getGoals() },
    };
    const us = computeUserState(data);
    const narrative = composeNarrative(us);
    const cards = synthesizeRecommendations(us, { rawInsights: [], rawPrompts: [] }) || [];
    // Today's REAL sessions — activityKind() !== 'other' excludes incidental
    // movement (walks classify as 'other'), so a stroll doesn't get celebrated
    // as "today's session" (Coach v1 fix #89).
    const sessions = (data.activities || [])
      .filter(a => a?.date === us?.asOf && activityKind(a) !== 'other');
    // Phase 4r.coach.cadence — extras for the state-aware Play/Fuel composers.
    const upcomingPlan = us?.coachSignals?.upcomingPlan || null;
    const raceHorizon  = us?.coachSignals?.raceHorizon  || null;
    const nowMs = Date.now();
    const hour  = new Date().getHours();
    return { narrative, cards, us, sessions, upcomingPlan, raceHorizon, nowMs, hour };
  }, null), [storageVersion, tick]);

  if (!computed) return null;
  const { narrative, cards, us, sessions, upcomingPlan, raceHorizon, nowMs, hour } = computed;
  const cfg = SURFACE_CONFIG[surface] || SURFACE_CONFIG.edgeiq;

  // ── Resolve the single comment for this surface ──
  let tag = null;      // short context label (uppercase) — e.g. "SLEEP DEBT" / "FUEL"
  let body = null;     // the Coach's sentence
  let dot = COACH_TEAL;

  // Phase 4r.narrative.5.fix.31 — BALANCED feedback. Coaching isn't only
  // about what's wrong; a good coach also tells you what's working. We no
  // longer suppress positive/affirming cards — the Coach speaks on each
  // surface whether the news is good or corrective. Severity only drives
  // the tag COLOR (red = concern, amber = watch, green = positive, teal =
  // neutral). The Coach still stays silent only when there's genuinely
  // nothing relevant to that surface at all.

  // Phase 4r.narrative.5.fix.33 — the Daily diary digest is its own register:
  // one warm, cohesive paragraph, NO uppercase tag, never red. We compose it
  // and fall straight to the render (the `tag` stays null so no prefix shows).
  let isDigest = false;
  // Phase 4r.coach.cadence — state-aware Play & Fuel + library digest for
  // mobile EdgeIQ. These speak with the same warm voice as the Daily digest
  // but resolve from session windows + clock-of-day fallback (Play/Fuel) or
  // leverage + secondary signal (library).
  const STATE_TONE_DOT = { positive: '#4ade80', gentle: '#fbbf24', neutral: COACH_TEAL };
  if (cfg.mode === 'playState') {
    const s = classifyPlayState({ sessions, upcomingPlan, nowMs, hour });
    const line = composePlayLine(s);
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'fuelState') {
    const s = classifyFuelState({ us, sessions, raceHorizon, nowMs, hour });
    const line = composeFuelLine(s);
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'library') {
    const line = composeMobileLibrary({ narrative, cards });
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = line.dot || STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'planState') {
    const line = composePlanLine({ us, raceHorizon });
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'trendState') {
    const line = composeTrendLine({ us });
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'digest') {
    isDigest = true;
    const digest = composeDigest({ us, sessions, hour });
    if (!digest || !digest.text) return null;
    body = digest.text;
    dot = COACH_TEAL;
  } else if (cfg.mode === 'leverage') {
    const lp = narrative?.leveragePoint;
    const story = narrative?.story;
    const aligned = narrative?.alignedFallback || !lp;
    if (aligned) {
      // Affirming read — name what's holding up, don't go silent.
      tag = 'On track';
      dot = '#4ade80';
      body = story?.macroContext?.text || story?.opening
        || 'Systems aligned — nothing pulling against your goals today.';
    } else {
      tag = lp.label;
      dot = dotColorForState(lp.state);
      body = story?.action?.text || story?.opening || `${lp.label} is the leverage point.`;
    }
  } else {
    // pillar mode — first card matching the surface's pillars, regardless
    // of severity. Cards are severity-sorted, so a concern leads if present,
    // otherwise the positive/affirming card for that pillar shows. This is
    // how Readiness/Fueling/Training get an affirming line on a good day
    // instead of being blank.
    const match = (cards || []).find(c => cfg.pillars.includes(c.pillar));
    if (!match) return null; // genuinely nothing for this surface → silent
    tag = match.pillar;
    dot = dotColorForState(match.severity);
    body = match.recommendation || match.title || match.detail || '';
  }

  if (!body) return null;

  // Phase 4r.narrative.5.fix.30 — single-flow layout per user feedback:
  //   [sigil]  TAG: message…
  // The tag is a bold-caps, state-colored INLINE prefix to the message —
  // no separate header row, no leading dot (the app already has dots
  // everywhere; another one here was visual noise). The sigil is the only
  // mark; the colored tag carries severity (red = severe, amber = watch).
  // No line-clamp — the Coach finishes its sentence.
  return (
    <div
      onClick={onOpen || undefined}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 9,
        // Phase 4r.narrative.5.fix.31 — zero horizontal padding so the sigil
        // aligns flush with the container's content edge on every surface
        // (the old 2px inset made it look off relative to section siblings
        // on Plan/Trend while EdgeIQ's wrapper happened to absorb it).
        padding: '8px 0',
        cursor: onOpen ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Sigil nudged to sit on the cap-line of the bold tag rather than the
          line's top, so the mark reads as attached to the text it labels. */}
      <CoachSigil size={18} style={{ marginTop: 1, flexShrink: 0 }} />
      <div style={{
        flex: 1, minWidth: 0,
        // The diary digest reads as a short paragraph, so it gets a touch
        // more size + line-height + a softer primary-ish color than the
        // terse status lines (which stay secondary/12.5).
        fontSize: isDigest ? 13 : 12.5,
        lineHeight: isDigest ? 1.6 : 1.5,
        color: isDigest ? 'var(--text-primary)' : 'var(--text-secondary)',
        overflowWrap: 'anywhere',
      }}>
        {/* No tag in digest mode — a diary doesn't shout a label before it
            speaks. The terse status surfaces keep their bold-caps prefix. */}
        {tag && (
          <span style={{
            fontWeight: 800, color: dot,
            textTransform: 'uppercase', letterSpacing: '0.03em',
            marginRight: 6,
          }}>
            {tag}:
          </span>
        )}
        {body}
      </div>
    </div>
  );
}
