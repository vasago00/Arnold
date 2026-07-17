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

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { storage } from '../core/storage.js';
import { allActivities as _allActivities } from '../core/dcyMath.js';
import { getGoals } from '../core/goals.js';
import { buildGoalModel } from '../core/goalResolve.js';   // canonical A-race resolver (goal race, not soonest)
import { resolveARace } from '../core/aRace.js';           // the ONE A-race resolver (goal race)
import { safeCompute } from '../core/safeCompute.js';
import { computeUserState, synthesizeRecommendations } from '../core/intelligence.js';
import { composeNarrative } from '../core/narrativeComposer.js';
import { activityLabel, activityKind } from '../core/activityClass.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';
import { CoachSigil } from './CoachSigil.jsx';
import { getIFProfile, isInFastingWindow } from '../core/intermittentFasting.js';
import { hubFacts } from '../core/hub/hubFacts.js';
import { racePredictionOpts } from '../core/derive/tileMetrics.js';
import { hubCoachInsights } from '../core/hub/coachInsights.js';
import { refuelPhrase, fuelGapAdvice } from '../core/coachRefuel.js';
import { recoveryCoef } from '../core/dcy.js';
import { getSeasonCoach } from '../core/seasonCoach.js';
import { narrateSurface } from '../core/coachNarrative.js';          // Coach Narrative engine (Phase B)
import { buildCoachContext } from '../core/coachContext.js';         // live context assembler
import { recordShown } from '../core/coachMemory.js';                // episodic memory — record what was shown
import { recordEngagement } from '../core/coachPersonalization.js';  // preference learning — record interaction (Stage 4)
import { localDate } from '../core/time.js';                         // local YYYY-MM-DD
import { resolveTrainingProfile } from '../core/trainingProfile.js'; // async goal-vs-current profile → weakLink (slice 2b)

const COACH_TEAL = '#5eead4';

// Map the training profile's weak-link ingredient (key: threshold|longest|volume — the biggest
// GOAL gap) onto the engine's BUILDS lever, so gPurpose can say "this is the exact gap the
// profile flags" on a day whose session trains that limiter. Only present when the profile finds
// a real goal-anchored gap → no fabricated limiter claims.
const WEAKLINK_LEVER = { threshold: 'threshold', longest: 'endurance', volume: 'aerobic' };
const mapWeakLink = (wl) => { const k = wl && wl.key; return k ? (WEAKLINK_LEVER[k] || null) : null; };

// Season coach read (this-week target + why), best-effort — null when no season.
function safeSeasonCoach() {
  try { const sc = getSeasonCoach(); return sc && sc.plan ? sc : null; } catch { return null; }
}

