// ─── EnergyTimingChart — Phase 4r.fuel.9 ────────────────────────────────────
// 24-hour energy expenditure curve. Replaces Macros vs Goal on the right
// column of the Nutrition panel.
//
// Layout:
//   - X-axis: hours 00 → 24
//   - Y-axis: kcal/hour
//   - Bottom band: RMR + NEAT distributed evenly (your metabolic floor)
//   - Peaks: training sessions, each shaded in family color
//   - NOW marker: dashed vertical at current time
//   - Below chart: 6-stat summary — RMR, Earned, Total burn / Intake, Net, Target

import React, { useMemo } from 'react';
import { storage } from '../core/storage.js';
import { computeTDEE } from '../core/energyBalance.js';
import { isHIIT, isStrength, isRun, isMobility, isCycling, isSwim, isHardSession } from '../core/activityClass.js';
import { Flame } from '@phosphor-icons/react';

function familyColor(a) {
  if (isHIIT(a)) return '#fb7185';
  if (isStrength(a)) return '#a78bfa';
  if (isMobility(a)) return '#5eead4';
  if (isCycling(a)) return '#22d3ee';
  if (isSwim(a)) return '#22d3ee';
  if (isHardSession(a)) return '#fbbf24';
  if (isRun(a)) return '#60a5fa';
  return '#94a3b8';
}

function familyLabel(a) {
  if (isHIIT(a)) return 'HIIT';
  if (isStrength(a)) return 'Strength';
  if (isMobility(a)) return 'Mobility';
  if (isCycling(a)) return 'Cycle';
  if (isSwim(a)) return 'Swim';
  if (isHardSession(a)) return 'Tempo';
  if (isRun(a)) return 'Run';
  return 'Activity';
}

function parseHour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

