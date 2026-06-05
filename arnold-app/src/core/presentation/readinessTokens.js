// Readiness tokens — shared color/label maps for the readiness "context" role
// (the 7d/30d rings + the A:C ratio chip). Moved out of Arnold.jsx module scope
// so both Arnold.jsx AND the ContextCluster component can import ONE definition
// (a component can't import back from Arnold.jsx without a cycle). See
// docs/PRESENTATION_LAYER.md — the `context` role.

// A:C ratio zone → color. (Unchanged from the long-standing Arnold values.)
export const ZONE_COLORS = {
  optimal:       '#4ade80',
  undertraining: '#60a5fa',
  overreaching:  '#fbbf24',
  danger:        '#f87171',
  no_data:       'var(--text-muted)',
};

// A:C ratio zone → full label (web / roomy surfaces).
export const ZONE_LABELS = {
  optimal:       'Optimal',
  undertraining: 'Under-training',
  overreaching:  'Over-reaching',
  danger:        'Danger',
  no_data:       'No data',
};

// A:C ratio zone → short label (narrow surfaces — stops "Under-training" from
// wrapping in the compact mobile chip). Profile 'labels' picks which to use.
export const ZONE_LABELS_SHORT = {
  optimal:       'Optimal',
  undertraining: 'Under',
  overreaching:  'Over',
  danger:        'Danger',
  no_data:       '—',
};

// Readiness score (0–100) → ring color. Matches the hero ring thresholds
// (70 / 45) that LogDay used inline; adds a null guard for empty days.
export function ringColor(s) {
  if (s == null) return 'var(--text-muted)';
  if (s >= 70)   return '#4ade80';
  if (s >= 45)   return '#fbbf24';
  return '#f87171';
}
