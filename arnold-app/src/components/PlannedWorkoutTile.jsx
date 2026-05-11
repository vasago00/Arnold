// ─── Planned Workout Tile (Phase 4p) ────────────────────────────────────────
// Mobile-only. Sits between the Hero rail and the coaching strip on the
// Start screen.
//
// LAYOUT (Phase 4p.plan.9):
//   ┌────────────────────────────────────────────────────────┐
//   │ [stripe]                                                │
//   │ 🏃 PERFORMANCE                                ✓         │
//   │ ┌─────────────┊─────────────────────────────┐           │
//   │ │ 7.45 mi     ┊ 91%                          │           │
//   │ │ 1h 17m      ┊ Z1-Z2 time                   │           │
//   │ │ 10:14 /mi   ┊ Z3+ 9% · ⚡ 88 · ▼ 3% ✓      │           │
//   │ └─────────────┴─────────────────────────────┘           │
//   │ 🌾 RECOVER                                              │
//   │ 60g · 💧 0.9L · 🧘 15m · 🌙 8h                          │
//   └────────────────────────────────────────────────────────┘
//
// Vertical side rail removed in favor of a family icon next to the
// PERFORMANCE header (running figure for run, barbell for strength,
// trophy for race, etc.). Top section split into 2 panels with a thin
// dotted divider — left = volume/output, right = quality/efficiency.
//
// QUALITY METRIC IS SESSION-AWARE (Phase 4p.plan.9):
//   • Easy / Long run  → Primary: Z1-Z2 time %.    Goal: high (≥85%).
//                        Spending too much in Z3+ is the failure mode.
//   • Tempo / Intervals/ HIIT → Primary: efficiency % (100 − decoupling × 5).
//                               Hard sessions reward steady aerobic engine.
//   • Strength         → Primary: load (rTSS/hrTSS). Secondary: avg HR.
//   • Race             → Primary: efficiency %. Secondary: zone breakdown.
//
// THRESHOLD: only completed activities ≥20 min "promote" today's plan.
// Sub-20 stays in the legacy Today's Plan section.

import { useEffect, useMemo, useState } from "react";
import {
  PersonSimpleRun, Barbell, Lightning, PersonSimpleTaiChi, Bicycle, Trophy,
  Drop as PhDrop, Moon as PhMoon,
} from "@phosphor-icons/react";
import { storage } from "../core/storage.js";
import { fetchWeatherForDate } from "../core/pdfParser.js";
import { isRun, isStrength, isHIIT } from "../core/activityClass.js";
import { computeRTSS, computeHrTSS, getEffectiveMaxHR } from "../core/trainingStress.js";
import { allActivities as getUnifiedActivities } from "../core/dcyMath.js";
import { getProfileZoneBpm } from "../core/derive/hr.js";
import {
  signaturesForActivities,
  computeReboundDebt,
  softenReadinessForDebt,
} from "../core/derive/recoverySignature.js";

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MIN_PROMOTE_MINUTES = 20;
// Phase 4q.pre.8 — per-family promotion thresholds. A 12-minute mobility
// routine should still count as "done" — the original 20-min default was
// too strict for short recovery/wellness sessions.
const MIN_PROMOTE_MINUTES_BY_FAMILY = {
  mobility: 5,
  cross:    10,
  // run / strength / hiit / race fall through to MIN_PROMOTE_MINUTES (20).
};
const OZ_PER_LITER = 33.814;

const PLAN_TYPE_FAMILY = {
  easy_run: 'run', long_run: 'run', tempo: 'run', intervals: 'run',
  hiit: 'hiit', strength: 'strength', mobility: 'mobility', cross: 'cross',
  race: 'race', rest: 'rest',
};
const PLAN_TYPE_LABEL = {
  easy_run: 'Easy run', long_run: 'Long run', tempo: 'Tempo', intervals: 'Intervals',
  hiit: 'HIIT', strength: 'Strength', mobility: 'Mobility', cross: 'Cross-train',
  race: 'Race', rest: 'Rest',
};
const FAMILY_COLOR = {
  // Phase 4q.signatures.1 — HIIT shifted from coral (#fb7185) to orange
  // (#fb923c) so it reads distinct from race red and matches the new
  // orange-themed signature illustration. Cyan was rejected because it
  // would conflict with mobility teal.
  run: '#60a5fa', strength: '#a78bfa', hiit: '#fb923c',
  mobility: '#5eead4', cross: '#34d399', race: '#ef4444',
};

const T1 = '#e8e6e0';
const T2 = '#a8a59f';
const T3 = '#7d7a72';
const T4 = '#5b5751';
const GOOD = '#4ade80';
const WARN = '#fbbf24';
const BAD  = '#f87171';

// "Easy" plan types whose right panel shows Z1-Z2 time as the headline
// metric. For these, doing too much in Z3+ is the failure mode — the
// session was supposed to be aerobic.
const EASY_PLAN_TYPES = new Set(['easy_run', 'long_run']);

// ── Format helpers ────────────────────────────────────────────────────────
function ozToLiters(oz) {
  if (!oz || oz <= 0) return '0L';
  return `${(oz / OZ_PER_LITER).toFixed(1)}L`;
}

function getLatestWeightKg(profile) {
  try {
    const w = (storage.get('weight') || [])
      .filter(r => r && (r.weightLbs || r.weightKg))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (w?.weightKg) return Number(w.weightKg);
    if (w?.weightLbs) return Number(w.weightLbs) / 2.2046;
  } catch {}
  if (profile?.weightKg)  return Number(profile.weightKg);
  if (profile?.weightLbs) return Number(profile.weightLbs) / 2.2046;
  return 75;
}

// ── Weather cache ─────────────────────────────────────────────────────────
// Phase 4q.weather.1 — cache entries now carry a `fetchedAt` timestamp.
// Anything older than WEATHER_FRESH_MS is treated as stale and triggers
// a re-fetch. Forecasts shift through the day; "today's" cached entry
// from this morning shouldn't still be on screen this evening.
const WEATHER_FRESH_MS = 30 * 60 * 1000; // 30 minutes
function getCachedWeather(dateStr) {
  try {
    const cached = (storage.get('weatherCache') || {})[dateStr] || null;
    if (!cached) return null;
    if (cached.fetchedAt && (Date.now() - cached.fetchedAt) < WEATHER_FRESH_MS) {
      return cached;
    }
    return null;
  } catch { return null; }
}
function setCachedWeather(dateStr, data) {
  try {
    const cache = storage.get('weatherCache') || {};
    cache[dateStr] = { ...data, fetchedAt: Date.now() };
    const keys = Object.keys(cache).sort();
    if (keys.length > 14) {
      const trimmed = {};
      keys.slice(-14).forEach(k => { trimmed[k] = cache[k]; });
      storage.set('weatherCache', trimmed, { skipValidation: true });
    } else {
      storage.set('weatherCache', cache, { skipValidation: true });
    }
  } catch {}
}

// ── State derivation ──────────────────────────────────────────────────────
function deriveState({ planned, todayActivities, todayDate, nextRace }) {
  const family = PLAN_TYPE_FAMILY[planned?.type] || null;
  const raceToday = nextRace?.date === todayDate;
  const raceLogged = todayActivities.some(a => {
    const lbl = (a.activityType || a.title || '').toLowerCase();
    return /race/.test(lbl) || (a.tag === 'race') || /race/i.test(a.notes || '');
  });
  if (raceToday && raceLogged) return { kind: 'race-complete', family: 'race', planType: 'race' };
  if (raceToday)               return { kind: 'race-pre',      family: 'race', planType: 'race' };
  if (!planned || !family || family === 'rest') return { kind: 'none', family: null };

  const minsOf = (a) => (Number(a.durationSecs) || 0) / 60 || Number(a.durationMins) || 0;
  const matchFamily = (a) => {
    if (family === 'run')      return isRun(a);
    if (family === 'strength') return isStrength(a);
    if (family === 'hiit')     return isHIIT(a) || isRun(a);
    if (family === 'mobility') {
      // Phase 4q.pre.8 — broader mobility matching. Accept the explicit
      // labels first; fall back to "any non-run/strength/HIIT activity"
      // when the user has a mobility plan, so a generic logged session
      // (e.g. "stretch flow", "warm-down", manual entry with no type)
      // still flips the tile to complete.
      const label = (a.activityType || a.title || '').toLowerCase();
      if (/mobility|yoga|stretch|flex|recover|warm.?down|cool.?down|wellness|foam|roll|breathe|tai\s?chi|pilates/i.test(label)) return true;
      return !isRun(a) && !isStrength(a) && !isHIIT(a);
    }
    if (family === 'cross')    return !isRun(a) && !isStrength(a);
    return false;
  };
  const minMins = MIN_PROMOTE_MINUTES_BY_FAMILY[family] ?? MIN_PROMOTE_MINUTES;
  const completed = todayActivities.filter(a => matchFamily(a) && minsOf(a) >= minMins);
  if (completed.length) {
    const primary = [...completed].sort((a, b) => minsOf(b) - minsOf(a))[0];
    return { kind: 'complete', family, planType: planned.type, activity: primary };
  }
  return { kind: 'pre', family, planType: planned.type };
}

