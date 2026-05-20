// Expected Ranges & Metric Status Engine
// Phase 4r.intel.4 — conditions+fatigue-aware status engine.
// Replaces hardcoded threshold logic with single reasoning module.
//
// References:
//   - Daniels JT. Daniels' Running Formula, 4th ed.
//   - Friel J. The Triathlete's Training Bible.
//   - Seiler S. Polarized training literature.
//   - Galloway et al. Heat acclimatization / HR drift.
//   - ACSM Position Stand on Exercise & Fluid Replacement.
//   - Coggan A. ATL/CTL/TSB performance manager.

// Duration gate — sessions under 15 min are excluded from band lookup.
export const SHORT_SESSION_SEC = 15 * 60;

export const EXPECTED_RANGES = {
  easy_run: {
    avgHR_pctMax:  { range: [60, 75], direction: 'expected' },
    z2Pct:         { range: [55, 90], direction: 'higher-better' },
    z45Pct:        { range: [0,  8],  direction: 'lower-better'  },
    aerobicTE:     { range: [1.0, 2.5], direction: 'expected' },
    anaerobicTE:   { range: [0,   0.5], direction: 'lower-better' },
    cardiacDrift:  { range: [0,   5],   direction: 'lower-better' },
    hrRecovery1m:  { range: [30,  60],  direction: 'higher-better' },
    decoupling:    { range: [0,   5],   direction: 'lower-better' },
  },
  long_run: {
    avgHR_pctMax:  { range: [62, 78], direction: 'expected' },
    z45Pct:        { range: [0,  10], direction: 'lower-better' },
    aerobicTE:     { range: [2.0, 3.8], direction: 'expected' },
    anaerobicTE:   { range: [0,   0.8], direction: 'lower-better' },
    cardiacDrift:  { range: [0,   8],   direction: 'expected' },
    hrRecovery1m:  { range: [25,  50],  direction: 'higher-better' },
    decoupling:    { range: [0,   8],   direction: 'lower-better' },
  },
  tempo: {
    avgHR_pctMax:  { range: [80, 88], direction: 'expected' },
    z34Pct:        { range: [40, 75], direction: 'expected' },
    aerobicTE:     { range: [2.5, 4.0], direction: 'expected' },
    anaerobicTE:   { range: [0.5, 1.8], direction: 'expected' },
    decoupling:    { range: [0,   6],   direction: 'lower-better' },
    hrRecovery1m:  { range: [25,  50],  direction: 'higher-better' },
  },
  intervals: {
    avgHR_pctMax:  { range: [80, 90], direction: 'expected' },
    z45Pct:        { range: [20, 60], direction: 'expected' },
    aerobicTE:     { range: [3.0, 4.7], direction: 'expected' },
    anaerobicTE:   { range: [1.5, 3.5], direction: 'expected' },
    hrRecovery1m:  { range: [25,  55],  direction: 'higher-better' },
  },
  hiit: {
    avgHR_pctMax:  { range: [75, 92], direction: 'expected' },
    z45Pct:        { range: [10, 70], direction: 'expected' },
    aerobicTE:     { range: [2.5, 4.5], direction: 'expected' },
    anaerobicTE:   { range: [1.0, 3.5], direction: 'expected' },
    hrRecovery1m:  { range: [20,  50],  direction: 'higher-better' },
  },
  strength: {
    avgHR_pctMax:  { range: [50, 78], direction: 'expected' },
    z45Pct:        { range: [0,  35], direction: 'expected' },
    aerobicTE:     { range: [0.8, 2.8], direction: 'expected' },
    anaerobicTE:   { range: [0.3, 2.5], direction: 'expected' },
    hrRecovery1m:  { range: [20,  50],  direction: 'higher-better' },
  },
  mobility: {
    avgHR_pctMax:  { range: [40, 65], direction: 'expected' },
    z45Pct:        { range: [0,   5], direction: 'lower-better' },
    aerobicTE:     { range: [0,   1.5], direction: 'expected' },
    anaerobicTE:   { range: [0,   0.3], direction: 'lower-better' },
  },
  race: {
    avgHR_pctMax:  { range: [78, 93], direction: 'expected' },
    z45Pct:        { range: [15, 70], direction: 'expected' },
    aerobicTE:     { range: [3.0, 5.0], direction: 'expected' },
    anaerobicTE:   { range: [1.0, 3.5], direction: 'expected' },
    cardiacDrift:  { range: [0,   10],  direction: 'expected' },
    hrRecovery1m:  { range: [25,  60],  direction: 'higher-better' },
  },
  run: {
    avgHR_pctMax:  { range: [65, 85], direction: 'expected' },
    z2Pct:         { range: [30, 90], direction: 'expected' },
    z45Pct:        { range: [0,  35], direction: 'expected' },
    aerobicTE:     { range: [1.5, 4.0], direction: 'expected' },
    anaerobicTE:   { range: [0,   2.5], direction: 'expected' },
    cardiacDrift:  { range: [0,   8],   direction: 'lower-better' },
    hrRecovery1m:  { range: [25,  55],  direction: 'higher-better' },
    decoupling:    { range: [0,   7],   direction: 'lower-better' },
  },
};

