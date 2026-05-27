// ─── Energy Balance Card — Phase 4r.fuel.10 ─────────────────────────────────
// Replaces the previous time-series Energy Timing chart. Four stacked pieces:
//   1. Burn-today stacked bar — RMR + Activity + NEAT/TEF segments
//   2. Eaten-today bar — single fill against target
//   3. Deficit/Surplus hero card — the actionable number
//   4. 7-day balance trend sparkline — bars up = surplus, down = deficit
//
// Filename stays EnergyTimingChart.jsx so existing imports keep working.

import React, { useMemo } from 'react';
import { storage } from '../core/storage.js';
import { computeTDEE } from '../core/energyBalance.js';
import { dailyTotals as nutDailyTotals } from '../core/nutrition.js';
import { ymd } from '../core/time.js';
// Phase 4r.fuel.12 (2026-05-25) — bar colors now respect goal direction
// (cut → deficit is GOOD/green, surplus is BAD/red; bulk → opposite;
// maintain → close-to-zero is good). Read goal direction from
// getOutcomeGoal.
import { getOutcomeGoal } from '../core/goalModel.js';

function formatKcal(n) {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toString();
}

function shiftDate(dateStr, days) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return ymd(d);
  } catch { return null; }
}

function dayLabel(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
  } catch { return ''; }
}