// ── Pre-workout intelligence ──────────────────────────────────────────────
function similarRunsContext({ planned, family, allActivities }) {
  if (family !== 'run') return null;
  const targetMi = Number(planned?.distanceMi);
  if (!targetMi || targetMi <= 0) return null;
  const lo = targetMi * 0.8, hi = targetMi * 1.2;
  const matches = (allActivities || [])
    .filter(a => isRun(a))
    .filter(a => {
      const d = Number(a.distanceMi);
      return d >= lo && d <= hi;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);
  if (!matches.length) return null;
  const avg = (arr, fn) => {
    const xs = arr.map(fn).filter(v => Number.isFinite(v) && v > 0);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  };
  const paceSecsArr = matches.map(a => {
    if (!a.avgPaceRaw) return null;
    const [m, s] = String(a.avgPaceRaw).split(':').map(Number);
    return m * 60 + (s || 0);
  }).filter(Boolean);
  const avgPaceSecs = paceSecsArr.length ? paceSecsArr.reduce((s, v) => s + v, 0) / paceSecsArr.length : null;
  const fmtPace = (secs) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}`;
  const avgHR = avg(matches, a => Number(a.avgHR));
  const avgDecoupling = avg(matches, a => Number(a.aerobicDecoupling));
  return {
    count: matches.length,
    avgPace: avgPaceSecs ? fmtPace(avgPaceSecs) : null,
    avgHR: avgHR ? Math.round(avgHR) : null,
    efficiencyPct: avgDecoupling != null ? Math.max(0, Math.round(100 - avgDecoupling * 5)) : null,
  };
}

function hrTarget({ planType, maxHR }) {
  if (!maxHR) return null;
  const band = (lo, hi) => ({ lo: Math.round(maxHR * lo), hi: Math.round(maxHR * hi) });
  switch (planType) {
    case 'tempo':     return { ...band(0.80, 0.90), zone: 'Z3-Z4' };
    case 'long_run':  return { ...band(0.65, 0.75), zone: 'Z2 long' };
    case 'easy_run':  return { ...band(0.60, 0.72), zone: 'Z2 easy' };
    case 'intervals': return { ...band(0.88, 0.95), zone: 'Z4-Z5' };
    case 'hiit':      return { ...band(0.85, 0.95), zone: 'Z4-Z5' };
    case 'strength':  return { ...band(0.60, 0.85), zone: 'mixed' };
    default: return null;
  }
}

// Phase 4q.pre.2 — readiness verdict for the pre-workout hero.
// Combines last night's sleep and recent HRV vs baseline into a
// single GO/STEADY/DIAL-BACK verdict, with the ingredients exposed
// so the user can see WHY the verdict landed where it did.
function readinessVerdict({ profile }) {
  let sleepHrs = null, sleepDelta = null;
  let hrvNow = null, hrvBaseline = null, hrvDelta = null;
  try {
    const sleep = (storage.get('sleep') || [])
      .filter(s => s?.durationMinutes)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (sleep[0]) {
      sleepHrs = +(sleep[0].durationMinutes / 60).toFixed(1);
      const last7 = sleep.slice(0, 7).filter(s => s.durationMinutes);
      if (last7.length >= 3) {
        const avg = last7.reduce((s, r) => s + r.durationMinutes, 0) / last7.length / 60;
        sleepDelta = +(sleepHrs - avg).toFixed(1);
      }
    }
    const hrv = (storage.get('hrv') || [])
      .filter(h => h?.overnightHRV)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (hrv[0]) {
      hrvNow = Number(hrv[0].overnightHRV);
      const last14 = hrv.slice(0, 14);
      if (last14.length >= 5) {
        hrvBaseline = Math.round(last14.reduce((s, r) => s + Number(r.overnightHRV), 0) / last14.length);
        hrvDelta = Math.round(hrvNow - hrvBaseline);
      }
    }
  } catch {}

  // Score: sleep ≥7h good, ≥6h ok, <6h penalty. HRV ≥baseline good, ≥-5 ok, lower penalty.
  let score = 50;
  if (sleepHrs != null) {
    score += sleepHrs >= 7.5 ? 25 : sleepHrs >= 7 ? 15 : sleepHrs >= 6 ? 5 : -15;
  }
  if (hrvDelta != null) {
    score += hrvDelta >= 5 ? 25 : hrvDelta >= 0 ? 15 : hrvDelta >= -5 ? 0 : -20;
  } else if (hrvNow != null) {
    score += hrvNow >= 50 ? 15 : hrvNow >= 40 ? 5 : -5;
  }
  score = Math.max(0, Math.min(100, score));

  let label, color;
  if (score >= 75)      { label = 'GO STRONG';  color = GOOD; }
  else if (score >= 55) { label = 'GO STEADY';  color = WARN; }
  else                  { label = 'DIAL BACK';  color = BAD; }

  return {
    score: Math.round(score),
    label, color,
    sleepHrs, sleepDelta,
    hrvNow, hrvBaseline, hrvDelta,
  };
}

// Synthetic target-zone distribution by session type. Mirrors
// synthesizeZonesFromAvgHR's shape so MiniZoneBar can render it identically.
// "Where SHOULD you be" instead of "where WERE you."
function targetZoneDistribution(planType) {
  const dist = (() => {
    switch (planType) {
      case 'easy_run':  return { z1: 25, z2: 65, z3:  8, z4:  2, z5: 0 };
      case 'long_run':  return { z1: 15, z2: 70, z3: 13, z4:  2, z5: 0 };
      case 'tempo':     return { z1:  5, z2: 25, z3: 55, z4: 13, z5: 2 };
      case 'intervals': return { z1:  5, z2: 20, z3: 20, z4: 40, z5: 15 };
      case 'hiit':      return { z1:  5, z2: 15, z3: 20, z4: 40, z5: 20 };
      case 'strength':  return { z1: 10, z2: 40, z3: 35, z4: 12, z5: 3 };
      default:          return { z1: 20, z2: 50, z3: 22, z4:  6, z5: 2 };
    }
  })();
  return {
    ...dist,
    z12: dist.z1 + dist.z2,
    z3plus: dist.z3 + dist.z4 + dist.z5,
    estimated: false,
  };
}

// Status-aware hook line for the hero. Sets the tone of the tile
// without being saccharine. Pulls from readiness, plan type, and weather
// so it feels current.
function hookLine({ readiness, planType, weather }) {
  const isEasy = ['easy_run', 'long_run'].includes(planType);
  const isHard = ['tempo', 'intervals', 'hiit'].includes(planType);
  const isRace = planType === 'race';
  const tempF = weather?.tempMaxF;
  if (isRace) return 'Race day. Trust the work.';
  if (readiness.label === 'DIAL BACK') {
    return isHard ? 'Body says easy today — hold pace honest.' : 'Tired legs — keep it conversational.';
  }
  if (readiness.label === 'GO STRONG') {
    if (isHard) return 'Engine is warm. Push it.';
    if (isEasy) return 'Rested and ready. Keep it aerobic.';
    return 'Ready when you are.';
  }
  // GO STEADY
  if (isHard) return 'Solid base — execute the plan.';
  if (isEasy) return 'Easy day. Time on feet wins.';
  if (tempF != null && tempF >= 80) return 'Warm out there — hydrate early.';
  return 'Ready when you are.';
}

// "What this session moves" — one-line micro-context. Looks at the
// week's running total and goal, plus where in the plan you are.
function sessionContext({ planned, family, allActivities }) {
  if (family !== 'run') return null;
  const todayDate = localDate();
  // ISO Monday-based week start
  const today = new Date(todayDate + 'T12:00:00');
  const dow = today.getDay();
  const isoMonday = new Date(today);
  isoMonday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const monStr = localDate(isoMonday);
  const weekRuns = (allActivities || []).filter(a => isRun(a) && (a.date || '') >= monStr);
  const weekMi = weekRuns.reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
  const goalMi = 25;  // TODO: pull from getGoals().weeklyRunDistanceTarget
  const planMi = Number(planned?.distanceMi) || 0;
  if (planMi <= 0) return null;
  const afterMi = weekMi + planMi;
  const left = Math.max(0, goalMi - afterMi);
  if (left <= 0)         return `Hits your ${goalMi}-mile week.`;
  if (afterMi >= goalMi * 0.8) return `Closes you within ${left.toFixed(0)} of ${goalMi} mi`;
  return `${planMi} of ${goalMi - weekMi} miles you have left this week`;
}

// Phase 4q.pre.3 — week-context helper that counts ANY meaningful activity
// (run / strength / HIIT / mobility ≥10 min), not just runs. Phase 4q.pre.4
// extends it with weekly recap stats (miles, strength count, HIIT count,
// total moved hours) so the mobility tile's middle band can answer
// "did I put the work in this week?" instead of "am I ready?".
function weekActivityContext({ allActivities }) {
  const today = new Date();
  const dow = today.getDay();
  const monOffset = dow === 0 ? 6 : dow - 1;
  const isoMonday = new Date(today);
  isoMonday.setDate(today.getDate() - monOffset);
  const monStr = localDate(isoMonday);
  const todayStr = localDate(today);

  const minsOf = (a) => (Number(a.durationSecs) || 0) / 60 || Number(a.durationMins) || 0;
  const isMeaningful = (a) => minsOf(a) >= 10;
  // Phase 4r.tile.5 — narrowed definition. Old version counted any run
  // ≥30min and any strength ≥25min as "hard", so easy runs and light
  // mobility-leaning lifts triggered the daysSinceHard chip
  // misleadingly. New rule (Option A from review): a session counts
  // as hard/key when it's recovery-demanding by intent or duration —
  //   • HIIT, OR
  //   • Name signals intensity work (tempo/sprint/speed/track/threshold/intervals/race), OR
  //   • Run ≥ 90 min (long-run by duration — physiological cost matches a tempo), OR
  //   • Strength ≥ 45 min (genuine lifting block, not active recovery)
  // Easy runs and short strength sessions correctly NO LONGER count.
  const HARD_NAME_RE = /\b(tempo|sprint|speed|track|threshold|intervals?|race)\b/i;
  const isHard = (a) => {
    if (!isMeaningful(a)) return false;
    if (isHIIT(a)) return true;
    const name = `${a?.activityName || ''} ${a?.title || ''} ${a?.activityType || ''}`;
    if (HARD_NAME_RE.test(name)) return true;
    if (isRun(a) && minsOf(a) >= 90) return true;        // long runs
    if (isStrength(a) && minsOf(a) >= 45) return true;   // genuine lift block
    return false;
  };

  const thisWeek = (allActivities || [])
    .filter(a => a.date && a.date >= monStr && a.date <= todayStr && isMeaningful(a));

  // Active days this week (Mon..today)
  const dateSetThisWeek = new Set(thisWeek.map(a => a.date));
  const activeDaysThisWeek = dateSetThisWeek.size;

  // Weekly recap totals
  const weeklyMiles    = thisWeek.filter(isRun)
                                  .reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
  const weeklyRuns     = thisWeek.filter(isRun).length;
  const weeklyStrength = thisWeek.filter(isStrength).length;
  const weeklyHIIT     = thisWeek.filter(a => isHIIT(a) && !isRun(a)).length;
  const weeklyHours    = thisWeek.reduce((s, a) => s + minsOf(a), 0) / 60;

  // Days since last hard session (capped at 30)
  const hardSorted = (allActivities || [])
    .filter(isHard)
    .map(a => a.date)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  let daysSinceHard = null;
  if (hardSorted[0]) {
    const last = new Date(hardSorted[0] + 'T12:00:00');
    daysSinceHard = Math.max(0, Math.round(
      (new Date(todayStr + 'T12:00:00').getTime() - last.getTime()) / 86_400_000
    ));
  }

  return {
    activeDaysThisWeek,
    daysSinceHard,
    todayHasMeaningful: dateSetThisWeek.has(todayStr),
    weeklyMiles:    +weeklyMiles.toFixed(1),
    weeklyRuns,
    weeklyStrength,
    weeklyHIIT,
    weeklyHours:    +weeklyHours.toFixed(1),
  };
}

// Phase 4q.pre.5 — short, energetic session mantra. Sits on the right
// of the output band where the zone bar would otherwise go (for sessions
// that don't have a meaningful zone distribution). Data-aware where it
// adds substance: e.g. mobility shifts mantra based on how much work the
// week has banked, hard sessions echo the readiness verdict tone.
// Phase 4r.tile.6 — curated mantra pools per session intent, with a
// day-stable rotation. Old version returned a single fixed string per
// type ("TIME ON FEET" for long runs forever), which got stale fast and
// was poorly matched to the energy of, say, a 13-mile effort.
//
// Each pool has 8–12 entries. We pick deterministically using a hash
// of (today's date + planType) so:
//   • Same day = same mantra (no flicker on re-render).
//   • Different day = potentially different mantra (variety over weeks).
//   • Different session types on the same day get distinct mantras.
//
// Edge cases (race week, post-key recovery, low readiness, big weekly
// load) still override with context-specific picks.

const MANTRA_POOLS = {
  long_run: [
    'GO GET IT', 'GRIND TIME', 'EAT THE MILES', 'OWN THE DISTANCE',
    'EARN EVERY STEP', 'DEEP WORK', 'LOCK IN', 'GO LONG',
    'BUILD THE TANK', 'FORGE THE LEGS', 'RUN STRONG', 'STAY THE COURSE',
  ],
  easy_run: [
    'BUILD THE BASE', 'AEROBIC GOLD', 'PATIENCE PAYS', 'EASY MILES',
    'STAY SMOOTH', 'KEEP IT CHILL', 'FOUNDATION WORK', 'TRUST THE PROCESS',
  ],
  hard_go: [   // hard session, readiness green
    'PUSH IT', 'CHASE THE HURT', 'REDLINE IT', 'ALL OUT',
    'BREAK THROUGH', 'SHARPEN UP', 'RACE THE GHOST', 'EMPTY THE TANK',
  ],
  hard_steady: [   // hard session, readiness amber/red
    'HOLD STEADY', 'STAY CONTROLLED', 'SMART INTENSITY', 'EXECUTE THE PLAN',
    'CALCULATED EFFORT', 'KEEP COMPOSURE',
  ],
  hard_default: [
    'TIME TO WORK', 'GET AFTER IT', 'WORK BEGINS NOW',
    'EMBRACE THE WORK', 'SHOW UP STRONG',
  ],
  strength: [
    'STACK VOLUME', 'HEAVY HANDS', 'BUILD THE FRAME', 'STAY HEAVY',
    'IRON SHARPENS IRON', 'RUTHLESS REPS', 'OWN THE BAR', 'GET THICK',
  ],
  mobility_earned: [
    'EARNED THIS REST', 'RECOVERY EARNED', 'WELL-EARNED RESET',
  ],
  mobility_reset: [
    'RESET & RELOAD', 'BREATHE & RESTORE', 'TUNE THE MACHINE',
    'PRESS PAUSE', 'SOFT DAY',
  ],
  mobility_recover: [
    'RECOVER FAST', 'ABSORB THE WORK', 'HEAL FORWARD',
  ],
  mobility_default: [
    'BODY MAINTENANCE', 'STAY SUPPLE', 'SMALL HINGES, BIG DOORS',
  ],
};

function pickMantra(pool, dateStr, planType) {
  if (!pool || !pool.length) return null;
  const key = `${dateStr || ''}|${planType || ''}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;  // 32-bit
  }
  return pool[Math.abs(hash) % pool.length];
}

