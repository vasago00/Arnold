// ─── Recovery debt classifier (Phase 4r.dataspine.1) ──────────────────────
//
// Canonical implementation of "how much chronic recovery debt has the user
// accumulated over the last few nights?" Returns a 0-3 score that drives:
//
//   • intelligence.js userState.recoveryDebt — feeds the 'recovery-debt'
//     burden + the cards' tone/severity
//   • goalModel.js deriveDailyCalorieTarget recovery modifier — raises
//     today's calorie target when the body is under-recovered
//   • (future) cross-domain insights that depend on chronic sleep state
//
// Before this module existed, the classifier was inlined in TWO places
// (goalModel.js:375 and intelligence.js:161) with subtly DIFFERENT
// thresholds — intelligence.js silently omitted the HRV depression signal.
// Result: cards saying "recovery is fine" while goalModel saw debt. The
// weight-loss/sleep insight I missed in May 2026 was partly this — the
// 'recovery-debt' burden didn't fire when it should have.
//
// IMPORTANT — what this is NOT:
//   • This is for CHRONIC debt (3-night window) used by Layer 2 / 3.
//   • It is NOT the per-day fatigue classifier used by
//     PredictedBandsCard (predictedBands.js:classifyFatigueSeverity),
//     which takes single-day signals + acute-chronic TSS ratio to
//     predict "will this workout feel hard today?" Different concept.
//   • It is NOT DCY's recoveryCoef (dcy.js), which uses HRV/RHR
//     baselines on different windows. Phase C will decide whether DCY
//     consolidates with this; for Phase A they stay separate.

/**
 * Classify chronic recovery debt from sleep + HRV signals.
 *
 * Looks at the most recent 3 nights of sleep AND, if available, the
 * most recent HRV reading vs a 14-day baseline. Sums to a score; the
 * score maps to a 0..3 debt level.
 *
 * Scoring signals (all additive):
 *   Sleep duration per night (last 3 nights):
 *     < 5 h     → +1.00  (severe — significant cognitive + cardiovascular hit)
 *     5–6 h     → +0.50  (moderate — recovery impaired)
 *     6–7 h     → +0.25  (mild — sub-optimal)
 *   Sleep score per night (Garmin's quality 0–100, last 3 nights):
 *     < 50      → +0.50  (poor quality)
 *     50–70     → +0.25  (mediocre)
 *   HRV depression (latest reading vs 14-day baseline):
 *     latest < 70% of baseline → +1.00
 *
 * Score → debt level (the burden gates fire at debt ≥ 2):
 *   ≥ 2.5     → 3  (severe chronic debt)
 *   ≥ 1.5     → 2  (notable debt — burden fires)
 *   ≥ 0.7     → 1  (mild debt)
 *   else      → 0  (no debt)
 *
 * @param {object} input
 * @param {Array}  input.sleep  Sleep rows (any window; we sort + take latest 3)
 * @param {Array}  [input.hrv]  HRV rows (optional; used only for the depression signal)
 * @returns {{ debt: 0|1|2|3, score: number, signals: object }}
 *          Signals breakdown for debug / explainability.
 */
export function classifyChronicRecoveryDebt({ sleep = [], hrv = [] } = {}) {
  // ── Sleep signals ──
  const recentSleep = [...sleep]
    .filter(s => s && s.date)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 3);

  let score = 0;
  const signals = {
    nightsConsidered: recentSleep.length,
    sleepDurationContrib: 0,
    sleepScoreContrib: 0,
    hrvDepressionContrib: 0,
    perNight: [],
  };

  for (const s of recentSleep) {
    // Prefer Garmin's `totalSleepMinutes` (live worker field); fall back
    // to legacy HC `durationMinutes`.
    const mins = Number(s.totalSleepMinutes ?? s.durationMinutes) || 0;
    const h = mins / 60;
    let durationAdd = 0;
    if (h > 0 && h < 5)        durationAdd = 1.0;
    else if (h >= 5 && h < 6)  durationAdd = 0.5;
    else if (h >= 6 && h < 7)  durationAdd = 0.25;

    const ss = Number(s.sleepScore);
    let scoreAdd = 0;
    if (Number.isFinite(ss)) {
      if (ss < 50)      scoreAdd = 0.5;
      else if (ss < 70) scoreAdd = 0.25;
    }

    score += durationAdd + scoreAdd;
    signals.sleepDurationContrib += durationAdd;
    signals.sleepScoreContrib    += scoreAdd;
    signals.perNight.push({ date: s.date, hours: +h.toFixed(2), sleepScore: ss || null,
                            durationAdd, scoreAdd });
  }

  // ── HRV depression signal ──
  // Most recent reading compared against the 14-day baseline. We need at
  // least 7 readings to consider this signal stable; otherwise skip it
  // rather than flag debt on noisy data.
  const recentHrv = [...hrv]
    .filter(h => h && h.overnightHRV)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (recentHrv.length >= 7) {
    const baseline = recentHrv.slice(1, 15)
      .map(h => Number(h.overnightHRV))
      .filter(v => v > 0);
    const baselineAvg = baseline.reduce((s, v) => s + v, 0) / Math.max(1, baseline.length);
    const latest = Number(recentHrv[0].overnightHRV);
    if (baselineAvg > 0 && latest > 0 && latest / baselineAvg < 0.7) {
      score += 1.0;
      signals.hrvDepressionContrib = 1.0;
      signals.hrvLatest = latest;
      signals.hrvBaseline14d = +baselineAvg.toFixed(1);
      signals.hrvRatio = +(latest / baselineAvg).toFixed(2);
    }
  }

  let debt;
  if (score >= 2.5)      debt = 3;
  else if (score >= 1.5) debt = 2;
  else if (score >= 0.7) debt = 1;
  else                    debt = 0;

  return { debt, score: +score.toFixed(2), signals };
}
