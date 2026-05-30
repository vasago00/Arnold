// ─── MobileHome: Premium Start Dashboard (Mockup Port) ──────────────────────
// Muted warm palette, glass bottom nav with SVG icons, hero rail with readiness
// ring, sleep insight, co-pilot gauges, weekly/monthly/annual sections, and
// multi-item today's plan with workout-type icons.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Sparkline } from "./Sparkline.jsx";
// STATUS/statusFromPct removed — readiness now computed by trainingStress.js
import { getGoals } from "../core/goals.js";
import { storage } from "../core/storage.js";
import { computeDailyScore, computeRolling7d, computeRolling30d, computeHrTSS } from "../core/trainingStress.js";
import { getEffectiveMaxHR } from "../core/trainingStress.js";
import { buildIntelContext, makePaint } from "../core/intelContext.js";
import { allActivities as getUnifiedActivities } from "../core/dcyMath.js";
import { isRun, isStrength, isMobility, isHIIT, activityKind, iconTypeFor } from "../core/activityClass.js";
import { dcy as dcyToday, dcyWeekly, formatDcy, glyphFor, stateFor } from "../core/dcy.js";
import { todayPlanned, checkTodayCompletion, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import useCronometerToday from "../hooks/useCronometerToday.js";
import { useStorageVersion } from "../hooks/useStorageVersion.js";
import { getTopCoachingPrompts, getPillarSummary, getPromptsByPillar } from "../core/coachingPrompts.js";
// Phase 4r.hygiene.1 — energyBalance imports removed entirely. MobileHome
// has no consumers left (MobileCalibrationStrip's last call was deleted
// in this same phase, getDynamicMacroTarget consumers migrated to
// goalModel in dataspine.4). The functions still exist in
// energyBalance.js and are used by web EdgeIQ + Calendar.
// Phase 4r.dataspine.1 — calorie + protein targets route through goalModel
import { getEffectiveTargets } from "../core/goalModel.js";
// Phase 4r.intel.23 — mobile parity for the intelligence layer.
// MobileEdgeIQ now renders synthesizer cards (multi-hypothesis) and
// MobileHome's HeroRail shows the top hypothesis headline alongside
// the DCY status word when a high-severity conflict fires.
import { computeUserState, synthesizeRecommendations } from "../core/intelligence.js";
// Phase 4r.hygiene.1 — safeCompute wraps the common try/catch→null
// pattern with a console.warn so silent failures (e.g. the
// intelHeadline shape-mismatch bug, POSTMORTEMS.md 2026-05-24)
// surface in DevTools instead of looking identical to "no data fired."
import { safeCompute } from "../core/safeCompute.js";
import { generateInsights } from "../core/insights.js";
import {
  PersonSimpleRun,
  Barbell,
  PersonSimpleTaiChi,
  Lightning,
  Bicycle,
  Moon,
  Timer,
  Pulse,
} from "@phosphor-icons/react";

// ─── Workout-category icons ────────────────────────────────────────────────
// Phosphor duotone icons render the workout category visual. They scale
// crisp at any DPR, match Arnold's polished aesthetic, and tint to the
// per-category accent color. See ICON_CMP in TodaysPlan for the mapping.
import { parseLocalDate } from "../core/dateUtils.js";
import {
  TILE_METRICS,
  DEFAULT_TILE_PREFS,
  normalizeTilePrefs,
  buildTileContext,
  getMetric,
  evaluate,
  STATUS_COLORS,
  STATUS_ICONS,
} from "../core/derive/tileMetrics.js";
import { resolveAllStartTiles } from "../core/derive/autoPromote.js";
import { PlannedWorkoutTile, getPlannedWorkoutState } from "./PlannedWorkoutTile.jsx";
import { CoachComment } from "./CoachComment.jsx";
import { CoachSigil } from "./CoachSigil.jsx";
// Phase 4r.hygiene.1 — InsightsPanel import removed. Its last consumer in
// this file (MobileEdgeIQ) was removed in 4r.intel.24 when the legacy
// stat-gated insight tile was retired in favour of the multi-hypothesis
// synthesizer cards. The InsightsPanel component itself still exists in
// ./InsightsPanel.jsx and is used by web TrainingTab.
import { localDate, ymd } from "../core/time.js";

// ═══════════════════════════════════════════════════════════════════════════════
// useMobileData — SINGLE SOURCE OF TRUTH for the Start screen.
// Reads ALL data directly from storage. Zero dependence on Arnold.jsx props.
// ═══════════════════════════════════════════════════════════════════════════════
function useMobileData() {
  // useStorageVersion bumps whenever the storage layer fires a change event
  // (Cloud Sync apply, manual edit, scheduled task write, etc). Including it
  // in the useMemo deps means tile data refreshes automatically — no more
  // force-close + reopen needed.
  const storageVersion = useStorageVersion();
  return useMemo(() => {
    const G = getGoals();
    const profile = storage.get('profile') || {};
    const now = new Date();
    const today = localDate();
    const d30Cutoff = ymd((() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })());
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // ── Raw storage reads ──
    const hrvData = storage.get('hrv') || [];
    const rawSleep = storage.get('sleep') || [];
    const sleepData = cleanSleepForAveraging(rawSleep);
    const weightData = storage.get('weight') || [];
    const cronometer = storage.get('cronometer') || [];

    // Unified activity universe — single source of truth. See dcyMath.js
    // allActivities() for dedup model (CSV/manual > FIT, HC excluded).
    const activities = getUnifiedActivities();

    // ── This week (Mon→Sun) ──
    const dow = now.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const wkStart = new Date(now); wkStart.setDate(now.getDate() - mondayOffset); wkStart.setHours(0, 0, 0, 0);
    const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 7);
    const inThisWeek = (a) => { if (!a.date) return false; const ad = new Date(a.date + 'T12:00:00'); return ad >= wkStart && ad < wkEnd; };
    const thisWeekActs = activities.filter(inThisWeek);
    // Use canonical activityClass helpers — single source of truth for
    // run/strength/HIIT bucketing across every screen.
    const thisWeekRuns = thisWeekActs.filter(isRun);
    const thisWeekStr  = thisWeekActs.filter(isStrength);
    const twMi = thisWeekRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
    const twHrs = thisWeekActs.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
    const twSessions = thisWeekActs.length;
    const twStrSessions = thisWeekStr.length;

    // ── 30-day activities ──
    const d30Date = new Date(now - 30 * 86400000);
    const recent30 = activities.filter(a => a.date && parseLocalDate(a.date) >= d30Date);
    const recent30Runs = recent30.filter(isRun);
    const recent30Str  = recent30.filter(isStrength);
    const weeks43 = 30 / 7;
    const avg30Mi = (recent30Runs.reduce((s, a) => s + (a.distanceMi || 0), 0) / weeks43).toFixed(1);
    const avg30StrSess = (recent30Str.length / weeks43).toFixed(1);

    // ── Pace (YTD for current value, 30d for avg) ──
    const ytdRuns = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart && isRun(a));
    const parsePace = (raw) => { if (!raw) return null; const [m, s] = raw.split(':').map(Number); return m * 60 + (s || 0); };
    const fmtPace = (secs) => secs ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : '—';
    const allPaces = ytdRuns.map(a => parsePace(a.avgPaceRaw)).filter(Boolean);
    const avgPaceSecs = allPaces.length ? allPaces.reduce((s, v) => s + v, 0) / allPaces.length : null;
    const goalPaceSecs = (() => { const p = profile?.targetRacePace || '9:30'; const [m, s] = p.split(':').map(Number); return m * 60 + (s || 0); })();

    // ── YTD totals (for annual goals) ──
    const ytdActs = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart);
    const totalMi = ytdRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
    const totalSessions = ytdActs.length;

    // ── 8-week history (for trend sparklines) ──
    const weeklyStats = Array.from({ length: 8 }, (_, i) => {
      const ws = new Date(now); ws.setDate(now.getDate() - (7 * (7 - i) + now.getDay())); ws.setHours(0, 0, 0, 0);
      const we = new Date(ws); we.setDate(ws.getDate() + 7);
      const wAll = activities.filter(a => { const d = a.date && parseLocalDate(a.date); return d && d >= ws && d < we; });
      const wRuns = wAll.filter(isRun);
      return { mi: wRuns.reduce((s, a) => s + (a.distanceMi || 0), 0), hrs: wAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600, sessions: wAll.length };
    });

    // ── Sleep ──
    const sortedSleep = [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // Sleep score should reflect last night ONLY. If the most recent row
    // exists but has no score yet (Garmin Worker hasn't pulled it, or
    // Garmin's algorithm is still computing), show null instead of falling
    // back to a 2-3 night old score and lying about "last night".
    const latestSleepScore = (() => {
      const top = sortedSleep[0];
      if (!top) return null;
      const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
      const isRecent = top.date === today || top.date === yesterday;
      if (!isRecent) return null; // most recent row is too old to be "last night"
      if (top.sleepScore == null) return null; // pending
      return Math.min(top.sleepScore, 100);
    })();
    const latestRHR = sortedSleep.find(s => s.restingHR)?.restingHR || null;
    const sleep30 = sortedSleep.filter(v => (v?.date || '') >= d30Cutoff);
    const sleep30Scores = sleep30.map(s => s.sleepScore).filter(v => typeof v === 'number' && !isNaN(v));
    const avg30Sleep = sleep30Scores.length ? (sleep30Scores.reduce((s, v) => s + v, 0) / sleep30Scores.length).toFixed(0) : '—';

    // ── HRV ──
    const sortedHRV = [...hrvData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const latestHRV = sortedHRV.find(h => h.overnightHRV)?.overnightHRV || null;
    const hrv30 = sortedHRV.filter(v => (v?.date || '') >= d30Cutoff && v.overnightHRV);
    const avg30HRV = hrv30.length ? (hrv30.reduce((s, h) => s + h.overnightHRV, 0) / hrv30.length).toFixed(0) : '—';

    // ── Weight ──
    // Body Fat falls through to the most recent row that HAS the field —
    // HC-sourced weight rows lack bodyFatPct (HC doesn't pass it through),
    // so taking sortedW[0] for everything blanks BF whenever HC was last writer.
    const sortedW = [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const currentWeight = sortedW[0]?.weightLbs || null;
    const currentBF = (() => {
      for (const w of sortedW) {
        const v = Number(w?.bodyFatPct);
        if (Number.isFinite(v) && v > 0 && v < 60) return v;
      }
      return null;
    })();
    const w30 = sortedW.filter(v => (v?.date || '') >= d30Cutoff).map(v => v.weightLbs).filter(v => typeof v === 'number');
    const avg30Weight = w30.length ? (w30.reduce((s, v) => s + v, 0) / w30.length).toFixed(1) : '—';

    // ── RMR + VO2Max for the Start screen Core summary ──
    // PHILOSOPHY: Start screen shows TODAY's numbers (live, from scale/watch).
    // Core tab keeps the lab values as the historical anchor with their dates.
    // Mixing year-old lab values with live readings on the same panel is
    // confusing — every metric here should be a fresh, daily-relevant value.
    //
    // RMR — computed via Katch-McArdle (370 + 21.6 × LBM_kg) using the most
    // recent scale weight + body fat. Tracks current body composition rather
    // than freezing at last year's lab value. If no scale data exists, falls
    // back to clinical lab value as a last resort.
    const latestScaleWithBF = sortedW.find(w =>
      typeof w?.weightLbs === 'number' && w.weightLbs > 0 &&
      typeof w?.bodyFatPct === 'number' && w.bodyFatPct > 0 && w.bodyFatPct < 60
    );
    const clinicalTests = (() => {
      try { return storage.get('clinicalTests') || []; } catch { return []; }
    })();
    const latestRmrTest = clinicalTests
      .filter(t => t?.type === 'rmr' && Number(t?.metrics?.rmr) > 500)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const latestRMR = latestScaleWithBF
      ? Math.round(370 + 21.6 * (latestScaleWithBF.weightLbs * 0.4536 * (1 - latestScaleWithBF.bodyFatPct / 100)))
      : (latestRmrTest?.metrics?.rmr || null);

    // VO2Max — priority chain (highest to lowest):
    //   1. Manual override on profile.watchVO2Max (typed by user from their
    //      watch when Garmin's API gates the value, which is the case for
    //      most accounts based on testing)
    //   2. Direct API pull stored in wellness.garminWatchVO2Max (Phase 4g
    //      endpoint — works only on accounts where Garmin exposes it)
    //   3. vO2MaxValue on the latest qualifying activity DTO
    //   4. Lab clinical test as historical anchor / last resort
    const profileObj = (() => {
      try { return storage.get('profile') || {}; } catch { return {}; }
    })();
    const manualWatchVO2 = (() => {
      const v = Number(profileObj?.watchVO2Max);
      return Number.isFinite(v) && v > 0 ? { value: v, date: profileObj?.watchVO2MaxAt ? new Date(profileObj.watchVO2MaxAt).toISOString().slice(0,10) : null } : null;
    })();
    const wellnessAll = (() => {
      try { return storage.get('wellness') || []; } catch { return []; }
    })();
    const watchVO2Direct = (() => {
      const sorted = [...wellnessAll].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const w of sorted) {
        const v = Number(w?.garminWatchVO2Max);
        if (Number.isFinite(v) && v > 0) return { value: Math.round(v * 10) / 10, date: w.date };
      }
      return null;
    })();
    const watchVO2Activity = (() => {
      const acts = activities || [];
      const sorted = [...acts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const a of sorted) {
        const v = a?.vO2MaxValue ?? a?.vo2Max ?? a?.vO2Max;
        if (typeof v === 'number' && v > 0) return { value: Math.round(v * 10) / 10, date: a.date };
      }
      return null;
    })();
    const latestVo2Test = clinicalTests
      .filter(t => t?.type === 'vo2max' && Number(t?.metrics?.vo2max) > 0)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    const latestVO2Max =
      manualWatchVO2?.value ??
      watchVO2Direct?.value ??
      watchVO2Activity?.value ??
      latestVo2Test?.metrics?.vo2max ??
      null;

    // ── Nutrition (today + 30d average) ──
    const todayNut = nutDailyTotals(today);
    const todayProtein = todayNut.protein || 0;
    const todayCalories = todayNut.calories || 0;
    // 30-day: build per-day totals from cronometer + nutritionLog
    const recentNut = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const ds = ymd(d);
      const t = nutDailyTotals(ds);
      if (t.calories > 0 || t.protein > 0) recentNut.push({ date: ds, ...t });
    }
    const avg30Protein = recentNut.length ? (recentNut.reduce((s, n) => s + (n.protein || 0), 0) / recentNut.length).toFixed(0) : '—';

    // ── Next race ──
    const nextRace = (() => { try { const races = JSON.parse(localStorage.getItem('arnold:races') || '[]'); const n2 = new Date(); n2.setHours(0, 0, 0, 0); return races.filter(r => { const d = parseLocalDate(r.date); return d && d >= n2; }).sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date))[0] || null; } catch { return null; } })();

    return {
      G, profile, today, d30Cutoff,
      // This week
      twMi, twHrs, twSessions, twStrSessions,
      // 30d averages
      avg30Mi, avg30StrSess, avg30Sleep, avg30HRV, avg30Weight, avg30Protein,
      // Latest / current values
      latestSleepScore, latestRHR, latestHRV, currentWeight, currentBF,
      latestRMR, latestVO2Max,
      todayProtein, todayCalories,
      // Pace
      avgPaceSecs, goalPaceSecs, fmtPace,
      // YTD / annual
      totalMi, totalSessions, ytdRuns,
      // History arrays (for trends, sparklines)
      weeklyStats, sortedSleep, sortedW, hrvData: sortedHRV, recentNut,
      // Race
      nextRace,
      // Activities for annual timeline
      activities,
    };
  }, [localDate(), storageVersion]); // recompute on day rollover OR any storage write
}

// ─── Muted warm color palette (matches mockup) ─────────────────────────────
const C = {
  blue:   '#6babdf',
  cyan:   '#6fd4e4',
  pink:   '#e088ab',
  amber:  '#e0b45e',
  green:  '#6bcf9a',
  red:    '#df7b7b',
  purple: '#ab9ed4',
  orange: '#e09b5e',
};

const BG       = '#0b0c12';
const CARD_BG  = 'rgba(255,255,255,0.04)';
const BORDER   = 'rgba(255,255,255,0.08)';
const T1       = '#fff';
const T2       = 'rgba(255,255,255,0.88)';
const T3       = 'rgba(255,255,255,0.65)';
const T4       = 'rgba(255,255,255,0.45)';

// ─── NAV_ITEMS: exported for Arnold.jsx ─────────────────────────────────────
// Phase 4r.nav.2 — Calendar promoted to primary nav, Labs demoted to
// More (accessible via the overflow menu). Calendar earns the slot
// because the underlying use case (race scheduling, glance-at-week,
// next-up review) is higher-frequency than lab-panel reference.
export const NAV_ITEMS = [
  { id: 'start',    label: 'Start' },
  { id: 'edgeiq',   label: 'EdgeIQ',   tab: 'weekly' },
  // Phase 4r.narrative.5.fix.24 — Coach tab reverted from mobile nav.
  // The full CoachBeta surface was just the web layout transplanted,
  // which read poorly on a phone. New direction: the Coach is an
  // AMBIENT presence — subtle sigil-branded comments woven into the
  // screens where the leverage is actionable (the CoachLine pattern),
  // not a destination tab. Being designed on web first.
  { id: 'play',     label: 'Play',     tab: 'activity' },
  { id: 'fuel',     label: 'Fuel',     tab: 'nutrition_mobile' },
  // Phase 4r.calendar.24 — Calendar moved before Core (per user
  // request). The nav now reads: training-focused Start/EdgeIQ/Play,
  // then Fuel/Calendar for planning, then Core for body data.
  { id: 'calendar', label: 'Calendar', tab: 'races' },
  { id: 'core',     label: 'Core',     tab: 'clinical' },
  { id: 'more',     label: 'More' },
];

const SWIPE_ORDER = ['start', 'edgeiq', 'play', 'fuel', 'calendar', 'core'];

// ─── Swipe navigation hook ──────────────────────────────────────────────────
// Tracks the touchstart coordinates in useRef so they survive React
// re-renders between touchstart and touchend. Earlier impl used plain
// object literals ({current: 0}) which got recreated on every render —
// any state change mid-gesture (which happens often during scroll/swipe)
// reset the tracker and the swipe was silently lost.
export function useSwipeNav({ onSwipeLeft, onSwipeRight, threshold = 50 } = {}) {
  const startX = useRef(0);
  const startY = useRef(0);
  const isTracking = useRef(false);
  return {
    onTouchStart: (e) => {
      if (e.touches.length !== 1) { isTracking.current = false; return; }
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      isTracking.current = true;
    },
    onTouchEnd: (e) => {
      if (!isTracking.current) return;
      isTracking.current = false;
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      // Horizontal swipe must beat threshold AND clearly out-magnitude vertical
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.3) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
      }
    },
    onTouchCancel: () => { isTracking.current = false; },
  };
}

