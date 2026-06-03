// ─── Intelligence Hub · Attribution Engine v1 ───────────────────────────────
// Phase 4r.hub.attribution.1 — see docs/INTELLIGENCE_HUB.md.
//
// "Find the culprit." When a run/race outcome diverges from what we'd expect,
// don't just judge it — cross-examine the surrounding signals and attribute
// the divergence to likely cause(s): heat, sleep debt, under-fueling, elevated
// RHR / depressed HRV, or accumulated load (fatigue masking fitness).
//
// This is the smallest, highest-value slice of the hub: read-only insight that
// proves the cross-examination idea on data already in storage. It does NOT
// mutate any model — later stages (checkpoint grading, response model) consume
// its output.
//
// Design notes:
//   • PURE + date-flexible. Reasons over per-date RAW data so it can analyze a
//     race that happened weeks ago, not just "today". No today-relative signals.
//   • DEFENSIVE reads. Every field is optional; a missing confounder simply
//     isn't considered (it never errors, never assumes). Missing data is a
//     normal state, not a failure (hub principle #4).
//   • Each attributed culprit carries a direction, a magnitude estimate, and a
//     confidence — so downstream (checkpoint grading) can down-weight a
//     confounded effort proportionally.

import { storage } from './storage.js';
import { parseLocalDate } from './dateUtils.js';
import { isRun } from './activityClass.js';
import { dailyTotals as nutDailyTotals } from './nutrition.js';
import { resolveZones, classifyEffort } from './zones.js';

// ── Tunable reference points (conservative; refined later by the response model) ──
const REF = {
  sleepTargetHrs: 7.5,        // below this = debt
  sleepDebtHrsForFlag: 1.0,   // ≥1h short of target before we name it
  hrvDropPctForFlag: 0.10,    // ≥10% below baseline = depressed
  rhrRiseForFlag: 4,          // ≥4 bpm above baseline = elevated
  heatThresholdC: 18,         // performance cost accrues above ~18°C
  acwrHighForFlag: 1.3,       // above this = acute load spike
  fuelLowKcalForFlag: 0.6,    // today's pre-effort intake < 60% of a normal day
  baselineDays: 28,           // window for sleep/HRV/RHR baselines
};

