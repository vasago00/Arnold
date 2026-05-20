// ─── BioactiveStack — Phase 4r.fuel.5 ───────────────────────────────────────
// Compact multi-column list of bioactive compounds. Each item is one row:
//   ● Compound name · dose      (taken — bright)
//   ○ Compound name · dose      (not taken — muted)
//
// Grouped by which Arnold health system the compound feeds. Each group
// renders as its own block with a subtle background tint matching the
// system family color. No headers — the wash + an ultra-small tag at the
// top-left of each block IS the header.
//
// Layout: 2 columns on desktop (>=480px container), wraps to 1 on mobile.

import React from 'react';

// Group color: matches the corresponding Arnold system family color.
const GROUP_COLOR = {
  'neural':            '#a78bfa', // brain / purple
  'longevity':         '#5eead4', // mitochondria / teal
  'defense':           '#fb7185', // immune+anti-inflammatory / coral
  'performance':       '#60a5fa', // cardiovascular / blue
  'adaptive':          '#fbbf24', // hormonal+energy / amber
  'other':             '#94a3b8',
};

// Map the compound-mechanism group used by getBioactiveStack (nad,
// senolytic, anti-inflammatory, performance, other) → the system-facing
// label & color used here. Senolytics are pre-aging defense; NAD+ is
// the longevity pillar; anti-inflammatory becomes defense.
const MECHANISM_TO_SYSTEM = {
  'nad':                'longevity',
  'senolytic':          'defense',
  'anti-inflammatory':  'defense',
  'performance':        'performance',
  'other':              'other',
};

const GROUP_LABEL = {
  'neural':       'Neural · brain',
  'longevity':    'Longevity · mitochondria',
  'defense':      'Defense · immune + anti-inflammatory',
  'performance':  'Performance · cardiovascular',
  'adaptive':     'Adaptive · hormonal',
  'other':        'Other',
};

const GROUP_ORDER = ['neural', 'longevity', 'defense', 'performance', 'adaptive', 'other'];

// Per-compound override — for compounds that primarily serve a different
// system than their mechanism class would suggest. Mg Threonate and
// Creatine are brain-serving; Ashwagandha and Beetroot serve performance/cardio.
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

function BioactiveRow({ label, taken, doseTaken, doseTarget, unit, color }) {
  const dot = taken ? '●' : '○';
  const text = taken ? color : '#94a3b8';
  const dose = taken ? formatDose(doseTaken, unit) : formatDose(doseTarget, unit);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '3px 6px',
      fontSize: 11, lineHeight: 1.2,
      opacity: taken ? 1 : 0.55,
    }}>
      <span style={{ color, fontSize: 10, lineHeight: 1, width: 10, flexShrink: 0 }}>{dot}</span>
      <span style={{ color: text, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}>{dose}</span>
    </div>
  );
}

export function BioactiveStack({ items }) {
  if (!items || items.length === 0) return null;
  // Map each item to a system group (override > mechanism-mapping > 'other').
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      {groupsInOrder.map(g => {
        const color = GROUP_COLOR[g];
        return (
          <div
            key={g}
            style={{
              background: withAlpha(color, 0.05),
              borderRadius: 6,
              padding: '6px 8px',
              borderLeft: `2px solid ${withAlpha(color, 0.40)}`,
            }}
          >
            <div style={{
              fontSize: 9, color: withAlpha(color, 0.85), fontWeight: 500,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              marginBottom: 3,
            }}>{GROUP_LABEL[g] || g}</div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              columnGap: 4,
              rowGap: 0,
            }}>
              {byGroup[g].map(it => (
                <BioactiveRow key={it.name} {...it} color={color} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BioactiveStack;
