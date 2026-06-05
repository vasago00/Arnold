// EdgeIQ driver-rail registry — ONE definition per EdgeIQ signal (label, color
// type, formatter, sub-text, value/history selection). The web EdgeIQ rail used
// to hand-write each <MiniStat label=… value=… fmt=… sub=… type=…/> inline; this
// moves that per-signal formatting into a single source of truth and makes the
// rail a declarative spec. See docs/PRESENTATION_LAYER.md.
//
// This layer FORMATS pre-resolved values: the EdgeIQ render builds a `bag` of
// already-computed values + sparkline histories + helpers, and each signal's
// select(bag) plucks what it needs. resolveEdgeStat(id, bag) returns the prop
// object for the existing <MiniStat> renderer (unchanged).
//
// `type` drives MiniStat's status color; `tier` ('domain' | 'driver') drives its
// sizing; `valuePx` overrides value font for text-status tiles (e.g. Glycogen).
// When a signal's DISPLAY differs from its numeric value (Glycogen shows a word,
// Sleep shows "7h" vs a score), select returns `display` and resolveEdgeStat
// wraps it as a constant fmt so the numeric `value` still drives the color.

export const EDGE_SIGNALS = {
  // ── Domain scores (tier: domain) ──
  domainActivity:  { label: 'Activity',  tier: 'domain', select: b => ({ value: b.domains?.activity,  history: b.hist.activity  }) },
  domainNutrition: { label: 'Nutrition', tier: 'domain', select: b => ({ value: b.domains?.nutrition, history: b.hist.nutrition }) },
  domainBody:      { label: 'Body',      tier: 'domain', select: b => ({ value: b.domains?.body,      history: b.hist.body      }) },

  // ── Activity drivers ──
  acwr: {
    label: 'ACWR', type: 'acwr', fmt: v => v.toFixed(2),
    select: b => ({
      value: b.acwrToday?.ratio, history: b.hist.acwr,
      sub: b.acwrToday?.ratio != null
        ? (b.acwrToday.ratio > 1.5 ? 'high risk' : b.acwrToday.ratio > 1.3 ? 'over-reach' : b.acwrToday.ratio < 0.8 ? 'under-load' : 'in zone')
        : 'no data',
    }),
  },
  rtssToday: {
    label: 'rTSS today', type: 'rtss',
    select: b => ({ value: b.todayRTSS, history: b.hist.rtss, sub: b.rtssBand(b.todayRTSS).label }),
  },
  weeklyLoad: {
    label: 'Weekly load', type: 'load', fmt: v => `${v}`,
    select: b => ({
      value: b.weeklyLoadVal, history: b.hist.load,
      sub: b.acwrToday?.chronicLoad ? `vs ${b.acwrToday.chronicLoad} avg` : '7-day rTSS',
    }),
  },

  // ── Nutrition drivers ──
  calLeft: {
    label: 'Cal left', type: 'fuel', fmt: v => `${v}`,
    select: b => ({ value: b.calRemaining, history: b.hist.calLeft, sub: `/${b.calTarget}` }),
  },
  proteinLeft: {
    label: 'Protein left', type: 'fuel', fmt: v => `${v}g`,
    select: b => ({ value: b.proRemaining, history: b.hist.proLeft, sub: `/${b.proTarget}g` }),
  },
  glycogen: {
    label: 'Glycogen', type: 'glycogen', valuePx: 12,
    select: b => ({
      value: b.glycoPct,
      display: b.glyco?.status ? b.glyco.status.charAt(0).toUpperCase() + b.glyco.status.slice(1) : '—',
      sub: b.glyco && b.glyco.need24h > 0
        ? `${b.glyco.supplied24h}/${b.glyco.need24h}g carbs`
        : (b.glyco?.status === 'insufficient' ? 'no training load' : 'no data'),
    }),
  },

  // ── Body drivers ──
  hrv: {
    label: 'HRV', type: 'hrv', fmt: v => `${v}ms`,
    select: b => ({
      value: b.latestHrv, history: b.hist.hrv,
      sub: b.latestHrv != null ? (b.latestHrv >= 40 ? 'recovered' : b.latestHrv >= 30 ? 'borderline' : 'strained') : 'no data',
    }),
  },
  sleep: {
    label: 'Sleep', type: 'sleep',
    select: b => ({
      value: b.sleepHrs != null ? b.sleepHrs : b.sleepScore,
      history: b.hist.sleepHrs,
      display: b.sleepHrs != null ? `${b.sleepHrs}h` : (b.sleepScore != null ? `${b.sleepScore}` : '—'),
      sub: b.sleepHrs != null && b.sleepScore != null ? `score ${b.sleepScore}`
        : b.sleepHrs != null ? 'hours slept'
        : b.sleepScore != null ? 'sleep score' : 'no data',
    }),
  },
  weight: {
    label: 'Weight', type: 'weight', fmt: v => `${v.toFixed(1)}`,
    select: b => ({
      value: b.curWeight, history: b.hist.weight,
      sub: b.curWeight != null ? `${(b.curWeight - b.targetWt) > 0 ? '+' : ''}${(b.curWeight - b.targetWt).toFixed(1)} vs ${b.targetWt}` : 'no data',
    }),
  },
};

// Resolve one signal id → the prop object for <MiniStat>. `display` (when the
// shown text differs from the numeric color-driving value) becomes a constant
// fmt so the existing renderer is untouched.
export function resolveEdgeStat(id, bag) {
  const s = EDGE_SIGNALS[id];
  if (!s) return null;
  const r = s.select(bag);
  return {
    label: s.label,
    type: s.type,
    tier: s.tier,
    valuePx: s.valuePx,
    value: r.value,
    sub: r.sub,
    history: r.history,
    fmt: r.display != null ? () => r.display : s.fmt,
  };
}

// EDGE_RAIL — the declarative driver-rail layout. `sep` rows render the vertical
// separator; the trailing Action+Race column stays inline in Arnold.jsx because
// its tiles carry bespoke JSX (the ✓ stamp + race card).
export const EDGE_RAIL = [
  { flexWeight: 3, metrics: ['domainActivity', 'domainNutrition', 'domainBody'] },
  { sep: true },
  { flexWeight: 3, bracket: 'Activity',  color: '#60a5fa', metrics: ['acwr', 'rtssToday', 'weeklyLoad'] },
  { flexWeight: 3, bracket: 'Nutrition', color: '#4ade80', metrics: ['calLeft', 'proteinLeft', 'glycogen'] },
  { flexWeight: 3, bracket: 'Body',      color: '#22d3ee', metrics: ['hrv', 'sleep', 'weight'] },
];
