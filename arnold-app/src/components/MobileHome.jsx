// ─── MobileHome: Premium Start Dashboard (Mockup Port) ──────────────────────
// Muted warm palette, glass bottom nav with SVG icons, hero rail with readiness
// ring, sleep insight, co-pilot gauges, weekly/monthly/annual sections, and
// multi-item today's plan with workout-type icons.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Sparkline } from "./Sparkline.jsx";
// STATUS/statusFromPct removed — readiness now computed by trainingStress.js
import { getGoals } from "../core/goals.js";
import { storage } from "../core/storage.js";
import { computeDailyScore, computeRolling7d, computeRolling30d } from "../core/trainingStress.js";
import { dcy as dcyToday, dcyWeekly, formatDcy, glyphFor, stateFor } from "../core/dcy.js";
import { todayPlanned, checkTodayCompletion, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";
import useCronometerToday from "../hooks/useCronometerToday.js";

// ─── Local date helper (avoids UTC rollover bug with toISOString) ───────────
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ═══════════════════════════════════════════════════════════════════════════════
// useMobileData — SINGLE SOURCE OF TRUTH for the Start screen.
// Reads ALL data directly from storage. Zero dependence on Arnold.jsx props.
// ═══════════════════════════════════════════════════════════════════════════════
function useMobileData() {
  return useMemo(() => {
    const G = getGoals();
    const profile = storage.get('profile') || {};
    const now = new Date();
    const today = localDate();
    const d30Cutoff = localDate((() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })());
    const yearStart = new Date(now.getFullYear(), 0, 1);

    // ── Raw storage reads ──
    const allActivities = (storage.get('activities') || []).filter(a => a.source !== 'health_connect');
    const dailyLogs = storage.get('dailyLogs') || [];
    const hrvData = storage.get('hrv') || [];
    const rawSleep = storage.get('sleep') || [];
    const sleepData = cleanSleepForAveraging(rawSleep);
    const weightData = storage.get('weight') || [];
    const cronometer = storage.get('cronometer') || [];

    // ── Unified activities (CSV + dailyLogs FIT, deduped) ──
    // Key CSV rows by date|title|time so same-day same-title activities coexist.
    // Iterate every entry in `fitActivities` (new array) and fall back to legacy singular
    // `fitData` for older rows — both paths yield one or more activities per day.
    const csvKey = a => `${a.date}|${a.title || a.activityType || ''}|${a.time || ''}`;
    const byKey = new Map(allActivities.map(a => [csvKey(a), a]));
    const fitCountByDateType = new Map();
    for (const log of dailyLogs) {
      if (!log?.date) continue;
      const fits = Array.isArray(log.fitActivities) && log.fitActivities.length
        ? log.fitActivities
        : (log.fitData ? [log.fitData] : []);
      for (const fd of fits) {
        if (!fd) continue;
        const type = fd.activityType || fd.type || 'workout';
        const dtKey = `${log.date}|${type}`;
        const n = fitCountByDateType.get(dtKey) || 0;
        fitCountByDateType.set(dtKey, n + 1);
        const uniqueKey = `${dtKey}|${fd.startTime || fd.time || n}`;
        if (byKey.has(uniqueKey)) continue;
        byKey.set(uniqueKey, {
          date: log.date,
          distanceMi: fd.distanceMi || null,
          durationSecs: fd.durationSecs || 0,
          activityType: type,
          avgPaceRaw: fd.avgPacePerMi || null,
          startTime: fd.startTime || fd.time || null,
        });
      }
    }
    const activities = [...byKey.values()];

    // ── This week (Mon→Sun) ──
    const dow = now.getDay();
    const mondayOffset = dow === 0 ? 6 : dow - 1;
    const wkStart = new Date(now); wkStart.setDate(now.getDate() - mondayOffset); wkStart.setHours(0, 0, 0, 0);
    const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 7);
    const inThisWeek = (a) => { if (!a.date) return false; const ad = new Date(a.date + 'T12:00:00'); return ad >= wkStart && ad < wkEnd; };
    const thisWeekActs = activities.filter(inThisWeek);
    const thisWeekRuns = thisWeekActs.filter(a => /run/i.test(a.activityType || ''));
    const thisWeekStr = thisWeekActs.filter(a => !/run/i.test(a.activityType || ''));
    const twMi = thisWeekRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
    const twHrs = thisWeekActs.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
    const twSessions = thisWeekActs.length;
    const twStrSessions = thisWeekStr.length;

    // ── 30-day activities ──
    const d30Date = new Date(now - 30 * 86400000);
    const recent30 = activities.filter(a => a.date && new Date(a.date) >= d30Date);
    const recent30Runs = recent30.filter(a => /run/i.test(a.activityType || ''));
    const recent30Str = recent30.filter(a => !/run/i.test(a.activityType || ''));
    const weeks43 = 30 / 7;
    const avg30Mi = (recent30Runs.reduce((s, a) => s + (a.distanceMi || 0), 0) / weeks43).toFixed(1);
    const avg30StrSess = (recent30Str.length / weeks43).toFixed(1);

    // ── Pace (YTD for current value, 30d for avg) ──
    const ytdRuns = activities.filter(a => a.date && new Date(a.date) >= yearStart && /run/i.test(a.activityType || ''));
    const parsePace = (raw) => { if (!raw) return null; const [m, s] = raw.split(':').map(Number); return m * 60 + (s || 0); };
    const fmtPace = (secs) => secs ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : '—';
    const allPaces = ytdRuns.map(a => parsePace(a.avgPaceRaw)).filter(Boolean);
    const avgPaceSecs = allPaces.length ? allPaces.reduce((s, v) => s + v, 0) / allPaces.length : null;
    const goalPaceSecs = (() => { const p = profile?.targetRacePace || '9:30'; const [m, s] = p.split(':').map(Number); return m * 60 + (s || 0); })();

    // ── YTD totals (for annual goals) ──
    const ytdActs = activities.filter(a => a.date && new Date(a.date) >= yearStart);
    const totalMi = ytdRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
    const totalSessions = ytdActs.length;

    // ── 8-week history (for trend sparklines) ──
    const weeklyStats = Array.from({ length: 8 }, (_, i) => {
      const ws = new Date(now); ws.setDate(now.getDate() - (7 * (7 - i) + now.getDay())); ws.setHours(0, 0, 0, 0);
      const we = new Date(ws); we.setDate(ws.getDate() + 7);
      const wAll = activities.filter(a => { const d = new Date(a.date); return d >= ws && d < we; });
      const wRuns = wAll.filter(a => /run/i.test(a.activityType || ''));
      return { mi: wRuns.reduce((s, a) => s + (a.distanceMi || 0), 0), hrs: wAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600, sessions: wAll.length };
    });

    // ── Sleep ──
    const sortedSleep = [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const latestSleepScore = (() => { const s = sortedSleep.find(s => s.sleepScore != null); return s ? Math.min(s.sleepScore, 100) : null; })();
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
    const sortedW = [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const currentWeight = sortedW[0]?.weightLbs || null;
    const currentBF = sortedW[0]?.bodyFatPct || null;
    const w30 = sortedW.filter(v => (v?.date || '') >= d30Cutoff).map(v => v.weightLbs).filter(v => typeof v === 'number');
    const avg30Weight = w30.length ? (w30.reduce((s, v) => s + v, 0) / w30.length).toFixed(1) : '—';

    // ── Nutrition (today + 30d average) ──
    const todayNut = nutDailyTotals(today);
    const todayProtein = todayNut.protein || 0;
    const todayCalories = todayNut.calories || 0;
    // 30-day: build per-day totals from cronometer + nutritionLog
    const recentNut = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(now.getDate() - i);
      const ds = localDate(d);
      const t = nutDailyTotals(ds);
      if (t.calories > 0 || t.protein > 0) recentNut.push({ date: ds, ...t });
    }
    const avg30Protein = recentNut.length ? (recentNut.reduce((s, n) => s + (n.protein || 0), 0) / recentNut.length).toFixed(0) : '—';

    // ── Next race ──
    const nextRace = (() => { try { const races = JSON.parse(localStorage.getItem('arnold:races') || '[]'); const n2 = new Date(); n2.setHours(0, 0, 0, 0); return races.filter(r => r.date && new Date(r.date) >= n2).sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null; } catch { return null; } })();

    return {
      G, profile, today, d30Cutoff,
      // This week
      twMi, twHrs, twSessions, twStrSessions,
      // 30d averages
      avg30Mi, avg30StrSess, avg30Sleep, avg30HRV, avg30Weight, avg30Protein,
      // Latest / current values
      latestSleepScore, latestRHR, latestHRV, currentWeight, currentBF,
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
  }, [localDate()]); // recompute when day changes (or on remount after sync)
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
export const NAV_ITEMS = [
  { id: 'start',  label: 'Start' },
  { id: 'edgeiq', label: 'EdgeIQ', tab: 'weekly' },
  { id: 'play',   label: 'Play',   tab: 'activity' },
  { id: 'fuel',   label: 'Fuel',   tab: 'nutrition_mobile' },
  { id: 'core',   label: 'Core',   tab: 'clinical' },
  { id: 'labs',   label: 'Labs',   tab: 'labs' },
  { id: 'more',   label: 'More' },
];

const SWIPE_ORDER = ['start', 'edgeiq', 'play', 'fuel', 'core', 'labs'];

// ─── Swipe navigation hook ──────────────────────────────────────────────────
export function useSwipeNav({ onSwipeLeft, onSwipeRight, threshold = 60 } = {}) {
  const startX = { current: 0 };
  const startY = { current: 0 };
  return {
    onTouchStart: (e) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
    },
    onTouchEnd: (e) => {
      const dx = e.changedTouches[0].clientX - startX.current;
      const dy = e.changedTouches[0].clientY - startY.current;
      if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0) onSwipeLeft?.();
        else onSwipeRight?.();
      }
    },
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
  Runner: ({ color = C.blue, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="14" cy="4" r="2" /><path d="M8 21l2.5-6 2 1.5" /><path d="M18 13l-3-3.5-2.5-1L10 12" />
      <path d="M18 21l-2.5-7" /><line x1="3" y1="22" x2="21" y2="22" strokeWidth="1" opacity="0.3" />
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
};

// Nav icon map — gamified
const NAV_ICONS = {
  start:  (c) => <Icon.PspX color={c} />,
  edgeiq: (c) => <Icon.GemSpark color={c} />,
  play:   (c) => <Icon.Bolt color={c} />,
  fuel:   (c) => <Icon.GasPump color={c} />,
  core:   (c) => <Icon.Pulse color={c} />,
  labs:   (c) => <Icon.Pipe color={c} />,
  more:   (c) => <Icon.Dots color={c} />,
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
            fontSize: 9, color: C.blue, fontWeight: 800,
          }}>A</div>
          <span style={{ fontSize: 9, fontWeight: 700, color: T3, letterSpacing: '0.14em' }}>ARNOLD</span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: T2, marginTop: 3 }}>
          {greeting}, {profileName || 'friend'}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, color: T4 }}>{date}</div>
      </div>
    </div>
  );
}

