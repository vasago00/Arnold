// ─── Insight engine (Phase 4r.intel.12 — Layer 4) ──────────────────────────
// Walks multi-session history and surfaces statistically-gated patterns the
// user wouldn't notice by glancing at any single day. Each insight is a
// pure function over (activities, sleep, hrv, weight, cronometer, profile)
// that returns an Insight object — or null when its conditions aren't met.
//
// Insight signature:
//   {
//     id:        stable string (used for dedupe + dismiss)
//     category:  'training' | 'recovery' | 'nutrition' | 'body' | 'cross'
//     severity:  'info' | 'attention' | 'concern'
//     headline:  one-line takeaway, < 80 chars
//     detail:    longer prose, < 200 chars
//     evidence:  { n, period, pValue?, r2? }
//     data?:     structured payload the UI can render
//   }
//
// Statistical gating policy:
//   - Minimum n for any insight: 5
//   - Two-sided p-value threshold: 0.10 (we want to surface patterns even
//     when noise is plausible; the user reads and dismisses, not us)
//   - Always include n + period in evidence so the user can judge

import { linearRegression, correlation, tTestUnequal, mean, std } from './stats.js';
import { parseLocalDate } from './dateUtils.js';
import { isRun, isHIIT, isStrength, isMobility } from './activityClass.js';
import { computeTDEE } from './energyBalance.js';

const FAMILY_LABEL = {
  easy_run: 'easy runs',
  long_run: 'long runs',
  tempo:    'tempos',
  intervals: 'intervals',
  hiit:     'HIITs',
  strength: 'strength sessions',
  mobility: 'mobility sessions',
  cross:    'cross-training',
  race:     'races',
  run:      'runs',
};

// ─── helpers ───────────────────────────────────────────────────────────────

function familyOf(act) {
  if (act?.planType) return act.planType;
  if (act?.family) return act.family;
  if (isHIIT(act))     return 'hiit';
  if (isRun(act))      return 'run';
  if (isStrength(act)) return 'strength';
  if (isMobility(act)) return 'mobility';
  return null;
}

function withinDays(dateStr, days) {
  const d = parseLocalDate(dateStr);
  if (!d) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return d.getTime() >= cutoff;
}

