// ─── Time formatters ─────────────────────────────────────────────────────────

// Format seconds → "h:mm:ss" (when ≥ 1h) or "m:ss" (when < 1h).
// Always pads minutes/seconds inside the hour bucket so 1:01:27 reads correctly.
export function fmtHMS(secs) {
  if (secs == null || isNaN(secs)) return '—';
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

// Format minutes → "Xh Ym" (when ≥ 60min) or "Xm".
export function fmtHM(mins) {
  if (mins == null || isNaN(mins)) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

// Parse "h:mm:ss" or "m:ss" → seconds. Returns null on bad input.
export function parseTimeStr(v) {
  if (!v || v === '--') return null;
  const parts = v.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}
