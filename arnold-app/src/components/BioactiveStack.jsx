// ─── BioactiveStack — Phase 4r.fuel.8 ───────────────────────────────────────
// Each system row: [Phosphor icon · bright tinted label · N/M count]  [mini-honeycomb]
// Taken hex  = filled with system color, solid stroke
// Untaken    = transparent fill, dashed-outline stroke

import React from 'react';
import { Brain, Infinity as InfinityIcon, Shield, Lightning, Leaf } from '@phosphor-icons/react';

const GROUP_ICON = {
  'neural':       Brain,
  'longevity':    InfinityIcon,
  'defense':      Shield,
  'performance':  Lightning,
  'adaptive':     Leaf,
};

const GROUP_COLOR = {
  'neural':       '#a78bfa',
  'longevity':    '#5eead4',
  'defense':      '#fb7185',
  'performance':  '#60a5fa',
  'adaptive':     '#fbbf24',
  'other':        '#94a3b8',
};

const GROUP_LABEL_COLOR = {
  'neural':       '#c4b5fd',
  'longevity':    '#99f6e4',
  'defense':      '#fecdd3',
  'performance':  '#bfdbfe',
  'adaptive':     '#fde68a',
  'other':        '#cbd5e1',
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
  'performance':  'Perform',
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

const SHORT_CODE = {
  'NMN': 'NMN',
  'Resveratrol': 'Rv',
  'Spermidine': 'Sp',
  'TMG': 'TMG',
  'Apigenin': 'Ap',
  'Quercetin': 'Qc',
  'Fisetin': 'Fis',
  'Curcumin': 'Cur',
  'Fish Oil': 'FO',
  'Ashwagandha': 'Ash',
  'Beetroot': 'Btr',
  'Creatine': 'Cre',
  'Mg Threonate': 'MgT',
  'Shilajit': 'Shi',
};

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function MiniHive({ items, color }) {
  const HEX_W = 28;
  const HEX_H = 24;
  const N = items.length;
  const width = N * HEX_W;
  return (
    <svg viewBox={`0 0 ${width} ${HEX_H}`} width={width} height={HEX_H}
         xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}
         fontFamily="ui-sans-serif" fontWeight="500" textAnchor="middle">
      {items.map((it, i) => {
        const cx = i * HEX_W + 14;
        const cy = 12;
        const code = SHORT_CODE[it.label] || it.label.slice(0, 3);
        const filled = it.taken;
        return (
          <g key={it.name} transform={`translate(${cx},${cy})`}>
            <polygon
              points="-12,-7 -12,7 0,14 12,7 12,-7 0,-14"
              fill={filled ? withAlpha(color, 0.22) : 'transparent'}
              stroke={filled ? color : withAlpha(color, 0.40)}
              strokeWidth={1.2}
              strokeDasharray={filled ? undefined : '2 2'}
            />
            <text y="0" dominantBaseline="central" fill={filled ? color : '#94a3b8'} fontSize={8}>{code}</text>
          </g>
        );
      })}
    </svg>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }}>
      {groupsInOrder.map(g => {
        const color = GROUP_COLOR[g];
        const labelColor = GROUP_LABEL_COLOR[g];
        const groupItems = byGroup[g];
        const takenCount = groupItems.filter(x => x.taken).length;
        const IconCmp = GROUP_ICON[g];
        return (
          <div key={g} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0',
          }}>
            <div style={{
              fontSize: 10, fontWeight: 500, color: labelColor,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              minWidth: 102, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
              {IconCmp && (
                <IconCmp size={13} color={labelColor} weight="regular" aria-hidden="true" />
              )}
              <span>{GROUP_LABEL[g] || g}</span>
              <span style={{ color: '#cbd5e1', fontWeight: 400, marginLeft: 2 }}>
                {takenCount}/{groupItems.length}
              </span>
            </div>
            <MiniHive items={groupItems} color={color} />
          </div>
        );
      })}
    </div>
  );
}

expo