function sessionMantra({ planType, isMob, isHard, isEasy, isStr, readiness, wkCtx }) {
  const today = localDate();
  if (isMob) {
    if ((wkCtx?.weeklyMiles || 0) >= 15 || (wkCtx?.weeklyHIIT || 0) >= 1)
      return pickMantra(MANTRA_POOLS.mobility_earned, today, planType);
    if ((wkCtx?.activeDaysThisWeek || 0) >= 4)
      return pickMantra(MANTRA_POOLS.mobility_reset, today, planType);
    if ((wkCtx?.daysSinceHard || 0) <= 1)
      return pickMantra(MANTRA_POOLS.mobility_recover, today, planType);
    return pickMantra(MANTRA_POOLS.mobility_default, today, planType);
  }
  if (isStr) return pickMantra(MANTRA_POOLS.strength, today, planType);
  if (isHard) {
    if (readiness?.label === 'GO STRONG') return pickMantra(MANTRA_POOLS.hard_go, today, planType);
    if (readiness?.label === 'DIAL BACK') return pickMantra(MANTRA_POOLS.hard_steady, today, planType);
    return pickMantra(MANTRA_POOLS.hard_default, today, planType);
  }
  if (isEasy) {
    if (planType === 'long_run')
      return pickMantra(MANTRA_POOLS.long_run, today, planType);
    return pickMantra(MANTRA_POOLS.easy_run, today, planType);
  }
  return null;
}

// Phase 4r.tile.2 — duration-tiered fueling. The previous formula
// (0.5g/min above 60min) gave ~60g for a 2-hour long run, which is half
// the modern endurance recommendation. Sports-nutrition consensus for
// efforts >60 min is 30–60 g/hr DURING the run, plus 30–50 g pre-run
// for sessions ≥90 min. For a 13-mile long run at ~2 hr that's roughly
// 90–120 g total, not 60.
//
// Tiered ranges:
//   <60 min    : 0 g (glycogen sufficient)
//   60–90 min  : 30 g/hr during, no pre
//   90–120 min : 42 g/hr during + 30 g pre  (~half-marathon training)
//   ≥120 min   : 54 g/hr during + 45 g pre  (long-run / ultra territory)
// Smooth interpolation between tiers so the recommendation doesn't
// jump abruptly at the boundaries.
function fuelTargets({ minutes }) {
  if (!minutes || minutes <= 0) return null;
  const waterOz = Math.round(16 + 0.5 * minutes);
  let carbsG = 0;
  if (minutes >= 60) {
    const duringRate = minutes < 90  ? 0.5         // 30 g/hr
                     : minutes < 120 ? 0.7         // 42 g/hr
                     :                 0.9;        // 54 g/hr
    carbsG = Math.round(minutes * duringRate);
    if (minutes >= 90)  carbsG += 30;              // pre-run carbs
    if (minutes >= 150) carbsG += 15;              // bigger pre for ultra-long
  }
  return {
    waterOz,
    waterL:  +(waterOz / OZ_PER_LITER).toFixed(1),
    carbsG,
  };
}

function plannedMinutes({ planned, profile }) {
  if (!planned) return null;
  if (Number(planned.minutes) > 0) return Number(planned.minutes);
  const family = PLAN_TYPE_FAMILY[planned.type];
  if (family === 'run' && Number(planned.distanceMi) > 0) {
    const targetPace = profile?.targetRacePace || '9:30';
    const [m, s] = String(targetPace).split(':').map(Number);
    const paceSecs = m * 60 + (s || 0);
    const off = planned.type === 'easy_run' ? 75
              : planned.type === 'long_run' ? 60
              : planned.type === 'tempo'    ? 0
              : planned.type === 'intervals' ? -30
              : 60;
    return Math.round((paceSecs + off) * Number(planned.distanceMi) / 60);
  }
  if (family === 'strength') return 45;
  if (family === 'hiit')     return 30;
  if (family === 'mobility') return 20;
  return null;
}

// ── Post-workout summary ──────────────────────────────────────────────────
function efficiencyFromDecoupling(decoupling) {
  if (decoupling == null) return null;
  return Math.max(0, Math.min(100, Math.round(100 - decoupling * 5)));
}

function zoneBreakdown(activity) {
  const z = activity?.hrZones;
  if (!Array.isArray(z) || z.length !== 5) return null;
  const total = z.reduce((s, v) => s + (Number(v) || 0), 0);
  if (total <= 0) return null;
  const pct = (n) => Math.round((n / total) * 100);
  return {
    z1: pct(z[0]),
    z2: pct(z[1]),
    z3: pct(z[2]),
    z4: pct(z[3]),
    z5: pct(z[4]),
    z12: pct(z[0] + z[1]),
    z3plus: pct(z[2] + z[3] + z[4]),
    estimated: false,
  };
}

// Phase 4p.plan.13 — synthesize a zone distribution from avgHR / maxHR
// for activities that don't carry per-zone time arrays (CSV imports,
// older FIT protocol versions). Coarse but informative: locates the
// dominant zone, then sprinkles ~25-40% to adjacent zones so the bar
// shows a believable warmup→main→cooldown shape rather than a single
// solid block.
//
// Phase 4r.zones.2 — when the user's Garmin bpm zone boundaries are
// cached at profile.hrZoneBpm, locate the dominant zone by COMPARING
// avgHR directly to those bpm thresholds rather than %HRmax. This keeps
// the synthesized distribution centered on the same zone Garmin would
// place the run in. %HRmax remains the fallback for users without
// cached zone settings.
//
// Marked `estimated: true` so the ZoneBar can label it "est." and the
// user knows the numbers are approximations — real zone data shows up
// the next time they sync a FIT (parser fallback below populates it).
function synthesizeZonesFromAvgHR({ avgHR, maxHR, zoneBpm = null }) {
  if (!avgHR) return null;

  // Map avgHR to a dominant zone index (1..5).
  let dominant;
  if (zoneBpm) {
    if      (avgHR <= zoneBpm.z1Max) dominant = 1;
    else if (avgHR <= zoneBpm.z2Max) dominant = 2;
    else if (avgHR <= zoneBpm.z3Max) dominant = 3;
    else if (avgHR <= zoneBpm.z4Max) dominant = 4;
    else                              dominant = 5;
  } else if (maxHR) {
    const pct = avgHR / maxHR;
    if      (pct < 0.60) dominant = 1;
    else if (pct < 0.72) dominant = 2;
    else if (pct < 0.82) dominant = 3;
    else if (pct < 0.90) dominant = 4;
    else                 dominant = 5;
  } else {
    return null;
  }

  // Build a believable distribution centered on the dominant zone.
  const TEMPLATES = {
    1: { z1: 70, z2: 25, z3:  5, z4:  0, z5: 0 },
    2: { z1: 15, z2: 65, z3: 18, z4:  2, z5: 0 },
    3: { z1:  5, z2: 25, z3: 55, z4: 13, z5: 2 },
    4: { z1:  2, z2: 12, z3: 28, z4: 48, z5: 10 },
    5: { z1:  0, z2:  5, z3: 18, z4: 32, z5: 45 },
  };
  const dist = TEMPLATES[dominant];
  return {
    ...dist,
    z12: dist.z1 + dist.z2,
    z3plus: dist.z3 + dist.z4 + dist.z5,
    estimated: true,
  };
}

function summarizeActivity({ activity, profile, allActivities }) {
  const mins = (Number(activity.durationSecs) || 0) / 60 || Number(activity.durationMins) || 0;
  const fmtMin = (n) => {
    if (n >= 60) return `${Math.floor(n / 60)}h ${Math.round(n % 60)}m`;
    return `${Math.round(n)} min`;
  };
  const ftpPace = profile?.functionalThresholdPace || '8:30';
  const maxHR = getEffectiveMaxHR(profile, allActivities);
  const thresholdHR = parseFloat(profile?.thresholdHR) || null;
  let load = null;
  try {
    if (isRun(activity)) {
      const { rTSS } = computeRTSS({
        durationSecs: activity.durationSecs,
        avgPaceRaw:   activity.avgPaceRaw || activity.avgPace,
        avgHR:        activity.avgHR,
        ftpPace, maxHR, thresholdHR,
      });
      load = rTSS;
    } else if (isStrength(activity)) {
      const { hrTSS } = computeHrTSS({
        durationSecs: activity.durationSecs,
        avgHR:        activity.avgHR || activity.avgHeartRate,
        maxHR, thresholdHR,
      });
      load = hrTSS;
    }
  } catch {}
  const loadStr = load ? Math.round(load) : null;
  const effortBucket = loadStr == null ? null
                      : loadStr >= 100 ? 'big effort'
                      : loadStr >=  60 ? 'solid'
                      : loadStr >=  30 ? 'moderate'
                      :                   'easy';
  const effortColor = loadStr == null ? T2
                    : loadStr >= 100  ? BAD
                    : loadStr >=  60  ? WARN
                    :                   GOOD;
  const decoupling = activity.aerobicDecoupling != null ? +Number(activity.aerobicDecoupling).toFixed(1) : null;
  // Use real hrZones if the activity has them (Garmin's bpm-binned
  // truth); otherwise synthesize a distribution. The synth prefers the
  // user's cached Garmin bpm boundaries when available, falling back to
  // %HRmax otherwise — keeping the synthesized "dominant zone" aligned
  // with what Garmin Connect would call it.
  const realZones = zoneBreakdown(activity);
  const zoneBpm   = getProfileZoneBpm(profile);
  const zones = realZones || synthesizeZonesFromAvgHR({ avgHR: activity.avgHR, maxHR, zoneBpm });
  return {
    duration: fmtMin(mins),
    minutes: mins,
    distanceMi: activity.distanceMi || null,
    pace: activity.avgPaceRaw || activity.avgPace || null,
    avgHR: activity.avgHR || null,
    decoupling,
    efficiencyPct: efficiencyFromDecoupling(decoupling),
    load: loadStr,
    effortBucket,
    effortColor,
    maxHR,
    zones,
    // Phase 4p.plan.14 — running-form efficiency fields from the FIT parser.
    // Null on CSV imports / non-Garmin sources. The component skips chips
    // for any null fields so partial data is fine.
    cadence:        Number.isFinite(Number(activity.avgCadence))             ? Math.round(Number(activity.avgCadence))             : null,
    verticalRatio:  Number.isFinite(Number(activity.avgVerticalRatio))       ? +Number(activity.avgVerticalRatio).toFixed(1)        : null,
    groundContact:  Number.isFinite(Number(activity.avgGroundContactTime))   ? Math.round(Number(activity.avgGroundContactTime))   : null,
    strideLength:   Number.isFinite(Number(activity.avgStrideLength))        ? +Number(activity.avgStrideLength).toFixed(2)         : null,
  };
}

function recoveryPrescription({ summary, profile }) {
  const minsRaw = summary.minutes || 60;
  const hours = minsRaw / 60;
  const weightKg = getLatestWeightKg(profile);
  const bucket = summary.effortBucket;
  const carbsPerKg = bucket === 'big effort' ? 1.0
                   : bucket === 'solid'      ? 0.7
                   : bucket === 'moderate'   ? 0.4
                   :                            0.0;
  const carbsG = Math.round(weightKg * carbsPerKg);
  const waterOz = Math.round(24 * hours);
  return {
    carbsG,
    waterOz,
    waterL:   +(waterOz / OZ_PER_LITER).toFixed(1),
    mobMin:   (summary.load || 0) >= 80 ? 15 : 10,
    sleepHrs: (summary.load || 0) >= 60 ? 8 : 7.5,
  };
}

function decouplingColor(v) {
  if (v == null) return T2;
  if (v < 5) return GOOD;
  if (v < 10) return WARN;
  return BAD;
}

function efficiencyColor(pct) {
  if (pct == null) return T2;
  if (pct >= 75) return GOOD;
  if (pct >= 50) return WARN;
  return BAD;
}

// Easy-zone color: for easy/long runs we WANT this to be high.
function easyZoneColor(pct) {
  if (pct == null) return T2;
  if (pct >= 85) return GOOD;
  if (pct >= 70) return WARN;
  return BAD;
}

// Running-form efficiency colors (Phase 4p.plan.14, revised 4r.form.1).
//
// Cadence — pace-aware when we have it. Population studies show the
// "ideal" cadence band drifts with pace: easy 10-11:00/mi runs naturally
// land 162-170 spm, marathon pace 172-178, 10k pace 178-184, 5k pace
// 182-190. A flat 170-180 GOOD band false-negatives easy runs.
//
// Pace-anchored target (linear regression through population midpoints):
//   pace 11:00/mi (660s)  → target 162 spm
//   pace  9:00/mi (540s)  → target 170 spm
//   pace  7:30/mi (450s)  → target 178 spm
//   pace  6:00/mi (360s)  → target 184 spm
// Slope ≈ -1 spm per 25 s/mi faster. Tolerance band ±6 spm GOOD, ±12 WARN.
function cadenceColor(spm, paceSecsPerMi = null) {
  if (spm == null) return T2;
  if (Number.isFinite(paceSecsPerMi) && paceSecsPerMi > 0) {
    // Anchor at 9:00/mi → 170 spm. Each 25s/mi faster = +1 spm.
    const targetSpm = 170 + (540 - paceSecsPerMi) / 25;
    const diff = Math.abs(spm - targetSpm);
    if (diff <= 6) return GOOD;
    if (diff <= 12) return WARN;
    return BAD;
  }
  // No pace info — relaxed flat band.
  if (spm >= 162 && spm <= 188) return GOOD;
  if (spm >= 156 && spm <= 195) return WARN;
  return BAD;
}