export function EnergyTimingChart({ dateStr, totals }) {
  const tdee = useMemo(() => {
    try { return computeTDEE(dateStr); } catch { return null; }
  }, [dateStr]);

  const activitiesToday = useMemo(() => {
    try {
      const all = storage.get('activities') || [];
      return all.filter(a => a && a.date === dateStr);
    } catch { return []; }
  }, [dateStr]);

  const rmr = tdee?.rmr || 1685;
  const neat = tdee?.neatKcal || 200;
  const baselineKcalHr = (rmr + neat) / 24;

  const peaks = activitiesToday
    .filter(a => (a.calories || 0) > 0 && a.time && (a.durationSecs || 0) > 60)
    .map(a => {
      const durHrs = (a.durationSecs || 0) / 3600;
      const cal = a.calories || 0;
      return {
        hour: parseHour(a.time),
        durHrs,
        calories: cal,
        burnRate: cal / Math.max(durHrs, 0.01),
        color: familyColor(a),
        label: familyLabel(a),
      };
    });

  const earned = peaks.reduce((s, p) => s + p.calories, 0);
  const totalBurn = Math.round(rmr + neat + earned);
  const intake = Math.round(totals?.calories || 0);
  const net = intake - totalBurn;
  const target = totalBurn;

  const now = new Date();
  const nowHr = now.getHours() + now.getMinutes() / 60;

  // SVG dimensions
  const W = 280, H = 130;
  const xPad = 24, rPad = 8, tPad = 16, bPad = 22;
  const cw = W - xPad - rPad;
  const ch = H - tPad - bPad;
  const xForH = h => xPad + (h / 24) * cw;
  const maxKcalHr = Math.max(800, ...peaks.map(p => p.burnRate + baselineKcalHr));
  const yForK = k => tPad + ch - (k / maxKcalHr) * ch;

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontSize: 11, color: '#60a5fa', fontWeight: 500,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Flame size={13} color="#60a5fa" weight="regular" aria-hidden="true" />
          <span>Energy timing</span>
        </div>
        <div style={{ fontSize: 9, color: '#94a3b8' }}>
          <span style={{ color: '#e0b45e' }}>+{Math.round(earned)}</span> earned
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto"
           xmlns="http://www.w3.org/2000/svg" fontFamily="ui-sans-serif">

        <path d={`M ${xPad},${yForK(0)} L ${xPad},${yForK(baselineKcalHr)} L ${W-rPad},${yForK(baselineKcalHr)} L ${W-rPad},${yForK(0)} Z`}
              fill="rgba(94,234,212,0.08)" />
        <line x1={xPad} y1={yForK(baselineKcalHr)} x2={W-rPad} y2={yForK(baselineKcalHr)}
              stroke="#5eead4" strokeWidth="0.8" opacity="0.5" />

        {peaks.map((p, i) => {
          const x0 = xForH(p.hour);
          const x1 = xForH(p.hour + p.durHrs);
          const xMid = (x0 + x1) / 2;
          const yBase = yForK(baselineKcalHr);
          const yTop = yForK(baselineKcalHr + p.burnRate);
          return (
            <g key={i}>
              <path d={`M ${x0},${yBase} Q ${xMid},${yTop} ${x1},${yBase} Z`}
                    fill={`${p.color}55`} stroke={p.color} strokeWidth="1.2" />
              <text x={xMid} y={yTop - 4} textAnchor="middle"
                    fill={p.color} fontSize="8" fontWeight="500">{p.label}</text>
              <text x={xMid} y={yTop + 5} textAnchor="middle"
                    fill="#94a3b8" fontSize="7">{Math.round(p.calories)} kcal</text>
            </g>
          );
        })}

        <line x1={xForH(nowHr)} y1={tPad} x2={xForH(nowHr)} y2={yForK(0)}
              stroke="#5eead4" strokeWidth="0.5" strokeDasharray="2 2" opacity="0.7" />
        <text x={xForH(nowHr)} y={tPad - 3} textAnchor="middle"
              fill="#5eead4" fontSize="7" fontWeight="500">NOW</text>

        <line x1={xPad} y1={yForK(0)} x2={W-rPad} y2={yForK(0)}
              stroke="#475569" strokeWidth="0.5" />
        {[0, 6, 12, 18, 24].map(h => (
          <text key={h} x={xForH(h)} y={H - 8} textAnchor="middle"
                fill="#64748b" fontSize="7">
            {String(h).padStart(2, '0')}
          </text>
        ))}

        <text x={xPad + 2} y={yForK(baselineKcalHr) - 3}
              fill="#5eead4" fontSize="7" fontWeight="500">RMR</text>
      </svg>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 9, padding: '6px 4px 0',
        borderTop: '0.5px solid rgba(148,163,184,0.10)', marginTop: 4,
      }}>
        <div><span style={{ color: '#5eead4' }}>●</span>{' '}
          <span style={{ color: '#cbd5e1' }}>RMR {Math.round(rmr)}</span></div>
        <div><span style={{ color: '#a78bfa' }}>●</span>{' '}
          <span style={{ color: '#cbd5e1' }}>Earned {Math.round(earned)}</span></div>
        <div><span style={{ color: '#fb7185' }}>●</span>{' '}
          <span style={{ color: '#cbd5e1' }}>Total {totalBurn}</span></div>
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 9, padding: '4px 4px 0',
      }}>
        <div style={{ color: '#94a3b8' }}>Intake{' '}
          <span style={{ color: '#60a5fa', fontFamily: 'ui-monospace' }}>{intake}</span></div>
        <div style={{ color: '#94a3b8' }}>{net < 0 ? 'Deficit' : 'Surplus'}{' '}
          <span style={{ color: net < 0 ? '#f87171' : '#4ade80', fontFamily: 'ui-monospace' }}>
            {net >= 0 ? '+' : ''}{net}
          </span></div>
        <div style={{ color: '#94a3b8' }}>Target{' '}
          <span style={{ color: '#e2e8f0', fontFamily: 'ui-monospace' }}>{Math.round(target)}</span></div>
      </div>
    </>
  );
}

export default EnergyTimingChart;