export function heatAdjustment(tempC) {
  const z = { hrPct: 0, z45Pct: 0, aerobicTE: 0, anaerobicTE: 0, cardiacDrift: 0, hrRecovery1m: 0 };
  if (tempC == null || !Number.isFinite(tempC) || tempC <= 20) return z;
  const delta = tempC - 20;
  return {
    hrPct:        delta * 0.5,
    z45Pct:       tempC > 25 ? (tempC - 25) * 1.5 : 0,
    aerobicTE:    delta * 0.05,
    anaerobicTE:  delta * 0.04,
    cardiacDrift: delta * 0.3,
    hrRecovery1m: -delta * 0.8,
  };
}

export function humidityMultiplier(humidityPct, tempC) {
  if (humidityPct == null || tempC == null) return 1.0;
  if (tempC <= 20 || humidityPct <= 50) return 1.0;
  const extra = Math.min(0.30, ((humidityPct - 50) / 10) * 0.05);
  return 1.0 + extra;
}

// Compounding fatigue: prior sleep + ATL/CTL ratio + consecutive hard days.
export function fatigueAdjustment(fatigue) {
  const z = { hrPct: 0, z45Pct: 0, aerobicTE: 0, anaerobicTE: 0, cardiacDrift: 0, hrRecovery1m: 0 };
  if (!fatigue || typeof fatigue !== 'object') return z;
  let hrPct = 0, drift = 0, recoveryDelta = 0, anaerCeiling = 0;
  const sleep = fatigue.sleepScorePrev;
  if (typeof sleep === 'number' && Number.isFinite(sleep)) {
    if (sleep < 50) { hrPct += 3.0; drift += 1.5; recoveryDelta -= 5; }
    else if (sleep < 70) { hrPct += 1.5; drift += 0.8; recoveryDelta -= 3; }
  }
  const tss7 = Number(fatigue.rollingTSS7);
  const tss28 = Number(fatigue.rollingTSS28);
  if (Number.isFinite(tss7) && Number.isFinite(tss28) && tss28 > 0) {
    const ratio = (tss7 / 7) / (tss28 / 28);
    if (ratio > 1.5) { hrPct += 2.5; drift += 2.0; anaerCeiling -= 0.5; recoveryDelta -= 3; }
    else if (ratio > 1.3) { hrPct += 1.0; drift += 1.0; anaerCeiling -= 0.2; }
  }
  const cons = Number(fatigue.consecutiveHardDays);
  if (Number.isFinite(cons) && cons >= 2) { hrPct += 1.5; drift += 0.5; }
  return { hrPct, z45Pct: 0, aerobicTE: 0, anaerobicTE: anaerCeiling, cardiacDrift: drift, hrRecovery1m: recoveryDelta };
}

function blendWithBaseline(populationRange, baseline) {
  if (!baseline || typeof baseline.n !== 'number' || baseline.n < 1) return populationRange;
  if (!Number.isFinite(baseline.mean) || !Number.isFinite(baseline.std)) return populationRange;
  const popMin = populationRange[0], popMax = populationRange[1];
  const personalMin = baseline.mean - 1.5 * baseline.std;
  const personalMax = baseline.mean + 1.5 * baseline.std;
  const w = Math.min(1, baseline.n / 20);
  return [popMin * (1 - w) + personalMin * w, popMax * (1 - w) + personalMax * w];
}