function sortByDateAsc(rows) {
  return rows.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

// kcal per kg of body fat lost — common rule of thumb.
const KCAL_PER_KG = 7700;
const LB_PER_KG = 2.20462;

// ─── insight: weight-trend vs logged-intake gap ────────────────────────────
//
// For the last N days where we have both daily weight and daily nutrition,
// derive an "implied calorie balance" from the weight trend, and compare it
// to the calculated balance (logged intake - estimated TDEE). A persistent
// gap typically means logged intake undercounts the truth (unlogged food,
// underestimated portions) — or that the TDEE model is off.
function insightWeightIntakeGap({ activities, weight, cronometer, profile }) {
  // Pull 28 days of weight + nutrition. We need both on a date to count it.
  const DAYS = 28;
  const weightRows = (weight || [])
    .filter(w => w && w.date && Number.isFinite(Number(w.weightLbs ?? w.weightLb ?? w.weight)))
    .filter(w => withinDays(w.date, DAYS));
  if (weightRows.length < 10) return null;

  // Sort + dedupe by date (keep latest entry).
  const wByDate = new Map();
  for (const w of sortByDateAsc(weightRows)) {
    const lbs = Number(w.weightLbs ?? w.weightLb ?? w.weight);
    if (Number.isFinite(lbs)) wByDate.set(w.date, lbs);
  }
  const wDates = Array.from(wByDate.keys()).sort();
  if (wDates.length < 10) return null;

  // Linear regression: weight (lbs) vs day index.
  const wValues = wDates.map(d => wByDate.get(d));
  const reg = linearRegression(wValues);
  if (!Number.isFinite(reg.slope)) return null;

  // Slope is lbs/day-index where each index is one weight observation, not
  // necessarily one calendar day. Convert to lbs/day using actual span.
  const firstDate = parseLocalDate(wDates[0]);
  const lastDate  = parseLocalDate(wDates[wDates.length - 1]);
  if (!firstDate || !lastDate) return null;
  const spanDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / 86400000);
  const totalChangeLbs = wValues[wValues.length - 1] - wValues[0];
  const lbsPerDay = totalChangeLbs / spanDays;

  // Implied daily kcal balance from weight trend.
  // negative lbs/day = losing → negative kcal balance (deficit).
  const kgPerDay = lbsPerDay / LB_PER_KG;
  const impliedKcalPerDay = kgPerDay * KCAL_PER_KG;

  // Logged calorie balance over the same window.
  // For each date with both nutrition + weight, sum logged intake and
  // subtract that day's TDEE. Average across days.
  const dailyBalances = [];
  for (const ds of wDates) {
    // Logged intake for the date: cronometer daily total OR nutritionLog.
    const cronoRow = (cronometer || []).find(c => c && c.date === ds && Number(c.calories) > 0);
    if (!cronoRow) continue;
    const intake = Number(cronoRow.calories);
    let tdee = null;
    try { const t = computeTDEE(ds); tdee = t && Number(t.tdee); } catch {}
    if (!Number.isFinite(tdee) || tdee <= 0) continue;
    dailyBalances.push(intake - tdee);
  }
  if (dailyBalances.length < 7) return null;
  const calculatedKcalPerDay = mean(dailyBalances);

  const gap = impliedKcalPerDay - calculatedKcalPerDay;
  // A meaningful gap is > 200 kcal/day persistent.
  if (Math.abs(gap) < 200) return null;

  // Direction: positive gap = you're actually eating MORE than logged
  // (because the scale shows less loss than the math predicts). Negative
  // gap = you're eating less than logged OR your TDEE is higher than
  // computed (rare).
  const direction = gap > 0 ? 'over' : 'under';
  const headline = direction === 'over'
    ? `Logged intake undercounts by ~${Math.round(Math.abs(gap))} kcal/day`
    : `TDEE may be ~${Math.round(Math.abs(gap))} kcal/day higher than modeled`;

  const detail = direction === 'over'
    ? `${DAYS}-day weight trend (${lbsPerDay >= 0 ? '+' : ''}${lbsPerDay.toFixed(2)} lb/day) implies a ${Math.round(impliedKcalPerDay)} kcal/day balance; your log + TDEE math shows ${Math.round(calculatedKcalPerDay)} kcal/day. The gap usually points to unlogged snacks, oils, drinks, or restaurant portions.`
    : `${DAYS}-day weight trend (${lbsPerDay >= 0 ? '+' : ''}${lbsPerDay.toFixed(2)} lb/day) implies ${Math.round(impliedKcalPerDay)} kcal/day; your log + TDEE math shows ${Math.round(calculatedKcalPerDay)} kcal/day. Your TDEE may be running higher than the formula estimates.`;

  return {
    id: 'weight-intake-gap',
    category: 'cross',
    severity: Math.abs(gap) > 400 ? 'concern' : 'attention',
    headline,
    detail,
    evidence: {
      n: dailyBalances.length,
      period: `${spanDays.toFixed(0)} days`,
    },
    data: {
      lbsPerDay,
      impliedKcalPerDay: Math.round(impliedKcalPerDay),
      loggedKcalPerDay: Math.round(calculatedKcalPerDay),
      gapKcalPerDay: Math.round(gap),
    },
  };
}

// ─── insight: cardiac drift trend per family ───────────────────────────────
//
// For each family with at least 5 recent sessions, regress cardiacDrift
// over session index. Fire when slope > +1pp/session AND p < 0.10.
function insightDriftTrend({ activities }) {
  if (!Array.isArray(activities)) return null;
  const byFamily = new Map();
  for (const a of activities) {
    const f = familyOf(a);
    if (!f) continue;
    const drift = Number(a?.cardiacDrift ?? a?.aerobicDecoupling);
    if (!Number.isFinite(drift)) continue;
    if (!byFamily.has(f)) byFamily.set(f, []);
    byFamily.get(f).push({ date: a.date, drift });
  }

  let bestInsight = null;
  for (const [f, rows] of byFamily.entries()) {
    if (rows.length < 5) continue;
    const recent = sortByDateAsc(rows).slice(-5);
    const reg = linearRegression(recent.map(r => r.drift));
    if (!Number.isFinite(reg.slope)) continue;
    if (reg.slope <= 1) continue;       // not enough trend
    if (reg.pValue > 0.10) continue;    // not significant
    const totalDelta = reg.slope * (recent.length - 1);
    // Prefer the family with the steepest significant slope.
    if (!bestInsight || reg.slope > bestInsight._slope) {
      bestInsight = {
        id: `drift-trend-${f}`,
        category: 'training',
        severity: totalDelta > 5 ? 'concern' : 'attention',
        headline: `Cardiac drift trending up on ${FAMILY_LABEL[f] || f}`,
        detail: `Over the last 5 ${FAMILY_LABEL[f] || f}, drift has risen ~${totalDelta.toFixed(1)}pp (slope +${reg.slope.toFixed(1)}pp/session). Heat, fatigue, or dehydration accumulating between sessions.`,
        evidence: { n: 5, period: 'last 5 sessions', pValue: reg.pValue, r2: reg.r2 },
        data: { family: f, slopePerSession: reg.slope, totalDeltaPp: totalDelta },
        _slope: reg.slope,
      };
    }
  }
  if (bestInsight) delete bestInsight._slope;
  return bestInsight;
}

