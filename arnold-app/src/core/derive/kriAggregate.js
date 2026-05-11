// ─── KRI Timeframe Aggregator (Phase 4m.1) ─────────────────────────────────
// Helpers used by every TILE_METRICS entry's timeframes(ctx) function.
// Returns the three values that the Trend tab's KRITile renders:
//
//   { week, eightWk, ytd, weekDelta, eightWkDelta, ytdDelta, ytdMode }
//
//   week         — current Mon-Sun aggregate (avg or total, per metric mode)
//   eightWk      — last 8 completed weeks before this week, weekly avg
//                  (or, for 'total' mode metrics, sum-then-avg per week)
//   ytd          — depends on metric mode:
//                    'avg'   → average per week so far this year
//                    'total' → cumulative total since Jan 1
//   weekDelta    — sign of (week − previous week) for the trend arrow
//   eightWkDelta — sign of (week − eightWk) — "is this week better than the
//                  recent baseline?"
//   ytdDelta     — sign of (week − ytd weekly avg) — "is this week better
//                  than the year average?"
//   ytdMode      — passes through so the renderer knows whether to display
//                  "YTD 230 mi" (total) or "YTD avg 144 bpm" (avg)
//
// Why per-week aggregation everywhere: it keeps week / 8-week / YTD as
// directly comparable units. A bare YTD total for Avg HR would be
// nonsensical; a YTD weekly avg is the same kind of number as the week and
// 8-wk values, so the trend arrows mean something.
//
// Implementation note: this module does NOT know about specific metrics. It
// only takes a flat array of {date, value} samples, aggregates by ISO week,
// and computes the three timeframe numbers. The metric-specific logic
// (which collection to walk, how to extract the value) lives in each
// TILE_METRICS entry's timeframes(ctx) function, which then calls one of
// the helpers below.

// ─── Date helpers ──────────────────────────────────────────────────────────

const dayMs = 86400000;
const weekMs = 7 * dayMs;

