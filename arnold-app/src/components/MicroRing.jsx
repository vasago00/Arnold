// ─── MicroRing — Phase 4r.fuel.5 ────────────────────────────────────────────
// Status-colored micronutrient ring with food-vs-supplement split marker.
// Phase 4r.fuel.5: grouping is now a subtle BACKGROUND TINT band per group
// row — no header text, no extra vertical space. The eye picks up the
// group identity via the wash color (vitamins=blue, minerals=amber, fats=teal)
// without anything labeled.

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

// Background tint per group — barely-perceptible wash applied behind each
// row of rings. Keeps total height the same as flat grid.
const GROUP_BG = {
  vitamins: 'rgba(96,165,250,0.05)',  // blue
  minerals: 'rgba(251,191,36,0.05)',  // amber
  fats:     'rgba(94,234,212,0.05)',  // teal
  other:    'transparent',
};

export function MicroRing({ name, abbr, pct = 0, foodPct = 0, source = '—', value, target, compact = false }) {
  const clamped = Math.max(0, Math.min(150, Number(pct) || 0));
  const arcLen = (clamped / 100) * CIRC;
  const color = statusColor(clamped);
  const foodAngle = -90 + (Math.max(0, Math.min(100, Number(foodPct) || 0)) / 100) * 360;
  const showFoodDot = foodPct > 0 && foodPct < clamped && source === 'food + supp';
  const size = compact ? 54 : 80;
  const displayLabel = compact ? (abbr || name.slice(0, 2)) : name;
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: compact ? '4px 2px' : '10px 6px', textAlign: 'center',
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
      <div style={{ fontSize: compact ? 8 : 9, color: '#64748b', marginTop: 1, lineHeight: 1.2 }}>
        {source}
      </div>
    </div>
  );
}

// Phase 4r.fuel.5 — Grid wrapper renders rows of items grouped by `group`
// field. Each group gets a subtle background tint band (no header text).
// If grouped:false or no group field present, falls back to flat grid.
export function MicroRingGrid({ items, compact = false, columns, grouped = true }) {
  const cols = columns || (compact ? 7 : 5);
  const list = items || [];
  const useGrouping = grouped && list.some(it => it && it.group);
  if (!useGrouping) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: compact ? 3 : 8,
        padding: compact ? '4px 0' : '8px 0',
      }}>
        {list.map(item => (
          <MicroRing key={item.name} {...item} compact={compact} />
        ))}
      </div>
    );
  }
  // Group items and render each group as its own grid row band with tinted bg.
  const byGroup = {};
  for (const it of list) {
    const g = it.group || 'other';
    (byGroup[g] = byGroup[g] || []).push(it);
  }
  const ORDER = ['vitamins', 'minerals', 'fats', 'other'];
  const groupsInOrder = ORDER.filter(g => byGroup[g] && byGroup[g].length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      {groupsInOrder.map(g => (
        <div
          key={g}
          style={{
            background: GROUP_BG[g] || 'transparent',
            borderRadius: 6,
            padding: compact ? '4px 4px' : '8px 8px',
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: compact ? 3 : 8,
          }}
          aria-label={g}
        >
          {byGroup[g].map(item => (
            <MicroRing key={item.name} {...item} compact={compact} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default MicroRing;
