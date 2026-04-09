// ─── Sparkline ───────────────────────────────────────────────────────────────
// Tiny inline trend chart. Drop next to any number where you'd otherwise
// just see a value in isolation. Pass an array of numbers (oldest → newest)
// and it draws the trajectory with a subtle current-value dot.

export function Sparkline({
  data = [],
  width = 60,
  height = 18,
  color = '#60a5fa',
  fill = true,
  dot = true,
}) {
  const pts = data.filter(v => v != null && !isNaN(v));
  if (pts.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1="2" y1={height/2} x2={width-2} y2={height/2}
              stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="2 2" opacity="0.4"/>
      </svg>
    );
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || 1;
  const stepX = (width - 4) / (pts.length - 1);
  const points = pts.map((v, i) => {
    const x = 2 + i * stepX;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y];
  });
  const polyStr = points.map(([x, y]) => `${x},${y}`).join(' ');
  const fillPath = fill
    ? `M ${points[0][0]},${height-1} L ${points.map(([x,y]) => `${x},${y}`).join(' L ')} L ${points[points.length-1][0]},${height-1} Z`
    : null;
  const last = points[points.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fillPath && <path d={fillPath} fill={color} opacity="0.15"/>}
      <polyline fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" points={polyStr}/>
      {dot && <circle cx={last[0]} cy={last[1]} r="1.6" fill={color}/>}
    </svg>
  );
}