// Vertical ratio — vertical oscillation as a % of stride length.
// Lower = bouncing less, more forward propulsion. Population breakdown:
//   <6.5% elite · 6.5-8% highly trained · 8-10.5% typical fit
//   recreational · 10.5-12% room to improve · >12% genuinely
//   inefficient. Old band (<7 GOOD, <9 WARN, >=9 BAD) flagged
//   typical-recreational runners red — false negative. Relaxed to
//   reflect actual population norms.
function verticalRatioColor(pct) {
  if (pct == null) return T2;
  if (pct < 8.5) return GOOD;
  if (pct < 11)  return WARN;
  return BAD;
}
// Ground contact time — shorter = stiffer, more elastic stride.
//   <250ms great (elite range) · 250-300ms good · >300ms slow
function gctColor(ms) {
  if (ms == null) return T2;
  if (ms < 250) return GOOD;
  if (ms < 300) return WARN;
  return BAD;
}

// Map an avgHR / maxHR ratio to a zone label + color. Used when the
// activity didn't carry a per-zone time breakdown (CSV imports etc).
function zoneFromHR({ avgHR, maxHR }) {
  if (!avgHR || !maxHR) return null;
  const pct = avgHR / maxHR;
  const pctRound = Math.round(pct * 100);
  if (pct < 0.60) return { label: 'Z1', color: T3,   pct: pctRound, ok: true  };
  if (pct < 0.72) return { label: 'Z2', color: GOOD, pct: pctRound, ok: true  };
  if (pct < 0.78) return { label: 'Z2-Z3', color: WARN, pct: pctRound, ok: false };
  if (pct < 0.82) return { label: 'Z3', color: WARN, pct: pctRound, ok: false };
  if (pct < 0.90) return { label: 'Z4', color: BAD,  pct: pctRound, ok: false };
  return                  { label: 'Z5', color: BAD,  pct: pctRound, ok: false };
}

// Build the quality data for the complete state.
//   chips    — inline-rendered chips that sit next to dist/time/pace on
//              the single performance row (load, drift, zone-from-HR
//              fallback, or efficiency depending on session + data)
//   zones    — when activity has hrZones, render the ZoneBar
//              visualization below the chips. Otherwise null.
//
// Logic:
//   • Always include load + drift if the numbers exist (these are core
//     readouts every session has).
//   • If hrZones is present → render the bar; SKIP zone/efficiency chip
//     (the bar replaces it).
//   • If hrZones is missing AND it's an easy/long run → add a zone-from-HR
//     chip ("Z3 78% maxHR") as a fallback visual cue.
//   • If hrZones is missing AND it's a hard session (tempo/intervals/race)
//     → add an efficiency chip.
function getQualityData({ planType, summary }) {
  const z = summary.zones;
  const isEasy = EASY_PLAN_TYPES.has(planType);
  const isStrength = planType === 'strength';

  const chips = [];

  // Strength gets load chip with explicit "load" label and effort sub.
  if (isStrength && summary.load != null) {
    chips.push({
      value: `${summary.load}`,
      label: summary.effortBucket || 'load',
      color: summary.effortColor,
    });
    if (summary.avgHR) {
      chips.push({ value: `${summary.avgHR}`, label: 'avg HR', color: T2 });
    }
    return { chips, zones: z };
  }

  // For runs/race: always show load and drift if available.
  if (summary.load != null) {
    chips.push({
      value: `${summary.load}`,
      label: 'load',
      color: summary.effortColor,
    });
  }
  if (summary.decoupling != null) {
    chips.push({
      value: `${summary.decoupling}%`,
      label: 'drift',
      color: decouplingColor(summary.decoupling),
    });
  }

  // If we have zone breakdown, the ZoneBar renders below — no extra chip.
  if (z) return { chips, zones: z };

  // No zones — add a fallback intensity chip BEFORE load/drift so the
  // intensity readout is the first thing the eye picks up.
  if (isEasy) {
    const zHR = zoneFromHR({ avgHR: summary.avgHR, maxHR: summary.maxHR });
    if (zHR) {
      chips.unshift({
        value: zHR.label,
        label: `${zHR.pct}% maxHR`,
        color: zHR.color,
      });
    }
  } else if (summary.efficiencyPct != null) {
    chips.unshift({
      value: `${summary.efficiencyPct}%`,
      label: 'efficient',
      color: efficiencyColor(summary.efficiencyPct),
    });
  }

  return { chips, zones: null };
}

// Legacy helper kept for the pre/race-pre states (which still use a 2-up
// hero-style panel). Calls back into getQualityData internally.
function qualityPanel({ planType, summary }) {
  const isEasy = EASY_PLAN_TYPES.has(planType);
  const z = summary.zones;

  // ── Easy / Long run ─────────────────────────────────────────────
  // Headline = how aerobic the session was. Two paths:
  //   1. hrZones available  → use Z1-Z2 time % directly
  //   2. no hrZones (CSV)   → use avgHR vs maxHR as a single-zone proxy
  // Either way we surface a zone-labeled headline so the user can see at
  // a glance whether they kept the session in the right band.
  if (isEasy) {
    if (z) {
      return {
        primary: {
          value: `${z.z12}%`,
          label: 'Z1-Z2 time',
          color: easyZoneColor(z.z12),
        },
        secondary: [
          z.z3plus != null ? { label: 'in Z3+', value: `${z.z3plus}%`, color: z.z3plus > 20 ? BAD : z.z3plus > 10 ? WARN : GOOD } : null,
          summary.load != null ? { label: 'load', value: `${summary.load}`, color: summary.effortColor } : null,
          summary.decoupling != null ? { label: 'drift', value: `${summary.decoupling}%`, color: decouplingColor(summary.decoupling) } : null,
        ].filter(Boolean).slice(0, 2),
      };
    }
    const zHR = zoneFromHR({ avgHR: summary.avgHR, maxHR: summary.maxHR });
    if (zHR) {
      return {
        primary: {
          value: zHR.label,
          label: `${zHR.pct}% maxHR`,
          color: zHR.color,
        },
        secondary: [
          summary.load != null ? { label: 'load', value: `${summary.load}`, color: summary.effortColor } : null,
          summary.decoupling != null ? { label: 'drift', value: `${summary.decoupling}%`, color: decouplingColor(summary.decoupling) } : null,
        ].filter(Boolean).slice(0, 2),
      };
    }
  }

  // ── Strength ───────────────────────────────────────────────────
  if (planType === 'strength' && summary.load != null) {
    return {
      primary: {
        value: `${summary.load}`,
        label: `${summary.effortBucket || 'load'}`,
        color: summary.effortColor,
      },
      secondary: [
        summary.avgHR ? { label: 'avg HR', value: `${summary.avgHR}`, color: T2 } : null,
      ].filter(Boolean),
    };
  }

  // ── Tempo / intervals / HIIT / race / default — efficiency ──────
  return {
    primary: {
      value: summary.efficiencyPct != null ? `${summary.efficiencyPct}%` : '—',
      label: 'efficient',
      color: efficiencyColor(summary.efficiencyPct),
    },
    secondary: [
      summary.load != null ? { label: 'load', value: `${summary.load}`, color: summary.effortColor } : null,
      summary.decoupling != null ? { label: 'drift', value: `${summary.decoupling}%`, color: decouplingColor(summary.decoupling) } : null,
    ].filter(Boolean).slice(0, 2),
  };
}

// ── Family icons (Phosphor — high-resolution, scalable, consistent) ──────
// Wrappers so the rest of the file uses our { c, s } prop shape.
const FamilyRun      = ({ c = T2, s = 16 }) => <PersonSimpleRun     size={s} color={c} weight="duotone" />;
const FamilyStrength = ({ c = T2, s = 16 }) => <Barbell             size={s} color={c} weight="duotone" />;
const FamilyHIIT     = ({ c = T2, s = 16 }) => <Lightning           size={s} color={c} weight="duotone" />;
const FamilyMobility = ({ c = T2, s = 16 }) => <PersonSimpleTaiChi  size={s} color={c} weight="duotone" />;
const FamilyCross    = ({ c = T2, s = 16 }) => <Bicycle             size={s} color={c} weight="duotone" />;
const FamilyRace     = ({ c = T2, s = 16 }) => <Trophy              size={s} color={c} weight="duotone" />;

