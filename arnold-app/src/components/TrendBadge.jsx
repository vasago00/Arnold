export function TrendBadge({ delta, unit = '', inverted = false }) {
  if (delta === null || delta === undefined) return null;
  const positive = inverted ? delta < 0 : delta > 0;
  const neutral = delta === 0;
  const color = neutral ? 'var(--text-muted)' : positive ? '#4ade80' : '#f87171';
  const arrow = neutral ? '→' : delta > 0 ? '↑' : '↓';
  const abs = Math.abs(typeof delta === 'number' ? delta : 0);
  return (
    <span style={{ fontSize: '9px', color, marginLeft: '4px' }}>
      {arrow} {Number.isInteger(abs) ? abs : abs.toFixed(1)}{unit}
    </span>
  );
}
