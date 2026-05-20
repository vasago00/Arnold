// ─── BioactiveStack — Phase 4r.fuel.3 ───────────────────────────────────────
// Longevity & sports bioactive stack panel. These compounds (NMN, Quercetin,
// Resveratrol, TMG, Apigenin, Spermidine, Fisetin, Mg Threonate, Ashwagandha,
// Curcumin, Beetroot, Shilajit, Creatine, Fish Oil) don't have RDAs — so a
// "% of target" ring is meaningless. We surface them as taken / not-taken
// pills with dose, so the answer to "did I take my stack today" is one glance.
//
// Layout: horizontal flex with wrap, one pill per bioactive. Taken pills
// glow teal; not-taken pills are muted with an outline dot.

import React from 'react';

export function BioactiveStack({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '6px 0 2px',
      }}
      role="list"
      aria-label="Bioactive stack — taken today"
    >
      {items.map(item => (
        <BioactivePill
          key={item.name}
          label={item.label}
          taken={item.taken}
          doseTaken={item.doseTaken}
          doseTarget={item.doseTarget}
          unit={item.unit}
        />
      ))}
    </div>
  );
}

function BioactivePill({ label, taken, doseTaken, doseTarget, unit }) {
  const color = taken ? '#5eead4' : '#475569';
  const bg = taken ? 'rgba(94,234,212,0.08)' : 'transparent';
  const borderColor = taken ? 'rgba(94,234,212,0.30)' : 'rgba(148,163,184,0.18)';
  const dotChar = taken ? '●' : '○'; // ● or ○
  const doseLabel = taken
    ? `${formatDose(doseTaken)}${unit ? ' ' + unit : ''}`
    : `${formatDose(doseTarget)}${unit ? ' ' + unit : ''}`;
  return (
    <div
      role="listitem"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 9px',
        borderRadius: 12,
        background: bg,
        border: `0.5px solid ${borderColor}`,
        fontSize: 11,
        color: taken ? '#e2e8f0' : '#94a3b8',
        fontWeight: 500,
        lineHeight: 1,
        opacity: taken ? 1 : 0.7,
      }}
    >
      <span style={{ color, fontSize: 9, lineHeight: 1 }}>{dotChar}</span>
      <span>{label}</span>
      <span style={{ color: '#64748b', fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
        {doseLabel}
      </span>
    </div>
  );
}

function formatDose(amt) {
  if (!Number.isFinite(amt)) return '—';
  if (amt >= 1000) return (amt / 1000).toFixed(amt % 1000 === 0 ? 0 : 1) + 'g';
  return Math.round(amt).toString();
}

export default BioactiveStack;
