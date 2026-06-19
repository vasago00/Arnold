// Metric registry — ONE definition per metric for how it is FORMATTED and
// LABELLED on screen. This is the presentation analogue of the value-SoT work
// in METRIC_OVERLAP_AUDIT: that gave each metric one resolver + one window;
// this gives each metric one formatter, one label (full/short), one tier-color,
// one tooltip. See docs/PRESENTATION_LAYER.md.
//
// IMPORTANT: this layer FORMATS pre-resolved values — it does not recompute
// them. Callers pass a "bag" of already-computed session values (the same
// objects the hero already builds: runMetrics, strengthMetrics, ef30Avg) and
// each entry's select(bag) plucks what it needs and returns a tile descriptor
// { id, v, label:{full,short}, sub, subColor, tooltip } or null when absent.
//
// Centralizing the run IF/EF tier logic here kills the duplication that used to
// live inline in BOTH the web Daily hero and the mobile Play hero (the source
// of the "do reps/tempo wrap?" / drift problems).

import { STATUS } from '../../theme/tokens.js';

// Tier color tokens — Phase 0.1: sourced from the single STATUS token set
// (src/theme/tokens.js). Rendered values are preserved (this registry's "over"
// is the high-tier red #f87171 = tokens STATUS.bad, not the deep-red ceiling).
const COLOR = {
  good: STATUS.good,   // #4ade80
  warn: STATUS.warn,   // #fbbf24
  hot:  STATUS.hot,    // #fb923c
  over: STATUS.bad,    // #f87171 (preserved)
  muted: 'var(--text-muted)',
  sec:   'var(--text-secondary)',
  prim:  'var(--text-primary)',
};

// IF (intensity factor) → effort tier word + color. Mirrors the previous inline
// logic in both heroes exactly.
function ifTier(IF) {
  if (IF == null)     return { tier: '—',         color: COLOR.muted };
  if (IF < 0.65)      return { tier: 'Easy',      color: COLOR.good };
  if (IF < 0.80)      return { tier: 'Aerobic',   color: COLOR.good };
  if (IF < 0.92)      return { tier: 'Tempo',     color: COLOR.warn };
  if (IF < 1.00)      return { tier: 'Threshold', color: COLOR.hot };
  return                     { tier: 'VO2/Race',  color: COLOR.over };
}

// EF (efficiency factor) vs 30-day baseline → verdict + color. One unified
// wording (was "↑ X% vs 30d avg" on web, "↑ X%" on mobile — now one form).
function efVerdict(EF, ef30Avg) {
  if (EF == null)               return { sub: 'needs HR',  color: COLOR.muted };
  if (!ef30Avg)                 return { sub: 'baseline',  color: COLOR.muted };
  const pct = (EF - ef30Avg) / ef30Avg;
  if (pct >= 0.06)  return { sub: `↑ ${Math.round(pct * 100)}% vs 30d`,            color: COLOR.good };
  if (pct <= -0.06) return { sub: `↓ ${Math.round(Math.abs(pct) * 100)}% vs 30d`, color: COLOR.warn };
  return                   { sub: '≈ 30d avg',                                     color: COLOR.sec };
}

const setsLine = sm => (sm.setsCount && sm.totalReps) ? `${sm.setsCount} sets · ${sm.totalReps} reps` : '';

