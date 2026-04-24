// ─── NutritionInput: Complete Nutrition Panel ────────────────────────────────
// Redesigned layout (2026 spring refresh):
//   1. Five macro dials — Calories / Protein / Carbs / Fat / Fiber
//   2. Foldable Supplement Stack (collapsed by default)
//   3. 10 Health Systems (5×2 grid) fed by food + supplements
//   4. Micronutrients — food + supplements combined
//   5. Macros vs Goal (bars)
//   6. Water record
//   7. Log Food button (expands to Manual / Barcode / Photo / Voice)
//
// Works on both desktop (Daily tab) and mobile (Fuel tab).

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { STATUS } from '../core/semantics.js';
import { getGoals } from '../core/goals.js';
import {
  MEAL_CATEGORIES, createEntry, saveEntry, deleteEntry,
  getEntriesForDate, dailyTotals, goalImpact,
  lookupBarcode, searchFood, calculatePortion, recognizeFoodPhoto,
} from '../core/nutrition.js';

// Local date helper — avoids UTC rollover bug with toISOString()
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
import {
  getStack, getTodayTaken, takeAllInSlot, TIME_SLOTS,
} from '../core/supplements.js';
// Note: getCatalog & toggleTaken removed — no longer needed here.
// Editing happens in SupplementsTab (Stack tab under More).
import { getSystemsReport, getMicronutrientSummary } from '../core/healthSystems.js';

// ─── Shared panel styling (uses CSS vars to match Activity panel in Daily Log) ─
const panelStyle = {
  background: 'var(--bg-surface)',
  border: '0.5px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  padding: '14px 16px',
};

const sectionLabel = {
  fontSize: 9,
  fontWeight: 500,
  color: 'var(--text-muted)',
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  marginBottom: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 7,
};
const sectionDot = (color) => ({
  width: 6, height: 6, borderRadius: '50%',
  background: color, boxShadow: `0 0 6px ${color}80`,
});

const INPUT_MODES = [
  { id: 'manual',  label: 'Manual',  icon: '✎' },
  { id: 'barcode', label: 'Barcode', icon: '⊞' },
  { id: 'photo',   label: 'Photo',   icon: '◉' },
  { id: 'voice',   label: 'Voice',   icon: '◎' },
];

// ═════════════════════════════════════════════════════════════════════════════
// MacroDial — Activity-style dial with unit on top, value in middle, target below
// Matches the SmallDial visual from Arnold.jsx
// ═════════════════════════════════════════════════════════════════════════════
function MacroDial({ value, target, color, unit, label }) {
  const pct = Math.min((value || 0) / (target || 1), 1);
  const safePct = Math.max(0, pct);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 3, flex: 1, minWidth: 0,
    }}>
      <svg width="54" height="54" viewBox="0 0 54 54">
        <circle cx="27" cy="27" r="21" fill="none"
          stroke="var(--bg-input)" strokeWidth="4.5" />
        <circle cx="27" cy="27" r="21" fill="none"
          stroke={color} strokeWidth="4.5"
          strokeDasharray={`${safePct * 132} 132`}
          strokeDashoffset={-16.5}
          strokeLinecap="round"
          transform="rotate(135 27 27)" />
        <text x="27" y="23" textAnchor="middle" fontSize="6.5"
          fill="var(--text-muted)"
          style={{ fontFamily: 'var(--font-ui)' }}>{unit}</text>
        <text x="27" y="33" textAnchor="middle" fontSize="11" fontWeight="500"
          fill="var(--text-primary)"
          style={{ fontFamily: 'var(--font-ui)' }}>
          {value != null ? Math.round(value) : '—'}
        </text>
        <text x="27" y="41" textAnchor="middle" fontSize="6"
          fill="var(--text-muted)"
          style={{ fontFamily: 'var(--font-ui)' }}>/ {target}</text>
      </svg>
      <span style={{
        fontSize: 9, color: 'var(--text-muted)',
      }}>{label}</span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Daily Log Strip — Hydration (left) + Stack (right) in one compact container
