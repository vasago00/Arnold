// ─── MobileHome: Redesigned Smart Home Screen ──────────────────────────────
// Combines Option C (Hero Readiness Score) with Option B (Metric Tiles Grid).
// Bottom nav bar: Training, Recovery, Body, Nutrition — thumb-friendly.
// Action cards always visible, vertically stacked.
// Samsung S25 Ultra (6.9" / 412×915 logical px).

import { useState, useEffect, useCallback } from "react";
import { Sparkline } from "./Sparkline.jsx";
import { STATUS, statusFromPct } from "../core/semantics.js";
import { getGoals } from "../core/goals.js";
import { todayPlanned, DAY_TYPES } from "../core/planner.js";
import { NutritionInput } from "./NutritionInput.jsx";
import { DataSync } from "./DataSync.jsx";

// ─── Glassmorphism base ─────────────────────────────────────────────────────
const glass = {
  background: 'rgba(20, 22, 30, 0.65)',
  backdropFilter: 'blur(20px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  boxShadow: '0 8px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)',
};

const glassInner = {
  background: 'rgba(255,255,255,0.04)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
};

// ─── Domain accents ─────────────────────────────────────────────────────────
const GRADIENTS = {
  training:  'linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)',
  recovery:  'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
  body:      'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  nutrition: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
  race:      'linear-gradient(135deg, #f97316 0%, #eab308 100%)',
};

// ─── Bottom Nav Config ──────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'home',      icon: '⬡', label: 'Home' },
  { id: 'training',  icon: '◇', label: 'Training', tab: 'weekly' },
  { id: 'recovery',  icon: '◎', label: 'Recovery', tab: 'daily' },
  { id: 'body',      icon: '△', label: 'Body',     tab: 'clinical' },
  { id: 'nutrition', icon: '◈', label: 'Nutrition', tab: 'daily' },
  { id: 'more',      icon: '⋯', label: 'More' },
];

// ─── Micro-interaction: spring press ────────────────────────────────────────
function usePress() {
  const [pressed, setPressed] = useState(false);
  return {
    pressed,
    bind: {
      onTouchStart: () => setPressed(true),
      onTouchEnd: () => setPressed(false),
      onTouchCancel: () => setPressed(false),
    },
    style: {
      transform: pressed ? 'scale(0.97)' : 'scale(1)',
      transition: 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
    },
  };
}

// ─── Readiness Score Ring (compact) ─────────────────────────────────────────
function ReadinessRing({ score, size = 64 }) {
  const strokeW = 5;
  const radius = (size - strokeW * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(score, 100)) / 100;
  const offset = circumference * (1 - pct);
  const severity = pct >= 0.8 ? 'ok' : pct >= 0.6 ? 'warn' : 'critical';
  const s = STATUS[severity];

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
        <circle cx={size/2} cy={size/2} r={radius}
          fill="none" stroke={s.color} strokeWidth={strokeW}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
          {Math.round(score)}
        </span>
      </div>
    </div>
  );
}

// ─── Metric Tile (Option B style) ──────────────────────────────────────────
function MetricTile({ label, value, unit, pct, sparkData, color, onClick }) {
  const severity = statusFromPct(pct);
  const s = STATUS[severity] || STATUS.neutral;
  const barPct = pct != null ? Math.min(Math.max(pct, 0), 1) : null;

  return (
    <div
      onClick={onClick}
      style={{
        ...glassInner,
        padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
        minHeight: 88,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
          {value ?? '—'}
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{unit}</span>
      </div>
      {/* Progress bar */}
      {barPct != null && (
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 2, width: `${Math.round(barPct * 100)}%`,
            background: s.color, transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
          }} />
        </div>
      )}
      {/* Mini sparkline */}
      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: 'auto' }}>
          <Sparkline data={sparkData} color={color || s.color} width={80} height={16} />
        </div>
      )}
    </div>
  );
}

