// Phase 0.5 — extracted from Arnold.jsx (was a module-scope const near the file tail).
// The web app's CSS-variable palette, referenced throughout Arnold.jsx and (now)
// importable so extracted components can use it too. First step of decomposing the
// ~11.8k-line monolith. (Future cleanup: reconcile this with src/theme/tokens.js.)
export const C = {
  bg:"var(--bg-base)",
  surf:"var(--bg-surface)",
  elev:"var(--bg-elevated)",
  inp:"var(--bg-input)",
  b:"var(--border-default)",
  bs:"var(--border-subtle)",
  bst:"var(--border-strong)",
  acc:"var(--accent)",
  ad:"var(--accent-dim)",
  ab2:"var(--accent-border)",
  t:"var(--text-primary)",
  s:"var(--text-secondary)",
  m:"var(--text-muted)",
  ta:"var(--text-accent)",
  ok:"var(--status-ok)",
  okb:"var(--status-ok-bg)",
  wn:"var(--status-warn)",
  wnb:"var(--status-warn-bg)",
  dn:"var(--status-danger)",
  dnb:"var(--status-danger-bg)",
};
