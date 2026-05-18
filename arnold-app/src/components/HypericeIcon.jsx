// ─── Hyperice product icons ──────────────────────────────────────────────────
// Phase 4r.recover.1
//
// Inline SVG glyphs per product so the icons ship with the JS bundle
// and never miss. Each takes { productId, size, color } props.

export function HypericeIcon({ productId, size = 16, color = '#22d3ee' }) {
  const s = size;
  const stroke = color;
  const props = {
    width: s, height: s, viewBox: '0 0 24 24',
    fill: 'none', stroke, strokeWidth: 1.6,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (productId) {
    case 'normatec':
      // Two stacked boot/leg outlines — compression boots
      return (
        <svg {...props}>
          <path d="M7 4h4v9c0 3-1 5-2 6h-3c-1-1-1-3 0-5z"/>
          <path d="M13 4h4v9c0 3-1 5-2 6h-3c-1-1-1-3 0-5z"/>
          <path d="M7 8h4M13 8h4M7 12h4M13 12h4"/>
        </svg>
      );
    case 'hypervolt':
      // Percussive massage gun — pistol grip + barrel head
      return (
        <svg {...props}>
          <path d="M3 11h11v4H6l-3 2v-3z"/>
          <circle cx="17" cy="13" r="4"/>
          <path d="M17 9v8M13 13h8"/>
        </svg>
      );
    case 'venom2':
      // Heat-vibration wrap — band with heat waves rising
      return (
        <svg {...props}>
          <rect x="3" y="11" width="18" height="7" rx="2"/>
          <path d="M3 14h18"/>
          <path d="M7 8c0-1 1-2 0-3M12 8c0-1 1-2 0-3M17 8c0-1 1-2 0-3"/>
        </svg>
      );
    case 'vyper':
      // Vibrating roller — cylinder with axis
      return (
        <svg {...props}>
          <ellipse cx="5" cy="12" rx="2" ry="5"/>
          <ellipse cx="19" cy="12" rx="2" ry="5"/>
          <path d="M5 7h14M5 17h14"/>
          <path d="M9 10v4M13 10v4"/>
        </svg>
      );
    case 'icex':
      // Cold therapy — snowflake-ish hexagon with crosshatch
      return (
        <svg {...props}>
          <path d="M12 3v18M3 8l18 8M3 16l18-8"/>
          <path d="M12 5l-2 2M12 5l2 2M12 19l-2-2M12 19l2-2"/>
        </svg>
      );
    case 'other':
    default:
      // Generic spark / sparkles
      return (
        <svg {...props}>
          <path d="M12 4l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
        </svg>
      );
  }
}
