// ─── KRITile — KRI display for the Trend tab spaceship view (Phase 4m.2) ──
// Renders one Key Result Indicator with three timeframe values stacked:
//
//   ┌─────────────────────────────────┐
//   │ Avg HR (Run)            ★       │  ← label + pin-to-Start star
//   ├─────────────────────────────────┤
//   │  142  ↘     145 →               │  ← week (big) | 8-wk trailing
//   │  bpm                            │
//   │              YTD avg 144  ↘     │  ← YTD bottom row
//   └─────────────────────────────────┘
//
// Tap the tile to toggle "on Start cockpit" for its category. Star fills
// when the metric is currently in the user's startTilePrefs for that
// category (and we mirror the picker's min-2 / max-4 constraints — UI only;
// the picker does final validation when saving).
//
// Props:
//   metric  — entry from TILE_METRICS (must have id, label, category, unit)
//   tf      — { week, eightWk, ytd, weekDelta, eightWkDelta, ytdDelta, ytdMode }
//             from metric.timeframes(ctx). Pass null/undefined for "no data".
//   pinned  — boolean, true if metric is in user's startTilePrefs for category
//   onTogglePin — () => void, called when tile is tapped
//   formatValue — optional override (val, unit) => string. Default uses
//                 formatKRIValue from kriAggregate.js.

import { formatKRIValue } from '../core/derive/kriAggregate.js';
import { STATUS_COLORS } from '../core/derive/tileMetrics.js';

// Status palette — matches the rest of the app's standard. Green is treated
// as "default" (no extra color) so the eye isn't drawn to tiles that are
// fine. Amber and red stand out — that's the focus discipline. Neutral (no
// thresholds, or no data) also stays default.
const STATUS_VALUE_COLOR = {
  green:   'var(--text-primary)',     // = default; green tiles look normal
  amber:   STATUS_COLORS.amber,       // attention
  red:     STATUS_COLORS.red,         // concern
  neutral: 'var(--text-primary)',     // default
};
// Subtle dot beside the label — signals status without painting the value.
// Green gets its color (low-saturation, not distracting), amber/red full.
const STATUS_DOT_COLOR = {
  green:   STATUS_COLORS.green,
  amber:   STATUS_COLORS.amber,
  red:     STATUS_COLORS.red,
  neutral: null,                      // no dot when there's nothing to say
};

