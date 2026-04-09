// ─── ARNOLD Schemas ──────────────────────────────────────────────────────────
// Lightweight per-collection field validators. Pure functions, no deps.
// Each schema returns { valid: bool, errors: string[], cleaned: any }
//
// Philosophy: be liberal in what we accept (Garmin renames columns) but
// reject rows that are structurally broken (no date, no type) so they can't
// poison downstream caches.

const isStr = v => typeof v === 'string' && v.length > 0;
const isNum = v => typeof v === 'number' && !isNaN(v);
const isISODate = v => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v.slice(0, 10));

function row(spec, obj) {
  const errors = [];
  const cleaned = { ...obj };
  for (const [key, rule] of Object.entries(spec)) {
    const v = obj?.[key];
    if (rule.required && (v == null || v === '')) {
      errors.push(`missing ${key}`);
      continue;
    }
    if (v == null) continue;
    if (rule.type === 'date' && !isISODate(v)) errors.push(`bad date ${key}=${v}`);
    if (rule.type === 'number' && !isNum(v) && v !== null) {
      const n = parseFloat(v);
      if (isNaN(n)) errors.push(`bad number ${key}=${v}`);
      else cleaned[key] = n;
    }
    if (rule.type === 'string' && !isStr(v)) errors.push(`bad string ${key}=${v}`);
  }
  return { valid: errors.length === 0, errors, cleaned };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const SCHEMAS = {
  activities: {
    date:         { type: 'date',   required: true  },
    activityType: { type: 'string', required: true  },
    distanceMi:   { type: 'number', required: false },
    durationSecs: { type: 'number', required: false },
    movingTimeSecs:{ type: 'number', required: false },
    calories:     { type: 'number', required: false },
    avgHR:        { type: 'number', required: false },
    maxHR:        { type: 'number', required: false },
    avgPaceRaw:   { type: 'string', required: false },
    totalReps:    { type: 'number', required: false },
    setsCount:    { type: 'number', required: false },
    bodyBatteryDrain:{ type: 'number', required: false },
  },
  hrv: {
    date:         { type: 'date',   required: true  },
    overnightHRV: { type: 'number', required: false },
    status:       { type: 'string', required: false },
  },
  sleep: {
    date:            { type: 'date',   required: true  },
    durationMinutes: { type: 'number', required: false },
    sleepScore:      { type: 'number', required: false },
  },
  weight: {
    date:    { type: 'date',   required: true  },
    weight:  { type: 'number', required: false },
    bodyFat: { type: 'number', required: false },
  },
  cronometer: {
    date:     { type: 'date',   required: true  },
    calories: { type: 'number', required: false },
    protein:  { type: 'number', required: false },
    carbs:    { type: 'number', required: false },
    fat:      { type: 'number', required: false },
  },
  goals: {
    // Goals are a single object, not an array — validated as a flat dict
    weeklyRunDistanceTarget:  { type: 'number', required: false },
    annualRunDistanceTarget:  { type: 'number', required: false },
    annualWorkoutsTarget:     { type: 'number', required: false },
    weeklyStrengthTarget:     { type: 'number', required: false },
    weeklyStrengthMinutesTarget:{ type: 'number', required: false },
    weeklyTimeTargetHrs:      { type: 'number', required: false },
    targetRacePace:           { type: 'string', required: false },
    targetWeight:             { type: 'number', required: false },
    targetBodyFat:            { type: 'number', required: false },
    dailyCalorieTarget:       { type: 'number', required: false },
    dailyProteinTarget:       { type: 'number', required: false },
    dailyCarbTarget:          { type: 'number', required: false },
    dailyFatTarget:           { type: 'number', required: false },
    targetSleepHours:         { type: 'number', required: false },
    maxHR:                    { type: 'number', required: false },
  },
  planner: {
    // Planner is keyed by ISO week → array of 7 day entries
    weekStart: { type: 'date',   required: true  },
  },
};

// ─── Validate a single row ────────────────────────────────────────────────────
export function validateRow(collection, obj) {
  const spec = SCHEMAS[collection];
  if (!spec) return { valid: true, errors: [], cleaned: obj };
  return row(spec, obj);
}

// ─── Validate an array, returning kept + rejected ────────────────────────────
export function validateArray(collection, arr) {
  if (!Array.isArray(arr)) return { kept: [], rejected: [], coverage: {} };
  const kept = [];
  const rejected = [];
  const fieldHits = {};
  for (const item of arr) {
    const { valid, errors, cleaned } = validateRow(collection, item);
    if (valid) {
      kept.push(cleaned);
      // Track field coverage for diagnostics
      for (const [k, v] of Object.entries(cleaned)) {
        if (v != null && v !== '') fieldHits[k] = (fieldHits[k] || 0) + 1;
      }
    } else {
      rejected.push({ item, errors });
    }
  }
  const coverage = {};
  for (const [k, n] of Object.entries(fieldHits)) {
    coverage[k] = { count: n, pct: arr.length ? Math.round((n / arr.length) * 100) : 0 };
  }
  return { kept, rejected, coverage };
}
