import { canonicalActivityType } from '../dcyMath.js';

// ─── Recovery Signature (Phase 4r.adapt.1) ──────────────────────────────────
// For each workout, derive three signals from the bracketing weigh-ins:
//
//   1. Fluid loss   — pre-workout weight minus post-workout weight.
//                     Sized per-hour gives a sweat-rate measurement.
//   2. Rebound      — next-morning weight minus pre-workout weight.
//                     Positive = fully recovered (glycogen + hydration).
//                     Slightly negative = normal overnight loss.
//                     Strongly negative = real hydration / glycogen debt.
//   3. Rebound class — categorical: 'full' | 'partial' | 'incomplete'.
//
// PURE DERIVATION — no storage writes, no UI side effects, no decisions.
// Downstream phases consume the output to personalize:
//
//   Phase 4r.adapt.2 — replace flat `fuelTargets({minutes}).waterOz` with
//                      lookup-by-(workoutType, durationBucket, tempBucket)
//                      using the user's observed sweat rates.
//
//   Phase 4r.adapt.3 — accumulate rebound debt across recent workouts.
//                      Surface as advisory copy on the today's-session tile
//                      when debt exceeds a threshold; soften readiness verdict.
//
//   Phase 4r.adapt.4 — feed rebound completeness into readinessVerdict() as
//                      a fourth axis alongside sleep + HRV + days-since-key.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Time parsing ──────────────────────────────────────────────────────────

// Parse various time formats into "minutes from midnight" (0–1439).
// Tolerates HH:MM, HH:MM:SS, 12-hour with AM/PM, ISO timestamps.
// Returns null when unparseable.
export function parseTimeStr(s) {
  if (!s) return null;
  const str = String(s).trim();
  // ISO datetime fragment: "...T15:32:00..."
  const iso = str.match(/T(\d{2}):(\d{2})/);
  if (iso) return Number(iso[1]) * 60 + Number(iso[2]);
  // 12-hour: "3:12 PM" / "03:12pm"
  const am = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (am) {
    let h = Number(am[1]);
    const m = Number(am[2]);
    const ap = am[3].toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  // 24-hour: "15:32" or "15:32:00"
  const h24 = str.match(/^(\d{1,2}):(\d{2})/);
  if (h24) return Number(h24[1]) * 60 + Number(h24[2]);
  return null;
}

// (YYYY-MM-DD, minutesFromMidnight) → absolute minutes (epoch-based,
// treating times as local). Used only for ordering and deltas — all
// comparisons stay within the same TZ, so we don't need a true UTC offset.
function toAbsMinutes(dateStr, mins) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return Math.round(Date.UTC(y, mo - 1, d) / 60000) + (Number.isFinite(mins) ? mins : 0);
}

// Weight row → absolute minutes (falls back to 12:00 local if time is missing).
function weightAbsMins(w) {
  return toAbsMinutes(w?.date, parseTimeStr(w?.time) ?? 720);
}

// Activity → { start, end, estimated }. Estimated=true when start time was
// missing and we assumed midday — caller may want to lower its confidence.
function activityBounds(a) {
  if (!a?.date) return { start: null, end: null, estimated: false };
  const durMin = ((Number(a.durationSecs) || 0) / 60) || Number(a.durationMins) || 0;
  const startMin = parseTimeStr(a.startTime || a.time);
  if (startMin == null) {
    const mid = toAbsMinutes(a.date, 720);
    return { start: mid, end: mid + durMin, estimated: true };
  }
  const start = toAbsMinutes(a.date, startMin);
  return { start, end: start + durMin, estimated: false };
}

// ─── Bracketing weigh-in finders ───────────────────────────────────────────

const MIN_PER_HOUR = 60;
const MIN_PER_DAY  = 24 * 60;

// Most recent weigh-in within `windowMin` minutes BEFORE timestamp t.
function findClosestBefore(weights, t, windowMin) {
  if (!Number.isFinite(t)) return null;
  let best = null, bestDelta = Infinity;
  for (const w of weights) {
    const wt = weightAbsMins(w);
    if (!Number.isFinite(wt)) continue;
    const delta = t - wt;
    if (delta < 0 || delta > windowMin) continue;
    if (delta < bestDelta) { best = w; bestDelta = delta; }
  }
  return best;
}