// ═════════════════════════════════════════════════════════════════════════════
function DailyLogStrip({ dateStr, totalWater, onUpdate }) {
  // ─── Water ───
  const GLASS_ML = 250;
  const BOTTLE_ML = 1000;
  const goalMl = 3000;
  const waterMl = totalWater || 0;
  const pct = Math.min(waterMl / goalMl, 1);

  const logAmount = (ml) => {
    const entry = createEntry({
      name: `Water (${ml} ml)`,
      date: dateStr,
      meal: 'snack',
      source: 'manual',
      macros: { calories: 0, protein: 0, carbs: 0, fat: 0, water: ml },
    });
    saveEntry(entry);
    onUpdate?.();
  };

  // ─── Stack ───
  const [, bump] = useState(0);
  const stack = useMemo(() => getStack(), []);
  const taken = getTodayTaken(dateStr);
  const slotEntries = slot => stack.filter(s => s.timeOfDay === slot);
  const totalCount = stack.length;
  const takenCount = Object.keys(taken).length;
  const allDone = totalCount > 0 && takenCount >= totalCount;
  const hasStack = stack.length > 0;

  const onTakeAll = (slotId) => {
    takeAllInSlot(dateStr, slotId);
    bump(x => x + 1);
    onUpdate?.();
  };

  const slotColors = { morning: '#fbbf24', afternoon: '#60a5fa', evening: '#a78bfa' };
  const slotShort = { morning: 'AM', afternoon: 'Noon', evening: 'PM' };

  // ─── Detect narrow (mobile) vs wide (desktop) ───
  const containerRef = useRef(null);
  const [isNarrow, setIsNarrow] = useState(window.innerWidth < 600);
  useEffect(() => {
    const check = () => setIsNarrow(window.innerWidth < 600);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Shared slot button renderer
  const SlotBtn = ({ slot, inline }) => {
    const entries = slotEntries(slot.id);
    const slotTaken = entries.filter(e => taken[e.id]).length;
    const done = entries.length > 0 && slotTaken === entries.length;
    const sc = slotColors[slot.id];
    return (
      <button
        onClick={() => !done && onTakeAll(slot.id)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
          flex: inline ? 1 : undefined, width: inline ? undefined : '100%',
          padding: inline ? '5px 4px' : '5px 8px', borderRadius: 7,
          cursor: done ? 'default' : 'pointer',
          border: `0.5px solid ${done ? sc + '40' : 'var(--border-default)'}`,
          background: done ? sc + '18' : 'rgba(255,255,255,0.03)',
          color: done ? sc : 'var(--text-secondary)',
          fontSize: 9, fontWeight: 600,
          transition: 'all 0.15s',
          opacity: entries.length === 0 ? 0.4 : 1,
        }}>
        <span style={{ fontSize: 11 }}>{slot.icon}</span>
        <span>{slotShort[slot.id]}</span>
        <span style={{ fontSize: 7, opacity: 0.7, fontFamily: 'var(--font-mono)' }}>
          {slotTaken}/{entries.length}
        </span>
        {done && <span style={{ fontSize: 8 }}>✓</span>}
      </button>
    );
  };

  // ─── Shared SVG: water bottle ───
  const WaterBottle = ({ w, h }) => (
    <svg width={w} height={h} viewBox="0 0 50 60" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="wf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee"/><stop offset="100%" stopColor="#0891b2"/>
        </linearGradient>
        <clipPath id="bs">
          <path d="M18 8 Q18 4 22 4 L28 4 Q32 4 32 8 L32 14 Q38 18 38 26 L38 54 Q38 58 34 58 L16 58 Q12 58 12 54 L12 26 Q12 18 18 14 Z"/>
        </clipPath>
      </defs>
      <path d="M18 8 Q18 4 22 4 L28 4 Q32 4 32 8 L32 14 Q38 18 38 26 L38 54 Q38 58 34 58 L16 58 Q12 58 12 54 L12 26 Q12 18 18 14 Z"
        fill="rgba(34,211,238,0.05)" stroke="rgba(34,211,238,0.35)" strokeWidth="1.5"/>
      <rect x="0" y={58 - pct * 54} width="50" height={pct * 54 + 4}
        fill="url(#wf)" clipPath="url(#bs)" opacity="0.85"/>
    </svg>
  );

  // ─── MOBILE: two rows stacked — hydration row, then stack row ───
  if (isNarrow) {
    return (
      <div style={panelStyle} ref={containerRef}>
        {/* Row 1: Hydration — big bottle left, liters + % + buttons right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <WaterBottle w={28} h={36} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#22d3ee', fontFamily: 'var(--font-mono)' }}>
              {(waterMl / 1000).toFixed(1)}<span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 1 }}>L</span>
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{Math.round(pct * 100)}%</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button onClick={() => logAmount(GLASS_ML)} style={{
                padding: '5px 8px', background: 'rgba(34,211,238,0.08)',
                border: '0.5px solid rgba(34,211,238,0.25)', borderRadius: 6,
                color: '#22d3ee', fontSize: 9, fontWeight: 600, cursor: 'pointer',
              }}>+250ml</button>
              <button onClick={() => logAmount(BOTTLE_ML)} style={{
                padding: '5px 8px', background: 'rgba(34,211,238,0.08)',
                border: '0.5px solid rgba(34,211,238,0.25)', borderRadius: 6,
                color: '#22d3ee', fontSize: 9, fontWeight: 600, cursor: 'pointer',
              }}>+1L</button>
            </div>
          </div>
        </div>

        {/* Row 2: Stack — big pill left, count + 3 inline slot buttons right */}
        {hasStack && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border-subtle)' }}>
            <span style={{ fontSize: 28, flexShrink: 0, lineHeight: 1 }}>💊</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 9, fontWeight: 500, color: allDone ? '#a78bfa' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                {takenCount}/{totalCount}{allDone ? ' ✓' : ''}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {TIME_SLOTS.map(slot => <SlotBtn key={slot.id} slot={slot} inline />)}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── DESKTOP: single row — hydration left, stack right ───
  return (
    <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', gap: 12 }} ref={containerRef}>
      {/* Hydration side */}
      <WaterBottle w={24} h={30} />
      <div style={{ fontSize: 13, fontWeight: 700, color: '#22d3ee', fontFamily: 'var(--font-mono)' }}>
        {(waterMl / 1000).toFixed(1)}<span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 1 }}>L</span>
      </div>
      <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{Math.round(pct * 100)}%</div>
      <div style={{ display: 'flex', gap: 5 }}>
        <button onClick={() => logAmount(GLASS_ML)} style={{
          padding: '5px 10px', background: 'rgba(34,211,238,0.08)',
          border: '0.5px solid rgba(34,211,238,0.25)', borderRadius: 7,
          color: '#22d3ee', fontSize: 9, fontWeight: 600, cursor: 'pointer',
        }}>+250ml</button>
        <button onClick={() => logAmount(BOTTLE_ML)} style={{
          padding: '5px 10px', background: 'rgba(34,211,238,0.08)',
          border: '0.5px solid rgba(34,211,238,0.25)', borderRadius: 7,
          color: '#22d3ee', fontSize: 9, fontWeight: 600, cursor: 'pointer',
        }}>+1L</button>
      </div>

      {/* Divider */}
      {hasStack && <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', margin: '2px 4px' }} />}

      {/* Stack side */}
      {hasStack && <>
        <span style={{ fontSize: 15 }}>💊</span>
        <span style={{ fontSize: 9, fontWeight: 500, color: allDone ? '#a78bfa' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {takenCount}/{totalCount}{allDone ? ' ✓' : ''}
        </span>
        <div style={{ display: 'flex', gap: 5, flex: 1 }}>
          {TIME_SLOTS.map(slot => <SlotBtn key={slot.id} slot={slot} inline />)}
        </div>
      </>}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Health Systems — 10 tiles in 5×2 grid, fill from 0→100% based on nutrients
// ═════════════════════════════════════════════════════════════════════════════
const SYSTEM_ICONS = {
  brain: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8 2 5 5 5 9c0 2 .5 3.5 1.5 5 .8 1.2 1 2.5 1 4h9c0-1.5.2-2.8 1-4 1-1.5 1.5-3 1.5-5 0-4-3-7-7-7z"/><path d="M9 18h6v2a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-2z"/><path d="M12 2v16"/><path d="M6.5 8c2 1 3.5 1.5 5.5 1.5s3.5-.5 5.5-1.5"/><path d="M7 12.5c1.5.8 3 1 5 1s3.5-.2 5-1"/></svg>,
  heart: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z"/></svg>,
  bones: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="9" width="4" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/><line x1="6" y1="12" x2="18" y2="12"/><rect x="5" y="7" width="2" height="10" rx="0.5"/><rect x="17" y="7" width="2" height="10" rx="0.5"/></svg>,
  gut: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 4h10c1.5 0 2.5 1 2.5 2.5S18.5 9 17 9H7c-1.5 0-2.5 1-2.5 2.5S6 14 7 14h10"/><path d="M17 14c1.5 0 2.5 1 2.5 2.5S18.5 19 17 19H7"/><circle cx="5" cy="19" r="1.2" fill={c} stroke="none"/></svg>,
  immune: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 L4 7v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-5Z"/></svg>,
  energy: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>,
  longevity: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>,
  sleep: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  metabolism: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h4l2-8 4 16 2-8h4"/></svg>,
  endurance: (c) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12c4-6 8-6 12 0s8 6 12 0"/></svg>,
};

function HealthSystemTile({ sys }) {
  const { pct, status, comment, color, name, id } = sys;
  const statusColor = status === 'good' ? '#4ade80' : status === 'focus' ? '#fbbf24' : '#f87171';
  const fillTint = status === 'good' ? 'rgba(74,222,128,0.15)'
    : status === 'focus' ? 'rgba(251,191,36,0.15)'
    : 'rgba(248,113,113,0.18)';
  const icon = SYSTEM_ICONS[id] ? SYSTEM_ICONS[id](color) : null;

  return (
    <div style={{
      position: 'relative',
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '10px 6px 9px',
      overflow: 'hidden',
      minHeight: 0,
    }}>
      {/* Fill layer — fills from bottom up based on pct */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${Math.max(8, pct)}%`,
        background: `linear-gradient(180deg, transparent, ${fillTint})`,
        borderRadius: '0 0 12px 12px',
        transition: 'height 0.6s ease',
        zIndex: 0,
      }} />
      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{
          width: 26, height: 26, margin: '0 auto 5px',
          borderRadius: 7,
          background: 'var(--bg-elevated)',
          border: '0.5px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div style={{
          fontSize: 9, fontWeight: 600, color: 'var(--text-primary)',
          lineHeight: 1.15, marginBottom: 3, minHeight: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{name.replace(' & ', '/')}</div>
        <div style={{
          fontSize: 13, fontWeight: 700, color: statusColor,
          fontFamily: 'var(--font-mono)', marginBottom: 3,
        }}>{pct}%</div>
        <div style={{
          fontSize: 8, color: 'var(--text-muted)',
          lineHeight: 1.25, minHeight: 20,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>{comment}</div>
      </div>
    </div>
  );
}

function HealthSystemsGrid({ dateStr, refreshKey }) {
  const report = useMemo(() => getSystemsReport(dateStr), [dateStr, refreshKey]);
  return (
    <div style={panelStyle}>
      <div style={sectionLabel}>
        <span style={sectionDot('#a78bfa')} />
        Health Systems
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}>
        {report.map(sys => <HealthSystemTile key={sys.id} sys={sys} />)}
      </div>
      {/* Legend */}
      <div style={{
        display: 'flex', gap: 12, marginTop: 10, paddingTop: 8,
        borderTop: '0.5px solid var(--border-subtle)',
        fontSize: 8.5, color: 'var(--text-muted)',
        justifyContent: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4ade80' }}/>
          On track
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fbbf24' }}/>
          Focus
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f87171' }}/>
          Low
        </span>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Micronutrients — food + supplement combined, bars w/ source
// ═════════════════════════════════════════════════════════════════════════════
function MicronutrientsPanel({ dateStr, refreshKey }) {
  const list = useMemo(() => getMicronutrientSummary(dateStr), [dateStr, refreshKey]);
  const pctColor = (p) => p >= 80 ? '#4ade80' : p >= 50 ? '#fbbf24' : '#f87171';
  const barGrad = (p) =>
    p >= 80 ? 'linear-gradient(90deg, #4ade80, #2dd4bf)'
    : p >= 50 ? 'linear-gradient(90deg, #fbbf24, #fb923c)'
    : 'linear-gradient(90deg, #f87171, #fb923c)';

  return (
    <>
      <div style={sectionLabel}>
        <span style={sectionDot('#22d3ee')} />
        Micronutrients · food + supplements
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(125px, 1fr))',
        gap: 7,
      }}>
        {list.map(n => (
          <div key={n.name} style={{
            padding: '7px 9px',
            background: 'var(--bg-elevated)',
            border: '0.5px solid var(--border-subtle)',
            borderRadius: 9,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'baseline', marginBottom: 4,
            }}>
              <span style={{
                fontSize: 10, color: 'var(--text-primary)',
                fontWeight: 500,
              }}>{n.name}</span>
              <span style={{
                fontSize: 9, color: pctColor(n.pct),
                fontFamily: 'var(--font-mono)', fontWeight: 600,
              }}>{n.pct}%</span>
            </div>
            <div style={{
              height: 3, borderRadius: 2,
              background: 'var(--bg-input)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(n.pct, 100)}%`,
                height: '100%', borderRadius: 2,
                background: barGrad(n.pct),
                transition: 'width 0.4s ease',
              }}/>
            </div>
            <div style={{
              fontSize: 8, color: 'var(--text-muted)',
              marginTop: 3, fontStyle: 'italic',
            }}>{n.source}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Macros vs Goal bars
// ═════════════════════════════════════════════════════════════════════════════
function MacroBar({ label, value, goal, gradient, unit = 'g' }) {
  const pct = Math.min((value || 0) / (goal || 1), 1);
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '60px 1fr 90px',
      gap: 10, alignItems: 'center', marginBottom: 6,
    }}>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
      <div style={{
        height: 5, borderRadius: 3,
        background: 'var(--bg-input)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct * 100}%`, height: '100%',
          borderRadius: 3, background: gradient,
          transition: 'width 0.4s ease',
        }}/>
      </div>
      <span style={{
        fontSize: 10, color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)', textAlign: 'right',
      }}>{Math.round(value || 0)} / {goal}{unit !== 'kcal' ? unit : ''}</span>
    </div>
  );
}

function MacrosVsGoal({ totals, goals }) {
  return (
    <>
      <div style={sectionLabel}>
        <span style={sectionDot('#fbbf24')} />
        Macros vs Goal
      </div>
      <MacroBar label="Calories" value={totals.calories}
        goal={parseFloat(goals.dailyCalorieTarget) || 2200}
        gradient="linear-gradient(90deg, #60a5fa, #22d3ee)" unit="kcal"/>
      <MacroBar label="Protein" value={totals.protein}
        goal={parseFloat(goals.dailyProteinTarget) || 150}
        gradient="linear-gradient(90deg, #4ade80, #2dd4bf)"/>
      <MacroBar label="Carbs" value={totals.carbs}
        goal={parseFloat(goals.dailyCarbTarget) || 180}
        gradient="linear-gradient(90deg, #fbbf24, #fb923c)"/>
      <MacroBar label="Fat" value={totals.fat}
        goal={parseFloat(goals.dailyFatTarget) || 65}
        gradient="linear-gradient(90deg, #f472b6, #a78bfa)"/>
      <MacroBar label="Fiber" value={totals.fiber}
        goal={parseFloat(goals.dailyFiberTarget) || 35}
        gradient="linear-gradient(90deg, #a78bfa, #60a5fa)"/>
    </>
  );
}


// ═════════════════════════════════════════════════════════════════════════════
// Portion Selector (reused from old file)
// ═════════════════════════════════════════════════════════════════════════════
const PORTION_UNITS_FULL = [
  { id: 'serving', label: 'Serving' },
  { id: 'g',       label: 'Grams' },
  { id: 'oz',      label: 'Oz' },
  { id: 'ml',      label: 'mL' },
  { id: 'cup',     label: 'Cup' },
  { id: 'tbsp',    label: 'Tbsp' },
  { id: 'tsp',     label: 'Tsp' },
];
const PORTION_UNITS_SERVING_ONLY = [{ id: 'serving', label: 'Serving' }];

function PortionSelector({ baseMacros, per100g, servingLabel, onChange }) {
  const [unit, setUnit] = useState('serving');
  const [amount, setAmount] = useState('1');
  const hasWeight = !!per100g;
  const units = hasWeight ? PORTION_UNITS_FULL : PORTION_UNITS_SERVING_ONLY;

  const recalc = useCallback((u, amt) => {
    const n = parseFloat(amt);
    if (!n || n <= 0 || !baseMacros) { onChange?.(baseMacros, '1 serving'); return; }
    if (u === 'serving') {
      const scaled = {};
      for (const k of Object.keys(baseMacros)) {
        scaled[k] = k === 'calories' ? Math.round((baseMacros[k] || 0) * n)
          : Math.round(((baseMacros[k] || 0) * n) * 10) / 10;
      }
      onChange?.(scaled, n === 1 ? '1 serving' : `${amt} servings`);
    } else if (per100g) {
      const adj = calculatePortion(per100g, n, u);
      onChange?.(adj, `${amt} ${u}`);
    }
  }, [baseMacros, per100g, onChange]);

  useEffect(() => { recalc('serving', '1'); }, [baseMacros]);

  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>How much?</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
        {units.map(u => (
          <button key={u.id} onClick={() => { setUnit(u.id); recalc(u.id, amount); }}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: unit === u.id ? '1px solid rgba(96,165,250,0.5)' : '0.5px solid var(--border-default)',
              background: unit === u.id ? 'rgba(96,165,250,0.15)' : 'var(--bg-input)',
              color: unit === u.id ? '#60a5fa' : 'var(--text-secondary)',
            }}>{u.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {[0.5, 1, 1.5, 2].map(v => (
          <button key={v} onClick={() => { setAmount(String(v)); recalc(unit, String(v)); }}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              border: amount === String(v) ? '1px solid rgba(96,165,250,0.4)' : '0.5px solid var(--border-subtle)',
              background: amount === String(v) ? 'rgba(96,165,250,0.1)' : 'var(--bg-surface)',
              color: amount === String(v) ? '#60a5fa' : 'var(--text-muted)',
              minWidth: 32,
            }}>{v}</button>
        ))}
        <input value={amount}
          onChange={e => { setAmount(e.target.value); recalc(unit, e.target.value); }}
          type="number" min="0" step="any"
          style={{ width: 50, padding: '5px 6px', borderRadius: 8, border: '0.5px solid var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, textAlign: 'center' }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {unit === 'serving' ? (servingLabel || 'serving') : unit}
        </span>
      </div>
    </div>
  );
}

function MacroLine({ macros }) {
  if (!macros) return null;
  return (
    <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0', borderTop: '0.5px solid var(--border-subtle)' }}>
      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 12 }}>{macros.calories || 0}</span> cal
      {' · '}<span style={{ color: '#60a5fa' }}>{macros.protein || 0}g</span> P
      {' · '}<span style={{ color: '#fbbf24' }}>{macros.carbs || 0}g</span> C
      {' · '}<span style={{ color: '#f87171' }}>{macros.fat || 0}g</span> F
      {macros.fiber ? <span> · {macros.fiber}g fiber</span> : null}
    </div>
  );
}

function ImpactBadge({ score, reasons }) {
  if (score === 0 && (!reasons || !reasons.length)) return null;
  const color = score > 0 ? STATUS.ok.color : score < 0 ? STATUS.warn.color : 'var(--text-muted)';
  const arrow = score > 0 ? '↑' : score < 0 ? '↓' : '—';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, background: `${color}15`, border: `1px solid ${color}25` }}>
      <span style={{ fontSize: 11, color }}>{arrow}</span>
      <span style={{ fontSize: 9, color, fontWeight: 600 }}>{reasons?.[0]?.text || 'Neutral'}</span>
    </div>
  );
}

