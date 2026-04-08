export function ArcDialSVG({ value, max, color, label, sublabel, size = 76 }) {
  const r = size / 2 - 8;
  const circ = 2 * Math.PI * r;
  const arcLength = circ * 0.75;
  const pct = Math.min(Math.max((value || 0) / (max || 1), 0), 1);
  const filled = pct * arcLength;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-input)" strokeWidth="6"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${filled} ${circ}`}
        strokeDashoffset={-arcLength * 0.167}
        strokeLinecap="round"
        transform={`rotate(135 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2 - 5} textAnchor="middle" fontSize="7.5" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-ui)' }}>{label}</text>
      <text x={size/2} y={size/2 + 7} textAnchor="middle" fontSize="13" fontWeight="500" fill="var(--text-primary)" style={{ fontFamily: 'var(--font-ui)' }}>{sublabel}</text>
      <text x={size/2} y={size/2 + 17} textAnchor="middle" fontSize="7" fill="var(--text-muted)" style={{ fontFamily: 'var(--font-ui)' }}>/ {max}</text>
    </svg>
  );
}