// ─── SVG Icon Components ────────────────────────────────────────────────────
const Icon = {
  // PSP ✕ cross button — Start/Home
  PspX: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" opacity="0.25" />
      <line x1="8" y1="8" x2="16" y2="16" />
      <line x1="16" y1="8" x2="8" y2="16" />
    </svg>
  ),
  // Gem with electric sparks — EdgeIQ
  GemSpark: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Gem body */}
      <polygon points="12,2 4,9 12,22 20,9" stroke={color} strokeWidth="1.6" fill={color} fillOpacity="0.08" />
      <line x1="4" y1="9" x2="20" y2="9" stroke={color} strokeWidth="1.4" />
      <line x1="12" y1="2" x2="9" y2="9" stroke={color} strokeWidth="1.2" opacity="0.5" />
      <line x1="12" y1="2" x2="15" y2="9" stroke={color} strokeWidth="1.2" opacity="0.5" />
      <line x1="12" y1="22" x2="9" y2="9" stroke={color} strokeWidth="1.2" opacity="0.3" />
      <line x1="12" y1="22" x2="15" y2="9" stroke={color} strokeWidth="1.2" opacity="0.3" />
      {/* Electric sparks */}
      <line x1="1" y1="5" x2="3" y2="7" stroke={color} strokeWidth="1.5" opacity="0.7" />
      <line x1="21" y1="5" x2="23" y2="3" stroke={color} strokeWidth="1.5" opacity="0.7" />
      <line x1="2" y1="14" x2="1" y2="12" stroke={color} strokeWidth="1.2" opacity="0.5" />
    </svg>
  ),
  // Lightning bolt — Play
  Bolt: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  // Vintage gas station pump — Fuel
  GasPump: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {/* Pump body */}
      <rect x="4" y="4" width="11" height="17" rx="1.5" fill={color} fillOpacity="0.06" />
      {/* Base */}
      <rect x="3" y="20" width="13" height="2" rx="0.5" fill={color} fillOpacity="0.15" />
      {/* Display panel */}
      <rect x="6" y="6.5" width="7" height="5" rx="1" strokeWidth="1.2" />
      {/* Display line */}
      <line x1="7.5" y1="9" x2="11.5" y2="9" strokeWidth="0.8" opacity="0.5" />
      {/* Crown / top cap */}
      <rect x="6" y="2.5" width="7" height="2" rx="0.8" strokeWidth="1.2" fill={color} fillOpacity="0.1" />
      {/* Hose arm — extends right from body */}
      <path d="M15 8h2.5a2 2 0 0 1 2 2v4" strokeWidth="1.8" />
      {/* Nozzle */}
      <path d="M19.5 14v3" strokeWidth="2" />
      {/* Nozzle hook */}
      <path d="M18 14h3" strokeWidth="1.4" />
      {/* Drip */}
      <circle cx="19.5" cy="18.5" r="0.7" fill={color} opacity="0.5" />
    </svg>
  ),
  // Heartbeat pulse — Core
  Pulse: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  // Cross pipe fitting — Labs (Option D)
  Pipe: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Vertical pipe */}
      <line x1="12" y1="2" x2="12" y2="22" />
      {/* Horizontal pipe */}
      <line x1="2" y1="12" x2="22" y2="12" />
      {/* Flanges */}
      <line x1="10" y1="2" x2="14" y2="2" strokeWidth="3" />
      <line x1="10" y1="22" x2="14" y2="22" strokeWidth="3" />
      <line x1="2" y1="10" x2="2" y2="14" strokeWidth="3" />
      <line x1="22" y1="10" x2="22" y2="14" strokeWidth="3" />
      {/* Center joint ring */}
      <circle cx="12" cy="12" r="3" strokeWidth="1.5" fill={color} fillOpacity="0.1" />
    </svg>
  ),
  // Phase 4r.nav.2 — Calendar (month grid + binding ring) nav glyph.
  // Drawn in the same outline-stroke style as the other nav icons
  // so the bottom bar reads consistently.
  Calendar: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Binder rings */}
      <line x1="8" y1="2" x2="8" y2="5" />
      <line x1="16" y1="2" x2="16" y2="5" />
      {/* Outer frame */}
      <rect x="3" y="4" width="18" height="17" rx="2" />
      {/* Header separator under the rings */}
      <line x1="3" y1="9" x2="21" y2="9" />
      {/* Two dots marking days in the grid */}
      <circle cx="9" cy="14" r="0.9" fill={color} />
      <circle cx="15" cy="17" r="0.9" fill={color} />
    </svg>
  ),
  // Three dots — More
  Dots: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
    </svg>
  ),
  // ── Icons used inside tiles (not nav) ──
  Moon: ({ color = C.cyan, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  Dumbbell: ({ color = C.purple, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="9" width="4" height="6" rx="1" /><rect x="18" y="9" width="4" height="6" rx="1" />
      <line x1="6" y1="12" x2="18" y2="12" /><line x1="6" y1="10" x2="6" y2="14" /><line x1="18" y1="10" x2="18" y2="14" />
    </svg>
  ),
  // Filled-silhouette runner (Material "directions_run" path) — readable at
  // small sizes (the planner tile renders at 14–18px). Color defaults to
  // C.blue to match the run-tile blue tint already in use.
  Runner: ({ color = C.blue, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <circle cx="13.5" cy="3.5" r="2"/>
      <path d="M9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 0.6-3c1.4 1.6 3.4 2.6 5.6 2.6v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-0.4-0.6-1-1-1.7-1-0.3 0-0.5 0.1-0.8 0.1L6 8.3V13h2V9.6L9.8 8.9z"/>
    </svg>
  ),
  // Bicycle — Cross-train
  Bike: ({ color = C.green, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <line x1="5.5" y1="17.5" x2="11" y2="8.5" />
      <line x1="18.5" y1="17.5" x2="14" y2="8.5" />
      <line x1="11" y1="8.5" x2="14" y2="8.5" />
      <line x1="11" y1="8.5" x2="9" y2="5.5" />
      <line x1="7.5" y1="5.5" x2="10.5" y2="5.5" />
    </svg>
  ),
  // Figure with arms reaching up — Mobility / stretch
  Stretch: ({ color = C.cyan, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="1.8" />
      <line x1="12" y1="6" x2="12" y2="15" />
      <path d="M12 8 L7 3" />
      <path d="M12 8 L17 3" />
      <line x1="12" y1="15" x2="9" y2="21" />
      <line x1="12" y1="15" x2="15" y2="21" />
    </svg>
  ),
  Heart: ({ color = T4, size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  Clock: ({ color = T4, size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Flask: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" /><path d="M10 3v6l-5 8.5a1.5 1.5 0 0 0 1.3 2.25h11.4a1.5 1.5 0 0 0 1.3-2.25L14 9V3" />
      <path d="M8.5 14h7" />
    </svg>
  ),
  TrendUp: ({ color = T4, size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <path d="M2 20L8 14 12 18 22 4" /><polyline points="16 4 22 4 22 10" />
    </svg>
  ),
  // Concentric circles target — Goals
  Target: ({ color = C.purple, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" fill={color} />
    </svg>
  ),
  // Pennant on a pole — Races
  Flag: ({ color = C.amber, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="3" x2="5" y2="22" />
      <path d="M5 4 L18 4 L15 8 L18 12 L5 12" fill={color} fillOpacity="0.18" />
    </svg>
  ),
  // Capsule pill — Stack
  Pill: ({ color = C.green, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="9" width="20" height="6" rx="3" />
      <line x1="12" y1="9" x2="12" y2="15" />
      <rect x="2" y="9" width="10" height="6" rx="3" fill={color} fillOpacity="0.18" />
    </svg>
  ),
  // Cloud silhouette with sync arrows — Cloud Sync
  Cloud: ({ color = C.blue, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18 a4 4 0 0 1 -1 -7.85 a5 5 0 0 1 9.4 -1.5 a4 4 0 0 1 -1.4 7.85 z" fill={color} fillOpacity="0.10" />
      <path d="M9 14 l3 3 3 -3" />
      <line x1="12" y1="11" x2="12" y2="17" />
    </svg>
  ),
  // Head + shoulders — Profile
  User: ({ color = C.cyan, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" fill={color} fillOpacity="0.15" />
      <path d="M4 22 c0 -4.5 4 -7 8 -7 c4 0 8 2.5 8 7" />
    </svg>
  ),
};

// Nav icon map — gamified
const NAV_ICONS = {
  start:    (c) => <Icon.PspX color={c} />,
  edgeiq:   (c) => <Icon.GemSpark color={c} />,
  play:     (c) => <Icon.Bolt color={c} />,
  fuel:     (c) => <Icon.GasPump color={c} />,
  core:     (c) => <Icon.Pulse color={c} />,
  // Phase 4r.nav.2 — Calendar primary, Labs in overflow only.
  calendar: (c) => <Icon.Calendar color={c} />,
  labs:     (c) => <Icon.Pipe color={c} />,
  more:     (c) => <Icon.Dots color={c} />,
};

// Phase 4q.header.1 — tab id → nav id mapping. Arnold.jsx uses internal
// tab ids ('activity', 'nutrition_mobile', etc.) but the nav uses friendly
// ids ('play', 'fuel'). This map lets the page header pull the same icon
// the bottom-nav uses for the active tab.
export const TAB_TO_NAV_ID = {
  weekly:           'edgeiq',
  activity:         'play',
  nutrition_mobile: 'fuel',
  clinical:         'core',
  // Phase 4r.nav.2 — Calendar promoted to primary nav, Labs demoted
  // to overflow. 'races' is the internal tab id (legacy) for the
  // Calendar tab content; the nav label says Calendar.
  races:            'calendar',
  labs:             'more',
  // Drill-downs without their own bottom-nav slot — fall back to "more".
  daily:            'more',
  goals:            'more',
  supplements:      'more',
  settings:         'more',
};

// Phase 4q.header.1 — pretty labels per tab id, used by the unified
// page header. Keep aligned with NAV_ITEMS labels for the primary slots.
export const TAB_LABEL = {
  weekly:           'EdgeIQ',
  activity:         'Play',
  nutrition_mobile: 'Fuel',
  clinical:         'Core',
  labs:             'Labs',
  daily:            'Daily Log',
  races:            'Calendar',
  goals:            'Goals',
  supplements:      'Stack',
  settings:         'Settings',
};

// Phase 4q.header.1 — direct nav-id → Icon component map so the page
// header can pass `size` through (NAV_ICONS only accepts color since
// the bottom nav renders at the default 19 px).
const NAV_TAB_ICON_CMP = {
  start:    Icon.PspX,
  edgeiq:   Icon.GemSpark,
  play:     Icon.Bolt,
  fuel:     Icon.GasPump,
  core:     Icon.Pulse,
  // Phase 4r.nav.2 — Calendar replaces Labs in the primary nav.
  // Labs still exists in the overflow menu and uses Icon.Pipe there.
  calendar: Icon.Calendar,
  labs:     Icon.Pipe,
  more:     Icon.Dots,
};

// Render the bottom-nav icon for a given tab id, tinted in the active
// color and sized for the page header (smaller than the bottom nav's
// 19px so it sits balanced with the title text).
export function NavIconForTab({ tabId, color, size = 16 }) {
  const navId = TAB_TO_NAV_ID[tabId];
  const Cmp = NAV_TAB_ICON_CMP[navId];
  if (!Cmp) return null;
  return <Cmp color={color || C.blue} size={size} />;
}

// Public color export — same as the bottom-nav active blue. Lets Arnold.jsx
// pull the matching color without re-defining it.
export const TAB_ACTIVE_COLOR = C.blue;

// Phase 4q.header.2 — per-tab accent color so each page header reads
// thematically: bolt yellow on Play, pulse red on Core, gem purple on
// EdgeIQ, etc. Used to tint the page-header icon (NOT the bottom-nav
// active state, which stays consistent blue across all tabs).
export const TAB_ACCENT_COLOR = {
  weekly:           C.purple,  // EdgeIQ — gem
  activity:         C.amber,   // Play   — bolt (yellow)
  nutrition_mobile: C.green,   // Fuel   — nutrition theme
  clinical:         C.red,     // Core   — pulse / heart
  labs:             C.cyan,    // Labs   — clinical / pipe
  // Drill-downs without their own primary slot — quieter accent.
  daily:            C.blue,
  races:            C.amber,
  goals:            C.green,
  supplements:      C.purple,
  settings:         T3,
};

// ─── Shared styles ──────────────────────────────────────────────────────────
const card = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  padding: '10px 12px',
  marginBottom: 6,
  position: 'relative',
  overflow: 'hidden',
};

const sectionHeader = {
  fontSize: 10, fontWeight: 700, color: T3,
  textTransform: 'uppercase', letterSpacing: '0.1em',
  marginBottom: 5, marginTop: 6,
  display: 'flex', alignItems: 'center', gap: 6,
};

const shLine = {
  flex: 1, height: 1, background: BORDER,
};

// ─── HEADER ─────────────────────────────────────────────────────────────────
function Header({ greeting, profileName }) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0 8px' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: 'linear-gradient(135deg, rgba(91,155,213,0.15), rgba(94,196,212,0.1))',
            border: '1px solid rgba(91,155,213,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, color: C.blue, fontWeight: 800,
          }}>A</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: T3, letterSpacing: '0.14em' }}>ARNOLD</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T2, marginTop: 3 }}>
          {greeting}, {profileName || 'friend'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {/* Phase 4q.header.6 — date styling unified with the drill-down
            tabs (Play/Fuel/Core/Labs/etc), defined in Arnold.jsx. Both
            now read fontSize 11, weight 500, var(--text-muted), 0.04em
            tracking, marginTop 4. */}
        <div style={{
          fontSize: 11, fontWeight: 500,
          color: 'var(--text-muted)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
          marginTop: 4,
        }}>{date}</div>
      </div>
    </div>
  );
}

// ─── PULL-TO-REFRESH ─────────────────────────────────────────────────────────
// Standard mobile gesture: pull down from the top of the page past a
// threshold to trigger a refresh. Capacitor doesn't ship a built-in
// pull-to-refresh, so this is a touch-event implementation that:
//   • Only activates when scrollY === 0 (the page is scrolled to top)
//   • Tracks finger Y delta with damping so the indicator feels physical
//   • Past the trigger threshold (80 px) commits to refresh on release
//   • Below threshold snaps back to zero
// During refresh the indicator pins to the top showing a spinner, then
// fades when sync completes. The wrapped content slides down with the
// indicator so the gesture feels grounded in the UI rather than detached.
function usePullToRefresh(onRefresh, { threshold = 80, max = 140 } = {}) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const tracking = useRef(false);

  const onTouchStart = (e) => {
    if (refreshing) return;
    if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) {
      tracking.current = false;
      return;
    }
    tracking.current = true;
    startY.current = e.touches[0].clientY;
  };

  const onTouchMove = (e) => {
    if (!tracking.current || refreshing) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) { setPullY(0); return; }
    // Damping: feels natural and prevents over-pull
    const damped = Math.min(max, dy * 0.55);
    setPullY(damped);
    // Block native scroll when we're actively pulling
    if (dy > 4 && e.cancelable) e.preventDefault();
  };

  const onTouchEnd = async () => {
    if (!tracking.current || refreshing) {
      tracking.current = false;
      return;
    }
    tracking.current = false;
    if (pullY >= threshold) {
      setRefreshing(true);
      // Pin the indicator at threshold height while refreshing
      setPullY(threshold);
      try { await onRefresh(); } catch (err) { console.warn('[pull-to-refresh] failed', err); }
      setRefreshing(false);
      setPullY(0);
    } else {
      setPullY(0);
    }
  };

  return { pullY, refreshing, threshold, onTouchStart, onTouchMove, onTouchEnd };
}

function PullToRefreshIndicator({ pullY, refreshing, threshold }) {
  const progress = Math.min(1, pullY / threshold);
  const ready = progress >= 1;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: pullY,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      transition: refreshing ? 'none' : 'height 0.18s ease-out',
      zIndex: 50,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: '50%',
        border: `2px solid ${ready || refreshing ? C.blue : 'rgba(140,150,170,0.35)'}`,
        borderTopColor: refreshing ? 'transparent' : (ready ? C.blue : 'rgba(140,150,170,0.35)'),
        transform: refreshing ? 'none' : `rotate(${progress * 360}deg)`,
        animation: refreshing ? 'arnold-ptr-spin 0.85s linear infinite' : 'none',
        opacity: Math.min(1, progress + (refreshing ? 1 : 0)),
        transition: refreshing ? 'none' : 'transform 0.05s linear, border-color 0.18s',
      }} />
      <style>{`@keyframes arnold-ptr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── HERO RAIL ──────────────────────────────────────────────────────────────
// Shorten race names: strip parentheticals, known suffixes, and cap length
// "RBC Brooklyn Half (Popular® Brooklyn Half)" → "RBC Brooklyn Half"
// "Run as One JP Morgan" → "Run as One"
// ─── Race-name abbreviation table — Phase 4r.narrative.5.fix.14 ────────────
// Maps full city / region names to short forms used in race chips. The
// table is applied ALWAYS (not just when over the max length) so the
// badge reads consistently across surfaces — e.g. "HYROX New York"
// renders as "HYROX NY" on the hero rail AND on the EdgeIQ race tile
// AND in any future surface that uses this helper.
//
// Longer phrases must be tried first so "new york city" → "NYC" wins
// over "new york" → "NY". The sort at the bottom guarantees that
// without the caller having to hand-order the object.
const _RACE_CITY_ABBREVS_RAW = {
  // Multi-word entries first (lookup is case-insensitive)
  'new york city': 'NYC',
  'rio de janeiro': 'Rio',
  'san francisco': 'SF',
  'washington dc': 'DC',
  'los angeles':   'LA',
  'cape town':     'CPT',
  'hong kong':     'HK',
  'las vegas':     'LV',
  'san diego':     'SD',
  'new york':      'NY',
  // Common US cities
  'washington':    'DC',
  'philadelphia':  'PHL',
  'boston':        'BOS',
  'chicago':       'CHI',
  'seattle':       'SEA',
  'portland':      'PDX',
  'detroit':       'DET',
  'phoenix':       'PHX',
  'denver':        'DEN',
  'houston':       'HOU',
  'dallas':        'DAL',
  'atlanta':       'ATL',
  'miami':         'MIA',
  'austin':        'AUS',
  // International majors
  'london':        'LDN',
  'paris':         'PAR',
  'berlin':        'BER',
  'tokyo':         'TYO',
  'amsterdam':     'AMS',
  'barcelona':     'BCN',
  'madrid':        'MAD',
  'munich':        'MUC',
  'frankfurt':     'FRA',
  'rome':          'ROM',
  'dubai':         'DXB',
  'singapore':     'SGP',
  'sydney':        'SYD',
  'toronto':       'TOR',
  'montreal':      'MTL',
  'vancouver':     'YVR',
};
const RACE_CITY_ABBREVS = Object.entries(_RACE_CITY_ABBREVS_RAW)
  .sort((a, b) => b[0].length - a[0].length);

// Adaptive race-name shortener.
//   1. Strip parenthetical suffixes  ("HYROX Berlin (2026)" → "HYROX Berlin")
//   2. Strip common sponsor suffixes (JP Morgan, Chase, Corporate Challenge,
//      "presented by ...")
//   3. ALWAYS apply city abbreviations from the table above. Longer phrases
//      win because the lookup table is sorted by phrase length desc.
//   4. If still over `max`, truncate with ellipsis as a last resort.
//
// `max` is the target length for the FINAL string. Callers tune it per
// surface: hero rail badge passes ~18 (very tight); web race tile passes
// 28; debug surfaces can pass higher.
export function shortRaceName(name, max = 22) {
  if (!name) return 'Race';
  let s = String(name).replace(/\s*\(.*\)\s*$/, '').trim();
  // Sponsor suffix strip
  s = s.replace(/\s+(JP\s*Morgan|Chase|Corporate\s*Challenge|presented\s*by.*)$/i, '').trim();
  // City abbreviation — always applied so the badge is consistent across
  // surfaces (not "HYROX New York" on web + "HYROX NY" on mobile).
  for (const [phrase, abbr] of RACE_CITY_ABBREVS) {
    const re = new RegExp(`\\b${phrase}\\b`, 'gi');
    s = s.replace(re, abbr);
  }
  // Collapse any double spaces introduced by the regexes
  s = s.replace(/\s+/g, ' ').trim();
  // Last-resort ellipsis if still over budget
  if (s.length > max) s = s.slice(0, max - 1).trim() + '…';
  return s;
}

// ─── Debug — Phase 4r.narrative.5.fix.15 ──────────────────────────────────
// Expose shortRaceName + the abbreviation table to the console so you can
// verify the algorithm without seeding a race in storage. Usage:
//
//   window.shortRaceNameDebug('HYROX New York')
//     → { input: 'HYROX New York', output: 'HYROX NY',
//         steps: [{stage: 'strip-parens', after: 'HYROX New York'},
//                 {stage: 'strip-sponsor', after: 'HYROX New York'},
//                 {stage: 'abbrev:new york→NY', after: 'HYROX NY'},
//                 {stage: 'within max', after: 'HYROX NY'}],
//         max: 16, abbrevCount: 30 }
//
//   window.shortRaceNameDebug()
//     → runs the test suite below against a set of canonical race names
//       and prints a table — useful for spot-checking the table after
//       editing _RACE_CITY_ABBREVS_RAW.
if (typeof window !== 'undefined') {
  window.shortRaceNameDebug = function shortRaceNameDebug(name, max = 16) {
    if (name == null) {
      const samples = [
        'HYROX New York',
        'TCS New York City Marathon',
        'Berlin Marathon',
        'London Marathon',
        'HYROX San Francisco',
        'HYROX Los Angeles',
        'HYROX Washington DC',
        'Tokyo Marathon',
        'HYROX Salt Lake City',  // unknown — should ellipsis
        'HYROX Boston (2026)',   // parenthetical stripped
        'NYC Marathon presented by TCS', // sponsor suffix stripped
        'Stockholm Marathon',     // single-word unknown city
      ];
      // eslint-disable-next-line no-console
      console.table(samples.map(s => ({
        input: s, output: shortRaceName(s, max), max,
      })));
      return samples.map(s => ({ input: s, output: shortRaceName(s, max) }));
    }
    // Detailed single-name trace
    const steps = [];
    let s = String(name);
    steps.push({ stage: 'input', after: s });
    s = s.replace(/\s*\(.*\)\s*$/, '').trim();
    steps.push({ stage: 'strip-parens', after: s });
    s = s.replace(/\s+(JP\s*Morgan|Chase|Corporate\s*Challenge|presented\s*by.*)$/i, '').trim();
    steps.push({ stage: 'strip-sponsor', after: s });
    for (const [phrase, abbr] of RACE_CITY_ABBREVS) {
      const re = new RegExp(`\\b${phrase}\\b`, 'gi');
      const before = s;
      s = s.replace(re, abbr);
      if (before !== s) steps.push({ stage: `abbrev:${phrase}→${abbr}`, after: s });
    }
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length > max) {
      s = s.slice(0, max - 1).trim() + '…';
      steps.push({ stage: `truncate@${max}`, after: s });
    } else {
      steps.push({ stage: 'within max', after: s });
    }
    return {
      input: String(name),
      output: s,
      max,
      steps,
      abbrevCount: RACE_CITY_ABBREVS.length,
    };
  };
}

function HeroRail({ score, moonScore, scoreLabel, moonScoreLabel, scoreGlyph, scoreSuffix, statusWord, statusColor, intelHeadline, factors, stats, raceDaysLeft, raceName, raceDate, raceDistance }) {
  // `score` / `moonScore` are 0-100 projections of the signed DCY value, used
  // only for the ring geometry. `scoreLabel` / `moonScoreLabel` hold the
  // signed text ("+7", "−4") shown inside the ring.
  // Main ring (7-day) geometry
  const mainR = 26, mainSW = 4, mainSize = 62;
  const mainCX = mainSize / 2, mainCY = mainSize / 2;
  const mainCirc = 2 * Math.PI * mainR;
  const mainOffset = mainCirc * (1 - Math.min(Math.max(score / 100, 0), 1));

  // Moon ring (30-day) geometry — small satellite orbiting main ring
  const moonR = 10;
  const moonCirc = 2 * Math.PI * moonR;
  const ms = moonScore || 0;
  const moonOffset = moonCirc * (1 - Math.min(Math.max(ms / 100, 0), 1));
  const moonColor = ms >= 70 ? C.green : ms >= 45 ? C.amber : ms > 0 ? C.red : T3;

  // Phase 4r.race.2 — race badge on Start surfaces only within the
  // final 7-day window. The rest of the time we keep the Start clean;
  // race details still live on EdgeIQ / Play.
  const hasRace = raceDaysLeft != null && raceDaysLeft >= 0 && raceDaysLeft <= 7;
  const raceDateStr = raceDate ? new Date(raceDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  // Phase 4r.narrative.5.fix.14 — tighter budget for the hero rail badge.
  // Default max=22 is right for surfaces with more room (web race tile);
  // the hero badge is the most space-constrained, so we ask for 16 chars
  // max. The abbreviation lookup catches most known cities first, so
  // "HYROX New York" → "HYROX NY" (8 chars) regardless of max anyway.
  const shortName = shortRaceName(raceName, 16);

  return (
    <div style={{
      ...card,
      borderRadius: 16,
      padding: '12px 14px 10px',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))',
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${statusColor}33, transparent)`,
      }} />

      {/* Phase 4r.narrative.5.fix.14 — Race badge BACK in the flex row.
          fix.12 had moved it above as its own row; user feedback was that
          it was the wrong call — the badge belongs in the top-right
          corner of the score card as a glanceable taper indicator. The
          REAL fix is making the badge tight enough that it doesn't
          squeeze the narrative column: shortRaceName() now ALWAYS
          abbreviates known cities ("HYROX New York" → "HYROX NY"), and
          the badge typography is tightened slightly. */}

      {/* Rings + Info + Race */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>

        {/* Ring cluster: main 7d ring with moon 30d satellite */}
        <div style={{ position: 'relative', width: 66, height: 66, flexShrink: 0, alignSelf: 'center' }}>
          {/* Main ring (7-day) — centered in container */}
          <svg width="62" height="62" viewBox="0 0 62 62" style={{ position: 'absolute', top: 2, left: 2, transform: 'rotate(-90deg)' }}>
            <circle cx="31" cy="31" r="26" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
            <circle cx="31" cy="31" r="26" fill="none" stroke={statusColor} strokeWidth="4"
              strokeDasharray={mainCirc} strokeDashoffset={mainOffset} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div style={{ position: 'absolute', top: 2, left: 2, width: 62, height: 62, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: T1 }}>{scoreLabel ?? score}</span>
            <span style={{ position: 'absolute', bottom: 10, fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: '0.02em' }}>{scoreGlyph || 'DCY'}</span>
          </div>

          {/* Moon ring (30-day) — small satellite, top-left (10 o'clock) of main ring */}
          <div style={{
            position: 'absolute', top: -3, left: -6, width: 28, height: 28,
            borderRadius: '50%', background: BG,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 26 26" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.5" />
              {ms > 0 && <circle cx="13" cy="13" r="10" fill="none" stroke={moonColor} strokeWidth="2.5"
                strokeDasharray={moonCirc} strokeDashoffset={moonOffset} strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }} />}
            </svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: T1, zIndex: 1 }}>{moonScoreLabel ?? ms}</span>
          </div>
        </div>

        {/* Status — Phase 4r.narrative.5.fix.16: narrative + factor chips
            promoted OUT of this column to a full-width row below (see
            below the closing </div> of the rings row). The middle column
            now carries only the "Daily Score" label + status word, so
            it sizes naturally to the ring height. */}
        <div style={{ flex: 1, alignSelf: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Daily Score{scoreSuffix || ''}</div>
          {/* Phase 4r.narrative.5.fix.17 — status word bumped from 14 → 18.
              It's the headline of the hero rail (the user's at-a-glance read
              for "where am I today?") and was undersized relative to its
              importance, especially with the narrative+chips now sitting
              full-width below it. 18 is on par with the +22 inside the
              score ring and the bottom-stat values, so it reads as a
              proper focal point. */}
          <div style={{ fontSize: 18, fontWeight: 700, color: statusColor, lineHeight: 1.1 }}>{statusWord}</div>
        </div>

        {/* Race countdown — compact pill, top-aligned.
            Phase 4r.narrative.5.fix.14 — back in this row (where it
            belongs), tightened up. shortRaceName(raceName, 14) now
            abbreviates known cities aggressively so "HYROX New York"
            renders as "HYROX NY" (8 chars) rather than the full name
            (14 chars). That alone reclaims enough horizontal space for
            the narrative beside it to wrap cleanly to 2 lines without
            mid-sentence clipping. */}
        {hasRace && (
          <div style={{
            flexShrink: 0, padding: '5px 9px', borderRadius: 10,
            background: 'rgba(224,155,94,0.06)', border: '1px solid rgba(224,155,94,0.12)',
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: -2,
          }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: C.orange, lineHeight: 1 }}>
              {raceDaysLeft}<span style={{ fontSize: 10, fontWeight: 700 }}>d</span>
            </span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#e6e8ec', lineHeight: 1 }}>{shortName}</div>
              <div style={{ fontSize: 7, color: T4, marginTop: 1 }}>{raceDateStr}</div>
            </div>
          </div>
        )}
      </div>

      {/* Phase 4r.narrative.5.fix.16 — Narrative + factor chips promoted to
          full-width rows below the rings/badge row. Previously these
          lived inside the middle status column, which the race badge
          squeezed: the narrative wrapped short and the 4 factor chips
          spilled onto 2 rows. Giving them the FULL card width fixes
          both: 2-line narrative gets ~2× the horizontal budget, and 4
          chips fit comfortably on a single row at ~75 px each. */}
      {intelHeadline && (
        <div style={{
          // Phase 4r.narrative.5.fix.27 — Start coaching headline is now
          // sigil-marked (the Coach's voice) instead of a generic "→".
          // Line-clamp removed so the Coach finishes its sentence.
          display: 'flex', alignItems: 'flex-start', gap: 7,
          marginTop: -2, marginBottom: 7,
        }}>
          <CoachSigil size={14} style={{ marginTop: 2, flexShrink: 0, opacity: 0.95 }} />
          <span style={{
            fontSize: 11, fontWeight: 500, color: T3,
            lineHeight: 1.4, overflowWrap: 'anywhere',
          }}>{intelHeadline}</span>
        </div>
      )}
      {factors?.length > 0 && (
        <div style={{
          display: 'flex', gap: 4, marginBottom: 8,
          // flexWrap: 'wrap' as a safety net for ultra-narrow viewports,
          // but with full card width and 4 chips this should always sit
          // on one line. If you see them wrap, the card padding ballooned
          // or chip widths grew.
          flexWrap: 'wrap',
        }}>
          {factors.map((f, i) => (
            <span key={i} style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', gap: 3,
              whiteSpace: 'nowrap',
              background: f.type === 'warn' ? 'rgba(207,107,107,0.1)' :
                          f.type === 'ok'   ? 'rgba(91,191,138,0.08)' : 'rgba(255,255,255,0.04)',
              color:      f.type === 'warn' ? C.red :
                          f.type === 'ok'   ? C.green : T3,
            }}>
              {f.type === 'warn' ? '✗' : f.type === 'ok' ? '✓' : '—'} {f.label}
            </span>
          ))}
        </div>
      )}

      {/* Bottom stat row */}
      <div style={{ display: 'flex', borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', position: 'relative',
            borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none',
          }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {s.value} <span style={{ fontSize: 10, color: T3 }}>{s.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SLEEP INSIGHT ──────────────────────────────────────────────────────────
// ─── DCY DIAGNOSTICS PANEL ──────────────────────────────────────────────────
// Collapsed by default. Tap the header to expand and see every raw input
// driving today's DCY — useful for sanity-checking Fuel / Recovery readings
// on-device without a debugger. Purely read-only.
export function DcyDetails({ dcyDaily }) {
  const [open, setOpen] = useState(false);
  if (!dcyDaily) return null;

  const { F = 0, G = 0, N = 0, R = 0 } = dcyDaily;
  const src = dcyDaily.sources || {};
  const nut = src.nutritionIntake || {};
  const intake = nut.intake || {};
  const tgt = nut.targets || {};
  const sub = nut.sub || {};
  const hrv = src.hrv;
  const rhr = src.rhr;
  const sleep = src.sleep;
  const contrib = dcyDaily.contributions || {};

  const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : 0);
  const warnIf = (p) => (p < 80 ? C.red : p > 110 ? C.amber : C.green);

  // Row helper keeps the JSX uniform and easy to scan.
  const Row = ({ label, value, hint, color = T1 }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '4px 0', fontSize: 11, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ color: T3 }}>{label}</span>
      <span>
        <span style={{ color, fontWeight: 600 }}>{value}</span>
        {hint && <span style={{ color: T4, fontSize: 10, marginLeft: 6 }}>{hint}</span>}
      </span>
    </div>
  );
  const SectionHead = ({ children }) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: T3, textTransform: 'uppercase',
      letterSpacing: '0.06em', marginTop: 10, marginBottom: 2 }}>{children}</div>
  );

  return (
    <div style={{ ...card, borderRadius: 12, padding: '10px 12px', fontSize: 11 }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T1 }}>DCY Details</span>
          <span style={{ fontSize: 10, color: T3 }}>
            F·N − G·(1.1−R) = {(F * N).toFixed(1)} − {(G * (1.1 - R)).toFixed(1)} = {dcyDaily.dcy?.toFixed?.(1) ?? '—'}
          </span>
        </div>
        <span style={{ fontSize: 14, color: T3 }}>{open ? '▾' : '▸'}</span>
      </div>

      {open && (
        <div>
          <SectionHead>
            Fuel — N {(N * 100).toFixed(0)}%
            {nut.forecastMode === 'partial' && (
              <span
                title={`Today is in progress. N reflects what you've logged so far — it'll rise as you eat. Projected end-of-day total shown below.`}
                style={{
                  marginLeft: 8, fontSize: 11, padding: '1px 6px', borderRadius: 6,
                  background: 'rgba(107,171,223,0.15)', color: C.blue,
                  letterSpacing: '0.04em', fontWeight: 600, textTransform: 'none',
                }}
              >
                In progress
              </span>
            )}
          </SectionHead>
          <Row label="Calories" value={`${intake.calories ?? '—'} / ${tgt.calories ?? '—'}`}
            hint={sub.cal != null ? `${(sub.cal * 100).toFixed(0)}%` : '—'}
            color={sub.cal != null ? warnIf(sub.cal * 100) : T1} />
          <Row label="Protein" value={`${intake.protein ?? '—'} g / ${tgt.protein ?? '—'} g`}
            hint={sub.protein != null ? `${(sub.protein * 100).toFixed(0)}%` : '—'}
            color={sub.protein != null ? warnIf(sub.protein * 100) : T1} />
          <Row label="Hydration" value={`${intake.waterL ?? '—'} / ${tgt.waterL ?? '—'} L`}
            hint={sub.hydro != null ? `${(sub.hydro * 100).toFixed(0)}%` : '—'}
            color={sub.hydro != null ? warnIf(sub.hydro * 100) : T1} />
          {nut.forecastMode === 'partial' && nut.projected && (
            <Row label="Projected finish"
              value={`${nut.projected.calories ?? '—'} kcal · ${nut.projected.protein ?? '—'} g`}
              hint={`${Math.round((nut.forecastElapsed || 0) * 100)}% of day elapsed · ${nut.baselineDays || 0}-day avg`} />
          )}
          <Row label="BMR → TDEE" value={`${nut.bmr ?? '—'} → ${nut.tdee ?? '—'}`}
            hint={`bmr T${nut.bmrTier || '?'} · tdee T${nut.tdeeTier || '?'} · burn ${nut.activityBurn ?? 0} · TEF ${nut.tef ?? 0}`} />

          <SectionHead>Recovery — R {(R * 100).toFixed(0)}%</SectionHead>
          {hrv ? (
            <Row label="HRV" value={`${hrv.acute?.toFixed?.(0) ?? '—'} ms`}
              hint={`vs ${hrv.chronic?.toFixed?.(0) ?? '—'} → ${hrv.delta?.toFixed?.(2) ?? '—'}`}
              color={hrv.delta != null ? warnIf(hrv.delta * 100) : T1} />
          ) : <Row label="HRV" value="—" />}
          {rhr ? (
            <Row label="RHR" value={`${rhr.acute?.toFixed?.(0) ?? '—'} bpm`}
              hint={`vs ${rhr.chronic?.toFixed?.(0) ?? '—'} → ${rhr.delta?.toFixed?.(2) ?? '—'}`}
              color={rhr.delta != null ? warnIf(rhr.delta * 100) : T1} />
          ) : <Row label="RHR" value="—" />}
          {sleep ? (
            <Row label="Sleep" value={`${sleep.score ?? '—'}/100`}
              hint={`${sleep.date} · sub ${sleep.sub?.toFixed?.(2) ?? '—'}${sleep.hasStages ? ' · stages' : ''}`}
              color={sleep.sub != null ? warnIf(sleep.sub * 100) : T1} />
          ) : src.sleepLatest ? (
            <Row label="Sleep (stale)" value={`${src.sleepLatest.score ?? '—'}/100`}
              hint={`${src.sleepLatest.date} · dropped from R`}
              color={C.amber} />
          ) : <Row label="Sleep" value="—" />}

          <SectionHead>Stock</SectionHead>
          <Row label="Fitness (F)" value={F.toFixed(1)} hint="EWMA τ=42d" />
          <Row label="Fatigue (G)" value={G.toFixed(1)}
            hint={`τ=7d · ratio ${F > 0 ? (G / F).toFixed(2) : '—'}`}
            color={F > 0 && G > 1.5 * F ? C.red : T1} />
          <Row label="Stress today" value={(src.stressToday ?? 0).toFixed?.(1) ?? '—'} hint="TRIMP-equivalent" />
          <Row label="F·N (absorb)" value={(contrib.fitness ?? F * N).toFixed(1)} />
          <Row label="G·(1.1−R) (drag)" value={(contrib.fatigue ?? G * (1.1 - R)).toFixed(1)} />
        </div>
      )}
    </div>
  );
}

