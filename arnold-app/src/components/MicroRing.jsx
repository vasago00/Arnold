// ─── MicroRing — Phase 4r.fuel.2 ────────────────────────────────────────────
// Status-colored micronutrient ring with food-vs-supplement split marker.
//
// Replaces the linear progress bars in the Nutrition tab Micronutrients panel.
// Key visual moves:
//   - Outer arc color = status (red <50, amber 50-80, green 80-100, teal 100+)
//   - Small dot on the ring at the foodPct position — shows where food alone
//     got you. The arc between the dot and the end of the ring = supplement
//     contribution.
//   - % value rendered inside in the status color.
//   - Full nutrient name below (not abbreviation — slower but no decoding).
//   - Source caption underneath ("food + supp", "food only", "supp only", "—").
//
// Props:
//   name      — string, e.g. "Magnesium"
//   pct       — number, total % of target (food + supp combined)
//   foodPct   — number, % from food alone (optional, defaults to 0)
//   source    — string: 'food' | 'food + supp' | 'supp' | '—'
//   value     — number, raw amount (optional, for tooltip)
//   target    — number, daily target (optional)
//   compact   — boolean, smaller cell (mobile) vs full (desktop)

import React from 'react';

// Status thresholds — match Arnold's Phase 4r.intel.6 status engine.
function statusColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return '#475569'; // muted
  if (pct >= 100) return '#5eead4'; // teal — above target
  if (pct >= 80)  return '#4ade80'; // green — good
  if (pct >= 50)  return '#fbbf24'; // amber — partial
  return '#f87171';                  // red — deficient
}

// Ring geometry. r = stroke radius. Circumference = 2*pi*r.
const R = 26;
const CIRC = 2 * Math.PI * R;

export function MicroRing({
  name,
  pct = 0,
  foodPct = 0,
  source = '—',
  value,
  target,
  compact = false,
}) {
  const clamped = Math.max(0, Math.min(150, Number(pct) || 0));
  const arcLen = (clamped / 100) * CIRC; // % of full ring
  const color = statusColor(clamped);
  const foodAngle = -90 + (Math.max(0, Math.min(100, Number(foodPct) || 0)) / 100) * 360;
  const showFoodDot = foodPct > 0 && foodPct < clamped && source === 'food + supp';
  const size = compact ? 64 : 80;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: compact ? '6px 4px' : '10px 6px',
        textAlign: 'center',
      }}
      role="img"
      aria-label={`${name} at ${Math.round(clamped)} percent of target, ${source}`}
    >
      <svg width={size} height={size} viewBox="-32 -32 64 64" style={{ display: 'block' }}>
        {/* Background track */}
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} />
        {/* Status arc, starts from 12 o'clock */}
        <circle
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
          transform="rotate(-90)"
          strokeLinecap="round"
        />
        {/* Food-contribution boundary dot */}
        {showFoodDot && (
          <circle
            cx={R * Math.cos((foodAngle * Math.PI) / 180)}
            cy={R * Math.sin((foodAngle * Math.PI) / 180)}
            r={2.5}
            fill="#a7f3d0"
          />
        )}
        {/* Centered % value */}
        <text
          textAnchor="middle"
          y={5}
          fill={color}
          fontSize={compact ? 12 : 14}
          fontWeight={500}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {Math.round(clamped)}
        </text>
      </svg>
      <div
        style={{
          fontSize: compact ? 9 : 10,
          color: '#e2e8f0',
          fontWeight: 500,
          marginTop: 4,
          letterSpacing: '0.01em',
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontSize: compact ? 8 : 9,
          color: '#64748b',
          marginTop: 1,
        }}
      >
        {source}
      </div>
    </div>
  );
}

// Grid wrapper — drop into the Nutrition tab Micronutrients section.
// Renders the array returned by getMicronutrientSummary(dateStr).
export function MicroRingGrid({ items, compact = false, columns }) {
  const cols = columns || (compact ? 4 : 5);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: compact ? 4 : 8,
        padding: compact ? '4px 0' : '8px 0',
      }}
    >
      {(items || []).map(item => (
        <MicroRing
          key={item.name}
          name={item.name}
          pct={item.pct}
          foodPct={item.foodPct}
          source={item.source}
          value={item.value}
          target={item.target}
          compact={compact}
        />
      ))}
    </div>
  );
}

export default MicroRing;
