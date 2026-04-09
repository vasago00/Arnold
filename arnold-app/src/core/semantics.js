// ─── ARNOLD Semantic Palette ─────────────────────────────────────────────────
// Lock colors to meaning, not decoration. Every tile, badge, and chart should
// pull from this when conveying status.

export const STATUS = {
  ok:       { color: '#4ade80', dim: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.30)',  label: 'On track' },
  warn:     { color: '#fbbf24', dim: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.30)',  label: 'Watch'    },
  critical: { color: '#f87171', dim: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.30)', label: 'Off track'},
  neutral:  { color: '#94a3b8', dim: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.25)', label: '—'        },
};

// Domain colors — used for category badges, chart series, group accents.
// Distinct from STATUS so an "on-track training tile" is still green, while
// the "training" domain badge stays blue.
export const DOMAIN = {
  training:  '#60a5fa', // blue   — volume, distance
  recovery:  '#a78bfa', // purple — sleep, HRV
  body:      '#34d399', // teal   — weight, body comp
  nutrition: '#fbbf24', // amber  — calories, macros
  bloods:    '#f87171', // red    — clinical
  intensity: '#ef4444', // red    — Z4/Z5 effort
};

// Map a fraction (actual/goal) to a status bucket.
export function statusFromPct(pct, { warnAt = 0.7, okAt = 0.9 } = {}) {
  if (pct == null || isNaN(pct)) return 'neutral';
  if (pct >= okAt)   return 'ok';
  if (pct >= warnAt) return 'warn';
  return 'critical';
}