// ── Inline icons (still inline — small, monochrome, accept color prop) ──
const Icon = {
  Heart: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>
  ),
  Drop: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69 5.5 9.34a8 8 0 1 0 13 0z"/>
    </svg>
  ),
  Bullseye: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  Sun: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 3v1M12 20v1M3 12h1M20 12h1M5.6 5.6l.7.7M17.7 17.7l.7.7M5.6 18.4l.7-.7M17.7 6.3l.7-.7"/>
    </svg>
  ),
  Cloud: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
    </svg>
  ),
  Rain: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
      <line x1="8" y1="19" x2="8" y2="21"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="16" y1="19" x2="16" y2="21"/>
    </svg>
  ),
  Snow: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/><line x1="19.07" y1="4.93" x2="4.93" y2="19.07"/>
    </svg>
  ),
  Wheat: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 22V8M7 18c-1-1.5-2-3-4-4M7 14c-1-1.5-2-3-4-4M7 10c-1-1.5-2-3-4-4M3 22c2-1.5 4-3 4-6M3 18c2-1.5 4-3 4-6M3 14c2-1.5 4-3 4-6"/>
      <path d="M12 22V8M16 18c-1-1.5-2-3-4-4M16 14c-1-1.5-2-3-4-4M16 10c-1-1.5-2-3-4-4M12 22c2-1.5 4-3 4-6M12 18c2-1.5 4-3 4-6M12 14c2-1.5 4-3 4-6"/>
    </svg>
  ),
  Stretch: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="2"/>
      <path d="M12 6v6M8 14l4-2 4 2M8 14l-2 6M16 14l2 6M9 11l-3-3M15 11l3-3"/>
    </svg>
  ),
  Moon: ({ c = T2, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  ),
  Check: ({ c = GOOD, s = 12 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  // Phase 4q.pre.7 — duotone recovery icons. Same aesthetic as Phosphor
  // (PhDrop, PhMoon) used elsewhere in the fuel band: filled body at low
  // opacity, full-stroke outline, accent details. Reads cleanly at 14px.
  Salt: ({ c = T2, s = 14 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      {/* Body fill */}
      <rect x="7.5" y="10" width="9" height="12" rx="2" fill={c} fillOpacity="0.22"/>
      {/* Cap fill — slightly more opaque to read as a separate piece */}
      <rect x="9" y="5" width="6" height="5" rx="1.2" fill={c} fillOpacity="0.5"/>
      {/* Outlines */}
      <rect x="7.5" y="10" width="9" height="12" rx="2" fill="none" stroke={c} strokeWidth="1.5"/>
      <rect x="9" y="5" width="6" height="5" rx="1.2" fill="none" stroke={c} strokeWidth="1.5"/>
      {/* Perforations on the cap */}
      <circle cx="10.5" cy="7.5" r="0.55" fill={c}/>
      <circle cx="12"   cy="7.5" r="0.55" fill={c}/>
      <circle cx="13.5" cy="7.5" r="0.55" fill={c}/>
      {/* Visible salt grains inside */}
      <circle cx="10" cy="15"   r="0.55" fill={c}/>
      <circle cx="13" cy="17"   r="0.55" fill={c}/>
      <circle cx="11" cy="19"   r="0.55" fill={c}/>
    </svg>
  ),
  Egg: ({ c = T2, s = 14 }) => (
    <svg width={s} height={s} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      {/* Body — egg shape (narrower at top, rounder at bottom) */}
      <path
        d="M12 3C8.5 3 5.8 8 5.8 14C5.8 18 8.5 21 12 21C15.5 21 18.2 18 18.2 14C18.2 8 15.5 3 12 3Z"
        fill={c} fillOpacity="0.3"
      />
      <path
        d="M12 3C8.5 3 5.8 8 5.8 14C5.8 18 8.5 21 12 21C15.5 21 18.2 18 18.2 14C18.2 8 15.5 3 12 3Z"
        fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round"
      />
      {/* Subtle highlight on the upper-left to suggest a 3D sheen */}
      <path
        d="M9 8C8 10 7.5 12 7.8 14"
        fill="none" stroke={c} strokeWidth="1.3" strokeOpacity="0.5" strokeLinecap="round"
      />
    </svg>
  ),
};

const FAMILY_ICON = {
  run:      FamilyRun,
  strength: FamilyStrength,
  hiit:     FamilyHIIT,
  mobility: FamilyMobility,
  cross:    FamilyCross,
  race:     FamilyRace,
};

function weatherIcon({ condition, color = T2, size = 12 }) {
  if (!condition) return <Icon.Sun c={color} s={size}/>;
  const c = condition.toLowerCase();
  if (/(rain|drizzle|shower|thunder)/.test(c)) return <Icon.Rain c={color} s={size}/>;
  if (/(snow)/.test(c))                        return <Icon.Snow c={color} s={size}/>;
  if (/(cloud|fog|overcast)/.test(c))          return <Icon.Cloud c={color} s={size}/>;
  return <Icon.Sun c={color} s={size}/>;
}

// Phase 4q.weather.3 — color the icon by condition so the weather chip
// reads the conditions at a glance: warm yellow for sun, cool blue for
// rain/showers, deeper indigo for thunderstorms, soft white for snow,
// neutral white for fog, slate-blue-grey for clouds.
function weatherIconColor(condition) {
  if (!condition) return '#fbbf24';
  const c = condition.toLowerCase();
  if (/thunder/.test(c))                       return '#818cf8';
  if (/(rain|drizzle|shower)/.test(c))         return '#60a5fa';
  if (/snow/.test(c))                          return '#e0f2fe';
  if (/(fog|mist|haze)/.test(c))               return '#e8e6e0';
  if (/(cloud|overcast)/.test(c))              return '#94a3b8';
  if (/(clear|sun)/.test(c))                   return '#fbbf24';
  return T3;
}

// ── State helper for parent ───────────────────────────────────────────────
export function getPlannedWorkoutState({ plannedToday, nextRace, storageVersion = 0 }) {
  const todayDate = localDate();
  const allActivities = getUnifiedActivities();
  const todayActivities = allActivities.filter(a => (a.date || '').startsWith(todayDate));
  return deriveState({ planned: plannedToday, todayActivities, todayDate, nextRace });
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────────────────
export function PlannedWorkoutTile({ profile, plannedToday, nextRace, storageVersion = 0, onTap }) {
  const todayDate = useMemo(() => localDate(), []);
  const allActivities = useMemo(() => getUnifiedActivities(), [storageVersion]);
  const todayActivities = useMemo(
    () => allActivities.filter(a => (a.date || '').startsWith(todayDate)),
    [allActivities, todayDate]
  );
  const state = useMemo(
    () => deriveState({ planned: plannedToday, todayActivities, todayDate, nextRace }),
    [plannedToday, todayActivities, todayDate, nextRace]
  );

  // Phase 4r.adapt.3 — rolling rebound debt across recent workouts. Uses
  // the recoverySignature module to walk last 7 days and accumulate
  // unrecovered hydration / glycogen residual. The result feeds an
  // advisory band on the today's tile AND can soften today's readiness
  // verdict by one notch when debt is severe.
  //
  // Cheap to compute (~62 signatures last time we measured), but memoize
  // on storageVersion so it doesn't run every render.
  const reboundDebt = useMemo(() => {
    try {
      // eslint-disable-next-line no-undef
      const wh = (typeof window !== 'undefined' ? window.__arnoldStorage : null)?.get?.('weight') || [];
      const sigs = signaturesForActivities(allActivities, wh, { daysBack: 14 });
      return computeReboundDebt(sigs);
    } catch (e) {
      return { totalDebtLbs: 0, incompleteCount: 0, severity: 'none', advisoryCopy: null };
    }
  }, [allActivities, storageVersion]);

  const [weather, setWeather] = useState(() => getCachedWeather(todayDate));
  // Phase 4q.weather.1 — keep weather live. Three triggers:
  //   1. mount / state-change : pull fresh if cache is stale (>30 min)
  //   2. visibilitychange      : re-pull when the user foregrounds the app
  //   3. periodic interval     : 15-min refresh while the tile is visible
  // The cache TTL in getCachedWeather/setCachedWeather is the source of
  // truth; this effect just decides WHEN to consult it.
  useEffect(() => {
    if (state.kind === 'none') return;
    let active = true;

    const refreshWeather = () => {
      const fresh = getCachedWeather(todayDate);
      if (fresh && fresh.date === todayDate) {
        setWeather(fresh);
        return;
      }
      fetchWeatherForDate(todayDate).then(w => {
        if (!active || !w) return;
        setWeather(w);
        setCachedWeather(todayDate, w);
      });
    };

    refreshWeather();

    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshWeather();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    const intervalId = setInterval(refreshWeather, 15 * 60 * 1000);

    return () => {
      active = false;
      clearInterval(intervalId);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [state.kind, todayDate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.kind === 'none') return null;

  const family = state.family;
  const familyColor = FAMILY_COLOR[family] || T2;
  const FamilyIcon = FAMILY_ICON[family] || Icon.Run;

  // ── PRE STATE ───────────────────────────────────────────────────────────
  // Phase 4q.pre.3 — Match the post-workout 3-band footprint exactly so
  // the tile is a consistent size pre and post. Bands:
  //   1. Output  — target distance · time · pace + target zone bar
  //                (zone bar suppressed for mobility / strength where
  //                HR-zone targeting isn't meaningful)
  //   2. Status  — session-aware chips. Hard sessions get a readiness
  //                verdict + sleep + HRV. Easy/long get sleep + HRV +
  //                days-since-hard. Mobility/short skip the verdict
  //                entirely and frame as recharge (days-since-hard +
  //                active-days-this-week + sleep). Strength gets sleep +
  //                HRV + days-since-hard.
  //   3. Fuel    — water · carbs · warmup (warmup omitted for mobility).
  if (state.kind === 'pre') {
    const planType   = plannedToday?.type;
    const planMins   = plannedMinutes({ planned: plannedToday, profile });
    const fuel       = fuelTargets({ minutes: planMins });
    const planLabel  = PLAN_TYPE_LABEL[planType] || 'Workout';
    const wkCtx      = weekActivityContext({ allActivities });

    const isHard     = ['tempo', 'intervals', 'hiit'].includes(planType);
    const isEasy     = ['easy_run', 'long_run'].includes(planType);
    const isStr      = planType === 'strength';
    const isMob      = planType === 'mobility' || (planMins != null && planMins < 20);

    const targetPace = (() => {
      if (!isEasy && !isHard) return null;
      const base = profile?.targetRacePace || '9:30';
      const [m, s] = String(base).split(':').map(Number);
      const baseSecs = m * 60 + (s || 0);
      const off = planType === 'easy_run'  ? 75
                : planType === 'long_run'  ? 60
                : planType === 'tempo'     ? 0
                : planType === 'intervals' ? -30
                : null;
      if (off == null) return null;
      const sec = baseSecs + off;
      return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
    })();

    const warmupMin = isMob ? 0
                    : isHard ? 10
                    : (planType === 'long_run' || isStr) ? 8
                    : 5;

    // Pull sleep + HRV signals once so all branches can use them.
    let sleepHrs = null, sleepDelta = null;
    let hrvNow = null, hrvDelta = null;
    try {
      const sleep = (storage.get('sleep') || [])
        .filter(s => s?.durationMinutes)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (sleep[0]) {
        sleepHrs = +(sleep[0].durationMinutes / 60).toFixed(1);
        const last7 = sleep.slice(0, 7).filter(s => s.durationMinutes);
        if (last7.length >= 3) {
          const avg = last7.reduce((s, r) => s + r.durationMinutes, 0) / last7.length / 60;
          sleepDelta = +(sleepHrs - avg).toFixed(1);
        }
      }
      const hrv = (storage.get('hrv') || [])
        .filter(h => h?.overnightHRV)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      if (hrv[0]) {
        hrvNow = Number(hrv[0].overnightHRV);
        const last14 = hrv.slice(0, 14);
        if (last14.length >= 5) {
          const baseline = last14.reduce((s, r) => s + Number(r.overnightHRV), 0) / last14.length;
          hrvDelta = Math.round(hrvNow - baseline);
        }
      }
    } catch {}

    const sleepColor = sleepHrs == null ? T2
                     : sleepHrs >= 7    ? GOOD
                     : sleepHrs >= 6    ? WARN
                     :                    BAD;
    const hrvColor   = hrvDelta == null ? T2
                     : hrvDelta >= 0    ? GOOD
                     : hrvDelta >= -5   ? WARN
                     :                    BAD;
    const dshColor   = wkCtx.daysSinceHard == null ? T2
                     : wkCtx.daysSinceHard <= 1    ? WARN
                     :                                GOOD;

    // Band 1 — Output chips (target dist · time · pace) + zone bar.
    const outputChips = [
      plannedToday?.distanceMi ? { value: `${plannedToday.distanceMi}`, post: 'mi' } : null,
      planMins ? { value: planMins >= 60 ? `${Math.floor(planMins / 60)}h ${Math.round(planMins % 60)}m` : `${Math.round(planMins)} min`, post: null } : null,
      targetPace ? { value: targetPace, post: '/mi' } : null,
    ].filter(Boolean);
    // Phase 4r.tile.1 — Suppress the TARGET zone bar pre-workout. Pre-
    // workout we don't yet have anything to show against; the target
    // distribution is theoretical and was visually colliding with the
    // session signature illustration in the bottom-right corner. Zone
    // bars now render only post-workout, where they reflect ACTUAL time
    // in zone — the meaningful, comparable signal. Keeping the constant
    // around as a no-op so other branches (mobility / strength) still
    // explicitly skip it.
    const showZoneBar = false;
    const targetZone  = null;

    // Band 2 — Status chips, session-aware.
    let statusChips = [];
    if (isHard) {
      // Phase 4r.adapt.3 — apply rebound-debt softening to the readiness
      // verdict. If recent sessions left a hydration/glycogen residual,
      // downgrade today's "GO STRONG" to "STEADY" (or "STEADY" → "DIAL
      // BACK"). The advisory band rendered below the mantra explains
      // why, so the softening is never silent.
      const rRaw = readinessVerdict({ profile });
      const r = softenReadinessForDebt(rRaw, reboundDebt);
      statusChips = [
        { value: r.label, post: null, color: r.color },
        sleepHrs != null ? { value: `${sleepHrs}`, post: 'h sleep', color: sleepColor } : null,
        hrvDelta != null ? { value: `${hrvDelta >= 0 ? '+' : ''}${hrvDelta}`, post: 'HRV', color: hrvColor }
                        : (hrvNow != null ? { value: `${hrvNow}`, post: 'HRV', color: T2 } : null),
        wkCtx.daysSinceHard != null ? { value: `${wkCtx.daysSinceHard}d`, post: 'post-key', color: T2 } : null,
      ].filter(Boolean);
    } else if (isMob) {
      // Phase 4q.pre.4 — On a recharge day the relevant question isn't
      // "am I ready?" but "did I put the work in this week?". Show
      // weekly recap chips so the tile validates the work and gives
      // context for why today is a stretch session.
      statusChips = [
        wkCtx.weeklyMiles > 0
          ? { value: `${wkCtx.weeklyMiles}`, post: 'mi week', color: T1 }
          : null,
        wkCtx.weeklyStrength > 0
          ? { value: `${wkCtx.weeklyStrength}`, post: wkCtx.weeklyStrength === 1 ? 'lift' : 'lifts', color: T1 }
          : null,
        wkCtx.weeklyHIIT > 0
          ? { value: `${wkCtx.weeklyHIIT}`, post: 'HIIT', color: T1 }
          : null,
        { value: `${wkCtx.activeDaysThisWeek}/7`, post: 'active', color: T2 },
        sleepHrs != null
          ? { value: `${sleepHrs}`, post: 'h sleep', color: sleepColor }
          : null,
      ].filter(Boolean);
    } else if (isStr) {
      statusChips = [
        sleepHrs != null ? { value: `${sleepHrs}`, post: 'h sleep', color: sleepColor } : null,
        hrvDelta != null ? { value: `${hrvDelta >= 0 ? '+' : ''}${hrvDelta}`, post: 'HRV', color: hrvColor } : null,
        wkCtx.daysSinceHard != null ? { value: `${wkCtx.daysSinceHard}d`, post: 'post-key', color: T2 } : null,
        wkCtx.weeklyStrength > 0 ? { value: `${wkCtx.weeklyStrength}`, post: wkCtx.weeklyStrength === 1 ? 'lift wk' : 'lifts wk', color: T2 } : null,
      ].filter(Boolean);
    } else {
      // Easy / long — readiness signals without the verdict, plus weekly mileage.
      statusChips = [
        sleepHrs != null ? { value: `${sleepHrs}`, post: 'h sleep', color: sleepColor } : null,
        hrvDelta != null ? { value: `${hrvDelta >= 0 ? '+' : ''}${hrvDelta}`, post: 'HRV', color: hrvColor } : null,
        wkCtx.daysSinceHard != null ? { value: `${wkCtx.daysSinceHard}d`, post: 'post-key', color: T2 } : null,
        wkCtx.weeklyMiles > 0 ? { value: `${wkCtx.weeklyMiles}`, post: 'mi wk', color: T2 } : null,
      ].filter(Boolean);
    }

    // Band 3 — Fuel / Prep. For mobility, the fuel band becomes a recovery
    // primer (electrolytes + protein) rather than a workout fuel checklist.
    const fuelChips = isMob
      ? [
          fuel ? { icon: <PhDrop size={14} color="#22d3ee" weight="duotone"/>, value: ozToLiters(fuel.waterOz), sub: 'water' } : null,
          { icon: <Icon.Salt c="#fbbf24" s={14}/>, value: '500mg', sub: 'sodium' },
          { icon: <Icon.Egg c="#fb923c" s={14}/>, value: '20g', sub: 'protein' },
        ].filter(Boolean)
      : [
          fuel ? { icon: <PhDrop size={14} color="#22d3ee" weight="duotone"/>, value: ozToLiters(fuel.waterOz), sub: 'water' } : null,
          fuel && fuel.carbsG > 0 ? { icon: <Icon.Wheat c={GOOD} s={14}/>, value: `${fuel.carbsG}g`, sub: 'carbs' } : null,
          warmupMin > 0 ? { icon: <PersonSimpleTaiChi size={14} color="#a78bfa" weight="duotone"/>, value: `${warmupMin}m`, sub: 'warmup' } : null,
        ].filter(Boolean);

    // Header-right always shows weather now (Phase 4q.pre.5 restored it
    // for mobility days too — the family icon + plan label already convey
    // the recharge framing). Weather chip only renders if data is loaded.
    // Phase 4q.weather.3 — show CURRENT temp in °C with a condition-tinted
    // icon, falling back to the daily mid-point if `current` isn't on the
    // payload (archive endpoint, older cached entries).
    const headerRight = (() => {
      if (!weather) return null;
      const cond = weather.currentCondition || weather.condition;
      const tempC = weather.currentTempC != null
        ? Math.round(weather.currentTempC)
        : (weather.tempMaxC != null && weather.tempMinC != null
            ? Math.round((weather.tempMaxC + weather.tempMinC) / 2)
            : null);
      if (tempC == null) return null;
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 600, color: T3,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {weatherIcon({ condition: cond, color: weatherIconColor(cond), size: 12 })}
          <span>{tempC}°C</span>
        </span>
      );
    })();

    // Phase 4q.pre.4 — synthesized focus areas for mobility/short days.
    // Fills the otherwise-bare output band with specific, useful context
    // (which body areas the session targets) instead of just "20 min".
    const focusAreas = isMob ? ['Hips', 'Spine', 'Hams', 'Calves'] : null;

    // Phase 4q.pre.6 — session mantra lives in the section header suffix
    // alongside the plan label, so EVERY session type (runs, hard, easy,
    // strength, mobility) sees the upbeat caption — even when there's a
    // zone bar competing for the right side of band 1. The hardest
    // sessions are the ones that need this most.
    const readinessForMantra = isHard ? readinessVerdict({ profile }) : null;
    const mantra = sessionMantra({
      planType, isMob, isHard, isEasy, isStr,
      readiness: readinessForMantra,
      wkCtx,
    });

    // Phase 4q.signatures.22 — corner-stamp signature now owns the right
    // side of the tile, so the BIG MotivationPanel in the output band is
    // dropped. Mantra always renders as small caps in the section header
    // suffix instead, alongside the plan label. The big badge handles
    // the visual energy; the mantra is a session-theme tag.

    return (
      <Card familyColor={familyColor} onTap={onTap}>
        <SectionHeader
          icon={<FamilyIcon c={familyColor} s={15}/>}
          label="TODAY"
          suffix={
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', color: familyColor, textTransform: 'uppercase', marginLeft: 1 }}>
              · {planLabel}
            </span>
          }
          right={headerRight}
        />
        {/* Phase 4q.signatures.24 — mantra now lives on its own dedicated
            line directly below the header. Larger, family-colored, with
            a soft self-glow so it reads as a session-ethos banner rather
            than a forgotten suffix tag. Stays single-line; the small
            accent on the left anchors it visually. */}
        {mantra && (
          <div style={{
            padding: '1px 12px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 7,
          }}>
            <span style={{
              width: 3,
              height: 13,
              background: familyColor,
              borderRadius: 1.5,
              boxShadow: `0 0 8px ${familyColor}cc`,
              flexShrink: 0,
            }}/>
            <span style={{
              fontSize: 13, fontWeight: 800,
              letterSpacing: '0.14em',
              color: familyColor,
              textTransform: 'uppercase',
              textShadow: `0 0 14px ${familyColor}66, 0 1px 0 rgba(0,0,0,0.4)`,
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
            }}>{mantra}</span>
          </div>
        )}
        {/* Phase 4r.adapt.3 — rebound debt advisory. Renders only when
            recent workouts left a hydration/glycogen residual. Coral
            for monitor (single incomplete in last 7d), red for flag
            (multiple incompletes OR debt > 2.5 lb). When 'flag' fires,
            the readiness verdict above is also softened one notch. */}
        {reboundDebt.severity !== 'none' && reboundDebt.advisoryCopy && (
          <div style={{
            margin: '0 12px 6px',
            padding: '6px 10px',
            borderRadius: 6,
            background: reboundDebt.severity === 'flag'
              ? 'rgba(248, 113, 113, 0.10)'
              : 'rgba(251, 191, 36, 0.08)',
            border: `0.5px solid ${reboundDebt.severity === 'flag'
              ? 'rgba(248, 113, 113, 0.35)'
              : 'rgba(251, 191, 36, 0.30)'}`,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 7,
            fontSize: 10.5,
            lineHeight: 1.35,
            color: T1,
          }}>
            <span style={{
              fontSize: 13,
              lineHeight: 1,
              color: reboundDebt.severity === 'flag' ? '#f87171' : '#fbbf24',
              flexShrink: 0,
              marginTop: 1,
            }}>◉</span>
            <span style={{ minWidth: 0 }}>{reboundDebt.advisoryCopy}</span>
          </div>
        )}
        <PerfOutputRow
          chips={outputChips}
          zones={targetZone}
          planType={planType}
        />
        {focusAreas && (
          <div style={{
            padding: '0 12px 4px',
            fontSize: 11, fontWeight: 500,
            color: T2,
            letterSpacing: '0.02em',
            marginTop: -2,
          }}>
            {focusAreas.join(' · ')}
          </div>
        )}
        {statusChips.length > 0 && <PerfQualityRow chips={statusChips} reserveRightSpace={!!family}/>}
        {fuelChips.length > 0 && (
          <RecoverySection
            chips={fuelChips}
            headerLabel="FUEL"
            reserveRightSpace
          />
        )}
        {/* Phase 4q.signatures.21 — corner-stamp signature, absolutely
            positioned at bottom-right of the Card so it fills the
            otherwise-empty right side that runs the full height of the
            status + recovery bands. */}
        <div style={{
          position: 'absolute',
          bottom: 4,
          right: 6,
          pointerEvents: 'none',
          zIndex: 1,
        }}>
          <SessionSignature family={family} planType={planType} FamilyIcon={FamilyIcon} color={familyColor}/>
        </div>
      </Card>
    );
  }

  // ── RACE-PRE STATE ──────────────────────────────────────────────────────
  if (state.kind === 'race-pre') {
    const distLabel = nextRace?.distanceMi ? `${nextRace.distanceMi} mi`
                    : nextRace?.distanceKm ? `${nextRace.distanceKm} km` : null;
    const goalPace = profile?.targetRacePace || null;

    const leftLines = [
      distLabel ? { value: distLabel, sub: 'race day', tier: 'big' } : null,
      nextRace?.name ? { value: nextRace.name, sub: null, tier: 'small' } : null,
    ].filter(Boolean);

    const rightLines = [
      weather ? { icon: weatherIcon({ condition: weather.condition, color: familyColor, size: 12 }), value: `${weather.tempMinF}–${weather.tempMaxF}°`, sub: weather.condition.toLowerCase().split(/\s+/)[0], tier: 'big' } : null,
      goalPace ? { icon: <Icon.Bullseye c={familyColor}/>, value: goalPace, sub: 'goal pace', tier: 'mid' } : null,
      { icon: <Icon.Drop c={familyColor}/>, value: '0.7L', sub: 'pre-race', tier: 'small' },
    ].filter(Boolean);

    return (
      <Card familyColor={familyColor} onTap={onTap}>
        <SectionHeader
          icon={<FamilyIcon c={familyColor} s={14}/>}
          label="RACE DAY"
          right="TAPER · LET 'EM COME UP"
        />
        <SplitTopPanel left={leftLines} right={rightLines}/>
      </Card>
    );
  }

  // ── COMPLETE / RACE-COMPLETE ────────────────────────────────────────────
  const summary = summarizeActivity({
    activity: state.activity || todayActivities[0] || {},
    profile, allActivities,
  });
  const recovery = recoveryPrescription({ summary, profile });
  const isRace = state.kind === 'race-complete';

  // Phase 4p.plan.14 — recovery icons unified with the running figure
  // style. PersonSimpleTaiChi (Phosphor duotone) for mobility matches
  // PersonSimpleRun in the header. Drop and Moon also Phosphor for
  // visual consistency. Wheat stays inline (Phosphor doesn't have one
  // and the inline glyph reads as "grain" cleanly).
  const recoveryChips = [
    recovery.carbsG > 0 ? { icon: <Icon.Wheat c={GOOD}/>,                                        value: `${recovery.carbsG}g`,   sub: 'carbs' } : null,
    { icon: <PhDrop size={14} color="#22d3ee" weight="duotone"/>,                                value: `${recovery.waterL}L`,   sub: 'water' },
    { icon: <PersonSimpleTaiChi size={14} color="#a78bfa" weight="duotone"/>,                    value: `${recovery.mobMin}m`,   sub: 'mobility' },
    { icon: <PhMoon size={14} color="#94a3b8" weight="duotone"/>,                                value: `${recovery.sleepHrs}h`, sub: 'sleep' },
  ].filter(Boolean);

  // Phase 4p.plan.14 — split into two rows:
  //   row 1 = volume output (dist · time · pace) with the zone bar inline
  //           on the right. Bar is short and subtle.
  //   row 2 = quality + efficiency: load, drift, cadence, vert ratio,
  //           ground contact time. Each chip color-tinted by status.
  const outputChips = [
    summary.distanceMi ? { value: Number(summary.distanceMi).toFixed(2), post: 'mi' } : null,
    { value: summary.duration, post: null },
    summary.pace ? { value: summary.pace, post: '/mi' } : null,
  ].filter(Boolean);

  // Phase 4q.post.1 — running-form metrics (cad/vert/gct) only render when
  // they're > 0. Mobility/non-running activities have null OR 0 here, and
  // showing "0 cad · 0% vert · 0 ms gct" is data noise. With all three
  // filtered, the quality row drops out entirely for mobility-style work.
  // Phase 4r.form.1 — derive pace in secs/mi from durationSecs/distanceMi
  // for cadence's pace-aware threshold (more reliable than parsing the
  // formatted pace string).
  const paceSecsPerMi = (summary.minutes > 0 && summary.distanceMi > 0)
    ? (summary.minutes * 60) / summary.distanceMi
    : null;
  const qualityChips = [
    summary.load != null       ? { value: `${summary.load}`,           post: 'load',   color: summary.effortColor                  } : null,
    summary.decoupling != null ? { value: `${summary.decoupling}%`,    post: 'drift',  color: decouplingColor(summary.decoupling)  } : null,
    summary.cadence       != null && summary.cadence       > 0 ? { value: `${summary.cadence}`,        post: 'cad',    color: cadenceColor(summary.cadence, paceSecsPerMi) } : null,
    summary.verticalRatio != null && summary.verticalRatio > 0 ? { value: `${summary.verticalRatio}%`, post: 'vert',   color: verticalRatioColor(summary.verticalRatio)    } : null,
    summary.groundContact != null && summary.groundContact > 0 ? { value: `${summary.groundContact}`,  post: 'ms gct', color: gctColor(summary.groundContact)              } : null,
  ].filter(Boolean).slice(0, 5);

  // Weather glyph + temp for the run conditions, in the header right slot.
  // Phase 4q.weather.3 — current temp in °C with condition-tinted icon.
  const weatherChip = (() => {
    if (!weather) return null;
    const cond = weather.currentCondition || weather.condition;
    const tempC = weather.currentTempC != null
      ? Math.round(weather.currentTempC)
      : (weather.tempMaxC != null && weather.tempMinC != null
          ? Math.round((weather.tempMaxC + weather.tempMinC) / 2)
          : null);
    if (tempC == null) return null;
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 600, color: T3,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {weatherIcon({ condition: cond, color: weatherIconColor(cond), size: 12 })}
        <span>{tempC}°C</span>
      </span>
    );
  })();

  return (
    <Card familyColor={familyColor} onTap={onTap}>
      <SectionHeader
        icon={<FamilyIcon c={familyColor} s={15}/>}
        label="PERFORMANCE"
        suffix={<Icon.Check c={GOOD} s={12}/>}
        right={weatherChip}
      />
      <PerfOutputRow chips={outputChips} zones={summary.zones} planType={state.planType}/>
      {qualityChips.length > 0 && <PerfQualityRow chips={qualityChips} reserveRightSpace={!!family}/>}
      <RecoverySection chips={recoveryChips} reserveRightSpace={!!family}/>
      {/* Phase 4q.signatures.21 — corner-stamp signature, absolutely
          positioned at bottom-right of the Card. */}
      <div style={{
        position: 'absolute',
        bottom: 4,
        right: 6,
        pointerEvents: 'none',
        zIndex: 1,
      }}>
        <SessionSignature family={family} planType={state.planType} FamilyIcon={FamilyIcon} color={familyColor}/>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// LAYOUT
// ──────────────────────────────────────────────────────────────────────────
function Card({ children, familyColor, onTap }) {
  return (
    <div
      onClick={onTap}
      style={{
        background: 'rgba(50,50,50,0.55)',
        border: '0.5px solid rgba(140,140,140,0.18)',
        borderRadius: 12,
        padding: 0,
        marginBottom: 10,
        position: 'relative',
        overflow: 'hidden',
        cursor: onTap ? 'pointer' : 'default',
      }}
    >
      <div style={{
        height: 2.5, background: familyColor, opacity: 0.85,
        borderRadius: '12px 12px 0 0',
      }}/>
      {children}
    </div>
  );
}

// Header: "🏃 PERFORMANCE ✓"      <floating-right>
// suffix renders INLINE right after the label (used for ✓ on completed
// sessions). right renders floating to the far right (used for plan-type
// metadata like "EASY RUN" / "TAPER NOTE").
function SectionHeader({ icon, label, suffix, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8,
      padding: '4px 12px 2px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        {icon}
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          color: T3, textTransform: 'uppercase',
        }}>{label}</span>
        {suffix && <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 1 }}>{suffix}</span>}
      </div>
      {right && (
        typeof right === 'string'
          ? <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.10em', color: T4, textTransform: 'uppercase' }}>{right}</span>
          : <span style={{ display: 'inline-flex' }}>{right}</span>
      )}
    </div>
  );
}

// Phase 4p.plan.14 — Row 1: output chips with inline subtle zone mini-bar.
// dist · time · pace sit on the left; the zone bar (~56px wide, 3px tall)
// sits inline at the right edge with the dominant zone label so the user
// gets a quick visual of intensity distribution without a full band.
//
// Phase 4q.pre.8 — when there's no zone bar (mobility / strength), the
// `motivation` prop renders a high-resolution motivation panel in the
// right slot instead — big caps, family-colored, with a soft glow.
function PerfOutputRow({ chips, zones, planType, motivation }) {
  return (
    <div style={{
      display: 'flex',
      // flex-start so the zone column (bar + labels stacked) aligns with
      // the text top, with the bar visually "lifted" to sit near the top
      // of the output line and labels hanging beneath the text baseline.
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: '4px 12px',
      padding: '2px 12px 3px',
    }}>
      {chips.map((c, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 3,
          minWidth: 0,
        }}>
          <span style={{
            fontSize: 14, fontWeight: 700,
            color: c.color || T1,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
          }}>{c.value}</span>
          {c.post && (
            <span style={{
              fontSize: 10, fontWeight: 500,
              color: c.color ? c.color : T3,
              letterSpacing: '0.02em',
              opacity: c.color ? 0.85 : 1,
              whiteSpace: 'nowrap',
            }}>{c.post}</span>
          )}
        </span>
      ))}
      {zones && <MiniZoneBar zones={zones} planType={planType}/>}
      {!zones && motivation && (
        <MotivationPanel mantra={motivation.mantra} color={motivation.color}/>
      )}
    </div>
  );
}

// Phase 4q.pre.8 — splits a mantra into 2 visual lines for stacking in
// the motivation panel. Special-cases "X & Y" so the ampersand prefixes
// the second line; otherwise splits at the word-count midpoint.
function splitMantra(m) {
  if (!m) return [];
  if (m.includes(' & ')) {
    const [a, b] = m.split(' & ');
    return [a, `& ${b}`];
  }
  const words = m.split(' ');
  if (words.length <= 1) return [m];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// Phase 4q.pre.8 — high-resolution motivation panel. Two-line caps,
// family-colored, weight 800, soft text-shadow glow. Sits on the right
// of the output band where the zone bar would otherwise go, giving the
// pre-workout tile a strong "do the work" visual anchor.
function MotivationPanel({ mantra, color }) {
  if (!mantra) return null;
  const lines = splitMantra(mantra);
  return (
    <span
      style={{
        marginLeft: 'auto',
        display: 'inline-flex', flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1,
        flexShrink: 0,
        alignSelf: 'flex-start',
        paddingTop: 0,
        lineHeight: 0.92,
      }}
    >
      {lines.map((line, i) => (
        <span key={i} style={{
          fontSize: 17, fontWeight: 800,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          textAlign: 'right',
          textShadow: `0 0 14px ${color}55, 0 1px 0 rgba(0,0,0,0.4)`,
        }}>{line}</span>
      ))}
    </span>
  );
}

// Phase 4p.plan.15 — bar lifted to top of its column with the per-zone
// labels stacked beneath it. Position stays at the right edge of the
// output row, but instead of one inline "Z2 65%" dominant label, every
// non-zero zone gets its own labeled chip below the bar.
//
//                         ▓▓▓▓▓▓▓▓▓▓▓▓
//                         Z1 5% · Z2 65% · Z3 25% · Z4 5%
//
// Bar tops out at 90px wide × 3px tall, low-opacity zone colors. Labels
// underneath are 8px, zone-letter colored in matching family, % in muted
// neutral so the colored letters carry the visual rhythm without
// shouting. Estimated zones still get the "est." marker — moved to a
// title attribute on the wrapper so it's not visible-but-tiny clutter.
function MiniZoneBar({ zones, planType }) {
  if (!zones) return null;
  const ZONE_COLORS = {
    z1: '#22c55e', z2: '#4ade80', z3: '#fbbf24', z4: '#fb7185', z5: '#f87171',
  };
  const segs = ['z1','z2','z3','z4','z5'].map(k => ({
    key: k, pct: zones[k] || 0, color: ZONE_COLORS[k],
  }));
  const total = segs.reduce((s, x) => s + x.pct, 0);
  if (total <= 0) return null;
  const visible = segs.filter(s => s.pct > 0);
  return (
    <span
      title={zones.estimated ? 'Time in zone (estimated from avg HR)' : 'Time in zone'}
      style={{
        display: 'inline-flex', flexDirection: 'column',
        gap: 3,
        marginLeft: 'auto',
        flexShrink: 0,
        alignSelf: 'flex-start',
        paddingTop: 4,        // lift so bar sits up near the text top
        minWidth: 100,
      }}
    >
      {/* Bar */}
      <span style={{
        display: 'flex',
        height: 3,
        borderRadius: 2,
        overflow: 'hidden',
        background: 'rgba(140,140,140,0.10)',
      }}>
        {segs.map(s => s.pct > 0 ? (
          <span key={s.key} style={{
            flex: s.pct, background: s.color, opacity: 0.7,
          }}/>
        ) : null)}
      </span>
      {/* Zone labels — listed below the bar, dot separators between */}
      <span style={{
        display: 'flex', flexWrap: 'wrap',
        rowGap: 1, columnGap: 5,
        fontSize: 10, fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
        justifyContent: 'flex-end',
      }}>
        {visible.map((s, i) => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ color: s.color, fontWeight: 700, letterSpacing: '0.04em' }}>{s.key.toUpperCase()}</span>
            <span style={{ color: T3, fontWeight: 500 }}>{s.pct}%</span>
            {i < visible.length - 1 && <span style={{ color: T4, marginLeft: 2 }}>·</span>}
          </span>
        ))}
      </span>
    </span>
  );
}

