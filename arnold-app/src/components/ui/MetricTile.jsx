// Shared MetricTile — Phase 0.2. The single metric-tile primitive for web + mobile,
// replacing the two divergent copies (mobile in MobileHome, web in Arnold). Styled
// ONLY from design tokens (src/theme/tokens.js). Faithful to the mobile tile (which
// already used the now-canonical white-opacity text scale), so adopting it is
// value-preserving for mobile; the web tile shifts onto this scale when it migrates.
//
// Contract (unchanged from the mobile tile):
//   value text = neutral (TEXT.primary). Category color = label + accent + gauge.
//   Status/progress color = the trend line only (trendColor). This bakes in the
//   "value neutral, color reserved for status/trend" rule from the audit.
import { TEXT, SURFACE } from '../../theme/tokens.js';

// Semicircle arc gauge (matches the mobile MiniArcGauge exactly).
function MiniArcGauge({ pct, color }) {
  const R = 17, CX = 22, CY = 22, SW = 3.5;
  const halfCirc = Math.PI * R;
  const fullCirc = 2 * Math.PI * R;
  const clamp = Math.max(0, Math.min(pct || 0, 1));
  const fill = halfCirc * clamp;
  return (
    <svg width={44} height={26} viewBox="0 0 44 26" style={{ display: 'block' }}>
      <circle cx={CX} cy={CY} r={R} fill="none"
        stroke={SURFACE.track} strokeWidth={SW}
        strokeDasharray={`${halfCirc} ${halfCirc}`} strokeLinecap="round"
        transform={`rotate(180 ${CX} ${CY})`} />
      {clamp > 0.005 && (
        <circle cx={CX} cy={CY} r={R} fill="none"
          stroke={color} strokeWidth={SW}
          strokeDasharray={`${fill} ${fullCirc - fill}`} strokeLinecap="round"
          transform={`rotate(180 ${CX} ${CY})`} />
      )}
    </svg>
  );
}

export function MetricTile({
  label, todayVal, todayUnit, trendText, trendColor, avg30, avg30Label,
  gaugePct, color, statusIcon, statusIconColor, onTap, source, autoReasons,
}) {
  const isAuto = source === 'auto';
  const reasonText = isAuto && Array.isArray(autoReasons) && autoReasons.length
    ? `Auto-promoted: ${autoReasons.slice(0, 2).join(' · ')}`
    : null;
  return (
    <div onClick={onTap} style={{
      background: SURFACE.card,
      border: `1px solid ${SURFACE.border}`,
      borderRadius: 14, padding: '8px 10px 6px', marginBottom: 6,
      position: 'relative', overflow: 'hidden',
      cursor: onTap ? 'pointer' : 'default',
    }}>
      {/* Top accent — category color */}
      <div style={{ position: 'absolute', top: 0, left: 12, right: 12, height: 2, borderRadius: '0 0 2px 2px', background: color, opacity: 0.7 }} />

      {source ? (
        <span title={reasonText || 'Pinned'} aria-label={reasonText || 'Pinned'}
          style={{
            position: 'absolute', top: 5, right: 8, fontSize: 10, lineHeight: 1,
            color: isAuto ? TEXT.faint : color, opacity: isAuto ? 0.55 : 0.85,
            fontWeight: 600, pointerEvents: 'none',
          }}>
          {isAuto ? '☆' : '★'}
        </span>
      ) : null}

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color, marginBottom: 4 }}>{label}</div>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: TEXT.primary }}>{todayVal}</span>
            {todayUnit ? <span style={{ fontSize: 11, color: TEXT.muted, marginLeft: 2 }}>{todayUnit}</span> : null}
          </div>
          <div style={{ fontSize: 10, fontWeight: 600, color: trendColor || TEXT.muted, marginTop: 3, height: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>{trendText || ' '}</span>
            {statusIcon ? (
              <span style={{ fontSize: 10, fontWeight: 700, color: statusIconColor || TEXT.muted, lineHeight: 1 }}>{statusIcon}</span>
            ) : null}
          </div>
        </div>

        <div style={{ flexShrink: 0, width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <MiniArcGauge pct={gaugePct} color={color} />
          <div style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1, marginTop: 0 }}>{avg30}</div>
          <div style={{ fontSize: 11, color: TEXT.faint, fontWeight: 600, marginTop: 1, letterSpacing: '0.04em' }}>
            {avg30Label || '30d avg'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetricTile;
