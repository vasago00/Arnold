import { TrendBadge } from './TrendBadge.jsx';

export function MiniBar({ label, value, displayValue, goal, goalLabel, delta, deltaUnit, pct, inverted = false }) {
  const safePct = typeof pct === 'number' && !isNaN(pct) ? pct : 0;
  const fillColor = safePct >= 0.9 ? '#4ade80' : safePct >= 0.6 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '2px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ fontSize: '11px', fontWeight: '500', color: 'var(--text-primary)' }}>
          {displayValue}
          {delta !== undefined && delta !== null && <TrendBadge delta={delta} unit={deltaUnit} inverted={inverted}/>}
        </span>
      </div>
      {(goal || goalLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{goalLabel}</span>
          <span style={{ fontSize: '9px', color: fillColor }}>{Math.round(safePct * 100)}%</span>
        </div>
      )}
      <div style={{ height: '4px', background: 'var(--bg-input)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(safePct * 100, 100)}%`, background: fillColor, borderRadius: '2px', transition: 'width 0.6s ease' }}/>
      </div>
    </div>
  );
}
