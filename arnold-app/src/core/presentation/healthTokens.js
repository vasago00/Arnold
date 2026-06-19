// Health-system status tokens — ONE definition of the good / focus / deficient
// color vocabulary. Phase 3.2 parity: the web tile + system-detail, the mobile
// tile, and BOTH grids' header count-dots all hardcoded the same three hexes
// inline, so they could (and did, elsewhere) drift. They now call this. Colors
// are the canonical STATUS tokens and are byte-identical to the long-standing
// hardcoded values (#4ade80 / #fbbf24 / #f87171), so this changes no pixels.
import { STATUS } from '../../theme/tokens.js';

// status: 'good' | 'focus' | 'def' (deficient). Anything else → deficient/red,
// matching the prior `status === 'good' ? … : status === 'focus' ? … : red`.
export function healthStatusColor(status) {
  return status === 'good'  ? STATUS.good   // #4ade80
       : status === 'focus' ? STATUS.warn   // #fbbf24
       :                       STATUS.bad;   // #f87171
}

// Rising bottom fill tint for the health tiles. SAME color vocabulary as above,
// at the caller's `base` alpha — surfaces tune strength (web/nutrition base 0.15,
// the smaller mobile tiles a lighter 0.12). The deficient state always reads a
// touch heavier (+0.03), exactly reproducing every prior inline value, so this
// changes no pixels.
export function healthFillTint(status, base = 0.15) {
  const rgb = status === 'good'  ? '74,222,128'
            : status === 'focus' ? '251,191,36'
            :                       '248,113,113';
  const alpha = (status === 'good' || status === 'focus')
    ? base
    : Math.round((base + 0.03) * 100) / 100;
  return `rgba(${rgb},${alpha})`;
}

export default healthStatusColor;
