// ─── MicroRing — Phase 4r.fuel.14 ────────────────────────────────────────────
// Continuous grid with per-cell group tint (no banded blocks, no gaps).
// Group identity flows naturally across rows. Tighter cell padding.

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

// Background tint per group — applied to each individual cell.
const CELL_BG = {
  vitamins: 'rgba(96,165,250,0.05)',
  minerals: 'rgba(251,191,36,0.05)',
  fats:     'rgba(94,234,212,0.05)',
  other:    'transparent',
};

export function MicroRing({ name, abbr, pct = 0, foodPct = 0, source = '—', value, target, compact = false, group }) {
  const clamped = Math.max(0, Math.min(150, Number(pct) || 0));
  const arcLen = (clamped / 100) * CIRC;
  const color = statusColor(clamped);
  const foodAngle = -90 + (Math.max(0, Math.min(100, Number(foodPct) || 0)) / 100) * 360;
  const showFoodDot = foodPct > 0 && foodPct < clamped && source === 'food + supp';
  const size = compact ? 50 : 80;
  const displayLabel = compact ? (abbr || name.slice(0, 2)) : name;
  const bg = CELL_BG[group] || 'transparent';

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: compact ? '3px 2px 4px' : '10px 6px',
        textAlign: 'center',
        background: bg,
        borderRadius: 4,
      }}
      role="img"
      aria-label={`${name} at ${Math.round(clamped)} percent of target, ${source}`}
    >
      <svg width={size} height={size} viewBox="-32 -32 64 64" style={{ display: 'block' }}>
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} />
        <circle
          r={R} fill="none" stroke={color} strokeWidth={3.5}
          strokeDasharray={`${arcLen} ${CIRC - arcLen}`}
          transform="rotate(-90)" strokeLinecap="round"
        />
        {showFoodDot && (
          <circle
            cx={R * Math.cos((foodAngle * Math.PI) / 180)}
            cy={R * Math.sin((foodAngle * Math.PI) / 180)}
            r={2.5} fill="#a7f3d0"
          />
        )}
        <text textAnchor="middle" y={compact ? -2 : 5}
              fill={color} fontSize={compact ? 11 : 14} fontWeight={500}
              fontFamily="ui-monospace, SFMono-Regular, monospace">
          {Math.round(clamped)}
        </text>
        {compact && (
          <text textAnchor="middle" y={11} fill="#94a3b8" fontSize={9} fontWeight={500}>
            {displayLabel}
          </text>
        )}
      </svg>
      {!compact && (
        <div style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 500, marginTop: 4 }}>{name}</div>
      )}
      <div style={{
        fontSize: compact ? 9 : 9,
        color: '#94a3b8',
        marginTop: 1, lineHeight: 1.1,
      }}>
        {source}
      </div>
    </div>
  );
}

// Phase 4r.fuel.14 — single continuous grid, no per-band wrappers. Each cell
// carries its own group tint via the item.group field. On mobile (compact)
// we use 4 cols so cells are bigger and labels readable; on desktop 7.
export function MicroRingGrid({ items, compact = false, columns }) {
  const cols = columns || (compact ? 4 : 7);
  const list = items || [];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: 4,
      padding: '4px 0',
    }}>
      {list.map(item => (
        <MicroRing key={item.name} {...item} compact={compact} />
      ))}
    </div>
  );
}

export default MicroRing;
