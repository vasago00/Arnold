// SwapImpactModal — the shared "what does this swap mean?" pop-up. Renders the impact from
// weekResolve (evaluateReschedule / evaluateSubstitute) and lets the athlete Confirm or Cancel.
// Used by BOTH the calendar's drag-to-swap and the swap ladder's actions, so a proposed change
// is explained the same way everywhere. It INFORMS, it never blocks (conflict philosophy).
import { createPortal } from 'react-dom';

const TONE = {
  affirming: { dot: '#4ade80', label: 'Looks good' },
  gentle: { dot: '#fbbf24', label: 'Worth a look' },
  corrective: { dot: '#f87171', label: 'Heads up' },
  neutral: { dot: '#5eead4', label: '' },
};

export function SwapImpactModal({ impact, title = 'Swap impact', confirmLabel = 'Confirm swap', onConfirm, onCancel }) {
  if (!impact) return null;
  const tone = TONE[impact.tone] || TONE.neutral;
  const vol = impact.volume;
  const volChanged = vol && vol.delta !== 0;

  return createPortal(
    <div
      onClick={onCancel}
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{ width: '100%', maxWidth: 380, background: 'var(--bg-surface, #16181d)', border: '1px solid var(--border-subtle, #2a2d34)', borderRadius: 14, padding: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: tone.dot, flex: 'none' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e8eaed)' }}>{title}</span>
          {tone.label && <span style={{ marginLeft: 'auto', fontSize: 10, color: tone.dot, fontWeight: 600 }}>{tone.label}</span>}
        </div>

        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary, #b4b8c0)' }}>{impact.summary}</div>

        {(vol || (impact.conflicts && impact.conflicts.length)) && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {vol && (
              <Row label="Weekly volume"
                value={volChanged ? `${vol.before} → ${vol.after} mi` : `${vol.after} mi · unchanged`}
                color={volChanged ? '#fbbf24' : '#4ade80'} />
            )}
            {(impact.conflicts || []).map((c, i) => (
              <Row key={i} label="Spacing" value={c.text} color="#fbbf24" wrap />
            ))}
            {impact.losesRest && <Row label="Recovery" value="No rest day left this week" color="#f87171" wrap />}
            {impact.protectsSessions && (!impact.conflicts || !impact.conflicts.length) && !impact.losesRest && (
              <Row label="Sessions" value="All kept — nothing dropped" color="#4ade80" />
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel}
            style={{ all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, border: '1px solid var(--border-subtle, #2a2d34)', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #b4b8c0)' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, background: '#5eead4', color: '#0b0d10', fontSize: 12, fontWeight: 700 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Row({ label, value, color, wrap = false }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: wrap ? 'flex-start' : 'baseline' }}>
      <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted, #7a7f88)', width: 74, flex: 'none' }}>{label}</span>
      <span style={{ fontSize: 11.5, color, lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

export default SwapImpactModal;
