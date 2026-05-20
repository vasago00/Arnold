// ─── MicroRing — Phase 4r.fuel.2 / .3 ───────────────────────────────────────
// Status-colored micronutrient ring with food-vs-supplement split marker.
//
// Phase 4r.fuel.3 update: added dense (compact) layout that uses 2-letter
// abbreviations and fits 7 per row at ~55px each. Used for the expanded
// 21-nutrient grid on the Nutrition tab.
//
// Outer arc color = status (red <50, amber 50-80, green 80-100, teal 100+).
// Small dot on the ring at the foodPct position — shows where food alone
// got you. The arc between the dot and the end of the ring = supplement
// contribution.

import React from 'react';

function statusColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return '#475569';
  if (pct >= 100) return '#5eead4';
  if (pct >= 80)  return '#4ade80';
  if (pct >= 50)  return '#fbbf24';
  return '#f87171';
}

const R = 26;
const CIRC = 2 * Math.PI * R;

export function MicroRing({
  name,
  abbr,
  pct = 0,
  foodPct = 0,
  source = '—',
  value,
  target,
  compact = false,
}) {
  const clamped = Math.max(0, Math.min(150, Number(pct) || 0));
  const arcLen = (clamped / 100) * CIRC;
  const color = statusColor(clamped);
  const foodAngle = -90 + (Math.max(0, Math.min(100, Number(foodPct) || 0)) / 100) * 360;
  const showFoodDot = foodPct > 0 && foodPct < clamped && source === 'food + supp';
  const size = compact ? 54 : 80;
  // Compact uses 2-letter abbreviation INSIDE the ring, full name below.
  const displayLabel = compact ? (abbr || name.slice(0, 2)) : name;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: compact ? '4px 2px' : '10px 6px',
        textAlign: 'center',
      }}
      role="img"
      aria-label={`${name} at ${Math.round(clamped)} percent of target, ${source}`}
    >
      <svg width={size} height={size} viewBox="-32 -32 64 64" style={{ display: 'block' }}>
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} />
        <circle
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
          transform="rotate(-90)"
          strokeLinecap="round"
        />
        {showFoodDot && (
          <circle
            cx={R * Math.cos((foodAngle * Math.PI) / 180)}
            cy={R * Math.sin((foodAngle * Math.PI) / 180)}
            r={2.5}
            fill="#a7f3d0"
          />
        )}
        <text
          textAnchor="middle"
          y={compact ? -2 : 5}
          fill={color}
          fontSize={compact ? 11 : 14}
          fontWeight={500}
          fontFamily="ui-monospace, SFMono-Regular, monospace"
        >
          {Math.round(clamped)}
        </text>
        {compact && (
          <text
            textAnchor="middle"
            y={11}
            fill="#94a3b8"
            fontSize={9}
            fontWeight={500}
          >
            {displayLabel}
          </text>
        )}
      </svg>
      {!compact && (
        <div
          style={{
            fontSize: 10,
            color: '#e2e8f0',
            fontWeight: 500,
            marginTop: 4,
            letterSpacing: '0.01em',
          }}
        >
          {name}
        </div>
      )}
      <div
        style={{
          fontSize: compact ? 8 : 9,
          color: '#64748b',
          marginTop: compact ? 1 : 1,
          lineHeight: 1.2,
        }}
      >
        {source}
      </div>
    </div>
  );
}

// Grid wrapper. Dense mode = 7 columns of compact rings.
export function MicroRingGrid({ items, compact = false, columns }) {
  const cols = columns || (compact ? 7 : 5);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: compact ? 3 : 8,
        padding: compact ? '4px 0' : '8px 0',
      }}
    >
      {(items || []).map(item => (
        <MicroRing
          key={item.name}
          name={item.name}
          abbr={item.abbr}
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
