// Shared <Button> — the compact-by-default action control (uplift Step 3).
// Styled ONLY from design tokens. Always carries `.arnold-compact-btn`, so its
// height token actually applies on mobile instead of being clamped to the 42px
// touch floor (mobile.css) — see POSTMORTEMS.md 2026-06-16. Sizes map to CONTROL
// heights; `color` drives the tint (defaults to brand accent).
import { CONTROL, RADIUS, SURFACE, TEXT, BRAND, withAlpha } from '../../theme/tokens.js';

const PAD  = { chip: '0 7px', compact: '0 9px', standard: '0 12px' };
const FONT = { chip: 9, compact: 11, standard: 12 };

export default function Button({
  children, onClick, color = BRAND.accent, variant = 'action',
  size = 'compact', icon, className = '', style = {}, disabled = false, ...rest
}) {
  const h = CONTROL[size] ?? CONTROL.compact;
  const tint = {
    action: { background: withAlpha(color, 0.10), border: `0.5px solid ${withAlpha(color, 0.30)}`, color },
    ghost:  { background: 'transparent',          border: `0.5px solid ${SURFACE.border}`,         color: TEXT.muted },
    danger: { background: withAlpha('#f87171', 0.10), border: `0.5px solid ${withAlpha('#f87171', 0.30)}`, color: '#f87171' },
  }[variant] || {};
  return (
    <button
      className={`arnold-compact-btn ${className}`.trim()}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        boxSizing: 'border-box', height: h, padding: PAD[size] ?? PAD.compact,
        borderRadius: RADIUS.sm, fontSize: FONT[size] ?? FONT.compact, fontWeight: 600,
        lineHeight: 1, whiteSpace: 'nowrap', cursor: disabled ? 'default' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s', opacity: disabled ? 0.45 : 1,
        ...tint, ...style,
      }}
      {...rest}
    >
      {icon != null && <span style={{ display: 'inline-flex', fontSize: size === 'chip' ? 11 : 13, flexShrink: 0 }}>{icon}</span>}
      {children}
    </button>
  );
}
