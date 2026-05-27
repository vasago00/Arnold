// ─── Coach Engine — v1 pattern detection ──────────────────────────────────
//
// Phase 4r.coach.v1 (2026-05-24). See COACH.md for full spec.

// Phase 4r.narrative.5.fix.18+20 — activityKind for plan-vs-done matching.
// Originally imported isHardSession from activityClass too, but coachSignals
// already has a more sophisticated local isHardSession (TSS / TE / duration
// thresholds at lines 510+) that we use instead.
import { activityKind } from './activityClass.js';
//
// Six derived signals that extend Arnold's view from "snapshot of today"
// to "multi-horizon pattern analysis." Each signal is a pure function
// of existing storage — no new data integrations required.
//
//   1. computeSleepDebt         — rolling 7/14/30d cumulative deficit
//   2. computeHrvDepression     — depth + duration vs personal baseline
//   3. computeRhrDrift          — slope over 14d (bpm/wk)
//   4. computeEnergyAvailability — (intake − exercise kcal) / LBM
//   5. computeTrainingMonotonyStrain — Foster's formula
//   6. computeSleepHrvCorrelation — personal Pearson r, n≥30, |r|≥0.3 gated
//
// All six attach to userState.coachSignals via computeUserState. UI
// consumption is deliberately deferred to a later phase; v1 is engine
// only so the signals can be inspected via window.coachSignalsDebug()
// before any rail redesign uses them.

// ─── Utilities ─────────────────────────────────────────────────────────────

