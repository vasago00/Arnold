// ─── MobileHome: Premium Start Dashboard (Mockup Port) ──────────────────────
// Muted warm palette, glass bottom nav with SVG icons, hero rail with readiness
// ring, sleep insight, co-pilot gauges, weekly/monthly/annual sections, and
// multi-item today's plan with workout-type icons.

import { useState, useEffect, useCallback } from "react";
import { Sparkline } from "./Sparkline.jsx";
import { STATUS, statusFromPct } from "../core/semantics.js";
import { getGoals } from "../core/goals.js";
import { storage } from "../core/storage.js";
import { computeReadiness } from "../core/trainingIntelligence.js";
import { todayPlanned, checkTodayCompletion, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";

// ─── Muted warm color palette (matches mockup) ─────────────────────────────
const C = {
  blue:   '#5b9bd5',
  cyan:   '#5ec4d4',
  pink:   '#d4789b',
  amber:  '#d4a24e',
  green:  '#5bbf8a',
  red:    '#cf6b6b',
  purple: '#9b8ec4',
  orange: '#d48b4e',
};

const BG       = '#0b0c12';
const CARD_BG  = 'rgba(255,255,255,0.03)';
const BORDER   = 'rgba(255,255,255,0.06)';
const T1       = '#fff';
const T2       = 'rgba(255,255,255,0.75)';
const T3       = 'rgba(255,255,255,0.5)';
const T4       = 'rgba(255,255,255,0.3)';

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
  Compass: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" stroke={color} fill={color === C.blue ? 'rgba(91,155,213,0.08)' : 'none'} />
      <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" fill={color} opacity="0.6" stroke={color} strokeWidth="1" />
    </svg>
  ),
  Bulb: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A6.5 6.5 0 0 0 3 8.5C3 12 6 14 6 16h6c0-2 3-4 3-7.5A6.5 6.5 0 0 0 9.5 2z" transform="translate(2.5,0)" />
      <line x1="8" y1="19" x2="16" y2="19" /><line x1="9" y1="22" x2="15" y2="22" />
    </svg>
  ),
  Bolt: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  Fork: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v8" /><path d="M8 2v3a4 4 0 0 0 8 0V2" /><line x1="12" y1="10" x2="12" y2="22" />
    </svg>
  ),
  Pulse: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  Flask: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6" /><path d="M10 3v6l-5 8.5a1.5 1.5 0 0 0 1.3 2.25h11.4a1.5 1.5 0 0 0 1.3-2.25L14 9V3" />
      <path d="M8.5 14h7" />
    </svg>
  ),
  Dots: ({ color = T4, size = 19 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
    </svg>
  ),
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
  TrendUp: ({ color = T4, size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <path d="M2 20L8 14 12 18 22 4" /><polyline points="16 4 22 4 22 10" />
    </svg>
  ),
};

// Nav icon map
const NAV_ICONS = {
  start:  (c) => <Icon.Compass color={c} />,
  edgeiq: (c) => <Icon.Bulb color={c} />,
  play:   (c) => <Icon.Bolt color={c} />,
  fuel:   (c) => <Icon.Fork color={c} />,
  core:   (c) => <Icon.Pulse color={c} />,
  labs:   (c) => <Icon.Flask color={c} />,
  more:   (c) => <Icon.Dots color={c} />,
};

// ─── Shared styles ──────────────────────────────────────────────────────────
const card = {
  background: CARD_BG,
  border: `1px solid ${BORDER}`,
  borderRadius: 14,
  padding: '12px 14px',
  marginBottom: 8,
  position: 'relative',
  overflow: 'hidden',
};

const sectionHeader = {
  fontSize: 9, fontWeight: 700, color: T4,
  textTransform: 'uppercase', letterSpacing: '0.1em',
  marginBottom: 6, marginTop: 4,
  display: 'flex', alignItems: 'center', gap: 6,
};

const shLine = {
  flex: 1, height: 1, background: BORDER,
};

// ─── HEADER ─────────────────────────────────────────────────────────────────
function Header({ greeting, profileName }) {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 0 12px' }}>
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
function HeroRail({ score, statusWord, statusColor, factors, raceDaysLeft, raceLabel, stats }) {
  const circumference = 2 * Math.PI * 24;
  const offset = circumference * (1 - Math.min(Math.max(score / 100, 0), 1));

  return (
    <div style={{
      ...card,
      borderRadius: 18,
      padding: '16px 16px 14px',
      background: 'linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.015))',
    }}>
      {/* Top accent line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${statusColor}33, transparent)`,
      }} />

      {/* Ring + Info + Race */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        {/* Readiness Ring */}
        <div style={{ width: 58, height: 58, position: 'relative', flexShrink: 0 }}>
          <svg width={58} height={58} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={29} cy={29} r={24} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={4} />
            <circle cx={29} cy={29} r={24} fill="none" stroke={statusColor} strokeWidth={4}
              strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>{score}</span>
          </div>
        </div>

        {/* Status + Pills */}
        <div style={{ flex: 1 }}>
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

        {/* Race badge */}
        {raceDaysLeft != null && raceDaysLeft > 0 && raceDaysLeft <= 120 && (
          <div style={{
            flexShrink: 0, textAlign: 'center', padding: '5px 10px', borderRadius: 10,
            background: 'rgba(212,139,78,0.06)', border: '1px solid rgba(212,139,78,0.1)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.orange, lineHeight: 1 }}>{raceDaysLeft}d</div>
            <div style={{ fontSize: 7, color: T3, marginTop: 2 }}>{raceLabel}</div>
          </div>
        )}
      </div>

      {/* Bottom stat row */}
      <div style={{ display: 'flex', borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', position: 'relative',
            borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none',
          }}>
            <div style={{ fontSize: 8, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {s.value} <span style={{ fontSize: 8, color: T4 }}>{s.unit}</span>
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
    <div style={{ ...card, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: 'rgba(94,196,212,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon.Moon />
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: T2 }}>{headline}</div>
        <div style={{ fontSize: 10, color: T3, marginTop: 1, lineHeight: 1.3 }}>{detail}</div>
      </div>
    </div>
  );
}

// ─── CO-PILOT GAUGE CARD ────────────────────────────────────────────────────
function GaugeCard({ label, value, unit, sparkData, color, goalPct, trendText, trendDir, onTap }) {
  const trendBg = trendDir === 'up' ? 'rgba(91,191,138,0.1)' : trendDir === 'down' ? 'rgba(207,107,107,0.1)' : 'rgba(255,255,255,0.04)';
  const trendColor = trendDir === 'up' ? C.green : trendDir === 'down' ? C.red : T4;

  return (
    <div onClick={onTap} style={{
      ...card,
      borderRadius: 14,
      padding: '10px 12px 8px',
      display: 'flex', flexDirection: 'column', minHeight: 104,
      cursor: onTap ? 'pointer' : 'default',
    }}>
      {/* Top accent */}
      <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, borderRadius: '0 0 2px 2px', background: color, opacity: 0.6 }} />

      {/* Label + Trend */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color }}>{label}</span>
        {trendText && (
          <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: trendBg, color: trendColor }}>{trendText}</span>
        )}
      </div>

      {/* Value */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginBottom: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 800, lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 9, color: T4 }}>{unit}</span>
      </div>

      {/* Sparkline */}
      {sparkData && sparkData.length > 1 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', minHeight: 28 }}>
          <Sparkline data={sparkData} width="100%" height={28} color={color} fill={true} dot={false} />
        </div>
      )}

      {/* Progress bar */}
      {goalPct !== undefined && (
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', marginTop: 4 }}>
          <div style={{ width: `${Math.min(goalPct * 100, 100)}%`, height: '100%', borderRadius: 2, background: color, opacity: 0.7, transition: 'width 0.6s' }} />
        </div>
      )}
    </div>
  );
}

