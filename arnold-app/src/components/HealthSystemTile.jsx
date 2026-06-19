// HealthTileBase — the ONE health-system tile skeleton (Phase 3.2 parity).
// The web Daily grid, the mobile Start grid, and the Nutrition grid each had a
// near-identical tile that diverged only in a handful of sizing/weight/flag
// values. They now render through this base via thin per-surface wrappers that
// resolve their own icon maps and pass a `variant`. Color + fill-tint already
// come from core/presentation/healthTokens.js.
//
// Every value in VARIANTS is the EXACT prior inline value for that surface, so
// this is a no-pixels-change refactor:
//   • web        — 44px icon, mono value #eaeaea, comment line, expand border
//   • mobile     — 36px icon, #fff value (mobile used pure white), 2-line names,
//                  top accent line, NO comment, active glow
//   • nutrition  — 26px boxed icon, mono value, comment line, NOT clickable
import { healthStatusColor, healthFillTint } from '../core/presentation/healthTokens.js';

const VARIANTS = {
  web: {
    tintBase: 0.15, iconSize: 44, iconMb: 6, iconBox: false,
    bg: 'var(--bg-elevated)', baseBorder: '0.5px solid var(--border-subtle)',
    pad: '10px 6px 9px', transition: 'border-color 0.15s, box-shadow 0.15s',
    nameSize: 11, nameWeight: 600, nameColor: 'var(--text-primary)', nameMinH: 26, nameLH: 1.2, nameWrap: false,
    valueSize: 13, valueWeight: 700, valueColor: 'var(--text-primary)', valueMono: true, valueMb: 3,
    showComment: true, accentLine: false,
  },
  mobile: {
    tintBase: 0.12, iconSize: 36, iconMb: 5, iconBox: false,
    bg: 'rgba(255,255,255,0.04)', baseBorder: '1px solid rgba(255,255,255,0.08)',
    pad: '10px 4px 8px', transition: 'border 0.2s ease',
    nameSize: 11, nameWeight: 700, nameColor: 'rgba(255,255,255,0.88)', nameMinH: 28, nameLH: 1.15, nameWrap: true,
    valueSize: 15, valueWeight: 800, valueColor: '#fff', valueMono: false, valueMb: 0,
    showComment: false, accentLine: true,
  },
  nutrition: {
    tintBase: 0.15, iconSize: 26, iconMb: 5, iconBox: true,
    bg: 'var(--bg-elevated)', baseBorder: '0.5px solid var(--border-subtle)',
    pad: '10px 6px 9px', transition: undefined,
    nameSize: 9, nameWeight: 600, nameColor: 'var(--text-primary)', nameMinH: 22, nameLH: 1.15, nameWrap: false,
    valueSize: 13, valueWeight: 700, valueColor: 'var(--text-primary)', valueMono: true, valueMb: 3,
    showComment: true, accentLine: false,
  },
};

export function HealthTileBase({ sys, variant = 'web', pngSrc = null, svgIcon = null, active = false, onClick }) {
  const V = VARIANTS[variant] || VARIANTS.web;
  const { pct, status, comment, name, color } = sys;
  const fillTint = healthFillTint(status, V.tintBase);

  const clickable = typeof onClick === 'function';

  // Active-state border + glow differ per surface: web tints to the status
  // color with an inset ring; mobile rings the system's own brand color with an
  // outer glow; nutrition is never active.
  const activeColor = variant === 'mobile' ? color : healthStatusColor(status);
  const border = active
    ? `${variant === 'mobile' ? '1.5px' : '1px'} solid ${activeColor}`
    : V.baseBorder;
  const boxShadow = active
    ? (variant === 'mobile' ? `0 0 8px ${color}33` : `0 0 0 1px ${activeColor}55 inset`)
    : 'none';

  const clickProps = clickable
    ? {
        role: 'button', tabIndex: 0, onClick,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
      }
    : {};

  const nameText = V.nameWrap ? name.replace(' & ', '/​') : name.replace(' & ', '/');

  return (
    <div
      {...clickProps}
      style={{
        position: 'relative', background: V.bg, border, borderRadius: 12,
        padding: V.pad, overflow: 'hidden', minHeight: 0,
        cursor: clickable ? 'pointer' : 'default',
        transition: V.transition, boxShadow,
      }}>

      {V.accentLine && (
        <div style={{ position: 'absolute', top: 0, left: 6, right: 6, height: 2, borderRadius: '0 0 2px 2px', background: color, opacity: 0.6 }} />
      )}

      {/* Rising fill — encodes status (the value itself stays neutral). */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        height: `${Math.max(8, pct)}%`,
        background: `linear-gradient(180deg, transparent, ${fillTint})`,
        borderRadius: '0 0 12px 12px', transition: 'height 0.6s ease', zIndex: 0,
      }} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <div style={{
          width: V.iconSize, height: V.iconSize, margin: `0 auto ${V.iconMb}px`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...(V.iconBox ? { borderRadius: 7, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-subtle)' } : {}),
        }}>
          {pngSrc
            ? <img src={pngSrc} alt={name} width={V.iconSize} height={V.iconSize} style={{ display: 'block' }} />
            : svgIcon}
        </div>

        <div style={{
          fontSize: V.nameSize, fontWeight: V.nameWeight, color: V.nameColor,
          lineHeight: V.nameLH, marginBottom: 3, minHeight: V.nameMinH,
          ...(V.nameWrap
            ? { whiteSpace: 'normal', overflowWrap: 'break-word', padding: '0 2px' }
            : { display: 'flex', alignItems: 'center', justifyContent: 'center' }),
        }}>{nameText}</div>

        {/* Value is neutral (Phase 3.1) — status reads from the fill tint. */}
        <div style={{
          fontSize: V.valueSize, fontWeight: V.valueWeight, color: V.valueColor,
          marginBottom: V.valueMb,
          ...(V.valueMono ? { fontFamily: 'var(--font-mono)' } : {}),
        }}>{pct}%</div>

        {V.showComment && (
          <div style={{
            fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.25, minHeight: 20,
            overflow: 'hidden', textOverflow: 'ellipsis',
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          }}>{comment}</div>
        )}
      </div>
    </div>
  );
}

export default HealthTileBase;