/** Returns 'YYYY-MM-DD' for a Date in local time. */
export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses 'YYYY-MM-DD' to a Date at local midnight. */
export function parseDateStr(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Monday 00:00 of the week containing `d`. ISO week (Mon = start). */
export function startOfWeekMon(d = new Date()) {
  const x = new Date(d);
  const dow = x.getDay();
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Jan 1 of the year containing `d`. */
export function startOfYear(d = new Date()) {
  return new Date(d.getFullYear(), 0, 1);
}

// ─── Aggregation primitives ────────────────────────────────────────────────

/**
 * Aggregate a flat array of {date: 'YYYY-MM-DD', value: number} samples
 * over the three timeframes. Returns null fields gracefully when there's
 * not enough data.
 *
 * @param {Array<{date:string,value:number}>} samples
 *        Pre-extracted samples. value must be a finite number — the caller
 *        is responsible for filtering nulls/NaNs before passing in.
 * @param {Object} opts
 * @param {'avg'|'total'} opts.mode
 *        How to roll a week's samples up: 'avg' = mean of values that week,
 *        'total' = sum of values that week. Most rate metrics (HR, pace,
 *        cadence) use 'avg'. Volume metrics (miles, hours, kcal) use 'total'.
 * @param {'avg'|'total'} [opts.ytdMode]
 *        How to display YTD: 'avg' = avg per week so far, 'total' = sum
 *        since Jan 1. Defaults to opts.mode.
 * @param {Date} [opts.now]
 *        Override "today" for testing. Defaults to new Date().
 * @returns {{week:number|null, eightWk:number|null, ytd:number|null,
 *           weekDelta:number, eightWkDelta:number, ytdDelta:number,
 *           ytdMode:'avg'|'total'}}
 */
export function aggregateTimeframes(samples, opts) {
  const mode = opts?.mode || 'avg';
  const ytdMode = opts?.ytdMode || mode;
  const now = opts?.now || new Date();

  const weekStart = startOfWeekMon(now);
  const prevWeekStart = new Date(weekStart.getTime() - weekMs);
  const eightWksAgoStart = new Date(weekStart.getTime() - 8 * weekMs);
  const yearStart = startOfYear(now);
  const yearStartStr = toDateStr(yearStart);
  const weekStartStr = toDateStr(weekStart);
  const prevWeekStartStr = toDateStr(prevWeekStart);
  const eightWksAgoStartStr = toDateStr(eightWksAgoStart);

  // ── Bucket samples by week-start string ──
  const byWeek = new Map();
  for (const s of samples) {
    if (!s?.date || s.value == null || !Number.isFinite(s.value)) continue;
    const d = parseDateStr(s.date);
    if (!d) continue;
    const wStart = toDateStr(startOfWeekMon(d));
    if (!byWeek.has(wStart)) byWeek.set(wStart, []);
    byWeek.get(wStart).push(s.value);
  }

  const rollWeek = (wStart) => {
    const vals = byWeek.get(wStart) || [];
    if (!vals.length) return null;
    if (mode === 'total') return vals.reduce((s, v) => s + v, 0);
    if (mode === 'max') return Math.max(...vals);
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  // ── This week ──
  const week = rollWeek(weekStartStr);

  // ── Previous week (for week-over-week arrow) ──
  const prevWeek = rollWeek(prevWeekStartStr);

  // ── 8-week trailing avg (excluding current week) ──
  const eightWkBuckets = [];
  for (let i = 1; i <= 8; i++) {
    const wStart = toDateStr(new Date(weekStart.getTime() - i * weekMs));
    const v = rollWeek(wStart);
    if (v != null) eightWkBuckets.push(v);
  }
  const eightWk = eightWkBuckets.length
    ? eightWkBuckets.reduce((s, v) => s + v, 0) / eightWkBuckets.length
    : null;

  // ── 8-week trend series for the sparkline (oldest → newest) ──
  // Includes the current week as the rightmost point. Nulls preserved so
  // the sparkline can render gaps for missing weeks rather than imputing.
  const weeklyHistory = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = toDateStr(new Date(weekStart.getTime() - i * weekMs));
    weeklyHistory.push(rollWeek(wStart));
  }

  // ── YTD ──
  // Walk every week from Jan 1 (current year) up to and including this week.
  // For 'avg' mode: avg of weekly aggregates. For 'total' mode: sum of all
  // sample values since Jan 1 (cumulative).
  let ytd = null;
  if (ytdMode === 'total') {
    // Cumulative total — sum every sample dated >= Jan 1.
    let total = 0;
    let any = false;
    for (const s of samples) {
      if (!s?.date || s.value == null || !Number.isFinite(s.value)) continue;
      if (s.date >= yearStartStr) {
        total += s.value;
        any = true;
      }
    }
    ytd = any ? total : null;
  } else if (ytdMode === 'max') {
    // Year's biggest sample (e.g. longest run, peak power).
    let mx = -Infinity;
    let any = false;
    for (const s of samples) {
      if (!s?.date || s.value == null || !Number.isFinite(s.value)) continue;
      if (s.date >= yearStartStr) {
        if (s.value > mx) mx = s.value;
        any = true;
      }
    }
    ytd = any ? mx : null;
  } else {
    // Weekly avg — collect every week from Jan 1 to current week.
    const ytdBuckets = [];
    let cursor = startOfWeekMon(yearStart);
    while (cursor.getTime() <= weekStart.getTime()) {
      const wStart = toDateStr(cursor);
      const v = rollWeek(wStart);
      if (v != null) ytdBuckets.push(v);
      cursor = new Date(cursor.getTime() + weekMs);
    }
    ytd = ytdBuckets.length
      ? ytdBuckets.reduce((s, v) => s + v, 0) / ytdBuckets.length
      : null;
  }

  // ── Delta signs (for arrow direction) ──
  // sign = +1 (up), -1 (down), 0 (flat / no comparison data)
  const sign = (a, b) => {
    if (a == null || b == null) return 0;
    if (Math.abs(a - b) < 1e-9) return 0;
    return a > b ? 1 : -1;
  };
  const weekDelta = sign(week, prevWeek);
  const eightWkDelta = sign(week, eightWk);
  // For YTD-total mode, week-vs-ytd doesn't compare apples to apples
  // (week = one week, ytd = cumulative). Compare against ytd's implied
  // weekly avg instead — derive it on the fly.
  let ytdAvgPerWeek = ytd;
  if (ytdMode === 'total' && ytd != null) {
    const weeksElapsed = Math.max(
      1,
      Math.round((weekStart.getTime() - startOfWeekMon(yearStart).getTime()) / weekMs) + 1
    );
    ytdAvgPerWeek = ytd / weeksElapsed;
  }
  const ytdDelta = sign(week, ytdAvgPerWeek);

  // ── Carry-forward fallback (Phase 4o.trend.1) ──
  // On Monday morning a fresh ISO week is empty until the first sample
  // for the week lands (run synced, sleep recorded, meal logged). Without
  // a fallback, every "this week" tile reads "Awaiting data" even though
  // a complete picture sits one bucket over. We surface last week's value
  // alongside the live `week` so renderers can decide how to display it
  // (e.g. show last week's number with a "last wk" sublabel until live
  // data arrives). `weekIsFallback` makes that decision explicit.
  const weekFallback   = (week == null && prevWeek != null) ? prevWeek : null;
  const weekIsFallback = weekFallback != null;

  // ── Latest-sample fallback (Phase 4o.trend.3) ──
  // For sparse-cadence metrics (body fat, lean mass, BMI from periodic
  // Garmin Index readings; lab markers; one-off measurements), even last
  // week's bucket can be empty. Track the single most recent non-null
  // sample so the renderer can fall back further: week → last week →
  // latest reading. Carries the date so the UI can label it explicitly.
  let latestSampleVal = null, latestSampleDate = null;
  for (const s of samples) {
    if (!s?.date || s.value == null || !Number.isFinite(s.value)) continue;
    if (latestSampleDate == null || s.date > latestSampleDate) {
      latestSampleDate = s.date;
      latestSampleVal  = s.value;
    }
  }
  const latestSample = latestSampleVal != null
    ? { value: latestSampleVal, date: latestSampleDate }
    : null;

  return {
    week, eightWk, ytd, weekDelta, eightWkDelta, ytdDelta, ytdMode, weeklyHistory,
    weekFallback, weekIsFallback,
    latestSample,
  };
}

// ─── High-level helper for the common case ────────────────────────────────
// Given a collection in ctx and an extractor, build samples and aggregate.
// Most TILE_METRICS entries' timeframes(ctx) can be a one-liner using this.

/**
 * @param {Array} items — collection to aggregate (e.g. ctx.activities)
 * @param {Object} opts
 * @param {(item:any) => boolean} [opts.filter] — keep predicate
 * @param {(item:any) => string} [opts.dateField] — date string extractor;
 *        defaults to (i) => i.date
 * @param {(item:any) => number} opts.valueField — value extractor (returns
 *        null/NaN to skip the sample)
 * @param {'avg'|'total'} opts.mode
 * @param {'avg'|'total'} [opts.ytdMode]
 * @param {Date} [opts.now]
 */
export function timeframesFromCollection(items, opts) {
  const dateField = opts.dateField || ((i) => i?.date);
  const valueField = opts.valueField;
  const filter = opts.filter || (() => true);

  const samples = [];
  for (const it of (items || [])) {
    if (!filter(it)) continue;
    const date = dateField(it);
    const value = valueField(it);
    if (!date || value == null || !Number.isFinite(Number(value))) continue;
    samples.push({ date, value: Number(value) });
  }

  return aggregateTimeframes(samples, {
    mode: opts.mode,
    ytdMode: opts.ytdMode,
    now: opts.now,
  });
}

// ─── Formatting helpers for the renderer ──────────────────────────────────

/**
 * Format a numeric value for display in a KRITile. Lightweight rounding
 * based on magnitude — pace/HR get integers, % values get 1dp, ratios get 2dp.
 *
 * @param {number|null} v
 * @param {string} unit — 'mi','hrs','bpm','%','spm','min','/100','/5','g','mg',
 *                        'kcal','lb','ms','W','' (empty = unitless ratio)
 * @returns {string}
 */
export function formatKRIValue(v, unit) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  let s;
  if (unit === 'mi' || unit === 'hrs' || unit === 'lb') {
    s = abs >= 100 ? Math.round(v).toString() : v.toFixed(1);
  } else if (unit === '%' || unit === '/5') {
    s = v.toFixed(1);
  } else if (unit === '' || unit === ':1') {
    // Pace:HR ratio, ACWR, etc — 2 decimals so the trend is visible
    s = v.toFixed(2);
  } else {
    s = Math.round(v).toString();
  }
  return s;
}

/** Pace formatting helper: seconds → 'M:SS'. Used for pace-mode metrics. */
export function formatPaceSecs(secs) {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
