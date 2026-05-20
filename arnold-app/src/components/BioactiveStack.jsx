// ─── BioactiveStack — Phase 4r.fuel.4 ───────────────────────────────────────
// Bioactive longevity stack rendered as compact rings, matching the micros
// visual language. No RDAs → no continuous % — rings are binary:
//   • taken today  → full teal ring + short label inside
//   • not taken    → muted outline ring + short label
// Grouped into NAD+ / Senolytics / Anti-inflammatory / Performance / Other.

import React from 'react';

const R = 26;
const CIRC = 2 * Math.PI * R;

const GROUP_LABELS = {
  'nad':                'NAD+ pathway',
  'senolytic':          'Senolytics',
  'anti-inflammatory':  'Anti-inflammatory',
  'performance':        'Performance',
  'other':              'Other',
};

function GroupHeader({ label }) {
  return (
    <div style={{
      gridColumn: '1 / -1',
      fontSize: 9, color: '#64748b', fontWeight: 500,
      letterSpacing: '0.10em', textTransform: 'uppercase',
      padding: '6px 0 2px',
      borderTop: '0.5px solid rgba(148,163,184,0.10)',
      marginTop: 4,
    }}>
      {label}
    </div>
  );
}

// Short 2-3 character codes for inside the ring
const SHORT_CODE = {
  'NMN': 'NMN',
  'Resveratrol': 'Rv',
  'Spermidine': 'Sp',
  'TMG': 'TMG',
  'Apigenin': 'Ap',
  'Quercetin': 'Qc',
  'Fisetin': 'Fi',
  'Curcumin': 'Cu',
  'Fish Oil': 'FO',
  'Ashwagandha': 'Ash',
  'Beetroot': 'Bt',
  'Creatine': 'Cr',
  'Mg Threonate': 'Mg-T',
  'Shilajit': 'Sh',
};

function formatDose(amt, unit) {
  if (!Number.isFinite(amt)) return '';
  const u = unit || 'mg';
  if (amt >= 1000) return (amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1) + 'g';
  return Math.round(amt) + (u || 'mg');
}

function BioactiveRing({ label, taken, doseTaken, doseTarget, unit }) {
  const color  = taken ? '#5eead4' : '#475569';
  const arcLen = taken ? CIRC : 0;
  const code = SHORT_CODE[label] || label.slice(0, 3);
  const doseText = taken
    ? formatDose(doseTaken, unit)
    : formatDose(doseTarget, unit);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '4px 2px', textAlign: 'center',
      opacity: taken ? 1 : 0.7,
    }} role="img" aria-label={`${label} ${taken ? 'taken' : 'not taken'} ${doseText}`}>
      <svg width={54} height={54} viewBox="-32 -32 64 64" style={{ display: 'block' }}>
        {/* Background track */}
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3.5} />
        {/* Fill ring when taken */}
        {taken && (
          <circle r={R} fill="none" stroke={color} strokeWidth={3.5}
                  strokeDasharray={`${arcLen} 0`}
                  transform="rotate(-90)" strokeLinecap="round" />
        )}
        {/* Code + check dot for taken state */}
        <text textAnchor="middle" y={-2}
              fill={taken ? color : '#94a3b8'} fontSize={10} fontWeight={500}
              fontFamily="ui-sans-serif">{code}</text>
        <text textAnchor="middle" y={10}
              fill="#94a3b8" fontSize={9} fontWeight={500}>{label.length > 12 ? code : label.slice(0, 12)}</text>
      </svg>
      <div style={{ fontSize: 8, color: '#64748b', marginTop: 1, lineHeight: 1.2,
                    fontFamily: 'ui-monospace, monospace' }}>
        {doseText || (taken ? 'taken' : '—')}
      </div>
    </div>
  );
}

export function BioactiveStack({ items }) {
  if (!items || items.length === 0) return null;
  // Detect grouping (Phase 4r.fuel.4)
  const useGrouping = items.some(it => it && it.group);
  if (!useGrouping) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 3, padding: '4px 0',
      }}>
        {items.map(it => (
          <BioactiveRing key={it.name} {...it} />
        ))}
      </div>
    );
  }
  const byGroup = {};
  for (const it of items) {
    const g = it.group || 'other';
    (byGroup[g] = byGroup[g] || []).push(it);
  }
  const ORDER = ['nad', 'senolytic', 'anti-inflammatory', 'performance', 'other'];
  const groupsInOrder = ORDER.filter(g => byGroup[g] && byGroup[g].length);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
      gap: 3, padding: '4px 0',
    }}>
      {groupsInOrder.map(g => (
        <React.Fragment key={g}>
          <GroupHeader label={GROUP_LABELS[g] || g} />
          {byGroup[g].map(it => (
            <BioactiveRing key={it.name} {...it} />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export default BioactiveStack;