export function EnergyTimingChart({ dateStr, totals, target: targetProp }) {
  // Today's burn breakdown
  const burn = useMemo(() => {
    try {
      const t = computeTDEE(dateStr) || {};
      return {
        rmr: t.rmr || 0,
        activity: t.activityKcal || 0,
        neatTef: (t.neatKcal || 0) + (t.tefKcal || 0),
        total: t.tdee || 0,
      };
    } catch {
      return { rmr: 1685, activity: 0, neatTef: 200, total: 1885 };
    }
  }, [dateStr]);

  const intake = Math.round(totals?.calories || 0);
  // Phase 4r.fuel.11 — use the same dynamic target the Nutrition header
  // shows (passed in as `targetProp`). Falls back to TDEE if not provided.
  const target = (Number.isFinite(targetProp) && targetProp > 0)
    ? Math.round(targetProp)
    : burn.total;
  const net = intake - target;       // negative = deficit, positive = surplus
  const isDeficit = net < 0;

  // 7-day balance trend — compute one day at a time. Each day's target is
  // its own dynamic target (RMR + NEAT + TEF + activity * 0.75), so trend
  // bars compare day-by-day against the same "eat-back" semantics the
  // header uses.
  const trend = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const ds = shiftDate(dateStr, -i);
      if (!ds) continue;
      let dayTarget = 0, dayIntake = 0;
      try {
        const t = computeTDEE(ds) || {};
        const eatBack = (t.activityKcal || 0) * 0.75;
        dayTarget = (t.rmr || 0) + (t.neatKcal || 0) + (t.tefKcal || 0) + eatBack;
      } catch {}
      try { dayIntake = nutDailyTotals(ds)?.calories || 0; } catch {}
      days.push({
        date: ds,
        label: dayLabel(ds),
        balance: dayIntake - dayTarget,
        isToday: i === 0,
      });
    }
    return days;
  }, [dateStr]);

  const trendAvg = trend.length
    ? Math.round(trend.reduce((s, d) => s + d.balance, 0) / trend.length)
    : 0;
  const maxAbs = Math.max(500, ...trend.map(d => Math.abs(d.balance)));

  // Phase 4r.fuel.12 — goal-aware color. Read outcome direction once
  // and translate each bar's balance into "good" or "off" relative to
  // the goal, instead of mechanical positive=green / negative=red.
  // 'cut'   : negative balance (deficit) is GOOD (green), positive (surplus) is BAD (red)
  // 'bulk'  : positive balance (surplus) is GOOD, negative is BAD
  // 'maintain': close to zero is good; far either direction is off
  const goalDirection = useMemo(() => {
    try {
      const o = getOutcomeGoal();
      const lbsToLose = Number(o?.lbsToLose);
      if (Number.isFinite(lbsToLose)) {
        if (lbsToLose > 0.5)  return 'cut';
        if (lbsToLose < -0.5) return 'bulk';
      }
      return 'maintain';
    } catch { return 'maintain'; }
  }, [dateStr]);

  // Color a single day's balance based on goalDirection. Returns
  // a hex color (green/amber/red). Slight magnitude awareness so
  // small drift reads as amber rather than full red.
  function balanceColor(balance) {
    const abs = Math.abs(balance);
    const mild = abs < 200;   // within ~200 kcal of target = small drift
    if (goalDirection === 'cut') {
      if (balance <= 0) return mild ? '#4ade80' : '#22c55e'; // deficit good
      return mild ? '#fbbf24' : '#f87171';                    // surplus off
    }
    if (goalDirection === 'bulk') {
      if (balance >= 0) return mild ? '#4ade80' : '#22c55e'; // surplus good
      return mild ? '#fbbf24' : '#f87171';                    // deficit off
    }
    // maintain: close = good, far = off (direction agnostic)
    if (mild) return '#4ade80';
    return abs < 400 ? '#fbbf24' : '#f87171';
  }

  const trendAvgColor = balanceColor(trendAvg);

  // SVG geometry for the trend strip
  const tw = 280, th = 38;
  const tPad = 4, lPad = 22, rPad = 8;
  const cw = tw - lPad - rPad;
  const ch = th - tPad - 14;
  const cellW = cw / 7;
  const zeroY = tPad + ch / 2;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{
          fontSize: 11, color: '#60a5fa', fontWeight: 500,
          letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          ● Energy balance
        </div>
      </div>

      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        burn today
      </div>
      <div style={{ display: 'flex', height: 18, borderRadius: 3, overflow: 'hidden', background: 'rgba(148,163,184,0.06)', marginBottom: 4 }}>
        <div style={{
          background: '#5eead4', flex: Math.max(1, burn.rmr),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#022e2c', fontWeight: 500, minWidth: 0,
        }}>{formatKcal(burn.rmr)}</div>
        {burn.activity > 0 && (
          <div style={{
            background: '#a78bfa', flex: burn.activity,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#1a1730', fontWeight: 500, minWidth: 0,
          }}>{formatKcal(burn.activity)}</div>
        )}
        {burn.neatTef > 0 && (
          <div style={{
            background: 'rgba(148,163,184,0.4)', flex: burn.neatTef,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#1a1f25', minWidth: 0,
          }}>{formatKcal(burn.neatTef)}</div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginBottom: 12 }}>
        <span><span style={{ color: '#5eead4' }}>●</span> RMR</span>
        <span><span style={{ color: '#a78bfa' }}>●</span> Activity</span>
        <span><span style={{ color: '#94a3b8' }}>●</span> NEAT/TEF</span>
        <span style={{ color: '#cbd5e1', fontWeight: 500 }}>Σ {formatKcal(burn.total)}</span>
      </div>

      <div style={{ fontSize: 9, color: '#94a3b8', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        eaten today
      </div>
      <div style={{ display: 'flex', height: 18, borderRadius: 3, overflow: 'hidden', background: 'rgba(148,163,184,0.06)', marginBottom: 4 }}>
        <div style={{
          background: '#60a5fa', flex: Math.max(1, intake),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#042c53', fontWeight: 500, minWidth: 0,
        }}>{formatKcal(intake)}</div>
        <div style={{ flex: Math.max(0, target - intake) }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginBottom: 14 }}>
        <span><span style={{ color: '#60a5fa' }}>●</span> Intake</span>
        <span style={{ color: '#cbd5e1', fontWeight: 500 }}>/ {formatKcal(target)} target</span>
      </div>

      <div style={{
        background: isDeficit ? 'rgba(248,113,113,0.10)' : 'rgba(74,222,128,0.10)',
        borderRadius: 5, padding: '5px 10px',
        borderLeft: `2px solid ${isDeficit ? '#f87171' : '#4ade80'}`,
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{
            fontSize: 9, color: isDeficit ? '#fecaca' : '#bbf7d0',
            letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 500,
          }}>
            {isDeficit ? 'Deficit' : 'Surplus'}
          </div>
          <div style={{
            fontSize: 16, color: isDeficit ? '#f87171' : '#4ade80',
            fontWeight: 500, fontFamily: 'ui-monospace, monospace', lineHeight: 1,
          }}>
            {net >= 0 ? '+' : ''}{formatKcal(net)}
          </div>
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 9, color: '#94a3b8', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            7-day balance trend
          </div>
          <div style={{ fontSize: 9, color: '#94a3b8' }}>
            <span style={{ color: trendAvgColor }}>
              {trendAvg >= 0 ? '+' : ''}{formatKcal(trendAvg)}
            </span> avg
          </div>
        </div>
        <svg viewBox={`0 0 ${tw} ${th}`} width="100%" height={th} xmlns="http://www.w3.org/2000/svg" fontFamily="ui-sans-serif">
          <line x1={lPad} y1={zeroY} x2={tw - rPad} y2={zeroY}
                stroke="#475569" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.6" />
          <text x={6} y={zeroY + 3} fontSize="7" fill="#64748b">0</text>

          {trend.map((d, i) => {
            const cx = lPad + cellW * i + cellW / 2;
            const barW = Math.max(8, cellW * 0.7);
            const x0 = cx - barW / 2;
            const balRatio = Math.min(1, Math.abs(d.balance) / maxAbs);
            const barH = balRatio * (ch / 2);
            const isPos = d.balance >= 0;
            const y = isPos ? zeroY - barH : zeroY;
            // Phase 4r.fuel.12 — color by goal direction, not just sign.
            const color = balanceColor(d.balance);
            const fillOpacity = d.isToday ? 0.7 : 0.4;
            return (
              <g key={d.date}>
                <rect x={x0} y={y} width={barW} height={Math.max(2, barH)}
                      fill={color} fillOpacity={fillOpacity}
                      stroke={color} strokeWidth={d.isToday ? 0.8 : 0.5} />
                <text x={cx} y={th - 2} fontSize="7"
                      fill={d.isToday ? '#cbd5e1' : '#64748b'}
                      fontWeight={d.isToday ? 500 : 400}
                      textAnchor="middle">
                  {d.isToday ? 'today' : d.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

export default EnergyTimingChart;
