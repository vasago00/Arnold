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
import { computeTDEE, safeCutHeadroom } from './energyBalance.js';
import { dailyTotals as nutDailyTotals } from './nutrition.js';

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
  //
  // Phase 4r.intel.12-fix5 — use nutDailyTotals() which merges
  // nutritionLog (manual entries + Cronometer worker writes) + legacy
  // cronometer CSV imports. Raw `cronometer` storage key alone misses
  // the live-pull data that's actually populating most users' days.
  const dailyBalances = [];
  for (const ds of wDates) {
    let intake = 0;
    try {
      const totals = nutDailyTotals(ds);
      intake = Number(totals?.calories || 0);
    } catch {}
    if (!Number.isFinite(intake) || intake <= 0) continue;
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

  // Phase 4r.intel.12-fix6 — present multiple hypotheses, don't presume
  // unlogged food. A persistent gap can come from:
  //   (a) Garmin activity-calorie overestimate (often 10-20% high)
  //   (b) RMR / NEAT drift below the Mifflin / Katch-McArdle formula
  //   (c) Water-weight swings during the 28-day window (sodium, glycogen,
  //       hydration) — the regression slope is sensitive to this
  //   (d) Logged-intake undercounts (oils, drinks, restaurant portions)
  // For large gaps (>= 700 kcal/day), the math is most likely wrong on
  // the BURN side — sustained 700+ kcal under-eating would be obvious in
  // energy/mood. Lead with the metabolic-model interpretation. For
  // smaller gaps (200-700), either side could plausibly be off.
  const absGap = Math.abs(gap);
  const direction = gap > 0 ? 'positive' : 'negative';
  // positive gap = scale loses LESS than math predicts. Could be:
  //   - burn estimate inflated (most likely if you log carefully)
  //   - actual intake higher than logged
  //   - hydration / water-weight noise inside the window
  // negative gap = scale loses MORE than math predicts. Could be:
  //   - TDEE actually higher (rare)
  //   - water-weight loss / sodium drop inside the window
  //   - measurement noise
  const headline = direction === 'positive'
    ? `Weight loss ~${Math.round(absGap)} kcal/day slower than your log math predicts`
    : `Weight loss ~${Math.round(absGap)} kcal/day faster than your log math predicts`;

  // Detail with multiple hypotheses, ordered by likelihood for the
  // observed magnitude.
  const trendStr = `${lbsPerDay >= 0 ? '+' : ''}${lbsPerDay.toFixed(2)} lb/day`;
  let detail;
  if (direction === 'positive' && absGap >= 700) {
    detail = `${DAYS}-day weight trend (${trendStr}) implies ${Math.round(impliedKcalPerDay)} kcal/day; your log + TDEE math shows ${Math.round(calculatedKcalPerDay)} kcal/day. A gap this large usually means the BURN side is overstated — the activity-calorie estimate (Garmin's kcal/min model for each sport type) is often 15-25% high regardless of HR source, and RMR/NEAT can adapt several percent below the Mifflin/Katch-McArdle formula. Less likely the intake side if you log carefully.`;
  } else if (direction === 'positive') {
    detail = `${DAYS}-day weight trend (${trendStr}) implies ${Math.round(impliedKcalPerDay)} kcal/day; your log + TDEE math shows ${Math.round(calculatedKcalPerDay)} kcal/day. Possible causes: activity calorie estimate too high (Garmin's per-sport kcal/min model), metabolic adaptation lowering RMR/NEAT, water-weight swings inside the window, or some intake slipping unlogged.`;
  } else {
    detail = `${DAYS}-day weight trend (${trendStr}) implies ${Math.round(impliedKcalPerDay)} kcal/day; your log + TDEE math shows ${Math.round(calculatedKcalPerDay)} kcal/day. Either your TDEE is genuinely higher than the formula estimates, or short-term water/glycogen loss is exaggerating the slope inside this window.`;
  }

  // Concrete next-step — RMR-aware. The naive answer "drop X kcal/day"
  // is unsafe if the user's goal target is already at/near RMR (which is
  // typical for athletes mid-cut). Branching by safeCutHeadroom().phase:
  //   • burnLikelyOverstated → the gap IS the diagnosis. Lower the target,
  //     don't tighten further; the math was inflated.
  //   • at-floor → recommend training-side (zone-2) or extending date,
  //     NOT a cut. We've already cut as low as it's safe to go.
  //   • thin    → small experiment OK, but suggest activity-side too.
  //   • plenty  → normal test-cut is safe.
  let recommendation;
  let headroom = null;
  try { headroom = safeCutHeadroom(); } catch {}
  if (direction === 'positive' && headroom?.burnLikelyOverstated) {
    // The empirical math already proves Garmin/model over-credits burn.
    // The real fix is to RECALIBRATE the target, not eat less.
    const empiricalTarget = Math.max(headroom.rmr, headroom.tdeeCurrent - 500);
    recommendation = `Don't cut intake — lower the goal calorie target to ~${Math.round(empiricalTarget / 10) * 10} kcal/day. Your scale is the truth; your activity-cal estimate is inflated, so the deficit you thought you had wasn't real. Recalibrating closes the gap honestly.`;
  } else if (direction === 'positive' && headroom?.phase === 'at-floor') {
    recommendation = `Goal target ${headroom.goalTarget} is already at RMR (${headroom.rmr}). Don't cut further. Add 20-30min zone-2 walks 3-4x/wk to widen the deficit through movement, OR extend goal date 4-6 weeks to a sustainable pace.`;
  } else if (direction === 'positive' && headroom?.phase === 'thin') {
    const small = Math.min(150, headroom.safeCutKcal);
    recommendation = `Target ${headroom.goalTarget} is only ${headroom.headroomKcal} kcal above RMR. Safer to add zone-2 cardio (~200 kcal/day) than cut intake. If you must cut, max ${small} kcal/day for 7 days only.`;
  } else if (direction === 'positive' && headroom?.phase === 'plenty') {
    const testDrop = Math.min(headroom.safeCutKcal, Math.round(absGap / 4 / 10) * 10);
    recommendation = `Run a 7-day test: drop intake by ${testDrop} kcal/day (still ${headroom.headroomKcal - testDrop}+ kcal above RMR). If the scale tracks, your activity-cal is inflated — lower the goal target permanently by that amount.`;
  } else if (direction === 'positive') {
    // Headroom unavailable — fall back to conservative experiment phrasing.
    const testDrop = Math.min(200, Math.round(absGap / 4 / 10) * 10);
    recommendation = `Tighten 7 days: weigh & scan everything, then drop intake by ${testDrop} kcal/day to isolate whether the gap is log accuracy or burn overestimate. Stop if intake drops below your RMR.`;
  } else {
    recommendation = `Hold intake steady another 7 days before adjusting — short-term loss this fast is usually glycogen/water, not fat. Re-measure next Saturday.`;
  }

  return {
    id: 'weight-intake-gap',
    category: 'cross',
    severity: Math.abs(gap) > 400 ? 'concern' : 'attention',
    headline,
    detail,
    recommendation,
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
        recommendation: `Pre-hydrate 500ml + electrolytes 60min before next ${FAMILY_LABEL[f] || f} session. If drift stays high after 2 sessions, add a recovery day before the next hard one.`,
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
    recommendation: `After a <6.5h night, swap the hard session for zone 2 or mobility, or hold avg HR ${Math.round(delta)}bpm lower. Move the planned intensity to the next recovered day.`,
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
