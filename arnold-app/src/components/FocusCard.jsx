// ─── FocusCard ───────────────────────────────────────────────────────────────
// Status tile with semantic color, value, contextual detail, and an optional
// action line that turns the dashboard into a coach.

import { STATUS } from "../core/semantics.js";

export function FocusCard({ label, value, unit, detail, action, severity = 'warn' }) {
  const s = STATUS[severity] || STATUS.warn;
  return (
    <div style={{
      background: s.dim,
      border: `0.5px solid ${s.border}`,
      borderLeft: `3px solid ${s.color}`,
      borderRadius: 'var(--radius-md)',
      padding: '8px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{
        fontSize: 9, color: s.color, fontWeight: 500,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 500, color: 'var(--text-primary)' }}>
        {value} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
      {detail && <div style={{ fontSize: 10, color: s.color }}>{detail}</div>}
      {action && (
        <div style={{
          fontSize: 10, color: 'var(--text-secondary)',
          borderTop: '0.5px solid var(--border-subtle)',
          paddingTop: 4, marginTop: 2,
          fontStyle: 'italic',
        }}>→ {action}</div>
      )}
    </div>
  );
}
