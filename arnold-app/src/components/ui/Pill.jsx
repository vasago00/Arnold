// Shared <Pill> — the dense info-pill (uplift Step 4). The AM/Noon/PM supplement
// shape: fixed icon slot, label, trailing value pinned right, reserved check slot
// (always present, hidden when not done) so a row of pills aligns identically.
// Interactive pills (onClick) carry `.arnold-compact-btn` to escape the 42px floor.
import { CONTROL, RADIUS, TEXT, withAlpha } from '../../theme/tokens.js';

export default function Pill({
  icon, label, value, done = false, color, size = 'chip',
  width, onClick, className = '', style = {}, ...rest
}) {
  const h = CONTROL[size] ?? CONTROL.chip;
  const c = color || TEXT.muted;
  const inner = (
    <>
      {icon != null && <span style={{ width: 11, textAlign: 'center', fontSize: 10, flexShrink: 0 }}>{icon}</span>}
      {label != null && <span>{label}</span>}
      {value != null && <span style={{ fontSize: 8, opacity: 0.85, marginLeft: 'auto' }}>{value}</span>}
      <span style={{ width: 8, textAlign: 'center', fontSize: 8, flexShrink: 0, visibility: done ? 'visible' : 'hidden' }}>✓</span>
    </>
  );
  const baseStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 4, boxSizing: 'border-box',
    height: h, width, padding: '0 6px', borderRadius: RADIUS.sm,
    border: `0.5px solid ${withAlpha(c, 0.25)}`,
    background: withAlpha(c, done ? 0.12 : 0.05),
    color: c, fontSize: 9, fontWeight: 500, lineHeight: 1, whiteSpace: 'nowrap',
  };
  if (onClick) {
    return (
      <button className={`arnold-compact-btn ${className}`.trim()} onClick={onClick}
        style={{ ...baseStyle, cursor: 'pointer', ...style }} {...rest}>{inner}</button>
    );
  }
  return <span className={className} style={{ ...baseStyle, ...style }} {...rest}>{inner}</span>;
}
