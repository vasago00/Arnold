// ─── ARNOLD Core Principles Engine ───────────────────────────────────────────
// Deterministic scoring — no AI. Runs against stored data, returns structured assessment.

export const PRINCIPLES = {
  vo2max:      { label: 'Cardio fitness',        target: 55,   current: null, unit: 'ml/kg/min', weight: 0.20 },
  bodyFat:     { label: 'Body composition',      target: 16.7, current: 24.7, unit: '%',         weight: 0.20, lowerIsBetter: true },
  visceralFat: { label: 'Visceral fat',          target: 0.60, current: 1.29, unit: 'lbs',       weight: 0.15, lowerIsBetter: true },
  leanMass:    { label: 'Lean mass',             target: 138,  current: 134,  unit: 'lbs',       weight: 0.15 },
  hrv:         { label: 'Recovery (HRV)',        target: 65,   current: null, unit: 'ms',        weight: 0.10 },
  sleep:       { label: 'Sleep quality',         target: 7.5,  current: null, unit: 'hrs',       weight: 0.10 },
  nutrition:   { label: 'Nutrition adherence',   target: 2200, current: null, unit: 'kcal',      weight: 0.10 },
};

// Status thresholds: distance from target as fraction of target
// optimal = ≤5%, on-track = ≤15%, needs-work = ≤30%, critical = >30%
export function scorePrinciple(key, currentValue) {
  const p = PRINCIPLES[key];
  if (!p || currentValue == null) return { score: null, delta: null, status: 'unknown' };

  const current = parseFloat(currentValue);
  if (isNaN(current)) return { score: null, delta: null, status: 'unknown' };

  const target = p.target;
  // delta: positive = moving in the good direction
  const delta = p.lowerIsBetter ? target - current : current - target;
  // distance as fraction of target (how far off we are, absolute)
  const distancePct = Math.abs(current - target) / target;

  // If we've met or exceeded the target in the beneficial direction → optimal
  const metTarget = p.lowerIsBetter ? current <= target : current >= target;

  let status;
  if (metTarget || distancePct <= 0.05)  status = 'optimal';
  else if (distancePct <= 0.15)           status = 'on-track';
  else if (distancePct <= 0.30)           status = 'needs-work';
  else                                    status = 'critical';

  // Score: 100 = at/beyond target, 0 = 50%+ away (linear mapping)
  const rawScore = metTarget ? 100 : Math.max(0, 100 - (distancePct / 0.5) * 100);

  return { score: Math.round(rawScore), delta, status };
}

// scoreAll takes a data object (same shape as the app's data state) and returns:
// { overall: 0–100, breakdown: { [key]: { ...principle, current, score, delta, status } } }
export function scoreAll(data) {
  const tests = data.clinicalTests || [];
  const latestByType = tests.reduce((acc, t) => {
    if (!acc[t.type] || t.date > acc[t.type].date) acc[t.type] = t;
    return acc;
  }, {});

  const logs7 = (data.logs || []).slice(0, 7);
  const avgSleep = (() => {
    const vals = logs7.map(l => parseFloat(l.sleep)).filter(v => !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  })();

  const currentValues = {
    vo2max:      latestByType.vo2max?.metrics?.vo2max   ?? PRINCIPLES.vo2max.current,
    bodyFat:     latestByType.dexa?.metrics?.bodyFatPct ?? PRINCIPLES.bodyFat.current,
    visceralFat: latestByType.dexa?.metrics?.visceralFat ?? PRINCIPLES.visceralFat.current,
    leanMass:    latestByType.dexa?.metrics?.leanMass   ?? PRINCIPLES.leanMass.current,
    hrv:         parseFloat(logs7[0]?.hrv) || null,
    sleep:       avgSleep,
    nutrition:   parseFloat(logs7[0]?.calories) || null,
  };

  const breakdown = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const [key, principle] of Object.entries(PRINCIPLES)) {
    const current = currentValues[key];
    const result  = scorePrinciple(key, current);
    breakdown[key] = { ...principle, current, ...result };
    if (result.score !== null) {
      weightedSum  += result.score * principle.weight;
      weightTotal  += principle.weight;
    }
  }

  const overall = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
  return { overall, breakdown };
}

// getInsights returns plain-English insight strings ranked by urgency
export function getInsights(scoreResult) {
  const { overall, breakdown } = scoreResult;
  const urgencyOrder = { critical: 0, 'needs-work': 1, 'on-track': 2, optimal: 3 };

  const ranked = Object.entries(breakdown)
    .filter(([, b]) => b.status !== 'unknown' && b.score !== null)
    .sort((a, b) => urgencyOrder[a[1].status] - urgencyOrder[b[1].status]);

  const insights = ranked.map(([, b]) => {
    const diff = b.delta != null ? Math.abs(b.delta).toFixed(1) : '?';
    const dir  = b.lowerIsBetter ? 'reduce by' : 'gain';
    switch (b.status) {
      case 'critical':    return `⚠ ${b.label} is critical — ${dir} ${diff} ${b.unit} to reach ${b.target} ${b.unit}`;
      case 'needs-work':  return `↑ ${b.label} needs work — ${diff} ${b.unit} from target`;
      case 'on-track':    return `→ ${b.label} on track — ${diff} ${b.unit} from target`;
      default:            return `✓ ${b.label} is optimal at ${Number(b.current).toFixed(1)} ${b.unit}`;
    }
  });

  if (overall !== null) {
    const grade = overall >= 80 ? 'Excellent' : overall >= 60 ? 'Good' : overall >= 40 ? 'Fair' : 'Needs Focus';
    insights.unshift(`ARNOLD Score: ${overall}/100 — ${grade}`);
  }

  return insights;
}