export function metricStatus(metricId, value, ctx) {
  ctx = ctx || {};
  if (value == null || !Number.isFinite(value)) {
    return { status: 'neutral', explanation: null, expected: null };
  }
  const durSec = (ctx.durationSec != null) ? ctx.durationSec : ctx.durationSecs;
  if (typeof durSec === 'number' && Number.isFinite(durSec) && durSec < SHORT_SESSION_SEC) {
    return { status: 'neutral', explanation: 'Session too short for band lookup', expected: null };
  }
  const family = ctx.family || 'run';
  const familyRanges = EXPECTED_RANGES[family] || EXPECTED_RANGES.run;
  const rangeDef = familyRanges[metricId];
  if (!rangeDef) return { status: 'neutral', explanation: null, expected: null };
  let min = rangeDef.range[0], max = rangeDef.range[1];
  const blended = blendWithBaseline([min, max], ctx.baseline);
  min = blended[0]; max = blended[1];
  const tempC = ctx.conditions && ctx.conditions.tempC;
  const humidityPct = ctx.conditions && (ctx.conditions.humidityPct != null ? ctx.conditions.humidityPct : ctx.conditions.humidity);
  const heat = heatAdjustment(tempC);
  const humMult = humidityMultiplier(humidityPct, tempC);
  const fat = fatigueAdjustment(ctx.fatigue);
  const adjustments = {
    avgHR_pctMax:  { both: heat.hrPct * humMult + fat.hrPct },
    z2Pct:         { max: -heat.z45Pct * humMult },
    z45Pct:        { max: heat.z45Pct * humMult + fat.z45Pct },
    aerobicTE:     { max: heat.aerobicTE * humMult + fat.aerobicTE },
    anaerobicTE:   { max: heat.anaerobicTE * humMult + fat.anaerobicTE },
    cardiacDrift:  { max: heat.cardiacDrift * humMult + fat.cardiacDrift },
    hrRecovery1m:  { min: heat.hrRecovery1m * humMult + fat.hrRecovery1m },
    decoupling:    { max: heat.cardiacDrift * humMult + fat.cardiacDrift },
  };
  const adj = adjustments[metricId] || {};
  if (adj.both != null) { min += adj.both; max += adj.both; }
  if (adj.min  != null) { min += adj.min; }
  if (adj.max  != null) { max += adj.max; }
  const direction = rangeDef.direction || 'expected';
  let status = 'expected';
  if (direction === 'lower-better') {
    if (value > max * 1.4) status = 'concern';
    else if (value > max)  status = 'mild';
  } else if (direction === 'higher-better') {
    if (value < min * 0.6) status = 'concern';
    else if (value < min)  status = 'mild';
  } else {
    const span = Math.max(1, max - min);
    const overshoot = value > max ? (value - max) / span : 0;
    const undershoot = value < min ? (min - value) / span : 0;
    const dev = Math.max(overshoot, undershoot);
    if (dev > 0.6) status = 'concern';
    else if (dev > 0) status = 'mild';
  }
  let explanation = null;
  if (status !== 'expected') {
    const heatNote = (tempC != null && tempC > 25) ? ' (adjusted for ' + Math.round(tempC) + 'C)' : '';
    const fatNote = (fat.hrPct > 0) ? ' (fatigue-adjusted)' : '';
    const baselineNote = (ctx.baseline && ctx.baseline.n >= 5) ? ' . your typical range' : ' . population norm';
    const rangeStr = formatRange(min) + '-' + formatRange(max);
    if (direction === 'lower-better' && value > max) {
      explanation = 'Above expected ' + rangeStr + heatNote + fatNote + baselineNote;
    } else if (direction === 'higher-better' && value < min) {
      explanation = 'Below expected ' + rangeStr + heatNote + fatNote + baselineNote;
    } else {
      explanation = 'Outside expected ' + rangeStr + heatNote + fatNote + baselineNote;
    }
  }
  return { status, explanation, expected: [min, max] };
}

function formatRange(n) {
  if (Math.abs(n) >= 100) return String(Math.round(n));
  if (Math.abs(n) >= 10)  return n.toFixed(0);
  return n.toFixed(1);
}

export function statusColor(status, categoryColor) {
  switch (status) {
    case 'expected': return categoryColor;
    case 'mild':     return '#fbbf24';
    case 'concern':  return '#f87171';
    case 'neutral':  return categoryColor;
    default:         return categoryColor;
  }
}

export function paintMetric(metricId, value, categoryColor, ctx) {
  const result = metricStatus(metricId, value, ctx);
  return {
    color: statusColor(result.status, categoryColor),
    status: result.status,
    explanation: result.explanation,
    expected: result.expected,
  };
}