export const METRICS = {
  // ── Run primary (session quality) ──
  pace: {
    label: { full: 'Pace', short: 'Pace' },
    select: b => {
      const r = b.runMetrics;
      if (!r) return null;
      return { v: r.ngpPace || '—', sub: 'graded', subColor: COLOR.muted };
    },
  },
  effortIF: {
    label: { full: 'Effort', short: 'Effort' },
    select: b => {
      const r = b.runMetrics;
      if (!r) return null;
      const IF = r.intensityFactor;
      const { tier, color } = ifTier(IF);
      return {
        v: IF ?? '—', sub: tier, subColor: color,
        tooltip: IF == null ? 'Effort needs HR or pace vs threshold.'
          : r.ifSource === 'hr'
            ? `IF ${IF} = ${Math.round(IF * 100)}% of threshold HR (HR-based — your easy pace ran faster than your effort).`
            : `IF ${IF} = ${Math.round(IF * 100)}% of threshold pace (pace-based — set max HR in profile to switch to HR).`,
      };
    },
  },
  efficiency: {
    label: { full: 'Efficiency', short: 'Effcy' },
    select: b => {
      const r = b.runMetrics;
      if (!r) return null;
      const EF = r.efficiencyFactor;
      const { sub, color } = efVerdict(EF, b.ef30Avg);
      return {
        v: EF ?? '—', sub, subColor: color,
        tooltip: b.ef30Avg
          ? `Efficiency = pace ÷ HR. Today ${EF}, 30-day avg ${b.ef30Avg.toFixed(2)}. Rising over weeks at the same effort = aerobic engine improving.`
          : 'Efficiency = pace ÷ HR. Need ≥3 past runs with HR to compare to your baseline.',
      };
    },
  },

  // ── Cycling primary (session quality) ──
  power: {
    label: { full: 'Power', short: 'Power' },
    select: b => {
      const c = b.cyclingMetrics;
      if (!c || !(c.avgPowerW > 0)) return null;
      return {
        v: `${c.avgPowerW}W`, sub: c.normalizedPower ? `${c.normalizedPower}W NP` : 'avg', subColor: COLOR.muted,
        tooltip: c.normalizedPower
          ? `Average ${c.avgPowerW}W · normalized ${c.normalizedPower}W (NP weights surges harder than a flat average).`
          : `Average power ${c.avgPowerW}W.`,
      };
    },
  },
  cyclingEffort: {
    label: { full: 'Effort', short: 'Effort' },
    select: b => {
      const c = b.cyclingMetrics;
      if (!c) return null;
      if (c.intensityFactor != null) {
        const { tier, color } = ifTier(c.intensityFactor);
        return { v: c.intensityFactor, sub: tier, subColor: color, tooltip: `IF ${c.intensityFactor} = NP ÷ FTP (power-based).` };
      }
      if (c.hrPctMax != null) {
        const pct = Math.round(c.hrPctMax * 100);
        const { tier, color } = ifTier(c.hrPctMax); // same bands applied to HR %-of-max
        return { v: `${pct}%`, sub: tier, subColor: color, tooltip: `${pct}% of max HR (HR-based — set FTP watts in profile for a power IF).` };
      }
      return { v: '—', sub: 'needs power/HR', subColor: COLOR.muted };
    },
  },
  cyclingEff: {
    label: { full: 'Efficiency', short: 'Effcy' },
    select: b => {
      const c = b.cyclingMetrics;
      if (!c || c.efficiency == null) return null;
      return {
        v: c.efficiency, sub: 'W/bpm', subColor: COLOR.sec,
        tooltip: `Power per heartbeat (avg power ÷ avg HR = ${c.efficiency}). Rising at the same HR over weeks = the aerobic engine improving.`,
      };
    },
  },
  cyclingLoad: {
    label: { full: 'Load', short: 'Load' },
    select: b => {
      const c = b.cyclingMetrics;
      if (!c || c.tss == null) return null;
      return {
        v: Math.round(c.tss), sub: 'rTSS', subColor: COLOR.muted,
        tooltip: `Session training load (${Math.round(c.tss)} rTSS). ${c.intensityFactor != null ? 'Power-based' : 'HR-based'} — duration × intensity². Same load the readiness gauge reads.`,
      };
    },
  },
  cyclingAvgHR: {
    label: { full: 'Avg HR', short: 'HR' },
    select: b => {
      const c = b.cyclingMetrics;
      if (!c || !(c.avgHR > 0)) return null;
      return {
        v: c.avgHR, sub: 'bpm', subColor: COLOR.muted,
        tooltip: c.maxHR > 0 ? `Average heart rate ${c.avgHR} bpm (peak ${c.maxHR}).` : `Average heart rate ${c.avgHR} bpm.`,
      };
    },
  },

  // ── Universal session metrics (hero right rail — same on EVERY activity) ──
  // These read b.session (a generic per-day summary), not a sport-specific bag,
  // so the 3 tiles right of the speedometer never change shape by discipline.
  sessEffort: {
    // "HR Effort" — the MEASURED effort (avg HR vs max). Distinct from RPE
    // (perceived effort) shown on the card; the two are complementary, and a gap
    // between them is itself a signal (e.g. a weight vest feels harder than HR).
    label: { full: 'HR Effort', short: 'HR Eff' },
    select: b => {
      const s = b.session;
      if (!s || s.effortPct == null) return null;
      const pct = Math.round(s.effortPct * 100);
      const { tier, color } = ifTier(s.effortPct); // same Easy/Aerobic/Tempo/… bands
      return { v: `${pct}%`, sub: tier, subColor: color, tooltip: `${pct}% of max HR — MEASURED session effort. (Perceived effort/RPE is logged separately on the card.)` };
    },
  },
  sessAvgHR: {
    label: { full: 'Avg HR', short: 'HR' },
    select: b => {
      const s = b.session;
      if (!s || !(s.avgHR > 0)) return null;
      return { v: s.avgHR, sub: 'bpm', subColor: COLOR.muted, tooltip: s.maxHR > 0 ? `Average heart rate ${s.avgHR} bpm (peak ${s.maxHR}).` : `Average heart rate ${s.avgHR} bpm.` };
    },
  },
  sessCalories: {
    label: { full: 'Calories', short: 'Cals' },
    select: b => {
      const s = b.session;
      if (!s || !(s.calories > 0)) return null;
      return { v: s.calories, sub: 'kcal', subColor: COLOR.muted, tooltip: `Energy burned across today's session(s): ${s.calories} kcal.` };
    },
  },

  // ── Strength / hybrid primary (session quality) ──
  density: {
    label: { full: 'Density', short: 'Dens' },
    select: b => {
      const sm = b.strengthMetrics;
      if (!sm || sm.density == null) return null;
      return {
        v: sm.density, sub: sm.densityUnit || 'volume/min', subColor: COLOR.muted,
        tooltip: sm.densityUnit === 'lb/min'
          ? `Tonnage per minute (sets × reps × weight ÷ duration). ${setsLine(sm)}`
          : sm.densityUnit === 'reps/min'
            ? `Reps per minute — fallback when no strength template matches this session. ${setsLine(sm)} Add a template in Workouts to upgrade to lb/min.`
            : 'No volume data available for this session.',
      };
    },
  },
  workRest: {
    label: { full: 'Work:Rest', short: 'W:R' },
    select: b => {
      const sm = b.strengthMetrics;
      if (!sm || sm.wr == null) return null;
      return {
        v: sm.wr, sub: sm.wrTier || 'no lap data', subColor: sm.wrColor || COLOR.muted,
        tooltip: sm.wr
          ? `Work:Rest ratio ${sm.wr} — ${sm.wrTier} energy system. >1:5 = power/phosphagen, 1:1.5–5 = hypertrophy/glycolytic, <1:1.5 = endurance/oxidative.`
          : 'Work:Rest ratio needs typed set/rest segments from the FIT — older watches without lap-button discipline can\'t supply this.',
      };
    },
  },
  effortPct: {
    label: { full: 'Effort', short: 'Effort' },
    select: b => {
      const sm = b.strengthMetrics;
      if (!sm || sm.effortPct == null) return null;
      return {
        v: sm.effortPct, sub: sm.effortTier || 'needs HR', subColor: sm.effortColor || COLOR.muted,
        tooltip: sm.effortPct
          ? `Avg HR as percent of max HR. ${sm.effortTier} zone — same tiering as run Effort so the colour reads the same across modalities.`
          : 'Effort needs avg HR + a maxHR estimate. Profile maxHR not set.',
      };
    },
  },
};

// Resolve an ordered list of metric ids against the value bag → array of tile
// descriptors (absent metrics dropped). Each descriptor carries its id + label.
export function selectMetrics(ids, bag) {
  if (!ids || !ids.length) return [];
  return ids
    .map(id => {
      const m = METRICS[id];
      if (!m) return null;
      const d = m.select(bag);
      return d ? { id, label: m.label, ...d } : null;
    })
    .filter(Boolean);
}
