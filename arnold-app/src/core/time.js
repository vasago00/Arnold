// ─── ARNOLD time boundaries ──────────────────────────────────────────────────
// Canonical week / year / window helpers for the DCY readiness pipeline and
// every consumer that has to agree on "today", "this week", "this year".
//
// DESIGN RULES (from METRIC_OVERLAP_AUDIT.md):
//   R1 — A week is Monday 00:00 → Sunday 23:59 LOCAL TIME. Always.
//   R2 — Daily means today only; callers decide how to handle missing input.
//   R4 — Annual = year-to-date, pipeline shared across Start and EdgeIQ.
//
// All helpers operate on "YYYY-MM-DD" strings in LOCAL time and never touch
// UTC. Using toISOString() on a Date produces UTC which rolls over at midnight
// UTC, not local midnight — that's the UTC-rollover class of bug we've been
// hunting in earlier tasks, so this file deliberately never calls it.

// ─── Date ↔ string ───────────────────────────────────────────────────────────

/** Format a Date as local YYYY-MM-DD. No UTC, no timezone drift. */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Alias for ymd(new Date()) — used heavily in existing code as `localDate()`. */
export const localDate = () => ymd(new Date());

/**
 * Parse a YYYY-MM-DD string as a LOCAL-noon Date.
 * Noon (not midnight) dodges DST edge cases where the wall clock skips or
 * repeats a midnight. Every consumer in this module uses parseYmd so the
 * whole pipeline behaves identically on 2AM-spring-forward days.
 */
export function parseYmd(s) {
  if (!s || typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0);
}

/** Add `n` days to a YYYY-MM-DD; returns YYYY-MM-DD. Negative n goes back. */
export function addDays(dateStr, n) {
  const d = parseYmd(dateStr) || new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// ─── Week (R1: Mon–Sun) ──────────────────────────────────────────────────────

/**
 * Return the Monday of the week containing `dateStr`, as YYYY-MM-DD.
 * JS getDay() returns 0..6 with Sunday=0, so Mon-offset = (day + 6) % 7.
 */
export function startOfWeek(dateStr) {
  const d = parseYmd(dateStr) || new Date();
  const offset = (d.getDay() + 6) % 7; // 0 for Mon, 6 for Sun
  d.setDate(d.getDate() - offset);
  return ymd(d);
}

/** Sunday of the same week, as YYYY-MM-DD. */
export function endOfWeek(dateStr) {
  return addDays(startOfWeek(dateStr), 6);
}

/**
 * Enumerate every YYYY-MM-DD in the Mon–Sun week containing `dateStr`,
 * Monday first. Useful for weekly aggregates.
 */
export function weekDays(dateStr) {
  const mon = startOfWeek(dateStr);
  const out = [];
  for (let i = 0; i < 7; i++) out.push(addDays(mon, i));
  return out;
}

// ─── Year (R4: YTD) ──────────────────────────────────────────────────────────

/** Jan 1 of the year containing `dateStr`, as YYYY-MM-DD. */
export function yearStart(dateStr) {
  const d = parseYmd(dateStr) || new Date();
  return `${d.getFullYear()}-01-01`;
}

/** 1..366: ordinal day number in the year (Jan 1 = 1). */
export function dayOfYear(dateStr) {
  const d = parseYmd(dateStr) || new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1, 12, 0, 0, 0);
  return Math.round((d - jan1) / 86400000) + 1;
}

// ─── Window predicate ────────────────────────────────────────────────────────

/**
 * Inclusive membership: is `dateStr` in [startStr, endStr]?
 * String comparison is safe because YYYY-MM-DD sorts lexicographically.
 */
export function inWindow(dateStr, startStr, endStr) {
  if (!dateStr || !startStr || !endStr) return false;
  return dateStr >= startStr && dateStr <= endStr;
}

/**
 * Shorthand: is `dateStr` inside the Mon–Sun week containing `refDate`?
 * (Defaults refDate to today.)
 */
export function isThisWeek(dateStr, refDate) {
  const ref = refDate || localDate();
  return inWindow(dateStr, startOfWeek(ref), endOfWeek(ref));
}

/** Shorthand: is `dateStr` inside the calendar year of `refDate`? */
export function isThisYear(dateStr, refDate) {
  const ref = refDate || localDate();
  return inWindow(dateStr, yearStart(ref), `${(parseYmd(ref) || new Date()).getFullYear()}-12-31`);
}

// ─── Lookback enumerators ────────────────────────────────────────────────────

/**
 * Return the last `n` days ending at (and inclusive of) `refDate`,
 * NEWEST-FIRST. So lastNDays('2026-04-22', 7) →
 *   ['2026-04-22','2026-04-21', ..., '2026-04-16'].
 */
export function lastNDays(refDate, n) {
  const ref = refDate || localDate();
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDays(ref, -i));
  return out;
}

// ─── Stale-source helper (R5: 36h carve-out for body signals) ───────────────

/**
 * True if `sourceDateStr` is within `hours` of `refDate`'s local end-of-day.
 * Used to decide whether an HRV / RHR / sleep row is fresh enough to count
 * in today's DCY even if it's technically yesterday's date.
 */
export function withinHours(sourceDateStr, refDate, hours = 36) {
  const src = parseYmd(sourceDateStr);
  const ref = parseYmd(refDate || localDate());
  if (!src || !ref) return false;
  // Reference point: end-of-day at local 23:59 on refDate.
  const refEOD = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 23, 59, 59, 999);
  const deltaMs = refEOD - src;
  return deltaMs >= 0 && deltaMs <= hours * 3600 * 1000;
}
