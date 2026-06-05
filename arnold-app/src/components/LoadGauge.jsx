// LoadGauge — the shared "headline" speedometer for the hero band (the rTSS /
// Load / Tonnage dial). One self-contained component replaces the two inline
// SVG copies that used to live in the web Daily hero and the mobile Play hero.
// See docs/PRESENTATION_LAYER.md — this is the `headline` role.
//
// Fully self-contained: give it the gauge MODEL (value, max, zone breaks, zone
// names, label, unit) and a surface, and it computes its own geometry. The
// caller owns positioning (grid order, hover tooltip) by wrapping it.
//
// Note: this unifies a latent mobile bug — the old mobile gauge hardcoded the
// label "rTSS" even on Tonnage days; it now shows the real `label` (+ unit),
// matching the web hero.

// Zone arc palette (easy → over). Fixed; matches the previous hero palette.
const ZONE_COLORS = ['#4ade80', '#60a5fa', '#fbbf24', '#f87171'];

// Per-surface sizing. Platform = a profile, not a code fork.
const SIZE = {
  'play-hero':  { width: 100, height: 58, maxWidth: null, labelFs: 11, valBig: 18, valSmall: 15, valDy: 14, zoneFs: 9  },
  'daily-hero': { width: null, height: null, maxWidth: 130, labelFs: 11, valBig: 22, valSmall: 16, valDy: 16, zoneFs: 10 },
};

export function LoadGauge({
  value = 0,
  max = 200,
  breaks = [50, 100, 150],
  zoneNames = ['EASY', 'MODERATE', 'HARD', 'OVERREACHING'],
  label = 'rTSS',
  unit = '',
  surface = 'play-hero',
}) {
  const cx = 100, cy = 100, R = 80;
  const angleFor = v => 180 + (Math.min(Math.max(v, 0), max) / max) * 180;
  const polar = (deg, radius = R) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };
  const arcPath = (v0, v1, radius = R) => {
    const a0 = angleFor(v0), a1 = angleFor(v1);
    const p0 = polar(a0, radius), p1 = polar(a1, radius);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${large} 1 ${p1.x} ${p1.y}`;
  };

  const [b1, b2, b3] = breaks;
  const zoneIdx =
    value >= b3 ? 3 :
    value >= b2 ? 2 :
    value >= b1 ? 1 :
    value >  0  ? 0 : -1;
  const needleColor = zoneIdx >= 0 ? ZONE_COLORS[zoneIdx] : 'var(--text-muted)';
  const needleEnd = polar(angleFor(value), R - 6);
  const zoneLabel = zoneIdx >= 0 ? zoneNames[zoneIdx] : 'REST';
  const display = value ? (max >= 10000 ? value.toLocaleString() : Math.round(value)) : '—';

  const sz = SIZE[surface] || SIZE['play-hero'];
  const valFs = max >= 10000 ? sz.valSmall : sz.valBig;
  const labelText = `${label}${unit ? ` · ${unit}` : ''}`;
  const svgProps = sz.maxWidth
    ? { width: '100%', style: { maxWidth: sz.maxWidth } }
    : { width: sz.width, height: sz.height, style: { flexShrink: 0 } };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet" {...svgProps}>
        {/* zone arcs — opacity dims the inactive zones */}
        <path d={arcPath(0,  b1)}  stroke={ZONE_COLORS[0]} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx > 0 ? 0.35 : zoneIdx === 0 ? 1 : 0.35} />
        <path d={arcPath(b1, b2)}  stroke={ZONE_COLORS[1]} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx > 1 ? 0.35 : zoneIdx === 1 ? 1 : 0.35} />
        <path d={arcPath(b2, b3)}  stroke={ZONE_COLORS[2]} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx > 2 ? 0.35 : zoneIdx === 2 ? 1 : 0.35} />
        <path d={arcPath(b3, max)} stroke={ZONE_COLORS[3]} strokeWidth="10" fill="none" strokeLinecap="butt" opacity={zoneIdx === 3 ? 1 : 0.35} />
        {/* tick marks at zone boundaries */}
        {[0, b1, b2, b3, max].map(v => {
          const inner = polar(angleFor(v), R - 13);
          const outer = polar(angleFor(v), R - 3);
          return <line key={v} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="var(--border-subtle)" strokeWidth="0.6" />;
        })}
        {/* needle */}
        <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={needleColor} />
        {/* metric label above the value (clear of the needle base at cy) */}
        <text x={cx} y={cy - 40} textAnchor="middle" fontSize={sz.labelFs} fontWeight="600" letterSpacing="0.12em" fill="var(--text-secondary)" style={{ fontFamily: 'var(--font-ui)' }}>{labelText}</text>
        <text x={cx} y={cy - sz.valDy} textAnchor="middle" fontSize={valFs} fontWeight="700" fill="var(--text-primary)" style={{ fontFamily: 'var(--font-ui)' }}>{display}</text>
      </svg>
      <div style={{ fontSize: sz.zoneFs, fontWeight: 700, letterSpacing: '0.1em', color: needleColor, marginTop: -4 }}>{zoneLabel}</div>
    </div>
  );
}

export default LoadGauge;
