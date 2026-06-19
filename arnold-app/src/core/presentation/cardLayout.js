// Presentation Layer — ACTIVITY CARD layout density (the SoT for how the
// activity-detail card packs its metric tiles and sections). Part of the same
// "screens are tools the coaching team uses to tell the story" effort as
// metricRegistry / storySpecs. See docs/PRESENTATION_LAYER.md.
//
// WHY THIS EXISTS
// The activity card used to lay tiles out with `flex justify-between`, which
// spreads a handful of tiles to the container edges with big gaps in the middle
// (looks "bunched" / sparse on web) and wraps to near-empty single columns on a
// narrow phone. Each section also carried its own divider + uppercase header, so
// the card read as a tall stack of labels separated by black space.
//
// THE FIX (pure CSS, no JS breakpoint)
// `repeat(auto-fit, minmax(<min>, 1fr))` PACKS tiles: as many even columns as
// fit, filling the row edge-to-edge, wrapping cleanly. On a wide web card that's
// 5-6 columns; on a ~380px phone it's automatically 2-3. No `isMobile` branch,
// so web and mobile stay in lockstep — the density adapts to the width.
//
// Sections are merged and headers made compact (less leading/trailing space) to
// reclaim the vertical black space the user flagged.

// ── Tile grids ────────────────────────────────────────────────────────────
// headline = the prominent first metrics (bigger HeroTile). A slightly larger
//   min keeps them readable; they still pack and fill.
// context  = secondary IconMiniTiles (and hydration tiles). Smaller min → denser.
export const CARD_GRID = {
  headline: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
    gap: 8,
    marginBottom: 8,
  },
  context: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
    gap: 6,
  },
};

// MOBILE uses DELIBERATE fixed columns, NOT auto-fit. On a phone, auto-fit packs
// as many columns as fit by pixel width, which orphans tiles into uneven rows
// (4 tiles → 3 + 1, the "all over the place" look). A fixed 2-up grid gives clean
// 2×2 blocks and a consistent rhythm down the whole card. Desktop keeps the packed
// auto-fit fill (it has the width to use it well). Pass `mobile` = !!mobileView.
export function cardGrid(kind, mobile) {
  if (mobile) {
    return {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 6,
      ...(kind === 'headline' ? { marginBottom: 8 } : null),
    };
  }
  return CARD_GRID[kind] || CARD_GRID.context;
}

// ── Section chrome ──────────────────────────────────────────────────────────
// A compact section header: same visual language as the old `subHdr` but tighter
// margins so merged sections don't reintroduce dead space.
export const SECTION_HDR = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  marginBottom: 6,
};

// A thinner section separator with less vertical margin than the legacy divider
// (10px → 8px). Used between merged groups, not between every metric block.
export const SECTION_RULE = {
  height: '0.5px',
  background: 'var(--border-subtle)',
  margin: '8px 0',
};

// ── Card section model ──────────────────────────────────────────────────────
// Declarative order of the activity card's groups. The renderer in Arnold.jsx
// walks this; merging two old sections (hydration + replenishment) into one
// `fuel` group is expressed here, not by ad-hoc JSX. `header:null` means the
// group folds in under the previous one with no separator (e.g. context metrics
// continue straight under the headline).
export const CARD_SECTIONS = [
  { id: 'headline', header: null, grid: 'headline' },
  { id: 'context', header: null, grid: 'context' },     // folds under headline
  { id: 'fuel', header: 'Fuel & Fluids', rule: true },  // hydration + replenishment merged
  { id: 'compare', header: 'Vs Goal', rule: true },
];

export const sectionLabelFor = (planType) => {
  const L = {
    easy_run: 'Easy run', long_run: 'Long run', tempo: 'Tempo',
    intervals: 'Intervals', hiit: 'HIIT', strength: 'Strength',
    mobility: 'Mobility', cycle: 'Cycle', cross: 'Cross-train',
    swim: 'Swim', walk: 'Walk', race: 'Race',
  };
  return L[planType] || 'Session';
};
