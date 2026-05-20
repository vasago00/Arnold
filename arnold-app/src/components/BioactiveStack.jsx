// ─── BioactiveStack — Phase 4r.fuel.6 ───────────────────────────────────────
// Single-line per system. Label on the left, compound chips wrapping inline
// on the right. ~5 rows total instead of 15+. Subtle row-tint per system
// matches Arnold's family colors.
//
// Compound chip is just: ● Name dose (taken — colored) or ○ Name dose (not).
// No box around each chip — text-only chips keep density high while the
// row's background tint provides the system grouping signal.

import React from 'react';

const GROUP_COLOR = {
  'neural':            '#a78bfa',
  'longevity':         '#5eead4',
  'defense':           '#fb7185',
  'performance':       '#60a5fa',
  'adaptive':          '#fbbf24',
  'other':             '#94a3b8',
};

const MECHANISM_TO_SYSTEM = {
  'nad':                'longevity',
  'senolytic':          'defense',
  'anti-inflammatory':  'defense',
  'performance':        'performance',
  'other':              'other',
};

const GROUP_LABEL = {
  'neural':       'Neural',
  'longevity':    'Longevity',
  'defense':      'Defense',
  'performance':  'Performance',
  'adaptive':     'Adaptive',
  'other':        'Other',
};

const GROUP_ORDER = ['neural', 'longevity', 'defense', 'performance', 'adaptive', 'other'];

const COMPOUND_OVERRIDE = {
  'Mg Threonate': 'neural',
  'Creatine':     'neural',
  'Fisetin':      'neural',
  'Ashwagandha':  'performance',
  'Beetroot':     'performance',
  'Shilajit':     'adaptive',
};

function formatDose(amt, unit) {
  if (!Number.isFinite(amt)) return '';
  const u = unit || 'mg';
  if (amt >= 1000) return (amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1) + 'g';
  return Math.round(amt) + u;
}

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function CompoundChip({ label, taken, doseTaken, doseTarget, unit, color }) {
  const dot = taken ? '●' : '○';
  const txt = taken ? '#e2e8f0' : '#94a3b8';
  const dose = taken ? formatDose(doseTaken, unit) : formatDose(doseTarget, unit);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'baseline',
      gap: 4,
      fontSize: 11,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      opacity: taken ? 1 : 0.6,
    }}>
      <span style={{ color, fontSize: 9 }}>{dot}</span>
      <span style={{ color: txt, fontWeight: taken ? 500 : 400 }}>{label}</span>
      <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>{dose}</span>
    </span>
  );
}

export function BioactiveStack({ items }) {
  if (!items || items.length === 0) return null;
  const enriched = items.map(it => ({
    ...it,
    system: COMPOUND_OVERRIDE[it.label] || MECHANISM_TO_SYSTEM[it.group] || 'other',
  }));
  const byGroup = {};
  for (const it of enriched) {
    const g = it.system;
    (byGroup[g] = byGroup[g] || []).push(it);
  }
  const groupsInOrder = GROUP_ORDER.filter(g => byGroup[g] && byGroup[g].length);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      {groupsInOrder.map(g => {
        const color = GROUP_COLOR[g];
        const groupItems = byGroup[g];
        const takenCount = groupItems.filter(x => x.taken).length;
        return (
          <div
            key={g}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '5px 8px',
              background: withAlpha(color, 0.04),
              borderRadius: 4,
              borderLeft: `2px solid ${withAlpha(color, 0.35)}`,
            }}
          >
            <span style={{
              fontSize: 9,
              fontWeight: 500,
              color: withAlpha(color, 0.85),
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              minWidth: 78,
              flexShrink: 0,
            }}>
              {GROUP_LABEL[g] || g}
              <span style={{ color: '#64748b', fontWeight: 400, marginLeft: 4 }}>{takenCount}/{groupItems.length}</span>
            </span>
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '4px 12px',
              flex: 1,
            }}>
              {groupItems.map(it => (
                <CompoundChip key={it.name} {...it} color={color} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BioactiveStack;
