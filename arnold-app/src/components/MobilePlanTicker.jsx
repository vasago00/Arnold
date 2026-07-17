// MobilePlanTicker (Task #40, redesigned) — the week strip on Start, between the
// hero rail and the Pre/Post tile. Each day is drawn in the PLAN'S OWN workout
// language: runs render as effort silhouettes (easy = low mound, long = wide
// sustained plateau, tempo = cruise plateaus, intervals = spiky ridges — the same
// silhouette used on the plan tiles), strength = double chevron, rest = crescent.
// No race/next block (the race already lives top-right on Start). Taps → Calendar.
//
// Reads the APPLIED planner week (summarizePlanWeek) so it stays in sync with the
// calendar. Silhouettes use the same construction as LivingPlan's WorkoutSilhouette.

import React from 'react';
import { summarizePlanWeek } from '../core/planWeekSummary.js';
import { getSeasonCoach } from '../core/seasonCoach.js';
import { SURFACE } from '../theme/tokens.js';
const PHASE = {
  build:        { label: 'Build',    color: '#60a5fa' },
  'mini-taper': { label: 'Taper',    color: '#fbbf24' },
  'race-week':  { label: 'Race',     color: '#ef4444' },
  recovery:     { label: 'Recovery', color: '#34d399' },
};

// Effort-silhouette profiles per session type: [[durationUnits, effort0..1], …].
const PROFILES = {
  easy_run:  [[3, 0.22], [5, 0.40], [3, 0.22]],
  recovery:  [[3, 0.18], [5, 0.32], [3, 0.18]],
  long_run:  [[2, 0.22], [10, 0.50], [2, 0.28]],
  tempo:     [[4, 0.28], [2, 0.84], [1, 0.24], [2, 0.84], [1, 0.24], [2, 0.84], [3, 0.28]],
  threshold: [[4, 0.28], [2, 0.84], [1, 0.24], [2, 0.84], [1, 0.24], [2, 0.84], [3, 0.28]],
  intervals: [[4, 0.28], [1, 0.92], [1, 0.24], [2, 0.92], [1, 0.24], [3, 0.92], [1, 0.24], [2, 0.92], [1, 0.24], [1, 0.92], [3, 0.28]],
  hiit:      [[4, 0.28], [1, 0.92], [1, 0.24], [2, 0.92], [1, 0.24], [3, 0.92], [1, 0.24], [2, 0.92], [1, 0.24], [1, 0.92], [3, 0.28]],
  cross:     [[3, 0.25], [6, 0.45], [3, 0.25]],
  cycle:     [[3, 0.25], [6, 0.45], [3, 0.25]],
  swim:      [[3, 0.25], [6, 0.45], [3, 0.25]],
  ski:       [[3, 0.25], [6, 0.45], [3, 0.25]],
  mobility:  [[3, 0.15], [6, 0.28], [3, 0.15]],
  walk:      [[3, 0.15], [6, 0.28], [3, 0.15]],
};
const COLOR = {
  easy_run: '#5eead4', recovery: '#5eead4', long_run: '#60a5fa', tempo: '#fbbf24', threshold: '#fbbf24',
  intervals: '#fb7185', hiit: '#fb7185', cross: '#34d399', cycle: '#34d399', swim: '#34d399', ski: '#34d399',
  mobility: '#34d399', walk: '#34d399',
};