// Inline 8-week sparkline. Renders an SVG line through the weeklyHistory
// values (oldest → newest, current week = last point). Nulls render as
// gaps in the path so missing weeks aren't imputed. The last point gets a
// filled dot in the status (or section/default) color so the eye lands on
// "where you are now" relative to the trajectory.
//
// Visually subtle by design: line is 1.25px stroke, opacity 0.85, default
// color = text-secondary; only amber/red statuses tint the line.
function Sparkline({ values, status = 'neutral', height = 22 }) {
  // Need at least 2 non-null points to draw a line.
  const valid = (values || []).filter(v => v != null && Number.isFinite(v));
  if (valid.length < 2) return null;

  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const range = hi - lo || 1;
  const padY = 2;             // top/bottom breathing room
  const innerH = height - padY * 2;
  const W = 100;              // viewBox width — scales to container
  const stepX = values.length > 1 ? W / (values.length - 1) : W;

  // Map each value to its x,y coordinate. Nulls → null (creates path gaps).
  const points = values.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    const x = i * stepX;
    const y = padY + innerH - ((v - lo) / range) * innerH;
    return { x, y, v };
  });

  // Build the path with M/L commands, breaking on nulls.
  let pathD = '';
  let inPath = false;
  for (const p of points) {
    if (p == null) { inPath = false; continue; }
    pathD += inPath ? ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : ` M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    inPath = true;
  }

  // Last non-null point — anchor for the "you are here" dot.
  let lastPoint = null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i]) { lastPoint = points[i]; break; }
  }

  // Status-driven color. Same focus discipline as the value: green/neutral
  // = subdued (text-secondary), amber/red = full status color so off-trend
  // weeks visually pop.
  const lineColor =
    status === 'amber' ? STATUS_COLORS.amber :
    status === 'red'   ? STATUS_COLORS.red   :
                         'var(--text-secondary, var(--text-muted))';

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, marginTop: 4, display: 'block', overflow: 'visible' }}
      aria-hidden
    >
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      {lastPoint && (
        <circle cx={lastPoint.x} cy={lastPoint.y} r="1.8" fill={lineColor} />
      )}
    </svg>
  );
}

// Small inline arrow component. Direction is +1/-1/0; polarity inverts the
// color (lower-better metrics show ↓ as green, ↑ as red).
function TrendArrow({ delta, polarity = 'higher-better', size = 11 }) {
  if (!delta || delta === 0) {
    return (
      <span style={{ color: 'var(--text-muted)', fontSize: size, marginLeft: 2 }}>→</span>
    );
  }
  const isUp = delta > 0;
  // For "higher-better" metrics (miles, HRV, sleep score), up = green.
  // For "lower-better" metrics (HR, RHR, pace, BMI), up = red.
  const isPositive =
    polarity === 'higher-better' ? isUp :
    polarity === 'lower-better' ? !isUp :
    isUp;
  const color = isPositive ? '#4ade80' : '#f87171';
  return (
    <span style={{ color, fontSize: size, marginLeft: 2, fontWeight: 600 }}>
      {isUp ? '↑' : '↓'}
    </span>
  );
}

// ─── InlineKRIStat — chrome-less inline dial for section headers ──────────
// Renders the same metric data as KRITile but without the bordered tile
// wrapper. Used for the "hero stats" inline with each section's header
// (Run header → Weekly Miles · Weekly Hours · Cadence; Body header →
// Weight Trend · Body Fat · Lean Mass · BMI). The visual feel is "dial /
// stat block" — big number, unit, label, no boundary.
//
// Tap-to-pin still works: the entire stat block is clickable, and the
// star sits next to the small label below the value.
export function InlineKRIStat({ metric, tf, pinned, autoPromoted, autoReasons, onTogglePin, status, formatValue }) {
  const fmt = formatValue || formatKRIValue;
  // Three-tier fallback ladder (Phase 4o.trend.3):
  //   1. Live current-week aggregate
  //   2. Last week's aggregate ("last wk")  — Phase 4o.trend.1
  //   3. Latest single sample regardless of week ("latest <date>")
  //      — for sparse metrics like body composition, where weekly
  //      buckets are often empty.
  const liveWeek = tf?.week ?? null;
  const wkFallback = liveWeek == null && tf?.weekIsFallback;
  const useLatest  = liveWeek == null && tf?.weekFallback == null && tf?.latestSample != null;
  const useFallback = wkFallback || useLatest;       // any non-live state dims
  const week = liveWeek != null ? liveWeek
             : wkFallback       ? tf.weekFallback
             : useLatest        ? tf.latestSample.value
             : null;
  const fallbackKind = wkFallback ? 'last wk' : useLatest ? `latest ${tf.latestSample.date}` : null;
  const polarity = metric?.polarity || 'higher-better';
  const s = status || 'neutral';
  const valueColor = STATUS_VALUE_COLOR[s] || 'var(--text-primary)';
  const dotColor = STATUS_DOT_COLOR[s] || null;
  // Three-state star (Phase 4o.autopromote.3):
  //   ★ gold     — manually pinned (filled)
  //   ☆ amber    — auto-promoted (would appear on Start despite no pin)
  //   ☆ muted    — neither
  const starColor  = pinned ? '#fbbf24' : (autoPromoted ? 'rgba(251,191,36,0.55)' : 'var(--text-muted)');
  const starSymbol = pinned ? '★' : '☆';
  const autoTitle  = autoPromoted && Array.isArray(autoReasons) && autoReasons.length
    ? ` (auto-promoted: ${autoReasons.slice(0, 2).join(' · ')})` : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTogglePin}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTogglePin?.(); } }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        cursor: 'pointer',
        padding: '0 4px',
        minWidth: 64,
      }}
      title={useLatest
        ? `${metric?.label || metric?.id}: showing your most recent reading from ${tf.latestSample.date}.${autoTitle}`
        : wkFallback
        ? `${metric?.label || metric?.id}: showing last week (this week pending). Tap to ${pinned ? 'unpin from' : 'pin to'} Start.${autoTitle}`
        : `${metric?.label || metric?.id}: tap to ${pinned ? 'unpin from' : 'pin to'} Start.${autoTitle}`}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          fontSize: 20, fontWeight: 600, lineHeight: 1,
          color: useFallback ? 'var(--text-secondary, var(--text-muted))' : valueColor,
          opacity: useFallback ? 0.7 : 1,
        }}>
          {fmt(week, metric?.unit)}
        </span>
        {metric?.unit && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{metric.unit}</span>
        )}
        {!useFallback && <TrendArrow delta={tf?.weekDelta} polarity={polarity} size={11} />}
        {useFallback && fallbackKind && (
          <span style={{ fontSize: 8, color: 'var(--text-muted)', fontStyle: 'italic', letterSpacing: '0.04em' }}>
            {fallbackKind}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
        {dotColor && !useFallback && (
          <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0, opacity: s === 'green' ? 0.7 : 1 }} />
        )}
        <span style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {metric?.label}
        </span>
        <span style={{ color: starColor, fontSize: 10, marginLeft: 2 }}>
          {starSymbol}
        </span>
      </div>
    </div>
  );
}

export function KRITile({ metric, tf, pinned, autoPromoted, autoReasons, onTogglePin, formatValue, status, description }) {
  const fmt = formatValue || formatKRIValue;

  // Three-tier fallback ladder (Phase 4o.trend.3):
  //   1. Live current-week aggregate                  → "this week"
  //   2. Last week's aggregate (Phase 4o.trend.1)     → "last wk"
  //   3. Latest single sample regardless of week      → "latest <date>"
  //      Used for sparse-cadence metrics where weekly buckets are often
  //      empty (body composition, lab markers).
  const liveWeek    = tf?.week ?? null;
  const wkFallback  = liveWeek == null && tf?.weekIsFallback;
  const useLatest   = liveWeek == null && tf?.weekFallback == null && tf?.latestSample != null;
  const useFallback = wkFallback || useLatest;
  const week = liveWeek != null ? liveWeek
             : wkFallback       ? tf.weekFallback
             : useLatest        ? tf.latestSample.value
             : null;
  const weekLineLabel = wkFallback ? 'last wk'
                      : useLatest  ? `latest ${tf.latestSample.date}`
                      : 'this week';
  const eightWk = tf?.eightWk ?? null;
  const ytd     = tf?.ytd ?? null;
  const ytdMode = tf?.ytdMode || metric?.ytdMode || 'avg';
  const polarity = metric?.polarity || 'higher-better';

  const ytdLabel = ytdMode === 'total' ? 'YTD' : 'YTD avg';

  // Status-driven color treatment. Caller passes the derived status; we
  // tint the value (only for amber/red — focus on what needs attention)
  // and show a small dot beside the label as a steady visual signal.
  const s = status || 'neutral';
  const valueColor = STATUS_VALUE_COLOR[s] || 'var(--text-primary)';
  const dotColor = STATUS_DOT_COLOR[s] || null;

  // Three-state pin star (Phase 4o.autopromote.3):
  //   ★ gold              — manually pinned (filled)
  //   ☆ amber-translucent — auto-promoted by scoring (hollow, half-bright)
  //   ☆ muted             — neither
  const starColor  = pinned ? '#fbbf24' : (autoPromoted ? 'rgba(251,191,36,0.55)' : 'var(--text-muted)');
  const starSymbol = pinned ? '★' : '☆';
  const autoSuffix = autoPromoted && Array.isArray(autoReasons) && autoReasons.length
    ? ` Auto-promoted: ${autoReasons.slice(0, 2).join(' · ')}.` : '';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTogglePin}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTogglePin?.(); } }}
      title={pinned
        ? `${metric?.label || metric?.id || ''} — pinned to Start. Tap to unpin.`
        : `${metric?.label || metric?.id || ''} — tap to pin to Start.${autoSuffix}`}
      style={{
        background: 'var(--bg-surface)',
        border: pinned
          ? '0.5px solid #fbbf24'
          : (autoPromoted ? '0.5px solid rgba(251,191,36,0.30)' : '0.5px solid var(--border-default)'),
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'border-color 0.15s, background 0.15s',
        minHeight: 84,
      }}
    >
      {/* ── Top row: status dot + label + pin star ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          {dotColor && (
            <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0, opacity: s === 'green' ? 0.7 : 1 }} />
          )}
          <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {metric?.label || metric?.id || '—'}
          </span>
        </div>
        <span style={{ color: starColor, fontSize: 12, lineHeight: 1, flexShrink: 0, marginLeft: 4 }} aria-label={pinned ? 'Pinned to Start' : (autoPromoted ? 'Auto-promoted to Start' : 'Pin to Start')}>
          {starSymbol}
        </span>
      </div>

      {/* ── Optional description line — used by metrics that need to
          annotate their headline with context (e.g. Race Predictor →
          "for RBC Brooklyn Half · May 16"). Italic + muted so it reads
          as a sub-text without competing with the value below. ── */}
      {description && (
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
          {description}
        </div>
      )}

      {/* ── Middle row: week value (big) + 8-week trailing ──
          When showing a carry-forward value, dim the number and skip the
          arrow (no comparison vs prev week makes sense in fallback mode). */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
          <span style={{
            fontSize: 20, fontWeight: 600, lineHeight: 1,
            color: useFallback ? 'var(--text-secondary, var(--text-muted))' : valueColor,
            opacity: useFallback ? 0.7 : 1,
          }}>
            {fmt(week, metric?.unit)}
          </span>
          {!useFallback && <TrendArrow delta={tf?.weekDelta} polarity={polarity} size={12} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginLeft: 'auto' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary, var(--text-muted))', lineHeight: 1 }}>
            {fmt(eightWk, metric?.unit)}
          </span>
          <TrendArrow delta={tf?.eightWkDelta} polarity={polarity} size={10} />
        </div>
      </div>

      {/* ── Unit + 8-wk label row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9, color: 'var(--text-muted)' }}>
        <span>{metric?.unit || ''} · {weekLineLabel}</span>
        <span>8-wk avg</span>
      </div>

      {/* ── Bottom row: YTD ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {ytdLabel}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary, var(--text-muted))' }}>
          {fmt(ytd, metric?.unit)}
        </span>
        <TrendArrow delta={tf?.ytdDelta} polarity={polarity} size={10} />
      </div>

      {/* ── 8-week sparkline (Phase 4m.2.3) ──
          Fills the inner horizontal space — particularly impactful on
          wide tiles in 2-tile and 3-tile sub-bands where the prior empty
          dark space was uninviting. Renders only when at least two of
          the 8 weekly values are non-null. */}
      <Sparkline values={tf?.weeklyHistory} status={s} />

      {/* ── 8-week min/max micro-context ──
          Short text below the sparkline showing the range it traversed.
          Adds another dimension of context without demanding attention. */}
      {(() => {
        const valid = (tf?.weeklyHistory || []).filter(v => v != null && Number.isFinite(v));
        if (valid.length < 2) return null;
        const lo = Math.min(...valid);
        const hi = Math.max(...valid);
        return (
          <div style={{ fontSize: 8, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', letterSpacing: '0.04em', marginTop: 2 }}>
            <span>min {fmt(lo, metric?.unit)}</span>
            <span>max {fmt(hi, metric?.unit)}</span>
          </div>
        );
      })()}
    </div>
  );
}

export default KRITile;