// Today's recovery (DCY pillar 0..1) as a %, and a plain word for the coach voice.
function recoveryPctForCoach() {
  try { const r = recoveryCoef(new Date().toISOString().slice(0, 10)); return (r != null && Number.isFinite(r)) ? Math.round(Math.min(1, r) * 100) : null; }
  catch { return null; }
}
function recWord(pct) { return pct == null ? null : pct >= 80 ? 'fresh' : pct >= 60 ? 'moderate' : 'low'; }
const cap1 = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// Athlete mass in kg for fuel math — profile bodyweight, else latest weigh-in,
// with an lb→kg heuristic (runners are 45–110 kg; > 110 is almost certainly lb).
function bodyKgForCoach() {
  try {
    const p = storage.get('profile') || {};
    let w = Number(p.bodyweight ?? p.weight) || 0;
    if (!w) {
      const arr = (storage.get('weight') || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      w = Number(arr[0]?.weight ?? arr[0]?.lbs ?? arr[0]?.value) || 0;
    }
    if (!w) return 70;
    return w > 110 ? Math.round(w * 0.453592) : Math.round(w);
  } catch { return 70; }
}

const _HARD_INTENSITY = new Set(['tempo', 'threshold', 'intervals', 'hiit', 'race', 'speed', 'fartlek']);
// Tomorrow's session (if the next planned session is ~1 day out) → { label, hard }.
function tomorrowSessionCtx(upcomingPlan) {
  const nxt = nextPlannedAfterToday(upcomingPlan);
  if (!nxt || (nxt.daysOut != null && nxt.daysOut > 1)) return { label: null, hard: false };
  const hard = _HARD_INTENSITY.has(String(nxt.intensityClass || nxt.type || '').toLowerCase());
  return { label: planLabel(nxt), hard };
}

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
  // Phase 4r.coach.racename — when today IS a race, name it instead of the
  // generic activity class. A HYROX logs as "HIIT" via activityKind, so the
  // digest said "your HIIT in today" on race day. Pull the race name from the
  // raceHorizon signal (daysOut === 0 AND its date matches today).
  const rh = us?.coachSignals?.raceHorizon || null;
  const raceName = (rh && rh.daysOut === 0 && rh.race?.date === us?.asOf && rh.race?.name) ? rh.race.name : null;
  if (trainedToday) {
    const kinds = [...new Set(sessions.map(activityLabel).filter(Boolean))];
    if (raceName) {
      beats.push(`Race done — you raced ${raceName} today. 🏁`);
    } else if (kinds.length >= 2) {
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
    // Return the next day that has an actual planned session. Mobility maps
    // to intensityClass 'rest' (it's low-load), so we can't filter on
    // intensityClass alone — that skipped scheduled mobility days and made
    // the wrap-up jump to the next hard day (e.g. a race) while still saying
    // "Tomorrow." A genuine rest day has no `planned` type; a mobility day
    // does. Treat "has a planned type" as the real signal.
    if (d?.planned && d.planned !== 'rest') return d;
  }
  return null;
}

// Phrase a day relative to today by its daysOut (1 = tomorrow). Avoids the
// old bug where the wrap-up hardcoded "Tomorrow" for any upcoming session
// regardless of how many days away it actually was.
function relativeDayWord(daysOut, dow) {
  if (daysOut === 1) return 'Tomorrow';
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const name = (typeof dow === 'number' && DOW[dow]) ? DOW[dow] : null;
  if (daysOut >= 2 && daysOut <= 6 && name) return name;       // within the week → weekday name
  if (daysOut === 7) return `Next ${name || 'week'}`;
  return name || `in ${daysOut} days`;
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
function classifyPlayState({ sessions, upcomingPlan, nowMs, hour, raceName = null }) {
  const todayPlan = upcomingPlan?.todayPlanned || null;
  const trainedToday = sessions.length > 0;
  const tomorrow = tomorrowSessionCtx(upcomingPlan);   // { label, hard } — data for grounded lines
  const rec = recoveryPctForCoach();                    // today's recovery % (0..100 | null)

  // Post-workout window first (75 min keeps the refuel call active).
  for (const a of sessions) {
    const end = sessionEndMs(a);
    if (end && (nowMs - end) >= 0 && (nowMs - end) <= 75 * 60 * 1000) {
      return { kind: 'post_workout', ctx: { session: a, raceName } };
    }
  }

  // Evening wrap-up — covers the "analytics later in the day" beat.
  if (hour >= 21) return { kind: 'evening_done', ctx: { trainedToday, todayPlan, nextPlanned: nextPlannedAfterToday(upcomingPlan) } };

  // Logged earlier today (>75 min ago, or no end-time but date matches).
  if (trainedToday) return { kind: 'logged_earlier', ctx: { session: sessions[0], todayPlan, raceName, tomorrow, rec } };

  // Planned today, not done. Bucket by clock so the line evolves.
  if (todayPlan && todayPlan.intensityClass && todayPlan.intensityClass !== 'rest' && !todayPlan.done) {
    if (hour < 11) return { kind: 'planned_morning', ctx: { plan: todayPlan, rec } };
    if (hour < 16) return { kind: 'planned_midday',  ctx: { plan: todayPlan, rec } };
    return                  { kind: 'planned_evening', ctx: { plan: todayPlan, rec } };
  }

  // Rest day per plan.
  if (todayPlan?.intensityClass === 'rest') {
    return { kind: 'rest_day_planned', ctx: { nextPlanned: nextPlannedAfterToday(upcomingPlan), tomorrow, rec } };
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
      // Race day → name the race (HYROX classifies as HIIT otherwise). Specific
      // refuel from the actual session (kcal out → grams in), not generic filler.
      const lbl = ctx.raceName || phraseLabel(activityLabel(ctx.session) || 'session');
      const r = refuelPhrase(ctx.session, bodyKgForCoach(), lbl);
      return { tag: 'Refuel', body: r.text, tone: 'positive' };
    }
    case 'logged_earlier': {
      const lbl = ctx.raceName || phraseLabel(activityLabel(ctx.session) || 'session');
      // Ground the recovery call: tie to tomorrow's demand + today's recovery read.
      const rw = recWord(ctx.rec);
      const tmrw = ctx.tomorrow?.label
        ? (ctx.tomorrow.hard ? ` ${cap1(ctx.tomorrow.label)} tomorrow needs you fresh` : ` Easy day tomorrow`)
        : '';
      const recBit = rw === 'low' ? ` Recovery's reading low (${ctx.rec}%) — protect tonight's sleep.`
        : rw === 'fresh' ? ` Recovery's holding (${ctx.rec}%).`
        : '';
      const head = ctx.raceName ? `${lbl} is in the books.` : `Today's ${lbl} is logged.`;
      return { tag: 'Today done', body: `${head}${tmrw ? `${tmrw} —` : ' Recovery is the work now —'} sleep is the multiplier.${recBit}`, tone: 'positive' };
    }
    case 'planned_morning': {
      const lbl = planLabel(ctx.plan);
      const rw = recWord(ctx.rec);
      const readTxt = rw === 'low' ? ` Recovery's low (${ctx.rec}%) — treat it as a green-light-only day; ease off if it's a hard session.`
        : rw === 'fresh' ? ` Recovery's fresh (${ctx.rec}%) — good to go.`
        : rw === 'moderate' ? ` Recovery's moderate (${ctx.rec}%).` : '';
      return { tag: 'On deck', body: `Today: ${lbl}. Loosen up and eat well early.${readTxt}`, tone: 'neutral' };
    }
    case 'planned_midday': {
      const lbl = planLabel(ctx.plan);
      const rw = recWord(ctx.rec);
      const hardLow = rw === 'low' && _HARD_INTENSITY.has(ctx.plan?.intensityClass);
      const flag = hardLow ? ` Recovery's low (${ctx.rec}%) — if the legs are flat, run it easy instead.`
        : rw === 'fresh' ? ` Recovery's good (${ctx.rec}%) — send it.` : '';
      return { tag: 'Coming up', body: `${lbl} ahead. Top off carbs about an hour out and settle the body.${flag}`, tone: hardLow ? 'gentle' : 'neutral' };
    }
    case 'planned_evening': {
      const lbl = planLabel(ctx.plan);
      const rw = recWord(ctx.rec);
      const hardLow = rw === 'low' && _HARD_INTENSITY.has(ctx.plan?.intensityClass);
      const flag = hardLow ? ` Recovery's low (${ctx.rec}%) — consider dialing it to an easy run.` : '';
      return { tag: 'Tonight', body: `${lbl} this evening — stay easy until then, sip water and electrolytes.${flag}`, tone: hardLow ? 'gentle' : 'neutral' };
    }
    case 'rest_day_planned': {
      const nxt = ctx.nextPlanned;
      const rw = recWord(ctx.rec);
      const nxtLine = nxt
        ? ` ${relativeDayWord(nxt.daysOut, nxt.dow)}'s ${planLabel(nxt)} will want you fresh.`
        : '';
      const recBit = rw === 'low' ? ` Recovery's still low (${ctx.rec}%) — this rest is well-timed.`
        : rw === 'fresh' ? ` Recovery's already back (${ctx.rec}%).` : '';
      return { tag: 'Rest day', body: `Rest day — let recovery do its job.${recBit}${nxtLine}`, tone: 'positive' };
    }
    case 'evening_done': {
      const nxt = ctx.nextPlanned;
      const nxtLine = nxt
        ? `${relativeDayWord(nxt.daysOut, nxt.dow)}: ${planLabel(nxt)}.`
        : `Tomorrow is open.`;
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
function classifyFuelState({ us, sessions, upcomingPlan, raceHorizon, nowMs, hour }) {
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
  const baseCtx = { intake, protein, kcalT, proteinT, intakePct, proteinPct, raceWeek, raceCtx, if: ifCtx, tomorrow: tomorrowSessionCtx(upcomingPlan) };

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
    case 'post_workout_refuel': {
      const lbl = phraseLabel(activityLabel(ctx.session) || 'session');
      const r = refuelPhrase(ctx.session, bodyKgForCoach(), lbl);
      return { tag: 'Refuel', body: r.text, tone: 'positive' };
    }
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
      const tmrw = ctx.tomorrow?.hard ? ` ${ctx.tomorrow.label} tomorrow leans on it.` : '';
      return { tag: 'Protein', body: `${Math.round(ctx.protein)} of ${ctx.proteinT}g protein in — anchor lunch with ~35g to close the ${gap}g gap.${tmrw}`, tone: 'gentle' };
    }
    case 'midday_on_track':
      return { tag: 'On pace', body: `${Math.round(ctx.intake)} / ${ctx.kcalT} kcal · protein tracking. Keep the rhythm.`, tone: 'positive' };
    case 'evening_under_target': {
      const adv = fuelGapAdvice({ intake: ctx.intake, protein: ctx.protein, kcalT: ctx.kcalT, proteinT: ctx.proteinT, tomorrowLabel: ctx.tomorrow?.label, tomorrowHard: ctx.tomorrow?.hard });
      const left = Math.max(0, Math.round(ctx.kcalT - ctx.intake));
      return { tag: 'Tonight', body: adv?.text || `~${left} kcal left to land target — make dinner protein-dense.`, tone: 'gentle' };
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
// The Plan surface frames toward the GOAL race the plan is built for — NOT the soonest race on the
// calendar. `raceHorizon` (computeRaceHorizon) picks the next chronological race, so the legacy Plan
// line said "Berlin (73d)" while the countdown + peak target Valencia (Emil). Resolve the A-race the
// same way buildCoachContext does — buildGoalModel keyed by planPrefs.target — and hand composePlanLine
// a horizon of the SAME shape ({ race:{name}, daysOut, phase }), so its taper/build framing is right.
function goalRaceHorizon() {
  try {
    const races = storage.get('races') || [];
    const prefs = storage.get('planPrefs') || {};
    const aRaceDate = (typeof prefs.target === 'string' && prefs.target.startsWith('race:')) ? prefs.target.slice(5) : null;
    const gm = buildGoalModel({ races, goals: getGoals() || {}, aRaceDate });
    const ar = gm && gm.race && gm.race.aRace;
    if (ar && ar.name && ar.daysOut != null) {
      const phase = gm.race.phase === 'mini-taper' ? 'taper' : gm.race.phase;   // → composePlanLine's tokens
      return { race: { name: ar.name }, daysOut: ar.daysOut, phase };
    }
  } catch { /* fall back to the race-horizon signal */ }
  return null;
}

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
      case 'peak': {
        const sc = safeSeasonCoach();
        const spec = sc?.plan?.why || (sc?.plan?.targetWeeklyMiles ? `this week ~${sc.plan.targetWeeklyMiles} mi, long run ${sc.plan.longRunTargetMi} mi.` : 'race-pace work and recovery discipline.');
        return { tag: 'Peak block', body: `${name} ${dayPart} — peak block. ${spec}`, tone: 'neutral' };
      }
      case 'build': {
        const sc = safeSeasonCoach();
        const spec = sc?.plan?.why || (sc?.plan?.targetWeeklyMiles ? `this week ~${sc.plan.targetWeeklyMiles} mi, long run ${sc.plan.longRunTargetMi} mi — hold the ramp.` : 'weekly mileage and consistency are the levers.');
        return { tag: 'Build phase', body: `${name} ${dayPart}. ${spec}`, tone: 'neutral' };
      }
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

  if (debt === 'severe') {
    const sd = cs.sleepDebt || {};
    const detail = sd.debt7d != null
      ? ` — ~${Math.round(sd.debt7d)}h short this week (avg ${sd.avgHours7d != null ? sd.avgHours7d.toFixed(1) : '—'}h vs ${sd.targetHours ?? 8}h target${sd.nightsBelow7d != null ? `, ${sd.nightsBelow7d}/7 nights` : ''})`
      : '';
    return { tag: 'Recovery trend', body: `Sleep debt has stacked${detail}. Banking an extra hour nightly is the highest-yield change this stretch.`, tone: 'gentle' };
  }
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

  // Slice 2b — resolve the training profile's weak link (async: pulls activities + predictor +
  // goal) once, mirroring LivingPlan's pattern. Feeds gPurpose's "exact gap to your race"
  // framing. Defensive: any failure leaves it null and purpose falls back to generic framing.
  const [weakLink, setWeakLink] = useState(null);
  useEffect(() => {
    let alive = true;
    resolveTrainingProfile()
      .then((p) => { if (alive) setWeakLink(mapWeakLink(p && p.weakLink)); })
      .catch(() => { /* profile unavailable → generic purpose framing */ });
    return () => { alive = false; };
  }, []);   // once on mount (matches LivingPlan); the weak link shifts over weeks, not per log

  const computed = useMemo(() => safeCompute('CoachComment:compute', () => {
    const data = {
      // Unified activity universe (stored activities + dailyLog FIT uploads),
      // the same set the card/gauge use — so a FIT-uploaded run isn't invisible
      // to the Coach (which previously read raw storage('activities') and so
      // thought "today's workout didn't happen" for FIT-only sessions).
      activities:   (() => { try { return _allActivities() || []; } catch { return storage.get('activities') || []; } })(),
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
    // Hub voice: surface the hub's learned insights (heat strain, …) when today's
    // conditions trigger them. Read the PERSISTED hub state (light — no rebuild) and
    // pull tempC from today's logged session. The hub speaks through the Coach here.
    let hubInsights = [];
    try {
      const hubState = storage.get('hub:state');
      if (hubState) {
        const facts = hubFacts(hubState, racePredictionOpts(data.activities)); // canonical opts → one race number everywhere
        const tempC = (sessions || []).map(a => Number(a.avgTemperature ?? a.tempC ?? a.weatherTempC)).find(Number.isFinite);
        // Session length (for the sweat target) + the next race (for race readiness).
        const sessionMins = ((sessions || []).reduce((m, a) => Math.max(m, Number(a.durationSecs) || 0), 0) / 60) || null;
        // Speak to the race you're TRAINING FOR (the goal A-race), not the soonest event — otherwise
        // a near 5K/tune-up hijacks the readiness read (the "5K" bug). Uses the ONE canonical resolver
        // (core/aRace.js), keyed by planPrefs.target, so this can't disagree with the plan/coach.
        const _prefs = storage.get('planPrefs') || {};
        const _aRaceDate = (typeof _prefs.target === 'string' && _prefs.target.startsWith('race:')) ? _prefs.target.slice(5) : null;
        const _next = resolveARace(storage.get('races') || [], localDate(), _aRaceDate);
        let race = null;
        if (_next) {
          const km = Number(_next.distance_km ?? _next.distanceKm) || (Number(_next.distanceMi) ? Number(_next.distanceMi) * 1.60934 : null);
          const _parseGoal = g => {
            if (g == null) return null;
            if (Number.isFinite(+g)) return +g;
            const m = String(g).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
            return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
          };
          // goalTimeSecs is the canonical goal field (raceRecipe/goalResolve/LivingPlan);
          // the older goalSecs/goalTime aliases stay as fallbacks for legacy rows.
          race = { label: _next.name || 'race', distanceKm: km, goalSecs: _parseGoal(_next.goalTimeSecs ?? _next.goalSecs ?? _next.goalSeconds ?? _next.goalTime ?? _next.targetTime) };
        }
        hubInsights = hubCoachInsights(facts, { tempC, sessionMins, race });
      }
    } catch {}
    // DEBUG (Phase 4r.coach.plandone) — surface why a logged session may still
    // read "on the plan". Run `window.__coachPlanDebug` in the console.
    if (typeof window !== 'undefined') {
      try {
        const up = us?.coachSignals?.upcomingPlan;
        window.__coachPlanDebug = {
          today: us?.asOf,
          plannerTodayType: up?.next7Days?.[0]?.planned?.type ?? null,
          todayDoneFlag: up?.next7Days?.[0]?.done ?? null,
          intensityClass: up?.next7Days?.[0]?.intensityClass ?? null,
          todaySessions: (sessions || []).map(a => ({ date: a.date, type: a.activityType, kind: (() => { try { return activityKind(a); } catch { return '?'; } })() })),
          activitiesCount: (data.activities || []).length,
        };
      } catch {}
    }
    return { narrative, cards, us, sessions, upcomingPlan, raceHorizon, nowMs, hour, hubInsights };
  }, null), [storageVersion, tick]);

  // Episodic memory (Phase D) — after render, log the beats THIS surface actually showed so the
  // coach doesn't repeat them tomorrow. The read semantic (coachMemory: prior days only) means
  // today's write can't affect today's ranking, so there's no render loop. `shownRef` is set in the
  // narrative branches below; a render that shows no narrative leaves it null → the effect no-ops.
  const shownRef = useRef(null);
  useEffect(() => {
    const beats = shownRef.current;
    if (beats && beats.length) {
      const ids = beats.map((b) => b.id);
      try { recordShown(ids, localDate()); } catch { /* best-effort */ }
    }
  });

  if (!computed) return null;
  const { narrative, cards, us, sessions, upcomingPlan, raceHorizon, nowMs, hour, hubInsights } = computed;
  const cfg = SURFACE_CONFIG[surface] || SURFACE_CONFIG.edgeiq;
  shownRef.current = null;   // reset per render; narrative branches below set it to their shown beat ids

  // ── Coach Narrative engine (Phase B) — one reasoned narrative from the whole picture,
  // used on Play + Daily. Built once here; each surface below tries it first and falls
  // back to the legacy composer if it produces nothing (defensive migration). ──
  const coachCtx = safeCompute('coachNarrative:ctx', () => buildCoachContext({ us, sessions, upcomingPlan, raceHorizon, hour, nowMs, weakLink }), null);
  let usedNarrative = false;
  const NARRATIVE_TONE_DOT = { corrective: '#f87171', gentle: '#fbbf24', affirming: '#4ade80', neutral: COACH_TEAL };

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
    // Coach Narrative first — the reasoned, forward-looking Play voice (purpose → knock-on
    // → mechanism). Falls back to the legacy state-line composer if it produces nothing.
    const nv = safeCompute('coachNarrative:play', () => (coachCtx ? narrateSurface(coachCtx, 'play') : null), null);
    if (nv?.text) {
      tag = null; body = nv.text; dot = NARRATIVE_TONE_DOT[nv.tone] || COACH_TEAL; usedNarrative = true;
      shownRef.current = (nv.beats || []);   // beat objects (id+kind) — feeds both novelty + engagement
    } else {
      // Phase 4r.coach.racename — race name for race day, so Play says
      // "raced HYROX" not "your HIIT" (HYROX classifies as HIIT via activityKind).
      const playRaceName = (raceHorizon && raceHorizon.daysOut === 0
        && raceHorizon.race?.date === us?.asOf && raceHorizon.race?.name)
        ? raceHorizon.race.name : null;
      const s = classifyPlayState({ sessions, upcomingPlan, nowMs, hour, raceName: playRaceName });
      const line = composePlayLine(s);
      if (!line?.body) return null;
      tag = line.tag;
      body = line.body;
      dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
    }
  } else if (cfg.mode === 'fuelState') {
    // The immediate post-workout refuel window is time-critical (carbs + protein in the next
    // ~30 min), so the legacy state line OWNS that case. Every other time, the Coach Narrative
    // engine speaks — grounded fuel status (weaving today's kcal/protein) plus any mechanism /
    // cut / RED-S beat — so Fuel matches the Play/Daily voice instead of a generic composer.
    const s = classifyFuelState({ us, sessions, upcomingPlan, raceHorizon, nowMs, hour });
    if (s.kind === 'post_workout_refuel') {
      const line = composeFuelLine(s);
      if (!line?.body) return null;
      tag = line.tag; body = line.body; dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
    } else {
      const nv = safeCompute('coachNarrative:fuel', () => (coachCtx ? narrateSurface(coachCtx, 'fuel') : null), null);
      if (nv?.text) {
        tag = null; body = nv.text; dot = NARRATIVE_TONE_DOT[nv.tone] || COACH_TEAL; usedNarrative = true;
        shownRef.current = (nv.beats || []);   // beat objects (id+kind) — feeds both novelty + engagement
      } else {
        const line = composeFuelLine(s);
        if (!line?.body) return null;
        tag = line.tag; body = line.body; dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
      }
    }
  } else if (cfg.mode === 'library') {
    const line = composeMobileLibrary({ narrative, cards });
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = line.dot || STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'planState') {
    // Coach Narrative first — the plan-vs-execution oversight voice (week drift off target,
    // strength-frequency progress, purpose toward the race). This is the read that watches the
    // plan against reality; the legacy race-horizon line is the fallback when nothing fires.
    const nv = safeCompute('coachNarrative:plan', () => (coachCtx ? narrateSurface(coachCtx, 'plan') : null), null);
    if (nv?.text) {
      tag = null; body = nv.text; dot = NARRATIVE_TONE_DOT[nv.tone] || COACH_TEAL; usedNarrative = true;
      shownRef.current = (nv.beats || []);   // beat objects (id+kind) — feeds both novelty + engagement
    } else {
      // Fallback: frame toward the GOAL race (Valencia), not the soonest race (Berlin).
      const line = composePlanLine({ us, raceHorizon: goalRaceHorizon() || raceHorizon });
      if (!line?.body) return null;
      tag = line.tag; body = line.body; dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
    }
  } else if (cfg.mode === 'trendState') {
    const line = composeTrendLine({ us });
    if (!line?.body) return null;
    tag = line.tag;
    body = line.body;
    dot = STATE_TONE_DOT[line.tone] || COACH_TEAL;
  } else if (cfg.mode === 'digest') {
    isDigest = true;
    // Coach Narrative first — the reasoned diary paragraph that weaves in the day's
    // metrics; falls back to the legacy warm-digest composer if it produces nothing.
    const nv = safeCompute('coachNarrative:daily', () => (coachCtx ? narrateSurface(coachCtx, 'daily') : null), null);
    if (nv?.text) {
      body = nv.text; dot = NARRATIVE_TONE_DOT[nv.tone] || COACH_TEAL; usedNarrative = true;
      shownRef.current = (nv.beats || []);   // beat objects (id+kind) — feeds both novelty + engagement
    } else {
      const digest = composeDigest({ us, sessions, hour });
      if (!digest || !digest.text) return null;
      body = digest.text;
      dot = COACH_TEAL;
    }
  } else if (cfg.mode === 'leverage') {
    const lp = narrative?.leveragePoint;
    const story = narrative?.story;
    const aligned = narrative?.alignedFallback || !lp;
    // Phase 1.2 (living coach) — TIME-OF-DAY orientation on Start/EdgeIQ. In the
    // MORNING with a planned, not-done session and nothing trained yet, lead
    // FORWARD with today's session (the warm, already-tested Play-state line)
    // instead of a backward sleep/recovery leverage point — the "sleep at 8am"
    // fix. The Play/Fuel/Digest surfaces already orient by time; this closes the
    // gap on the leverage surface so the Coach faces forward in the morning.
    const _ps = classifyPlayState({ sessions, upcomingPlan, nowMs, hour });
    if (_ps.kind === 'planned_morning' && sessions.length === 0) {
      const _line = composePlayLine(_ps);
      tag = _line.tag;
      dot = COACH_TEAL;
      body = _line.body;
    } else if (aligned) {
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

  // ── Hub brain → Coach voice ───────────────────────────────────────────────
  // Weave in the most relevant hub-LEARNED insight for THIS surface (the hub is
  // the brain; the Coach is its voice). Each surface gets the insight kind that
  // fits its job: Play/Fuel → today's heat + hydration; Plan/Trend → race
  // readiness; the Daily digest is a paragraph so it can carry the top two.
  // Race readiness (the fitness/finish-projection clause) lives ONLY on the
  // leverage surface (Start / EdgeIQ) — it was previously woven into Plan, Trend
  // and the Daily digest too, so the same sentence tailed every screen and the
  // Coach read identically everywhere. Its dedicated home is the Training Profile
  // (RecipePath); the coach speaks it once, on leverage, and each other surface
  // keeps its own distinct voice (heat/sweat on Play/Fuel, learned pattern on Plan).
  const HUB_KINDS_FOR = {
    playState:  ['heat', 'sweat'],
    fuelState:  ['sweat', 'heat'],
    planState:  ['sensitivity'],
    trendState: [],
    leverage:   ['fitness', 'sensitivity'],
    digest:     ['heat', 'sweat', 'sensitivity'],
  };
  const _hubOrder = HUB_KINDS_FOR[cfg.mode] || [];
  if (!usedNarrative && _hubOrder.length && Array.isArray(hubInsights) && hubInsights.length) {
    const picked = [];
    for (const k of _hubOrder) {
      const m = hubInsights.find(i => i.kind === k);
      if (m && !picked.includes(m)) picked.push(m);
      if (picked.length >= (isDigest ? 2 : 1)) break;   // digest carries up to 2
    }
    for (const m of picked) body += ' ' + m.text;
  }

  // Phase 4r.narrative.5.fix.30 — single-flow layout per user feedback:
  //   [sigil]  TAG: message…
  // The tag is a bold-caps, state-colored INLINE prefix to the message —
  // no separate header row, no leading dot (the app already has dots
  // everywhere; another one here was visual noise). The sigil is the only
  // mark; the colored tag carries severity (red = severe, amber = watch).
  // No line-clamp — the Coach finishes its sentence.
  // Engagement signal (Stage 4): a tap to open the coach comment is a genuine "expanded" interaction.
  // Record it against the beats currently shown so preference learning (coachPersonalization) can tilt
  // what the coach surfaces toward what the athlete actually engages with. Best-effort, never blocks open.
  const handleOpen = onOpen
    ? (e) => {
        try {
          const beats = shownRef.current || [];
          const d = localDate();
          for (const b of beats) { if (b && b.id) recordEngagement({ id: b.id, kind: b.kind }, 'expanded', d); }
        } catch { /* best-effort */ }
        return onOpen(e);
      }
    : undefined;
  return (
    <div
      onClick={handleOpen}
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