// ─── THIS WEEK CARD ─────────────────────────────────────────────────────────
function ThisWeekCard({ headline, miles, sessions, time, weeklyMiPct, weeklyTarget }) {
  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(91,155,213,0.15), transparent)` }} />
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
        {headline} <span style={{ fontWeight: 400, color: T3, fontSize: 11 }}>— {sessions} runs, {miles} mi</span>
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

// ─── 30-DAY BODY & RECOVERY TILE ────────────────────────────────────────────
function RecoveryTile({ icon, label, value, unit, sparkData, color }) {
  return (
    <div style={{ ...card, borderRadius: 12, padding: '10px 12px 6px' }}>
      <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 1, background: color, opacity: 0.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        {icon}
        <span style={{ fontSize: 8, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, marginBottom: 6 }}>
        {value} <span style={{ fontSize: 9, color: T4, fontWeight: 400 }}>{unit}</span>
      </div>
      {sparkData && sparkData.length > 1 && (
        <div style={{ height: 24 }}>
          <Sparkline data={sparkData} width="100%" height={24} color={color} fill={true} dot={false} />
        </div>
      )}
    </div>
  );
}

// ─── THIS MONTH TILE ────────────────────────────────────────────────────────
function MonthTile({ icon, label, value, unit, sub }) {
  return (
    <div style={{ ...card, borderRadius: 12, padding: '10px 12px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
        {icon}
        <span style={{ fontSize: 8, fontWeight: 600, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1 }}>
        {value} {unit && <span style={{ fontSize: 10, color: T4, fontWeight: 400 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 9, color: T4, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── YEAR TO DATE ───────────────────────────────────────────────────────────
function YearToDateCard({ totalMi, annualTarget, totalSessions, avgPace, totalHrs, ytdPct }) {
  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, rgba(212,139,78,0.15), transparent)` }} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{totalMi}</span>
        <span style={{ fontSize: 11, color: T4 }}>/ {annualTarget} mi</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.04)', overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: `${Math.min(ytdPct * 100, 100)}%`, height: '100%', borderRadius: 2, background: C.orange, opacity: 0.6 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { lbl: 'Sessions', v: totalSessions },
          { lbl: 'Avg Pace', v: avgPace },
          { lbl: 'Total Hrs', v: totalHrs },
        ].map((s, i) => (
          <div key={i} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 8, color: T4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.lbl}</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
      </div>
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
    { id: 'sync',  label: 'Sync',  icon: '🔄' },
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
function BottomNavBar({ activeNav, onNavTap }) {
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
              background: isActive ? 'rgba(91,155,213,0.1)' : 'transparent',
              boxShadow: isActive ? '0 0 12px rgba(91,155,213,0.08)' : 'none',
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
  sortedSleep, hrvData, sortedW, currentWeight, currentBF, latestSleepScore,
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
    try { return (storage.get('profile') || {}).name || 'user'; } catch { return 'user'; }
  })();

  // ── Format pace helper (fmtPace may be a function or a string) ──
  const paceStr = typeof fmtPace === 'function' ? fmtPace(avgPaceSecs) : (fmtPace || '—');

  // ── Readiness ──
  const readinessScore = (() => {
    try { return Math.round(computeReadiness().score) || 75; } catch { return 75; }
  })();

  const readinessStatus = statusFromPct(readinessScore / 100);
  let statusColor = C.blue, statusWord = 'On Track';
  if (readinessStatus === 'ok') { statusColor = C.green; statusWord = 'On Track'; }
  else if (readinessStatus === 'warn') { statusColor = C.amber; statusWord = 'Needs Work'; }
  else if (readinessStatus === 'critical') { statusColor = C.red; statusWord = 'Behind'; }

  // ── Factor pills ──
  const factors = (() => {
    const f = [];
    const volPct = avgWeeklyMi / (G.weeklyRunDistanceTarget || 50);
    f.push({ label: 'Volume', type: volPct > 0.9 ? 'ok' : volPct > 0.7 ? 'neutral' : 'warn' });
    f.push({ label: 'Pace', type: avgPaceSecs <= (goalPaceSecs || 600) * 1.1 ? 'ok' : avgPaceSecs <= (goalPaceSecs || 600) * 1.2 ? 'neutral' : 'warn' });
    f.push({ label: 'Sleep', type: (latestSleepScore || 0) >= 85 ? 'ok' : (latestSleepScore || 0) >= 70 ? 'neutral' : 'warn' });
    f.push({ label: 'Protein', type: (avgProtein || 0) >= 120 ? 'ok' : (avgProtein || 0) >= 80 ? 'neutral' : 'warn' });
    return f;
  })();

  // ── Race countdown ──
  const raceDaysLeft = nextRace?.date ? Math.ceil((new Date(nextRace.date) - new Date()) / 86400000) : null;
  const raceLabel = nextRace ? `${nextRace.name || 'Race'}` : '';

  // ── Hero stats ──
  const heroStats = [
    { label: 'Miles/wk', value: avgWeeklyMi?.toFixed(1) || '0', unit: 'mi' },
    { label: 'Sleep', value: latestSleepScore || '—', unit: '/100' },
    { label: 'Protein', value: avgProtein?.toFixed(0) || '0', unit: 'g' },
    { label: 'Weight', value: currentWeight?.toFixed(1) || '—', unit: 'lb' },
  ];

  // ── Sleep insight ──
  const sleepHrs = sortedSleep?.length > 0 ? (sortedSleep[sortedSleep.length - 1] / 100 * 8).toFixed(0) : '7';
  const sleepInsight = (() => {
    const score = latestSleepScore || 0;
    if (score >= 85) return { hl: 'Great sleep — ready to push', detail: `${score}/100 recovery` };
    if (score >= 70) return { hl: 'Solid sleep — ready for strength', detail: `${score}/100 recovery` };
    return { hl: 'Light sleep — easy effort today', detail: `${score}/100 recovery` };
  })();

  // ── Trend helper ──
  const getTrend = (current, history) => {
    if (!history || history.length < 2 || current == null) return { text: '→', dir: 'flat' };
    const prev = history[history.length - 2];
    if (prev == null) return { text: '→', dir: 'flat' };
    const diff = current - prev;
    if (Math.abs(diff) < 0.5) return { text: '→', dir: 'flat' };
    return diff > 0 ? { text: `↑ ${Math.abs(diff).toFixed(1)}`, dir: 'up' } : { text: `↓ ${Math.abs(diff).toFixed(1)}`, dir: 'down' };
  };

  // ── Gauge configs ──
  const gauges = [
    {
      label: 'Miles/Week', value: avgWeeklyMi?.toFixed(1) || '0', unit: 'mi',
      sparkData: weeklyStats?.map(w => w.miles) || [], color: C.blue,
      goalPct: avgWeeklyMi / (G.weeklyRunDistanceTarget || 50),
      ...getTrend(avgWeeklyMi, weeklyStats?.map(w => w.miles)),
      tapTab: 'activity',
    },
    {
      label: 'Sleep Score', value: latestSleepScore || '—', unit: 'pts',
      sparkData: sortedSleep?.slice(-8) || [], color: C.cyan,
      goalPct: (latestSleepScore || 0) / 100,
      ...getTrend(latestSleepScore, sortedSleep?.slice(-8)),
      tapTab: 'clinical',
    },
    {
      label: 'Protein', value: avgProtein?.toFixed(0) || '0', unit: 'g',
      sparkData: recentNut?.map(n => n.protein) || [], color: C.pink,
      goalPct: (avgProtein || 0) / 160,
      ...getTrend(avgProtein, recentNut?.map(n => n.protein)),
      tapTab: 'nutrition_mobile',
    },
    {
      label: 'Weight', value: currentWeight?.toFixed(1) || '—', unit: 'lb',
      sparkData: sortedW?.slice(-8) || [], color: C.amber,
      ...getTrend(currentWeight, sortedW?.slice(-8)),
      tapTab: 'clinical',
    },
  ];

  // ── Weekly ──
  const weeklyMiPct = avgWeeklyMi / (G.weeklyRunDistanceTarget || 50);
  const weeklyHeadline = weeklyMiPct > 0.8 ? 'Strong week' : weeklyMiPct > 0.6 ? 'Building momentum' : 'Light week';
  const weeklyTime = `${Math.floor((avgWeeklyHrsTotal || 0))}h ${Math.round(((avgWeeklyHrsTotal || 0) % 1) * 60)}m`;

  // ── Monthly activity stats (data is an object, not array — use computed props) ──
  const monthWeeks = 4.3;
  const monthSessions = Math.round((totalSessions || 0) / Math.max((new Date().getMonth() + 1), 1)) || 0;
  const monthTotalMins = Math.round((avgWeeklyHrsTotal || 0) * 60 * monthWeeks);
  const monthTimeStr = `${Math.floor(monthTotalMins / 60)}h ${monthTotalMins % 60}m`;
  const longestRun = (() => {
    try {
      const acts = storage.get('activities') || [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return acts.filter(a => a.date && new Date(a.date) >= monthStart)
        .reduce((max, a) => Math.max(max, a.distanceMi || 0), 0);
    } catch { return 0; }
  })();
  const monthCalories = monthSessions > 0 ? Math.round(monthSessions * 540) : 0;

  // ── YTD ──
  const ytdPct = totalMi / (annualRunTarget || 1000);
  const totalHrs = ((totalMi || 0) / 6 * 60 / 60).toFixed(1); // rough estimate

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
    else if (id === 'stack') onOpenTab?.('stack');
    else if (id === 'sync') onOpenTab?.('sync');
    else if (id === 'profile') onOpenTab?.('profile');
  };

  // Non-start tabs just show the nav bar (content rendered by Arnold.jsx)
  if (activeNav !== 'start') {
    return <BottomNavBar activeNav={activeNav} onNavTap={handleNavTap} />;
  }

  // ── RENDER ──
  return (
    <div style={{
      background: BG, color: T1, minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
      padding: '0 14px 90px',
      WebkitFontSmoothing: 'antialiased',
    }} {...swipeHandlers}>

      <Header greeting={greeting} profileName={profileName} />

      <HeroRail
        score={readinessScore}
        statusWord={statusWord}
        statusColor={statusColor}
        factors={factors}
        raceDaysLeft={raceDaysLeft}
        raceLabel={raceLabel}
        stats={heroStats}
      />

      <SleepInsight headline={sleepInsight.hl} detail={sleepInsight.detail} />

      {/* Co-Pilot Gauges */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        {gauges.map((g, i) => (
          <GaugeCard
            key={i}
            label={g.label} value={g.value} unit={g.unit}
            sparkData={g.sparkData} color={g.color} goalPct={g.goalPct}
            trendText={g.text} trendDir={g.dir}
            onTap={() => onOpenTab?.(g.tapTab)}
          />
        ))}
      </div>

      {/* This Week */}
      <div style={sectionHeader}>This Week <div style={shLine} /></div>
      <ThisWeekCard
        headline={weeklyHeadline}
        miles={avgWeeklyMi?.toFixed(1) || '0'}
        sessions={totalSessions || 0}
        time={weeklyTime}
        weeklyMiPct={weeklyMiPct}
        weeklyTarget={G.weeklyRunDistanceTarget || 50}
      />

      {/* 30-Day Body & Recovery */}
      <div style={sectionHeader}>30-Day Body & Recovery <div style={shLine} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <RecoveryTile
          icon={<Icon.Pulse color={C.green} size={12} />}
          label="HRV" value={avgHRV30?.toFixed(0) || '—'} unit="ms"
          sparkData={hrvData?.slice(-8) || []} color={C.green}
        />
        <RecoveryTile
          icon={<Icon.Heart color={C.purple} />}
          label="Resting HR" value={latestRHR || '—'} unit="bpm"
          sparkData={[]} color={C.purple}
        />
        <RecoveryTile
          icon={<Icon.Clock color={C.orange} />}
          label="Avg Pace" value={paceStr} unit="/mi"
          sparkData={[]} color={C.orange}
        />
        <RecoveryTile
          icon={<svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" opacity="0.3" /><path d="M8 12h8" /><path d="M12 8v8" /></svg>}
          label="Body Fat" value={currentBF?.toFixed(1) || '—'} unit="%"
          sparkData={[]} color={C.red}
        />
      </div>

      {/* This Month */}
      <div style={sectionHeader}>This Month <div style={shLine} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        <MonthTile icon={<Icon.Clock color={C.blue} />} label="Total Time" value={monthTimeStr} sub={`across ${monthSessions} sessions`} />
        <MonthTile icon={<Icon.Bolt color={C.orange} />} label="Longest Run" value={longestRun.toFixed(1)} unit="mi" sub={longestRun > 0 ? 'this month' : 'no runs yet'} />
        <MonthTile icon={<Icon.TrendUp color={C.green} />} label="Elevation" value="—" unit="ft" sub="gain this month" />
        <MonthTile icon={<Icon.Pulse color={C.pink} />} label="Active Cal" value={monthCalories.toLocaleString()} sub={monthSessions > 0 ? `avg ${Math.round(monthCalories / monthSessions)} / session` : ''} />
      </div>

      {/* Year to Date */}
      <div style={sectionHeader}>Year to Date <div style={shLine} /></div>
      <YearToDateCard
        totalMi={totalMi?.toFixed(0) || '0'}
        annualTarget={annualRunTarget || 1000}
        totalSessions={totalSessions || 0}
        avgPace={paceStr}
        totalHrs={totalHrs}
        ytdPct={ytdPct}
      />

      {/* Today's Plan */}
      <div style={sectionHeader}>Today's Plan <div style={shLine} /></div>
      <TodaysPlan items={planItems} onTap={() => onOpenTab?.('plan')} />

      {/* Bottom Nav */}
      <BottomNavBar activeNav={activeNav} onNavTap={handleNavTap} />

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