function SleepInsight({ headline, detail, iconKey = 'Moon', iconColor = C.cyan }) {
  // The icon + tone are parametrized so the same card can surface a DCY
  // limiting-factor advisory (fuel / recovery / overload) OR the sleep
  // fallback, without us forking a second component.
  const Ico = Icon[iconKey] || Icon.Moon;
  return (
    <div style={{ ...card, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: `${iconColor}22`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Ico color={iconColor} size={16} />
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: T1 }}>{headline}</div>
        <div style={{ fontSize: 10, color: T2, marginTop: 1, lineHeight: 1.3 }}>{detail}</div>
      </div>
    </div>
  );
}

// ─── MINI ARC GAUGE ─────────────────────────────────────────────────────────
// Semi-circle gauge using <circle> + strokeDasharray (same technique as SmallDial)
// Both track and fill share the exact same circle geometry — guaranteed alignment.
function MiniArcGauge({ pct, color }) {
  const R = 17, CX = 22, CY = 22, SW = 3.5;
  const halfCirc = Math.PI * R;                   // 180° arc length
  const fullCirc = 2 * Math.PI * R;               // full circumference
  const clamp = Math.max(0, Math.min(pct || 0, 1));
  const fill = halfCirc * clamp;

  return (
    <svg width={44} height={26} viewBox="0 0 44 26" style={{ display: 'block' }}>
      {/* Track: show top 180° of circle, hide bottom 180° */}
      <circle cx={CX} cy={CY} r={R} fill="none"
        stroke="rgba(255,255,255,0.12)" strokeWidth={SW}
        strokeDasharray={`${halfCirc} ${halfCirc}`}
        strokeLinecap="round"
        transform={`rotate(180 ${CX} ${CY})`} />
      {/* Fill: show pct portion of the top 180° */}
      {clamp > 0.005 && (
        <circle cx={CX} cy={CY} r={R} fill="none"
          stroke={color} strokeWidth={SW}
          strokeDasharray={`${fill} ${fullCirc - fill}`}
          strokeLinecap="round"
          transform={`rotate(180 ${CX} ${CY})`} />
      )}
    </svg>
  );
}

// ─── CATEGORY LABEL ─────────────────────────────────────────────────────────
const CAT_ICONS = {
  Run: (color) => (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" strokeWidth="2.5" />
      <path d="M15 6l6 6-6 6" strokeWidth="2.5" />
    </svg>
  ),
  Strength: (color) => (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 17l6-4 6 4" strokeWidth="2.5" />
      <path d="M6 12l6-4 6 4" strokeWidth="2" opacity="0.5" />
      <path d="M6 7l6-4 6 4" strokeWidth="1.8" opacity="0.25" />
    </svg>
  ),
  Recovery: (color) => (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="14" height="9" rx="2" />
      <path d="M18 10.5h1.5a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H18" strokeWidth="2" />
      <path d="M9 11v4" strokeWidth="2.2" />
      <path d="M12 11v4" strokeWidth="2" opacity="0.45" />
    </svg>
  ),
  Body: (color) => (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </svg>
  ),
};

function CategoryLabel({ label, color }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: T2, textTransform: 'uppercase',
      letterSpacing: '0.08em', padding: '3px 0 2px',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      {CAT_ICONS[label]?.(color)}
      {label}
    </div>
  );
}

// ─── METRIC TILE (Today value + semicircle gauge for 30d avg) ────────────────
function MetricTile({ label, todayVal, todayUnit, trendText, trendColor, avg30, avg30Label, gaugePct, color, statusIcon, statusIconColor, onTap, source, autoReasons }) {
  // Status is communicated through a tiny glyph next to the trend line:
  // The top accent stripe also gets stronger when status is set so a glance
  // across a row of tiles surfaces ones that need attention.
  // ── Phase 4o.autopromote.3 — star indicator ──
  // Filled star  ★ = manually pinned by the user (Trend tab star toggle)
  // Hollow star  ☆ = auto-promoted by the scoring system
  // The hollow star carries the top auto-promote reason as a title so the
  // user can long-press / hover to see why the tile bubbled up.
  const isAuto = source === 'auto';
  const reasonText = isAuto && Array.isArray(autoReasons) && autoReasons.length
    ? `Auto-promoted: ${autoReasons.slice(0, 2).join(' · ')}`
    : null;
  return (
    <div onClick={onTap} style={{
      ...card, borderRadius: 14, padding: '8px 10px 6px',
      cursor: onTap ? 'pointer' : 'default',
    }}>
      {/* Top accent — stronger when status color is set, subtler otherwise */}
      <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, borderRadius: '0 0 2px 2px', background: color, opacity: 0.7 }} />

      {/* Source star — top-right corner, very subtle */}
      {source ? (
        <span
          title={reasonText || 'Pinned'}
          aria-label={reasonText || 'Pinned'}
          style={{
            position: 'absolute', top: 5, right: 8,
            fontSize: 10, lineHeight: 1,
            color: isAuto ? T4 : color,
            opacity: isAuto ? 0.55 : 0.85,
            fontWeight: 600,
            pointerEvents: 'none',
          }}
        >
          {isAuto ? '☆' : '★'}
        </span>
      ) : null}

      {/* Label */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color, marginBottom: 4 }}>{label}</div>

      {/* Body: value left, gauge right */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* Left: value + trend */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: T1 }}>{todayVal}</span>
            {todayUnit ? <span style={{ fontSize: 11, color: T3, marginLeft: 2 }}>{todayUnit}</span> : null}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: trendColor || T3, marginTop: 3, height: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{trendText || '\u00A0'}</span>
            {statusIcon ? (
              <span style={{ fontSize: 10, fontWeight: 700, color: statusIconColor || T3, lineHeight: 1 }}>
                {statusIcon}
              </span>
            ) : null}
          </div>
        </div>

        {/* Right: semicircle arc + value below + label */}
        <div style={{ flexShrink: 0, width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <MiniArcGauge pct={gaugePct} color={color} />
          <div style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1, marginTop: 0 }}>{avg30}</div>
          <div style={{ fontSize: 11, color: T4, fontWeight: 600, marginTop: 1, letterSpacing: '0.04em' }}>
            {avg30Label || '30d avg'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── THIS WEEK CARD ─────────────────────────────────────────────────────────
function ThisWeekCard({ headline, miles, sessions, runs, time, weeklyMiPct, weeklyTarget }) {
  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(91,155,213,0.15), transparent)` }} />
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        {headline} <span style={{ fontWeight: 400, color: T3, fontSize: 11 }}>— {sessions} sessions, {miles} mi</span>
      </div>
      <div style={{ display: 'flex', marginBottom: 8 }}>
        {[
          { lbl: 'Run miles', v: miles },
          { lbl: 'Sessions', v: sessions },
          { lbl: 'Time', v: time },
        ].map((col, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{col.lbl}</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{col.v}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(weeklyMiPct * 100, 100)}%`, height: '100%', borderRadius: 2, background: C.blue, opacity: 0.6, transition: 'width 0.6s' }} />
      </div>
      <div style={{ fontSize: 10, color: T4, marginTop: 3 }}>{miles} / {weeklyTarget} mi</div>
    </div>
  );
}

