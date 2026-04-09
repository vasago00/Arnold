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
        return (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', gap: 3,
            paddingRight: i < gauges.length - 1 ? 10 : 0,
            borderRight: i < gauges.length - 1 ? '0.5px solid var(--border-subtle)' : 'none',
          }}>
            <div style={{
              fontSize: 9, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{g.label}</span>
              {g.goal != null && <span style={{ color: s.color }}>{Math.round((pct || 0) * 100)}%</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)' }}>
                {g.format ? g.format(g.value) : (g.value != null ? g.value : '—')}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.unit}</span>
            </div>
            <Sparkline data={g.history || []} color={g.color || s.color} width={80} height={16}/>
            {g.goal != null && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>goal {g.goal}{g.unit ? ` ${g.unit}` : ''}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
