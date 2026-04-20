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
import { todayPlanned, checkTodayCompletion, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";

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

function HeroRail({ score, moonScore, scoreSuffix, statusWord, statusColor, factors, stats, raceDaysLeft, raceName, raceDate, raceDistance }) {
  // Main ring (7-day) geometry
  const mainR = 24, mainSW = 4, mainSize = 58;
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
        <div style={{ position: 'relative', width: 62, height: 62, flexShrink: 0, alignSelf: 'center' }}>
          {/* Main ring (7-day) */}
          <svg width="58" height="58" viewBox="0 0 58 58" style={{ position: 'absolute', top: 2, left: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="29" cy="29" r="24" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
            <circle cx="29" cy="29" r="24" fill="none" stroke={statusColor} strokeWidth="4"
              strokeDasharray={mainCirc} strokeDashoffset={mainOffset} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div style={{ position: 'absolute', top: 2, left: 0, width: 58, height: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: T1 }}>{score}</span>
            <span style={{ fontSize: 7, fontWeight: 600, color: T4, marginTop: 1 }}>7d</span>
          </div>

          {/* Moon ring (30-day) — small satellite, top-left (10 o'clock) of main ring */}
          <div style={{
            position: 'absolute', top: -4, left: -8, width: 28, height: 28,
            borderRadius: '50%', background: BG,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 26 26" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
              <circle cx="13" cy="13" r="10" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.5" />
              {ms > 0 && <circle cx="13" cy="13" r="10" fill="none" stroke={moonColor} strokeWidth="2.5"
                strokeDasharray={moonCirc} strokeDashoffset={moonOffset} strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }} />}
            </svg>
            <span style={{ fontSize: 9, fontWeight: 800, color: T1, zIndex: 1 }}>{ms}</span>
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
function SleepInsight({ headline, detail }) {
  return (
    <div style={{ ...card, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: 'rgba(94,196,212,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon.Moon />
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
  // Pick key markers to show
  const keyMarkers = [
    { key: 'testosterone', label: 'Testo', unit: 'ng/dL', color: C.blue },
    { key: 'vitaminD', label: 'Vit D', unit: 'ng/mL', color: C.amber },
    { key: 'hsCRP', label: 'hsCRP', unit: 'mg/L', color: C.red },
    { key: 'ferritin', label: 'Ferritin', unit: 'ng/mL', color: C.green },
    { key: 'HbA1c', label: 'A1c', unit: '%', color: C.pink },
    { key: 'TSH', label: 'TSH', unit: 'mU/L', color: C.purple },
  ].filter(m => markers[m.key] != null);

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
              <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>{typeof markers[m.key] === 'number' ? markers[m.key].toFixed(markers[m.key] < 10 ? 1 : 0) : markers[m.key]}</div>
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
function MobileHomeInner({
  data, focusItems, weeklyStats, avgWeeklyMi, avgWeeklyHrsTotal,
  avgPaceSecs, goalPaceSecs, fmtPace, totalMi, annualRunTarget, totalSessions,
  thisWeek, sortedSleep, hrvData, sortedW, currentWeight, currentBF, latestSleepScore,
  avgHRV30, recentNut, avgProtein, latestRHR, nextRace, onOpenTab, initialView
}) {
  const [activeNav, setActiveNav] = useState(initialView || 'start');
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (initialView && initialView !== activeNav) setActiveNav(initialView);
  }, [initialView]);

  const G = getGoals();
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

  // ── Format pace helper (fmtPace may be a function or a string) ──
  const paceStr = typeof fmtPace === 'function' ? fmtPace(avgPaceSecs) : (fmtPace || '—');

  // ── Rolling Scores (7-day weighted + 30-day average) ──
  const rolling7 = useMemo(() => {
    try { return computeRolling7d(); } catch { return { score: 0, daily: [], todayScore: { score: 0, sessionType: 'rest', sessionMetric: null, factors: [] } }; }
  }, []);
  const rolling30 = useMemo(() => {
    try { return computeRolling30d(); } catch { return { score: 0, daily: [] }; }
  }, []);

  const mainScore = rolling7.score;
  const moonScore = rolling30.score;
  const todayResult = rolling7.todayScore || {};

  // Today's deposit for the parenthetical
  const scoreSuffix = todayResult.sessionMetric
    ? ` (${todayResult.sessionMetric.label} ${todayResult.sessionMetric.value})`
    : '';

  let statusColor = C.blue, statusWord = 'On Track';
  if (mainScore >= 70) { statusColor = C.green; statusWord = 'On Track'; }
  else if (mainScore >= 45) { statusColor = C.amber; statusWord = 'Needs Work'; }
  else if (mainScore > 0) { statusColor = C.red; statusWord = 'Behind'; }
  else { statusColor = C.blue; statusWord = 'No Data'; }

  // ── Factor pills from today's score ──
  const factors = useMemo(() => {
    if (!todayResult.factors?.length) return [{ label: 'No data', type: 'neutral' }];
    return todayResult.factors.map(f => ({
      label: f.label,
      type: f.status === 'good' ? 'ok' : f.status === 'poor' ? 'warn' : 'neutral',
    }));
  }, [todayResult]);

  // ── Race countdown ──
  const raceDaysLeft = nextRace?.date ? Math.ceil((new Date(nextRace.date) - new Date()) / 86400000) : null;
  const raceLabel = nextRace ? `${nextRace.name || 'Race'}` : '';

  // ── Hero stats ──
  const heroStats = [
    { label: 'Miles/wk', value: (thisWeek?.mi || 0).toFixed(1), unit: 'mi' },
    { label: 'Sleep', value: latestSleepScore || '—', unit: '/100' },
    { label: 'Protein', value: avgProtein?.toFixed(0) || '0', unit: 'g' },
    { label: 'Weight', value: currentWeight?.toFixed(1) || '—', unit: 'lb' },
  ];

  // ── Sleep insight ──
  const sleepHrs = (() => {
    if (!sortedSleep?.length) return '7';
    const last = sortedSleep[sortedSleep.length - 1];
    const score = typeof last === 'number' ? last : last?.sleepScore;
    return typeof score === 'number' && !isNaN(score) ? (score / 100 * 8).toFixed(0) : '7';
  })();
  const sleepInsight = (() => {
    const score = latestSleepScore || 0;
    if (score >= 85) return { hl: 'Great sleep — ready to push', detail: `${score}/100 recovery` };
    if (score >= 70) return { hl: 'Solid sleep — ready for strength', detail: `${score}/100 recovery` };
    return { hl: 'Light sleep — easy effort today', detail: `${score}/100 recovery` };
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

  // ── 30-day averages for gauge tiles ──
  const avg30Mi = (() => {
    try {
      // Merge CSV activities + dailyLogs FIT data (same logic as getUnifiedActivities)
      const csvActs = (storage.get('activities') || []).filter(a => a.source !== 'health_connect');
      const dlogs = storage.get('dailyLogs') || [];
      const byKey = new Map(csvActs.map(a => [`${a.date}|${a.title || a.activityType || ''}`, a]));
      for (const log of dlogs) {
        const fd = log.fitData;
        if (!fd || !log.date) continue;
        const type = fd.activityType || fd.type || 'workout';
        const key = `${log.date}|${type}`;
        if (byKey.has(key)) continue;
        byKey.set(key, { date: log.date, distanceMi: fd.distanceMi || null, activityType: type });
      }
      const acts = [...byKey.values()];
      const now = new Date();
      const d30 = new Date(now - 30 * 86400000);
      const recent = acts.filter(a => a.date && new Date(a.date) >= d30);
      const totalMi30 = recent.reduce((s, a) => s + (a.distanceMi || 0), 0);
      const weeks = 30 / 7;
      return (totalMi30 / weeks).toFixed(1);
    } catch { return '0'; }
  })();

  const avg30Sleep = (() => {
    try {
      if (!sortedSleep || sortedSleep.length < 2) return '—';
      // sortedSleep may be objects with .sleepScore or plain numbers
      const last30 = sortedSleep.slice(-30).map(v => typeof v === 'number' ? v : v?.sleepScore).filter(v => typeof v === 'number' && !isNaN(v));
      if (!last30.length) return '—';
      const avg = last30.reduce((s, v) => s + v, 0) / last30.length;
      return isNaN(avg) ? '—' : avg.toFixed(0);
    } catch { return '—'; }
  })();

  const avg30Protein = (() => {
    try {
      const nuts = recentNut || [];
      if (!nuts.length) return '—';
      const last30 = nuts.slice(-30);
      return (last30.reduce((s, n) => s + (n.protein || 0), 0) / last30.length).toFixed(0);
    } catch { return '—'; }
  })();

  const avg30Weight = (() => {
    try {
      if (!sortedW || sortedW.length < 2) return '—';
      // sortedW may be objects with .weightLbs or plain numbers
      const last30 = sortedW.slice(-30).map(v => typeof v === 'number' ? v : v?.weightLbs).filter(v => typeof v === 'number' && !isNaN(v));
      if (!last30.length) return '—';
      const avg = last30.reduce((s, v) => s + v, 0) / last30.length;
      return isNaN(avg) ? '—' : avg.toFixed(1);
    } catch { return '—'; }
  })();

  const avg30HRV = (() => {
    try {
      if (!hrvData || hrvData.length < 2) return '—';
      // hrvData may be objects with .overnightHRV or plain numbers
      const last30 = hrvData.slice(-30).map(v => typeof v === 'number' ? v : v?.overnightHRV).filter(v => typeof v === 'number' && !isNaN(v));
      if (!last30.length) return '—';
      const avg = last30.reduce((s, v) => s + v, 0) / last30.length;
      return isNaN(avg) ? '—' : avg.toFixed(0);
    } catch { return '—'; }
  })();

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

  // ── This Week (actual current week, not YTD averages) ──
  const twMi = thisWeek?.mi || 0;
  const twSessions = thisWeek?.sessions || 0;
  const twRuns = thisWeek?.runs || 0;
  const twHrs = thisWeek?.hrs || 0;
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
  const strengthTiles = [
    buildTile('Sessions', G.weeklyStrengthTarget || 2, '/wk',
      { text: '→ on target', color: C.green },
      ((totalSessions || 0) / Math.max(new Date().getMonth() + 1, 1) / 4.3).toFixed(1),
      1.0, C.purple, 'activity'),
    buildTile('Pull-ups', G.pullUpsTarget || '—', 'reps',
      { text: '', color: T3 },
      '—', 0, C.pink, 'activity'),
  ];

  // RECOVERY
  const recoveryTiles = [
    buildTile('Sleep Score', latestSleepScore || '—', 'pts',
      trendVsLastWk(latestSleepScore, sortedSleep?.slice(-8).map(s => typeof s === 'number' ? s : s?.sleepScore)),
      avg30Sleep, parseFloat(avg30Sleep) / (G.targetSleepScore || 85), C.cyan, 'clinical'),
    buildTile('HRV', avgHRV30?.toFixed(0) || '—', 'ms',
      trendVsLastWk(avgHRV30, hrvData?.slice(-8).map(h => typeof h === 'number' ? h : h?.overnightHRV)),
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
    buildTile('Protein', avgProtein?.toFixed(0) || '0', 'g',
      trendVsLastWk(avgProtein, recentNut?.map(n => n.protein)),
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

      <SleepInsight headline={sleepInsight.hl} detail={sleepInsight.detail} />

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
        runs={twRuns}
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

      {/* Core Summary */}
      <div style={sectionHeader}>Core <div style={shLine} /></div>
      <CoreSummary
        hrv={avgHRV30?.toFixed(0)}
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
import { getSystemsReport } from "../core/healthSystems.js";
import { cleanSleepForAveraging } from "../core/parsers/sleepParser.js";

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

function MobileSystemTile({ sys }) {
  const statusColor = sys.status === 'good' ? '#4ade80' : sys.status === 'focus' ? '#fbbf24' : '#f87171';
  const fillTint = sys.status === 'good' ? 'rgba(74,222,128,0.12)'
    : sys.status === 'focus' ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.15)';
  const icon = SYSTEM_ICONS_M[sys.id]?.(sys.color) || null;
  return (
    <div style={{
      position: 'relative', background: CARD_BG, border: `0.5px solid ${BORDER}`,
      borderRadius: 10, padding: '8px 4px 7px', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${Math.max(8, sys.pct)}%`,
        background: `linear-gradient(180deg, transparent, ${fillTint})`,
        borderRadius: '0 0 10px 10px', transition: 'height 0.6s ease', zIndex: 0,
      }} />
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{
          width: 22, height: 22, margin: '0 auto 4px', borderRadius: 6,
          background: CARD_BG, border: `0.5px solid ${BORDER}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{icon}</div>
        <div style={{ fontSize: 8, fontWeight: 600, color: T1, lineHeight: 1.15, marginBottom: 2, minHeight: 18 }}>
          {sys.name.replace(' & ', '/')}
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: statusColor, marginBottom: 2 }}>{sys.pct}%</div>
        <div style={{ fontSize: 7, color: T3, lineHeight: 1.2, minHeight: 16 }}>{sys.comment}</div>
      </div>
    </div>
  );
}

export function MobileEdgeIQ({ data, onOpenTab }) {
  const today = new Date().toISOString().slice(0, 10);
  const report = useMemo(() => getSystemsReport(today), [today]);
  const goodCount = report.filter(s => s.status === 'good').length;
  const focusCount = report.filter(s => s.status === 'focus').length;
  const defCount = report.filter(s => s.status === 'def').length;

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
  const recentNut = cronometer.filter(c => c.date >= d30.toISOString().slice(0, 10) && c.calories);
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
      padding: '12px 10px 76px', WebkitFontSmoothing: 'antialiased',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: T1 }}>◈ EdgeIQ</div>
          <div style={{ fontSize: 9, color: T3, marginTop: 1 }}>Intelligence · Signals · Systems</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: C.blue }}>YTD</span>
          <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 6, background: 'rgba(107,171,223,0.12)', color: C.blue }}>{totalMi.toFixed(0)} mi</span>
        </div>
      </div>

      {/* Health Systems */}
      <div style={{ ...card, borderRadius: 12, padding: '10px 8px', marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: T1 }}>⬡ Health Systems</span>
          <div style={{ display: 'flex', gap: 6, fontSize: 8, color: T3 }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
          {report.map(sys => <MobileSystemTile key={sys.id} sys={sys} />)}
        </div>
      </div>

      {/* Cockpit — signal gauges */}
      <div style={{ ...card, borderRadius: 12, padding: '10px 8px', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T1, marginBottom: 8 }}>◈ Signal Cockpit</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {cockpitItems.map((item, i) => {
            const goalVal = parseFloat(item.goal) || 0;
            const val = parseFloat(item.value) || 0;
            const pct = goalVal > 0 ? Math.min(val / goalVal, 1) : 0;
            return (
              <div key={i} style={{
                background: CARD_BG, borderRadius: 8, padding: '8px 6px', textAlign: 'center',
                border: `0.5px solid ${BORDER}`,
              }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: item.color, lineHeight: 1 }}>{item.value}</div>
                <div style={{ fontSize: 7, color: T3, marginTop: 2 }}>{item.unit}</div>
                <div style={{ fontSize: 8, fontWeight: 600, color: T2, marginTop: 3 }}>{item.label}</div>
                {goalVal > 0 && (
                  <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, marginTop: 4 }}>
                    <div style={{ height: 2, background: item.color, borderRadius: 1, width: `${pct * 100}%`, transition: 'width 0.6s ease' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Annual progress */}
      <div style={{ ...card, borderRadius: 12, padding: '10px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: T1, marginBottom: 8 }}>◈ Annual Progress</div>
        {[
          { label: 'Run distance', actual: totalMi.toFixed(0), target: G.annualRunDistanceTarget || 800, unit: 'mi', color: C.blue },
          { label: 'Workouts', actual: totalSessions, target: G.annualWorkoutsTarget || 200, unit: '', color: C.purple },
        ].map((p, i) => {
          const pct = Math.min(parseFloat(p.actual) / parseFloat(p.target), 1);
          return (
            <div key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: T2, marginBottom: 3 }}>
                <span>{p.label}</span>
                <span>{p.actual} / {p.target} {p.unit} <span style={{ color: T4 }}>({Math.round(pct * 100)}%)</span></span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                <div style={{ height: 3, background: p.color, borderRadius: 2, width: `${pct * 100}%`, transition: 'width 0.6s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