// ─── ANNUAL TIMELINE ────────────────────────────────────────────────────────
// Elegant horizontal year bar with race markers and goal progress
function AnnualTimeline({ races, runMiGoal, runMiActual, workoutsGoal, workoutsActual, totalSessions }) {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const yearEnd = new Date(now.getFullYear(), 11, 31);
  const yearProgress = (now - yearStart) / (yearEnd - yearStart);
  const months = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  // Parse races into markers with positions — deduplicate by date, truncate names, fix UTC
  const seen = new Set();
  const raceMarkers = (races || [])
    .filter(r => {
      if (!r.date) return false;
      const d = new Date(r.date + 'T12:00:00');
      if (d.getFullYear() !== now.getFullYear()) return false;
      const key = r.date;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(r => {
      const d = new Date(r.date + 'T12:00:00');
      const pct = (d - yearStart) / (yearEnd - yearStart);
      const isPast = d < now;
      return { name: shortRaceName(r.name), date: d, pct: Math.max(0, Math.min(1, pct)), isPast, distMi: r.distanceMi };
    })
    .sort((a, b) => a.pct - b.pct);

  const runPct = runMiGoal > 0 ? Math.min(runMiActual / runMiGoal, 1) : 0;
  const wkPct = workoutsGoal > 0 ? Math.min(workoutsActual / workoutsGoal, 1) : 0;

  return (
    <div style={{ ...card, borderRadius: 14, padding: '10px 12px 10px' }}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(212,139,78,0.15), transparent)` }} />

      {/* Year label */}
      <div style={{ fontSize: 10, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{now.getFullYear()} Timeline</div>

      {/* Month markers */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2, padding: '0 1px' }}>
        {months.map((m, i) => (
          <span key={i} style={{ fontSize: 7, color: i === now.getMonth() ? T1 : T4, fontWeight: i === now.getMonth() ? 700 : 400 }}>{m}</span>
        ))}
      </div>

      {/* Timeline bar with markers */}
      <div style={{ position: 'relative', height: 20, marginBottom: 4 }}>
        {/* Track */}
        <div style={{ position: 'absolute', top: 8, left: 0, right: 0, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)' }} />
        {/* Progress fill */}
        <div style={{ position: 'absolute', top: 8, left: 0, width: `${yearProgress * 100}%`, height: 4, borderRadius: 2, background: `linear-gradient(90deg, ${C.blue}, ${C.cyan})`, opacity: 0.7 }} />
        {/* Today marker */}
        <div style={{ position: 'absolute', top: 4, left: `${yearProgress * 100}%`, width: 2, height: 12, borderRadius: 1, background: T1, transform: 'translateX(-1px)' }} />

        {/* Race marker dots */}
        {raceMarkers.map((r, i) => (
          <div key={i} style={{
            position: 'absolute', top: -1, left: `${r.pct * 100}%`, transform: 'translateX(-6px)',
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: 6,
              background: r.isPast ? 'rgba(91,191,138,0.15)' : 'rgba(212,139,78,0.15)',
              border: `1.5px solid ${r.isPast ? C.green : C.orange}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 8 }}>{r.isPast ? '✓' : '⚑'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Race dates positioned under their markers */}
      {raceMarkers.length > 0 && (
        <div style={{ position: 'relative', height: 14, marginBottom: 8 }}>
          {raceMarkers.map((r, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${r.pct * 100}%`, transform: 'translateX(-50%)',
              fontSize: 8, fontWeight: 500, color: r.isPast ? C.green : C.orange, whiteSpace: 'nowrap',
            }}>
              {r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          ))}
        </div>
      )}

      {/* Goal progress bars */}
      <div style={{ display: 'flex', gap: 10 }}>
        {/* Running goal */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 7, fontWeight: 600, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Run Miles</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: T2 }}>{runMiActual} <span style={{ fontSize: 7, color: T4 }}>/ {runMiGoal}</span></span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
            <div style={{ width: `${runPct * 100}%`, height: '100%', borderRadius: 2, background: C.blue, opacity: 0.7 }} />
          </div>
        </div>
        {/* Workouts goal */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 7, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Workouts</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: T2 }}>{workoutsActual} <span style={{ fontSize: 7, color: T4 }}>/ {workoutsGoal}</span></span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
            <div style={{ width: `${wkPct * 100}%`, height: '100%', borderRadius: 2, background: C.purple, opacity: 0.7 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CORE SUMMARY (Body · Recovery · Vitals from DEXA/VO2/RMR) ─────────────
function CoreSummary({ hrv, rhr, weight, bodyFat, rmr, vo2max, onTap }) {
  const items = [
    { label: 'Weight',   value: weight || '—',  unit: 'lb',    color: C.amber },
    { label: 'Body Fat', value: bodyFat || '—', unit: '%',     color: C.red },
    { label: 'RMR',      value: rmr || '—',     unit: 'kcal',  color: C.orange },
    { label: 'HRV',      value: hrv || '—',     unit: 'ms',    color: C.green },
    { label: 'RHR',      value: rhr || '—',     unit: 'bpm',   color: C.purple },
    { label: 'VO2max',   value: vo2max || '—',  unit: 'mL/kg', color: C.cyan },
  ];
  return (
    <div onClick={onTap} style={{ ...card, borderRadius: 14, padding: '10px 12px', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(107,207,154,0.15), transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon.Pulse color={C.green} size={12} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Body · Recovery · Vitals</span>
        </div>
        <span style={{ fontSize: 10, color: T3 }}>→</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, rowGap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: it.color, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{it.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{it.value}</div>
            <div style={{ fontSize: 10, color: T3, marginTop: 1 }}>{it.unit}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LABS SUMMARY ───────────────────────────────────────────────────────────
// Latest blood panel highlights
function LabsSummary({ labSnapshots, onTap }) {
  const latest = (() => {
    try {
      const snaps = [...(labSnapshots || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return snaps[0] || null;
    } catch { return null; }
  })();

  const markers = latest?.markers || {};
  // Find a marker value by partial key match (handles long-form keys like "Testosterone (ng/dL)")
  const findMarker = (shortKey) => {
    const lk = shortKey.toLowerCase();
    const found = Object.keys(markers).find(k => k.toLowerCase().includes(lk));
    return found != null ? markers[found] : undefined;
  };
  // Pick key markers to show
  const keyMarkers = [
    { key: 'testosterone', label: 'Testo', unit: 'ng/dL', color: C.blue },
    { key: 'vitamin d', label: 'Vit D', unit: 'ng/mL', color: C.amber },
    { key: 'hscrp', label: 'hsCRP', unit: 'mg/L', color: C.red },
    { key: 'ferritin', label: 'Ferritin', unit: 'ng/mL', color: C.green },
    { key: 'hba1c', label: 'A1c', unit: '%', color: C.pink },
    { key: 'tsh', label: 'TSH', unit: 'mU/L', color: C.purple },
  ].map(m => ({ ...m, value: findMarker(m.key) })).filter(m => m.value != null);

  const dateStr = latest?.date ? new Date(latest.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';

  return (
    <div onClick={onTap} style={{ ...card, borderRadius: 14, padding: '10px 12px', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(155,142,196,0.12), transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon.Flask color={C.purple} size={12} />
          <span style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Labs{dateStr ? ` · ${dateStr}` : ''}</span>
        </div>
        <span style={{ fontSize: 10, color: T3 }}>→</span>
      </div>
      {keyMarkers.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(keyMarkers.length, 3)}, 1fr)`, gap: 4 }}>
          {keyMarkers.slice(0, 6).map((m, i) => (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 7, color: m.color, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{typeof m.value === 'number' ? m.value.toFixed(m.value < 10 ? 1 : 0) : m.value}</div>
              <div style={{ fontSize: 7, color: T4, marginTop: 1 }}>{m.unit}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 10, color: T3, textAlign: 'center', padding: '6px 0' }}>No lab data yet — tap to add</div>
      )}
    </div>
  );
}

// ─── TODAY'S PLAN (with completion state merged in) ─────────────────────────
// Combines what was previously two stacked cards (Today's Plan + Today's
// Activity). Each planned row matches against the day's completed activities
// by iconType (strength↔strength, run↔run). When matched: row gets a green
// outline, a green check, and the activity's summary metrics inline. Any
// unmatched completed activities (something done that wasn't planned) render
// as additional rows with "(unplanned)" label.
function TodaysPlan({ items, doneItems = [], onTap }) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // Greedy match: for each plan row, claim the first done item whose iconType
  // matches. Walk the items and consume from a copy of doneItems.
  const remaining = [...doneItems];
  const enriched = items.map(p => {
    const idx = remaining.findIndex(d => d.iconType === p.iconType);
    if (idx >= 0) {
      const matched = remaining.splice(idx, 1)[0];
      return { ...p, completed: true, doneSummary: matched.summary };
    }
    return { ...p, completed: false };
  });
  // Anything left in `remaining` is something the user did that wasn't planned.
  const unplanned = remaining.map(d => ({
    iconType: d.iconType,
    title: `${d.kind}`,
    detail: d.summary,
    completed: true,
    unplanned: true,
  }));
  const allRows = [...enriched, ...unplanned];

  const completedCount = enriched.filter(r => r.completed).length + unplanned.length;
  const headerChip = unplanned.length
    ? `${completedCount} done · ${items.length} planned`
    : items.length
      ? `${completedCount}/${items.length} done`
      : 'No plan';

  const ICON_BG = {
    run:      'rgba(107,171,223,0.12)',
    strength: 'rgba(155,142,196,0.12)',
    bolt:     'rgba(224,180,94,0.14)',
    bike:     'rgba(107,207,154,0.12)',
    stretch:  'rgba(111,212,228,0.12)',
    moon:     'rgba(111,212,228,0.10)',
    clock:    'rgba(107,171,223,0.12)',
    pulse:    'rgba(248,113,113,0.12)',
  };
  // Phosphor duotone icon set, tinted per-category. Two-tone weight matches
  // Arnold's polished glass aesthetic — fill is the accent color, stroke
  // (the darker tone) renders automatically. Size 22 sits comfortably inside
  // the 36px rounded square.
  const PH = { weight: 'duotone', size: 22 };
  const ICON_CMP = {
    run:      <PersonSimpleRun     {...PH} color={C.blue} />,
    strength: <Barbell             {...PH} color={C.purple} />,
    bolt:     <Lightning           {...PH} color={C.amber} />,
    bike:     <Bicycle             {...PH} color={C.green} />,
    stretch:  <PersonSimpleTaiChi  {...PH} color={C.cyan} />,
    moon:     <Moon                {...PH} color={C.cyan} />,
    clock:    <Timer               {...PH} color={C.blue} />,
    pulse:    <Pulse               {...PH} color="#f87171" />,
  };
  const renderIcon = (iconType) => ICON_CMP[iconType] || ICON_CMP.run;

  // Done-state colors. Green border + slight green tint background when complete.
  const DONE_BORDER = '1px solid rgba(74,222,128,0.55)';
  const DONE_BG     = 'rgba(74,222,128,0.06)';
  const TODO_BORDER = '1px solid rgba(255,255,255,0.03)';
  const TODO_BG     = 'rgba(255,255,255,0.015)';

  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(155,142,196,0.15), transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{date}</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
          background: completedCount > 0 ? 'rgba(74,222,128,0.10)' : 'rgba(155,142,196,0.08)',
          color: completedCount > 0 ? '#4ade80' : C.purple,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{headerChip}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {allRows.map((item, i) => (
          <div key={i} onClick={() => onTap?.(item)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10,
            background: item.completed ? DONE_BG : TODO_BG,
            border:     item.completed ? DONE_BORDER : TODO_BORDER,
            cursor: 'pointer',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: ICON_BG[item.iconType] || ICON_BG.run,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {renderIcon(item.iconType)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                {item.completed && (
                  <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 800, lineHeight: 1 }}>✓</span>
                )}
                <span>{item.title}</span>
                {item.unplanned && (
                  <span style={{ fontSize: 11, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>· unplanned</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: T3, marginTop: 1 }}>
                {/* When completed, the doneSummary (e.g. "3.2 mi · 28 min") replaces the
                    plan detail so the user sees what actually happened, not what was
                    targeted. The plan detail is still implicit from the title. */}
                {item.completed && item.doneSummary ? item.doneSummary : item.detail}
              </div>
            </div>
            {!item.completed && item.time && (
              <div style={{ fontSize: 10, color: T4, fontWeight: 600 }}>{item.time}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MORE MENU ──────────────────────────────────────────────────────────────
function MoreMenu({ onClose, onMenuTap }) {
  // Mobile More menu intentionally lean: only items needed in daily use.
  // Profile / Goals / Races / Stack edits are once-a-month tasks and live
  // on the desktop view where the bigger screen suits long-form forms.
  // Underlying data still drives DCY/intake/etc. — this only hides the
  // edit UI on mobile.
  const items = [
    { id: 'sync', label: 'Cloud Sync', desc: 'Pair devices, Health Connect, Cronometer', Icon: Icon.Cloud, color: C.blue, tint: 'rgba(107,171,223,0.10)' },
  ];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        zIndex: 40, display: 'flex', alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          background: 'rgba(20,22,30,0.97)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderRadius: '20px 20px 0 0',
          borderTop: `1px solid ${BORDER}`,
          borderLeft: `1px solid ${BORDER}`,
          borderRight: `1px solid ${BORDER}`,
          padding: '14px 14px 28px',
          fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.18)', borderRadius: 2, margin: '0 auto 12px' }} />

        {/* Section header — matches sectionHeader style used elsewhere */}
        <div style={{
          fontSize: 10, fontWeight: 700, color: T3,
          textTransform: 'uppercase', letterSpacing: '0.1em',
          marginBottom: 10, paddingLeft: 4,
        }}>
          More
        </div>

        {items.map(item => {
          const ItemIcon = item.Icon;
          return (
            <div
              key={item.id}
              onClick={() => { onMenuTap(item.id); onClose(); }}
              style={{
                ...card,
                marginBottom: 8,
                padding: '14px 14px',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer',
                transition: 'background 0.15s ease',
              }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: item.tint,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <ItemIcon color={item.color} size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T1, lineHeight: 1.15 }}>
                  {item.label}
                </div>
                <div style={{ fontSize: 11, color: T3, marginTop: 2, lineHeight: 1.3 }}>
                  {item.desc}
                </div>
              </div>
              <div style={{ fontSize: 18, color: T4, fontWeight: 300 }}>›</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BOTTOM NAV — PREMIUM GLASS WITH SVG ICONS ─────────────────────────────
export function BottomNavBar({ activeNav, onNavTap }) {
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
      background: 'linear-gradient(180deg, rgba(16,17,26,0.92), rgba(10,11,16,0.98))',
      backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      borderTop: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', justifyContent: 'space-around', alignItems: 'stretch',
      padding: '0 2px', height: 68,
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 40, right: 40, height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(91,155,213,0.12), rgba(94,196,212,0.08), transparent)',
      }} />

      {NAV_ITEMS.map(item => {
        const isActive = activeNav === item.id;
        const iconColor = isActive ? C.blue : T4;
        return (
          <div key={item.id} onClick={() => onNavTap(item.id)} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, padding: '8px 0 6px', minWidth: 50, flex: 1, cursor: 'pointer', position: 'relative',
          }}>
            {/* Active top indicator */}
            {isActive && (
              <div style={{
                position: 'absolute', top: 0, width: 20, height: 2, borderRadius: '0 0 2px 2px',
                background: C.blue,
              }} />
            )}

            {/* Icon wrap */}
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: isActive ? 'rgba(91,155,213,0.12)' : 'transparent',
              animation: isActive ? 'navGlowPulse 2.4s ease-in-out infinite' : 'none',
              transition: 'all 0.2s',
            }}>
              {NAV_ICONS[item.id]?.(iconColor)}
            </div>

            {/* Label — 10px (was 8px) for legibility per WCAG floor */}
            <span style={{
              fontSize: 10, fontWeight: isActive ? 700 : 500,
              color: isActive ? C.blue : T4,
              letterSpacing: '0.02em', transition: 'color 0.2s',
            }}>
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Utility ────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : [91,155,213];
}

// Phase 4r.hygiene.1 — MobileCalibrationStrip removed. The function was
// last rendered at the top of MobileEdgeIQ; that render was deleted in
// 4r.intel.24 because the "BEHIND +X.X lb drift" signal duplicated what
// the primary intelligence tile + WEIGHT cockpit cell already showed.
// The function itself sat as dead code with no remaining callers until
// this hygiene pass. The calibration logic (assessCalibration /
// recommendCalorieTarget) still lives in energyBalance.js and is used by
// web EdgeIQ + Calendar — only the mobile strip is gone.

// ─── Today's energy target line (above coaching prompts) ───────────────────
// Shows the activity-adjusted calorie + macro target. Updates as the user
// logs activity throughout the day.
function MobileTodaysTarget() {
  const storageVersion = useStorageVersion();
  // Phase 4r.dataspine.4 — all fields sourced from getEffectiveTargets.
  // baseline = derived MINUS the eat-back component (today's target
  // before activity-credit). isTrainingDay = eat-back > 0. Macros
  // (protein/carbs/fat/fiber) come from the new macro fields
  // (deriveDailyMacros). Legacy getDynamicMacroTarget shim removed.
  const dyn = useMemo(() => {
    try {
      const eff = getEffectiveTargets();
      if (!eff?.dailyCalories?.effective) return { dynamicTarget: null };
      const calExplain = eff.dailyCalories.explain || {};
      const eatBack = calExplain.components?.eatBack || 0;
      const dynamicTarget = eff.dailyCalories.effective;
      return {
        dynamicTarget,
        baseline:     dynamicTarget - eatBack,
        eatBackKcal:  eatBack,
        isTrainingDay: eatBack > 0,
        proteinG:     eff.dailyProtein?.effective || 0,
        carbsG:       eff.dailyCarbs?.effective   || 0,
        fatG:         eff.dailyFat?.effective     || 0,
        fiberG:       eff.dailyFiber?.effective   || 0,
      };
    } catch { return { dynamicTarget: null }; }
  }, [storageVersion]);
  if (!dyn.dynamicTarget) return null;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 10,
      background: 'rgba(155,142,196,0.08)',
      border: '1px solid rgba(155,142,196,0.18)',
      marginBottom: 8,
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Today's Target {dyn.isTrainingDay && <span style={{ color: '#e0b45e' }}>· training day</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{dyn.dynamicTarget}</span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>kcal</span>
        {dyn.isTrainingDay && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
            ({dyn.baseline} baseline + {dyn.eatBackKcal} earned)
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span><strong style={{ color: '#9b8ec4', fontWeight: 700 }}>{dyn.proteinG}g</strong> protein</span>
        <span><strong style={{ color: '#6bcf9a', fontWeight: 700 }}>{dyn.carbsG}g</strong> carbs</span>
        <span><strong style={{ color: '#e0b45e', fontWeight: 700 }}>{dyn.fatG}g</strong> fat</span>
        <span><strong style={{ color: '#6fd4e4', fontWeight: 700 }}>{dyn.fiberG}g</strong> fiber</span>
      </div>
    </div>
  );
}

// ─── Coaching Hero Card (single-headline, sits in the hero rail) ──────────
// One focus for the day. The highest-severity coaching prompt across every
// pillar becomes the headline; everything else lives on EdgeIQ / Fuel / Play.
function CoachingHeroCard() {
  const storageVersion = useStorageVersion();
  const top = useMemo(() => getTopCoachingPrompts(1)[0], [storageVersion]);

  const colorFor = sev =>
    sev === 'critical' ? '#f87171' :
    sev === 'warning'  ? '#fbbf24' :
    sev === 'positive' ? '#4ade80' :
                         '#60a5fa';
  const iconFor = pillar =>
    pillar === 'nutrition'   ? '🍽' :
    pillar === 'recovery'    ? '☾' :
    pillar === 'run'         ? '↗' :
    pillar === 'body'        ? '◎' :
    pillar === 'calibration' ? '⚙' : '•';
  const pillarLabelFor = pillar =>
    pillar === 'nutrition'   ? 'NUTRITION' :
    pillar === 'recovery'    ? 'RECOVERY' :
    pillar === 'run'         ? 'TRAINING' :
    pillar === 'body'        ? 'BODY' :
    pillar === 'calibration' ? 'CALIBRATION' : 'FOCUS';

  // No prompts firing → a clean, positive headline
  if (!top) {
    return (
      <div style={{ ...card, borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, background: 'rgba(74,222,128,0.14)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          fontSize: 13, color: C.green, fontWeight: 700,
        }}>✓</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>All systems clean</div>
          <div style={{ fontSize: 10, color: T3, marginTop: 1, lineHeight: 1.3 }}>
            Training, nutrition, and recovery all in line. Stay consistent with logging.
          </div>
        </div>
      </div>
    );
  }

  const c = colorFor(top.severity);
  return (
    <div style={{ ...card, borderRadius: 12, padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: `${c}1f`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        fontSize: 14,
      }}>{iconFor(top.pillar)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T3, letterSpacing: '0.07em' }}>
            FOCUS · {pillarLabelFor(top.pillar)}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: c, lineHeight: 1.25 }}>{top.title}</div>
        <div style={{ fontSize: 10, color: T2, marginTop: 2, lineHeight: 1.3 }}>{top.detail}</div>
      </div>
    </div>
  );
}

// ─── Lower coaching strip (kept for "scroll for more") ────────────────────
// Shows the 2nd and 3rd prompts in fuller detail under Today's Plan.
// Silent when there are 0 or 1 prompts (since the hero card already shows #1).
function MobileCoachingStrip() {
  const storageVersion = useStorageVersion();
  const prompts = useMemo(() => getTopCoachingPrompts(3), [storageVersion]);
  if (prompts.length <= 1) return null;
  const remaining = prompts.slice(1);
  const colorFor = sev =>
    sev === 'critical' ? '#f87171' :
    sev === 'warning'  ? '#fbbf24' :
    sev === 'positive' ? '#4ade80' :
                         '#60a5fa';
  const iconFor = pillar =>
    pillar === 'nutrition' ? '🍽' :
    pillar === 'recovery'  ? '☾' :
    pillar === 'run'       ? '↗' :
    pillar === 'body'      ? '◎' : '•';
  return (
    <>
      <div style={sectionHeader}>More Focus <div style={shLine} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {remaining.map(p => {
          const c = colorFor(p.severity);
          return (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 12px', borderRadius: 10,
              background: 'rgba(255,255,255,0.03)',
              borderLeft: `3px solid ${c}`,
            }}>
              <div style={{ fontSize: 14, opacity: 0.75, marginTop: 1, minWidth: 14, textAlign: 'center' }}>{iconFor(p.pillar)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: c, marginBottom: 3 }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: 1.4 }}>{p.detail}</div>
              </div>
              {p.action?.label && (
                <div style={{ fontSize: 11, fontWeight: 700, color: c, opacity: 0.85, whiteSpace: 'nowrap', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {p.action.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── ERROR BOUNDARY WRAPPER ─────────────────────────────────────────────────
function MobileHomeInner({ data, onOpenTab, initialView }) {
  // ── ALL data from single hook — no Arnold.jsx prop dependencies ──
  const D = useMobileData();
  // Subscribe to storage version so tile-pin toggles from Trend (which
  // mutate `startTilePrefs`) propagate here without a manual reload —
  // Phase 4o.mobile.8 fix. The earlier setup memoized tilePrefs against
  // a fresh `storage.get(...)` ref each render, but with no parent
  // signal the parent never re-rendered, so the memo was never
  // recomputed when the Trend toggle wrote new prefs.
  const storageVersion = useStorageVersion();
  const [activeNav, setActiveNav] = useState(initialView || 'start');
  const [moreOpen, setMoreOpen] = useState(false);

  // ── Live Cronometer pull (intra-day nutrition) ──────────────────────────
  // Mounting this side-effect hook high up keeps today's Cronometer totals
  // fresh for fuelAdequacy() / DCY without any downstream wiring. The hook
  // stays inert until the user configures both a Cloud Sync Worker endpoint
  // and their Cronometer email+password in the Cloud Sync panel (Phase 3).
  const crono = useCronometerToday();
  useEffect(() => {
    if (crono.data?.fetchedAt) {
      // New data landed — tell React to recompute DCY-dependent memos.
      // `today` is the canonical "something fresh happened" trigger already
      // used by dcyDaily / dcyWeek memos below, so we bump nothing explicit;
      // instead, the hook's state change is enough to retrigger a render
      // and the nutritionLog read inside dailyTotals() picks up the new row.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crono.data?.fetchedAt]);

  useEffect(() => {
    if (initialView && initialView !== activeNav) setActiveNav(initialView);
  }, [initialView]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const profileName = (() => {
    try {
      // 1. Check dedicated profile key in storage
      const stored = (storage.get('profile') || {}).name;
      if (stored) return stored;
      // 2. Check data.profile (from Arnold.jsx main data blob)
      if (data?.profile?.name) return data.profile.name;
      // 3. Check arnold:data blob directly from storage
      try {
        const raw = localStorage.getItem('arnold:data');
        if (raw) { const d = JSON.parse(raw); if (d?.profile?.name) return d.profile.name; }
      } catch {}
      return 'Emil';
    } catch { return 'Emil'; }
  })();

  // ── Destructure everything from the single data hook ──
  const {
    G, today, twMi, twHrs, twSessions, twStrSessions,
    avg30Mi, avg30StrSess: avg30StrSessions, avg30Sleep, avg30HRV, avg30Weight, avg30Protein,
    latestSleepScore, latestRHR, latestHRV, currentWeight, currentBF,
    latestRMR, latestVO2Max,
    todayProtein, avgPaceSecs, goalPaceSecs, fmtPace,
    totalMi, totalSessions, weeklyStats, sortedSleep, sortedW,
    hrvData, recentNut, nextRace, activities: unifiedActivities,
  } = D;

  const paceStr = fmtPace(avgPaceSecs);

  // ── DCY readiness (Big Moon = today, Small Moon = week mean) ────────────
  // Reads F/G/N/R and composes F·N − G·(1.1 − R). See core/dcy.js.
  // Legacy computeRolling7d is still called to keep `todayResult.sessionMetric`
  // (feeds the scoreSuffix) flowing — pure display garnish, no effect on DCY.
  const dcyDaily = useMemo(() => {
    try { return dcyToday(); } catch (e) { console.warn('dcy() failed:', e); return null; }
  }, [today]);
  const dcyWeek = useMemo(() => {
    try { return dcyWeekly(); } catch (e) { console.warn('dcyWeekly() failed:', e); return null; }
  }, [today]);
  const rolling7 = useMemo(() => {
    try { return computeRolling7d(); } catch { return { todayScore: {} }; }
  }, [today]);

  // Signed DCY values → displayed as "+7" / "−4" on the rings.
  const dcyValue = dcyDaily?.dcy ?? 0;
  const dcyWeekValue = dcyWeek?.dcy ?? 0;

  // Ring arc: map DCY ∈ [−30, +25] → percentage ∈ [0, 100] so the existing
  // HeroRail geometry (which expects 0-100) renders sensibly. 50% = neutral.
  const dcyToArcPct = (v) => Math.max(0, Math.min(100, Math.round(50 + v * 2)));
  const mainScore = dcyToArcPct(dcyValue);
  const moonScore = dcyToArcPct(dcyWeekValue);

  // Show the signed number next to the arc instead of the 0-100 projection.
  const dcyNumberText = (v) => {
    if (v == null || isNaN(v)) return '—';
    const n = Math.round(v);
    if (n > 0) return `+${n}`;
    if (n < 0) return `−${Math.abs(n)}`;
    return '±0';
  };
  const mainScoreLabel = dcyNumberText(dcyValue);
  const moonScoreLabel = dcyNumberText(dcyWeekValue);

  // Status color follows the DCY state buckets from stateFor().
  const stateColor = (s) => {
    switch (s) {
      case 'absorbing-strong': return C.green;
      case 'absorbing':        return C.green;
      case 'neutral':          return C.blue;
      case 'depleting':        return C.amber;
      case 'depleting-strong': return C.red;
      case 'warning':          return C.red;
      default:                 return C.blue;
    }
  };
  const stateWord = (s) => {
    switch (s) {
      case 'absorbing-strong': return 'Strongly Absorbing';
      case 'absorbing':        return 'Absorbing';
      case 'neutral':          return 'Balanced';
      case 'depleting':        return 'Depleting';
      case 'depleting-strong': return 'Strongly Depleting';
      case 'warning':          return 'Overreaching';
      default:                 return 'No Data';
    }
  };
  const statusColor = stateColor(dcyDaily?.state);
  const statusWord = stateWord(dcyDaily?.state);
  const statusGlyph = glyphFor(dcyValue);

  // scoreSuffix: keep the legacy "session metric" garnish when present.
  const todayResult = rolling7.todayScore || {};
  const scoreSuffix = todayResult.sessionMetric
    ? ` (${todayResult.sessionMetric.label} ${todayResult.sessionMetric.value})`
    : '';

  // Factors pills — the four DCY pillars in plain-English labels.
  // Fitness (F) and Fatigue (G) are EWMA stocks of training stress; Fuel (N)
  // and Recovery (R) are 0–100%+ coefficients. The limiting-factor sentence
  // lives in the advisory card above, so chips here are just the at-a-glance
  // pillar snapshot. Tone rules: Fuel/Recovery below 80% flag warn; Fatigue
  // flags warn when it's overtaken fitness by 1.5×.
  const factors = useMemo(() => {
    if (!dcyDaily) return [{ label: 'No data', type: 'neutral' }];
    const F = dcyDaily.F || 0;
    const G = dcyDaily.G || 0;
    const nPct = Math.round((dcyDaily.N || 0) * 100);
    const rPct = Math.round((dcyDaily.R || 0) * 100);
    const overloaded = F > 0 && G > 1.5 * F;
    return [
      { label: `Fitness ${Math.round(F)}`,   type: 'neutral' },
      { label: `Fatigue ${Math.round(G)}`,   type: overloaded ? 'warn' : 'neutral' },
      { label: `Fuel ${nPct}%`,              type: nPct < 80 ? 'warn' : 'ok' },
      { label: `Recovery ${rPct}%`,          type: rPct < 80 ? 'warn' : 'ok' },
    ];
  }, [dcyDaily]);

  // ── Race countdown ──
  // Midnight-to-midnight diff so it matches the desktop RaceFocusCard.
  // Bare `new Date(string)` parses as UTC and shifts by your offset; that's
  // why mobile previously showed 20d for May 16 while web showed 21d.
  const raceDaysLeft = (() => {
    if (!nextRace?.date) return null;
    const rd = parseLocalDate(nextRace.date);
    if (!rd) return null;
    rd.setHours(0, 0, 0, 0);
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
    return Math.round((rd - todayMid) / 86400000);
  })();
  const raceLabel = nextRace ? `${nextRace.name || 'Race'}` : '';

  // ── Hero stats (all from hook) ──
  const heroStats = [
    { label: 'Miles/wk', value: twMi.toFixed(1), unit: 'mi' },
    { label: 'Sleep', value: latestSleepScore || '—', unit: '/100' },
    { label: 'Protein', value: todayProtein ? Math.round(todayProtein) : '—', unit: 'g' },
    { label: 'Weight', value: currentWeight?.toFixed(1) || '—', unit: 'lb' },
  ];

  // ── Today's advisory — DCY limiting-factor first, sleep as fallback ──
  // When dcy() classifies a non-balanced factor, surface that message with a
  // factor-specific icon/color. Otherwise fall back to the sleep-based line
  // so the card is always saying something useful.
  const advisory = (() => {
    const lf = dcyDaily?.limitingFactor;
    const lm = dcyDaily?.limitingMessage;
    if (lm && lf && lf !== 'balanced') {
      const tone =
        lf === 'fuel_adequacy'  ? { iconKey: 'GasPump', color: C.amber } :
        lf === 'recovery'       ? { iconKey: 'Pulse',   color: C.red   } :
        lf === 'acute_overload' ? { iconKey: 'Bolt',    color: C.red   } :
        lf === 'detraining'     ? { iconKey: 'Bolt',    color: C.amber } :
                                  { iconKey: 'Moon',    color: C.cyan  };
      return { hl: lm, detail: `DCY ${mainScoreLabel} · ${statusWord}`, ...tone };
    }
    const score = latestSleepScore || 0;
    const hl = score >= 85 ? 'Great sleep — ready to push'
             : score >= 70 ? 'Solid sleep — ready for strength'
             :               'Light sleep — easy effort today';
    return { hl, detail: `${score}/100 recovery`, iconKey: 'Moon', color: C.cyan };
  })();

  // ── Trend helper ──
  const getTrend = (current, history) => {
    const flat = { text: '→', dir: 'flat' };
    if (!Array.isArray(history) || history.length < 2) return flat;
    const cur = typeof current === 'number' ? current : parseFloat(current);
    const prev = typeof history[history.length - 2] === 'number' ? history[history.length - 2] : parseFloat(history[history.length - 2]);
    if (isNaN(cur) || isNaN(prev)) return flat;
    const diff = cur - prev;
    if (Math.abs(diff) < 0.5) return flat;
    return diff > 0 ? { text: `↑ ${Math.abs(diff).toFixed(1)}`, dir: 'up' } : { text: `↓ ${Math.abs(diff).toFixed(1)}`, dir: 'down' };
  };

  // ── Trend text helper (vs last week) ──
  const trendVsLastWk = (current, history) => {
    const t = getTrend(current, history);
    if (t.dir === 'flat') return { text: '→ same as last wk', color: T3 };
    if (t.dir === 'up') return { text: `▲ ${t.text.replace('↑ ', '')} vs last wk`, color: C.green };
    return { text: `▼ ${t.text.replace('↓ ', '')} vs last wk`, color: C.red };
  };

  // ── Build category tiles (each has: label, todayVal, todayUnit, trendText, trendColor, avg30, gaugePct, tileColor, tapTab) ──
  const buildTile = (label, todayVal, todayUnit, trendInfo, avg30, gaugePct, tileColor, tapTab) => ({
    label, todayVal: todayVal ?? '—', todayUnit,
    trendText: trendInfo?.text || '', trendColor: trendInfo?.color || T3,
    avg30: (avg30 == null || avg30 === '—' || avg30 === '' || isNaN(Number(avg30))) ? '—' : avg30,
    gaugePct: (isNaN(gaugePct) || !isFinite(gaugePct)) ? 0 : Math.max(0, Math.min(gaugePct, 1)),
    tileColor, tapTab,
  });

  // ── This Week — all from hook, no props ──
  const weeklyMiPct = twMi / (G.weeklyRunDistanceTarget || 50);

  // ── Phase 4b · registry-driven Start tiles ──────────────────────────────
  // Pull the user's per-category metric selections from storage; fall back
  // to DEFAULT_TILE_PREFS for first-run installs. The tile registry knows
  // how to compute each metric from the same data we already loaded.
  // Re-reads on every storage version bump — so a star toggle from the
  // Trend tab updates this Start screen the moment the user navigates back.
  const tilePrefs = useMemo(
    () => {
      const raw = storage.get('startTilePrefs');
      const norm = normalizeTilePrefs(raw || DEFAULT_TILE_PREFS);
      // Tile-sync diagnostic — fires every time storageVersion bumps so we
      // can confirm the mobile Start screen IS re-reading tilePrefs after
      // a Cloud Sync apply (and what the just-read value actually is).
      try {
        console.info('[tilesync][mobile] tilePrefs re-read', {
          storageVersion,
          rawHas: !!raw,
          run: norm.run, strength: norm.strength, recovery: norm.recovery, body: norm.body,
        });
      } catch {}
      return norm;
    },
    [storageVersion]
  );
  const tileCtx = useMemo(() => buildTileContext({
    activities: getUnifiedActivities(),
    sleepData: cleanSleepForAveraging(storage.get('sleep') || []),
    hrvData,
    weightData: sortedW,
    nutritionLog: storage.get('nutritionLog') || [],
    cronometer: storage.get('cronometer') || [],
    dailyLogs: storage.get('dailyLogs') || [],
    profile: { ...(storage.get('profile') || {}), ...G },
    wellness: storage.get('wellness') || [], // Phase 4 — empty until Garmin Worker ships
  }), [hrvData, sortedW, G]);

  // Per-category accent color, kept aligned with the existing CategoryLabel
  // colors below so nothing visually breaks. blue/purple/green/amber map to
  // run/strength/recovery/body — same palette as before.
  const CATEGORY_COLOR = { run: C.blue, strength: C.purple, recovery: C.green, body: C.amber };
  const CATEGORY_TAP   = { run: 'activity', strength: 'activity', recovery: 'clinical', body: 'clinical' };

  // ── Phase 4o.autopromote.2 — Auto-promote context ──
  // Drives scoreTile()'s session-relevance + coaching-match bumps.
  // sessionType: today's primary activity classification, or 'rest' if nothing logged.
  // activePrompts: top coaching prompts so coachingMatch can fire when a
  //   prompt is flagging this metric's pillar.
  // today: ISO date string for stale-data freshness penalty.
  const promoCtx = useMemo(() => {
    const today = localDate();
    // Classify today's activities into a single session-type label.
    const acts = getUnifiedActivities().filter(a => (a.date || '').startsWith(today));
    let sessionType = 'rest';
    if (acts.length) {
      const hasRun = acts.some(isRun);
      const hasStrength = acts.some(isStrength);
      const hasHIIT = acts.some(isHIIT);
      if (hasRun && hasStrength) sessionType = 'mixed';
      else if (hasHIIT && hasStrength) sessionType = 'hyrox';
      else if (hasRun) sessionType = 'run';
      else if (hasStrength) sessionType = 'strength';
      else sessionType = 'mixed'; // mobility / yoga / other
    }
    let activePrompts = [];
    try { activePrompts = getTopCoachingPrompts(5) || []; } catch {}
    return { sessionType, activePrompts, today, tileCtx, maxSlots: 4 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion, tileCtx]);

  // ── Phase 4r.intel.8 — Mobile intel layer port ──
  // Build an intelCtx around today's primary activity (longest by duration).
  // Tiles whose metric ID maps to an intel-aware metric (avgHR_pctMax, decoupling,
  // hrRecovery1m, aerobicTE, anaerobicTE, z2Pct, z45Pct) get repainted via paintM
  // so the cockpit stripe + label reflect actual performance vs the expected
  // band for the family, not just the static category color.
  const intel = useMemo(() => {
    try {
      const today = localDate();
      const acts = getUnifiedActivities().filter(a => (a.date || '').startsWith(today));
      if (!acts.length) return null;
      // Pick today's primary session — longest duration wins.
      const primary = acts.reduce((best, a) => {
        const d = Number(a.durationSecs ?? a.durationSec ?? 0);
        const bd = Number(best?.durationSecs ?? best?.durationSec ?? 0);
        return d > bd ? a : best;
      }, acts[0]);
      if (!primary) return null;
      const profile = { ...(storage.get('profile') || {}), ...G };
      const allActs = getUnifiedActivities();
      const sleepArr = cleanSleepForAveraging(storage.get('sleep') || []);
      const maxHR = getEffectiveMaxHR(profile, allActs);
      const ctx = buildIntelContext(primary, {
        activities: allActs,
        sleep: sleepArr,
        profile,
      });
      const { paintM, paintT } = makePaint(ctx);
      // Pre-compute the HR-derived intel values for the primary session so
      // tile painters can swap them in without re-deriving.
      const avgHRPctMax = (Number.isFinite(primary.avgHR) && maxHR)
        ? (primary.avgHR / maxHR) * 100 : null;
      const maxHRPctMax = (Number.isFinite(primary.maxHR) && maxHR)
        ? (primary.maxHR / maxHR) * 100 : null;
      return { ctx, paintM, paintT, primary, maxHR, avgHRPctMax, maxHRPctMax };
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion]);

  // Map tile IDs (tileMetrics registry) → intel metric IDs (expectedRanges).
  // For tiles whose value is a percent or pure-form match (decoupling, TE,
  // HR recovery), the value passes straight through. For HR tiles we
  // substitute the precomputed %maxHR so the same band logic applies.
  const INTEL_TILE_MAP = {
    avgRunHR:           { metricId: 'avgHR_pctMax',  useValue: 'avgHRPctMax' },
    maxRunHR:           { metricId: 'avgHR_pctMax',  useValue: 'maxHRPctMax' },
    avgStrengthHR:      { metricId: 'avgHR_pctMax',  useValue: 'avgHRPctMax' },
    peakStrengthHR:     { metricId: 'avgHR_pctMax',  useValue: 'maxHRPctMax' },
    aerobicTE:          { metricId: 'aerobicTE',     useValue: null },
    anaerobicTE:        { metricId: 'anaerobicTE',   useValue: null },
    heartRateRecovery:  { metricId: 'hrRecovery1m',  useValue: null },
    aerobicDecoupling:  { metricId: 'decoupling',    useValue: null },
  };

  // Resolve manual pins → manual + auto-promoted ordered lists per category.
  // Memoized on storageVersion + today so we re-run only when storage actually
  // changes, not on every parent render. Each entry has { id, source, score?, reasons? }.
  const resolvedTiles = useMemo(
    () => resolveAllStartTiles(tilePrefs, TILE_METRICS, promoCtx),
    [tilePrefs, promoCtx]
  );

  const tilesForCategory = (category) => {
    const entries = resolvedTiles[category] || [];
    const color = CATEGORY_COLOR[category];
    const tapTab = CATEGORY_TAP[category];
    return entries.map(entry => {
      const id = entry.id;
      const m = getMetric(id);
      if (!m) return null;
      const result = evaluate(m, tileCtx); // runs compute + back-fills status/trend
      if (!result) {
        return {
          label: m.label, todayVal: '—', todayUnit: m.unit || '',
          trendText: 'no data yet', trendColor: T3,
          avg30: '—', avg30Label: '',
          gaugePct: 0, tileColor: color, tapTab,
          metricId: id,
          source: entry.source,
          autoReasons: entry.reasons || null,
        };
      }
      // ── Status → subtle icon next to the trend line ──
      // Headline number stays white so the eye reads the value first.
      // The icon is the single, consistent flag of "is this healthy?":
      //   green → ✓ (optimal)   amber → ! (caution)   red → ☠ (danger)
      //   neutral / no status → no icon (good but not flagged).
      // Same glyphs across every metric so the visual language is learnable.
      const statusIcon = result.status ? STATUS_ICONS[result.status] : null;
      const statusIconColor = result.status ? STATUS_COLORS[result.status] : null;
      // ── Trend formatting ──
      // result.trend = { direction: 'up'|'down'|'flat', delta, isGood: bool|null }
      // Only color the arrow when the metric has a meaningful polarity
      // (isGood is null for 'neutral' metrics — arrow shown but in muted color).
      const trend = result.trend;
      let trendText = result.sublabel || '';
      let trendColor = T3;
      if (trend) {
        const arrow = trend.direction === 'up' ? '▲'
          : trend.direction === 'down' ? '▼' : '→';
        const deltaStr = trend.delta != null && Math.abs(trend.delta) >= 0.1
          ? ` ${Math.abs(trend.delta).toFixed(trend.delta % 1 === 0 ? 0 : 1)}` : '';
        trendText = `${arrow}${deltaStr}${result.sublabel ? ' · ' + result.sublabel : ''}`;
        if (trend.isGood === true)  trendColor = STATUS_COLORS.green;
        else if (trend.isGood === false) trendColor = STATUS_COLORS.red;
        else trendColor = T3; // neutral / flat
      }
      // avg30: real 30-day average from evaluate() when available, else "—".
      // For metrics whose value is itself already a window (Z2 weekly, ACWR,
      // sleep regularity SD), avg30 is null and we render a dash so users
      // don't see a misleading duplicate of the headline value.
      const avg30Display = result.avg30 != null ? result.avg30 : '—';
      const avg30LabelDisplay = result.avg30 != null ? '30d avg' : '';
      // Phase 4r.intel.8 — for intel-aware metrics with today's primary
      // activity present, repaint tile color via paintM. For all others,
      // keep the category color (stripe + label).
      let intelTileColor = color;
      const intelMap = INTEL_TILE_MAP[id];
      if (intelMap && intel && intel.paintM) {
        const intelValue = intelMap.useValue != null
          ? intel[intelMap.useValue]
          : Number(result.value);
        if (Number.isFinite(intelValue)) {
          const painted = intel.paintM(intelMap.metricId, intelValue, color);
          if (painted) intelTileColor = painted;
        }
      }
      return {
        label: m.label,
        todayVal: result.value,
        todayUnit: m.unit || '',
        trendText,
        trendColor,
        avg30: avg30Display,
        avg30Label: avg30LabelDisplay,
        gaugePct: typeof result.pct === 'number' ? Math.min(Math.max(result.pct, 0), 1) : 0.5,
        // tileColor: category color by default; intel-aware metrics repaint
        // when today's primary activity provides the conditions (Phase 4r.intel.8).
        // statusIcon / statusIconColor: drive the small glyph next to trend text.
        tileColor: intelTileColor,
        statusIcon,
        statusIconColor,
        tapTab,
        hrZones: result.hrZones || null,
        status: result.status || null,
        metricId: id,
        // Phase 4o.autopromote.2 — passed through so the renderer can show
        // a hollow vs filled star and surface the score reasons on long-press.
        source: entry.source,
        autoReasons: entry.reasons || null,
      };
    }).filter(Boolean);
  };

  const runTiles      = tilesForCategory('run');
  const strengthTiles = tilesForCategory('strength');
  const recoveryTiles = tilesForCategory('recovery');
  const bodyTiles     = tilesForCategory('body');
  const weeklyHeadline = weeklyMiPct > 0.8 ? 'Strong week' : weeklyMiPct > 0.6 ? 'Building momentum' : 'Light week';
  const weeklyTime = `${Math.floor(twHrs)}h ${Math.round((twHrs % 1) * 60)}m`;

  // ── Annual goals from Goals system ──
  const annualRunMiGoal = G.annualRunDistanceTarget || 800;
  const annualWorkoutsGoal = G.annualWorkoutsTarget || 200;

  // ── Races from localStorage ──
  const allRaces = (() => {
    try { return JSON.parse(localStorage.getItem('arnold:races') || '[]'); } catch { return []; }
  })();

  // ── Today's plan items ──
  const planItems = (() => {
    const plan = todayPlanned();
    const items = [];
    if (plan) {
      // Type→display config. Keep in sync with Arnold.jsx (lines 1136, 4034)
      // so desktop and mobile render the same planner labels. Icon picks
      // between the runner and dumbbell SVGs; strength-style icon covers
      // anything that isn't a run.
      const TYPE_META = {
        easy_run:  { icon: 'run',      title: 'Easy Run',    detail: 'Recovery · easy pace' },
        long_run:  { icon: 'run',      title: 'Long Run',    detail: 'Aerobic base builder' },
        tempo:     { icon: 'pulse',    title: 'Tempo',       detail: 'Threshold effort · 20–40 min' },
        intervals: { icon: 'clock',    title: 'Intervals',   detail: 'High-intensity repeats' },
        race:      { icon: 'run',      title: 'Race Day',    detail: 'Race effort' },
        strength:  { icon: 'strength', title: 'Strength',    detail: 'Upper body · 45 min' },
        hiit:      { icon: 'bolt',     title: 'HIIT',        detail: 'High-intensity interval training' },
        cross:     { icon: 'bike',     title: 'Cross-train', detail: 'Bike / swim / row · 45 min' },
        mobility:  { icon: 'stretch',  title: 'Mobility',    detail: 'Stretch · 20–30 min' },
        rest:      { icon: 'moon',     title: 'Rest Day',    detail: 'Recovery focus · Stretch & hydrate' },
      };
      const dayType = plan.type || 'easy_run';
      const meta = TYPE_META[dayType] || { icon: 'run', title: dayType.charAt(0).toUpperCase() + dayType.slice(1), detail: '' };
      const distDetail = plan.distanceMi ? `${plan.distanceMi} mi` : plan.durationMin ? `${plan.durationMin} min` : null;
      items.push({
        iconType: meta.icon,
        title: plan.label || meta.title,
        detail: plan.description || (distDetail ? `${meta.detail} · ${distDetail}` : meta.detail),
        time: (dayType === 'rest' || dayType === 'mobility') ? '' : 'AM',
      });
    } else {
      items.push({ iconType: 'strength', title: 'Strength · Upper Body', detail: 'Chest, shoulders, triceps · 45 min', time: 'AM' });
      items.push({ iconType: 'run', title: 'Easy Run', detail: 'Recovery · 3 mi @ 10:30 pace', time: 'PM' });
    }
    return items;
  })();

  // ── Today's completed training (Phase 4a) ─────────────────────────────────
  // Summary-level rendering for the "Today's Activity" strip under the Plan
  // card. Reads structured workouts from BOTH the `activities` collection
  // (CSV imports, manual entries) AND `dailyLogs[today].fitActivities[]`
  // (today's FIT uploads via Today's Training UploadPill). De-duped by a
  // (canonType, distance, duration) tuple so a FIT that ALSO appears in a
  // CSV export doesn't double-count.
  const todayDoneItems = (() => {
    try {
      const today = localDate();
      const summarize = (a) => {
        // All four classifications come from the canonical activityClass
        // helpers — same rules used everywhere else in the app.
        const kind = isMobility(a) ? 'Mobility'
          : isHIIT(a)    ? 'HIIT'
          : isRun(a)     ? 'Run'
          : isStrength(a)? 'Strength'
          : (a.activityType || a.title || 'Activity');
        const mins = Math.round((Number(a.durationSecs) || (Number(a.durationMins) || 0) * 60) / 60);
        const miles = a.distanceMi ? `${Number(a.distanceMi).toFixed(1)} mi · ` : '';
        // Dedup keys (Phase 4o.mobile.10) — return MULTIPLE candidate
        // identifiers per item, treat ANY overlap as a match. Same-session
        // copies in two storage locations rarely agree on every field:
        //   • Garmin Worker imports get a `source.activityId`
        //   • Manual FIT uploads lack the activityId but share `time`
        //   • Both share duration + distance from the FIT itself
        // The previous single-key approach picked one identifier and
        // ignored the others, so a Garmin-worker copy keyed by
        // activityId never collided with a manual-upload copy keyed
        // by time. Multi-key matching fixes that.
        const dedupKeys = [];
        const aid = a.source?.activityId || a.activityId || null;
        if (aid) dedupKeys.push(`gid:${aid}`);
        const startTime = a.startTime || a.time || '';
        if (startTime) dedupKeys.push(`t:${startTime}|${mins}`);
        // Loose duration+distance fallback — almost always matches even
        // when no shared identifier exists. False-positive risk: two
        // separate strength sessions of identical minutes on the same
        // day, both 0 distance — extremely rare in practice.
        dedupKeys.push(`shape:${mins}m|${(Number(a.distanceMi) || 0).toFixed(2)}`);
        const iconType = iconTypeFor(a);
        return {
          kind,
          summary: `${miles}${mins} min`,
          iconType,
          dedupKeys,
        };
      };
      // 1. Structured activities (already filtered for HC ghost data).
      const acts = (storage.get('activities') || [])
        .filter(a => a && a.date === today && a.source !== 'health_connect');
      const items = [];
      const seen = new Set();
      const addIfNew = (a) => {
        const it = summarize(a);
        // Multi-key match (Phase 4o.mobile.10): if ANY of the item's
        // candidate identifiers overlap with an already-seen key, treat
        // it as a duplicate and skip. This catches same-session copies
        // that have an activityId in one store and only a timestamp in
        // the other.
        if ((it.dedupKeys || []).some(k => seen.has(k))) return;
        (it.dedupKeys || []).forEach(k => seen.add(k));
        items.push(it);
      };
      for (const a of acts) addIfNew(a);

      // 2. Today's FIT uploads from dailyLogs (UploadPill writes here).
      const todayLog = (storage.get('dailyLogs') || []).find(l => l && l.date === today);
      const fits = todayLog?.fitActivities || (todayLog?.fitData ? [todayLog.fitData] : []);
      for (const fd of fits) {
        if (!fd) continue;
        addIfNew({ ...fd, date: today });
      }
      return items.map(({ dedupKeys, ...rest }) => rest);
    } catch { return []; }
  })();
  const hasTraining = todayDoneItems.length > 0;

  // ── Today's Movement (Phase 4a) ───────────────────────────────────────────
  // Ambient NEAT from Health Connect via syncDailyEnergy(). Null when no row
  // exists for today yet. Drives the "Going about my day" card.
  // Reads hcDailyEnergy (HC-owned collection) — separated from dailyLogs in
  // the Phase 4a bug fix to dodge the FIT-vs-HC LWW collision.
  const todayMovement = (() => {
    try {
      const today = localDate();
      const rows = storage.get('hcDailyEnergy') || [];
      const entry = rows.find(r => r && r.date === today);
      if (!entry) return null;
      const steps = Number(entry.steps) || 0;
      const active = Number(entry.activeCalories) || 0;
      const total = Number(entry.totalCalories) || 0;
      if (steps === 0 && total === 0) return null;
      return { steps, active, total };
    } catch { return null; }
  })();

  const handleNavTap = (id) => {
    if (id === 'more') { setMoreOpen(true); return; }
    setActiveNav(id);
    const navItem = NAV_ITEMS.find(n => n.id === id);
    if (navItem?.tab) onOpenTab?.(navItem.tab);
  };

  // ── Swipe ──
  // The single source-of-truth swipe handler now lives in Arnold.jsx on
  // <main>, covering every mobile screen including Start. Keeping a second
  // handler here caused double-fires (Start → EdgeIQ → Play in one swipe).
  // No-op so the spread below stays valid.
  const swipeHandlers = {};

  const handleMoreMenuTap = (id) => {
    if (id === 'goals') onOpenTab?.('goals');
    else if (id === 'races') onOpenTab?.('races');
    else if (id === 'stack') onOpenTab?.('supplements');
    else if (id === 'sync') onOpenTab?.('settings');
    else if (id === 'profile') onOpenTab?.('settings');
  };

  // Non-start tabs: Arnold.jsx renders both the tab content and the BottomNavBar
  if (activeNav !== 'start') {
    return null;
  }

  // Pull-to-refresh — drag down from the top of the Start screen to force
  // a full sync (Cloud pull/push, Garmin, Cronometer, FIT relay). Replaces
  // the stop-gap manual sync button with a native-feeling gesture.
  const handleRefresh = async () => {
    try {
      const { syncEverything } = await import('../core/full-sync.js');
      await syncEverything({ force: true });
    } catch (e) { console.warn('[pull-to-refresh] sync failed', e); }
  };
  const ptr = usePullToRefresh(handleRefresh);

  // Phase 4r.intel.27 — Today-scoped action line beneath the DCY
  // status word. PREVIOUSLY this surfaced the top strategic conflict
  // title (e.g. "Weight cut + race in 10 days (A priority)") which
  // (a) had no action, just exposition, and (b) read as if it were
  // explaining the DCY score — but the DCY score is a today signal
  // (moves when you eat) while the strategic conflict is multi-week.
  // The two were on different timescales and the visual juxtaposition
  // was misleading.
  //
  // Now: pull the highest-severity card from the synthesizer's
  // ranked output, preferring TODAY-actionable pillars (Fuel >
  // Recover > Train) over strategic ones (Goal/Body). Show the
  // card's RECOMMENDATION (not its title) with a → glyph so it
  // reads as "do this now." Strategic conflicts continue to live
  // on EdgeIQ where they have full context.
  const intelHeadline = useMemo(() => safeCompute('intelHeadline', () => {
    const _acts  = getUnifiedActivities();
    const _sleep = cleanSleepForAveraging(storage.get('sleep') || []);
    const _hrv   = storage.get('hrv') || [];
    const _wt    = storage.get('weight') || [];
    const _cron  = storage.get('cronometer') || [];
    const _prof  = { ...(storage.get('profile') || {}), ...getGoals() };
    const us = computeUserState({
      activities: _acts, sleep: _sleep, hrv: _hrv,
      weight: _wt, cronometer: _cron, profile: _prof,
    });
    if (!us) return null;
    // Phase 4r.intel.28 — synthesizeRecommendations returns the cards
    // ARRAY directly (intelligence.js:891), not {cards:[...]}. Defensive
    // handling in case the return shape changes again.
    const synth = synthesizeRecommendations(us, { rawInsights: [], rawPrompts: [] });
    const cards = Array.isArray(synth) ? synth : (synth?.cards || []);
    if (!cards.length) return null;
    // Today-scoped pillars first; severity within those.
    const TODAY_PILLARS = ['Fuel', 'Recover', 'Train'];
    const sevRank = { concern: 3, attention: 2, info: 1, positive: 0 };
    const todayCards = cards.filter(c => TODAY_PILLARS.includes(c.pillar) && c.recommendation);
    todayCards.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0));
    const top = todayCards[0] || cards.find(c => c.recommendation);
    if (!top || !top.recommendation) return null;
    return (top.recommendation || '').trim() || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [storageVersion]);

  // ── RENDER ──
  return (
    <div
      style={{
        background: BG, color: T1, minHeight: '100vh',
        fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
        // Phase 4q.frame.1 — unified 12px outer frame across every mobile
        // screen. Was 10px on Start, 24px on EdgeIQ — now both match the
        // 12px that Play/Fuel/Core/Labs use via .arnold-main.
        padding: '0 12px 76px',
        // Phase 4q.signatures.7 — hard-clamp width and clip horizontal
        // overflow so a misbehaving child can't push the page wider than
        // viewport (which was shoving the right column of KRI tiles
        // off-screen).
        width: '100%',
        maxWidth: '100vw',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        WebkitFontSmoothing: 'antialiased',
        // Reserve horizontal touches for our swipe handler (browser keeps
        // vertical pans for scrolling). Without this, on iOS/Android the
        // browser sometimes intercepts horizontal swipes for back-nav.
        touchAction: 'pan-y',
        // Shift the whole content down by the pull distance so the gesture
        // feels grounded — the page follows the finger.
        transform: `translateY(${ptr.pullY}px)`,
        transition: ptr.refreshing || ptr.pullY === 0 ? 'transform 0.18s ease-out' : 'none',
      }}
      onTouchStart={(e) => { ptr.onTouchStart(e); swipeHandlers.onTouchStart?.(e); }}
      onTouchMove={(e) => { ptr.onTouchMove(e); }}
      onTouchEnd={(e) => { ptr.onTouchEnd(e); swipeHandlers.onTouchEnd?.(e); }}
      onTouchCancel={(e) => { ptr.onTouchEnd(e); swipeHandlers.onTouchCancel?.(e); }}
    >
      <PullToRefreshIndicator pullY={ptr.pullY} refreshing={ptr.refreshing} threshold={ptr.threshold} />

      <Header greeting={greeting} profileName={profileName} />

      <HeroRail
        score={mainScore}
        moonScore={moonScore}
        scoreLabel={mainScoreLabel}
        moonScoreLabel={moonScoreLabel}
        scoreGlyph={statusGlyph}
        scoreSuffix={scoreSuffix}
        statusWord={statusWord}
        statusColor={statusColor}
        intelHeadline={intelHeadline}
        factors={factors}
        stats={heroStats}
        raceDaysLeft={raceDaysLeft}
        raceName={raceLabel}
        raceDate={nextRace?.date}
        raceDistance={nextRace?.distanceMi ? `${nextRace.distanceMi} mi` : nextRace?.distanceKm ? `${nextRace.distanceKm} km` : ''}
      />

      {/* ── Phase 4p.plan — Planned Workout Tile (mobile only) ──
          Sits between the Hero rail and the legacy coaching card. When
          the user has a planned workout (or it's race day), this tile
          shows context: weather + targets pre-workout, summary + recovery
          post-workout. When there's no plan / rest day, returns null and
          the CoachingHeroCard below renders as the fallback. */}
      <PlannedWorkoutTile
        profile={{ ...(storage.get('profile') || {}), ...G }}
        plannedToday={todayPlanned()}
        nextRace={nextRace}
        storageVersion={storageVersion}
        onTap={() => onOpenTab?.('plan')}
      />

      {(() => {
        // Hide CoachingHeroCard when the planned-workout tile rendered
        // something — it's already carrying the "what to do" message.
        // Show it as the fallback only on rest days / no-plan days.
        const ws = getPlannedWorkoutState({
          plannedToday: todayPlanned(),
          nextRace,
          storageVersion,
        });
        if (ws.kind !== 'none') return null;
        return <CoachingHeroCard />;
      })()}

      {/* Phase 4r.intel.12-fix6 — InsightsPanel moved off Start screen and
          onto EdgeIQ where the rest of the analytical surface lives. Play
          stays focused on "what to do now" instead of pattern callouts. */}

      {/* ── RUN ── */}
      <CategoryLabel label="Run" color={C.blue} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, marginBottom: 6 }}>
        {runTiles.map((t, i) => (
          <MetricTile key={`run-${t.metricId || i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor} statusIcon={t.statusIcon} statusIconColor={t.statusIconColor}
            source={t.source} autoReasons={t.autoReasons}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── STRENGTH ── */}
      <CategoryLabel label="Strength" color={C.purple} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, marginBottom: 6 }}>
        {strengthTiles.map((t, i) => (
          <MetricTile key={`str-${t.metricId || i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor} statusIcon={t.statusIcon} statusIconColor={t.statusIconColor}
            source={t.source} autoReasons={t.autoReasons}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── RECOVERY ── */}
      <CategoryLabel label="Recovery" color={C.green} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, marginBottom: 6 }}>
        {recoveryTiles.map((t, i) => (
          <MetricTile key={`rec-${t.metricId || i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor} statusIcon={t.statusIcon} statusIconColor={t.statusIconColor}
            source={t.source} autoReasons={t.autoReasons}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── BODY ── */}
      <CategoryLabel label="Body" color={C.amber} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 6, marginBottom: 6 }}>
        {bodyTiles.map((t, i) => (
          <MetricTile key={`body-${t.metricId || i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor} statusIcon={t.statusIcon} statusIconColor={t.statusIconColor}
            source={t.source} autoReasons={t.autoReasons}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* This Week */}
      <div style={sectionHeader}>This Week <div style={shLine} /></div>
      <ThisWeekCard
        headline={weeklyHeadline}
        miles={twMi.toFixed(1)}
        sessions={twSessions}
        runs={twSessions - twStrSessions}
        time={weeklyTime}
        weeklyMiPct={weeklyMiPct}
        weeklyTarget={G.weeklyRunDistanceTarget || 50}
      />

      {/* Annual Timeline */}
      <div style={sectionHeader}>Annual Goals <div style={shLine} /></div>
      <AnnualTimeline
        races={allRaces}
        runMiGoal={annualRunMiGoal}
        runMiActual={Math.round(totalMi || 0)}
        workoutsGoal={annualWorkoutsGoal}
        workoutsActual={totalSessions || 0}
        totalSessions={totalSessions || 0}
      />

      {/* Today's Plan — Phase 4p.plan.6: hidden when the PlannedWorkoutTile
          is showing (any non-'none' state) since the new tile already
          carries the day's plan + completion state at the top of the
          screen. We still render this section on rest days / no-plan
          days as a minimal fallback. */}
      {(() => {
        const ws = getPlannedWorkoutState({
          plannedToday: todayPlanned(),
          nextRace,
          storageVersion,
        });
        if (ws.kind !== 'none') return null;
        return (
          <>
            <div style={sectionHeader}>Today's Plan <div style={shLine} /></div>
            <TodaysPlan items={planItems} doneItems={todayDoneItems} onTap={() => onOpenTab?.('plan')} />
          </>
        );
      })()}

      {/* Going about my day — ambient NEAT card. Adaptive: three-tile on
          rest days (ambient is the hero), single-row strip on training days. */}
      <div style={sectionHeader}>Going about my day <div style={shLine} /></div>
      <div style={card}>
        {todayMovement ? (
          hasTraining ? (
            // Compact strip — training already has its own card, so this stays terse.
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 12, color: T2, padding: '2px 0', flexWrap: 'wrap' }}>
              <span><strong style={{ color: T1, fontWeight: 700 }}>{todayMovement.steps.toLocaleString()}</strong> <span style={{ color: T4 }}>steps</span></span>
              <span><strong style={{ color: T1, fontWeight: 700 }}>{Math.round(todayMovement.active)}</strong> <span style={{ color: T4 }}>active kcal</span></span>
              <span><strong style={{ color: T1, fontWeight: 700 }}>{Math.round(todayMovement.total)}</strong> <span style={{ color: T4 }}>total kcal</span></span>
            </div>
          ) : (
            // Three-tile layout — rest/mobility day, ambient is the main event.
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              <div style={{ background: BG, borderRadius: 10, padding: '12px 6px 10px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.blue, lineHeight: 1 }}>{todayMovement.steps.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: T4, marginTop: 4 }}>steps</div>
              </div>
              <div style={{ background: BG, borderRadius: 10, padding: '12px 6px 10px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.amber, lineHeight: 1 }}>{Math.round(todayMovement.active)}</div>
                <div style={{ fontSize: 11, color: T4, marginTop: 4 }}>active kcal</div>
              </div>
              <div style={{ background: BG, borderRadius: 10, padding: '12px 6px 10px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.green, lineHeight: 1 }}>{Math.round(todayMovement.total)}</div>
                <div style={{ fontSize: 11, color: T4, marginTop: 4 }}>total kcal</div>
              </div>
            </div>
          )
        ) : (
          <div style={{ fontSize: 11, color: T4, textAlign: 'center', padding: '10px 0' }}>
            Sync your Android phone to populate daily movement.
          </div>
        )}
      </div>

      {/* Core Summary */}
      <div style={sectionHeader}>Core <div style={shLine} /></div>
      <CoreSummary
        hrv={latestHRV?.toFixed?.(0) ?? latestHRV ?? '—'}
        rhr={latestRHR}
        weight={currentWeight?.toFixed(1)}
        bodyFat={currentBF != null ? Number(currentBF).toFixed(1) : null}
        rmr={latestRMR != null ? Number(latestRMR).toLocaleString('en-US') : null}
        vo2max={latestVO2Max != null ? Number(latestVO2Max).toFixed(1) : null}
        onTap={() => onOpenTab?.('clinical')}
      />

      {/* Labs Summary */}
      <div style={sectionHeader}>Labs <div style={shLine} /></div>
      <LabsSummary
        labSnapshots={(storage.get('labSnapshots') && storage.get('labSnapshots').length) ? storage.get('labSnapshots') : data?.labSnapshots}
        onTap={() => onOpenTab?.('labs')}
      />

      {/* Bottom Nav is rendered by Arnold.jsx (outside main) so position:fixed works */}

      {/* More Menu */}
      {moreOpen && <MoreMenu onClose={() => setMoreOpen(false)} onMenuTap={handleMoreMenuTap} />}
    </div>
  );
}

// ─── MAIN COMPONENT (with error boundary) ──────────────────────────────────
import { Component } from "react";

class MobileHomeErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          background: '#0b0c12', color: '#fff', minHeight: '100vh',
          padding: 20, fontFamily: 'monospace', fontSize: 12,
        }}>
          <div style={{ color: '#cf6b6b', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
            Arnold crashed:
          </div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#d4a24e' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'rgba(255,255,255,0.4)', marginTop: 8, fontSize: 10 }}>
            {this.state.error.stack}
          </pre>
          <button onClick={() => this.setState({ error: null })} style={{
            marginTop: 16, padding: '8px 16px', background: '#5b9bd5', color: '#fff',
            border: 'none', borderRadius: 8, cursor: 'pointer',
          }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function MobileHome(props) {
  return (
    <MobileHomeErrorBoundary>
      <MobileHomeInner {...props} />
    </MobileHomeErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOBILE EDGEIQ — standalone screen for the EdgeIQ tab on mobile
// ═══════════════════════════════════════════════════════════════════════════════
import { getSystemsReport, getSystemDetail, getSystemWeekly, SYSTEMS, getSystemCoachRead, getBioactiveStack } from "../core/healthSystems.js";
import { GROUP_COLOR as BIO_GROUP_COLOR } from "./BioactiveStack.jsx";
// Health system iconography — Gemini-generated line-art PNGs at 256×256, dark
// #0b0d12 background. Each PNG already has the system's accent color baked in,
// so the rendering doesn't need to tint or recolor them. Vite imports resolve
// these to hashed asset URLs at build time.
import brainPng      from "../assets/systems/brain.png";
import heartPng      from "../assets/systems/heart.png";
import bonesPng      from "../assets/systems/bones.png";
import gutPng        from "../assets/systems/gut.png";
import immunePng     from "../assets/systems/immune.png";
import energyPng     from "../assets/systems/energy.png";
import longevityPng  from "../assets/systems/longevity.png";
import sleepPng      from "../assets/systems/sleep.png";
import metabolismPng from "../assets/systems/metabolism.png";
import endurancePng  from "../assets/systems/endurance.png";
import hormonesPng   from "../assets/systems/hormones.png";
const SYSTEM_PNGS = {
  brain: brainPng, heart: heartPng, bones: bonesPng, gut: gutPng,
  immune: immunePng, energy: energyPng, longevity: longevityPng,
  sleep: sleepPng, metabolism: metabolismPng, endurance: endurancePng,
  hormones: hormonesPng,
};

// Keys must match system IDs from healthSystems.js: brain, heart, bones, gut, immune, energy, longevity, sleep, metabolism, endurance
const SYSTEM_ICONS_M = {
  brain: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8 2 5 5 5 9c0 2 .5 3.5 1.5 5 .8 1.2 1 2.5 1 4h9c0-1.5.2-2.8 1-4 1-1.5 1.5-3 1.5-5 0-4-3-7-7-7z"/><path d="M9 18h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2z"/><path d="M12 2v16"/><path d="M6.5 8c2 1 3.5 1.5 5.5 1.5s3.5-.5 5.5-1.5"/><path d="M7 12.5c1.5.8 3 1 5 1s3.5-.2 5-1"/></svg>,
  heart: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>,
  bones: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/><line x1="6" y1="12" x2="18" y2="12"/><rect x="5" y="7" width="2" height="10" rx="0.5"/><rect x="17" y="7" width="2" height="10" rx="0.5"/></svg>,
  gut: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10c1.5 0 2.5 1 2.5 2.5S18.5 9 17 9H7c-1.5 0-2.5 1-2.5 2.5S6 14 7 14h10"/><path d="M17 14c1.5 0 2.5 1 2.5 2.5S18.5 19 17 19H7"/><circle cx="5" cy="19" r="1.2" fill={c} stroke="none"/></svg>,
  immune: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L4 7v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-5Z"/></svg>,
  energy: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>,
  longevity: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
  sleep: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  metabolism: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h4l2-8 4 16 2-8h4"/></svg>,
  endurance: (c) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c4-6 8-6 12 0s8 6 12 0"/></svg>,
};

function MobileSystemTile({ sys, isActive, onTap }) {
  const statusColor = sys.status === 'good' ? '#4ade80' : sys.status === 'focus' ? '#fbbf24' : '#f87171';
  const fillTint = sys.status === 'good' ? 'rgba(74,222,128,0.12)'
    : sys.status === 'focus' ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.15)';
  // Prefer Gemini PNG icon; fall back to the inline SVG set if a system id
  // isn't covered yet (e.g., a future system added without a matching PNG).
  const pngSrc = SYSTEM_PNGS[sys.id];
  const svgIcon = SYSTEM_ICONS_M[sys.id]?.(sys.color) || null;
  return (
    <div onClick={() => onTap(sys.id)} style={{
      position: 'relative', background: CARD_BG,
      border: isActive ? `1.5px solid ${sys.color}` : `1px solid ${BORDER}`,
      borderRadius: 12, padding: '10px 4px 8px', overflow: 'hidden',
      cursor: 'pointer', transition: 'border 0.2s ease',
      boxShadow: isActive ? `0 0 8px ${sys.color}33` : 'none',
    }}>
      {/* Top accent line */}
      <div style={{ position: 'absolute', top: 0, left: 6, right: 6, height: 2, borderRadius: '0 0 2px 2px', background: sys.color, opacity: 0.6 }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${Math.max(8, sys.pct)}%`,
        background: `linear-gradient(180deg, transparent, ${fillTint})`,
        borderRadius: '0 0 12px 12px', transition: 'height 0.6s ease', zIndex: 0,
      }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{
          width: 36, height: 36, margin: '0 auto 5px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {pngSrc
            ? <img src={pngSrc} alt={sys.name} width={36} height={36} style={{ display: 'block' }} />
            : svgIcon}
        </div>
        {/* Tile name — sized to fit "Energy/Strength" + "Brain/Cognition"
            without clipping on narrow mobile widths. 10.5px lets the longest
            names render whole; whiteSpace:nowrap + overflow:hidden prevents
            mid-word truncation when a name still pushes past the tile edge
            (instead, an ellipsis appears — graceful rather than alarming).
            minHeight:30 reserves two text-lines of space so tiles align
            even when one name wraps and another doesn't. */}
        <div style={{
          fontSize: 10.5, fontWeight: 700, color: T2,
          lineHeight: 1.2, marginBottom: 3,
          minHeight: 26,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          padding: '0 2px',
        }}>
          {sys.name.replace(' & ', '/')}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: statusColor }}>{sys.pct}%</div>
      </div>
    </div>
  );
}

// ── Training / Body / Blood signals mapped per system ──────────────────────
const SYSTEM_SIGNALS = {
  brain:     { training: ['HRV', 'Sleep Score'], body: ['Body Fat %'], blood: ['Vitamin B12', 'Folate', 'Vitamin D'] },
  heart:     { training: ['RHR', 'Avg HR', 'Weekly Miles'], body: ['Weight'], blood: ['Cholesterol', 'Triglycerides', 'CRP'] },
  bones:     { training: ['Strength Sessions', 'Weekly Hours'], body: ['Lean Mass', 'Weight'], blood: ['Vitamin D', 'Calcium'] },
  gut:       { training: [], body: ['Body Fat %'], blood: ['CRP', 'Iron'] },
  immune:    { training: ['HRV', 'Sleep Score'], body: [], blood: ['Vitamin D', 'Vitamin C', 'Zinc', 'WBC'] },
  energy:    { training: ['Weekly Hours', 'Weekly Miles'], body: ['Weight'], blood: ['Iron', 'Ferritin', 'Vitamin B12'] },
  longevity: { training: ['HRV', 'RHR', 'Weekly Hours'], body: ['Body Fat %', 'Weight'], blood: ['Glucose', 'HbA1c', 'CRP'] },
  sleep:     { training: ['Sleep Score', 'HRV', 'RHR'], body: [], blood: ['Magnesium'] },
  metabolism:{ training: ['Weekly Hours', 'Weekly Miles'], body: ['Weight', 'Body Fat %'], blood: ['Glucose', 'HbA1c', 'Triglycerides'] },
  endurance: { training: ['Weekly Miles', 'Avg Pace', 'Weekly Hours'], body: ['Weight'], blood: ['Iron', 'Ferritin', 'Hemoglobin'] },
};

// ── Expanded System Detail Panel ───────────────────────────────────────────
function SystemDetailPanel({ systemId, data, comment }) {
  const [detailTab, setDetailTab] = useState('daily');
  const today = localDate();
  const detail = useMemo(() => getSystemDetail(systemId, today), [systemId, today]);
  const weekly = useMemo(() => getSystemWeekly(systemId), [systemId]);

  // Coach Read — surface what the Coach engine knows about this system today.
  // Mirrors the web SystemDetail pattern; memoized on system + date so we
  // don't recompute on every panel re-render.
  const coachRead = useMemo(() => {
    try {
      const us = computeUserState({
        activities:   storage.get('activities')   || [],
        sleep:        storage.get('sleep')        || [],
        hrv:          storage.get('hrv')          || [],
        weight:       storage.get('weight')       || [],
        nutritionLog: storage.get('nutritionLog') || [],
        wellness:     storage.get('wellness')     || [],
        planner:      storage.get('planner')      || null,
        profile:      { ...(storage.get('profile') || {}), ...getGoals() },
      });
      return getSystemCoachRead(systemId, us?.coachSignals || null);
    } catch (e) {
      console.warn('[MobileCoachRead] failed for system', systemId, e?.message || e);
      return null;
    }
  }, [systemId, today]);

  if (!detail) return null;
  const { system, details: nutrients } = detail;
  const signals = SYSTEM_SIGNALS[systemId] || { training: [], body: [], blood: [] };
  const pngSrc = SYSTEM_PNGS[systemId];
  const svgIcon = SYSTEM_ICONS_M[systemId]?.(system.color) || null;
  const icon = pngSrc
    ? <img src={pngSrc} alt={system.name} width={42} height={42} style={{ display: 'block' }} />
    : svgIcon;
  // Status color matches the tile: green ≥80, yellow ≥50, red <50
  const statusColor = (system.pct || 0) >= 80 ? '#4ade80' : (system.pct || 0) >= 50 ? '#fbbf24' : '#f87171';

  // Unified activity universe — single source of truth via dcyMath.js
  // allActivities(). Was three separate parallel implementations; now one.
  const activities = getUnifiedActivities();
  const sleepData = cleanSleepForAveraging(storage.get('sleep') || []);
  const hrvData = storage.get('hrv') || [];
  const weightData = storage.get('weight') || [];
  // Prefer storage-layer labs (cloud-synced) over the legacy vitals-v4 blob.
  const labsSource = (() => {
    const s = storage.get('labSnapshots');
    if (Array.isArray(s) && s.length) return s;
    return data?.labSnapshots || [];
  })();
  const labSnaps = [...labsSource].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const labMarkers = labSnaps[0]?.markers || {};

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const d7 = new Date(); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);

  const recentSleep = [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentHRV = [...hrvData].filter(h => h.overnightHRV).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentWeight = [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ytdRuns = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart && isRun(a));
  const ytdAll = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart);
  const wk7 = activities.filter(a => a.date && parseLocalDate(a.date) >= d7);
  const wk7Runs = wk7.filter(isRun);
  const wk7Str  = wk7.filter(isStrength);

  // Resolve signal values
  const resolveSignal = (name, period) => {
    if (period === 'annual') {
      if (name === 'Weekly Miles') return { value: (ytdRuns.reduce((s, a) => s + (a.distanceMi || 0), 0) / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'mi/wk' };
      if (name === 'Weekly Hours') return { value: (ytdAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600 / Math.max((now - yearStart) / 604800000, 1)).toFixed(1), unit: 'hrs/wk' };
      if (name === 'Strength Sessions') return { value: ytdAll.filter(a => /strength|weight|gym/i.test(a.activityType || '')).length, unit: 'YTD' };
      if (name === 'Avg Pace') { const p = ytdRuns.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean); return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' }; }
    }
    // Daily / Weekly
    if (name === 'HRV') return { value: recentHRV[0]?.overnightHRV || '—', unit: 'ms' };
    if (name === 'RHR') return { value: recentSleep[0]?.restingHR || '—', unit: 'bpm' };
    if (name === 'Sleep Score') return { value: recentSleep.find(s => s.sleepScore)?.sleepScore || '—', unit: '/100' };
    if (name === 'Avg HR') { const hrs = wk7Runs.map(a => a.avgHR).filter(Boolean); return { value: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : '—', unit: 'bpm' }; }
    if (name === 'Weekly Miles') return { value: wk7Runs.reduce((s, a) => s + (a.distanceMi || 0), 0).toFixed(1), unit: 'mi' };
    if (name === 'Weekly Hours') return { value: (wk7.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600).toFixed(1), unit: 'hrs' };
    if (name === 'Strength Sessions') return { value: wk7Str.length, unit: 'this wk' };
    if (name === 'Avg Pace') { const p = wk7Runs.map(a => { if (!a.avgPaceRaw) return null; const [m, s] = a.avgPaceRaw.split(':').map(Number); return m * 60 + (s || 0); }).filter(Boolean); return p.length ? { value: `${Math.floor(p.reduce((s, v) => s + v, 0) / p.length / 60)}:${String(Math.round(p.reduce((s, v) => s + v, 0) / p.length % 60)).padStart(2, '0')}`, unit: '/mi' } : { value: '—', unit: '' }; }
    if (name === 'Weight') return { value: recentWeight[0]?.weightLbs?.toFixed(1) || '—', unit: 'lbs' };
    if (name === 'Body Fat %') return { value: recentWeight[0]?.bodyFatPct?.toFixed(1) || '—', unit: '%' };
    if (name === 'Lean Mass') return { value: recentWeight[0]?.skeletalMuscleMassLbs?.toFixed(1) || '—', unit: 'lbs' };
    return { value: '—', unit: '' };
  };

  const resolveBlood = (name) => {
    const v = labMarkers[name];
    return v != null ? { value: v, unit: '' } : { value: '—', unit: '' };
  };

  const weeklyAvg = weekly.length ? Math.round(weekly.reduce((s, d) => s + d.pct, 0) / weekly.length) : null;
  const weeklyMax = Math.max(...weekly.map(d => d.pct), 1);

  const tabStyle = (active) => ({
    flex: 1, textAlign: 'center', fontSize: 11, fontWeight: active ? 700 : 500,
    padding: '7px 0', color: active ? statusColor : T3,
    borderBottom: active ? `2px solid ${statusColor}` : '2px solid transparent',
    cursor: 'pointer', transition: 'all 0.2s', letterSpacing: '0.04em',
  });

  const barColor = (pct) => pct >= 80 ? '#4ade80' : pct >= 50 ? '#fbbf24' : '#f87171';

  return (
    <div style={{
      background: CARD_BG, border: `1px solid ${statusColor}33`,
      borderRadius: 14, padding: '12px 12px 10px', marginTop: 8,
      animation: 'slideDown 0.25s ease-out',
    }}>
      <style>{`@keyframes slideDown { from { opacity: 0; max-height: 0; transform: translateY(-8px); } to { opacity: 1; max-height: 600px; transform: translateY(0); } }`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 52, height: 52,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T1 }}>{system.name}</div>
          <div style={{ fontSize: 11, color: T3, marginTop: 1 }}>{comment || 'Tap tile again to close'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: statusColor, lineHeight: 1 }}>{detail.system.pct || 0}%</div>
          <div style={{ fontSize: 10, color: T3, marginTop: 2 }}>today</div>
        </div>
      </div>

      {/* Tab bar: Daily / Weekly / Annual */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 10 }}>
        <div style={tabStyle(detailTab === 'daily')} onClick={() => setDetailTab('daily')}>Daily</div>
        <div style={tabStyle(detailTab === 'weekly')} onClick={() => setDetailTab('weekly')}>Weekly</div>
        <div style={tabStyle(detailTab === 'annual')} onClick={() => setDetailTab('annual')}>Annual</div>
      </div>

      {/* ── Daily tab ── Phase 4r.intel.upgrade.mobile.1 — parity with web
          WebSystemDetail: Coach sigil + line + signal tiles, bioactive hex
          stack, nutrient donuts. Mobile-tuned widths and gaps. */}
      {detailTab === 'daily' && (
        <div>
          {/* Coach Read — sigil + line + signal tiles. Always renders when
              coachRead is present; systems without active signals still get
              a thoughtful fallback voice (gut, immune in early days, etc.) */}
          {coachRead && (
            <div style={{ marginBottom: 14 }}>
              {coachRead.coachLine && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <CoachSigil size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div style={{
                    flex: 1, minWidth: 0,
                    fontSize: 12.5, lineHeight: 1.5,
                    color: T1,
                  }}>
                    {coachRead.coachLine}
                  </div>
                </div>
              )}
              {/* Stat cards — fixed-width metric tiles with left-edge accent
                  strip, vertical hierarchy (LABEL · VALUE · context). Tiles
                  wrap naturally and never stretch. Single-tile sections stay
                  the same width as multi-tile ones. Empty values are
                  filtered out so half-rendered chips can't appear. */}
              {(() => {
                const validSigs = coachRead.signals.filter(s => s && s.value != null && s.value !== '—' && s.value !== '');
                if (validSigs.length === 0) return null;
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {validSigs.map((sig, i) => (
                      <div key={i} style={{
                        width: 108,
                        minHeight: 78,
                        background: BG,
                        borderRadius: 10,
                        position: 'relative',
                        padding: '8px 9px 8px 12px',
                        overflow: 'hidden',
                        display: 'flex', flexDirection: 'column', gap: 3,
                      }}>
                        {/* Left accent strip — single visual cue for state color */}
                        <div style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                          background: sig.color, borderRadius: '10px 0 0 10px',
                        }}/>
                        <div style={{
                          fontSize: 8.5, color: T4, fontWeight: 600,
                          textTransform: 'uppercase', letterSpacing: '0.08em',
                          lineHeight: 1.2,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                        }}>{sig.label}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginTop: 1 }}>
                          <span style={{ fontSize: 17, fontWeight: 700, color: sig.color, lineHeight: 1 }}>{sig.value}</span>
                          {sig.unit && <span style={{ fontSize: 9, color: T4 }}>{sig.unit}</span>}
                        </div>
                        {sig.headline && (
                          <div style={{
                            fontSize: 8.5, color: T4, lineHeight: 1.3,
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                            marginTop: 'auto',
                          }}>
                            {sig.headline}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Bioactive hex stack + nutrient donuts — mirrors web. Detects
              compounds by name pattern (NMN, Rv, Curcumin, etc.), maps each
              to {short, group}, then renders the hex chips grouped by
              category alongside category color. Regular nutrients (Protein,
              Mg, etc.) get donut rings underneath. */}
          {(() => {
            const visibleNutrients = (nutrients || []).filter(n =>
              n && (n.value > 0 || n.target > 0) && n.pct != null
            );
            if (visibleNutrients.length === 0) return null;

            // Canonical source of truth for "taken today": getBioactiveStack
            // walks the supplements log + stack + catalog and returns each
            // bioactive with taken=true the moment ANY dose containing it has
            // been logged. This matches what the Daily/Fuel summary shows.
            const canonicalBio = getBioactiveStack(today);
            const takenByName = new Map(canonicalBio.map(b => [b.name, b.taken]));

            // Name → {short, group, ui-color category} mapping. Each entry
            // matches by the canonical nutrient name from supplements.js
            // SEED_CATALOG so this stays aligned with the upstream data model.
            const NAME_META = {
              'NMN (Nicotinamide Mononucleotide)':           { short: 'NMN', group: 'longevity' },
              'Trans-Resveratrol':                           { short: 'Rv',  group: 'longevity' },
              'Spermidine (wheat germ extract)':             { short: 'Sp',  group: 'longevity' },
              'Trimethylglycine (TMG/Betaine anhydrous)':    { short: 'TMG', group: 'longevity' },
              'Apigenin':                                    { short: 'Ap',  group: 'longevity' },
              'Quercetin':                                   { short: 'Qc',  group: 'defense' },
              'Fisetin':                                     { short: 'Fis', group: 'neural' },
              'Turmeric (curcumin extract)':                 { short: 'Cur', group: 'defense' },
              'Fish Oil (total)':                            { short: 'FO',  group: 'defense' },
              'Ashwagandha (KSM-66)':                        { short: 'Ash', group: 'performance' },
              'Beetroot powder concentrate':                 { short: 'Btr', group: 'performance' },
              'Creatine':                                    { short: 'Cre', group: 'neural' },
              'Magnesium L-Threonate (Magtein)':             { short: 'MgT', group: 'neural' },
              'Shilajit resin':                              { short: 'Shi', group: 'adaptive' },
            };
            const bioactives = [];
            const regularNutrients = [];
            for (const n of visibleNutrients) {
              const key = n.nutrient || n.name || '';
              const meta = NAME_META[key];
              if (meta) {
                const taken = takenByName.has(key) ? takenByName.get(key) : (n.pct >= 80);
                bioactives.push({ ...n, _short: meta.short, _group: meta.group, _taken: taken });
              } else {
                regularNutrients.push(n);
              }
            }
            const bioByGroup = {};
            for (const b of bioactives) {
              (bioByGroup[b._group] = bioByGroup[b._group] || []).push(b);
            }
            const BIO_GROUP_LABEL = {
              neural: 'Neural', longevity: 'Longevity', defense: 'Defense',
              performance: 'Perform', adaptive: 'Adaptive', other: 'Other',
            };
            const BIO_GROUP_ORDER = ['neural','longevity','defense','performance','adaptive','other'];
            const withAlpha = (hex, a) => {
              const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
              return `rgba(${r},${g},${b},${a})`;
            };
            const HexChip = ({ short, taken, color }) => (
              <svg width={26} height={26} viewBox="-15 -15 30 30" style={{ display:'block' }} fontFamily="ui-sans-serif" fontWeight={500} textAnchor="middle">
                <polygon
                  points="-12,-7 -12,7 0,14 12,7 12,-7 0,-14"
                  fill={taken ? withAlpha(color, 0.22) : 'transparent'}
                  stroke={taken ? color : withAlpha(color, 0.40)}
                  strokeWidth={1.2}
                  strokeDasharray={taken ? undefined : '2 2'}
                />
                <text y="0" dominantBaseline="central" fill={taken ? color : '#94a3b8'} fontSize={8}>{short}</text>
              </svg>
            );
            const capitalize = (s) => {
              if (!s) return s;
              if (/[A-Z]/.test(s)) return s;
              return s.charAt(0).toUpperCase() + s.slice(1);
            };
            const Donut = ({ pct, color, size = 48 }) => {
              const stroke = 4;
              const r = (size - stroke) / 2;
              const C = 2 * Math.PI * r;
              const filled = Math.max(0, Math.min(pct / 100, 1)) * C;
              return (
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display:'block' }}>
                  <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke}/>
                  <circle cx={size/2} cy={size/2} r={r}
                    fill="none" stroke={color} strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${C - filled}`}
                    transform={`rotate(-90 ${size/2} ${size/2})`}/>
                </svg>
              );
            };
            return (
              <>
                {Object.keys(bioByGroup).length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.10em', marginBottom: 6 }}>Bioactive stack · taken today</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                      {BIO_GROUP_ORDER.filter(g => bioByGroup[g] && bioByGroup[g].length).map(g => {
                        const color = BIO_GROUP_COLOR[g] || '#94a3b8';
                        const items = bioByGroup[g];
                        const takenCount = items.filter(x => x._taken).length;
                        return (
                          <div key={g} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{
                              fontSize: 9.5, fontWeight: 500, color,
                              letterSpacing: '0.08em', textTransform: 'uppercase',
                              minWidth: 86, flexShrink: 0,
                            }}>
                              {BIO_GROUP_LABEL[g] || g}
                              <span style={{ color: T4, fontWeight: 400, marginLeft: 4 }}>
                                {takenCount}/{items.length}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                              {items.map((b, i) => (
                                <HexChip key={i} short={b._short} taken={b._taken} color={color} />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
                {regularNutrients.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.10em', marginTop: 4, marginBottom: 6 }}>Nutrients · today's intake</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
                      {regularNutrients.map((n, i) => {
                        const c = barColor(n.pct);
                        const name = capitalize(n.short || n.name);
                        return (
                          <div key={i} style={{
                            width: 78,
                            background: BG,
                            borderRadius: 8,
                            border: `0.5px solid ${c}33`,
                            padding: '7px 4px 5px',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                          }}>
                            <div style={{ position: 'relative' }}>
                              <Donut pct={n.pct} color={c}/>
                              <div style={{
                                position: 'absolute', inset: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 10, fontWeight: 700, color: c, letterSpacing: '-0.02em',
                              }}>{n.pct}%</div>
                            </div>
                            <div style={{
                              fontSize: 9.5, fontWeight: 500, color: T1,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              maxWidth: '100%', textAlign: 'center',
                            }}>{name}</div>
                            <div style={{ fontSize: 8, color: T4, lineHeight: 1 }}>
                              {n.value}/{n.target}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* Training / Body / Blood signal tiles — unified stat-card pattern.
              Fixed-width tiles (108px), wrap naturally, never stretch. The
              left-edge accent strip now carries threshold meaning: each
              signal has a target (from goals or a clinical norm) and the
              strip colors green/yellow/red based on where the value lands.
              A short status word (recovered / fit / restful / etc.) renders
              as the footer so the visual cue and the text cue agree.
              Blood markers stay neutral since they don't have universal
              thresholds in this view. */}
          {(() => {
            const goals = getGoals();
            // Per-signal target → drives the % bands for non-clinical signals.
            const sigTarget = (name) => {
              if (name === 'HRV') return parseFloat(goals?.targetHRV) || 45;
              if (name === 'RHR') return parseFloat(goals?.targetRHR) || 50;
              if (name === 'Sleep Score') return parseFloat(goals?.targetSleepScore) || 80;
              if (name === 'Avg HR') return parseFloat(goals?.targetAvgRunHR) || null;
              if (name === 'Weekly Miles') return parseFloat(goals?.weeklyRunDistanceTarget) || null;
              if (name === 'Weekly Hours') return parseFloat(goals?.weeklyTimeTargetHrs) || null;
              if (name === 'Strength Sessions') return parseFloat(goals?.weeklyStrengthTarget) || null;
              if (name === 'Weight') return parseFloat(goals?.targetWeight) || null;
              if (name === 'Body Fat %') return parseFloat(goals?.targetBodyFat) || null;
              if (name === 'Lean Mass') return parseFloat(goals?.targetLeanMass) || null;
              return null;
            };
            // Threshold-based color. Returns null when there's no usable
            // threshold (neutral grey is rendered in that case).
            const sigColor = (name, val) => {
              if (val == null || val === '—' || !Number.isFinite(Number(val))) return null;
              const v = Number(val);
              // Clinical hard thresholds — same numbers as web sigColor().
              if (name === 'HRV')         return v >= 40 ? '#4ade80' : v >= 30 ? '#fbbf24' : '#f87171';
              if (name === 'RHR')         return v <= 55 ? '#4ade80' : v <= 65 ? '#fbbf24' : '#f87171';
              if (name === 'Sleep Score') return v >= 80 ? '#4ade80' : v >= 60 ? '#fbbf24' : '#f87171';
              const t = sigTarget(name);
              if (t == null) return null;
              // Avg HR is "lower vs target" — same shape as the web.
              if (name === 'Avg HR') return v <= t * 1.05 ? '#4ade80' : v <= t * 1.15 ? '#fbbf24' : '#f87171';
              // Body Fat % and Weight are "closer to target = better" —
              // green if within ±5% of target, yellow within ±10%, red beyond.
              if (name === 'Body Fat %' || name === 'Weight') {
                const drift = Math.abs(v - t) / t;
                return drift <= 0.05 ? '#4ade80' : drift <= 0.10 ? '#fbbf24' : '#f87171';
              }
              // Default: % of target, higher = better (miles, hours, sessions, lean mass).
              const pct = v / t;
              return pct >= 0.9 ? '#4ade80' : pct >= 0.7 ? '#fbbf24' : '#f87171';
            };
            // Short status word — confirms what the color is saying.
            const sigStatus = (name, val) => {
              if (val == null || val === '—' || !Number.isFinite(Number(val))) return null;
              const v = Number(val);
              if (name === 'HRV')         return v >= 40 ? 'recovered' : v >= 30 ? 'borderline' : 'strained';
              if (name === 'RHR')         return v <= 55 ? 'fit' : v <= 65 ? 'normal' : 'elevated';
              if (name === 'Sleep Score') return v >= 80 ? 'restful' : v >= 60 ? 'fair' : 'poor';
              if (name === 'Avg HR') {
                const t = sigTarget(name); if (t == null) return null;
                return v <= t * 1.05 ? 'on pace' : v <= t * 1.15 ? 'drifting' : 'over';
              }
              if (name === 'Body Fat %' || name === 'Weight') {
                const t = sigTarget(name); if (t == null) return null;
                const drift = Math.abs(v - t) / t;
                return drift <= 0.05 ? 'on target' : drift <= 0.10 ? 'near' : 'off';
              }
              const t = sigTarget(name); if (t == null) return null;
              const pct = v / t;
              return pct >= 0.9 ? 'on track' : pct >= 0.7 ? 'behind' : 'short';
            };

            const NEUTRAL = '#475569';   // dark slate — clearly inert vs the live colors
            const renderStatCard = (label, r, accent, footer, valueColor) => (
              <div style={{
                width: 108,
                minHeight: 78,
                background: BG,
                borderRadius: 10,
                position: 'relative',
                padding: '8px 9px 8px 12px',
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
                  background: accent, borderRadius: '10px 0 0 10px',
                }}/>
                <div style={{
                  fontSize: 8.5, color: T4, fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                  lineHeight: 1.2,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginTop: 1 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: valueColor || T1, lineHeight: 1 }}>{r.value}</span>
                  {r.unit && <span style={{ fontSize: 9, color: T4 }}>{r.unit}</span>}
                </div>
                {footer && (
                  <div style={{ fontSize: 8.5, color: T4, lineHeight: 1.3, marginTop: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {footer}
                  </div>
                )}
              </div>
            );

            const sections = [];
            const tT = signals.training.map((sig) => ({ sig, r: resolveSignal(sig, 'daily') })).filter(t => t.r.value != null && t.r.value !== '—');
            const tB = signals.body.map((sig) => ({ sig, r: resolveSignal(sig, 'daily') })).filter(t => t.r.value != null && t.r.value !== '—');
            const tBl = signals.blood.map((sig) => ({ sig, r: resolveBlood(sig) })).filter(t => t.r.value != null && t.r.value !== '—');
            if (tT.length) sections.push({ title: 'Training signals', tiles: tT, clinical: true });
            if (tB.length) sections.push({ title: 'Body signals', tiles: tB, clinical: true });
            if (tBl.length) sections.push({ title: 'Blood markers', tiles: tBl, clinical: false });
            return sections.map((s, si) => (
              <div key={si}>
                <div style={{ fontSize: 10, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.10em', marginTop: 12, marginBottom: 6 }}>{s.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {s.tiles.map(({ sig, r }, i) => {
                    if (!s.clinical) {
                      // Blood markers — no universal threshold available here,
                      // strip stays neutral and footer is blank.
                      return <div key={i}>{renderStatCard(sig, r, NEUTRAL, null, null)}</div>;
                    }
                    const c = sigColor(sig, r.value);
                    const status = sigStatus(sig, r.value);
                    return <div key={i}>{renderStatCard(sig, r, c || NEUTRAL, status, c)}</div>;
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Weekly tab ── */}
      {detailTab === 'weekly' && (
        <div>
          {/* 7-day sparkline bar chart */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>7-Day Score</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {weekly.map((d, i) => {
              const barH = weeklyMax > 0 ? Math.max(4, Math.round((d.pct / weeklyMax) * 70)) : 4;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 11, color: barColor(d.pct), fontWeight: 700, marginBottom: 3 }}>{d.pct}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 70 }}>
                    <div style={{
                      width: '100%', borderRadius: 4,
                      height: barH,
                      background: barColor(d.pct),
                      transition: 'height 0.4s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: T4, marginTop: 3 }}>{d.dayLabel}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T2, padding: '6px 0', borderTop: `1px solid ${BORDER}` }}>
            <span style={{ fontWeight: 600 }}>Weekly avg</span>
            <span style={{ fontWeight: 800, color: barColor(weeklyAvg || 0) }}>{weeklyAvg || '—'}%</span>
          </div>

          {/* Weekly training signals */}
          {signals.training.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Weekly Training</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.training.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.training.map((sig, i) => {
                  const r = resolveSignal(sig, 'weekly');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 10, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Nutrient averages hint */}
          <div style={{ fontSize: 11, color: T4, marginTop: 10, textAlign: 'center', fontStyle: 'italic' }}>
            Nutrient scores reflect today's intake — log consistently for accurate weekly trends
          </div>
        </div>
      )}

      {/* ── Annual tab ── */}
      {detailTab === 'annual' && (
        <div>
          {/* Annual training signals */}
          {signals.training.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>YTD Training</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.training.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.training.map((sig, i) => {
                  const r = resolveSignal(sig, 'annual');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 10, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Body — current snapshot */}
          {signals.body.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Body (Current)</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.body.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.body.map((sig, i) => {
                  const r = resolveSignal(sig, 'daily');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 10, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Blood markers — latest panel */}
          {signals.blood.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>
                Blood (Latest Panel{labSnaps[0]?.date ? ` · ${labSnaps[0].date}` : ''})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.blood.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.blood.map((sig, i) => {
                  const r = resolveBlood(sig);
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Top nutrients for this system */}
          <div style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Key Nutrients (Today)</div>
          {nutrients.slice(0, 5).map((n, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T2, marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{n.short}</span>
                <span style={{ color: barColor(n.pct), fontWeight: 600 }}>{n.pct}%</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <div style={{ height: 4, background: barColor(n.pct), borderRadius: 2, width: `${Math.min(n.pct, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mobile-compact intelligence card grid (Phase 4r.intel.23) ─────────────
//
// Renders the synthesizer's cards in a single-column stacked layout for
// mobile. Same color-coded chrome as web (severity stripe on the left,
// pillar tag in the header, headline + detail + recommendation) but
// scaled down: smaller font, tighter padding, 2-line clamp on each
// text block so cards stay short and the user can scan all 4 without
// excessive scrolling.

// ─── Mobile Priority tile (Phase 4r.intel.29) ─────────────────────────────
//
// Hero glance tile for the top synthesizer hypothesis. Sits at the very
// top of MobileEdgeIQ. One block of text to read at first glance plus
// an "ALSO:" footnote chip-line for everything else the synth flagged.
//
// Design contract (iterated through 4r.intel.24 → .27 → .29):
//   - Combined header band reads "PRIORITY · {PILLAR}" so the section
//     label and the pillar tag don't repeat as two small uppercase
//     lines (4r.intel.27 had them stacked; user reported the
//     repetition as confusing).
//   - Severity is visually loud: thick top accent bar (5px), severity
//     word badge on the right of the header band ("CONCERN" / "WATCH"
//     / "NOTE" / "ON TRACK"), and a subtle severity-tinted background
//     wash inside the tile. The earlier red top border alone wasn't
//     pulling enough weight against the equally-bordered Health
//     Systems cells.
//   - Headline is the visual focal point: larger font (15px), bolder,
//     stands alone — no inline pillar tag fighting for attention
//     above it.
//   - Footnote stays the same: ALSO: TAG phrase · TAG phrase, two
//     lines max via CSS line-clamp, no JS truncation.
function MobileIntelligenceCards({ cards }) {
  if (!cards || cards.length === 0) return null;
  const SEV_COLOR = {
    concern:   '#f87171', critical:  '#f87171',
    attention: '#fbbf24', warning:   '#fbbf24',
    info:      '#60a5fa',
    positive:  '#4ade80',
  };
  // Severity word badge — short, all-caps, color-matched.
  const SEV_LABEL = {
    concern: 'CONCERN', critical: 'CONCERN',
    attention: 'WATCH', warning: 'WATCH',
    info: 'NOTE',
    positive: 'ON TRACK',
  };
  // Subtle tint applied to the tile background (rgba so it reads as a
  // wash, not a solid panel). The number is the alpha — kept low (≈8%)
  // so the wash hints at severity without competing with the headline
  // text for legibility.
  const SEV_TINT = {
    concern:   'rgba(248,113,113,0.08)', critical: 'rgba(248,113,113,0.08)',
    attention: 'rgba(251,191,36,0.07)',  warning:  'rgba(251,191,36,0.07)',
    info:      'rgba(96,165,250,0.06)',
    positive:  'rgba(74,222,128,0.06)',
  };

  // Cards are pre-ranked by severity inside synthesizeRecommendations.
  const primary    = cards[0];
  const others     = cards.slice(1);
  const accent     = SEV_COLOR[primary.severity] || '#60a5fa';
  const sevLabel   = SEV_LABEL[primary.severity] || 'NOTE';
  const tintBg     = SEV_TINT[primary.severity]  || 'rgba(96,165,250,0.06)';
  const pillarTag  = (primary.pillar || '').toUpperCase();

  // Footnote: one-line summary of the remaining cards. Each entry is
  // "PILLAR phrase". CSS line-clamp on the container (2 lines + word
  // wrap) handles overflow; no JS truncation per 4r.intel.26.
  const footnote = others.length === 0 ? null : others.map(c => {
    const tag    = (c.pillar || '').toUpperCase();
    const phrase = (c.title || c.detail || '').replace(/[.!?]+$/, '').trim();
    return phrase ? `${tag} ${phrase}` : tag;
  }).join(' · ');

  return (
    <div style={{ marginTop: 4 }}>
      {/* Combined header band: section label + pillar in one line so
          we no longer repeat "Priority" outside the tile AND "GOAL"
          inside it. Severity word sits on the right, color-coded. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
        color: 'var(--text-muted)', textTransform: 'uppercase',
        marginTop: 6, marginBottom: 5,
      }}>
        <span>Priority{pillarTag ? ` · ${pillarTag}` : ''}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-default)' }} />
        <span style={{
          color: accent, fontSize: 9, fontWeight: 800,
          letterSpacing: '0.12em',
          padding: '2px 7px', borderRadius: 4,
          background: `${accent}1f`,
        }}>{sevLabel}</span>
      </div>

      {/* The tile itself: severity tint background + thick top accent
          bar. Headline is the focal point at 15px (was 13px in the
          previous version); pillar tag is no longer repeated inside
          since the header band above carries it. */}
      <div style={{
        background: tintBg,
        border: '0.5px solid var(--border-default)',
        borderTop: `5px solid ${accent}`,
        borderRadius: 'var(--radius-md, 8px)',
        padding: '12px 13px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Headline — the one thing we want them to read. */}
        <div style={{
          fontSize: 15, fontWeight: 700,
          color: 'var(--text-primary)',
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
        }}>
          {primary.title}
        </div>

        {/* Recommendation — the one action we want them to take. */}
        {primary.recommendation && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 7,
            fontSize: 12, lineHeight: 1.4,
            color: 'var(--text-secondary)',
          }}>
            <span aria-hidden style={{
              color: accent, fontWeight: 800, flexShrink: 0,
              fontSize: 13, lineHeight: 1.3,
            }}>→</span>
            <span>{primary.recommendation}</span>
          </div>
        )}

        {/* Footnote — every other concern collapsed to a tag list. */}
        {footnote && (
          <div style={{
            marginTop: 2, paddingTop: 7,
            borderTop: `0.5px dashed ${accent}40`,
            fontSize: 9.5, color: 'var(--text-muted)',
            letterSpacing: '0.03em',
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
            lineHeight: 1.4,
            overflowWrap: 'anywhere',
          }}>
            <span style={{ fontWeight: 800, marginRight: 4, color: 'var(--text-secondary)' }}>ALSO:</span>
            {footnote}
          </div>
        )}
      </div>
    </div>
  );
}

export function MobileEdgeIQ({ data, onOpenTab }) {
  const today = localDate();
  const report = useMemo(() => getSystemsReport(today), [today]);
  const goodCount = report.filter(s => s.status === 'good').length;
  const focusCount = report.filter(s => s.status === 'focus').length;
  const defCount = report.filter(s => s.status === 'def').length;
  const [expandedSystem, setExpandedSystem] = useState(null);
  const handleTileTap = (id) => setExpandedSystem(prev => prev === id ? null : id);

  // DCY for the collapsible details panel (relocated from Start screen)
  const dcyDaily = useMemo(() => {
    try { return dcyToday(); } catch (e) { console.warn('dcy() failed:', e); return null; }
  }, [today]);

  // Cockpit data
  const G = getGoals();
  const profile = useMemo(() => ({ ...(storage.get('profile') || {}), ...G }), [G]);
  // Unified activity universe — see core/dcyMath.js allActivities() for
  // the full dedup model (CSV/manual > FIT, HC excluded).
  const activities = getUnifiedActivities();
  const hrvData = storage.get('hrv') || [];
  const sleepData = cleanSleepForAveraging(storage.get('sleep') || []);
  const cronometer = storage.get('cronometer') || [];

  // Phase 4r.intel.23 — Mobile intelligence pipeline. Same shape as
  // TrainingTab (web EdgeIQ): build userState from current data, then
  // synthesize the multi-hypothesis card grid. Cards render below the
  // Health Systems grid in a mobile-compact stacked layout.
  const intelligence = useMemo(() => {
    // Phase 4r.hygiene.1 — silent catches replaced with safeCompute
    // so failures surface in DevTools as `[MobileEdgeIQ:*] failed: …`
    // instead of returning empty data with no diagnostic.
    const rawInsights = safeCompute('MobileEdgeIQ:generateInsights', () =>
      generateInsights({
        activities, sleep: sleepData, hrv: hrvData,
        weight: storage.get('weight') || [], cronometer, profile,
      }) || [], []
    );
    const userState = safeCompute('MobileEdgeIQ:computeUserState', () =>
      computeUserState({
        activities, sleep: sleepData, hrv: hrvData,
        weight: storage.get('weight') || [], cronometer, profile,
      })
    );
    const cards = userState
      ? safeCompute('MobileEdgeIQ:synthesizeRecommendations', () =>
          synthesizeRecommendations(userState, { rawInsights, rawPrompts: [] }) || [], []
        )
      : [];
    return { userState, cards };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, sleepData, hrvData, cronometer, profile]);
  // Phase 4r.cockpit.1 — weight data for the new Weight tile (was missing
  // from the EdgeIQ scope until now; the Signal Cockpit rewrite needs it).
  const weightData = storage.get('weight') || [];
  const recentWeight = [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const ytdRuns = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart && isRun(a));
  const totalMi = ytdRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
  const totalSessions = activities.filter(a => a.date && parseLocalDate(a.date) >= yearStart).length;

  // ── Signal Cockpit: 7-day rolling window, uniform across all tiles ───────
  // Phase 4r.cockpit.1 — every tile reads the last 7 days, summed or avg'd
  // depending on metric type. Sub-label "7d avg" or "7d Δ" tells the user
  // the window. Tiles with fewer than 7 days of data show their actual
  // window (e.g., "4d avg") instead of looking complete.
  const d7cut = new Date(); d7cut.setDate(d7cut.getDate() - 7); d7cut.setHours(0,0,0,0);

  // Volume: sum of last 7 days
  const last7Activities = activities.filter(a => a.date && new Date(a.date + 'T12:00:00') >= d7cut);
  const last7Runs = last7Activities.filter(isRun);
  const wk7Mi  = last7Runs.reduce((s, a) => s + (a.distanceMi || 0), 0);
  const wk7Hrs = last7Activities.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;

  // Recovery biometrics: 7-day avg (filter null, take mean)
  const avgOf = (arr, field) => {
    const vals = arr.filter(r => r && r.date && new Date(r.date + 'T12:00:00') >= d7cut)
      .map(r => parseFloat(r[field])).filter(v => Number.isFinite(v) && v > 0);
    return vals.length ? { v: vals.reduce((a,b)=>a+b,0) / vals.length, n: vals.length } : { v: null, n: 0 };
  };
  const hrv7   = avgOf(hrvData, 'overnightHRV');
  const hrvSleep = avgOf(sleepData, 'overnightHRV');
  // Prefer sleepData.overnightHRV if it has more samples (matches web EdgeIQ).
  const hrvAvg = hrvSleep.n >= hrv7.n ? hrvSleep : hrv7;
  const rhr7   = avgOf(sleepData, 'restingHR');
  const sleep7 = avgOf(sleepData, 'sleepScore');

  // Nutrition: 7-day avg protein. Use nutDailyTotals so we pull from BOTH
  // cronometer (CSV imports) AND nutritionLog (manual logging in Fuel tab) —
  // same source as the Start screen's Protein tile. Previously read
  // cronometer directly which missed all manually-logged days.
  const protein7 = (() => {
    const vals = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = ymd(d);
      try {
        const t = nutDailyTotals(ds);
        if (t && t.protein > 0) vals.push(t.protein);
      } catch {}
    }
    return vals.length
      ? { v: vals.reduce((a,b)=>a+b,0) / vals.length, n: vals.length }
      : { v: null, n: 0 };
  })();

  // rTSS: 7-day average daily load — sum hrTSS across each day's activities,
  // then average. Anchored to HR (Phase 4r.viz.26).
  const _profile = storage.get('profile') || {};
  const _maxHR = parseFloat(_profile?.maxHR) || 190;
  const _thresholdHR = parseFloat(_profile?.thresholdHR) || null;
  const rtss7 = (() => {
    const dailyLoads = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = ymd(d);
      const acts = activities.filter(a => a.date === ds);
      let total = 0;
      for (const a of acts) {
        try {
          const { hrTSS } = computeHrTSS({
            durationSecs: a.durationSecs,
            avgHR: a.avgHR || a.avgHeartRate,
            maxHR: _maxHR, thresholdHR: _thresholdHR,
          });
          total += hrTSS || 0;
        } catch {}
      }
      if (total > 0) dailyLoads.push(total);
    }
    return dailyLoads.length
      ? { v: dailyLoads.reduce((a,b)=>a+b,0) / dailyLoads.length, n: dailyLoads.length }
      : { v: null, n: 0 };
  })();

  // Weight: current + 7-day delta (trend matters more than absolute)
  const wk7Weight = weightData
    .filter(w => w.date && new Date(w.date + 'T12:00:00') >= d7cut && w.weightLbs)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const latestWeight = recentWeight.find(w => w.weightLbs)?.weightLbs || null;
  const weightDelta = wk7Weight.length >= 2
    ? +(wk7Weight[wk7Weight.length - 1].weightLbs - wk7Weight[0].weightLbs).toFixed(1)
    : null;

  // Format helpers — sub-label honours actual sample count for tiles with
  // fewer than a full week of data.
  const subDays = (n) => n >= 7 ? '7d avg' : n > 0 ? `${n}d avg` : 'no data';
  const fmt1 = (v) => v != null ? (Math.round(v * 10) / 10).toFixed(1) : '—';
  const fmt0 = (v) => v != null ? Math.round(v).toString() : '—';

  const cockpitItems = [
    // ── TOP ROW: rTSS · Miles · Hours · HRV ──
    { label: 'rTSS',  value: fmt0(rtss7.v),    unit: '/day', sub: subDays(rtss7.n),    goal: 100,                              color: C.purple },
    { label: 'Miles', value: fmt1(wk7Mi),       unit: 'mi',   sub: '7d total',          goal: G.weeklyRunDistanceTarget,        color: C.blue },
    { label: 'Hours', value: fmt1(wk7Hrs),      unit: 'hrs',  sub: '7d total',          goal: G.weeklyTimeTargetHrs,            color: C.amber },
    { label: 'HRV',   value: fmt0(hrvAvg.v),    unit: 'ms',   sub: subDays(hrvAvg.n),   goal: G.targetHRV,                      color: C.green },
    // ── BOTTOM ROW: RHR · Sleep · Protein · Weight ──
    { label: 'RHR',     value: fmt0(rhr7.v),     unit: 'bpm',  sub: subDays(rhr7.n),     goal: G.targetRHR,                      color: C.red, lowerIsBetter: true },
    { label: 'Sleep',   value: fmt0(sleep7.v),   unit: '/100', sub: subDays(sleep7.n),   goal: G.targetSleepScore,               color: C.cyan },
    { label: 'Protein', value: fmt0(protein7.v), unit: 'g',    sub: subDays(protein7.n), goal: G.dailyProteinTarget,             color: C.pink },
    { label: 'Weight',  value: latestWeight != null ? fmt1(latestWeight) : '—',
      unit: 'lb',
      sub: weightDelta != null ? `${weightDelta >= 0 ? '+' : ''}${weightDelta} in 7d` : '7d trend',
      // Phase 4r.cockpit.4 — was reading from profile.targetWeight (wrong
      // store). targetWeight is in the goals store alongside targetRHR.
      // Bug meant Weight tile never got a goal value → no progress bar.
      goal: G.targetWeight || parseFloat(_profile?.targetWeight) || null,
      // Phase 4r.cockpit.6 — was referencing C.coral and C.gray which
      // don't exist in the palette → color was undefined → no stripe,
      // no value color, no bar fill. Palette has red/amber/green/etc.
      color: weightDelta == null ? '#9ca3af' : (weightDelta < 0 ? C.green : weightDelta > 0.2 ? C.red : C.amber),
      lowerIsBetter: true,
    },
  ];

  return (
    <div style={{
      background: BG, color: T1, minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      // Phase 4q.frame.1 — single 12px outer frame across every mobile
      // screen. Start, EdgeIQ, Play, Fuel, Core, Labs all sit at 12px
      // from the screen edges. Drill-down tabs get 12px from `.arnold-main`
      // (mobile.css). Mobile-active screens (Start + EdgeIQ) where main
      // padding is zeroed get 12px directly on the wrapper.
      padding: '0 12px 76px', WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Phase 4q.header.5 — Unified header matches drill-down tabs:
          ARNOLD mark + colored gem icon + EdgeIQ label, with the date
          on the right (matches Start/Play/Fuel/Core/Labs treatment).
          Brand-mark colors unified (T3 ARNOLD, C.blue 'A') so the
          stripe reads identically on every screen. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, padding: '10px 0 8px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: 'linear-gradient(135deg, rgba(91,155,213,0.15), rgba(94,196,212,0.1))',
              border: '1px solid rgba(91,155,213,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: C.blue, fontWeight: 800,
            }}>A</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: T3, letterSpacing: '0.14em' }}>ARNOLD</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5, minWidth: 0 }}>
            <Icon.GemSpark color={C.purple} size={18} />
            <span style={{
              fontSize: 16, fontWeight: 600, color: T1,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>EdgeIQ</span>
          </div>
        </div>
        <span style={{
          fontSize: 11, fontWeight: 500, color: T3,
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap', marginTop: 4,
        }}>{(()=>{const d=new Date();return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});})()}</span>
      </div>

      {/* Phase 4r.intel.24 — MobileCalibrationStrip ("BEHIND +0.6 lb drift")
          removed. The same calibration signal is already encoded in the
          primary intelligence tile (multi-hypothesis synthesizer) below
          and in the WEIGHT cockpit tile. Stacking it as a fourth channel
          of the same fact was redundant and pushed the screen toward a
          "wall of text" feel that violated the glance-first principle. */}

      {/* Phase 4r.narrative.5.fix.26 — the unbranded MobileIntelligenceCards
          "PRIORITY · …" tile is replaced by the sigil-marked ambient Coach.
          That tile WAS the Coach's synthesized leverage/action, just without
          the voice. Now it carries the Convergent Wedge sigil so it reads
          unmistakably as "the Coach speaking." It only renders when there's
          an actionable leverage — on an aligned day the screen stays quiet.
          Same <CoachComment> component used on web EdgeIQ, so the Coach is
          one consistent voice across surfaces.
          Phase 4r.narrative.5.fix.28 — mobile EdgeIQ has a DEDICATED focus:
          the recovery/readiness read (HRV/sleep/RHR), distinct from Start
          which shows "the one thing." surface='edgeiq_mobile'. */}
      <CoachComment surface="edgeiq_mobile" />

      {/* ── HEALTH SYSTEMS ── */}
      <div style={sectionHeader}>Health Systems
        <div style={{ display: 'flex', gap: 6, fontSize: 10, color: T3, marginLeft: 'auto' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4ade80' }} />{goodCount}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fbbf24' }} />{focusCount}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f87171' }} />{defCount}
          </span>
        </div>
      </div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
          {report.map(sys => <MobileSystemTile key={sys.id} sys={sys} isActive={expandedSystem === sys.id} onTap={handleTileTap} />)}
        </div>
        {expandedSystem && <SystemDetailPanel systemId={expandedSystem} data={data} comment={report.find(s => s.id === expandedSystem)?.comment} />}
      </div>

      {/* ── SIGNAL COCKPIT ── */}
      {/* Phase 4r.cockpit.1 — 4×2 grid, all tiles 7-day window. Sub-label
          under each tile explicitly states the time scope so there's no
          ambiguity ("7d avg" / "7d total" / "+0.4 in 7d" etc.). */}
      <div style={sectionHeader}>Signal Cockpit <div style={shLine} /></div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {cockpitItems.map((item, i) => {
            const goalVal = parseFloat(item.goal) || 0;
            const val = parseFloat(item.value) || 0;
            // Phase 4r.cockpit.4 — lower-is-better metrics (RHR, Weight)
            // need inverted progress math: when val <= goal you've achieved
            // (or beaten) the target → full bar; when val > goal the bar
            // shrinks proportionally as a "distance from goal" indicator.
            const pct = goalVal > 0
              ? (item.lowerIsBetter
                  ? (val <= goalVal ? 1 : Math.max(0, goalVal / val))
                  : Math.min(val / goalVal, 1))
              : 0;
            return (
              <div key={i} style={{
                position: 'relative', overflow: 'hidden',
                background: CARD_BG, borderRadius: 12, padding: '10px 6px 8px', textAlign: 'center',
                border: `1px solid ${BORDER}`,
              }}>
                <div style={{ position: 'absolute', top: 0, left: 6, right: 6, height: 2, borderRadius: '0 0 2px 2px', background: item.color, opacity: 0.5 }} />
                <div style={{ fontSize: 18, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
                <div style={{ fontSize: 10, color: T4, marginTop: 2 }}>{item.unit}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: T2, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                {item.sub && (
                  <div style={{ fontSize: 9, color: T4, marginTop: 2, fontWeight: 500 }}>{item.sub}</div>
                )}
                {goalVal > 0 && (
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 4 }}>
                    <div style={{ height: 3, background: item.color, borderRadius: 2, width: `${pct * 100}%`, transition: 'width 0.6s ease' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── DCY DETAILS (relocated from Start screen — fits the calibration
          mood of EdgeIQ better than the start headline) ── */}
      <div style={sectionHeader}>DCY Breakdown <div style={shLine} /></div>
      <DcyDetails dcyDaily={dcyDaily} />

      {/* ── ANNUAL PROGRESS ── */}
      <div style={sectionHeader}>Annual Progress <div style={shLine} /></div>
      <div style={card}>
        {[
          { label: 'Run distance', actual: totalMi.toFixed(0), target: G.annualRunDistanceTarget || 800, unit: 'mi', color: C.blue },
          { label: 'Workouts', actual: totalSessions, target: G.annualWorkoutsTarget || 200, unit: '', color: C.purple },
        ].map((p, i) => {
          const pct = Math.min(parseFloat(p.actual) / parseFloat(p.target), 1);
          return (
            <div key={i} style={{ marginBottom: i === 0 ? 10 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: T2, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{p.label}</span>
                <span style={{ fontWeight: 600 }}>{p.actual} / {p.target} {p.unit} <span style={{ color: T4, fontWeight: 500 }}>({Math.round(pct * 100)}%)</span></span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3 }}>
                <div style={{ height: 5, background: p.color, borderRadius: 3, width: `${pct * 100}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}
