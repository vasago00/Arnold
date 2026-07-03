// ─── SeasonCoachCard — the marathon coach, on-screen ─────────────────────────
// Renders the live getSeasonCoach() read: this week's verdict + targets, the
// coach's reasoning, the next-marathon countdown, and the sub-3:40 feasibility
// call. Pure presentation — all logic lives in core/seasonPlan.js + seasonCoach.js.
import React from 'react';
import { getSeasonCoach } from '../core/seasonCoach.js';

const VERDICT = {
  increase: { label: 'Increase', color: '#60a5fa' },
  hold:     { label: 'Hold',     color: '#fbbf24' },
  cut:      { label: 'Cut back', color: '#f87171' },
  taper:    { label: 'Taper',    color: '#a78bfa' },
  recover:  { label: 'Recover',  color: '#4ade80' },
};
const FEAS = {
  'on-track':  { label: 'On track',    color: '#4ade80' },
  aggressive:  { label: 'Aggressive',  color: '#fbbf24' },
  unrealistic: { label: 'Off target',  color: '#f87171' },
};

const shortName = (n) => (n || '').split(' ')[0];

export default function SeasonCoachCard() {
  let data;
  try { data = getSeasonCoach(); } catch { return null; }
  if (!data || !data.plan) return null;
  const { plan, feasibility } = data;
  // No season set up (no marathons in the race store) → render nothing.
  if (!plan.nextMarathon && !plan.nextRace) return null;

  const v = VERDICT[plan.verdict] || { label: plan.verdict, color: '#9aa0a6' };
  const f = FEAS[feasibility && feasibility.verdict];

  const T1 = '#e6e8ec', T3 = '#9aa0a6', T4 = '#6b7280';
  const card = { background: '#141821', border: '1px solid #2a2e38', borderRadius: 14, padding: '12px 14px', marginBottom: 10, position: 'relative', overflow: 'hidden' };
  const stat = (val, unit, label, align) => (
    <div style={{ textAlign: align || 'left' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: T1, lineHeight: 1 }}>{val}<span style={{ fontSize: 11, color: T4, fontWeight: 600 }}>{unit}</span></div>
      <div style={{ fontSize: 9, color: T4, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );

  return (
    <div style={card}>
      <div style={{ position: 'absolute', top: 0, left: 14, right: 14, height: 1, background: `linear-gradient(90deg, transparent, ${v.color}40, transparent)` }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: T3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Marathon Coach</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: v.color, background: `${v.color}1a`, border: `0.5px solid ${v.color}55`, borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{plan.phase} · {v.label}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, marginBottom: 10 }}>
        {stat(plan.targetWeeklyMiles, ' mi', 'this week')}
        {stat(plan.longRunTargetMi, ' mi', 'long run')}
        {plan.nextMarathon && (
          <div style={{ marginLeft: 'auto' }}>
            {stat(plan.nextMarathon.daysToMarathon, ' d', `to ${shortName(plan.nextMarathon.name)}`, 'right')}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: T1, lineHeight: 1.45 }}>{plan.why}</div>

      {f && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: f.color, background: `${f.color}1a`, border: `0.5px solid ${f.color}55`, borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {f.label}{feasibility.limiter ? ` · ${feasibility.limiter}` : ''}
          </span>
          <span style={{ fontSize: 11, color: T3, lineHeight: 1.35 }}>{feasibility.note}</span>
        </div>
      )}
    </div>
  );
}