// Phase 4p.plan.14 — Row 2: load · drift · cadence · vert · gct.
// Each chip carries a status color so the user gets a quick read on
// which efficiency dimensions were on-target and which need attention.
// Same flex-wrap pattern as row 1; renders nothing when no chips have
// values (CSV-only imports without form metrics).
function PerfQualityRow({ chips, reserveRightSpace }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
      gap: '4px 12px',
      // Phase 4q.signatures.21 — when the corner-stamp signature is
      // present at the Card level, status row reserves space on its
      // right edge so chips don't run under the badge. Tracks badge size.
      padding: reserveRightSpace ? '3px 84px 4px 12px' : '3px 12px 4px',
      borderTop: '0.5px solid rgba(140,140,140,0.10)',
    }}>
      {chips.map((c, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 3,
          minWidth: 0,
        }}>
          <span style={{
            fontSize: 13, fontWeight: 700,
            color: c.color || T1,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
          }}>{c.value}</span>
          {c.post && (
            <span style={{
              fontSize: 10, fontWeight: 500,
              color: c.color ? c.color : T3,
              letterSpacing: '0.02em',
              opacity: c.color ? 0.85 : 1,
              whiteSpace: 'nowrap',
            }}>{c.post}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// Pre/race-pre body — same 2-column shape but with the older "stat list"
// pattern on both sides (no hero metric). Each side stacks 2-3 entries
// using the size tiers (big/mid/small).
function SplitTopPanel({ left, right }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'auto 1fr',
      columnGap: 14,
      padding: '4px 12px 10px',
      position: 'relative',
      alignItems: 'stretch',
    }}>
      <div style={{ position: 'absolute', top: 8, bottom: 8, left: 'calc(50% - 4px)',
        borderLeft: '1px dotted rgba(140,140,140,0.18)', pointerEvents: 'none' }}/>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, alignSelf: 'center' }}>
        {left.map((l, i) => <Stat key={i} {...l}/>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, paddingLeft: 14, alignSelf: 'center' }}>
        {right.map((l, i) => <Stat key={i} {...l}/>)}
      </div>
    </div>
  );
}

