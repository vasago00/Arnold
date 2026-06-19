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

// Readiness score (0–100) → plain-language verdict (the hero's "one read") +
// its accent color. ONE definition so the web Daily hero and the mobile Play
// hero can't drift — Phase 3.1 originally inlined this in both and they had to
// be edited twice. `word` is null on empty days (score ≤ 0) so callers can hide
// the line. Color tracks ringColor's 70/45 bands exactly.
export function readinessVerdict(s) {
  if (s == null || s <= 0) return { word: null, color: 'var(--text-muted)' };
  if (s >= 70) return { word: 'Go strong', color: '#4ade80' };
  if (s >= 45) return { word: 'Go steady', color: '#fbbf24' };
  return { word: 'Dial back', color: '#f87171' };
}