// ─── Action Card (vertically stacked, always visible) ──────────────────────
function ActionCard({ label, detail, severity = 'warn' }) {
  const s = STATUS[severity] || STATUS.warn;
  return (
    <div style={{
      ...glassInner,
      padding: '12px 14px',
      borderLeft: `3px solid ${s.color}`,
      boxShadow: `0 0 8px ${s.border}, inset 0 0 12px ${s.dim}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%', background: s.color,
        boxShadow: `0 0 8px ${s.color}`, flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: s.color, letterSpacing: '0.02em' }}>
          {label}
        </div>
        {detail && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2, lineHeight: 1.3 }}>{detail}</div>}
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: s.color, opacity: 0.7 }}>⚡</span>
    </div>
  );
}

// ─── Stat Pill (compact row under readiness ring) ──────────────────────────
function StatPill({ label, value, unit, color }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 2 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: color || '#fff' }}>{value ?? '—'}</span>
        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)' }}>{unit}</span>
      </div>
    </div>
  );
}

// ─── More Menu (secondary nav) ─────────────────────────────────────────────
function MoreMenu({ onSelect, onClose }) {
  const items = [
    { label: 'Labs', icon: '◉', tab: 'labs', grad: 'linear-gradient(135deg, #ef4444, #f97316)' },
    { label: 'Races', icon: '⚑', tab: 'races', grad: 'linear-gradient(135deg, #f97316, #eab308)' },
    { label: 'Goals', icon: '◎', tab: 'goals', grad: 'linear-gradient(135deg, #22c55e, #10b981)' },
    { label: 'Stack', icon: '◈', tab: 'supplements', grad: 'linear-gradient(135deg, #8b5cf6, #6366f1)' },
    { label: 'Sync', icon: '⇄', tab: 'sync', grad: 'linear-gradient(135deg, #06b6d4, #22d3ee)' },
    { label: 'Profile', icon: '○', tab: 'settings', grad: 'linear-gradient(135deg, #6b7280, #9ca3af)' },
  ];

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 998, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }} />
      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999,
        background: 'rgba(18, 20, 28, 0.95)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px 20px 0 0',
        padding: '20px 16px 40px',
        animation: 'mobileSheetUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 18px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {items.map(q => (
            <div
              key={q.tab}
              onClick={() => { onSelect(q.tab); onClose(); }}
              style={{
                ...glass, padding: '16px 8px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                transition: 'transform 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: q.grad,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, boxShadow: '0 4px 10px rgba(0,0,0,0.25)',
              }}>{q.icon}</div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{q.label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// MAIN MOBILE HOME COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function MobileHome({ data, focusItems, weeklyStats, avgWeeklyMi, avgWeeklyHrsTotal,
  avgPaceSecs, goalPaceSecs, fmtPace, totalMi, annualRunTarget, totalSessions,
  sortedSleep, hrvData, sortedW, currentWeight, currentBF, latestSleepScore,
  avgHRV30, recentNut, avgProtein, latestRHR, nextRace, onOpenTab }) {

  const [moreOpen, setMoreOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const G = getGoals();

  // Derived data
  const milesHist = (weeklyStats || []).map(w => w.mi || 0).reverse();
  const sleepHist = (sortedSleep || []).slice(0, 8).map(s => s.sleepScore || null).reverse().filter(Boolean);
  const hrvHist = (hrvData || []).slice(0, 8).map(h => h.overnightHRV || null).reverse().filter(Boolean);
  const weightHist = (sortedW || []).slice(0, 8).map(w => w.weight || null).reverse().filter(Boolean);
  const proteinHist = (recentNut || []).slice(0, 8).map(n => n.protein || null).reverse().filter(Boolean);
  const volPct = G.weeklyRunDistanceTarget ? avgWeeklyMi / G.weeklyRunDistanceTarget : null;
  const pacePct = avgPaceSecs && goalPaceSecs ? Math.min(goalPaceSecs / avgPaceSecs, 1) : null;
  const sleepPct = latestSleepScore ? latestSleepScore / 100 : null;
  const hrvPct = G.targetHRV ? (avgHRV30 || (hrvHist.length ? hrvHist[hrvHist.length - 1] : 0)) / G.targetHRV : null;
  const bfPct = G.targetBodyFat && currentBF ? G.targetBodyFat / currentBF : null;
  const proteinPct = G.dailyProteinTarget ? avgProtein / G.dailyProteinTarget : null;

  // Composite readiness score (weighted average of available metrics)
  const readinessScore = (() => {
    const metrics = [];
    if (volPct != null)    metrics.push({ val: Math.min(volPct, 1.2), w: 2.5 });
    if (pacePct != null)   metrics.push({ val: Math.min(pacePct, 1.2), w: 2 });
    if (sleepPct != null)  metrics.push({ val: Math.min(sleepPct, 1.2), w: 2 });
    if (hrvPct != null)    metrics.push({ val: Math.min(hrvPct, 1.2), w: 1.5 });
    if (proteinPct != null)metrics.push({ val: Math.min(proteinPct, 1.2), w: 1.5 });
    if (bfPct != null)     metrics.push({ val: Math.min(bfPct, 1.2), w: 1 });
    if (!metrics.length) return 0;
    const totalW = metrics.reduce((a, m) => a + m.w, 0);
    return Math.round(metrics.reduce((a, m) => a + m.val * m.w, 0) / totalW * 100);
  })();

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const profileName = (() => { try { return JSON.parse(localStorage.getItem('arnold:profile') || '{}').name || ''; } catch { return ''; } })();
  const profileAvatar = (() => { try { return JSON.parse(localStorage.getItem('arnold:profile') || '{}').avatar || ''; } catch { return ''; } })();

  // Action items (warnings) and ok items (wins)
  const actionItems = (focusItems || []).filter(f => f.severity !== 'ok' && f.severity !== 'neutral').slice(0, 4);
  // Build positive indicators from metrics that are on track
  const okItems = [];
  if (volPct != null && volPct >= 0.85)   okItems.push({ label: 'Volume' });
  if (pacePct != null && pacePct >= 0.9)  okItems.push({ label: 'Pace' });
  if (sleepPct != null && sleepPct >= 0.8) okItems.push({ label: 'Sleep' });
  if (proteinPct != null && proteinPct >= 0.85) okItems.push({ label: 'Protein' });
  if (hrvPct != null && hrvPct >= 0.85)   okItems.push({ label: 'HRV' });
  if (bfPct != null && bfPct >= 0.9)      okItems.push({ label: 'Body comp' });

  // Race countdown
  const raceDaysLeft = nextRace?.date ? Math.ceil((new Date(nextRace.date) - new Date()) / 86400000) : null;

  // Bottom nav handler
  const handleNav = (item) => {
    if (item.id === 'more') {
      setMoreOpen(true);
      return;
    }
    if (item.id === 'home') {
      setActiveNav('home');
      return;
    }
    if (item.id === 'nutrition') {
      // Stay in MobileHome — show inline nutrition panel
      setActiveNav('nutrition');
      return;
    }
    // Navigate to drill-down tab
    setActiveNav(item.id);
    onOpenTab?.(item.tab);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0b10 0%, #111318 40%, #0d0e14 100%)',
      padding: '0 16px 90px', // 90px bottom for nav bar
      fontFamily: "'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif",
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>

      {/* ═══ HEADER: Compact logo + greeting ════════════════════════════════ */}
      <div style={{ padding: '10px 4px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            background: 'rgba(96,165,250,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 600, color: '#60a5fa',
            overflow: 'hidden', flexShrink: 0,
          }}>
            {profileAvatar
              ? <img src={profileAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (profileName?.[0] || 'A').toUpperCase()}
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em', fontFamily: 'var(--font-mono, monospace)' }}>ARNOLD</span>
          <span style={{
            padding: '1px 5px', borderRadius: 8,
            background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.15)',
            fontSize: 7, fontWeight: 700, color: 'rgba(96,165,250,0.6)', letterSpacing: '0.08em',
          }}>BETA</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: 500, marginTop: 4, padding: '0 1px' }}>
          {greeting}{profileName ? `, ${profileName}` : ''}
        </div>
      </div>

      {activeNav === 'home' && <>
      {/* ═══ HERO: Compact Readiness + Key Stats ════════════════════════════ */}
      <div style={{
        ...glass, padding: '14px 16px', marginBottom: 10,
      }}>
        {/* Top row: ring left, label + race right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ReadinessRing score={readinessScore} size={60} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Readiness
            </div>
            <div style={{ fontSize: 11, color: (() => { const p = readinessScore / 100; return p >= 0.8 ? STATUS.ok.color : p >= 0.6 ? STATUS.warn.color : STATUS.critical.color; })(), fontWeight: 600, marginTop: 1 }}>
              {readinessScore >= 80 ? 'On track' : readinessScore >= 60 ? 'Needs work' : 'Behind'}
            </div>
          </div>
          {/* Race countdown pill (if exists) */}
          {nextRace && raceDaysLeft != null && raceDaysLeft > 0 && (
            <div
              onClick={() => onOpenTab?.('races')}
              style={{
                padding: '6px 10px', borderRadius: 8,
                background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.15)',
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 10, color: '#f97316' }}>🏁</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f97316', lineHeight: 1 }}>{raceDaysLeft}d</div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', marginTop: 1, maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {(() => {
                    const distKm = parseFloat(nextRace.distance_km || nextRace.distanceKm || 0);
                    const name = nextRace.name || '';
                    const nl = name.toLowerCase();
                    // Derive distance badge
                    let badge = '';
                    if (distKm > 0) {
                      if (distKm <= 5.1) badge = '5K';
                      else if (distKm <= 10.1) badge = '10K';
                      else if (distKm <= 15.5) badge = '15K';
                      else if (distKm <= 21.2) badge = 'Half';
                      else if (distKm <= 42.3) badge = 'Marathon';
                      else badge = 'Ultra';
                    } else if (nl.includes('hyrox')) badge = 'Hyrox';
                    else if (nl.includes('5k')) badge = '5K';
                    else if (nl.includes('10k')) badge = '10K';
                    else if (nl.includes('half')) badge = 'Half';
                    else if (nl.includes('marathon')) badge = 'Marathon';
                    else if (nl.includes('ultra')) badge = 'Ultra';
                    // Combine: "Half · Race Name" or just name
                    if (badge && name) return `${badge} · ${name}`;
                    if (badge) return badge;
                    return name || 'Race';
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 4-stat row below */}
        <div style={{
          display: 'flex', marginTop: 12, paddingTop: 10,
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          <StatPill label="Miles/wk" value={avgWeeklyMi?.toFixed(1) || '0'} unit="mi" color="#60a5fa" />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <StatPill label="Sleep" value={latestSleepScore || '—'} unit="/100" color="#22d3ee" />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <StatPill label="Protein" value={Math.round(avgProtein || 0)} unit="g" color="#f472b6" />
          <div style={{ width: 1, background: 'rgba(255,255,255,0.06)' }} />
          <StatPill label="Weight" value={currentWeight || '—'} unit="lbs" color="#f59e0b" />
        </div>
      </div>

      {/* ═══ STATUS RAIL — horizontal scroll: warnings + wins ════════════════ */}
      {(actionItems.length > 0 || okItems.length > 0) && (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none', padding: '0 2px 2px', marginBottom: 10,
        }}>
          {actionItems.map((f, i) => {
            const s = STATUS[f.severity] || STATUS.warn;
            return (
              <div key={'a' + i} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 20, flexShrink: 0,
                background: `${s.color}12`, border: `1px solid ${s.color}25`,
              }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: s.color, boxShadow: `0 0 4px ${s.color}` }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: s.color, whiteSpace: 'nowrap' }}>{f.label}</span>
              </div>
            );
          })}
          {okItems.map((f, i) => (
            <div key={'g' + i} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 20, flexShrink: 0,
              background: `${STATUS.ok.color}12`, border: `1px solid ${STATUS.ok.color}20`,
            }}>
              <span style={{ fontSize: 10, color: STATUS.ok.color }}>✓</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: STATUS.ok.color, whiteSpace: 'nowrap' }}>{f.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ═══ METRIC TILES GRID (Option B style — 2×3) ════════════════════════ */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 2px', marginBottom: 8 }}>
          KEY METRICS
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MetricTile
            label="Weekly Miles"
            value={avgWeeklyMi?.toFixed(1) || '0'}
            unit="mi"
            pct={volPct}
            sparkData={milesHist}
            color="#60a5fa"
            onClick={() => onOpenTab?.('weekly')}
          />
          <MetricTile
            label="Sleep Score"
            value={latestSleepScore || '—'}
            unit="/100"
            pct={sleepPct}
            sparkData={sleepHist}
            color="#22d3ee"
            onClick={() => onOpenTab?.('daily')}
          />
          <MetricTile
            label="Avg Pace"
            value={fmtPace ? fmtPace(avgPaceSecs) : '—'}
            unit="/mi"
            pct={pacePct}
            sparkData={null}
            color="#fbbf24"
            onClick={() => onOpenTab?.('weekly')}
          />
          <MetricTile
            label="Protein"
            value={Math.round(avgProtein || 0)}
            unit="g/day"
            pct={proteinPct}
            sparkData={proteinHist}
            color="#f472b6"
            onClick={() => onOpenTab?.('daily')}
          />
          <MetricTile
            label="Weight"
            value={currentWeight || '—'}
            unit="lbs"
            pct={bfPct}
            sparkData={weightHist}
            color="#f59e0b"
            onClick={() => onOpenTab?.('clinical')}
          />
          <MetricTile
            label="HRV"
            value={hrvHist.length ? hrvHist[hrvHist.length - 1] : '—'}
            unit="ms"
            pct={hrvPct}
            sparkData={hrvHist}
            color="#34d399"
            onClick={() => onOpenTab?.('daily')}
          />
        </div>
      </div>

      {/* ═══ TODAY'S PLAN — reads planner + checks activity completion ═══════ */}
      {(() => {
        const plan = todayPlanned();
        const typeInfo = DAY_TYPES.find(t => t.id === plan?.type) || DAY_TYPES.find(t => t.id === 'rest');
        const isRest = plan?.type === 'rest';

        // Check ALL stores for a matching completed activity
        const todayStr = new Date().toISOString().slice(0, 10);
        let completed = false;
        try {
          // 3 stores: garmin-activities, workouts, daily-logs
          const acts = JSON.parse(localStorage.getItem('arnold:garmin-activities') || '[]');
          const wkts = JSON.parse(localStorage.getItem('arnold:workouts') || '[]');
          const logs = JSON.parse(localStorage.getItem('arnold:daily-logs') || '[]');
          const todayActs = acts.filter(a => a.date === todayStr);
          const todayWkts = wkts.filter(w => w.date === todayStr);
          const todayLogs = logs.filter(l => l.date === todayStr);
          // FIT uploads stored as fitData.activityType inside daily-logs
          const todayHasLog = todayLogs.some(l => l.fitData || l.workout || l.distanceMi || l.duration);
          const logType = l => (l.fitData?.activityType || l.workout || l.type || '');
          const hasAny = todayActs.length > 0 || todayWkts.length > 0 || todayHasLog;
          if (hasAny && !isRest) {
            const planType = plan?.type || '';
            const hasRun = todayActs.some(a => /run/i.test(a.activityType || ''))
                        || todayWkts.some(w => /run/i.test(w.type || ''))
                        || todayLogs.some(l => /run/i.test(logType(l)));
            const hasStrength = todayActs.some(a => /strength|weight/i.test(a.activityType || ''))
                             || todayWkts.some(w => /strength/i.test(w.type || ''))
                             || todayLogs.some(l => /strength/i.test(logType(l)));
            if (/run|tempo|interval|long/.test(planType) && hasRun) completed = true;
            else if (/strength/.test(planType) && hasStrength) completed = true;
            else if (hasAny) completed = true;
          }
          if (isRest && !hasAny) completed = true;
        } catch {}

        const planLabel = typeInfo?.label || 'Rest';
        const planColor = completed ? STATUS.ok.color : (typeInfo?.color || '#6b7280');
        const distLabel = plan?.distanceMi ? `${plan.distanceMi} mi` : '';

        return (
          <div
            onClick={() => onOpenTab?.('daily')}
            style={{
              ...glass, padding: '12px 16px', marginBottom: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 12,
              border: completed ? `1px solid ${STATUS.ok.color}30` : glass.border,
              background: completed ? 'rgba(74,222,128,0.06)' : glass.background,
              position: 'relative',
            }}
          >
            {/* Type icon */}
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: `${planColor}18`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: planColor, flexShrink: 0,
            }}>
              {typeInfo?.icon || '○'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                TODAY
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: completed ? STATUS.ok.color : '#fff', marginTop: 1 }}>
                {planLabel}{distLabel ? ` · ${distLabel}` : ''}
              </div>
            </div>
            {/* Completion checkmark or Log button */}
            {completed ? (
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: `${STATUS.ok.color}20`, border: `1px solid ${STATUS.ok.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: STATUS.ok.color,
              }}>✓</div>
            ) : (
              <div style={{
                padding: '5px 10px', borderRadius: 8,
                background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)',
                fontSize: 10, fontWeight: 600, color: '#60a5fa',
              }}>Log →</div>
            )}
          </div>
        );
      })()}

      {/* ═══ YTD PROGRESS (compact banner) ═══════════════════════════════════ */}
      <div style={{
        ...glassInner, padding: '12px 14px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          <span style={{ fontWeight: 600, color: '#fff' }}>{totalMi?.toFixed(0) || 0}</span> / {annualRunTarget || 800} mi YTD
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>
          <span style={{ fontWeight: 600, color: '#fff' }}>{totalSessions || 0}</span> sessions
        </div>
        <div style={{
          height: 4, flex: 1, maxWidth: 80, borderRadius: 2, background: 'rgba(255,255,255,0.06)', marginLeft: 10, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 2,
            width: `${Math.min(100, Math.round((totalMi / (annualRunTarget || 800)) * 100))}%`,
            background: 'linear-gradient(90deg, #3b82f6, #6366f1)',
          }} />
        </div>
      </div>


      </>}

      {/* ═══ NUTRITION PANEL (inline when nav = nutrition) ═══════════════════ */}
      {activeNav === 'nutrition' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 2px', marginBottom: 10 }}>
            NUTRITION
          </div>
          <NutritionInput date={new Date().toISOString().slice(0, 10)} />
        </div>
      )}

      {/* ═══ DATA SYNC PANEL (inline when nav = sync) ═════════════════════ */}
      {activeNav === 'sync' && (
        <div style={{ marginBottom: 12 }}>
          <DataSync variant="mobile" />
        </div>
      )}

      {/* ═══ BOTTOM NAV BAR ══════════════════════════════════════════════════ */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(12, 13, 18, 0.92)',
        backdropFilter: 'blur(24px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        padding: '6px 0 env(safe-area-inset-bottom, 8px)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
      }}>
        {NAV_ITEMS.map(item => {
          const isActive = item.id === activeNav || (activeNav === 'home' && item.id === 'home');
          return (
            <button
              key={item.id}
              onClick={() => handleNav(item)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '6px 4px', minWidth: 56,
                color: isActive ? '#60a5fa' : 'rgba(255,255,255,0.35)',
                transition: 'color 0.2s ease',
              }}
            >
              <span style={{
                fontSize: 20, lineHeight: 1,
                filter: isActive ? 'drop-shadow(0 0 6px rgba(96,165,250,0.5))' : 'none',
              }}>
                {item.icon}
              </span>
              <span style={{ fontSize: 9, fontWeight: isActive ? 700 : 500, letterSpacing: '0.02em' }}>
                {item.label}
              </span>
              {/* Active indicator dot */}
              {isActive && (
                <div style={{
                  width: 4, height: 4, borderRadius: '50%', background: '#60a5fa',
                  boxShadow: '0 0 8px rgba(96,165,250,0.6)',
                  position: 'absolute', bottom: 2,
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ═══ MORE MENU (bottom sheet) ════════════════════════════════════════ */}
      {moreOpen && <MoreMenu onSelect={(tab) => {
        if (tab === 'sync') { setActiveNav('sync'); }
        else { onOpenTab?.(tab); }
      }} onClose={() => setMoreOpen(false)} />}

      {/* Sheet animation keyframes injected once */}
      <style>{`
        @keyframes mobileSheetUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
// sync-v1