// Closest weigh-in within `windowMin` minutes AFTER timestamp t.
function findClosestAfter(weights, t, windowMin) {
  if (!Number.isFinite(t)) return null;
  let best = null, bestDelta = Infinity;
  for (const w of weights) {
    const wt = weightAbsMins(w);
    if (!Number.isFinite(wt)) continue;
    const delta = wt - t;
    if (delta < 0 || delta > windowMin) continue;
    if (delta < bestDelta) { best = w; bestDelta = delta; }
  }
  return best;
}

// First morning weigh-in on a subsequent day (before 11 AM local), within
// `daysOut` days of activityDate. Used for next-day rebound measurement.
function findNextMorning(weights, activityDate, daysOut = 2) {
  if (!activityDate) return null;
  const startTs = toAbsMinutes(activityDate, MIN_PER_DAY);   // start of day +1
  const endTs   = toAbsMinutes(activityDate, daysOut * MIN_PER_DAY + MIN_PER_DAY);
  let best = null, bestTs = Infinity;
  for (const w of weights) {
    const wt = weightAbsMins(w);
    if (!Number.isFinite(wt)) continue;
    if (wt < startTs || wt > endTs) continue;
    const minOfDay = parseTimeStr(w?.time);
    // Require an explicit AM reading (before 11:00). Skip rows with no
    // time stamp — those are ambiguous and would bias the rebound.
    if (minOfDay == null || minOfDay > 11 * MIN_PER_HOUR) continue;
    if (wt < bestTs) { best = w; bestTs = wt; }
  }
  return best;
}

// ─── Public: compute the signature for one activity ─────────────────────────

// Thresholds for rebound classification. Tunable as we learn what's normal
// across activity types. Defaults err toward "give the user credit" — small
// next-AM deficits are normal, only persistent shortfall counts as debt.
const REBOUND_FULL_THRESH       = -0.5;  // back within 0.5 lb → full
const REBOUND_PARTIAL_THRESH    = -1.5;  // within 1.5 lb → partial
// Below REBOUND_PARTIAL_THRESH → incomplete (real recovery debt)

export function computeRecoverySignature(activity, weightHistory) {
  if (!activity?.date || !Array.isArray(weightHistory)) return null;
  const bounds = activityBounds(activity);
  if (bounds.start == null) return null;

  // Pre-workout: closest weigh-in within 24h before activity start.
  const pre = findClosestBefore(weightHistory, bounds.start, MIN_PER_DAY);
  // Post-workout: closest weigh-in within 6h after activity end.
  const post = findClosestAfter(weightHistory, bounds.end, 6 * MIN_PER_HOUR);
  // Next-morning AM: rebound reading. Look 1-2 days forward.
  const nextAm = findNextMorning(weightHistory, activity.date, 2);

  const durHr = ((Number(activity.durationSecs) || 0) / 3600)
              || ((Number(activity.durationMins) || 0) / 60)
              || 0;

  const fluidLossLbs = (pre && post)
    ? +(pre.weightLbs - post.weightLbs).toFixed(2)
    : null;

  const fluidLossRateLbsPerHr = (Number.isFinite(fluidLossLbs) && durHr > 0)
    ? +(fluidLossLbs / durHr).toFixed(2)
    : null;

  const reboundLbs = (pre && nextAm)
    ? +(nextAm.weightLbs - pre.weightLbs).toFixed(2)
    : null;

  let reboundClass = null;
  if (Number.isFinite(reboundLbs)) {
    if (reboundLbs >= REBOUND_FULL_THRESH)         reboundClass = 'full';
    else if (reboundLbs >= REBOUND_PARTIAL_THRESH) reboundClass = 'partial';
    else                                           reboundClass = 'incomplete';
  }

  const slim = (w) => w ? { date: w.date, time: w.time || null, weightLbs: w.weightLbs } : null;

  return {
    activityDate:           activity.date,
    activityType:           activity.activityType || null,
    // Phase 4r.adapt.1 — canonical type collapses CSV labels ("Running",
    // "Strength Training") and FIT labels ("Run (outdoor)", "Strength")
    // into single buckets so per-type aggregates aren't fragmented.
    activityTypeCanon:      canonicalActivityType(activity.activityType || activity.activityName || ''),
    activityName:           activity.activityName || activity.title || null,
    durationHr:             +durHr.toFixed(2),
    estimatedTimeBounds:    !!bounds.estimated,
    pre:                    slim(pre),
    post:                   slim(post),
    nextAm:                 slim(nextAm),
    fluidLossLbs,
    fluidLossRateLbsPerHr,
    reboundLbs,
    reboundClass,
  };
}