// ─── insight: low-sleep training response ──────────────────────────────────
//
// Last 30 days of activities. Pair each with the prior night's sleep
// duration (sleep date == activity date, our convention is wake-up date).
// Group: low_sleep (< 6.5h) vs adequate (>= 6.5h). Welch's t-test on
// avgHR_pctMax. Fire when meanA - meanB > 3pp AND p < 0.10.
function insightLowSleepResponse({ activities, sleep, profile }) {
  if (!Array.isArray(activities) || !Array.isArray(sleep)) return null;
  const maxHR = parseFloat(profile?.maxHR) || null;
  if (!maxHR) return null;

  const sleepByDate = new Map();
  for (const s of sleep) {
    const mins = Number(s?.totalSleepMinutes ?? s?.durationMinutes);
    if (s?.date && Number.isFinite(mins)) sleepByDate.set(s.date, mins / 60);
  }

  const lowSleep = [], adequate = [];
  for (const a of activities) {
    if (!a || !a.date || !withinDays(a.date, 30)) continue;
    const avgHR = Number(a.avgHR);
    if (!Number.isFinite(avgHR) || avgHR < 60 || avgHR > 220) continue;
    const dur = Number(a.durationSecs ?? a.durationSec);
    if (!Number.isFinite(dur) || dur < 15 * 60) continue;     // require ≥15min
    const pctMax = (avgHR / maxHR) * 100;
    const sleepHrs = sleepByDate.get(a.date);
    if (!Number.isFinite(sleepHrs)) continue;
    if (sleepHrs < 6.5) lowSleep.push(pctMax);
    else                adequate.push(pctMax);
  }
  if (lowSleep.length < 3 || adequate.length < 3) return null;

  const tt = tTestUnequal(lowSleep, adequate);
  const delta = tt.meanA - tt.meanB;
  if (delta <= 3) return null;
  if (tt.pValue > 0.10) return null;

  return {
    id: 'low-sleep-response',
    category: 'cross',
    severity: delta > 5 ? 'concern' : 'attention',
    headline: `On <6.5h sleep, your avg HR runs +${delta.toFixed(1)}pp higher`,
    detail: `Across the last 30 days (${lowSleep.length} low-sleep sessions, ${adequate.length} adequate), avg %maxHR climbed from ${tt.meanB.toFixed(1)}% to ${tt.meanA.toFixed(1)}%. Same effort costs more cardiovascular work when underslept.`,
    evidence: { n: lowSleep.length + adequate.length, period: 'last 30 days', pValue: tt.pValue },
    data: { lowSleepMean: tt.meanA, adequateMean: tt.meanB, deltaPp: delta },
  };
}

// ─── public API ────────────────────────────────────────────────────────────

/**
 * Generate the active insight list given the user's full data snapshot.
 * Pure — no storage writes. Caller is responsible for caching / display.
 *
 * @param {{
 *   activities: Array,
 *   sleep:      Array,
 *   hrv:        Array,
 *   weight:     Array,
 *   cronometer: Array,
 *   profile:    Object,
 * }} data
 * @returns {Array} insights, sorted by severity (concern > attention > info).
 */
export function generateInsights(data) {
  const d = data || {};
  const out = [];
  const generators = [
    insightWeightIntakeGap,
    insightDriftTrend,
    insightLowSleepResponse,
  ];
  for (const fn of generators) {
    try {
      const ins = fn(d);
      if (ins) out.push(ins);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[insights] generator failed:', fn.name, e && e.message);
    }
  }
  const sevRank = { concern: 3, attention: 2, info: 1 };
  return out.sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0));
}
