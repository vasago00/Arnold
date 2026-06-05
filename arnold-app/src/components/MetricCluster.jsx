// MetricCluster — the ONE component that turns a list of metric ids + a value
// bag + a surface into laid-out tiles. It owns ALL layout decisions (direction,
// wrap, gap, font sizes, which label variant) so no caller ever sets
// flexDirection or picks a label length again. See docs/PRESENTATION_LAYER.md.
//
// Pass 0 scope: the `primary` role (session-quality tiles — the reps/tempo
// cluster). Context (rings + A:C) and the headline gauge stay as dedicated viz
// for now; they fold in during Pass 0b/1.

import { selectMetrics } from '../core/presentation/metricRegistry.js';
import { profileFor } from '../core/presentation/storySpecs.js';

// Density tiers → concrete type/spacing tokens. This is the single place that
// decides how big/tight a cluster renders per surface.
const DENSITY = {
  compact:     { v: 13, sub: 7.5, lbl: 7,  gap: 10, step: 1 },
  comfortable: { v: 13, sub: 9,   lbl: 10, gap: 14, step: 2 },
  expanded:    { v: 16, sub: 11,  lbl: 12, gap: 18, step: 3 },
};

export function MetricCluster({ ids, bag, surface = 'play-hero', align = 'start' }) {
  const prof = profileFor(surface);
  const d = DENSITY[prof.density] || DENSITY.compact;
  const tiles = selectMetrics(ids, bag);
  if (!tiles.length) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'row', flexWrap: 'wrap',
      alignItems: 'flex-start', gap: d.gap, minWidth: 0,
      justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
    }}>
      {tiles.map(t => {
        // value / unit / label stacked vertically; each tile self-sizes and
        // never clips (nowrap + flex-wrap on the row moves a tile down rather
        // than letting it spill past the card edge).
        const labelText = prof.labels === 'short' ? (t.label.short || t.label.full) : t.label.full;
        return (
          <div key={t.id} title={t.tooltip || ''} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: d.v, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.v}</span>
            {t.sub ? <span style={{ fontSize: d.sub, color: t.subColor, fontWeight: 500, whiteSpace: 'nowrap', lineHeight: 1.1, marginTop: d.step }}>{t.sub}</span> : null}
            <span style={{ fontSize: d.lbl, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', marginTop: d.step }}>{labelText}</span>
          </div>
        );
      })}
    </div>
  );
}

export default MetricCluster;