// ─── HERO RAIL ──────────────────────────────────────────────────────────────
// Shorten race names: strip parentheticals, known suffixes, and cap length
// "RBC Brooklyn Half (Popular® Brooklyn Half)" → "RBC Brooklyn Half"
// "Run as One JP Morgan" → "Run as One"
function shortRaceName(name, max = 22) {
  if (!name) return 'Race';
  let s = name.replace(/\s*\(.*\)\s*$/, '').trim();
  // Remove common sponsor/org suffixes
  s = s.replace(/\s+(JP\s*Morgan|Chase|Corporate\s*Challenge)\s*$/i, '').trim();
  if (s.length > max) s = s.slice(0, max - 1).trim() + '…';
  return s;
}

function HeroRail({ score, moonScore, scoreLabel, moonScoreLabel, scoreGlyph, scoreSuffix, statusWord, statusColor, factors, stats, raceDaysLeft, raceName, raceDate, raceDistance }) {
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

  const hasRace = raceDaysLeft != null && raceDaysLeft >= 0 && raceDaysLeft <= 120;
  const raceDateStr = raceDate ? new Date(raceDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const shortName = shortRaceName(raceName);

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
            <span style={{ position: 'absolute', bottom: 10, fontSize: 8, fontWeight: 700, color: statusColor, letterSpacing: '0.02em' }}>{scoreGlyph || 'DCY'}</span>
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
            <span style={{ fontSize: 9, fontWeight: 800, color: T1, zIndex: 1 }}>{moonScoreLabel ?? ms}</span>
          </div>
        </div>

        {/* Status + Pills */}
        <div style={{ flex: 1, alignSelf: 'center' }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Daily Score{scoreSuffix || ''}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: statusColor }}>{statusWord}</div>
          <div style={{ display: 'flex', gap: 3, marginTop: 5, flexWrap: 'wrap' }}>
            {factors.map((f, i) => (
              <span key={i} style={{
                fontSize: 8, fontWeight: 600, padding: '2px 7px', borderRadius: 6,
                display: 'inline-flex', alignItems: 'center', gap: 3,
                background: f.type === 'warn' ? 'rgba(207,107,107,0.1)' :
                            f.type === 'ok'   ? 'rgba(91,191,138,0.08)' : 'rgba(255,255,255,0.04)',
                color:      f.type === 'warn' ? C.red :
                            f.type === 'ok'   ? C.green : T3,
              }}>
                {f.type === 'warn' ? '✗' : f.type === 'ok' ? '✓' : '—'} {f.label}
              </span>
            ))}
          </div>
        </div>

        {/* Race countdown — compact pill, top-aligned */}
        {hasRace && (
          <div style={{
            flexShrink: 0, padding: '5px 9px', borderRadius: 10,
            background: 'rgba(224,155,94,0.06)', border: '1px solid rgba(224,155,94,0.12)',
            display: 'flex', alignItems: 'center', gap: 6,
            marginTop: -2,
          }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: C.orange, lineHeight: 1 }}>
              {raceDaysLeft}<span style={{ fontSize: 8, fontWeight: 700 }}>d</span>
            </span>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: '#e6e8ec', lineHeight: 1 }}>{shortName}</div>
              <div style={{ fontSize: 7, color: T4, marginTop: 1 }}>{raceDateStr}</div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom stat row */}
      <div style={{ display: 'flex', borderTop: `1px solid ${BORDER}`, paddingTop: 8 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', position: 'relative',
            borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none',
          }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: T3, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {s.value} <span style={{ fontSize: 8, color: T3 }}>{s.unit}</span>
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
function DcyDetails({ dcyDaily }) {
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
          <SectionHead>Fuel — N {(N * 100).toFixed(0)}%</SectionHead>
          <Row label="Calories" value={`${intake.calories ?? '—'} / ${tgt.calories ?? '—'}`}
            hint={sub.cal != null ? `${(sub.cal * 100).toFixed(0)}%` : '—'}
            color={sub.cal != null ? warnIf(sub.cal * 100) : T1} />
          <Row label="Protein" value={`${intake.protein ?? '—'} g / ${tgt.protein ?? '—'} g`}
            hint={sub.protein != null ? `${(sub.protein * 100).toFixed(0)}%` : '—'}
            color={sub.protein != null ? warnIf(sub.protein * 100) : T1} />
          <Row label="Hydration" value={`${intake.waterL ?? '—'} / ${tgt.waterL ?? '—'} L`}
            hint={sub.hydro != null ? `${(sub.hydro * 100).toFixed(0)}%` : '—'}
            color={sub.hydro != null ? warnIf(sub.hydro * 100) : T1} />
          <Row label="BMR → TDEE" value={`${nut.bmr ?? '—'} → ${nut.tdee ?? '—'}`}
            hint={`${nut.bmrTier || '?'} · burn ${nut.activityBurn ?? 0} · TEF ${nut.tef ?? 0}`} />

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
      fontSize: 9, fontWeight: 700, color: T2, textTransform: 'uppercase',
      letterSpacing: '0.12em', padding: '3px 0 2px',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      <div style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      {CAT_ICONS[label]?.(color)}
      {label}
    </div>
  );
}