function daysAgo(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function inWindow(dateStr, todayStr, days) {
  return dateStr >= daysAgo(todayStr, days - 1) && dateStr <= todayStr;
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const sq = arr.reduce((s, v) => s + (v - m) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

// Linear regression slope (y per x unit). xs and ys must be same length.
function regressionSlope(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// Pearson correlation coefficient. xs and ys must be same length.
function pearsonR(xs, ys) {
  if (xs.length < 3 || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const ex = xs[i] - mx;
    const ey = ys[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

// Approximate two-tailed p-value for Pearson r via t-distribution.
// For n≥30 this is reasonable; for smaller n it's a rough estimate.
function approxPValueForR(r, n) {
  if (n < 3) return 1;
  const absR = Math.min(Math.abs(r), 0.99999);
  const t = absR * Math.sqrt((n - 2) / (1 - absR ** 2));
  // Wilson-Hilferty approx to normal — good enough for ranking.
  const df = n - 2;
  const z = t * (1 - 1 / (4 * df));
  const denom = Math.sqrt(1 + t * t / (2 * df));
  const zNorm = z / denom;
  // Normal tail approximation (Abramowitz & Stegun 26.2.17)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = zNorm < 0 ? -1 : 1;
  const x = Math.abs(zNorm) / Math.sqrt(2);
  const tt = 1 / (1 + p * x);
  const erf = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-x * x);
  return 1 - sign * erf;
}

// ─── 1. Sleep debt ─────────────────────────────────────────────────────────

export function computeSleepDebt(sleepArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const target = opts.targetHours || 7.5;

  const nights = (sleepArr || [])
    .filter(s => s?.date)
    .map(s => {
      const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
      return { date: s.date, hours: Number.isFinite(mins) && mins > 0 ? mins / 60 : null };
    })
    .filter(n => n.hours != null);

  const window = (days) => {
    const inW = nights.filter(n => inWindow(n.date, today, days));
    if (!inW.length) return { debt: null, nightsBelow: 0, avgHours: null, n: 0 };
    const debt = inW.reduce((s, n) => s + Math.max(0, target - n.hours), 0);
    const nightsBelow = inW.filter(n => n.hours < target).length;
    return {
      debt: +debt.toFixed(1),
      nightsBelow,
      avgHours: +mean(inW.map(n => n.hours)).toFixed(2),
      n: inW.length,
    };
  };

  const w7  = window(7);
  const w14 = window(14);
  const w30 = window(30);

  let status = 'paid';
  if (w7.debt != null) {
    if (w7.debt >= 7)      status = 'severe';
    else if (w7.debt >= 3) status = 'moderate';
    else if (w7.debt >= 1) status = 'mild';
  }

  return {
    targetHours: target,
    debt7d:  w7.debt,
    debt14d: w14.debt,
    debt30d: w30.debt,
    nightsBelow7d:  w7.nightsBelow,
    nightsBelow14d: w14.nightsBelow,
    nightsBelow30d: w30.nightsBelow,
    avgHours7d:  w7.avgHours,
    avgHours14d: w14.avgHours,
    avgHours30d: w30.avgHours,
    n7d: w7.n,
    status,
    asOf: today,
  };
}

// ─── 2. HRV depression ─────────────────────────────────────────────────────

export function computeHrvDepression(hrvArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);

  const desc = (hrvArr || [])
    .filter(h => h?.date && Number.isFinite(Number(h.value)) && Number(h.value) > 0)
    .map(h => ({ date: h.date, value: Number(h.value) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (desc.length < 5) {
    return { latest: null, baseline28d: null, depressionMs: null, depressionPct: null,
             consecutiveDepressedDays: 0, n: desc.length, status: 'insufficient-data', asOf: today };
  }

  const latest = desc[0].value;

  // Baseline: days 2-29 (exclude today/latest), trimmed at ±2σ.
  const baselineRaw = desc.slice(1, 29).map(d => d.value);
  const m0 = mean(baselineRaw);
  const sd0 = stddev(baselineRaw);
  const trimmed = baselineRaw.filter(v => Math.abs(v - m0) <= 2 * sd0);
  const baseline28d = trimmed.length >= 5 ? mean(trimmed) : m0;

  const depressionMs = +(baseline28d - latest).toFixed(1);
  const depressionPct = baseline28d > 0 ? +(depressionMs / baseline28d * 100).toFixed(1) : null;

  // Consecutive depressed days = walk back from today while v < baseline.
  let consec = 0;
  for (const d of desc) {
    if (d.value < baseline28d) consec++;
    else break;
  }

  let status = 'normal';
  if (depressionPct != null) {
    if (depressionPct >= 20 || consec >= 10)      status = 'severe';
    else if (depressionPct >= 10 || consec >= 5)  status = 'moderate';
    else if (depressionPct >= 5)                  status = 'mild';
  }

  return {
    latest,
    baseline28d: +baseline28d.toFixed(1),
    depressionMs,
    depressionPct,
    consecutiveDepressedDays: consec,
    n: desc.length,
    status,
    asOf: today,
  };
}

// ─── 3. RHR drift ──────────────────────────────────────────────────────────

export function computeRhrDrift(rhrArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);

  const desc = (rhrArr || [])
    .filter(r => r?.date && Number.isFinite(Number(r.value)) && Number(r.value) > 0)
    .map(r => ({ date: r.date, value: Number(r.value) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  if (desc.length < 7) {
    return { latest: null, baseline28d: null, slopeBpmPerWeek: null,
             n: desc.length, status: 'insufficient-data', asOf: today };
  }

  const latest = desc[0].value;
  const baseline28d = mean(desc.slice(1, 29).map(d => d.value));

  // Slope over last 14 days. x = days from oldest in window, y = bpm.
  const last14 = desc.filter(d => inWindow(d.date, today, 14)).reverse(); // ascending
  let slopeBpmPerWeek = null;
  if (last14.length >= 5) {
    const xs = last14.map((d, i) => i);
    const ys = last14.map(d => d.value);
    const perDay = regressionSlope(xs, ys);
    slopeBpmPerWeek = +(perDay * 7).toFixed(2);
  }

  let status = 'stable';
  if (slopeBpmPerWeek != null) {
    if (slopeBpmPerWeek > 1.5)      status = 'concerning';
    else if (slopeBpmPerWeek > 0.5) status = 'rising';
  }

  return {
    latest,
    baseline28d: baseline28d != null ? +baseline28d.toFixed(1) : null,
    slopeBpmPerWeek,
    n: desc.length,
    status,
    asOf: today,
  };
}

// ─── 4. Energy availability ────────────────────────────────────────────────
// EA = (intake − exercise kcal) / LBM (kg).
//   ≥ 40 kcal/kg LBM  → sufficient
//   30–40             → low (suboptimal recovery + adaptation)
//   < 30              → deficient (endocrine impact threshold)

export function computeEnergyAvailability(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const intakeKcal = Number(opts.intakeKcal) || 0;
  const exerciseKcal = Number(opts.exerciseKcal) || 0;
  const lbmLbs = Number(opts.lbmLbs);

  if (!Number.isFinite(lbmLbs) || lbmLbs <= 0) {
    return { intakeKcal, exerciseKcal, netKcal: null, lbmKg: null,
             eaKcalPerKgLBM: null, status: 'insufficient-data', asOf: today };
  }

  const lbmKg = lbmLbs / 2.20462;
  const netKcal = intakeKcal - exerciseKcal;
  const ea = +(netKcal / lbmKg).toFixed(1);

  let status = 'sufficient';
  if (ea < 30)      status = 'deficient';
  else if (ea < 40) status = 'low';

  return {
    intakeKcal: Math.round(intakeKcal),
    exerciseKcal: Math.round(exerciseKcal),
    netKcal: Math.round(netKcal),
    lbmKg: +lbmKg.toFixed(1),
    eaKcalPerKgLBM: ea,
    status,
    asOf: today,
  };
}

// ─── 5. Training monotony + strain (Foster) ────────────────────────────────
// Monotony = mean(daily load) / stddev(daily load)
// Strain   = monotony × weekly load
// dailyLoad here uses kcal as a TSS proxy — defensible because energy
// expenditure tracks training stress closely enough for the variance
// signal (which is what matters for monotony).
//
// Phase 4r.coach.v1.workout-threshold (2026-05-24) — filter out
// incidental activity (short walks, casual movement). User reported
// the training-consistency brief showed 5/7 days when actual real
// workouts were 4 — a 5-min walk burning 30 kcal was being counted
// as a "trained day." MIN_WORKOUT_KCAL = 150 (≈ 20 min of
// intentional movement) excludes that noise. Individual activities
// below the threshold drop OUT of the day's load; days where the
// SUM of qualifying activities is still positive count as trained.
const MIN_WORKOUT_KCAL = 150;

export function computeTrainingMonotonyStrain(activities, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const days = 7;
  const minKcal = opts.minWorkoutKcal ?? MIN_WORKOUT_KCAL;

  const dailyLoad = [];
  for (let i = days - 1; i >= 0; i--) {
    const dStr = daysAgo(today, i);
    // Filter activities by both date AND minimum kcal threshold —
    // incidental movement (short walks, casual cycling) doesn't
    // qualify as a workout for the consistency / monotony signals.
    const loadForDay = (activities || [])
      .filter(a => a?.date === dStr)
      .map(a => Number(a.kcal) || Number(a.calories) || 0)
      .filter(kcal => kcal >= minKcal)
      .reduce((s, k) => s + k, 0);
    dailyLoad.push(loadForDay);
  }

  const weeklyLoad = dailyLoad.reduce((a, b) => a + b, 0);
  const m = mean(dailyLoad);
  const sd = Math.max(stddev(dailyLoad), 1);
  const monotony = +(m / sd).toFixed(2);
  const strain = Math.round(monotony * weeklyLoad);

  let status = 'balanced';
  if (monotony >= 2 && strain > 6000) status = 'high-strain';
  else if (monotony >= 1.5)           status = 'monotonous';

  return {
    dailyLoad,
    weeklyLoad: Math.round(weeklyLoad),
    monotony,
    strain,
    n: dailyLoad.filter(x => x > 0).length,
    status,
    asOf: today,
  };
}

// ─── 6. Sleep → next-day HRV correlation (personal) ────────────────────────
// Pair sleep[t] (hours) with HRV[t+1] (ms). Compute Pearson r over the
// last 60 days. Only surfaceable when n ≥ 30 AND |r| ≥ 0.3.

export function computeSleepHrvCorrelation(sleepArr, hrvArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 60;

  const sleepByDate = new Map();
  for (const s of (sleepArr || [])) {
    if (!s?.date) continue;
    const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
    if (Number.isFinite(mins) && mins > 0) sleepByDate.set(s.date, mins / 60);
  }
  const hrvByDate = new Map();
  for (const h of (hrvArr || [])) {
    if (h?.date && Number.isFinite(Number(h.value)) && Number(h.value) > 0) {
      hrvByDate.set(h.date, Number(h.value));
    }
  }

  const pairs = [];
  for (const [date, sleepHrs] of sleepByDate) {
    if (!inWindow(date, today, lookbackDays)) continue;
    const nextDay = daysAgo(date, -1);
    const nextHrv = hrvByDate.get(nextDay);
    if (nextHrv != null) pairs.push({ date, sleepHrs, nextHrv });
  }

  const n = pairs.length;
  if (n < 3) {
    return { n, r: null, slope: null, pValue: null, surfaceable: false,
             insight: null, status: 'insufficient-data', asOf: today };
  }

  const xs = pairs.map(p => p.sleepHrs);
  const ys = pairs.map(p => p.nextHrv);
  const r = +pearsonR(xs, ys).toFixed(3);
  const slope = +regressionSlope(xs, ys).toFixed(2);  // ms HRV per hour sleep
  const pValue = +approxPValueForR(r, n).toFixed(4);

  const surfaceable = n >= 30 && Math.abs(r) >= 0.3;
  const insight = surfaceable
    ? `+1h sleep ≈ ${slope > 0 ? '+' : ''}${slope}ms HRV next day (n=${n}, r=${r.toFixed(2)})`
    : null;

  return {
    n,
    r,
    slope,
    pValue,
    surfaceable,
    insight,
    status: surfaceable ? 'surfaceable' : (n < 30 ? 'building-baseline' : 'weak-signal'),
    asOf: today,
  };
}

// ─── 7. TDEE drift ─────────────────────────────────────────────────────────
// Phase 4r.signals.2. Compares a recent 4-week empirical TDEE window against
// the prior 4-week window to surface metabolic adaptation. Two flavours:
//
//   • adapting     — TDEE has dropped 5-15% vs the prior 4 weeks.
//                    Canonical cut response: body defends weight by lowering
//                    daily energy spend. Not always bad — signals the cut
//                    is real — but it means the SAME deficit produces SLOWER
//                    loss going forward. Action: hold the deficit, increase
//                    NEAT (steps), or schedule a 7-14 day diet break.
//
//   • starvation   — TDEE has dropped >15% vs the prior window. Severe
//                    adaptation territory. Signal to consider a longer
//                    diet break (2-4 weeks at maintenance) before adaptation
//                    becomes harder to reverse.
//
//   • rebounding   — TDEE has RISEN ≥5% vs prior. Refeed / break worked,
//                    or training volume increased; body's spending energy
//                    again. Window to push the cut harder if goal-aligned.
//
//   • stable       — drift within ±5%. No actionable adaptation signal.
//
//   • insufficient — either window lacks confidence (need ≥14 logged days,
//                    ≥70% coverage, weight readings at both endpoints).
//
// IMPORTANT: this is a PURE transformer. The orchestrator (intelligence.js)
// computes the two empiricalTDEE() snapshots and passes them in. Keeps
// coachSignals.js free of storage reads — same pattern as the other v1
// signals.

export function computeTdeeDrift(input = {}) {
  const recent   = input.recent || null;     // shape: { empiricalTDEE, confidence, avgIntake, ... } or null
  const baseline = input.baseline || null;
  const today    = input.today || new Date().toISOString().slice(0, 10);

  const recentTdee   = recent?.empiricalTDEE;
  const baselineTdee = baseline?.empiricalTDEE;

  // Both windows need a valid number AND non-'insufficient' confidence.
  const recentOk   = Number.isFinite(recentTdee)   && recent?.confidence   !== 'insufficient';
  const baselineOk = Number.isFinite(baselineTdee) && baseline?.confidence !== 'insufficient';
  if (!recentOk || !baselineOk) {
    return {
      status: 'insufficient',
      recentTdee:   recentOk   ? recentTdee   : null,
      baselineTdee: baselineOk ? baselineTdee : null,
      driftKcal: null,
      driftPct:  null,
      asOf: today,
      note: !recentOk && !baselineOk
        ? 'Both 4-week windows lack ≥14 logged days + weight endpoints.'
        : !recentOk
          ? 'Recent 4-week window lacks ≥14 logged days + weight endpoints.'
          : 'Baseline 4-week window (4-8 weeks ago) lacks ≥14 logged days + weight endpoints.',
    };
  }

  const driftKcal = recentTdee - baselineTdee;
  const driftPct  = driftKcal / baselineTdee;

  let status;
  if      (driftPct <= -0.15) status = 'starvation';
  else if (driftPct <= -0.05) status = 'adapting';
  else if (driftPct >=  0.05) status = 'rebounding';
  else                        status = 'stable';

  // Lowest-confidence of the two windows is the overall confidence
  const confRank = { low: 1, medium: 2, high: 3 };
  const confidence = (recent.confidence === 'high' && baseline.confidence === 'high') ? 'high'
                   : (confRank[recent.confidence] >= 2 && confRank[baseline.confidence] >= 2) ? 'medium'
                   : 'low';

  return {
    status,
    recentTdee,
    baselineTdee,
    driftKcal: Math.round(driftKcal),
    driftPct:  +(driftPct * 100).toFixed(1),
    confidence,
    recentAvgIntake:   recent?.avgIntake   || null,
    baselineAvgIntake: baseline?.avgIntake || null,
    asOf: today,
    note: `Recent 4wk TDEE ${recentTdee} vs prior 4wk ${baselineTdee} = ${driftKcal > 0 ? '+' : ''}${Math.round(driftKcal)} kcal (${driftPct >= 0 ? '+' : ''}${(driftPct * 100).toFixed(1)}%).`,
  };
}

// ─── 8. Recovery velocity ──────────────────────────────────────────────────
// Phase 4r.signals.3. Measures how many days HRV takes to return to your
// personal baseline after a hard session. Improving fitness → velocity
// shortens. Under-recovered / overreaching → velocity lengthens.
//
// Definition of "hard session": rTSS ≥ 120, OR Garmin training effect
// (aerobic OR anaerobic) ≥ 4.0, OR a long run ≥ 90 min at any pace. These
// are the workout types where you'd expect a 24-48h HRV depression in a
// recovered athlete. Easy zone-2 runs don't qualify — they shouldn't drop
// HRV in a healthy state.
//
// Algorithm per session:
//   1. Take HRV on session day + 1, +2, +3, ... up to 7 days post.
//   2. "Recovered" = HRV ≥ 0.95 × baseline90d.
//   3. days-to-recover = the first post-session day that meets the bar.
//      If never recovered within 7 days, mark as 7 (capped).
//   4. If a NEW hard session lands inside the recovery window, the earlier
//      session's recovery is contaminated — skip it (the LATER session
//      becomes the new anchor).
//
// Then bucket: recent 8 weeks vs baseline 4 weeks before that. Compare
// means. Drift > +30% (recovery slowing) is the actionable signal.

const HARD_TSS_THRESHOLD     = 120;
const HARD_TE_THRESHOLD      = 4.0;
const HARD_LONG_RUN_MIN_SECS = 90 * 60;
const RECOVERY_HRV_FRACTION  = 0.95;
const RECOVERY_CAP_DAYS      = 7;

function isHardSession(a) {
  if (!a || !a.date) return false;
  const tss = Number(a.tss || a.rTSS || a.hrTSS || a.trainingStressScore);
  if (Number.isFinite(tss) && tss >= HARD_TSS_THRESHOLD) return true;
  const aeTE = Number(a.aerobicTrainingEffect);
  const anTE = Number(a.anaerobicTrainingEffect);
  if (Number.isFinite(aeTE) && aeTE >= HARD_TE_THRESHOLD) return true;
  if (Number.isFinite(anTE) && anTE >= HARD_TE_THRESHOLD) return true;
  const dur = Number(a.durationSecs);
  const isRunLike = String(a.activityType || a.type || '').toLowerCase().includes('run')
                 || /run|jog|hyrox|race/i.test(String(a.name || a.title || ''));
  if (isRunLike && Number.isFinite(dur) && dur >= HARD_LONG_RUN_MIN_SECS) return true;
  return false;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function computeRecoveryVelocity(hardSessions, hrvByDate, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const baseline = Number(opts.baselineHrv);
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return {
      status: 'insufficient',
      n: 0,
      avgDaysToRecover: null,
      baselineAvg: null,
      driftPct: null,
      asOf: today,
      note: 'No HRV baseline yet — need ≥30 days of HRV history to anchor recovery.',
    };
  }
  if (!Array.isArray(hardSessions) || !hardSessions.length) {
    return {
      status: 'insufficient',
      n: 0,
      avgDaysToRecover: null,
      baselineAvg: null,
      driftPct: null,
      asOf: today,
      note: 'No hard sessions in the last 90 days. Recovery velocity needs sessions to measure between.',
    };
  }

  // Sort by date ascending so we can detect overlapping recovery windows.
  const sessions = [...hardSessions].sort((a, b) => a.date.localeCompare(b.date));
  const recovered = []; // { sessionDate, daysToRecover }
  const recoveryBar = baseline * RECOVERY_HRV_FRACTION;

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const next = sessions[i + 1];
    // If a new hard session lands within our recovery window, skip — its
    // HRV trajectory will be a mix of two sessions and the measurement
    // would be noise.
    const maxLook = (() => {
      if (!next) return RECOVERY_CAP_DAYS;
      const daysToNext = Math.floor(
        (new Date(next.date + 'T00:00:00') - new Date(s.date + 'T00:00:00')) / 86400000
      );
      return Math.min(RECOVERY_CAP_DAYS, daysToNext - 1);
    })();
    if (maxLook < 1) continue; // back-to-back hard sessions — uninterpretable

    let foundDay = null;
    let sawAnyHrv = false;
    for (let d = 1; d <= maxLook; d++) {
      const ds = addDays(s.date, d);
      const v = hrvByDate.get(ds);
      if (v == null) continue;
      sawAnyHrv = true;
      if (v >= recoveryBar) { foundDay = d; break; }
    }
    if (!sawAnyHrv) continue; // no HRV data in window — can't measure
    recovered.push({
      sessionDate: s.date,
      daysToRecover: foundDay != null ? foundDay : RECOVERY_CAP_DAYS,
    });
  }

  if (recovered.length < 3) {
    return {
      status: 'insufficient',
      n: recovered.length,
      avgDaysToRecover: null,
      baselineAvg: null,
      driftPct: null,
      asOf: today,
      note: `Only ${recovered.length} measurable session(s) in the last 90 days — need ≥3 to compute a stable average.`,
    };
  }

  // Split into recent (last 56 days, i.e. 8 weeks) and baseline (the 28
  // days BEFORE that 8-week window). Compare means.
  const recentStart   = addDays(today, -56);
  const baselineStart = addDays(today, -84);
  const baselineEnd   = addDays(today, -57);

  const recent   = recovered.filter(r => r.sessionDate >= recentStart);
  const baseRecs = recovered.filter(r => r.sessionDate >= baselineStart && r.sessionDate <= baselineEnd);

  if (recent.length < 2 || baseRecs.length < 2) {
    // Not enough on both sides for a drift — but we can still surface the
    // overall mean as a 'stable' read with a soft confidence.
    const overall = mean(recovered.map(r => r.daysToRecover));
    return {
      status: 'stable',
      n: recovered.length,
      avgDaysToRecover: +overall.toFixed(1),
      baselineAvg: null,
      driftPct: null,
      confidence: 'low',
      asOf: today,
      note: `Overall avg ${overall.toFixed(1)} days to recover (over ${recovered.length} sessions). Not enough sessions to detect drift — need more recent + baseline samples.`,
    };
  }

  const recentAvg = mean(recent.map(r => r.daysToRecover));
  const baseAvg   = mean(baseRecs.map(r => r.daysToRecover));
  const driftPct  = (recentAvg - baseAvg) / baseAvg;

  let status;
  if      (driftPct >=  0.30) status = 'concerning';
  else if (driftPct >=  0.15) status = 'slowing';
  else if (driftPct <= -0.15) status = 'improving';
  else                        status = 'stable';

  return {
    status,
    n: recovered.length,
    nRecent: recent.length,
    nBaseline: baseRecs.length,
    avgDaysToRecover: +recentAvg.toFixed(1),
    baselineAvg: +baseAvg.toFixed(1),
    driftDays: +(recentAvg - baseAvg).toFixed(1),
    driftPct: +(driftPct * 100).toFixed(1),
    confidence: recent.length >= 4 && baseRecs.length >= 3 ? 'high' : 'medium',
    asOf: today,
    note: `Recent ${recentAvg.toFixed(1)}d (n=${recent.length}) vs prior ${baseAvg.toFixed(1)}d (n=${baseRecs.length}) = ${driftPct > 0 ? '+' : ''}${(driftPct * 100).toFixed(0)}% drift.`,
  };
}

// ─── 9. Glycogen estimator ─────────────────────────────────────────────────
// Phase 4r.signals.4. Estimates whether the user is "carb-loaded" enough
// for upcoming intensity work, by comparing the carbs they've eaten in the
// last 24h against the carbs their training burned during the same window.
//
// Pragmatic v1 (deliberately not trying to track absolute glycogen grams,
// which would require hourly modelling we don't have data for):
//
//   adequacyRatio = supplied24h / need24h
//
//   need24h    = z45_min·1.0 g/min            (high-intensity glycogen burn)
//              + z3_min·0.5 g/min
//              + z2_min·0.3 g/min
//              + 150 g baseline               (resting glycolysis + brain)
//
//   supplied24h = sum(carb grams logged in last 24h) × 0.7
//                                              (~30% of intake goes to non-
//                                              glycogen uses — gluconeogenesis,
//                                              fat oxidation buffer, etc.)
//
// Status thresholds (intentionally coarse — refine when we have more data):
//   replete    >= 1.20         ✓ surplus, ready for hard work
//   moderate    0.80–1.20      ≈ on the line; OK for moderate sessions
//   depleted    0.50–0.80      ↓ Z4–5 capacity likely impaired
//   critical   <  0.50         ↓↓ any sustained effort will feel hard
//
// Confidence is LOW until per-meal timing is reliably populated for the
// 24h window (otherwise the supplied side is a full-day rollup that
// doesn't distinguish "ate 200g carbs 1h ago" from "ate 200g carbs 18h ago").
//
// Narrative metadata: this signal is part of the fuel-timing and
// training-capacity threads. Upstream: meal-timing rows (carb intake).
// Downstream: z4z5 capacity, perceived effort.

const GLYCOGEN_CARB_TO_STORAGE = 0.7;
const GLYCOGEN_BASELINE_G      = 150;
const GLYCOGEN_BURN = { z2: 0.3, z3: 0.5, z45: 1.0 }; // g/min

export function computeGlycogenEstimate(activities, nutritionLog, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const nowMs = opts.nowMs || Date.now();
  const windowMs = nowMs - 24 * 60 * 60 * 1000;

  // ── Burn side: zone minutes over the last 24h from activities ──
  // hrZones is [z1, z2, z3, z4, z5] seconds. Index 0 = Z1 (recovery), not
  // counted; index 3+4 = Z4/Z5 (high-intensity glycolytic). Activities
  // without zone data still contribute via duration heuristic below.
  let z2Min = 0, z3Min = 0, z45Min = 0;
  let zonedDurationSecs = 0;
  let unzonedDurationSecs = 0;
  for (const a of (activities || [])) {
    if (!a?.date) continue;
    // Activity start = startTime (HH:MM) on its date, fallback to noon.
    const startStr = a.startTime || '12:00';
    const tMatch = String(startStr).match(/(\d{1,2}):(\d{2})/);
    const hh = tMatch ? tMatch[1].padStart(2, '0') : '12';
    const mm = tMatch ? tMatch[2] : '00';
    const startMs = new Date(`${a.date}T${hh}:${mm}:00`).getTime();
    const dur = Number(a.durationSecs) || 0;
    if (!Number.isFinite(startMs) || dur <= 0) continue;
    const endMs = startMs + dur * 1000;
    // Overlap with the 24h window.
    const overlapStart = Math.max(startMs, windowMs);
    const overlapEnd   = Math.min(endMs,   nowMs);
    if (overlapEnd <= overlapStart) continue;
    const overlapSecs = (overlapEnd - overlapStart) / 1000;
    // Pro-rate zone seconds by the overlap fraction of total duration.
    const overlapFrac = overlapSecs / dur;
    if (Array.isArray(a.hrZones) && a.hrZones.length === 5) {
      z2Min  += ((a.hrZones[1] || 0) * overlapFrac) / 60;
      z3Min  += ((a.hrZones[2] || 0) * overlapFrac) / 60;
      z45Min += (((a.hrZones[3] || 0) + (a.hrZones[4] || 0)) * overlapFrac) / 60;
      zonedDurationSecs += overlapSecs;
    } else {
      // No zone data — assume conservative Z2 burn for the duration.
      // Activities flagged as 'hard' (high TSS / TE) get bumped into Z3/Z45 mix.
      unzonedDurationSecs += overlapSecs;
      if (isHardSession(a)) {
        z3Min  += (overlapSecs / 2) / 60;
        z45Min += (overlapSecs / 4) / 60;
      } else {
        z2Min += overlapSecs / 60;
      }
    }
  }

  const need24h = Math.round(
    z45Min * GLYCOGEN_BURN.z45 +
    z3Min  * GLYCOGEN_BURN.z3  +
    z2Min  * GLYCOGEN_BURN.z2  +
    GLYCOGEN_BASELINE_G
  );

  // ── Supplied side: carbs logged in last 24h ──
  // Three kinds of rows contribute:
  //   1. Cronometer per-meal rows — explicit `timestamp` field
  //   2. Manual entries — no `timestamp`, but `date` + `time` ("HH:MM") let
  //      us derive an effective timestamp. The user types these via Arnold's
  //      Daily/Fuel tab; without this branch, just-logged meals were
  //      silently skipped and the coach didn't react to them.
  //   3. Cronometer full-day rollup — `meal: 'full-day'`, no timestamp.
  //      Used ONLY when no per-row data exists (avoids double-counting
  //      the same intake from both the rollup AND its per-meal rows).
  let carbsTimestamped = 0;
  let carbsRollupToday = 0;
  let hasTimestampedRows = false;
  for (const e of (nutritionLog || [])) {
    if (!e) continue;
    const carbs = Number(e?.macros?.carbs) || Number(e?.carbs) || 0;
    if (carbs <= 0) continue;

    // Try to extract an effective timestamp.
    let effectiveMs = null;
    if (e.timestamp) {
      const ts = new Date(e.timestamp).getTime();
      if (Number.isFinite(ts)) effectiveMs = ts;
    } else if (e.date && e.meal !== 'full-day') {
      // Manual entry path. e.time is HH:MM (createEntry default = now).
      // Fall back to noon if missing entirely.
      const time = e.time && /^\d{1,2}:\d{2}/.test(e.time) ? e.time : '12:00';
      const ts = new Date(`${e.date}T${time}:00`).getTime();
      if (Number.isFinite(ts)) effectiveMs = ts;
    }

    if (effectiveMs != null) {
      if (effectiveMs >= windowMs && effectiveMs <= nowMs) {
        carbsTimestamped += carbs;
        hasTimestampedRows = true;
      }
    } else if (e.meal === 'full-day' && e.date === today) {
      carbsRollupToday += carbs;
    }
  }

  // Use timestamped data when available; otherwise pro-rate today's rollup
  // by the fraction of the day elapsed (rough — flag as low confidence).
  const carbsForWindow = hasTimestampedRows
    ? carbsTimestamped
    : (() => {
        const elapsedFrac = (() => {
          const startOfToday = new Date(`${today}T00:00:00`).getTime();
          const fracOfDay = Math.max(0, Math.min(1, (nowMs - startOfToday) / 86400000));
          return fracOfDay;
        })();
        // Rollup carbs × fraction-of-today-elapsed. Imprecise but honest.
        return carbsRollupToday * elapsedFrac;
      })();

  const supplied24h = Math.round(carbsForWindow * GLYCOGEN_CARB_TO_STORAGE);

  if (need24h <= 0) {
    return {
      status: 'insufficient',
      reason: 'no-need',
      adequacyRatio: null,
      need24h,
      supplied24h,
      asOf: today,
      narrativeThreads: ['fuel-timing', 'training-capacity'],
      causalUpstream:   ['carbIntakeTimingWindow'],
      causalDownstream: ['z45Capacity', 'perceivedEffort'],
    };
  }

  const adequacyRatio = supplied24h / need24h;

  let status;
  if      (adequacyRatio >= 1.20) status = 'replete';
  else if (adequacyRatio >= 0.80) status = 'moderate';
  else if (adequacyRatio >= 0.50) status = 'depleted';
  else                            status = 'critical';

  const confidence = hasTimestampedRows
    ? (unzonedDurationSecs > zonedDurationSecs ? 'medium' : 'high')
    : 'low';

  return {
    status,
    adequacyRatio: +adequacyRatio.toFixed(2),
    need24h,
    supplied24h,
    breakdown: {
      z45Min: +z45Min.toFixed(0),
      z3Min:  +z3Min.toFixed(0),
      z2Min:  +z2Min.toFixed(0),
      baselineG: GLYCOGEN_BASELINE_G,
      carbsLoggedG: Math.round(carbsForWindow),
      carbsTimingSource: hasTimestampedRows ? 'per-meal' : 'rollup-prorated',
    },
    confidence,
    asOf: today,
    // Narrative metadata (Phase 4r.narrative.0 — see COACH.md v2.6).
    // The eventual narrative engine reads these to graph the signal into
    // storylines. Each signal we ship from here on declares its own.
    narrativeThreads: ['fuel-timing', 'training-capacity'],
    causalUpstream:   ['carbIntakeTimingWindow', 'recentZ45Minutes'],
    causalDownstream: ['z45Capacity', 'perceivedEffort', 'enduranceFeel'],
    note: `${supplied24h}g carbs stored vs ${need24h}g need (24h) = ratio ${adequacyRatio.toFixed(2)}.`,
  };
}

// ─── 10. Polarization index ────────────────────────────────────────────────
// Phase 4r.signals.5. Computes the share of endurance training time spent
// in each of three zone buckets over a rolling 4-week window:
//
//   easy   = Z1 + Z2   (aerobic base, "easy" pace)
//   moderate = Z3       (the "grey zone" / tempo)
//   hard   = Z4 + Z5   (threshold + VO2max)
//
// Stephen Seiler's polarized-training research (validated across endurance
// sports) shows elite endurance distribution clusters near ~80% easy /
// <10% moderate / ~10-15% hard. The canonical amateur mistake is **Z3
// dominance**: too much "moderately hard" work that isn't easy enough to
// build base AND isn't hard enough to drive top-end adaptation. Z3 work
// taxes recovery without proportional fitness return.
//
// Status:
//   polarized   easy ≥ 75% AND moderate ≤ 15%               ✓ sweet spot
//   balanced    easy 60-75% with mixed moderate/hard         ≈ acceptable
//   grey-zone   moderate ≥ 25%                              ⚠ Z3 trap
//   hot         hard ≥ 25%                                  ⚠ over-intense
//   sparse-easy easy < 50%                                  ⚠ not enough base
//   insufficient < 4 zoned endurance activities OR < 3h total

const ENDURANCE_RE = /run|jog|cycl|bike|row|skierg|ski.?erg|erg\b|concept2|swim|ellipt|cardio/i;

function isEnduranceActivity(a) {
  if (!a) return false;
  const blob = [a.activityType, a.type, a.name, a.title, a.workoutType]
    .map(v => String(v || '').toLowerCase())
    .join(' ');
  if (/strength|weight|lift|deadlift|squat|press|barbell|dumbbell|yoga|pilates|mobil/.test(blob)) return false;
  return ENDURANCE_RE.test(blob);
}

export function computePolarizationIndex(activities, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const windowDays = opts.windowDays || 28;
  const startDate = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - (windowDays - 1));
    return d.toISOString().slice(0, 10);
  })();

  const eligible = (activities || []).filter(a =>
    a?.date && a.date >= startDate && a.date <= today &&
    isEnduranceActivity(a) &&
    Array.isArray(a.hrZones) && a.hrZones.length === 5
  );

  let z1Secs = 0, z2Secs = 0, z3Secs = 0, z4Secs = 0, z5Secs = 0;
  for (const a of eligible) {
    z1Secs += Number(a.hrZones[0]) || 0;
    z2Secs += Number(a.hrZones[1]) || 0;
    z3Secs += Number(a.hrZones[2]) || 0;
    z4Secs += Number(a.hrZones[3]) || 0;
    z5Secs += Number(a.hrZones[4]) || 0;
  }
  const totalSecs = z1Secs + z2Secs + z3Secs + z4Secs + z5Secs;

  if (eligible.length < 4 || totalSecs < 3 * 60 * 60) {
    return {
      status: 'insufficient',
      nActivities: eligible.length,
      totalHours: +(totalSecs / 3600).toFixed(1),
      windowDays,
      asOf: today,
      narrativeThreads: ['training-quality', 'fitness-development'],
      causalUpstream:   ['weeklyDistribution', 'workoutTypeMix'],
      causalDownstream: ['vo2maxDevelopment', 'recoveryDemand', 'enduranceImprovement'],
      note: eligible.length < 4
        ? `Need ≥4 zoned endurance sessions (have ${eligible.length}) — polarization needs distribution to be meaningful.`
        : `Need ≥3 hours of zoned endurance work (have ${(totalSecs / 3600).toFixed(1)}h).`,
    };
  }

  const easyPct     = ((z1Secs + z2Secs) / totalSecs) * 100;
  const moderatePct = (z3Secs / totalSecs) * 100;
  const hardPct     = ((z4Secs + z5Secs) / totalSecs) * 100;

  let status;
  if      (moderatePct >= 25)              status = 'grey-zone';
  else if (hardPct     >= 25)              status = 'hot';
  else if (easyPct     <  50)              status = 'sparse-easy';
  else if (easyPct >= 75 && moderatePct <= 15) status = 'polarized';
  else                                     status = 'balanced';

  return {
    status,
    easyPct:     +easyPct.toFixed(1),
    moderatePct: +moderatePct.toFixed(1),
    hardPct:     +hardPct.toFixed(1),
    z1Min: Math.round(z1Secs / 60),
    z2Min: Math.round(z2Secs / 60),
    z3Min: Math.round(z3Secs / 60),
    z4Min: Math.round(z4Secs / 60),
    z5Min: Math.round(z5Secs / 60),
    nActivities: eligible.length,
    totalHours: +(totalSecs / 3600).toFixed(1),
    windowDays,
    asOf: today,
    narrativeThreads: ['training-quality', 'fitness-development'],
    causalUpstream:   ['weeklyDistribution', 'workoutTypeMix'],
    causalDownstream: ['vo2maxDevelopment', 'recoveryDemand', 'enduranceImprovement'],
    note: `Over ${windowDays}d / ${eligible.length} sessions / ${(totalSecs / 3600).toFixed(1)}h: easy ${easyPct.toFixed(0)}% · moderate ${moderatePct.toFixed(0)}% · hard ${hardPct.toFixed(0)}%.`,
  };
}

// ─── 11. Day-of-week patterns ──────────────────────────────────────────────
// Phase 4r.signals.6. Personal-rhythm signal: which weekday is the user's
// HRV consistently lowest, and is the gap meaningful enough to act on?
//
// Most athletes have a stable weekly rhythm (e.g. "Mondays are always
// flat because of the Saturday long run"). The point of this signal isn't
// to discover something everyone already knows — it's to quantify the
// pattern (so the user can see "Tuesdays my HRV is 8ms lower, that's
// real, not in my head") AND to surface the BEST recovery day so the
// user can plan their hardest session to take advantage of it.
//
// Method:
//   1. 90 days of HRV samples.
//   2. Bucket by JS getDay() (0=Sun..6=Sat).
//   3. Compute mean HRV per DOW. Need ≥6 samples per DOW for that DOW
//      to be considered; otherwise skip.
//   4. Compare to overall 90d mean. Gap > 8ms OR > 15% = meaningful.
//
// Returns: { lowestDow, highestDow, spreadMs, spreadPct, perDow, status }
// status:
//   meaningful   — lowest DOW differs from overall by ≥8ms or ≥15%
//   subtle       — variation present but below the meaningful threshold
//   insufficient — < 6 samples on the lowest-sample DOW, or < 60 total samples

const DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function computeDowPatterns(hrvArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const samples = (hrvArr || [])
    .filter(h => h?.date && Number.isFinite(Number(h.value)) && Number(h.value) > 0)
    .map(h => ({ date: h.date, value: Number(h.value) }));

  // Window to last 90 days
  const cutoff = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const recent = samples.filter(s => s.date >= cutoff && s.date <= today);

  if (recent.length < 60) {
    return {
      status: 'insufficient',
      n: recent.length,
      asOf: today,
      narrativeThreads: ['personal-rhythm', 'sleep-recovery', 'training-quality'],
      causalUpstream:   ['weeklySchedulePattern', 'lifestylePatterns'],
      causalDownstream: ['weeklyTrainingOptimization', 'recoveryDayPlanning'],
      note: `Need ≥60 days of HRV samples (have ${recent.length}) for stable day-of-week buckets.`,
    };
  }

  const overallMean = mean(recent.map(s => s.value));

  // Bucket by JS getDay() (0=Sun..6=Sat). Parse the date string as LOCAL
  // (noon-anchored) so DST + UTC quirks don't shift DOW by one.
  const buckets = [[], [], [], [], [], [], []];
  for (const s of recent) {
    const d = new Date(`${s.date}T12:00:00`);
    if (!Number.isFinite(d.getTime())) continue;
    buckets[d.getDay()].push(s.value);
  }

  const perDow = buckets.map((vals, dow) => {
    if (vals.length < 6) {
      return { dow, label: DOW_LABEL[dow], n: vals.length, mean: null, vsOverallMs: null, vsOverallPct: null };
    }
    const m = mean(vals);
    return {
      dow,
      label: DOW_LABEL[dow],
      n: vals.length,
      mean: +m.toFixed(1),
      vsOverallMs:  +(m - overallMean).toFixed(1),
      vsOverallPct: +((m - overallMean) / overallMean * 100).toFixed(1),
    };
  });

  // Only consider DOWs with ≥6 samples for the "winner" / "loser" picks.
  const measurable = perDow.filter(d => d.mean != null);
  if (measurable.length < 5) {
    return {
      status: 'insufficient',
      n: recent.length,
      overallMean: +overallMean.toFixed(1),
      perDow,
      asOf: today,
      narrativeThreads: ['personal-rhythm', 'sleep-recovery', 'training-quality'],
      causalUpstream:   ['weeklySchedulePattern', 'lifestylePatterns'],
      causalDownstream: ['weeklyTrainingOptimization', 'recoveryDayPlanning'],
      note: `Only ${measurable.length}/7 days of the week have ≥6 samples — need at least 5 for a stable comparison.`,
    };
  }

  // Lowest and highest by mean
  const lowestDow  = [...measurable].sort((a, b) => a.mean - b.mean)[0];
  const highestDow = [...measurable].sort((a, b) => b.mean - a.mean)[0];

  const spreadMs  = +(highestDow.mean - lowestDow.mean).toFixed(1);
  const spreadPct = +((highestDow.mean - lowestDow.mean) / overallMean * 100).toFixed(1);

  // Meaningful threshold: lowest DOW is ≥8ms or ≥15% below overall mean.
  // Surfacing the gap, not the absolute value, because what matters is
  // the relative dip on that day.
  const isMeaningful = Math.abs(lowestDow.vsOverallMs) >= 8
                    || Math.abs(lowestDow.vsOverallPct) >= 15;
  const status = isMeaningful ? 'meaningful' : 'subtle';

  return {
    status,
    n: recent.length,
    overallMean: +overallMean.toFixed(1),
    perDow,
    lowestDow,
    highestDow,
    spreadMs,
    spreadPct,
    asOf: today,
    narrativeThreads: ['personal-rhythm', 'sleep-recovery', 'training-quality'],
    causalUpstream:   ['weeklySchedulePattern', 'lifestylePatterns'],
    causalDownstream: ['weeklyTrainingOptimization', 'recoveryDayPlanning'],
    note: `Across ${recent.length} HRV samples over 90d, ${lowestDow.label} averages ${lowestDow.mean}ms (${lowestDow.vsOverallMs > 0 ? '+' : ''}${lowestDow.vsOverallMs}ms vs weekly mean ${overallMean.toFixed(1)}). ${highestDow.label} averages ${highestDow.mean}ms.`,
  };
}

// ─── 12-15. Additional personal correlations (Phase 4r.signals.7) ──────────
// Same statistical scaffolding as computeSleepHrvCorrelation but generalized.
// Each correlation pairs two daily series, runs Pearson r + slope, and
// surfaces an insight when n ≥ surfaceN and |r| ≥ 0.30.
//
// Shipped this phase:
//   12. sleep ↔ next-day RHR              (mirror of v1 sleep↔HRV)
//   13. sleep ↔ next-day run quality (EF)
//   14. daily calorie deficit ↔ next-day HRV
//   15. weekly load ↔ weekly sleep quality (n ≥ 8 weeks, not days)
//
// Each returns the standard correlation shape so patternPersonalCorrelations
// can iterate over them and surface the strongest one as a brief.

function correlationStats(pairs, opts = {}) {
  const surfaceN = opts.surfaceN || 30;
  const minR = opts.minR ?? 0.30;
  const n = pairs.length;
  if (n < 3) return { n, r: null, slope: null, pValue: null, surfaceable: false, status: 'insufficient-data' };
  const xs = pairs.map(p => p.x);
  const ys = pairs.map(p => p.y);
  const r = +pearsonR(xs, ys).toFixed(3);
  const slope = +regressionSlope(xs, ys).toFixed(3);
  const pValue = +approxPValueForR(r, n).toFixed(4);
  const surfaceable = n >= surfaceN && Math.abs(r) >= minR;
  return {
    n, r, slope, pValue, surfaceable,
    status: surfaceable ? 'surfaceable' : (n < surfaceN ? 'building-baseline' : 'weak-signal'),
  };
}

// 12. Sleep ↔ next-day RHR. Lower RHR = better recovery; expect NEGATIVE
// slope (more sleep → lower next-day RHR).
export function computeSleepRhrCorrelation(sleepArr, rhrArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 60;

  const sleepByDate = new Map();
  for (const s of (sleepArr || [])) {
    if (!s?.date) continue;
    const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
    if (Number.isFinite(mins) && mins > 0) sleepByDate.set(s.date, mins / 60);
  }
  const rhrByDate = new Map();
  for (const r of (rhrArr || [])) {
    if (r?.date && Number.isFinite(Number(r.value)) && Number(r.value) > 0) {
      rhrByDate.set(r.date, Number(r.value));
    }
  }

  const pairs = [];
  for (const [date, sleepHrs] of sleepByDate) {
    if (!inWindow(date, today, lookbackDays)) continue;
    const nextDay = daysAgo(date, -1);
    const nextRhr = rhrByDate.get(nextDay);
    if (nextRhr != null) pairs.push({ x: sleepHrs, y: nextRhr });
  }
  const stats = correlationStats(pairs);

  const insight = stats.surfaceable
    ? `+1h sleep ≈ ${stats.slope > 0 ? '+' : ''}${stats.slope.toFixed(1)}bpm RHR next day (n=${stats.n}, r=${stats.r.toFixed(2)})`
    : null;

  return {
    ...stats,
    insight,
    asOf: today,
    narrativeThreads: ['personal-rhythm', 'sleep-recovery'],
    causalUpstream:   ['sleepDuration'],
    causalDownstream: ['nextDayRhr'],
  };
}

// 13. Sleep ↔ next-day run quality (Efficiency Factor = NGP / avgHR for a
// run). EF rises as fitness improves; insufficient sleep should depress
// next-day EF (slower at same HR). Expect POSITIVE slope.
export function computeSleepRunQualityCorrelation(sleepArr, activities, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 90;

  const sleepByDate = new Map();
  for (const s of (sleepArr || [])) {
    if (!s?.date) continue;
    const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
    if (Number.isFinite(mins) && mins > 0) sleepByDate.set(s.date, mins / 60);
  }

  // Run quality = NGP m/s ÷ avg HR. Each run on day D gets paired with
  // sleep from D-1. Filter to qualifying runs (≥3 mi, ≥15 min, with HR).
  const pairs = [];
  for (const a of (activities || [])) {
    if (!a?.date || !inWindow(a.date, today, lookbackDays)) continue;
    const isRunLike = String(a.activityType || a.type || '').toLowerCase().includes('run')
                   || /run|jog/i.test(String(a.name || a.title || ''));
    if (!isRunLike) continue;
    const distMi = Number(a.distanceMi || a.distance_mi);
    const dur    = Number(a.durationSecs);
    const avgHr  = Number(a.avgHR);
    if (!Number.isFinite(distMi) || distMi < 3) continue;
    if (!Number.isFinite(dur) || dur < 15 * 60) continue;
    if (!Number.isFinite(avgHr) || avgHr <= 0) continue;
    // m/s of forward motion ÷ HR — same shape as EF used in the Trend tab.
    const distM = distMi * 1609.34;
    const pace_mps = distM / dur;
    const ef = +(pace_mps / avgHr).toFixed(4);
    const prevDaySleep = sleepByDate.get(daysAgo(a.date, 1));
    if (prevDaySleep == null) continue;
    pairs.push({ x: prevDaySleep, y: ef });
  }
  const stats = correlationStats(pairs, { surfaceN: 20 }); // runs are sparser than daily HRV

  const insight = stats.surfaceable
    ? `+1h sleep ≈ ${stats.slope > 0 ? '+' : ''}${(stats.slope * 1000).toFixed(2)} EF×1000 next-day run (n=${stats.n}, r=${stats.r.toFixed(2)})`
    : null;

  return {
    ...stats,
    insight,
    asOf: today,
    narrativeThreads: ['personal-rhythm', 'training-quality', 'sleep-recovery'],
    causalUpstream:   ['sleepDuration'],
    causalDownstream: ['runEfficiencyTomorrow', 'paceAtSameHR'],
  };
}

// 14. Daily calorie deficit ↔ next-day HRV. Deficit (negative kcal) should
// correlate with depressed HRV next day. Expect POSITIVE slope (less
// deficit → higher HRV).
export function computeDeficitHrvCorrelation(opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 60;
  const intakeByDate = opts.intakeByDate;
  const tdeeByDate   = opts.tdeeByDate;     // function (date) => tdee, or Map
  const hrvByDate    = opts.hrvByDate;      // Map

  if (!intakeByDate || !tdeeByDate || !hrvByDate) {
    return { n: 0, r: null, slope: null, pValue: null, surfaceable: false,
             status: 'insufficient-data', insight: null, asOf: today,
             narrativeThreads: ['personal-rhythm', 'cut-adaptation'],
             causalUpstream: ['dailyDeficit'],
             causalDownstream: ['nextDayHrv'] };
  }

  const getTdee = typeof tdeeByDate === 'function' ? tdeeByDate : (d) => tdeeByDate.get(d);
  const getIntake = typeof intakeByDate === 'function' ? intakeByDate : (d) => intakeByDate.get(d);

  const pairs = [];
  // Walk every day in window where we have BOTH intake and next-day HRV.
  const start = new Date(today + 'T00:00:00');
  for (let i = 0; i < lookbackDays; i++) {
    const d = new Date(start); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const intake = Number(getIntake(ds)) || 0;
    const tdee   = Number(getTdee(ds))   || 0;
    if (intake <= 0 || tdee <= 0) continue;
    const balance = intake - tdee;    // negative = deficit
    const nextHrv = hrvByDate.get(daysAgo(ds, -1));
    if (nextHrv == null) continue;
    pairs.push({ x: balance, y: nextHrv });
  }
  const stats = correlationStats(pairs);

  const insight = stats.surfaceable
    ? `−500 kcal/day deficit ≈ ${(stats.slope * -500).toFixed(1)}ms HRV next day (n=${stats.n}, r=${stats.r.toFixed(2)})`
    : null;

  return {
    ...stats,
    insight,
    asOf: today,
    narrativeThreads: ['personal-rhythm', 'cut-adaptation', 'sleep-recovery'],
    causalUpstream:   ['dailyDeficit', 'fuelTiming'],
    causalDownstream: ['nextDayHrv', 'recoveryQuality'],
  };
}

// 15. Weekly load ↔ weekly sleep quality. Higher load WEEK → expect either
// no effect (well-recovered) or reduced sleep quality (overreaching).
// Bucket by week (Mon-Sun), require ≥8 weeks.
export function computeLoadSleepCorrelation(activities, sleepArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 90;
  const cutoff = daysAgo(today, lookbackDays - 1);

  // Week key = ISO-ish "YYYY-W##" via Monday-anchored week-of-year.
  function weekKey(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (!Number.isFinite(d.getTime())) return null;
    // Move to Monday of that week
    const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
    d.setDate(d.getDate() - dow);
    return d.toISOString().slice(0, 10); // Monday's date as the week key
  }

  const loadByWeek = new Map();
  for (const a of (activities || [])) {
    if (!a?.date || a.date < cutoff || a.date > today) continue;
    const wk = weekKey(a.date);
    if (!wk) continue;
    const tss = Number(a.tss || a.rTSS || a.hrTSS || a.trainingStressScore) || 0;
    loadByWeek.set(wk, (loadByWeek.get(wk) || 0) + tss);
  }
  const sleepByWeek = new Map(); // wk -> { sum, n }
  for (const s of (sleepArr || [])) {
    if (!s?.date || s.date < cutoff || s.date > today) continue;
    const wk = weekKey(s.date);
    if (!wk) continue;
    const mins = Number(s.totalSleepMinutes ?? s.durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) continue;
    const cur = sleepByWeek.get(wk) || { sum: 0, n: 0 };
    cur.sum += mins / 60;
    cur.n   += 1;
    sleepByWeek.set(wk, cur);
  }

  const pairs = [];
  for (const [wk, totalTss] of loadByWeek) {
    const sl = sleepByWeek.get(wk);
    if (!sl || sl.n < 5 || totalTss <= 0) continue; // need ≥5 sleep nights in the week
    pairs.push({ x: totalTss, y: sl.sum / sl.n });
  }
  const stats = correlationStats(pairs, { surfaceN: 8 }); // weeks not days

  const insight = stats.surfaceable
    ? `+100 TSS / week ≈ ${stats.slope > 0 ? '+' : ''}${(stats.slope * 100).toFixed(2)}h avg sleep that week (n=${stats.n} weeks, r=${stats.r.toFixed(2)})`
    : null;

  return {
    ...stats,
    insight,
    asOf: today,
    narrativeThreads: ['personal-rhythm', 'training-capacity', 'sleep-recovery'],
    causalUpstream:   ['weeklyLoad'],
    causalDownstream: ['weeklySleepQuality', 'recoveryDemand'],
  };
}

// ─── 16. Sleep quality (architecture) ──────────────────────────────────────
// Phase 4r.signals.8a. Sleep DURATION is one signal (computeSleepDebt
// already shipped). Sleep QUALITY — what those hours actually delivered —
// is a separate one, derived from Garmin's stage breakdown (deep / REM /
// light / awake minutes) that's been arriving in storage but unread.
//
// Why this matters: an 8h night with 6% deep is far less restorative than
// a 7h night with 15% deep. The recovery-velocity brief was firing on
// "your HRV isn't bouncing back" without any way to point at WHY when
// the user was actually sleeping enough hours. This closes that gap.
//
// Targets (sleep-medicine consensus for trained adults):
//   • deep%       ≥ 13% of total sleep (Stage N3 — physical restoration)
//   • rem%        ≥ 18% of total sleep (cognitive consolidation + autonomic)
//   • efficiency  ≥ 85% (asleep ÷ (asleep + awake))
//   • awake count ≤ 3 wake events per night (continuity)
//
// Status (over the last 7-night window):
//   restorative  — meets ≥3 of 4 targets
//   mixed        — meets 2 of 4
//   impaired     — meets ≤ 1 of 4
//   insufficient — < 5 nights of stage data in the window

export function computeSleepQuality(sleepArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 7;

  const recent = (sleepArr || [])
    .filter(s => s?.date && inWindow(s.date, today, lookbackDays))
    .filter(s => Number(s.totalSleepMinutes) > 0)
    .filter(s => Number.isFinite(Number(s.deepMinutes)) || Number.isFinite(Number(s.remMinutes)));

  if (recent.length < 5) {
    return {
      status: 'insufficient',
      n: recent.length,
      asOf: today,
      narrativeThreads: ['sleep-recovery', 'training-quality'],
      causalUpstream:   ['sleepEnvironment', 'stress', 'alcoholEvening', 'lateMeals'],
      causalDownstream: ['nextDayHrv', 'nextDayRunQuality', 'cognitiveSharpness'],
      note: `Need ≥5 nights of Garmin sleep-stage data in the last ${lookbackDays} days (have ${recent.length}).`,
    };
  }

  // Per-night targets met (boolean array) + per-night percentages
  let deepHits = 0, remHits = 0, effHits = 0, awakeHits = 0;
  let deepSum = 0, remSum = 0, effSum = 0, awakeSum = 0;
  for (const s of recent) {
    const total = Number(s.totalSleepMinutes) || 0;
    const deep  = Number(s.deepMinutes)  || 0;
    const rem   = Number(s.remMinutes)   || 0;
    const awake = Number(s.awakeMinutes) || 0;
    const wakeCt= Number(s.awakeCount)   || 0;
    if (total <= 0) continue;
    const deepPct = (deep / total) * 100;
    const remPct  = (rem  / total) * 100;
    const eff     = total / (total + awake) * 100;   // proxy — Garmin's reported eff isn't always present
    deepSum += deepPct;
    remSum  += remPct;
    effSum  += eff;
    awakeSum += wakeCt;
    if (deepPct >= 13) deepHits++;
    if (remPct  >= 18) remHits++;
    if (eff     >= 85) effHits++;
    if (wakeCt  <= 3)  awakeHits++;
  }
  const n = recent.length;

  // Aggregate scoring: targets met over the window
  const deepAvgPct  = +(deepSum / n).toFixed(1);
  const remAvgPct   = +(remSum / n).toFixed(1);
  const effAvgPct   = +(effSum / n).toFixed(1);
  const awakeAvg    = +(awakeSum / n).toFixed(1);

  const targetsMet = [
    deepAvgPct  >= 13,
    remAvgPct   >= 18,
    effAvgPct   >= 85,
    awakeAvg    <= 3,
  ].filter(Boolean).length;

  let status;
  if      (targetsMet >= 3) status = 'restorative';
  else if (targetsMet >= 2) status = 'mixed';
  else                       status = 'impaired';

  // Which dimension is the weakest? (for brief routing)
  const weaknesses = [];
  if (deepAvgPct < 13)  weaknesses.push({ key: 'deep',  label: 'deep sleep', actual: `${deepAvgPct}%`, target: '≥13%' });
  if (remAvgPct  < 18)  weaknesses.push({ key: 'rem',   label: 'REM sleep',  actual: `${remAvgPct}%`,  target: '≥18%' });
  if (effAvgPct  < 85)  weaknesses.push({ key: 'eff',   label: 'efficiency', actual: `${effAvgPct}%`,  target: '≥85%' });
  if (awakeAvg   > 3)   weaknesses.push({ key: 'awake', label: 'continuity', actual: `${awakeAvg} wakes/night`, target: '≤3' });

  return {
    status,
    n,
    targetsMet,
    deepAvgPct,
    remAvgPct,
    effAvgPct,
    awakeAvg,
    weaknesses,
    asOf: today,
    narrativeThreads: ['sleep-recovery', 'training-quality'],
    causalUpstream:   ['sleepEnvironment', 'stress', 'alcoholEvening', 'lateMeals'],
    causalDownstream: ['nextDayHrv', 'nextDayRunQuality', 'cognitiveSharpness'],
    note: `Over ${n} nights: deep ${deepAvgPct}% · rem ${remAvgPct}% · eff ${effAvgPct}% · awakes/night ${awakeAvg}. ${targetsMet}/4 targets met.`,
  };
}

// ─── 17. Garmin readiness cross-check ──────────────────────────────────────
// Phase 4r.signals.8b. Garmin's "training readiness" score (0-100) is its
// own composite: sleep history + recovery time + ACWR + HRV + stress.
// Each factor has a percent contribution exposed in the payload. We've
// been ingesting these for months but reading none of them.
//
// Reads it as a CROSS-CHECK against Arnold's own assessments:
//   • If BOTH Arnold and Garmin say "elevated recovery cost," that's
//     high-confidence — surface as a stronger brief.
//   • If Arnold says concern but Garmin's readiness is high, surface as
//     "Arnold's reading something Garmin's missing" (rare but useful).
//   • If Garmin says concern but Arnold doesn't, surface the gap with the
//     Garmin factor breakdown — usually reveals which input we're missing.
//
// Status:
//   strong   — readiness ≥ 75. Garmin says go.
//   moderate — 50-75. Mixed signal.
//   limited  — 25-50. Caution band.
//   poor     — < 25. Garmin says stop.
//   insufficient — no recent readiness row in storage.
//
// `weakestFactor` is the factor with the lowest contribution percent;
// it points at which axis Garmin thinks is dragging the score down.

export function computeGarminReadiness(wellnessArr, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const lookbackDays = opts.lookbackDays || 3; // most recent within 3 days

  const recent = (wellnessArr || [])
    .filter(w => w?.date && inWindow(w.date, today, lookbackDays))
    .filter(w => Number.isFinite(Number(w.trainingReadiness)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = recent[0];

  if (!latest) {
    return {
      status: 'insufficient',
      asOf: today,
      narrativeThreads: ['recovery-readiness', 'training-quality'],
      causalUpstream:   ['sleepHistory', 'recoveryTime', 'acwr', 'hrv', 'stressHistory'],
      causalDownstream: ['todaySessionQuality', 'load-tolerance'],
      note: 'No Garmin training-readiness row in the last 3 days.',
    };
  }

  const score = Number(latest.trainingReadiness);
  let status;
  if      (score >= 75) status = 'strong';
  else if (score >= 50) status = 'moderate';
  else if (score >= 25) status = 'limited';
  else                  status = 'poor';

  // Pick the lowest-contributing factor as the "weakest" signal.
  const factors = [
    { key: 'sleep',     label: 'sleep history',  pct: Number(latest.sleepHistoryFactorPercent) },
    { key: 'recovery',  label: 'recovery time',  pct: Number(latest.recoveryTimeFactorPercent) },
    { key: 'acwr',      label: 'training load (ACWR)', pct: Number(latest.acwrFactorPercent) },
    { key: 'hrv',       label: 'HRV',            pct: Number(latest.hrvFactorPercent) },
    { key: 'stress',    label: 'stress history', pct: Number(latest.stressHistoryFactorPercent) },
  ].filter(f => Number.isFinite(f.pct));

  const weakestFactor = factors.length
    ? factors.sort((a, b) => a.pct - b.pct)[0]
    : null;

  return {
    status,
    score,
    level: latest.trainingReadinessLevel || null,
    feedback: latest.trainingReadinessFeedback || null,
    recoveryHours: Number.isFinite(Number(latest.recoveryHours)) ? Number(latest.recoveryHours) : null,
    factors,
    weakestFactor,
    asOf: today,
    rowDate: latest.date,
    narrativeThreads: ['recovery-readiness', 'training-quality'],
    causalUpstream:   ['sleepHistory', 'recoveryTime', 'acwr', 'hrv', 'stressHistory'],
    causalDownstream: ['todaySessionQuality', 'load-tolerance'],
    note: `Garmin readiness ${score} (${latest.trainingReadinessLevel || '—'}). Weakest factor: ${weakestFactor?.label || '—'} (${weakestFactor?.pct ?? '—'}%).`,
  };
}

// ─── 18. Upcoming plan ─────────────────────────────────────────────────────
// Phase 4r.narrative.2.2. Reads the weekly planner so the coach has
// forward-looking context — "you have intervals scheduled tomorrow" is
// often the missing piece that turns "your glycogen is depleted" into an
// actionable trade-off rather than a standalone observation.
//
// Walks the next 7 days, tagging each with an intensity class derived from
// the planned type:
//   rest      → mobility, rest, (or empty/null entry)
//   easy      → easy_run, cross
//   moderate  → long_run, strength, tempo
//   hard      → intervals, hiit, race
//
// Surfaces:
//   • next7Days  — array of { date, daysOut, dow, planned, intensityClass }
//   • todayPlanned — today's entry (for completion-check briefs)
//   • nextHardSession — soonest day where intensityClass === 'hard'
//   • nextRestDay — soonest day where intensityClass === 'rest'
//
// Status:
//   has-plan      — at least one non-null/non-rest day in the next 7
//   only-rest     — all 7 days are rest/empty (deload week or no plan)
//   insufficient  — storage('planner') is empty (no plan ever entered)
//
// Pure transformer — orchestrator provides plannerData (already read from
// storage) and weekKeyFor/nextWeekKeyFor helpers so this module stays
// storage-free, same pattern as the other v2 signals.

const PLAN_INTENSITY = {
  rest: 'rest',      mobility: 'rest',
  easy_run: 'easy',  cross: 'easy',
  long_run: 'moderate', strength: 'moderate', tempo: 'moderate',
  intervals: 'hard', hiit: 'hard', race: 'hard',
};

const PLAN_LABEL = {
  easy_run: 'Easy run',  long_run: 'Long run', tempo: 'Tempo',
  intervals: 'Intervals', strength: 'Strength', hiit: 'HIIT',
  mobility: 'Mobility', cross: 'Cross-train', rest: 'Rest', race: 'Race',
};

// Phase 4r.narrative.5.fix.18 — does this logged activity match the planned
// session type? Used to mark next7Days[i].done = true once the user has
// completed (or done something matching) today's plan. Without this the
// narrative composer says "Today is HIIT on the plan, which compounds the
// issue" even after the HIIT lands in storage; with this it can flip to a
// past-tense framing.
function _activityMatchesPlanType(activity, plannedType) {
  if (!activity || !plannedType) return false;
  const cls = activityKind(activity); // 'mobility'|'hiit'|'run'|'strength'|'cycling'|'swim'|'other'
  const hard = isHardSession(activity);
  switch (plannedType) {
    case 'hiit':
    case 'intervals': return cls === 'hiit' || (cls === 'run' && hard);
    case 'tempo':     return cls === 'run' && hard;
    case 'easy_run':
    case 'long_run':  return cls === 'run';
    case 'strength':  return cls === 'strength' || cls === 'hiit'; // hyrox-style counts
    case 'cross':     return cls === 'cycling' || cls === 'swim' || cls === 'other';
    case 'mobility':  return cls === 'mobility';
    case 'race':      return cls === 'run' || cls === 'hiit' || cls === 'strength';
    case 'rest':      return false; // rest "completed" doesn't make sense
    default:          return false;
  }
}

export function computeUpcomingPlan(plannerData, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const horizonDays = opts.horizonDays || 7;
  // Phase 4r.narrative.5.fix.18 — activities provide completion awareness.
  // Optional; when absent, `done` stays null and the composer falls back to
  // the legacy plan-centric phrasing (no regression).
  const activities = Array.isArray(opts.activities) ? opts.activities : [];
  const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Pre-index activities by date for O(1) per-day lookup during the walk.
  const actsByDate = {};
  for (const a of activities) {
    if (!a?.date) continue;
    (actsByDate[a.date] = actsByDate[a.date] || []).push(a);
  }

  // plannerData shape: { [mondayDateStr]: { weekStart, days: [Mon..Sun] } }
  if (!plannerData || typeof plannerData !== 'object' || Object.keys(plannerData).length === 0) {
    return {
      status: 'insufficient',
      next7Days: [],
      todayPlanned: null,
      nextHardSession: null,
      nextRestDay: null,
      asOf: today,
      narrativeThreads: ['training-schedule'],
      causalUpstream:   ['userPlannerInput'],
      causalDownstream: ['todayActionContext', 'fuelTimingDecision', 'recoveryPlanning'],
      note: 'No planner data — storage("planner") is empty.',
    };
  }

  // Look up a week by Monday-anchored key. Build keys directly so we don't
  // need to import weekStart/weekKey here (keeps this module pure).
  function mondayOf(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    if (!Number.isFinite(d.getTime())) return null;
    const dow = (d.getDay() + 6) % 7; // 0=Mon..6=Sun
    d.setDate(d.getDate() - dow);
    return d.toISOString().slice(0, 10);
  }
  function plannedFor(dateStr) {
    const wk = plannerData[mondayOf(dateStr)];
    if (!wk?.days) return null;
    const d = new Date(dateStr + 'T12:00:00');
    const idx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
    return wk.days[idx] || null;
  }
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function dowOf(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return DOW_SHORT[d.getDay()];
  }

  // Walk today + next horizonDays-1 days.
  const next7Days = [];
  for (let i = 0; i < horizonDays; i++) {
    const ds = addDays(today, i);
    const planned = plannedFor(ds);
    const type = planned?.type || null;
    const intensityClass = type ? (PLAN_INTENSITY[type] || 'unknown') : 'rest';

    // Phase 4r.narrative.5.fix.18 — has the planned session been done?
    //   • null when there's no plan or no activities passed
    //   • true when ≥1 logged activity on this date matches the planned type
    //   • false when there's a plan but nothing matching logged yet
    // For past dates this gives us a clean "missed/completed" trace; for
    // today it flips at the moment Garmin/manual log lands.
    let done = null;
    if (type && type !== 'rest') {
      const todays = actsByDate[ds] || [];
      done = todays.some(a => _activityMatchesPlanType(a, type));
    }

    next7Days.push({
      date: ds,
      daysOut: i,
      dow: dowOf(ds),
      planned,
      intensityClass,
      label: type ? (PLAN_LABEL[type] || type) : 'Rest',
      done,
    });
  }

  const todayPlanned = next7Days[0];
  const nextHardSession = next7Days.find(d => d.intensityClass === 'hard') || null;
  const nextRestDay     = next7Days.slice(1).find(d => d.intensityClass === 'rest') || null;
  const anyNonRest      = next7Days.some(d => d.intensityClass !== 'rest');

  return {
    status: anyNonRest ? 'has-plan' : 'only-rest',
    next7Days,
    todayPlanned,
    nextHardSession,
    nextRestDay,
    asOf: today,
    narrativeThreads: ['training-schedule'],
    causalUpstream:   ['userPlannerInput'],
    causalDownstream: ['todayActionContext', 'fuelTimingDecision', 'recoveryPlanning'],
    note: nextHardSession
      ? `Next hard session: ${nextHardSession.label} on ${nextHardSession.dow} (${nextHardSession.daysOut === 0 ? 'today' : `+${nextHardSession.daysOut}d`}).`
      : `No hard session in the next ${horizonDays} days.`,
  };
}

// ─── 19. Goal progress ─────────────────────────────────────────────────────
// Phase 4r.narrative.2.3. Reads the user's outcome goal (target weight,
// required pace) + recent weight history, computes actual pace vs required
// pace, projects weeks-to-target at current rate. Macro-horizon signal:
// the lens through which today's micro decisions get framed.
//
// Why it's not "just" a tile metric:
//   The narrative needs to say things like "this week sits inside week 6 of
//   a 12-week cut, slightly behind pace — fixing today's sleep matters
//   more than usual because the runway is shorter than the plan." That
//   framing requires the signal to know the SHAPE of progress (where on
//   the curve, how much room left), not just the latest number.
//
// Inputs (orchestrator computes / reads):
//   weightArr  — [{ date, lbs }] history. Latest entries used as "current".
//   outcomeGoal — from getOutcomeGoal(): { targetWeightLbs, lbsToLose,
//                 requiredLossRatePerWeek, races }
//   weeksWindow — how many weeks back to compute actual pace (default 4)
//
// Status:
//   achieved     — within 0.5 lb of target. Cut is done.
//   ahead        — paceRatio ≥ 1.15. Losing faster than required.
//   on-pace      — paceRatio in [0.85, 1.15]. Right band.
//   behind       — paceRatio in [0.30, 0.85]. Losing but slower than plan.
//   stalled      — paceRatio < 0.30 OR moving wrong direction. Cut isn't
//                  working — leverage candidate, look upstream for cause.
//   no-goal      — user hasn't set an outcome goal, or lbsToLose = 0.
//   insufficient — < 4 weight readings OR < 14 day span.
//
// paceRatio interpretation:
//   For cut goals (lbsToLose > 0): positive actual rate = losing weight.
//     paceRatio = actualLossRate / requiredLossRate.
//   For bulk goals (lbsToLose < 0): negative actual rate = gaining weight.
//     paceRatio = actualGainRate / requiredGainRate.
//   For maintain (lbsToLose ≈ 0): paceRatio = 1 - |actualRate| / 0.5 lb/wk
//     (i.e., "holding steady" tolerance).

export function computeGoalProgress(weightArr, outcomeGoal, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const weeksWindow = opts.weeksWindow || 4;
  const baseShape = {
    asOf: today,
    narrativeThreads: ['cut-progress', 'long-term-arc'],
    causalUpstream:   ['tdeeDrift', 'energyAvailability', 'deficitConsistency'],
    causalDownstream: ['outcomeTimeline', 'phaseStrategy'],
  };

  if (!outcomeGoal || !Number.isFinite(Number(outcomeGoal.targetWeightLbs))) {
    return { ...baseShape, status: 'no-goal', note: 'No outcome goal set.' };
  }

  // Filter + sort weight readings into a clean ascending series.
  const series = (weightArr || [])
    .filter(w => w?.date && Number.isFinite(Number(w.lbs ?? w.weightLbs ?? w.value)))
    .map(w => ({ date: w.date, lbs: Number(w.lbs ?? w.weightLbs ?? w.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (series.length < 4) {
    return { ...baseShape, status: 'insufficient', n: series.length,
             note: `Need ≥4 weight readings (have ${series.length}).` };
  }

  // Latest weight = most recent reading.
  const latest = series[series.length - 1];
  const currentLbs = latest.lbs;
  const targetLbs  = Number(outcomeGoal.targetWeightLbs);
  const lbsToLose  = Number(outcomeGoal.lbsToLose);  // signed (positive = cut, negative = bulk)
  const requiredRatePerWeek = Math.abs(Number(outcomeGoal.requiredLossRatePerWeek) || 0);

  const goalKind = Math.abs(lbsToLose) <= 0.5 ? 'maintain'
                 : lbsToLose > 0 ? 'cut' : 'bulk';

  // Remaining work toward target (signed for direction).
  const remainingLbsSigned = currentLbs - targetLbs;
  const remainingLbs = Math.abs(remainingLbsSigned);

  // Achieved check — within 0.5 lb of target for cut/bulk; within 1 lb for maintain.
  const achievedTolerance = goalKind === 'maintain' ? 1.0 : 0.5;
  if (remainingLbs <= achievedTolerance) {
    return { ...baseShape, status: 'achieved', goalKind,
             currentLbs, targetLbs, remainingLbs: +remainingLbs.toFixed(1),
             note: `Within ${achievedTolerance} lb of target — goal achieved.` };
  }

  // No defined rate → can't score pace; surface as informational only.
  if (goalKind !== 'maintain' && requiredRatePerWeek <= 0) {
    return { ...baseShape, status: 'no-goal', goalKind,
             currentLbs, targetLbs, remainingLbs: +remainingLbs.toFixed(1),
             note: 'Outcome goal has no required pace defined.' };
  }

  // Compute actual rate over the lookback window via simple endpoint diff
  // (less noisy than per-day slope when readings are sparse). Pick the
  // earliest reading within the window as the anchor.
  const windowStart = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - weeksWindow * 7);
    return d.toISOString().slice(0, 10);
  })();
  const inWindow = series.filter(s => s.date >= windowStart && s.date <= today);
  if (inWindow.length < 2) {
    return { ...baseShape, status: 'insufficient', goalKind,
             currentLbs, targetLbs, remainingLbs: +remainingLbs.toFixed(1),
             n: inWindow.length,
             note: `Need ≥2 weight readings in last ${weeksWindow} weeks (have ${inWindow.length}).` };
  }
  const oldest = inWindow[0];
  const daysSpanned = (new Date(latest.date) - new Date(oldest.date)) / 86400000;
  if (daysSpanned < 14) {
    return { ...baseShape, status: 'insufficient', goalKind,
             currentLbs, targetLbs, remainingLbs: +remainingLbs.toFixed(1),
             n: inWindow.length,
             note: `Need ≥14 day span of weight readings (have ${Math.round(daysSpanned)}d).` };
  }
  const weeksSpanned = daysSpanned / 7;
  // actualRatePerWeek > 0 means losing weight; < 0 means gaining.
  const actualRatePerWeek = (oldest.lbs - latest.lbs) / weeksSpanned;
  // For cut: progress = losing weight (positive actualRate).
  // For bulk: progress = gaining weight (negative actualRate, so flip sign).
  // For maintain: progress = staying close to zero — paceRatio computed differently.
  let progressRate, paceRatio, weeksToGoalAtActual;
  if (goalKind === 'cut') {
    progressRate = actualRatePerWeek;       // positive when progressing
    paceRatio = requiredRatePerWeek > 0 ? progressRate / requiredRatePerWeek : 0;
    weeksToGoalAtActual = progressRate > 0 ? remainingLbs / progressRate : null;
  } else if (goalKind === 'bulk') {
    progressRate = -actualRatePerWeek;      // positive when progressing (gaining)
    paceRatio = requiredRatePerWeek > 0 ? progressRate / requiredRatePerWeek : 0;
    weeksToGoalAtActual = progressRate > 0 ? remainingLbs / progressRate : null;
  } else {
    // maintain — paceRatio 1.0 when actual drift is ≤ 0.2 lb/wk in either direction
    const drift = Math.abs(actualRatePerWeek);
    paceRatio = drift <= 0.2 ? 1.0 : Math.max(0, 1 - (drift - 0.2) / 0.5);
    progressRate = -drift;  // negative = drift away from maintenance
    weeksToGoalAtActual = null;
  }

  // Status classification
  let status;
  if      (paceRatio >= 1.15) status = 'ahead';
  else if (paceRatio >= 0.85) status = 'on-pace';
  else if (paceRatio >= 0.30) status = 'behind';
  else                        status = 'stalled';

  const weeksToGoalAtRequired = requiredRatePerWeek > 0
    ? remainingLbs / requiredRatePerWeek
    : null;

  return {
    ...baseShape,
    status,
    goalKind,
    currentLbs: +currentLbs.toFixed(1),
    targetLbs: +targetLbs.toFixed(1),
    remainingLbs: +remainingLbs.toFixed(1),
    actualRatePerWeek: +actualRatePerWeek.toFixed(2),
    progressRatePerWeek: +progressRate.toFixed(2),
    requiredRatePerWeek: +requiredRatePerWeek.toFixed(2),
    paceRatio: +paceRatio.toFixed(2),
    weeksToGoalAtActualRate: weeksToGoalAtActual != null ? +weeksToGoalAtActual.toFixed(1) : null,
    weeksToGoalAtRequiredRate: weeksToGoalAtRequired != null ? +weeksToGoalAtRequired.toFixed(1) : null,
    weeksSpanned: +weeksSpanned.toFixed(1),
    n: inWindow.length,
    note: weeksToGoalAtActual != null
      ? `${remainingLbs.toFixed(1)} lb to target at ${progressRate.toFixed(2)} lb/wk → ${weeksToGoalAtActual.toFixed(1)} wk remaining (plan: ${weeksToGoalAtRequired?.toFixed(1) || '?'} wk).`
      : `${remainingLbs.toFixed(1)} lb to target — rate not converging at the moment.`,
  };
}

// ─── 20. Race horizon + training phase ─────────────────────────────────────
// Phase 4r.narrative.2.4. Reads the user's upcoming races + outcome goal,
// identifies the soonest future race, and derives the current training
// phase from weeks-out. The phase is what biases everything in race-prep
// coaching — what to push, what to back off, when to taper, when nutrition
// shifts from cut → maintenance, etc.
//
// Phase boundaries (weeks-until-race):
//
//   ≥ 12     base       — aerobic engine, volume up, intensity moderate
//   6 to 12  build      — race-specific intensity, sustain volume
//   3 to 6   peak       — race-pace work, sharpening, volume tapers
//   1 to 3   taper      — volume drops sharply, intensity stays, sleep up
//   0 to 1   race-week  — minimal load, fuel + sleep are the leverage
//   −2 to 0  recovery   — post-race rebuild
//   ∞       general    — no upcoming race, no phase bias
//
// Cut–race interaction:
//   A calorie deficit competes directly with race performance during the
//   final 3-4 weeks. The signal exposes `phaseConflict: 'cut-vs-taper'`
//   when the user is mid-cut AND we're inside the taper window. The
//   macro narrative uses this to flag "wind down the cut before race week."

const PHASE_LABEL = {
  base:       'Base',
  build:      'Build',
  peak:       'Peak',
  taper:      'Taper',
  'race-week': 'Race week',
  recovery:   'Post-race recovery',
  general:    'General training',
};

function phaseForWeeksOut(weeksOut) {
  if (weeksOut < 0) {
    if (weeksOut >= -2) return 'recovery';
    return 'general';
  }
  if (weeksOut < 1)  return 'race-week';
  if (weeksOut < 3)  return 'taper';
  if (weeksOut < 6)  return 'peak';
  if (weeksOut < 12) return 'build';
  return 'base';
}

export function computeRaceHorizon(outcomeGoal, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const baseShape = {
    asOf: today,
    narrativeThreads: ['race-prep', 'long-term-arc'],
    causalUpstream:   ['weeklyLoad', 'polarization', 'goalCalendar'],
    causalDownstream: ['raceReadiness', 'tapingStrategy', 'fuelingStrategy'],
  };

  const races = Array.isArray(outcomeGoal?.races) ? outcomeGoal.races : [];
  const todayMs = new Date(today + 'T12:00:00').getTime();

  // Find the soonest future race AND the most recent past race within 2 weeks
  // (for the recovery phase).
  const upcoming = races
    .filter(r => r?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)))
    .map(r => ({ ...r, dateMs: new Date(r.date + 'T12:00:00').getTime() }))
    .filter(r => Number.isFinite(r.dateMs));

  const future = upcoming.filter(r => r.dateMs >= todayMs).sort((a, b) => a.dateMs - b.dateMs);
  const recent = upcoming.filter(r => r.dateMs < todayMs).sort((a, b) => b.dateMs - a.dateMs);

  // Prefer the soonest future race. If none, check if a recent race
  // (within 2 weeks past) puts us in the recovery phase.
  let race = future[0] || null;
  let recovering = false;
  if (!race && recent[0]) {
    const weeksPast = (todayMs - recent[0].dateMs) / (7 * 86400000);
    if (weeksPast <= 2) {
      race = recent[0];
      recovering = true;
    }
  }

  if (!race) {
    return {
      ...baseShape,
      status: 'general',
      phase: 'general',
      phaseLabel: PHASE_LABEL.general,
      race: null,
      weeksOut: null,
      daysOut: null,
      phaseConflict: null,
      note: 'No upcoming race in the next several weeks.',
    };
  }

  const weeksOut = (race.dateMs - todayMs) / (7 * 86400000);
  const daysOut  = Math.round((race.dateMs - todayMs) / 86400000);
  const phase = recovering ? 'recovery' : phaseForWeeksOut(weeksOut);

  // Cut-vs-race conflict: if the user has a non-trivial cut goal AND we're
  // in taper/race-week, surface it. Goal progress signal does its own thing;
  // this flag is for the macro composer to weave a "transition to maintenance"
  // note into the paragraph.
  let phaseConflict = null;
  const lbsToLose = Number(outcomeGoal?.lbsToLose) || 0;
  const stillCutting = lbsToLose >= 1.0;     // explicit threshold; tiny cuts don't conflict
  if (stillCutting) {
    if (phase === 'race-week') phaseConflict = 'cut-vs-race-week';
    else if (phase === 'taper') phaseConflict = 'cut-vs-taper';
  }

  return {
    ...baseShape,
    status: phase,
    phase,
    phaseLabel: PHASE_LABEL[phase] || phase,
    race: {
      name: race.name || 'Upcoming race',
      date: race.date,
      type: race.type || null,
      distanceKm:  Number(race.distanceKm)  || (Number(race.distanceMi) ? Number(race.distanceMi) * 1.60934 : null),
      distanceMi:  Number(race.distanceMi)  || (Number(race.distanceKm) ? Number(race.distanceKm) / 1.60934 : null),
    },
    weeksOut: +weeksOut.toFixed(1),
    daysOut,
    recovering,
    phaseConflict,
    note: recovering
      ? `Recovering from ${race.name || 'race'} (${Math.abs(daysOut)} days ago).`
      : `${race.name || 'Race'} in ${daysOut} days (week ${Math.max(1, Math.ceil(weeksOut))} of ${phase} phase).`,
  };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────
// Single entry point computeUserState calls. Bundles all six signals
// into one block attached to userState as `coachSignals`.

export function computeCoachSignals(input = {}) {
  const today = input.today || new Date().toISOString().slice(0, 10);

  // Sleep array — accepts the same shape as intelligence.js sleepRowsAll.
  const sleepArr = input.sleep || [];

  // HRV: prefer overnightHRV on sleep rows, fall back to hrv collection.
  const hrvByDate = new Map();
  for (const s of sleepArr) {
    if (s?.date && s.overnightHRV != null && Number(s.overnightHRV) > 0) {
      hrvByDate.set(s.date, Number(s.overnightHRV));
    }
  }
  for (const h of (input.hrv || [])) {
    if (h?.date && h.overnightHRV != null && Number(h.overnightHRV) > 0) {
      // sleep-row HRV preferred when both present
      if (!hrvByDate.has(h.date)) hrvByDate.set(h.date, Number(h.overnightHRV));
    }
  }
  const hrvArr = [...hrvByDate.entries()].map(([date, value]) => ({ date, value }));

  // RHR: from sleep rows' restingHR.
  const rhrArr = sleepArr
    .filter(s => s?.date && s.restingHR != null && Number(s.restingHR) > 0)
    .map(s => ({ date: s.date, value: Number(s.restingHR) }));

  const sleepDebt      = computeSleepDebt(sleepArr, { today, targetHours: input.sleepGoalHrs });
  const hrvDepression  = computeHrvDepression(hrvArr, { today });
  const rhrDrift       = computeRhrDrift(rhrArr, { today });
  const energyAvail    = computeEnergyAvailability({
    today,
    intakeKcal:   input.todayIntakeKcal,
    exerciseKcal: input.todayExerciseKcal,
    lbmLbs:       input.lbmLbs,
  });
  const monotonyStrain = computeTrainingMonotonyStrain(input.activities || [], { today });
  const sleepHrvCorr   = computeSleepHrvCorrelation(sleepArr, hrvArr, { today });
  // Phase 4r.signals.2 — TDEE drift. Orchestrator passes pre-computed
  // empirical snapshots so this module stays pure.
  const tdeeDrift      = computeTdeeDrift({
    today,
    recent:   input.tdeeRecent4w   || null,
    baseline: input.tdeeBaseline4w || null,
  });

  // Phase 4r.signals.3 — Recovery velocity. Build the inputs here so the
  // pure computeRecoveryVelocity stays storage-free. Hard sessions = filter
  // over the activities array; HRV-by-date map + 90d baseline come from
  // the hrvArr we built above.
  const ninetyDaysAgo = (() => {
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const hardSessions = (input.activities || [])
    .filter(a => a?.date && a.date >= ninetyDaysAgo && a.date <= today && isHardSession(a))
    .map(a => ({ date: a.date }));
  // Reuse the hrvByDate Map already built above (line ~410) — it's keyed
  // identically (date → overnight HRV value).
  // 90d baseline — drop today, drop bottom + top 5% as light outlier trim.
  const hrvSorted = hrvArr
    .filter(h => h.date >= ninetyDaysAgo && h.date < today)
    .map(h => h.value)
    .sort((a, b) => a - b);
  const hrvBaseline90d = (() => {
    if (hrvSorted.length < 14) return null;
    const trimN = Math.max(1, Math.floor(hrvSorted.length * 0.05));
    const trimmed = hrvSorted.slice(trimN, hrvSorted.length - trimN);
    return trimmed.length ? mean(trimmed) : null;
  })();
  const recoveryVelocity = computeRecoveryVelocity(hardSessions, hrvByDate, {
    today,
    baselineHrv: hrvBaseline90d,
  });

  // Phase 4r.signals.4 — Glycogen estimator. Reads activities (zone minutes
  // over last 24h) + nutritionLog (carbs over last 24h, timestamped when
  // available). Pure transformer.
  const glycogen = computeGlycogenEstimate(
    input.activities || [],
    input.nutritionLog || [],
    { today }
  );

  // Phase 4r.signals.5 — Polarization index. Endurance time distribution
  // over a 4-week rolling window. Z3 dominance is the canonical amateur
  // mistake; we surface it as a "grey-zone" status.
  const polarization = computePolarizationIndex(input.activities || [], { today });

  // Phase 4r.signals.6 — Day-of-week patterns. HRV bucketed by weekday over
  // 90 days. Surfaces personal weekly rhythm — the dip-day and the
  // best-recovered day.
  const dowPatterns = computeDowPatterns(hrvArr, { today });

  // Phase 4r.signals.7 — Additional personal correlations beyond v1's
  // sleep↔HRV. Each gated on n ≥ 30 + |r| ≥ 0.3 inside its own function;
  // none of these throw on thin data — they return status:'insufficient'
  // and the consumers handle that.
  const sleepRhrCorr = computeSleepRhrCorrelation(sleepArr, rhrArr, { today });
  const sleepRunQualityCorr = computeSleepRunQualityCorrelation(
    sleepArr,
    input.activities || [],
    { today }
  );
  const deficitHrvCorr = computeDeficitHrvCorrelation({
    today,
    hrvByDate,
    intakeByDate: input.intakeByDate || (() => 0),
    tdeeByDate:   input.tdeeByDate   || (() => 0),
  });
  const loadSleepCorr = computeLoadSleepCorrelation(
    input.activities || [],
    sleepArr,
    { today }
  );

  // Phase 4r.signals.8 — Garmin underused fields. Sleep architecture
  // (stages + efficiency) and Garmin's daily trainingReadiness wellness
  // rows. Both are passive readouts of data that's already syncing; we
  // surface them rather than relying solely on the Coach's derived signals.
  const sleepQuality = computeSleepQuality(sleepArr, { today });
  const garminReadiness = computeGarminReadiness(input.wellness || [], { today });

  // Phase 4r.narrative.2.2 — planner-aware upcoming sessions.
  // Phase 4r.narrative.5.fix.18 — also thread activities so each
  // next7Days[i] gets a `done` flag once today's planned session is
  // completed (lets the composer shift from "do this" → past-tense).
  const upcomingPlan = computeUpcomingPlan(input.planner || null, {
    today,
    activities: input.activities || [],
  });

  // Phase 4r.narrative.2.3 — Long-arc goal progress for the macro narrative
  // slot. Reads weight history + the resolved outcome goal.
  const goalProgress = computeGoalProgress(
    input.weight || [],
    input.outcomeGoal || null,
    { today }
  );

  // Phase 4r.narrative.2.4 — Race horizon + training-phase awareness so
  // the composer can frame around "11 days to HYROX" not just "your
  // sleep debt is severe."
  const raceHorizon = computeRaceHorizon(input.outcomeGoal || null, { today });

  return {
    asOf: today,
    // v1 signals
    sleepDebt,
    hrvDepression,
    rhrDrift,
    energyAvailability: energyAvail,
    monotonyStrain,
    sleepHrvCorrelation: sleepHrvCorr,
    // v2 signals
    tdeeDrift,
    recoveryVelocity,
    glycogen,
    polarization,
    dowPatterns,
    sleepRhrCorr,
    sleepRunQualityCorr,
    deficitHrvCorr,
    loadSleepCorr,
    sleepQuality,
    garminReadiness,
    // narrative-engine inputs
    upcomingPlan,
    goalProgress,
    raceHorizon,
  };
}
