export function ArcDial({ value, max, size = 72, color = '#4ade80', label, sublabel }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max((value || 0) / (max || 1), 0), 1);
  const filled = pct * circ * 0.75;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="6"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${filled} ${circ}`}
        strokeDashoffset={-circ * 0.125}
        strokeLinecap="round"
        transform={`rotate(135 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2 - 4} textAnchor="middle" fontSize="9" fill="var(--text-muted)"
        style={{ fontFamily: 'var(--font-ui)' }}>{label}</text>
      <text x={size/2} y={size/2 + 10} textAnchor="middle" fontSize="13" fontWeight="500"
        fill="var(--text-primary)" style={{ fontFamily: 'var(--font-ui)' }}>{sublabel}</text>
    </svg>
  );
}
