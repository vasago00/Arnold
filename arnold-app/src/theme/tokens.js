// Arnold design tokens — THE single source of truth for color, spacing, radius, type.
//
// Phase 0.1 of the uplift (see EXECUTION_PLAN_2026-06.md). Before this file, discipline
// colors lived (and silently disagreed) across FAMILY_COLOR, planner.DAY_TYPES,
// PlanPickerModal.OPTIONS, and metricRegistry.COLOR. Everything color-related should
// import from here. Three roles, each with ONE job:
//
//   • CATEGORY — discipline identity (matches the low-poly figure palettes). Keyed by
//                plan type AND family so both the planner (tempo=amber) and the figure
//                system (run=blue) read from one place.
//   • STATUS   — good / warn / bad / over / neutral. Progress-regress + health states.
//                NEVER used to encode category. (This is what the Max-HR-yellow bug was:
//                a value painted by a band/tier instead of a status.)
//   • BRAND    — the app's accent identity (the neon-on-dark signature).
//
// Rule: a number's VALUE is neutral text; color is reserved for STATUS/trend. Category
// color belongs on labels/accents/figures, not on the value itself.

export const CATEGORY = {
  // Run family — sub-types keep distinct planner accents (quality sessions read apart).
  run:       '#60a5fa',
  easy_run:  '#60a5fa',
  long_run:  '#3b82f6',
  tempo:     '#fbbf24',
  intervals: '#f87171',
  // Other disciplines (each = its figure palette mid-tone).
  strength:  '#a78bfa',
  hiit:      '#fb7185',
  mobility:  '#5eead4',
  cross:     '#34d399',
  cycle:     '#eab308',
  swim:      '#06b6d4',
  ski:       '#93c5fd',
  walk:      '#84cc16',
  race:      '#ef4444',
  rest:      '#6b7280',
};

// Resolve any plan type OR family to its canonical category color (falls back to neutral).
export function categoryColor(key) {
  return CATEGORY[key] || CATEGORY.rest;
}

export const STATUS = {
  good:    '#4ade80', // progress / on-target / healthy
  warn:    '#fbbf24', // caution / slightly off
  hot:     '#fb923c', // elevated tier (threshold-ish on the intensity ramp)
  bad:     '#f87171', // regress / off-target / high tier
  over:    '#ef4444', // hard ceiling / overreach (deep red)
  neutral: '#94a3b8', // no judgement / not enough signal (the "no color" default)
};

// Brand accent identity (neon-on-dark). Coach sigil teal is the signature mark color.
export const BRAND = {
  accent: '#60a5fa',
  coach:  '#5eead4',
};

// Text scale — CANONICAL = white-opacity (Emil 2026-06-10), the dark-UI standard.
// The shared tile/card primitives (Step 0.2) use these. The pre-workout card's
// warm-gray T1–T4 migrate to this when it adopts the primitives.
export const TEXT = {
  primary:   '#ffffff',
  secondary: 'rgba(255,255,255,0.88)',
  muted:     'rgba(255,255,255,0.65)',
  faint:     'rgba(255,255,255,0.45)',
};

// Surfaces — card fill + hairline border (the mobile tile values, now canonical).
export const SURFACE = {
  card:   'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.08)',
  track:  'rgba(255,255,255,0.12)', // gauge/progress track
};

// Spacing scale (px) — for the shared primitives in Step 0.2.
export const SPACE = { xs: 4, sm: 6, md: 9, lg: 12, xl: 16, xxl: 24 };

// Corner radii (px).
export const RADIUS = { sm: 6, md: 8, lg: 12, pill: 999 };

// Type scale (px) + weights used across tiles/cards.
export const TYPE = {
  label: 11, micro: 10, body: 13, value: 14, valueLg: 26, hero: 28,
  weight: { regular: 500, bold: 700, heavy: 800 },
};

// Control heights (px) — THE single source for button/pill/chip sizing.
// `chip`/`compact` are dense in-card controls (AM/Noon/PM pills, +250ml, calendar
// nav). They only take effect with the .arnold-compact-btn class, which escapes the
// mobile.css `button { min-height: 42px !important }` touch floor — the <Button>/<Pill>
// primitives attach that class automatically so the height actually applies
// (see POSTMORTEMS.md 2026-06-16: inline heights were silently clamped to 42px).
// `touch` is the Apple-HIG floor for standalone primary actions.
export const CONTROL = {
  chip:     18, // dense info-pills / inline chips
  compact:  22, // compact action buttons inside cards
  standard: 28, // default control
  touch:    42, // standalone primary tap target (== the mobile.css floor)
};

// Alpha helper — hex → rgba(...,a). Tokens are hex; the primitives tint with this.
export function withAlpha(hex, a) {
  if (typeof hex !== 'string' || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