function EntryRow({ entry, onDelete }) {
  const G = getGoals();
  const impact = goalImpact(entry, G);
  const mealCat = MEAL_CATEGORIES.find(m => m.id === entry.meal);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderBottom: '0.5px solid var(--border-subtle)',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: `${mealCat?.color || '#6b7280'}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>{mealCat?.icon || '◈'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.name}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
          {Math.round(entry.macros?.calories || 0)} cal · {Math.round(entry.macros?.protein || 0)}g P · {Math.round(entry.macros?.carbs || 0)}g C · {Math.round(entry.macros?.fat || 0)}g F
        </div>
        {impact.reasons.length > 0 && <ImpactBadge score={impact.score} reasons={impact.reasons} />}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{entry.time}</div>
        <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{entry.source}</div>
      </div>
      <button onClick={() => onDelete(entry.id)} style={{
        background: 'none', border: 'none', color: 'var(--text-muted)',
        fontSize: 14, cursor: 'pointer', padding: 4,
      }}>×</button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LogFoodPanel — manual/barcode/photo/voice (opens when "Log Food" tapped)
// ═════════════════════════════════════════════════════════════════════════════
function LogFoodPanel({ dateStr, onSaved, onCancel }) {
  const [mode, setMode] = useState('manual');
  const [selectedMeal, setSelectedMeal] = useState('snack');

  // Manual
  const [manualName, setManualName] = useState('');
  const [manualCal, setManualCal] = useState('');
  const [manualPro, setManualPro] = useState('');
  const [manualCarb, setManualCarb] = useState('');
  const [manualFat, setManualFat] = useState('');
  const [manualFiber, setManualFiber] = useState('');
  const [manualWater, setManualWater] = useState('');

  // Barcode
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResult, setBarcodeResult] = useState(null);
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);

  // Portion
  const [portionMacros, setPortionMacros] = useState(null);
  const [portionLabel, setPortionLabel] = useState('1 serving');
  const handlePortionChange = useCallback((macros, label) => {
    setPortionMacros(macros);
    setPortionLabel(label || '1 serving');
  }, []);

  // Photo
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoError, setPhotoError] = useState('');
  const [photoPreview, setPhotoPreview] = useState(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Voice
  const [voiceText, setVoiceText] = useState('');
  const [voiceListening, setVoiceListening] = useState(false);

  const addEntry = (opts) => {
    const entry = createEntry({ ...opts, date: dateStr, meal: selectedMeal });
    saveEntry(entry);
    onSaved?.();
  };

  const handleBarcodeLookup = async (code) => {
    const barcode = code || barcodeInput.trim();
    if (!barcode) return;
    setBarcodeInput(barcode);
    setBarcodeLoading(true);
    const result = await lookupBarcode(barcode);
    setBarcodeResult(result);
    setBarcodeLoading(false);
    setPortionMacros(null);
    setPortionLabel('1 serving');
  };

  const handlePhotoAnalysis = useCallback(async (file) => {
    setPhotoLoading(true);
    setPhotoError('');
    setPhotoResult(null);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setPhotoPreview(URL.createObjectURL(file));
      const mediaType = file.type || 'image/jpeg';
      const result = await recognizeFoodPhoto(base64, mediaType);
      if (result.error) setPhotoError(result.error);
      else setPhotoResult(result);
    } catch (e) {
      setPhotoError(`Analysis failed: ${e.message}`);
    } finally {
      setPhotoLoading(false);
    }
  }, []);

  const stopScanner = useCallback(() => {
    if (scanLoopRef.current) { clearInterval(scanLoopRef.current); scanLoopRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScannerActive(false);
  }, []);

  const startScanner = useCallback(async () => {
    setScannerError('');
    if (!('BarcodeDetector' in window)) {
      setScannerError('Camera scanning not supported in this browser. Use manual entry below.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      setScannerActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] });
      let lastDetected = '';
      scanLoopRef.current = setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0 && barcodes[0].rawValue !== lastDetected) {
            lastDetected = barcodes[0].rawValue;
            stopScanner();
            handleBarcodeLookup(barcodes[0].rawValue);
          }
        } catch { /* ignore */ }
      }, 400);
    } catch (err) {
      setScannerError(err.name === 'NotAllowedError'
        ? 'Camera access denied. Please allow camera permissions and try again.'
        : `Camera error: ${err.message}`);
      stopScanner();
    }
  }, [stopScanner]);

  useEffect(() => { return () => stopScanner(); }, [stopScanner]);
  useEffect(() => { if (mode !== 'barcode') stopScanner(); }, [mode, stopScanner]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    const results = await searchFood(searchQuery.trim());
    setSearchResults(results);
    setSearchLoading(false);
  };

  const startVoice = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Speech recognition not supported in this browser');
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      setVoiceText(text);
      const calMatch = text.match(/(\d+)\s*cal/i);
      const proMatch = text.match(/(\d+)\s*(?:grams?\s+(?:of\s+)?)?protein/i);
      setManualName(text.replace(/\d+\s*cal(?:ories?)?\s*(?:of\s*)?/i, '').replace(/\d+\s*grams?\s*(?:of\s*)?protein/i, '').trim() || text);
      if (calMatch) setManualCal(calMatch[1]);
      if (proMatch) setManualPro(proMatch[1]);
      setMode('manual');
    };
    rec.onerror = () => setVoiceListening(false);
    rec.onend = () => setVoiceListening(false);
    setVoiceListening(true);
    rec.start();
  };

  return (
    <div style={{ ...panelStyle, overflow: 'hidden' }}>
      {/* Meal category selector */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', marginBottom: 10, padding: '0 0 4px' }}>
        {MEAL_CATEGORIES.map(m => (
          <button key={m.id} onClick={() => setSelectedMeal(m.id)} style={{
            padding: '5px 10px', borderRadius: 20, cursor: 'pointer',
            background: selectedMeal === m.id ? `${m.color}25` : 'var(--bg-input)',
            color: selectedMeal === m.id ? m.color : 'var(--text-muted)',
            fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
            border: selectedMeal === m.id ? `1px solid ${m.color}40` : '1px solid transparent',
          }}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Input mode tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
        {INPUT_MODES.map(m => (
          <button key={m.id} onClick={() => setMode(m.id)} style={{
            flex: 1, padding: '7px 4px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: mode === m.id ? 'rgba(96,165,250,0.15)' : 'var(--bg-input)',
            color: mode === m.id ? '#60a5fa' : 'var(--text-muted)',
            fontSize: 10, fontWeight: 600,
          }}>
            <div style={{ fontSize: 14 }}>{m.icon}</div>
            {m.label}
          </button>
        ))}
      </div>

      {/* MANUAL */}
      {mode === 'manual' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search food database..."
              style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <button onClick={handleSearch} disabled={searchLoading} style={{
              padding: '9px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 12, fontWeight: 600,
            }}>{searchLoading ? '...' : '⌕'}</button>
          </div>
          {searchResults.length > 0 && (
            <div style={{ maxHeight: 160, overflowY: 'auto', borderRadius: 10, background: 'var(--bg-surface)' }}>
              {searchResults.map((r, i) => (
                <div key={i} onClick={() => {
                  setManualName(r.name + (r.brand ? ` (${r.brand})` : ''));
                  setManualCal(String(r.macros.calories));
                  setManualPro(String(r.macros.protein));
                  setManualCarb(String(r.macros.carbs));
                  setManualFat(String(r.macros.fat));
                  if (r.macros.fiber != null) setManualFiber(String(r.macros.fiber));
                  setSearchResults([]);
                }} style={{
                  padding: '8px 12px', cursor: 'pointer', borderBottom: '0.5px solid var(--border-subtle)',
                  fontSize: 11, color: 'var(--text-primary)',
                }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {r.brand ? `${r.brand} · ` : ''}{r.macros.calories} cal · {r.macros.protein}g P
                  </div>
                </div>
              ))}
            </div>
          )}
          <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder="Food name"
            style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <input value={manualCal} onChange={e => setManualCal(e.target.value)} placeholder="Calories" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <input value={manualPro} onChange={e => setManualPro(e.target.value)} placeholder="Protein (g)" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <input value={manualCarb} onChange={e => setManualCarb(e.target.value)} placeholder="Carbs (g)" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <input value={manualFat} onChange={e => setManualFat(e.target.value)} placeholder="Fat (g)" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <input value={manualFiber} onChange={e => setManualFiber(e.target.value)} placeholder="Fiber (g)" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
            <input value={manualWater} onChange={e => setManualWater(e.target.value)} placeholder="Water (ml)" type="number"
              style={{ padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
          </div>

          {(manualCal || manualPro || manualCarb || manualFat) && (
            <PortionSelector
              baseMacros={{
                calories: parseFloat(manualCal) || 0,
                protein: parseFloat(manualPro) || 0,
                carbs: parseFloat(manualCarb) || 0,
                fat: parseFloat(manualFat) || 0,
                fiber: parseFloat(manualFiber) || 0,
              }}
              onChange={handlePortionChange} />
          )}

          {portionMacros && (manualCal || manualPro || manualCarb || manualFat) && (
            <MacroLine macros={{ ...portionMacros, water: parseFloat(manualWater) || 0 }} />
          )}

          <button onClick={() => {
            if (!manualName.trim() && !manualCal && !manualWater) return;
            const baseMacros = {
              calories: parseFloat(manualCal) || 0,
              protein: parseFloat(manualPro) || 0,
              carbs: parseFloat(manualCarb) || 0,
              fat: parseFloat(manualFat) || 0,
              fiber: parseFloat(manualFiber) || 0,
              water: parseFloat(manualWater) || 0,
            };
            const finalMacros = portionMacros
              ? { ...portionMacros, water: baseMacros.water }
              : baseMacros;
            addEntry({
              name: manualName.trim() || (manualWater ? 'Water' : 'Food'),
              source: 'manual',
              macros: finalMacros,
              ...(portionMacros && portionLabel !== '1 serving' ? { portion: portionLabel } : {}),
            });
          }} style={{
            padding: '10px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 12, fontWeight: 600,
          }}>Save entry</button>
        </div>
      )}

      {/* BARCODE */}
      {mode === 'barcode' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scannerActive && (
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
              <video ref={videoRef} playsInline muted autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ width: '65%', height: '35%', border: '2px solid rgba(96,165,250,0.6)', borderRadius: 12, boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)' }} />
              </div>
              <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                Point at barcode — scanning...
              </div>
              <button onClick={stopScanner} style={{
                position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: '50%',
                background: 'rgba(0,0,0,0.5)', border: 'none', color: 'var(--text-primary)', fontSize: 16, cursor: 'pointer',
              }}>×</button>
            </div>
          )}

          {!scannerActive && !barcodeResult && (
            <button onClick={startScanner} style={{
              padding: '18px 14px', borderRadius: 14, cursor: 'pointer',
              border: '2px dashed rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.06)',
              color: '#60a5fa', fontSize: 13, fontWeight: 600, textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
            }}>
              <span style={{ fontSize: 26 }}>⊞</span>
              Scan Barcode
              <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>
                Point your camera at a barcode
              </span>
            </button>
          )}

          {scannerError && (
            <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)' }}>
              {scannerError}
            </div>
          )}

          {!scannerActive && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleBarcodeLookup()}
                placeholder="Or type barcode number..."
                style={{ flex: 1, padding: '9px 11px', borderRadius: 10, border: '0.5px solid var(--border-default)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12 }} />
              <button onClick={() => handleBarcodeLookup()} disabled={barcodeLoading} style={{
                padding: '9px 13px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 11, fontWeight: 600,
              }}>{barcodeLoading ? '...' : 'Look up'}</button>
            </div>
          )}

          {barcodeResult && (
            <div style={{ padding: '11px', borderRadius: 12, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 8 }}>
                {barcodeResult.imageUrl && <img src={barcodeResult.imageUrl} alt="" style={{ width: 38, height: 38, borderRadius: 8, objectFit: 'cover' }} />}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{barcodeResult.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{barcodeResult.brand}{barcodeResult.servingSize ? ` · ${barcodeResult.servingSize}` : ''}</div>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <PortionSelector
                  baseMacros={barcodeResult.macros}
                  per100g={barcodeResult.per100g}
                  servingLabel={barcodeResult.servingSize}
                  onChange={handlePortionChange} />
              </div>
              <MacroLine macros={portionMacros || barcodeResult.macros} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => {
                  const m = portionMacros || barcodeResult.macros;
                  addEntry({ name: `${barcodeResult.name} (${portionLabel})`, source: 'barcode', macros: m, barcode: barcodeResult.barcode, imageUrl: barcodeResult.imageUrl });
                }} style={{
                  flex: 1, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 11, fontWeight: 600,
                }}>Add this food</button>
                <button onClick={() => { setBarcodeResult(null); setBarcodeInput(''); setPortionMacros(null); }} style={{
                  padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: 11,
                }}>Scan another</button>
              </div>
            </div>
          )}
          {barcodeResult === null && barcodeInput && !barcodeLoading && !scannerActive && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>No product found.</div>
          )}
        </div>
      )}

      {/* PHOTO */}
      {mode === 'photo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!photoResult && !photoLoading && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                Take a photo — AI will identify and estimate macros
              </div>
              <label style={{
                width: '100%', padding: '22px 14px', borderRadius: 14,
                border: '2px dashed rgba(236,72,153,0.3)', textAlign: 'center',
                cursor: 'pointer', color: '#ec4899', fontSize: 13, fontWeight: 600,
                background: 'rgba(236,72,153,0.06)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
              }}>
                <span style={{ fontSize: 26 }}>◉</span>
                Take Photo or Choose Image
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePhotoAnalysis(file); }} />
              </label>
            </>
          )}
          {photoLoading && (
            <div style={{ textAlign: 'center', padding: '18px 10px' }}>
              {photoPreview && <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: 170, objectFit: 'cover', borderRadius: 12, marginBottom: 8, opacity: 0.7 }} />}
              <div style={{ fontSize: 12, color: '#ec4899', fontWeight: 600 }}>Analyzing food...</div>
            </div>
          )}
          {photoError && (
            <div style={{ fontSize: 11, color: '#f87171', textAlign: 'center', padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)' }}>
              {photoError}
              <button onClick={() => { setPhotoError(''); setPhotoPreview(null); }} style={{
                display: 'block', margin: '8px auto 0', padding: '5px 13px', borderRadius: 8,
                border: 'none', cursor: 'pointer', background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: 11,
              }}>Try again</button>
            </div>
          )}
          {photoResult && (
            <div style={{ padding: '11px', borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid rgba(236,72,153,0.15)' }}>
              {photoPreview && <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 10, marginBottom: 7 }} />}
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>{photoResult.name}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 7 }}>
                {photoResult.servingSize}
              </div>
              <div style={{ marginBottom: 7 }}>
                <PortionSelector baseMacros={photoResult.macros} onChange={handlePortionChange} />
              </div>
              <MacroLine macros={portionMacros || photoResult.macros} />
              <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                <button onClick={() => {
                  const m = portionMacros || photoResult.macros;
                  addEntry({ name: `${photoResult.name}${portionLabel !== '1 serving' ? ` (${portionLabel})` : ''}`, source: 'photo', macros: m });
                }} style={{
                  flex: 1, padding: '9px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontSize: 11, fontWeight: 600,
                }}>Add this food</button>
                <button onClick={() => { setPhotoResult(null); setPhotoPreview(null); }} style={{
                  padding: '9px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  background: 'var(--bg-input)', color: 'var(--text-muted)', fontSize: 11,
                }}>Retake</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VOICE */}
      {mode === 'voice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', padding: '8px 0' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Say "300 calories of grilled chicken"
          </div>
          <button onClick={startVoice} style={{
            width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: voiceListening ? 'rgba(239,68,68,0.2)' : 'rgba(96,165,250,0.15)',
            color: voiceListening ? '#ef4444' : '#60a5fa', fontSize: 22,
          }}>{voiceListening ? '●' : '◎'}</button>
          <div style={{ fontSize: 10, color: voiceListening ? '#ef4444' : 'var(--text-muted)' }}>
            {voiceListening ? 'Listening...' : 'Tap to speak'}
          </div>
          {voiceText && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '7px 12px', borderRadius: 8, background: 'var(--bg-elevated)', width: '100%', textAlign: 'center' }}>
              "{voiceText}"
            </div>
          )}
        </div>
      )}

      <button onClick={onCancel} style={{
        marginTop: 8, padding: '7px', borderRadius: 8, border: 'none', cursor: 'pointer',
        background: 'none', color: 'var(--text-muted)', fontSize: 11, width: '100%',
      }}>Cancel</button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════════

export function NutritionInput({ date, onUpdate }) {
  const dateStr = date || localDate();
  const [entries, setEntries] = useState(() => getEntriesForDate(dateStr));
  const [totals, setTotals] = useState(() => dailyTotals(dateStr));
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const G = getGoals();

  useEffect(() => {
    setEntries(getEntriesForDate(dateStr));
    setTotals(dailyTotals(dateStr));
  }, [dateStr]);

  const refresh = () => {
    setEntries(getEntriesForDate(dateStr));
    setTotals(dailyTotals(dateStr));
    setRefreshKey(k => k + 1);
    onUpdate?.();
  };

  const handleDelete = (id) => {
    deleteEntry(id);
    refresh();
  };

  // Food entries that aren't purely a water row — used to gate analytics.
  const realFoodCount = useMemo(() => entries.filter(e => {
    const m = e.macros || {};
    const isWaterOnly = (m.water || 0) > 0 && !(m.calories || m.protein || m.carbs || m.fat);
    return !isWaterOnly;
  }).length, [entries]);

  // Reveal analytics only when there's something to analyse:
  //   - at least one logged food entry, OR
  //   - at least one supplement ticked today.
  // refreshKey is intentionally in deps so ticking a supplement re-reads taken.
  const hasAnyData = useMemo(() => {
    if (realFoodCount > 0) return true;
    const taken = getTodayTaken(dateStr);
    return Object.values(taken || {}).some(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realFoodCount, dateStr, refreshKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ═════ SINGLE NUTRITION PANEL — matches Activity layout ═════ */}
      <div style={panelStyle}>
        {/* Header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom: hasAnyData ? 12 : 0}}>
          <span style={{fontSize:15,fontWeight:500,color:'var(--text-primary)'}}>Nutrition</span>
          <span style={{fontSize:10,color:'var(--text-muted)'}}>today</span>
        </div>

        {hasAnyData && (
          <>
            {/* Macro dials */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 3, alignItems: 'stretch', marginBottom: 14 }}>
              <MacroDial value={totals.calories}
                target={parseFloat(G.dailyCalorieTarget) || 2200}
                color="#60a5fa" unit="kcal" label="Calories" />
              <MacroDial value={totals.protein}
                target={parseFloat(G.dailyProteinTarget) || 150}
                color="#4ade80" unit="g" label="Protein" />
              <MacroDial value={totals.carbs}
                target={parseFloat(G.dailyCarbTarget) || 200}
                color="#fbbf24" unit="g" label="Carbs" />
              <MacroDial value={totals.fat}
                target={parseFloat(G.dailyFatTarget) || 70}
                color="#f472b6" unit="g" label="Fat" />
              <MacroDial value={totals.fiber}
                target={parseFloat(G.dailyFiberTarget) || 35}
                color="#a78bfa" unit="g" label="Fiber" />
            </div>

            {/* Micronutrients */}
            <div style={{height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'}} />
            <MicronutrientsPanel dateStr={dateStr} refreshKey={refreshKey} />

            {/* Macros vs Goal */}
            <div style={{height:'0.5px',background:'var(--border-subtle)',margin:'10px 0'}} />
            <MacrosVsGoal totals={totals} goals={G} />
          </>
        )}

        {!hasAnyData && !showAdd && (
          <div style={{
            textAlign: 'center', padding: '18px 0 4px',
            fontSize: 11, color: 'var(--text-muted)',
            lineHeight: 1.5,
          }}>
            Log food or tick a supplement to see today's macros
            and micronutrient breakdown.
          </div>
        )}
      </div>

      {/* ═════ INPUT — Hydration + Stack strip (always visible) ═════ */}
      <DailyLogStrip dateStr={dateStr} totalWater={totals.water} onUpdate={refresh} />

      {/* ═════ INPUT — Log Food button (always visible) ═════ */}
      {!showAdd && (
        <button onClick={() => setShowAdd(true)} style={{
          padding: '13px', cursor: 'pointer', textAlign: 'center',
          fontSize: 12, fontWeight: 600,
          background: 'linear-gradient(135deg, rgba(96,165,250,0.15), rgba(167,139,250,0.15))',
          border: '1px solid rgba(96,165,250,0.3)',
          borderRadius: 14, color: '#60a5fa',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
          transition: 'transform 0.15s ease',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Log Food
        </button>
      )}

      {showAdd && (
        <LogFoodPanel
          dateStr={dateStr}
          onSaved={() => { setShowAdd(false); refresh(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Today's entries list (food only — water hidden, logged above) */}
      {(()=>{
        const foodEntries = entries.filter(e => {
          const m = e.macros || {};
          const isWaterOnly = (m.water || 0) > 0 && !(m.calories || m.protein || m.carbs || m.fat);
          return !isWaterOnly;
        });
        if (!foodEntries.length) return null;
        return (
          <div style={{ ...panelStyle, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px 6px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              LOGGED TODAY · {foodEntries.length} {foodEntries.length === 1 ? 'item' : 'items'}
            </div>
            {foodEntries.map(e => <EntryRow key={e.id} entry={e} onDelete={handleDelete} />)}
          </div>
        );
      })()}
    </div>
  );
}