// ─── Public: signatures across a window of activities ──────────────────────

// Returns a Map keyed by activity natural key (date|type|startTime) → signature.
// Stable key lets caller cross-reference back to the source activity.
export function signaturesForActivities(activities, weightHistory, { daysBack = 90 } = {}) {
  const cutoffMs = Date.now() - daysBack * 86400 * 1000;
  const out = new Map();
  for (const a of activities || []) {
    if (!a?.date) continue;
    const t = new Date(a.date + 'T12:00:00').getTime();
    if (!Number.isFinite(t) || t < cutoffMs) continue;
    const sig = computeRecoverySignature(a, weightHistory);
    if (sig) {
      const key = `${a.date}|${a.activityType || ''}|${a.startTime || a.time || ''}`;
      out.set(key, sig);
    }
  }
  return out;
}

// ─── Public: summary stats over a set of signatures ────────────────────────

// Aggregate sweat-rate and rebound stats overall and per activityType.
// Robust to small samples — uses trimmed means when there are enough
// observations, raw mean otherwise.
function trimmedMean(arr, trim = 0.10) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const drop = Math.floor(s.length * trim);
  const kept = s.slice(drop, s.length - drop);
  if (!kept.length) return null;
  return kept.reduce((sum, v) => sum + v, 0) / kept.length;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export function summarizeSignatures(signatures) {
  const rates = [];
  const rebounds = [];
  const reboundClassCounts = { full: 0, partial: 0, incomplete: 0 };
  const byType = {};

  for (const sig of signatures.values()) {
    if (Number.isFinite(sig.fluidLossRateLbsPerHr)) rates.push(sig.fluidLossRateLbsPerHr);
    if (Number.isFinite(sig.reboundLbs))             rebounds.push(sig.reboundLbs);
    if (sig.reboundClass) reboundClassCounts[sig.reboundClass]++;

    // Aggregate by CANONICAL type so CSV/FIT label drift doesn't split
    // the sample (e.g. "Running" vs "Run (outdoor)" → both → 'run').
    const type = sig.activityTypeCanon || 'unknown';
    if (!byType[type]) byType[type] = { rates: [], rebounds: [], count: 0 };
    byType[type].count++;
    if (Number.isFinite(sig.fluidLossRateLbsPerHr)) byType[type].rates.push(sig.fluidLossRateLbsPerHr);
    if (Number.isFinite(sig.reboundLbs))             byType[type].rebounds.push(sig.reboundLbs);
  }

  const summarize = (arr) => ({
    n: arr.length,
    mean: arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2) : null,
    trimmed: arr.length >= 5 ? +trimmedMean(arr).toFixed(2) : null,
    median: arr.length ? +median(arr).toFixed(2) : null,
  });

  const byTypeStats = {};
  for (const [type, data] of Object.entries(byType)) {
    byTypeStats[type] = {
      count: data.count,
      sweatRate: summarize(data.rates),
      rebound: summarize(data.rebounds),
    };
  }

  return {
    sampleCount: signatures.size,
    sweatRate: summarize(rates),
    rebound: summarize(rebounds),
    reboundClassCounts,
    byType: byTypeStats,
  };
}

// ─── Public: rebound debt (Phase 4r.adapt.3) ───────────────────────────────
//
// Quantifies "how much hydration / glycogen recovery is overdue" by walking
// the last N days of signatures and accumulating:
//
//   • Negative-rebound contributions from incomplete-class workouts only
//     (partial-class is normal post-effort residual; we don't count it).
//   • Linearly decayed by age — yesterday's incomplete rebound weighs full,
//     6 days ago weighs ~14% (1 - age/7). Decay window matches the body's
//     typical hydration / glycogen restoration timeline.
//   • A count of incomplete-class workouts in window — quick gut-check
//     of "is this a one-off or a pattern?"
//
// Severity buckets (tunable):
//   none    — no advisory needed
//   monitor — light flag (1 incomplete in 7d, OR total debt 1.0–2.5 lb)
//   flag    — strong advisory + soften today's readiness verdict
//             (≥2 incompletes in 7d, OR total debt > 2.5 lb)
//
// The advisoryCopy is rendered above the existing chips on the today's
// tile. Auto-clears once a full-rebound workout lands or the decay
// window expires.

