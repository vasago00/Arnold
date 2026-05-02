// ─── Local-time date utilities ──────────────────────────────────────────────
// Single source of truth for date parsing across the app. JavaScript's
// `new Date('YYYY-MM-DD')` constructor parses bare ISO date strings as UTC
// midnight, which renders one day earlier in any timezone west of UTC. This
// has bitten us repeatedly: race dates display as the day before, weekly
// boundaries straddle days, history filters drop edge entries.
//
// POLICY: Every place that turns a stored date string into a Date object
// MUST use parseLocalDate(). Bare `new Date(r.date)` is forbidden anywhere
// it will be displayed or compared against `new Date()` (which is local).
//
// The trick: anchor at noon LOCAL time. Even DST transitions can't push
// noon across a day boundary, so `getDate()` / `toLocaleDateString()` /
// comparisons against `Date.now()` all behave intuitively.

/**
 * Parse a date input into a local-time Date object. Accepts:
 *   - "YYYY-MM-DD"           → local noon on that calendar date
 *   - "YYYY-MM-DDTHH:MM..."  → passed through (assumed already local-aware)
 *   - "M/D/YYYY" or "MM/DD/YYYY" → local noon on that calendar date
 *   - Date instance          → returned as-is
 *   - falsy                  → null
 * Returns null on unparseable input.
 */
export function parseLocalDate(input) {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') return null;
  const s = input.trim();
  // Already has explicit time component — let the JS parser handle it.
  if (/T\d{2}:/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Bare ISO date YYYY-MM-DD (or with extra trailing junk we trim)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
  }
  // US format M/D/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const [, m, d, y] = us;
    return new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
  }
  // Last resort: trust the JS parser
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Format a date input as "YYYY-MM-DD" in LOCAL time. Inverse of parseLocalDate
 * for the round-trip case. Returns null on unparseable input.
 */
export function toLocalDateStr(input) {
  const d = parseLocalDate(input);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the Monday (00:00 local) of the week containing `ref` (default now).
 * Sunday is treated as belonging to the PREVIOUS week's Monday — matching the
 * European/ISO convention the app uses everywhere.
 */
export function startOfWeekMonday(ref = new Date()) {
  const d = new Date(ref);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns midnight (00:00 local) on `ref` (default now). Useful for "today
 * or later" filters that need to include events scheduled for today itself.
 */
export function startOfDay(ref = new Date()) {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Days between two date inputs, ignoring time-of-day. Positive when `b` is
 * after `a`. Both inputs run through parseLocalDate.
 */
export function daysBetween(a, b) {
  const da = parseLocalDate(a);
  const db = parseLocalDate(b);
  if (!da || !db) return null;
  const aMid = new Date(da); aMid.setHours(0, 0, 0, 0);
  const bMid = new Date(db); bMid.setHours(0, 0, 0, 0);
  return Math.round((bMid - aMid) / 86400000);
}
