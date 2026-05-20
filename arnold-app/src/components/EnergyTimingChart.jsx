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

export function EnergyTimingChart({ dateStr, totals }) {
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
  const target = burn.total;
  const net = intake - target;       // negative = deficit, positive = surplus
  const isDeficit = net < 0;

  // 7-day balance trend — compute one day at a time.
  const trend = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const ds = shiftDate(dateStr, -i);
      if (!ds) continue;
      let dayTotal = 0, dayIntake = 0;
      try { dayTotal = (computeTDEE(ds) || {}).tdee || 0; } catch {}
      try { dayIntake = nutDailyTotals(ds)?.calories || 0; } catch {}
      days.push({
        date: ds,
        label: dayLabel(ds),
        balance: dayIntake - dayTotal,
        isToday: i === 0,
      });
    }
    return days;
  }, [dateStr]);

  const trendAvg = trend.length
    ? Math.round(trend.reduce((s, d) => s + d.balance, 0) / trend.length)
    : 0;
  const maxAbs = Math.max(500, ...trend.map(d => Math.abs(d.balance)));

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
        borderRadius: 6, padding: '10px 12px',
        borderLeft: `2px solid ${isDeficit ? '#f87171' : '#4ade80'}`,
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{
            fontSize: 9, color: isDeficit ? '#fecaca' : '#bbf7d0',
            letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 500,
          }}>
            {isDeficit ? 'Deficit' : 'Surplus'}
          </div>
          <div style={{
            fontSize: 22, color: isDeficit ? '#f87171' : '#4ade80',
            fontWeight: 500, fontFamily: 'ui-monospace, monospace',
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
            <span style={{ color: trendAvg < 0 ? '#f87171' : '#4ade80' }}>
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
            const color = isPos ? '#4ade80' : '#f87171';
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