const REBOUND_DEBT_WINDOW_DAYS = 7;
const REBOUND_DEBT_FLAG_LBS    = 2.5;
const REBOUND_DEBT_FLAG_COUNT  = 2;
const REBOUND_DEBT_MONITOR_LBS = 1.0;

export function computeReboundDebt(signatures, { now = new Date(), windowDays = REBOUND_DEBT_WINDOW_DAYS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  let totalDebt = 0;
  let incompleteCount = 0;
  const contributors = [];

  for (const sig of signatures.values()) {
    if (sig.reboundClass !== 'incomplete') continue;
    if (!Number.isFinite(sig.reboundLbs)) continue;
    const sigDate = new Date(sig.activityDate + 'T12:00:00').getTime();
    if (!Number.isFinite(sigDate)) continue;
    const ageDays = (nowMs - sigDate) / 86_400_000;
    if (ageDays < 0 || ageDays > windowDays) continue;

    // Linear decay 1.0 → 0.0 over the window.
    const weight = Math.max(0, 1 - ageDays / windowDays);
    // reboundLbs is negative for incomplete; flip sign to accumulate as
    // positive debt.
    const contribution = (-sig.reboundLbs) * weight;
    totalDebt += contribution;
    incompleteCount++;
    contributors.push({
      date: sig.activityDate,
      activityType: sig.activityTypeCanon || sig.activityType,
      reboundLbs: sig.reboundLbs,
      ageDays: +ageDays.toFixed(1),
      contributionLbs: +contribution.toFixed(2),
    });
  }

  totalDebt = +totalDebt.toFixed(2);

  let severity, advisoryCopy;
  if (totalDebt >= REBOUND_DEBT_FLAG_LBS || incompleteCount >= REBOUND_DEBT_FLAG_COUNT) {
    severity = 'flag';
    advisoryCopy = `${totalDebt.toFixed(1)} lb recovery debt from your last ${incompleteCount} session${incompleteCount === 1 ? '' : 's'}. Stay on fluids today, prioritize protein + carbs at the next meal.`;
  } else if (totalDebt >= REBOUND_DEBT_MONITOR_LBS || incompleteCount === 1) {
    severity = 'monitor';
    advisoryCopy = `${totalDebt.toFixed(1)} lb residual from recent sessions — hydrate consistently today.`;
  } else {
    severity = 'none';
    advisoryCopy = null;
  }

  return {
    totalDebtLbs: totalDebt,
    incompleteCount,
    severity,
    advisoryCopy,
    contributors: contributors.sort((a, b) => a.ageDays - b.ageDays),
    windowDays,
  };
}

// Soften a readiness verdict by one notch when severity === 'flag'.
// Returns a NEW verdict object (caller-immutable).
// Pure mapping — caller decides whether to apply.
export function softenReadinessForDebt(verdict, debt) {
  if (!verdict || debt?.severity !== 'flag') return verdict;
  // Don't compound below DIAL BACK.
  const SOFTEN = {
    'GO STRONG':  { label: 'STEADY',    color: verdict.color },
    'STEADY':     { label: 'DIAL BACK', color: verdict.color },
  };
  const softer = SOFTEN[verdict.label];
  if (!softer) return verdict;
  return {
    ...verdict,
    label: softer.label,
    softenedBy: 'rebound_debt',
    originalLabel: verdict.label,
  };
}

// ─── Public: convenience for callers that have both stores ─────────────────

// Pull deduped activities + weight history from storage and return a
// summary. Useful for diagnostic console use and for downstream phases
// that don't want to plumb the raw collections themselves.
//
// NOT a hot path — re-computes from scratch every call. Cache at the
// caller if used inside a hook / render path.
export function summarizeRecentSignatures({ activities, weightHistory, daysBack = 90 } = {}) {
  const sigs = signaturesForActivities(activities, weightHistory, { daysBack });
  return { signatures: sigs, summary: summarizeSignatures(sigs) };
}