// ─── METRIC TILE (Today value + semicircle gauge for 30d avg) ────────────────
function MetricTile({ label, todayVal, todayUnit, trendText, trendColor, avg30, avg30Label, gaugePct, color, onTap }) {
  return (
    <div onClick={onTap} style={{
      ...card, borderRadius: 14, padding: '8px 10px 6px',
      cursor: onTap ? 'pointer' : 'default',
    }}>
      {/* Top accent */}
      <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, borderRadius: '0 0 2px 2px', background: color, opacity: 0.7 }} />

      {/* Label */}
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color, marginBottom: 4 }}>{label}</div>

      {/* Body: value left, gauge right */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {/* Left: value + trend */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{todayVal}</span>
            {todayUnit ? <span style={{ fontSize: 9, color: T3, marginLeft: 2 }}>{todayUnit}</span> : null}
          </div>
          <div style={{ fontSize: 8, fontWeight: 600, color: trendColor || T3, marginTop: 3, height: 12 }}>
            {trendText || '\u00A0'}
          </div>
        </div>

        {/* Right: semicircle arc + value below + label */}
        <div style={{ flexShrink: 0, width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <MiniArcGauge pct={gaugePct} color={color} />
          <div style={{ fontSize: 10, fontWeight: 700, color, lineHeight: 1, marginTop: 0 }}>{avg30}</div>
          <div style={{ fontSize: 7, color: T4, fontWeight: 600, marginTop: 1, letterSpacing: '0.04em' }}>
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
          { lbl: 'Miles', v: miles },
          { lbl: 'Sessions', v: sessions },
          { lbl: 'Time', v: time },
        ].map((col, i) => (
          <div key={i} style={{ flex: 1 }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{col.lbl}</div>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>{col.v}</div>
          </div>
        ))}
      </div>
      <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(weeklyMiPct * 100, 100)}%`, height: '100%', borderRadius: 2, background: C.blue, opacity: 0.6, transition: 'width 0.6s' }} />
      </div>
      <div style={{ fontSize: 8, color: T4, marginTop: 3 }}>{miles} / {weeklyTarget} mi</div>
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
      <div style={{ fontSize: 8, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{now.getFullYear()} Timeline</div>

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
              width: 12, height: 12, borderRadius: 6,
              background: r.isPast ? 'rgba(91,191,138,0.15)' : 'rgba(212,139,78,0.15)',
              border: `1.5px solid ${r.isPast ? C.green : C.orange}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: 6 }}>{r.isPast ? '✓' : '⚑'}</span>
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
              fontSize: 7, fontWeight: 600, color: r.isPast ? C.green : C.orange, whiteSpace: 'nowrap',
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
            <span style={{ fontSize: 9, fontWeight: 700, color: T2 }}>{runMiActual} <span style={{ fontSize: 7, color: T4 }}>/ {runMiGoal}</span></span>
          </div>
          <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
            <div style={{ width: `${runPct * 100}%`, height: '100%', borderRadius: 2, background: C.blue, opacity: 0.7 }} />
          </div>
        </div>
        {/* Workouts goal */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 7, fontWeight: 600, color: C.purple, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Workouts</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: T2 }}>{workoutsActual} <span style={{ fontSize: 7, color: T4 }}>/ {workoutsGoal}</span></span>
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
function CoreSummary({ hrv, rhr, weight, bodyFat, onTap }) {
  const items = [
    { label: 'Weight',   value: weight || '—',  unit: 'lb',    color: C.amber },
    { label: 'Body Fat', value: bodyFat || '—',  unit: '%',     color: C.red },
    { label: 'RMR',      value: '—',             unit: 'kcal',  color: C.orange },
    { label: 'HRV',      value: hrv || '—',      unit: 'ms',    color: C.green },
    { label: 'RHR',      value: rhr || '—',      unit: 'bpm',   color: C.purple },
    { label: 'VO2max',   value: '—',             unit: 'mL/kg', color: C.cyan },
  ];
  return (
    <div onClick={onTap} style={{ ...card, borderRadius: 14, padding: '10px 12px', cursor: 'pointer' }}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(107,207,154,0.15), transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Icon.Pulse color={C.green} size={12} />
          <span style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Body · Recovery · Vitals</span>
        </div>
        <span style={{ fontSize: 10, color: T3 }}>→</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, rowGap: 10 }}>
        {items.map((it, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: it.color, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>{it.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>{it.value}</div>
            <div style={{ fontSize: 8, color: T3, marginTop: 1 }}>{it.unit}</div>
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
          <span style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Labs{dateStr ? ` · ${dateStr}` : ''}</span>
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

// ─── TODAY'S PLAN ───────────────────────────────────────────────────────────
function TodaysPlan({ items, onTap }) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(155,142,196,0.15), transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{date}</span>
        <span style={{
          fontSize: 8, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
          background: 'rgba(155,142,196,0.08)', color: C.purple, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>{items.length} Planned</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => (
          <div key={i} onClick={() => onTap?.(item)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', borderRadius: 10,
            background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.03)',
            cursor: 'pointer',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: item.iconType === 'strength' ? 'rgba(155,142,196,0.1)' : 'rgba(91,155,213,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {item.iconType === 'strength' ? <Icon.Dumbbell /> : <Icon.Runner />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</div>
              <div style={{ fontSize: 10, color: T3, marginTop: 1 }}>{item.detail}</div>
            </div>
            {item.time && <div style={{ fontSize: 10, color: T4, fontWeight: 600 }}>{item.time}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MORE MENU ──────────────────────────────────────────────────────────────
function MoreMenu({ onClose, onMenuTap }) {
  const items = [
    { id: 'goals', label: 'Goals', icon: '🎯' },
    { id: 'races', label: 'Races', icon: '🏁' },
    { id: 'stack', label: 'Stack', icon: '💊' },
    { id: 'sync',  label: 'Cloud Sync',  icon: '☁️' },
    { id: 'profile', label: 'Profile', icon: '👤' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', zIndex: 40, display: 'flex', alignItems: 'flex-end' }} onClick={onClose}>
      <div style={{ borderRadius: '20px 20px 0 0', width: '100%', padding: '20px 16px 32px', background: 'rgba(20,22,30,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, margin: '0 auto 20px' }} />
        {items.map(item => (
          <div key={item.id} onClick={() => { onMenuTap(item.id); onClose(); }} style={{
            padding: '12px 16px', marginBottom: 8, borderRadius: 12,
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
          }}>
            <div style={{ fontSize: 18 }}>{item.icon}</div>
            <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{item.label}</div>
            <div style={{ fontSize: 16, color: T4 }}>→</div>
          </div>
        ))}
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

            {/* Label */}
            <span style={{
              fontSize: 8, fontWeight: isActive ? 700 : 500,
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

// ─── ERROR BOUNDARY WRAPPER ─────────────────────────────────────────────────
function MobileHomeInner({ data, onOpenTab, initialView }) {
  // ── ALL data from single hook — no Arnold.jsx prop dependencies ──
  const D = useMobileData();
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
  const raceDaysLeft = nextRace?.date ? Math.ceil((new Date(nextRace.date) - new Date()) / 86400000) : null;
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

  // RUN
  const runTiles = [
    buildTile('Weekly Miles', twMi.toFixed(1), 'mi',
      trendVsLastWk(twMi, weeklyStats?.map(w => w.mi ?? w.miles)),
      avg30Mi, parseFloat(avg30Mi) / (G.weeklyRunDistanceTarget || 20), C.blue, 'activity'),
    buildTile('Avg Pace', paceStr, '/mi',
      { text: '→ tracking', color: T3 },
      paceStr, avgPaceSecs ? Math.min((goalPaceSecs || 600) / avgPaceSecs, 1) : 0, C.cyan, 'activity'),
  ];

  // STRENGTH
  const twStrTarget = G.weeklyStrengthTarget || 2;
  const twStr = twStrSessions;
  const strTrend = twStr >= twStrTarget
    ? { text: '→ on target', color: C.green }
    : { text: `${twStr}/${twStrTarget} this wk`, color: C.amber };
  const strengthTiles = [
    buildTile('Sessions', twStr, '/wk',
      strTrend,
      avg30StrSessions,
      twStr / twStrTarget, C.purple, 'activity'),
    buildTile('Pull-ups', G.pullUpsTarget || '—', 'reps',
      { text: '', color: T3 },
      '—', 0, C.pink, 'activity'),
  ];

  // RECOVERY
  const recoveryTiles = [
    buildTile('Sleep Score', latestSleepScore || '—', 'pts',
      trendVsLastWk(latestSleepScore, sortedSleep?.slice(-8).map(s => typeof s === 'number' ? s : s?.sleepScore)),
      avg30Sleep, parseFloat(avg30Sleep) / (G.targetSleepScore || 85), C.cyan, 'clinical'),
    buildTile('HRV', latestHRV?.toFixed?.(0) ?? latestHRV ?? '—', 'ms',
      trendVsLastWk(latestHRV, hrvData?.slice(-8).map(h => typeof h === 'number' ? h : h?.overnightHRV)),
      avg30HRV, parseFloat(avg30HRV) / (G.targetHRV || 70), C.green, 'clinical'),
  ];

  // BODY (weight: down is good, so invert trend color)
  const weightTrend = (() => {
    const t = trendVsLastWk(currentWeight, sortedW?.slice(-8).map(w => typeof w === 'number' ? w : w?.weightLbs));
    if (t.color === C.red) return { ...t, color: C.green };
    if (t.color === C.green) return { ...t, color: C.red };
    return t;
  })();

  const bodyTiles = [
    buildTile('Weight', currentWeight?.toFixed(1) || '—', 'lb',
      weightTrend,
      avg30Weight, G.targetWeight ? Math.max(0, 1 - Math.abs(parseFloat(avg30Weight || 0) - G.targetWeight) / 20) : 0.5,
      C.amber, 'clinical'),
    buildTile('Protein', todayProtein ? Math.round(todayProtein) : '—', 'g',
      trendVsLastWk(todayProtein, recentNut?.slice(-7).map(n => n.protein)),
      avg30Protein, parseFloat(avg30Protein || 0) / (G.dailyProteinTarget || 150),
      C.pink, 'nutrition_mobile'),
  ];
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
      const dayType = plan.type || 'run';
      if (dayType === 'strength' || dayType === 'cross') {
        items.push({ iconType: 'strength', title: plan.label || 'Strength', detail: plan.description || 'Upper body · 45 min', time: 'AM' });
      } else if (dayType === 'rest') {
        items.push({ iconType: 'strength', title: 'Rest Day', detail: 'Recovery focus · Stretch & hydrate', time: '' });
      } else {
        items.push({ iconType: 'run', title: plan.label || 'Run', detail: plan.description || 'Easy run', time: 'AM' });
      }
    } else {
      items.push({ iconType: 'strength', title: 'Strength · Upper Body', detail: 'Chest, shoulders, triceps · 45 min', time: 'AM' });
      items.push({ iconType: 'run', title: 'Easy Run', detail: 'Recovery · 3 mi @ 10:30 pace', time: 'PM' });
    }
    return items;
  })();

  // ── Today's completed training (Phase 4a) ─────────────────────────────────
  // Summary-level rendering for the "Today's Activity" strip under the Plan
  // card. Reads structured workouts from `activities` filtered to today.
  // Used as the source for both the summary UI and the adaptive-layout
  // branch of "Going about my day" (compact when training exists).
  const todayDoneItems = (() => {
    try {
      const today = localDate();
      const acts = (storage.get('activities') || []).filter(a => a && a.date === today);
      return acts.map(a => {
        const typ = (a.activityType || '').toLowerCase();
        const isRun = /run/.test(typ);
        const isStrength = /strength|weight|gym|hyrox|circuit/.test(typ);
        const kind = isRun ? 'Run' : isStrength ? 'Strength' : (a.activityType || 'Activity');
        const mins = Math.round((Number(a.durationSecs) || (Number(a.durationMins) || 0) * 60) / 60);
        const miles = a.distanceMi ? `${Number(a.distanceMi).toFixed(1)} mi · ` : '';
        return { kind, summary: `${miles}${mins} min`, iconType: isStrength ? 'strength' : 'run' };
      });
    } catch { return []; }
  })();
  const hasTraining = todayDoneItems.length > 0;

  // ── Today's Movement (Phase 4a) ───────────────────────────────────────────
  // Ambient NEAT from Health Connect via syncDailyEnergy(). Null when no row
  // exists for today yet. Drives the "Going about my day" card.
  const todayMovement = (() => {
    try {
      const today = localDate();
      const logs = storage.get('dailyLogs') || [];
      const entry = logs.find(e => e && e.date === today);
      if (!entry) return null;
      const steps = Number(entry.steps) || 0;
      const active = Number(entry.activeCalories) || 0;
      const total = Number(entry.totalCalories) || 0;
      if (steps === 0 && total === 0) return null;
      return { steps, active, total };
    } catch { return null; }
  })();

  // ── Swipe ──
  const swipeHandlers = useSwipeNav({
    onSwipeLeft: () => {
      const idx = SWIPE_ORDER.indexOf(activeNav);
      if (idx < SWIPE_ORDER.length - 1) setActiveNav(SWIPE_ORDER[idx + 1]);
    },
    onSwipeRight: () => {
      const idx = SWIPE_ORDER.indexOf(activeNav);
      if (idx > 0) setActiveNav(SWIPE_ORDER[idx - 1]);
    },
  });

  const handleNavTap = (id) => {
    if (id === 'more') { setMoreOpen(true); return; }
    setActiveNav(id);
    const navItem = NAV_ITEMS.find(n => n.id === id);
    if (navItem?.tab) onOpenTab?.(navItem.tab);
  };

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

  // ── RENDER ──
  return (
    <div style={{
      background: BG, color: T1, minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      padding: '0 10px 76px',
      WebkitFontSmoothing: 'antialiased',
    }} {...swipeHandlers}>

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
        factors={factors}
        stats={heroStats}
        raceDaysLeft={raceDaysLeft}
        raceName={raceLabel}
        raceDate={nextRace?.date}
        raceDistance={nextRace?.distanceMi ? `${nextRace.distanceMi} mi` : nextRace?.distanceKm ? `${nextRace.distanceKm} km` : ''}
      />

      <DcyDetails dcyDaily={dcyDaily} />

      <SleepInsight headline={advisory.hl} detail={advisory.detail} iconKey={advisory.iconKey} iconColor={advisory.color} />

      {/* ── RUN ── */}
      <CategoryLabel label="Run" color={C.blue} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {runTiles.map((t, i) => (
          <MetricTile key={`run-${i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── STRENGTH ── */}
      <CategoryLabel label="Strength" color={C.purple} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {strengthTiles.map((t, i) => (
          <MetricTile key={`str-${i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── RECOVERY ── */}
      <CategoryLabel label="Recovery" color={C.green} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {recoveryTiles.map((t, i) => (
          <MetricTile key={`rec-${i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor}
            onTap={() => onOpenTab?.(t.tapTab)}
          />
        ))}
      </div>

      {/* ── BODY ── */}
      <CategoryLabel label="Body" color={C.amber} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
        {bodyTiles.map((t, i) => (
          <MetricTile key={`body-${i}`}
            label={t.label} todayVal={t.todayVal} todayUnit={t.todayUnit}
            trendText={t.trendText} trendColor={t.trendColor}
            avg30={t.avg30} gaugePct={t.gaugePct} color={t.tileColor}
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

      {/* Today's Plan */}
      <div style={sectionHeader}>Today's Plan <div style={shLine} /></div>
      <TodaysPlan items={planItems} onTap={() => onOpenTab?.('plan')} />

      {/* Today's Activity — completed training summary under the Plan tile.
          Hidden when no training was done today to keep the plan crisp. */}
      {hasTraining && (
        <div style={{ ...card, marginTop: -4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T4, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Today's Activity
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {todayDoneItems.map((it, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: T2 }}>
                <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 700 }}>✓</span>
                <span style={{ fontWeight: 600 }}>{it.kind}</span>
                <span style={{ color: T3 }}>· {it.summary}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
                <div style={{ fontSize: 9, color: T4, marginTop: 4 }}>steps</div>
              </div>
              <div style={{ background: BG, borderRadius: 10, padding: '12px 6px 10px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.amber, lineHeight: 1 }}>{Math.round(todayMovement.active)}</div>
                <div style={{ fontSize: 9, color: T4, marginTop: 4 }}>active kcal</div>
              </div>
              <div style={{ background: BG, borderRadius: 10, padding: '12px 6px 10px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: C.green, lineHeight: 1 }}>{Math.round(todayMovement.total)}</div>
                <div style={{ fontSize: 9, color: T4, marginTop: 4 }}>total kcal</div>
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
        bodyFat={currentBF?.toFixed(1)}
        onTap={() => onOpenTab?.('clinical')}
      />

      {/* Labs Summary */}
      <div style={sectionHeader}>Labs <div style={shLine} /></div>
      <LabsSummary
        labSnapshots={data?.labSnapshots}
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
import { getSystemsReport, getSystemDetail, getSystemWeekly, SYSTEMS } from "../core/healthSystems.js";

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
  const icon = SYSTEM_ICONS_M[sys.id]?.(sys.color) || null;
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
          width: 26, height: 26, margin: '0 auto 5px', borderRadius: 7,
          background: `${sys.color}12`, border: `1px solid ${sys.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: T2, lineHeight: 1.15, marginBottom: 3, minHeight: 20 }}>
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

  if (!detail) return null;
  const { system, details: nutrients } = detail;
  const signals = SYSTEM_SIGNALS[systemId] || { training: [], body: [], blood: [] };
  const icon = SYSTEM_ICONS_M[systemId]?.(system.color) || null;
  // Status color matches the tile: green ≥80, yellow ≥50, red <50
  const statusColor = (system.pct || 0) >= 80 ? '#4ade80' : (system.pct || 0) >= 50 ? '#fbbf24' : '#f87171';

  // Gather live training/body/blood values
  const activities = storage.get('activities') || [];
  const sleepData = cleanSleepForAveraging(storage.get('sleep') || []);
  const hrvData = storage.get('hrv') || [];
  const weightData = storage.get('weight') || [];
  const labSnaps = [...(data?.labSnapshots || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const labMarkers = labSnaps[0]?.markers || {};

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const d7 = new Date(); d7.setDate(d7.getDate() - 7);
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);

  const recentSleep = [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentHRV = [...hrvData].filter(h => h.overnightHRV).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const recentWeight = [...weightData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ytdRuns = activities.filter(a => a.date && new Date(a.date) >= yearStart && /run/i.test(a.activityType || ''));
  const ytdAll = activities.filter(a => a.date && new Date(a.date) >= yearStart);
  const wk7 = activities.filter(a => a.date && new Date(a.date) >= d7);
  const wk7Runs = wk7.filter(a => /run/i.test(a.activityType || ''));
  const wk7Str = wk7.filter(a => /strength|weight|gym/i.test(a.activityType || ''));

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
          width: 34, height: 34, borderRadius: 9,
          background: `${system.color}18`, border: `1px solid ${system.color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T1 }}>{system.name}</div>
          <div style={{ fontSize: 9, color: T3, marginTop: 1 }}>{comment || 'Tap tile again to close'}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: statusColor, lineHeight: 1 }}>{detail.system.pct || 0}%</div>
          <div style={{ fontSize: 8, color: T3, marginTop: 2 }}>today</div>
        </div>
      </div>

      {/* Tab bar: Daily / Weekly / Annual */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, marginBottom: 10 }}>
        <div style={tabStyle(detailTab === 'daily')} onClick={() => setDetailTab('daily')}>Daily</div>
        <div style={tabStyle(detailTab === 'weekly')} onClick={() => setDetailTab('weekly')}>Weekly</div>
        <div style={tabStyle(detailTab === 'annual')} onClick={() => setDetailTab('annual')}>Annual</div>
      </div>

      {/* ── Daily tab ── */}
      {detailTab === 'daily' && (
        <div>
          {/* Nutrient breakdown */}
          <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Nutrients</div>
          {nutrients.map((n, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T2, marginBottom: 2 }}>
                <span style={{ fontWeight: 600 }}>{n.short}</span>
                <span style={{ color: barColor(n.pct), fontWeight: 600 }}>{n.value} / {n.target} <span style={{ color: T4, fontWeight: 500 }}>({n.pct}%)</span></span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <div style={{ height: 4, background: barColor(n.pct), borderRadius: 2, width: `${Math.min(n.pct, 100)}%`, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          ))}

          {/* Training signals */}
          {signals.training.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Training</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.training.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.training.map((sig, i) => {
                  const r = resolveSignal(sig, 'daily');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 8, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Body signals */}
          {signals.body.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Body</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.body.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.body.map((sig, i) => {
                  const r = resolveSignal(sig, 'daily');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 8, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Blood markers */}
          {signals.blood.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Blood</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.blood.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.blood.map((sig, i) => {
                  const r = resolveBlood(sig);
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Weekly tab ── */}
      {detailTab === 'weekly' && (
        <div>
          {/* 7-day sparkline bar chart */}
          <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>7-Day Score</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            {weekly.map((d, i) => {
              const barH = weeklyMax > 0 ? Math.max(4, Math.round((d.pct / weeklyMax) * 70)) : 4;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 9, color: barColor(d.pct), fontWeight: 700, marginBottom: 3 }}>{d.pct}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 70 }}>
                    <div style={{
                      width: '100%', borderRadius: 4,
                      height: barH,
                      background: barColor(d.pct),
                      transition: 'height 0.4s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 8, color: T4, marginTop: 3 }}>{d.dayLabel}</div>
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
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Weekly Training</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.training.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.training.map((sig, i) => {
                  const r = resolveSignal(sig, 'weekly');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 8, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Nutrient averages hint */}
          <div style={{ fontSize: 9, color: T4, marginTop: 10, textAlign: 'center', fontStyle: 'italic' }}>
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
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>YTD Training</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.training.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.training.map((sig, i) => {
                  const r = resolveSignal(sig, 'annual');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 8, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Body — current snapshot */}
          {signals.body.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Body (Current)</div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.body.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.body.map((sig, i) => {
                  const r = resolveSignal(sig, 'daily');
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 8, color: T4, marginTop: 2 }}>{r.unit}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Blood markers — latest panel */}
          {signals.blood.length > 0 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>
                Blood (Latest Panel{labSnaps[0]?.date ? ` · ${labSnaps[0].date}` : ''})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(signals.blood.length, 3)}, 1fr)`, gap: 6 }}>
                {signals.blood.map((sig, i) => {
                  const r = resolveBlood(sig);
                  return (
                    <div key={i} style={{ background: BG, borderRadius: 10, padding: '10px 6px 8px', textAlign: 'center', border: `1px solid ${BORDER}` }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: r.value === '—' ? T4 : T1, lineHeight: 1 }}>{r.value}</div>
                      <div style={{ fontSize: 9, fontWeight: 600, color: T3, marginTop: 3 }}>{sig}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Top nutrients for this system */}
          <div style={{ fontSize: 9, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 10, marginBottom: 6 }}>Key Nutrients (Today)</div>
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

export function MobileEdgeIQ({ data, onOpenTab }) {
  const today = localDate();
  const report = useMemo(() => getSystemsReport(today), [today]);
  const goodCount = report.filter(s => s.status === 'good').length;
  const focusCount = report.filter(s => s.status === 'focus').length;
  const defCount = report.filter(s => s.status === 'def').length;
  const [expandedSystem, setExpandedSystem] = useState(null);
  const handleTileTap = (id) => setExpandedSystem(prev => prev === id ? null : id);

  // Cockpit data
  const G = getGoals();
  const activities = storage.get('activities') || [];
  const hrvData = storage.get('hrv') || [];
  const sleepData = cleanSleepForAveraging(storage.get('sleep') || []);
  const cronometer = storage.get('cronometer') || [];

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const ytdRuns = activities.filter(a => a.date && new Date(a.date) >= yearStart && /run/i.test(a.activityType || ''));
  const totalMi = ytdRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
  const totalSessions = activities.filter(a => a.date && new Date(a.date) >= yearStart).length;

  // 8-week stats
  const weeklyStats = Array.from({ length: 8 }, (_, i) => {
    const wStart = new Date(now); wStart.setDate(now.getDate() - (7 * (7 - i) + now.getDay())); wStart.setHours(0, 0, 0, 0);
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
    const wAll = activities.filter(a => { const d = new Date(a.date); return d >= wStart && d < wEnd; });
    const wRuns = wAll.filter(a => /run/i.test(a.activityType || ''));
    const mi = wRuns.reduce((s, a) => s + (a.distanceMi || 0), 0);
    const hrs = wAll.reduce((s, a) => s + (a.durationSecs || 0), 0) / 3600;
    return { mi, hrs, sessions: wAll.length };
  });
  const avgWeeklyMi = weeklyStats.reduce((s, w) => s + w.mi, 0) / 8;
  const avgWeeklyHrs = weeklyStats.reduce((s, w) => s + w.hrs, 0) / 8;

  // Recent biometrics
  const recentHRV = [...hrvData].filter(h => h.overnightHRV).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestHRV = recentHRV[0]?.overnightHRV || null;
  const recentSleep = [...sleepData].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const latestSleepScore = recentSleep.find(s => s.sleepScore)?.sleepScore || null;
  const latestRHR = recentSleep.find(s => s.restingHR)?.restingHR || null;

  // Nutrition
  const d30 = new Date(); d30.setDate(d30.getDate() - 30);
  const recentNut = cronometer.filter(c => c.date >= localDate(d30) && c.calories);
  const avgProtein = recentNut.length ? Math.round(recentNut.reduce((s, c) => s + (parseFloat(c.protein) || 0), 0) / recentNut.length) : null;

  const cockpitItems = [
    { label: 'Avg Miles/wk', value: avgWeeklyMi.toFixed(1), unit: 'mi', goal: G.weeklyRunDistanceTarget, color: C.blue },
    { label: 'Avg Hours/wk', value: avgWeeklyHrs.toFixed(1), unit: 'hrs', goal: G.weeklyTimeTargetHrs, color: C.purple },
    { label: 'HRV', value: latestHRV || '—', unit: 'ms', goal: G.targetHRV, color: C.green },
    { label: 'RHR', value: latestRHR || '—', unit: 'bpm', goal: G.targetRHR, color: C.amber },
    { label: 'Sleep', value: latestSleepScore || '—', unit: '/100', goal: G.targetSleepScore, color: C.cyan },
    { label: 'Protein', value: avgProtein || '—', unit: 'g', goal: G.dailyProteinTarget, color: C.pink },
  ];

  return (
    <div style={{
      background: BG, color: T1, minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      padding: '0 10px 76px', WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Header — matches Start screen */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0 8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 6,
              background: 'linear-gradient(135deg, rgba(91,155,213,0.15), rgba(94,196,212,0.1))',
              border: '1px solid rgba(91,155,213,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, color: C.blue, fontWeight: 800,
            }}>A</div>
            <span style={{ fontSize: 9, fontWeight: 700, color: T3, letterSpacing: '0.14em' }}>ARNOLD</span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T2, marginTop: 3 }}>EdgeIQ</div>
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: C.blue }}>YTD</span>
          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(107,171,223,0.12)', color: C.blue }}>{totalMi.toFixed(0)} mi</span>
        </div>
      </div>

      {/* ── HEALTH SYSTEMS ── */}
      <div style={sectionHeader}>Health Systems
        <div style={{ display: 'flex', gap: 6, fontSize: 8, color: T3, marginLeft: 'auto' }}>
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
      <div style={sectionHeader}>Signal Cockpit <div style={shLine} /></div>
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {cockpitItems.map((item, i) => {
            const goalVal = parseFloat(item.goal) || 0;
            const val = parseFloat(item.value) || 0;
            const pct = goalVal > 0 ? Math.min(val / goalVal, 1) : 0;
            return (
              <div key={i} style={{
                position: 'relative', overflow: 'hidden',
                background: CARD_BG, borderRadius: 12, padding: '12px 8px 10px', textAlign: 'center',
                border: `1px solid ${BORDER}`,
              }}>
                <div style={{ position: 'absolute', top: 0, left: 8, right: 8, height: 2, borderRadius: '0 0 2px 2px', background: item.color, opacity: 0.5 }} />
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
                <div style={{ fontSize: 9, color: T4, marginTop: 2 }}>{item.unit}</div>
                <div style={{ fontSize: 9, fontWeight: 700, color: T2, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                {goalVal > 0 && (
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6 }}>
                    <div style={{ height: 3, background: item.color, borderRadius: 2, width: `${pct * 100}%`, transition: 'width 0.6s ease' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

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
