// ─── Cockpit Rail ────────────────────────────────────────────────────────────
// A row of compact instrument gauges, each showing the current value, a
// micro-sparkline of recent history, and the goal in the corner. Designed
// to evoke an airplane instrument cluster — every metric in one glance.

import { Sparkline } from "./Sparkline.jsx";
import { STATUS, statusFromPct } from "../core/semantics.js";

// Each gauge: { label, value, unit, history, goal, color, format, isFallback }
//
// `isFallback` (Phase 4o.trend.1): when true, the value shown is last
// week's number carried forward because the current ISO week hasn't
// accumulated samples yet. We dim the value, swap the headline label
// from "X%" to "last wk", and skip the goal-percentage colouring (the
// percentage isn't meaningful against last week's load).
//
// Phase 4m.3 — Cockpit rail dynamism (auto-promote-style attention):
// gauge positions stay fixed (muscle memory matters on a cockpit), but
// red/amber status now drives visible priority emphasis:
//   • red status   → small red dot before the label + thicker red top accent
//   • amber status → small amber dot, subtle amber top accent
//   • green/neutral → no extra emphasis
// The intent: the rail still reads as "every metric at a glance," but the
// eye is pulled to whatever's currently off-target — same idea as auto-
// promoting tiles on the Start screen, just expressed as visual weight
// rather than re-ordering.
export function CockpitRail({ gauges = [] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${gauges.length}, minmax(0,1fr))`,
      gap: 8,
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: '12px 14px',
    }}>
      {gauges.map((g, i) => {
        const pct = g.goal && g.value ? (g.invert ? g.goal / g.value : g.value / g.goal) : null;
        const status = statusFromPct(pct);
        const s = STATUS[status];
        const isNull = g.value == null || g.value === 0 || g.value === '—';
        const isFallback = !!g.isFallback;
        // Phase 4m.3 — surface critical/warn state via a priority dot + top accent.
        // Suppressed while data is null or in fallback mode (we don't want to
        // light up a "needs attention" signal on dimmed/carry-forward values).
        // statusFromPct returns 'ok' | 'warn' | 'critical' | 'neutral'.
        const showAttention = !isNull && !isFallback && (status === 'critical' || status === 'warn');
        const attentionColor = status === 'critical' ? '#f87171'
                             : status === 'warn'     ? '#fbbf24'
                                                     : null;
        // Traffic-light: sparkline color follows status when goal exists.
        // Fallback values use a muted color so the gauge clearly reads
        // as "carry-over" rather than a live current-week trend.
        const sparkColor = isFallback
          ? 'var(--text-muted)'
          : (g.goal != null && !isNull) ? s.color : (g.color || '#94a3b8');
        return (
          <div key={i}
            title={isFallback
              ? `${g.label}: last week's value — current week pending fresh data.`
              : showAttention ? `${g.label} is ${status === 'critical' ? 'off target' : 'borderline'} — see the section below for detail.` : ''}
            style={{
              position: 'relative',
              display: 'flex', flexDirection: 'column', gap: 3,
              paddingRight: i < gauges.length - 1 ? 10 : 0,
              borderRight: i < gauges.length - 1 ? '0.5px solid var(--border-subtle)' : 'none',
              opacity: isNull ? 0.45 : (isFallback ? 0.7 : 1),
            }}>
            {/* Phase 4m.3 — top accent strip (red/amber when off-target) */}
            {showAttention && (
              <div style={{
                position: 'absolute',
                top: -2, left: 0,
                right: i < gauges.length - 1 ? 10 : 0,
                height: 2, borderRadius: 1,
                background: attentionColor,
                opacity: 0.7,
                pointerEvents: 'none',
              }}/>
            )}
            <div style={{
              fontSize: 9, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                {showAttention && (
                  <span aria-hidden style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: attentionColor, flexShrink: 0,
                  }}/>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
              </span>
              {isFallback
                ? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', textTransform: 'none', letterSpacing: 0 }}>last wk</span>
                : (g.goal != null && !isNull && <span style={{ color: s.color, fontWeight: 600 }}>{Math.round((pct || 0) * 100)}%</span>)}
            </div>
            {isNull ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                Awaiting data
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{
                  fontSize: 18, fontWeight: 500,
                  color: isFallback ? 'var(--text-secondary, var(--text-muted))' : 'var(--text-primary)',
                }}>
                  {g.format ? g.format(g.value) : g.value}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.unit}</span>
              </div>
            )}
            {!isNull && <Sparkline data={g.history || []} color={sparkColor} width={80} height={16}/>}
            {g.goal != null && !isNull && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>goal {g.goal}{g.unit ? ` ${g.unit}` : ''}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
