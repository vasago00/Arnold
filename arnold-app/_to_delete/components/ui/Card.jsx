// Shared <Card> + <SectionHeader> — the single card chrome (uplift Step 5),
// finishing the parked Step 0.2 primitive. Styled ONLY from design tokens.
// Low-risk surfaces adopt this; the churn-heavy PlannedWorkoutTile is left alone
// per the audit. SectionHeader is the small uppercase label above a card section.
import { SURFACE, RADIUS, SPACE, TEXT, TYPE } from '../../theme/tokens.js';

export function Card({ children, radius = 'lg', pad = 'lg', className = '', style = {}, ...rest }) {
  const p = SPACE[pad] ?? SPACE.lg;
  return (
    <div
      className={className}
      style={{
        background: SURFACE.card,
        border: `0.5px solid ${SURFACE.border}`,
        borderRadius: RADIUS[radius] ?? RADIUS.lg,
        padding: `${p}px ${p + 2}px`,
        boxSizing: 'border-box',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionHeader({ children, color = TEXT.muted, right, style = {} }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACE.sm, ...style }}>
      <span style={{
        fontSize: TYPE.micro, fontWeight: TYPE.weight.regular, color,
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{children}</span>
      {right != null && <span style={{ fontSize: TYPE.micro, color: TEXT.faint }}>{right}</span>}
    </div>
  );
}

export default Card;
