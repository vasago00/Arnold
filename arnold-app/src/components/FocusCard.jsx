// ─── FocusCard ───────────────────────────────────────────────────────────────
// Status tile with semantic color, value, contextual detail, and an optional
// action line that turns the dashboard into a coach.

import { STATUS } from "../core/semantics.js";

// corrective = true for tiles that suggest a fix (Volume Gap, Pace Drift, etc.)
// These get a subtle glow to separate them from informational tiles.
// completed = true shows a green check badge in the top-right corner.
export function FocusCard({ label, value, unit, detail, action, severity = 'warn', corrective = false, completed = false }) {
  const s = STATUS[severity] || STATUS.warn;
  const isAction = corrective || (action && severity !== 'ok' && severity !== 'neutral');
  return (
    <div style={{
      background: completed ? STATUS.ok.dim : s.dim,
      border: `0.5px solid ${completed ? STATUS.ok.border : s.border}`,
      borderLeft: `3px solid ${completed ? STATUS.ok.color : s.color}`,
      borderRadius: 'var(--radius-md)',
      padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
      position: 'relative',
      // Corrective tiles get a subtle glow to draw attention
      ...(isAction && !completed ? {
        boxShadow: `0 0 8px ${s.border}, inset 0 0 12px ${s.dim}`,
        borderWidth: '1px',
      } : {}),
    }}>
      {/* Completion checkmark badge — subtle */}
      {completed && (
        <div style={{
          position: 'absolute', top: 7, right: 9,
          fontSize: 12, fontWeight: 600, color: STATUS.ok.color,
          opacity: 0.7,
        }}>✓</div>
      )}
      <div style={{
        fontSize: 9, color: completed ? STATUS.ok.color : s.color, fontWeight: 500,
        letterSpacing: '0.06em', textTransform: 'uppercase',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        paddingRight: completed ? 24 : 0,
      }}>
        <span>{label}</span>
        {isAction && !completed && <span style={{ fontSize: 8, opacity: 0.7 }}>⚡ ACTION</span>}
      </div>
      <div style={{ fontSize: 17, fontWeight: 500, color: completed ? STATUS.ok.color : 'var(--text-primary)' }}>
        {value} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
      {detail && <div style={{ fontSize: 10, color: completed ? STATUS.ok.color : s.color }}>{detail}</div>}
      {action && (
        <div style={{
          fontSize: 10, color: completed ? STATUS.ok.color : (isAction ? s.color : 'var(--text-secondary)'),
          borderTop: `0.5px solid ${completed ? STATUS.ok.border : (isAction ? s.border : 'var(--border-subtle)')}`,
          paddingTop: 4, marginTop: 2,
          fontStyle: 'italic',
          fontWeight: completed ? 600 : (isAction ? 500 : 400),
        }}>→ {action}</div>
      )}
    </div>
  );
}
