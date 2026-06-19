// SwipePanes — horizontal swipeable panes for the activity card (and reuse).
// Native CSS scroll-snap: real touch-swipe on mobile, drag/scroll on desktop —
// no gesture library. Tab labels (tap to jump) + dot indicators track position.
// Each pane is full-width and self-contained; activity-card content lives in the
// panes, NOT prose — the only narrative on the card is the Coach line elsewhere.

import { useRef, useState, useCallback } from 'react';

export function SwipePanes({ panes = [], style }) {
  const ref = useRef(null);
  const [active, setActive] = useState(0);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActive(prev => (i !== prev ? i : prev));
  }, []);

  const goTo = useCallback((i) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }, []);

  const visible = panes.filter(Boolean);
  if (!visible.length) return null;
  if (visible.length === 1) return <div style={style}>{visible[0].content}</div>;

  const tab = (on) => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: on ? 'var(--text-primary)' : 'var(--text-muted)',
    background: 'transparent', border: 'none', borderBottom: `2px solid ${on ? 'var(--text-accent)' : 'transparent'}`,
    padding: '3px 4px 5px', cursor: 'pointer', transition: 'color 160ms ease, border-color 160ms ease',
  });
  const dot = (on) => ({
    width: on ? 16 : 5, height: 5, borderRadius: 3, cursor: 'pointer',
    background: on ? 'var(--text-accent)' : 'var(--border-subtle)', transition: 'all 180ms ease',
  });

  return (
    <div style={style}>
      {/* Tab labels — tap to jump to a pane */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
        {visible.map((p, i) => (
          <button key={p.key} type="button" onClick={() => goTo(i)} style={tab(i === active)}>{p.label}</button>
        ))}
      </div>

      {/* Scroll-snap pane track */}
      <div
        ref={ref}
        onScroll={onScroll}
        style={{
          display: 'flex', overflowX: 'auto', overflowY: 'hidden',
          scrollSnapType: 'x mandatory', scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {visible.map((p) => (
          <div key={p.key} style={{ flex: '0 0 100%', minWidth: '100%', boxSizing: 'border-box', scrollSnapAlign: 'start', paddingRight: 1 }}>
            {p.content}
          </div>
        ))}
      </div>

      {/* Dot indicators */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
        {visible.map((p, i) => (
          <span key={p.key} onClick={() => goTo(i)} style={dot(i === active)} aria-label={`Go to ${p.label}`} />
        ))}
      </div>
    </div>
  );
}

export default SwipePanes;