function Stat({ icon, value, valueColor, sub, subColor, tier = 'mid' }) {
  const valueSize = tier === 'big' ? 18 : tier === 'mid' ? 14 : 11;
  const valueWeight = tier === 'big' ? 700 : tier === 'mid' ? 600 : 500;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
        {icon && <span style={{ flexShrink: 0, display: 'inline-flex', alignSelf: 'center' }}>{icon}</span>}
        <span style={{
          fontSize: valueSize, fontWeight: valueWeight,
          color: valueColor || T1,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.05,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{value}</span>
      </div>
      {sub && (
        <span style={{
          fontSize: 9, fontWeight: 500,
          color: subColor || T3,
          letterSpacing: '0.04em',
          marginTop: tier === 'big' ? 1 : 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{sub}</span>
      )}
    </div>
  );
}

// Phase 4q.pre.2 — Two-column hero for the pre-workout state.
// Left: READINESS verdict (color-coded label + sleep/HRV deltas).
// Right: TARGET (dist/time/pace + zone bar showing where you SHOULD be).
// Subtle dotted divider in the middle. This is the visual anchor of the
// tile — what makes it feel like a briefing instead of a chip list.
function PreHeroPanel({ readiness, target, familyColor }) {
  const { label: readyLabel, color: readyColor, sleepHrs, sleepDelta, hrvNow, hrvDelta } = readiness;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 0,
      padding: '4px 12px 10px',
      position: 'relative',
    }}>
      {/* Center divider — dotted, low-opacity */}
      <div style={{
        position: 'absolute', top: 4, bottom: 4,
        left: '50%',
        borderLeft: '1px dotted rgba(140,140,140,0.20)',
        pointerEvents: 'none',
      }}/>

      {/* LEFT — Readiness */}
      <div style={{ paddingRight: 12, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          color: T3, textTransform: 'uppercase',
          marginBottom: 4,
        }}>Readiness</div>
        <div style={{
          fontSize: 17, fontWeight: 700, color: readyColor,
          letterSpacing: '0.04em', lineHeight: 1.05,
          marginBottom: 6,
        }}>{readyLabel}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sleepHrs != null && (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: T2, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: T3, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', minWidth: 38 }}>SLEEP</span>
              <span style={{ fontWeight: 700, color: T1 }}>{sleepHrs}h</span>
              {sleepDelta != null && (
                <span style={{ fontSize: 10, color: sleepDelta >= 0 ? GOOD : sleepDelta >= -0.5 ? WARN : BAD, fontWeight: 600 }}>
                  {sleepDelta >= 0 ? '+' : ''}{sleepDelta.toFixed(1)}
                </span>
              )}
            </span>
          )}
          {hrvNow != null && (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, fontSize: 11, color: T2, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: T3, fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', minWidth: 38 }}>HRV</span>
              <span style={{ fontWeight: 700, color: T1 }}>{hrvNow}</span>
              {hrvDelta != null && (
                <span style={{ fontSize: 10, color: hrvDelta >= 0 ? GOOD : hrvDelta >= -5 ? WARN : BAD, fontWeight: 600 }}>
                  {hrvDelta >= 0 ? '+' : ''}{hrvDelta} bsl
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* RIGHT — Target */}
      <div style={{ paddingLeft: 12, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
          color: T3, textTransform: 'uppercase',
          marginBottom: 4,
        }}>Target</div>
        <div style={{
          fontSize: 17, fontWeight: 700, color: T1,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.05, marginBottom: 2,
        }}>
          {target.distanceMi ? `${target.distanceMi} mi` : (target.minutes ? `${target.minutes} min` : '—')}
          {target.distanceMi && target.minutes && (
            <span style={{ fontSize: 10, color: T3, fontWeight: 500, marginLeft: 5 }}>~{target.minutes}m</span>
          )}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 600,
          color: familyColor,
          fontVariantNumeric: 'tabular-nums',
          marginBottom: 5,
        }}>
          {target.paceTarget ? `${target.paceTarget} /mi` : null}
          {target.paceTarget && target.hr ? ' · ' : null}
          {target.hr ? target.hr.zone : null}
        </div>
        {/* Zone-target bar — same component as post-workout, but here
            it shows where you SHOULD be, not where you were. */}
        <MiniZoneBar zones={target.zoneDist} planType={target.planType}/>
      </div>
    </div>
  );
}