// Pull a numeric field defensively from a row under any of several keys.
function num(row, ...keys) {
  for (const k of keys) {
    const v = Number(row?.[k]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

// Median of a numeric array (baseline estimator — robust to outliers).
function median(arr) {
  const xs = arr.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

// Rows within [date-days, date) — the trailing baseline window, EXCLUDING the
// day itself so the day's own value doesn't bias its baseline.
function baselineRows(rows, dateStr, days, valueOf) {
  const d0 = parseLocalDate(dateStr);
  if (!d0) return [];
  const cutoff = new Date(d0); cutoff.setDate(cutoff.getDate() - days);
  return (rows || [])
    .filter(r => {
      const d = r?.date ? parseLocalDate(r.date) : null;
      return d && d >= cutoff && d < d0;
    })
    .map(valueOf)
    .filter(v => Number.isFinite(v) && v > 0);
}

// Value ON a specific date (most recent row matching that date).
function onDate(rows, dateStr, valueOf) {
  const row = (rows || []).find(r => r?.date === dateStr);
  return row ? valueOf(row) : null;
}

// ── The confounder probes ──────────────────────────────────────────────────
// Each returns a culprit object, or null when no evidence. Shape:
//   { factor, direction, timescale, detail, magnitude, confidence }
//   timescale: 'acute'   = specific to this day (heat, last-night sleep)
//              'chronic'  = accumulated/compounding over weeks (sleep debt, load)
// The acute/chronic split lets the engine say "X cost you TODAY; Y is the
// standing risk to fix" (user framing, 2026-06-03).

const sleepHrsOf = (r) => {
  const mins = num(r, 'totalSleepMinutes', 'durationMinutes');
  return mins != null ? mins / 60 : null;
};

// ACUTE: the night before the run.
function probeSleepAcute(dateStr, sleep) {
  const night = onDate(sleep, dateStr, sleepHrsOf);
  if (night == null) return null;
  const debt = REF.sleepTargetHrs - night;
  if (debt < REF.sleepDebtHrsForFlag) return null;
  return {
    factor: 'sleep',
    direction: 'hurt',
    timescale: 'acute',
    detail: `${night.toFixed(1)}h the night before (−${debt.toFixed(1)}h vs ${REF.sleepTargetHrs}h target)`,
    magnitude: debt,
    confidence: Math.min(1, debt / 2.5),
  };
}

// CHRONIC: rolling 7-night cumulative deficit vs target. A week of under-
// sleeping degrades performance even if last night was fine.
function probeSleepChronic(dateStr, sleep) {
  const nights = baselineRows(sleep, dateStr, 7, sleepHrsOf);  // last 7 nights before the run
  if (nights.length < 4) return null;                          // need most of the week
  const avg = nights.reduce((s, v) => s + v, 0) / nights.length;
  const debtPerNight = REF.sleepTargetHrs - avg;
  if (debtPerNight < 0.75) return null;                        // ≥45min/night short
  const weekDebt = +(debtPerNight * nights.length).toFixed(1);
  return {
    factor: 'sleep-debt',
    direction: 'hurt',
    timescale: 'chronic',
    detail: `~${avg.toFixed(1)}h/night over ${nights.length} nights (${weekDebt}h cumulative debt) — compounding`,
    magnitude: debtPerNight,
    confidence: Math.min(1, debtPerNight / 1.5),
  };
}

function probeHrv(dateStr, sleepRows, hrvRows) {
  // HRV preferred from sleep rows' overnightHRV, fall back to hrv collection.
  const sleepHrv = onDate(sleepRows, dateStr, r => num(r, 'overnightHRV'));
  const collHrv  = onDate(hrvRows,   dateStr, r => num(r, 'overnightHRV'));
  const today = sleepHrv ?? collHrv;
  if (today == null) return null;
  const base = median([
    ...baselineRows(sleepRows, dateStr, REF.baselineDays, r => num(r, 'overnightHRV')),
    ...baselineRows(hrvRows,   dateStr, REF.baselineDays, r => num(r, 'overnightHRV')),
  ]);
  if (base == null) return null;
  const dropPct = (base - today) / base;
  if (dropPct < REF.hrvDropPctForFlag) return null;
  return {
    factor: 'hrv',
    direction: 'hurt',
    timescale: 'acute',
    detail: `HRV ${Math.round(today)}ms (−${Math.round(base - today)}ms vs ${Math.round(base)} baseline)`,
    magnitude: dropPct,
    confidence: Math.min(1, dropPct / 0.30),
  };
}

function probeRhr(dateStr, sleepRows, hrvRows) {
  const today = onDate(sleepRows, dateStr, r => num(r, 'restingHR'))
             ?? onDate(hrvRows,   dateStr, r => num(r, 'restingHR'));
  if (today == null) return null;
  const base = median([
    ...baselineRows(sleepRows, dateStr, REF.baselineDays, r => num(r, 'restingHR')),
    ...baselineRows(hrvRows,   dateStr, REF.baselineDays, r => num(r, 'restingHR')),
  ]);
  if (base == null) return null;
  const rise = today - base;
  if (rise < REF.rhrRiseForFlag) return null;
  return {
    factor: 'rhr',
    direction: 'hurt',
    timescale: 'acute',
    detail: `RHR ${Math.round(today)}bpm (+${Math.round(rise)} vs ${Math.round(base)} baseline) — possible illness/incomplete recovery`,
    magnitude: rise,
    confidence: Math.min(1, rise / 10),
  };
}

function probeFuel(dateStr) {
  // Today's intake vs a typical day. Under-fueling before/around the effort is
  // a classic culprit. Uses the canonical nutrition source.
  let todayKcal = null;
  try { todayKcal = Number(nutDailyTotals(dateStr)?.calories) || null; } catch {}
  if (todayKcal == null || todayKcal <= 0) return null;  // no log → can't judge
  // Baseline: median of the last 14 logged days with intake.
  const d0 = parseLocalDate(dateStr);
  if (!d0) return null;
  const days = [];
  for (let i = 1; i <= 14; i++) {
    const d = new Date(d0); d.setDate(d.getDate() - i);
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let k = null;
    try { k = Number(nutDailyTotals(ds)?.calories) || null; } catch {}
    if (k && k > 0) days.push(k);
  }
  const base = median(days);
  if (base == null || base <= 0) return null;
  const ratio = todayKcal / base;
  if (ratio >= REF.fuelLowKcalForFlag) return null;
  return {
    factor: 'fuel',
    direction: 'hurt',
    timescale: 'acute',
    detail: `intake ${Math.round(todayKcal)}kcal — ${Math.round(ratio * 100)}% of your ~${Math.round(base)}kcal norm`,
    magnitude: 1 - ratio,
    confidence: Math.min(1, (1 - ratio) / 0.5),
  };
}

function probeWeather(activity) {
  // Weather is only considered if it's ALREADY attached to the activity (the
  // async fetch happens elsewhere). v1 never blocks on a network call.
  const tempC = num(activity, 'tempC', 'weatherTempC');
  const humidity = num(activity, 'humidityPct', 'weatherHumidityPct');
  if (tempC == null) return null;
  if (tempC < REF.heatThresholdC) return null;
  const overHeat = tempC - REF.heatThresholdC;
  const humidNote = (humidity != null && humidity >= 70) ? `, ${Math.round(humidity)}% humidity` : '';
  return {
    factor: 'heat',
    direction: 'hurt',
    timescale: 'acute',
    detail: `${Math.round(tempC)}°C${humidNote} — above ~${REF.heatThresholdC}°C performance accrues a cost`,
    magnitude: overHeat,
    confidence: Math.min(1, overHeat / 12),
  };
}

function probeLoad(dateStr, acwr) {
  // acwr is passed in (computed by the caller via computeAcuteChronicRatio) so
  // this module stays free of the trainingStress import cycle.
  if (acwr == null || !Number.isFinite(acwr)) return null;
  if (acwr < REF.acwrHighForFlag) return null;
  return {
    factor: 'load',
    direction: 'hurt',
    timescale: 'chronic',  // ACWR is an accumulated 7-vs-28d ratio, not a single-day event
    detail: `ACWR ${acwr.toFixed(2)} — elevated training load; fatigue may be masking fitness`,
    magnitude: acwr - REF.acwrHighForFlag,
    confidence: Math.min(1, (acwr - REF.acwrHighForFlag) / 0.4),
  };
}

// ── Main entry ───────────────────────────────────────────────────────────────
/**
 * Attribute the likely cause(s) of a run/race outcome.
 *
 * @param {object} opts
 * @param {object} opts.activity     the run/race in question (must have a date)
 * @param {number} [opts.expectedSecs]  what we expected (e.g. from predictRaceFinish)
 * @param {number} [opts.actualSecs]    what actually happened (defaults to activity.durationSecs)
 * @param {number} [opts.acwr]          today's ACWR if the caller computed it
 * @param {object} [opts.data]          optional pre-loaded { sleep, hrv } (else read from storage)
 *
 * @returns {{
 *   date, divergencePct|null, verdict,
 *   culprits: Array<{factor,direction,detail,magnitude,confidence}>,
 *   summary: string
 * } | null}
 *   verdict: 'as-expected' | 'underperformed' | 'overperformed' | 'no-expectation'
 */
export function attributeOutcome(opts = {}) {
  const activity = opts.activity;
  if (!activity || !activity.date) return null;
  const dateStr = activity.date;

  const sleep = opts.data?.sleep || storage.get('sleep') || [];
  const hrv   = opts.data?.hrv   || storage.get('hrv')   || [];

  // ── Effort gate (category-error guard) ──
  // `expectedSecs` from the race predictor is a RACE-PACE expectation, only
  // meaningful for a run that was actually a race/hard effort. An easy/Z2 run
  // reads ~20-30% "slower" purely because easy pace ≠ race pace — correct
  // training, NOT underperformance. Effort is classified against the athlete's
  // REAL zones (resolveZones: lab test → Garmin custom → Karvonen → %HRmax),
  // NOT a %HRmax guess and NOT the run's own peak HR.
  const avgHR = Number(activity.avgHR || activity.avgHeartRate) || null;
  const zones = resolveZones({ maxHR: opts.maxHR });
  const effort = classifyEffort(avgHR, zones);  // 'easy' | 'tempo' | 'hard' | null
  const isRaceEffort = opts.isRaceEffort != null
    ? !!opts.isRaceEffort
    : (activity.isRace === true
       || activity.type === 'race'
       || effort === 'hard');

  // ── Within-run zone discipline (for easy runs) ──
  // Average HR can HIDE drift: a run averaging 135 could be clean Z2, or 15min
  // of Z3 surges balanced by recovery. For an easy run, the real question is
  // "did you STAY in Z2?" — answered from the per-zone seconds (hrZones array,
  // Garmin's own binning: [z1,z2,z3,z4,z5]). Surfaces grey-zone drift the
  // average masks. Only computed for easy efforts (where discipline is the goal).
  const zoneDiscipline = (() => {
    if (effort !== 'easy') return null;
    const hz = activity.hrZones;
    if (!Array.isArray(hz) || hz.length !== 5) return null;
    const secs = hz.map(v => Number(v) || 0);
    const total = secs.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const easyPct = Math.round(((secs[0] + secs[1]) / total) * 100);   // Z1+Z2
    const driftPct = 100 - easyPct;                                    // Z3+
    const driftMin = Math.round((total - secs[0] - secs[1]) / 60);
    // ≥85% in Z1-Z2 = disciplined; 70-85% = some drift; <70% = significant.
    const grade = easyPct >= 85 ? 'disciplined'
                : easyPct >= 70 ? 'some-drift'
                :                 'grey-zone-creep';
    return { easyPct, driftPct, driftMin, grade,
             detail: grade === 'disciplined'
               ? `held Z2 cleanly (${easyPct}% easy)`
               : `${driftMin}min above Z2 (${easyPct}% easy) — ${grade === 'grey-zone-creep' ? 'significant grey-zone creep' : 'mild drift'}` };
  })();

  // ── Divergence: did the outcome miss expectation? (gated on effort) ──
  const actualSecs = Number(opts.actualSecs ?? activity.durationSecs) || null;
  const rawExpected = Number(opts.expectedSecs) || null;
  // Only honor a race-pace expectation for a race-effort run.
  const expectedSecs = (rawExpected && isRaceEffort) ? rawExpected : null;
  let divergencePct = null;
  let verdict = 'no-expectation';
  if (expectedSecs && actualSecs) {
    divergencePct = (actualSecs - expectedSecs) / expectedSecs;  // + = slower
    verdict = divergencePct > 0.02 ? 'underperformed'
            : divergencePct < -0.02 ? 'overperformed'
            : 'as-expected';
  } else if (rawExpected && !isRaceEffort) {
    // We had a prediction but the run wasn't a race effort — say so explicitly
    // rather than silently comparing apples to oranges.
    verdict = 'not-an-effort';
  }

  // ── Cross-examine confounders (always run — they characterize the day even
  //    when there's no expectation to compare against). Split by TIMESCALE:
  //    acute factors plausibly affected THIS effort; chronic factors are
  //    standing risks that compound over weeks (and may dull the pinnacle). ──
  const allFactors = [
    probeSleepAcute(dateStr, sleep),
    probeSleepChronic(dateStr, sleep),
    probeHrv(dateStr, sleep, hrv),
    probeRhr(dateStr, sleep, hrv),
    probeFuel(dateStr),
    probeWeather(activity),
    probeLoad(dateStr, opts.acwr),
  ].filter(Boolean)
   .sort((a, b) => b.confidence - a.confidence);

  const acute   = allFactors.filter(f => f.timescale === 'acute');    // affected THIS effort
  const chronic = allFactors.filter(f => f.timescale === 'chronic');  // standing risks to watch
  // `culprits` kept for back-compat (all factors, confidence-ranked).
  const culprits = allFactors;

  // ── Compose a plain-language summary (the "coach not calculator" line). ──
  // Whether we can ASSESS performance depends on having an expectation.
  // Acute factors get attributed to the result; chronic factors are appended
  // as standing risks even when they didn't clearly cost this effort.
  const acuteList   = () => acute.map(c => c.detail).join('; ');
  const chronicNote = () => chronic.length
    ? ` Standing risk${chronic.length > 1 ? 's' : ''} to watch: ${chronic.map(c => c.detail).join('; ')}.`
    : '';
  let summary;
  if (verdict === 'underperformed') {
    summary = acute.length
      ? `Ran ${Math.round(divergencePct * 100)}% slower than expected — likely ${acute.map(c => c.factor).join(' + ')}: ${acute[0].detail}.`
      : `Ran ${Math.round(divergencePct * 100)}% slower than expected with no acute confounder — may be a genuine fitness read.`;
    summary += chronicNote();
  } else if (verdict === 'overperformed') {
    summary = `Beat expectation by ${Math.round(-divergencePct * 100)}%${acute.length ? ` despite ${acute.map(c => c.factor).join(' + ')}` : ''} — strong signal.` + chronicNote();
  } else if (verdict === 'as-expected') {
    summary = (acute.length
      ? `On expectation, even with ${acute.map(c => c.factor).join(' + ')} working against you — solid.`
      : `Right on expectation under clean conditions — a trustworthy read.`) + chronicNote();
  } else if (verdict === 'not-an-effort') {
    if (effort === 'easy') {
      const disc = zoneDiscipline
        ? (zoneDiscipline.grade === 'disciplined'
            ? `${zoneDiscipline.detail} ✓`
            : `${zoneDiscipline.detail} — ease off to protect the aerobic stimulus`)
        : `avg HR ${avgHR} ≤ Z2 ceiling ${zones.z2Ceiling}`;
      summary = `Easy run — ${disc}.${acute.length ? ` Conditions of note: ${acuteList()}.` : ''}${chronicNote()}`;
    } else {
      const eLabel = effort === 'tempo' ? `Tempo/sub-threshold run (avg HR ${avgHR})` : `Sub-race effort`;
      summary = `${eLabel} — judged on zone discipline + efficiency, not race pace.${acute.length ? ` Conditions of note: ${acuteList()}.` : ''}${chronicNote()}`;
    }
  } else {
    // verdict === 'no-expectation' — be HONEST: we couldn't grade performance
    // (no expected time for this effort/race type). Do NOT imply we checked &
    // cleared everything — report conditions, distinguish acute vs chronic.
    const cantAssess = effort === 'hard'
      ? `Hard effort, but can't grade performance — no expectation for this ${activity.type === 'race' || activity.isRace ? 'race type' : 'session'}.`
      : `Can't grade performance — no expectation set.`;
    const acutePart = acute.length ? ` Acute factors present: ${acuteList()}.` : ` No acute confounders detected.`;
    summary = `${cantAssess}${acutePart}${chronicNote()}`;
  }

  return { date: dateStr, verdict, divergencePct, effort, zoneDiscipline, acute, chronic, culprits, summary };
}

// ── Debug helper ─────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.attributionDebug = async (dateStr) => {
    const _storage = window.__arnoldStorage || storage;
    const activities = (_storage.get('activities') || []).filter(a => isRun(a) && a?.date);
    const target = dateStr
      ? activities.find(a => a.date === dateStr)
      : activities.sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
    if (!target) { console.warn('[attribution] no run found', dateStr || '(latest)'); return null; }

    // Build an expectation for THIS run's distance from the empirical anchor,
    // so the verdict (under/over/as-expected) is meaningful — not just
    // confounders. Lazy-import to avoid any load-order coupling.
    let expectedSecs = null;
    try {
      const { predictRaceFinish } = await import('./derive/tileMetrics.js');
      const pred = predictRaceFinish(
        { distanceMi: target.distanceMi, type: 'other' },
        activities,
      );
      // Don't anchor a run against ITSELF — only use the prediction if the
      // anchor it picked isn't this same run.
      if (pred && pred.anchor?.run?.date !== target.date) expectedSecs = pred.seconds;
    } catch {}

    // Pass the LIFETIME max HR so the effort gate uses physiological max, not
    // the run's own peak. getEffectiveMaxHR is the canonical lifetime estimate.
    let maxHR = null;
    try {
      const { getEffectiveMaxHR } = await import('./trainingStress.js');
      maxHR = getEffectiveMaxHR(_storage.get('profile') || {}, activities);
    } catch {}

    // Attach weather so the heat probe can fire (v1 only saw weather if it was
    // already on the activity — it usually isn't). Best-effort: the day's MAX
    // temp is the relevant heat stress for a daytime race. Skips silently on
    // any failure (offline, geolocation denied).
    let actForAttr = target;
    if (!Number.isFinite(Number(target.tempC))) {
      try {
        const { fetchWeatherForDate } = await import('./pdfParser.js');
        const w = await fetchWeatherForDate(target.date);
        if (w && Number.isFinite(w.tempMaxC)) {
          actForAttr = { ...target, tempC: w.tempMaxC };
          console.log('[attribution] attached weather:', `${Math.round(w.tempMaxC)}°C max (${w.condition})`);
        }
      } catch {}
    }

    const result = attributeOutcome({ activity: actForAttr, expectedSecs, maxHR });
    const avg = Number(target.avgHR || target.avgHeartRate) || null;
    console.log('━━ Attribution ━━', target.date,
      `(${target.distanceMi}mi in ${target.durationSecs}s, avgHR ${avg ?? '—'}, lifetime maxHR ${maxHR ?? '—'})`);
    if (expectedSecs) console.log('expected:', Math.round(expectedSecs), 's');
    console.log('verdict:', result.verdict, 'effort:', result.effort,
      result.divergencePct != null ? `(${(result.divergencePct * 100).toFixed(1)}%)` : '');
    if (result.zoneDiscipline) console.log('zone discipline:', result.zoneDiscipline);
    console.log('acute (affected this effort):', result.acute);
    console.log('chronic (standing risks):', result.chronic);
    console.log('summary:', result.summary);
    return result;
  };
}
