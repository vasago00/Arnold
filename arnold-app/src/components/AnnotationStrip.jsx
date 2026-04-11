// ─── Annotation Strip ────────────────────────────────────────────────────────
// Renders a row of inline observations using the locked semantic palette.
// Pure presentational — observations are computed by core/aiAnnotations.js.

import { STATUS } from "../core/semantics.js";

// Derive a trend arrow from the observation text
function trendArrow(text, severity) {
  if (/\bup\b/i.test(text))   return { arrow: '↑', dir: 'up' };
  if (/\bdown\b/i.test(text)) return { arrow: '↓', dir: 'down' };
  if (/\bno\b.*\bsessions?\b/i.test(text)) return { arrow: '—', dir: 'flat' };
  return { arrow: '•', dir: 'flat' };
}

export function AnnotationStrip({ annotations = [], title = '✦ Observations' }) {
  if (!annotations.length) return null;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderLeft: '3px solid #a78bfa',
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      height: '100%',
      boxSizing: 'border-box',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 500, letterSpacing: '0.07em',
        color: '#a78bfa', textTransform: 'uppercase', marginBottom: 6,
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {annotations.map((a, i) => {
          const s = STATUS[a.severity] || STATUS.neutral;
          const { arrow } = trendArrow(a.text, a.severity);
          return (
            <div key={i} style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              display: 'flex', gap: 6, alignItems: 'baseline',
            }}>
              <span style={{
                color: s.color, fontStyle: 'normal', fontWeight: 600,
                fontSize: 13, lineHeight: 1, minWidth: 14, textAlign: 'center',
              }}>{arrow}</span>
              <span>{a.text}</span>
            </div>
          );
        })}
      </div>
      <div style={{
        fontSize: 9, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic',
      }}>Observations only — your call on what to do.</div>
    </div>
  );
}