// Same construction as LivingPlan's WorkoutSilhouette (warm-up rise → rep
// plateaus with recovery valleys → cool-down fall), returns line + filled area.
function silPath(profile) {
  const W = 100, H = 30;
  const total = profile.reduce((s, x) => s + x[0], 0) || 1;
  let x = 0; const pts = [[0, H]];
  profile.forEach(([d, e]) => { const w = d / total * W; const y = H - e * (H - 3); pts.push([x, y]); pts.push([x + w, y]); x += w; });
  pts.push([W, H]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return { line, area: `${line} L${W},${H} Z` };
}

function DayMark({ type, idx, status }) {
  const style = { width: '100%', height: 28, display: 'block' };

  // Off-plan: a blue ghost of an easy run (what you actually did), regardless of
  // what was planned that day.
  if (status === 'offplan') {
    const { line } = silPath(PROFILES.easy_run);
    return (
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={style}>
        <path d={line} fill="none" stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="3 2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    );
  }

  const missed = status === 'missed';
  const done = status === 'done';

  if (type === 'strength') {
    const c = missed ? '#8b9099' : '#a78bfa';
    return (
      <svg viewBox="0 0 100 30" style={{ ...style, opacity: missed ? 0.5 : 1 }}>
        <path d="M38,18 L50,10 L62,18" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38,24 L50,16 L62,24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
      </svg>
    );
  }
  // Recovery day = rest OR mobility (athlete's choice). The tai-chi "warrior" figure — the SAME
  // glyph the calendar tiles and plan-tab tiles use for mobility — so the surfaces read as one
  // language (Emil). Was a green crescent ("moon"), which didn't match anywhere else.
  if (type === 'rest' || type === 'mobility' || type === 'walk' || type === 'recovery') {
    return (
      <svg viewBox="0 0 256 256" preserveAspectRatio="xMidYMid meet" style={style}>
        <path d="M128,80A32,32,0,1,0,96,48,32,32,0,0,0,128,80Zm0-48a16,16,0,1,1-16,16A16,16,0,0,1,128,32Zm96,72a8,8,0,0,1-8,8H136v26.72l51.15,21.93A8,8,0,0,1,192,168v48a8,8,0,0,1-16,0V173.28l-46.45-19.91L53.35,222a8,8,0,1,1-10.7-11.9L120,140.44V112H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,104Z"
          fill="#34d399" opacity={missed ? 0.5 : 0.9} />
      </svg>
    );
  }
  if (type === 'race') {
    return (
      <svg viewBox="0 0 100 30" style={style}>
        <line x1="46" y1="6" x2="46" y2="24" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />
        <path d="M46,7 L60,11 L46,15 Z" fill="#ef4444" />
      </svg>
    );
  }

  // Run silhouette. Missed → faint grey ghost (stroke only). Done → solid fill.
  // Upcoming/today → gradient fill.
  const color = missed ? '#8b9099' : (COLOR[type] || '#5eead4');
  const { line, area } = silPath(PROFILES[type] || PROFILES.easy_run);
  const gid = `plt-sil-${idx}`;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ ...style, opacity: missed ? 0.42 : 1 }}>
      {!missed && (
        done
          ? <path d={area} fill={color} fillOpacity="0.30" />
          : <>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gid})`} />
            </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

// Day-letter row signage: done = green + ✓, off-plan = blue + "+", missed = dim,
// today = teal bold, upcoming/rest = muted.
function dayLetterStyle(status) {
  switch (status) {
    case 'done':    return { color: '#34d399', fontWeight: 600 };
    case 'offplan': return { color: '#60a5fa', fontWeight: 600 };
    case 'today':   return { color: '#5eead4', fontWeight: 700 };
    case 'missed':  return { color: '#6b7280', opacity: 0.6 };
    default:        return { color: '#6b7280', fontWeight: 400 };
  }
}
function dayLetterText(label, status) {
  const L = label[0];
  if (status === 'done') return `${L} ✓`;
  if (status === 'offplan') return `${L} +`;
  return L;
}

export default function MobilePlanTicker({ onOpenTab }) {
  let summary;
  try { summary = summarizePlanWeek(new Date()); } catch { return null; }
  if (!summary) return null;

  // Peer-tile styling: same card surface + hairline border + top category accent
  // as the metric tiles, so the strip reads as a first-class element rather than a
  // dark band among the lighter tiles.
  const panel = {
    background: SURFACE.card, border: `1px solid ${SURFACE.border}`, borderRadius: 14,
    padding: '9px 12px 7px', marginBottom: 6, cursor: 'pointer', position: 'relative', overflow: 'hidden',
  };
  const accent = <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, borderRadius: '0 0 2px 2px', background: '#5eead4', opacity: 0.7 }} />;
  const hdrLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5eead4' };
  const open = () => onOpenTab?.('races');

  if (!summary.hasPlan) {
    return (
      <div style={panel} onClick={open} role="button" tabIndex={0}>
        {accent}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={hdrLabel}>This week</span>
          <span style={{ fontSize: 11, color: '#5eead4' }}>Set up a plan ›</span>
        </div>
      </div>
    );
  }

  // Phase pill (quiet) — from the season coach; hidden when no season.
  let phase = null;
  try {
    const sc = getSeasonCoach();
    if (sc && sc.plan && sc.plan.phase) phase = PHASE[sc.plan.phase] || { label: sc.plan.phase, color: '#60a5fa' };
  } catch { /* none */ }

  return (
    <div style={panel} onClick={open} role="button" tabIndex={0}>
      {accent}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={hdrLabel}>This week</span>
        {phase && <span style={{ fontSize: 9.5, fontWeight: 600, color: phase.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{phase.label}</span>}
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 15, height: 1, background: 'rgba(255,255,255,0.10)' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 3 }}>
          {summary.days.map((d, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', padding: '2px 1px 0', background: d.isToday ? 'rgba(94,234,212,0.07)' : 'transparent', borderRadius: 8 }}>
              <DayMark type={d.type} idx={i} status={d.status} />
              <div style={{ fontSize: 8.5, marginTop: 3, whiteSpace: 'nowrap', ...dayLetterStyle(d.status) }}>{dayLetterText(d.label, d.status)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
