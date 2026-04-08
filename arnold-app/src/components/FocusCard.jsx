export function FocusCard({ label, value, unit, detail, severity = 'warn' }) {
  const colors = {
    critical: { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', text: '#f87171' },
    warn: { bg: 'rgba(251,191,36,0.07)', border: 'rgba(251,191,36,0.25)', text: '#fbbf24' },
    ok: { bg: 'rgba(74,222,128,0.07)', border: 'rgba(74,222,128,0.25)', text: '#4ade80' },
  };
  const c = colors[severity] || colors.warn;
  return (
    <div style={{ background: c.bg, border: `0.5px solid ${c.border}`, borderRadius: 'var(--radius-md)', padding: '8px 12px' }}>
      <div style={{ fontSize: '9px', color: c.text, fontWeight: '500', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '17px', fontWeight: '500', color: 'var(--text-primary)' }}>
        {value} <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{unit}</span>
      </div>
      <div style={{ fontSize: '10px', color: c.text, marginTop: '2px' }}>{detail}</div>
    </div>
  );
}
