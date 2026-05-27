// ─── Coach Sigil — Phase 4r.narrative.5.fix.10 ─────────────────────────────
//
// The Coach's personal mark — "Convergent Wedge" by Gemini, picked by
// the user 2026-05-27. A circle (the broad field of signals) with a tall
// precise wedge piercing through it (the Coach's focused observation).
// The mark IS the signature — wherever it appears, the user knows that
// Coach is speaking. We no longer print "Coach" as a label.
//
// Source: src/assets/coach-sigil.png. Authored at 2816 × 1536 px in Gemini,
// resized to 128 × 128 px (8 KB) for retina rendering at the 22–44 px
// display sizes we use across Coach surfaces.
//
// We render via an <img> tag rather than re-coding as inline SVG because
// (a) it preserves the exact Gemini design without interpretation, and
// (b) 22–44 px renders don't need vector scalability. Color is baked into
// the PNG (teal #5eead4 on transparent) — Coach's signature color is
// constant across all surfaces regardless of state severity, by design.

import React from 'react';
import sigilSrc from '../assets/coach-sigil.png';

export function CoachSigil({ size = 22, title = 'Coach', style, ...rest }) {
  return (
    <img
      src={sigilSrc}
      width={size}
      height={size}
      alt={title}
      title={title}
      style={{
        display: 'block',
        flexShrink: 0,
        // Keep the mark from looking soft at small sizes — letting the
        // browser do bicubic resampling on a 128 px source down to 22 px
        // gives a noticeably crisper result than nearest-neighbour.
        imageRendering: 'auto',
        ...style,
      }}
      {...rest}
    />
  );
}
