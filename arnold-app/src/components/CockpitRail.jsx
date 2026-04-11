// ─── Cockpit Rail ────────────────────────────────────────────────────────────
// A row of compact instrument gauges, each showing the current value, a
// micro-sparkline of recent history, and the goal in the corner. Designed
// to evoke an airplane instrument cluster — every metric in one glance.

import { Sparkline } from "./Sparkline.jsx";
import { STATUS, statusFromPct } from "../core/semantics.js";

// Each gauge: { label, value, unit, history, goal, color, format }
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
        // Traffic-light: sparkline color follows status when goal exists
        const sparkColor = (g.goal != null && !isNull) ? s.color : (g.color || '#94a3b8');
        return (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            paddingRight: i < gauges.length - 1 ? 10 : 0,
            borderRight: i < gauges.length - 1 ? '0.5px solid var(--border-subtle)' : 'none',
            opacity: isNull ? 0.45 : 1,
          }}>
            <div style={{
              fontSize: 9, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{g.label}</span>
              {g.goal != null && !isNull && <span style={{ color: s.color, fontWeight: 600 }}>{Math.round((pct || 0) * 100)}%</span>}
            </div>
            {isNull ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                Awaiting data
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>
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