// Streak dots row — Mon..Sun, filled if a run was logged that day.
// Right side carries a contextual line ("4 of your 25-mile week").
function StreakRow({ streak, contextText }) {
  return (
    <div style={{
      padding: '8px 12px 8px',
      borderTop: '0.5px solid rgba(140,140,140,0.10)',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        color: T3, textTransform: 'uppercase',
      }}>Streak</div>
      <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {streak.days.map((d, i) => (
          <span key={i} style={{
            width: 7, height: 7, borderRadius: '50%',
            background: d.filled
              ? GOOD
              : (d.isToday ? 'rgba(255,255,255,0.15)' : 'transparent'),
            border: d.filled
              ? `1px solid ${GOOD}`
              : `1px solid ${d.isToday ? T3 : 'rgba(140,140,140,0.30)'}`,
          }}/>
        ))}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 500, color: T2,
        flex: 1, minWidth: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        textAlign: 'right',
      }}>
        {contextText || `${streak.done} of ${streak.total} this week`}
      </span>
    </div>
  );
}

// Visible tap-to-start affordance at the bottom of the tile. Reads as
// a button so the gesture is discoverable. Tile-level onTap still fires
// (via the wrapping Card) — this just makes the action visible.
function PreCTA({ color }) {
  return (
    <div style={{
      padding: '10px 12px 9px',
      borderTop: '0.5px solid rgba(140,140,140,0.16)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 6,
      fontSize: 11, fontWeight: 700,
      color: color || T1,
      letterSpacing: '0.16em', textTransform: 'uppercase',
    }}>
      <span>Tap to start</span>
      <span style={{ fontSize: 12, lineHeight: 1, marginTop: -1 }}>→</span>
    </div>
  );
}

// Phase 4q.pre.1 — labeled chip row (e.g., PREPARE / LAST 3).
// Used by the pre-workout tile state to mirror the post-workout's
// rhythm of "header label + horizontal chip row" instead of a
// cramped 2-column split.
function PerfRowWithLabel({ header, chips, muted, leadIcon }) {
  return (
    <div style={{
      padding: '8px 12px 8px',
      borderTop: '0.5px solid rgba(140,140,140,0.10)',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
        color: muted ? T4 : T3, textTransform: 'uppercase',
        marginBottom: 4,
      }}>{header}</div>
      <div style={{
        display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
        rowGap: 4, columnGap: 12,
      }}>
        {chips.map((c, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'baseline', gap: 4,
            minWidth: 0,
          }}>
            {c.icon && (
              <span style={{ flexShrink: 0, display: 'inline-flex', alignSelf: 'center' }}>{c.icon}</span>
            )}
            <span style={{
              fontSize: 13, fontWeight: 700,
              color: c.color || T1,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
            }}>{c.value}</span>
            {(c.post || c.sub) && (
              <span style={{
                fontSize: 9, fontWeight: 500,
                color: c.color ? c.color : T3,
                letterSpacing: '0.02em',
                opacity: c.color ? 0.85 : 1,
                whiteSpace: 'nowrap',
              }}>{c.post || c.sub}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

// Phase 4q.post.1 — RecoverySection optionally renders a session
// signature badge stamped at the bottom-RIGHT of the tile (Phase 4q.post.2),
// occupying the natural empty space the chips don't fill. Acts as a
// high-resolution stamp of "what was done" — family icon, family-tinted
// backdrop, soft glow.
function RecoverySection({ chips, headerLabel = 'RECOVER', signature, reserveRightSpace }) {
  return (
    <div style={{
      // Phase 4q.signatures.21 — when corner-stamp signature is at the
      // Card level, reserve space on the right so chips don't run under it.
      padding: reserveRightSpace ? '4px 84px 5px 12px' : '4px 12px 5px',
      borderTop: '0.5px solid rgba(140,140,140,0.16)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
        color: T3, textTransform: 'uppercase',
        marginBottom: 2,
      }}>{headerLabel}</div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          rowGap: 4, columnGap: 10,
          flex: 1, minWidth: 0,
        }}>
          {chips.map((c, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'baseline', gap: 4,
              minWidth: 0,
            }}>
              <span style={{ flexShrink: 0, display: 'inline-flex', alignSelf: 'center' }}>{c.icon}</span>
              <span style={{
                fontSize: 14, fontWeight: 700, color: T1,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1.05,
                whiteSpace: 'nowrap',
              }}>{c.value}</span>
              {c.sub && (
                <span style={{
                  fontSize: 10, fontWeight: 500, color: T3,
                  letterSpacing: '0.02em', whiteSpace: 'nowrap',
                }}>{c.sub}</span>
              )}
            </span>
          ))}
        </div>
        {signature}
      </div>
    </div>
  );
}

// Phase 4q.signatures.2 — Gemini-generated low-poly athlete illustrations
// per session family, served from /public/session-signatures/. Each PNG
// is monochromatic in its family color with internal glow + trailing
// shards, drawn on a transparent background so it overlays the badge
// frame cleanly. HIIT is HIIT.png (caps) — matches the uploaded filename;
// rename to lowercase later for Linux/Android case-sensitivity.
//
// Phase 4q.signatures.4 — appended a cache-bust query string so the
// Capacitor WebView fetches a fresh copy whenever this constant ships;
// bump SIG_VERSION any time we replace an image to force a re-pull.
// Phase 4q.signatures.16 — bumped to v6 after the chroma-key cleaner
// pass that removed the baked-in checkerboard and magenta backdrops
// from each PNG. WebView force-pulls fresh files when this version
// string changes.
// Phase 4r.signatures.25 — extended the lookup table with plan-specific
// keys so different RUN types can carry their own visual signature: a
// relaxed long-stride for easy/long runs, a steady fast cadence for
// tempo, the existing dynamic sprint pose for intervals/speed work,
// and an alpine skier for ski sessions. The resolver in SessionSignature
// tries the planType key first, then falls back to the family key, so
// a missing plan-specific PNG silently defaults to the generic one.
//
// To add a new plan-specific signature: drop the cleaned PNG into
// /public/session-signatures/<key>.png and bump SIG_VERSION to force
// the WebView to re-fetch.
const SIG_VERSION = 'v9';
const SIGNATURE_SRC = {
  // ── Plan-specific (preferred lookup) ──
  easy_run:  `/session-signatures/easy-run.png?${SIG_VERSION}`,
  long_run:  `/session-signatures/easy-run.png?${SIG_VERSION}`,  // shares with easy
  tempo:     `/session-signatures/tempo.png?${SIG_VERSION}`,
  intervals: `/session-signatures/speed.png?${SIG_VERSION}`,
  speed_run: `/session-signatures/speed.png?${SIG_VERSION}`,
  ski:       `/session-signatures/ski.png?${SIG_VERSION}`,
  // ── Family fallback (used when plan-specific isn't on disk) ──
  run:       `/session-signatures/run.png?${SIG_VERSION}`,
  strength:  `/session-signatures/strength.png?${SIG_VERSION}`,
  hiit:      `/session-signatures/hiit.png?${SIG_VERSION}`,
  mobility:  `/session-signatures/mobility.png?${SIG_VERSION}`,
  cross:     `/session-signatures/cross.png?${SIG_VERSION}`,
  race:      `/session-signatures/race.png?${SIG_VERSION}`,
};

// Phase 4q.signatures.3 — session signature badge. When the image renders
// it floats BARE against the tile's dark background (no frame, no
// gradient, no border, no rounded card) — the figure already carries its
// own internal glow and trailing shards, so a frame would compete with
// it and read as "card-within-a-card." A subtle drop-shadow filter
// gives the figure depth without enclosing it. The framed fallback is
// kept only for the icon case (when the image fails to load).
// Phase 4r.signatures.26 — default size dropped 80 → 72 (10% reduction).
// Phone viewport (~390px) made the 80px stamp feel heavy at ~20% of the
// tile width; 72 keeps the figure as a clear identity anchor without
// dominating. Several callers pass an explicit `size` prop and aren't
// affected — only the corner-stamp uses the default.
function SessionSignature({ family, planType, FamilyIcon, color, size = 72 }) {
  // Phase 4r.signatures.25 — try the plan-specific key first (e.g.
  // easy_run, tempo, speed_run, ski), then fall back to the family key.
  // If the plan PNG hasn't been generated/dropped in yet, the img will
  // 404 and onError flips imgFailed → renders the framed FamilyIcon
  // fallback. This lets us ship the lookup wiring before all the
  // new artworks land, without breaking existing tiles.
  const planSrc   = planType && SIGNATURE_SRC[planType];
  const familySrc = family   && SIGNATURE_SRC[family];
  const [planFailed, setPlanFailed] = useState(false);
  const [familyFailed, setFamilyFailed] = useState(false);

  const imgSrc = planSrc && !planFailed ? planSrc
              : familySrc && !familyFailed ? familySrc
              : null;
  const showImg = !!imgSrc;

  const handleError = () => {
    if (planSrc && !planFailed) setPlanFailed(true);
    else if (familySrc && !familyFailed) setFamilyFailed(true);
  };

  if (showImg) {
    return (
      <img
        src={imgSrc}
        alt={planType || family}
        width={size}
        height={size}
        onError={handleError}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: 'block',
        }}
      />
    );
  }

  // Fallback when the image is missing/failed: the framed Phosphor icon
  // we used pre-Gemini, so the tile never breaks visually.
  return (
    <div style={{
      width: size, height: size,
      flexShrink: 0,
      borderRadius: 11,
      border: `0.5px solid ${color}40`,
      background: `linear-gradient(135deg, ${color}28 0%, ${color}06 100%)`,
      boxShadow: `inset 0 0 16px ${color}1a, 0 1px 0 rgba(0,0,0,0.25)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      {FamilyIcon ? <FamilyIcon c={color} s={Math.round(size * 0.6)}/> : null}
    </div>
  );
}
