// ContextCluster — the shared "context" role of the hero band: the 7-day and
// 30-day readiness rings + the A:C ratio chip. This framing is the SAME on
// every session (it's readiness/load context, not session-specific), so it's
// one component shared by the web Daily hero and the mobile Play hero, sized by
// surface profile. See docs/PRESENTATION_LAYER.md — the `context` role.

import { ZONE_COLORS, ZONE_LABELS, ZONE_LABELS_SHORT, ringColor } from '../core/presentation/readinessTokens.js';
import { profileFor } from '../core/presentation/storySpecs.js';

// Per-density sizing for the rings + A:C chip.
const CTX = {
  compact:     { ring: 32, stroke: 3,   ringValFs: 11, ringLblFs: 8,   gap: 8,  acRatioFs: 13, acZoneFs: 8,   acCapFs: 7.5, acPad: 6  },
  comfortable: { ring: 40, stroke: 3.5, ringValFs: 13, ringLblFs: 8.5, gap: 14, acRatioFs: 13, acZoneFs: 8.5, acCapFs: 8.5, acPad: 10 },
  expanded:    { ring: 48, stroke: 4,   ringValFs: 15, ringLblFs: 10,  gap: 16, acRatioFs: 15, acZoneFs: 10,  acCapFs: 10,  acPad: 12 },
};

function Ring({ val, label, size, stroke, valFs, lblFs }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const c = size / 2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
        <circle cx={c} cy={c} r={r} fill="none" stroke={ringColor(val)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${((val || 0) / 100) * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize={valFs} fontWeight="700" fill="var(--text-primary)">{val || '—'}</text>
      </svg>
      <span style={{ fontSize: lblFs, color: 'var(--text-muted)', lineHeight: 1, fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span>
    </div>
  );
}

export function ContextCluster({ r7, r30, acr, surface = 'play-hero' }) {
  const prof = profileFor(surface);
  const d = CTX[prof.density] || CTX.compact;
  const short = prof.labels === 'short';
  const zone = acr && acr.zone;
  const zoneLabel = short ? (ZONE_LABELS_SHORT[zone] || ZONE_LABELS[zone]) : ZONE_LABELS[zone];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: d.gap, minWidth: 0 }}>
      <Ring val={r7}  label="7d"  size={d.ring} stroke={d.stroke} valFs={d.ringValFs} lblFs={d.ringLblFs} />
      <Ring val={r30} label="30d" size={d.ring} stroke={d.stroke} valFs={d.ringValFs} lblFs={d.ringLblFs} />
      {acr && acr.ratio != null && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', paddingLeft: d.acPad, borderLeft: '0.5px solid var(--border-subtle)' }}>
          <span style={{ fontSize: d.acRatioFs, fontWeight: 600, color: ZONE_COLORS[zone], lineHeight: 1 }}>{acr.ratio}</span>
          <span style={{ fontSize: d.acZoneFs, color: ZONE_COLORS[zone], marginTop: 2, whiteSpace: 'nowrap' }}>{zoneLabel}</span>
          <span style={{ fontSize: d.acCapFs, color: 'var(--text-muted)', marginTop: 1, letterSpacing: '0.04em' }}>{short ? 'A:C' : 'A:C ratio'}</span>
        </div>
      )}
    </div>
  );
}

export default ContextCluster;
