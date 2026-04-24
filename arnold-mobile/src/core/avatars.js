// Health / fitness themed SVG avatars.
// Each is a circular gradient background with a white line-art glyph.
// Returned as data URIs so they embed directly in <img src=...> without network.

const PALETTE = [
  ['#4ade80','#16a34a'], // green — vitality
  ['#60a5fa','#2563eb'], // blue — endurance
  ['#f472b6','#db2777'], // pink — heart
  ['#fbbf24','#d97706'], // amber — energy
  ['#a78bfa','#7c3aed'], // purple — recovery
  ['#f87171','#dc2626'], // red — strength
  ['#22d3ee','#0891b2'], // cyan — hydration
  ['#fb923c','#ea580c'], // orange — fuel
  ['#34d399','#059669'], // teal — nutrition
  ['#818cf8','#4f46e5'], // indigo — sleep
  ['#facc15','#ca8a04'], // yellow — sun
  ['#2dd4bf','#0d9488'], // mint — balance
];

// Simple line-art glyphs (24x24 viewBox, white stroke 1.8)
const GLYPHS = {
  runner:   '<path d="M13 4a2 2 0 1 0 0-.001M8 20l3-5 2 2 3-2 1 3M4 12l3-1 4 2 3-4 3 1"/>',
  dumbbell: '<path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12"/>',
  heart:    '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  flame:    '<path d="M12 3s4 4 4 9a4 4 0 0 1-8 0c0-3 2-4 2-6s2-3 2-3z"/>',
  bolt:     '<path d="M13 3L5 14h6l-2 7 8-11h-6l2-7z"/>',
  mountain: '<path d="M3 19l6-10 4 6 2-3 6 7z"/>',
  apple:    '<path d="M12 7c-1-3-5-3-5 1 0 4 3 10 5 10s5-6 5-10c0-4-4-4-5-1zM12 7v-3"/>',
  leaf:     '<path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16zM4 20l8-8"/>',
  drop:     '<path d="M12 3s6 7 6 12a6 6 0 0 1-12 0c0-5 6-12 6-12z"/>',
  moon:     '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/>',
  sun:      '<path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M6 18l1.5-1.5M16.5 7.5L18 6"/><circle cx="12" cy="12" r="4"/>',
  yoga:     '<path d="M12 4a2 2 0 1 0 0-.001M12 7v5M6 20h12M8 14l4-2 4 2M9 20l3-6 3 6"/>',
  bike:     '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9h4"/>',
  scale:    '<path d="M4 8h16v12H4zM8 12h8M9 8V5h6v3"/>',
  shield:   '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  target:   '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  // Stick figures
  stickRun:     '<circle cx="15" cy="4" r="1.6"/><path d="M15 6l-2 5 3 2 1 5M13 11l-4 1-2 4M16 13l4 1M9 20l2-3"/>',
  stickLift:    '<circle cx="12" cy="4" r="1.6"/><path d="M12 6v7M8 9h8M5 7v4M19 7v4M3 8v2M21 8v2M12 13l-3 7M12 13l3 7"/>',
  stickPushup:  '<circle cx="5" cy="9" r="1.4"/><path d="M6 10l4 2 6 1h3M7 13l3 2M13 13v4M18 13v4M4 18h16"/>',
  stickPullup:  '<path d="M3 4h18"/><circle cx="12" cy="7" r="1.5"/><path d="M12 8.5v6M9 5l3 3 3-3M10 14l-1 5M14 14l1 5"/>',
  stickSquat:   '<circle cx="12" cy="4" r="1.6"/><path d="M12 6v4l-4 4v4M12 10l4 4v4M8 10h8"/>',
  stickJump:    '<circle cx="12" cy="3" r="1.5"/><path d="M12 5v6M7 7l5 2 5-2M9 11l-2 6M15 11l2 6"/>',
  stickWalk:    '<circle cx="12" cy="4" r="1.6"/><path d="M12 6v7M9 9l3 1 3-2M10 20l2-7 3 6"/>',
  stickKettle:  '<circle cx="12" cy="4" r="1.6"/><path d="M12 6v6M9 9l3 1 3-1M12 12v4M9 20l3-4 3 4M14 14a3 3 0 1 1 4 3"/>',
};

const GLYPH_KEYS = Object.keys(GLYPHS);

function buildSvg(glyphKey, [c1, c2]) {
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><circle cx="24" cy="24" r="24" fill="url(#${id})"/><g transform="translate(12 12)" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyphKey]}</g></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Pre-built library — 16 themed avatars
export const AVATAR_LIBRARY = GLYPH_KEYS.map((k, i) => ({
  id: `av-${k}`,
  theme: k,
  src: buildSvg(k, PALETTE[i % PALETTE.length]),
}));
