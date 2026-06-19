// Cycling session-quality metrics — the bike analogue of computeRTSS's run metrics
// and the strength quality cluster. Feeds the hero's right-cluster (Power · Effort ·
// Efficiency) and any cycling-aware surface. Pure; reads an activity's recorded
// power/HR fields and the profile's FTP. Returns null when there's nothing to show.
//
// Effort: power IF (NP/FTP) when both exist; else HR-relative-to-max as a fallback,
// so a power-less indoor bike still gets an effort read. Efficiency: watts per
// heartbeat (avgPower/avgHR) — rises as the aerobic engine improves at a given HR.

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export function cyclingMetricsFor(activity, profile = {}) {
  if (!activity) return null;
  const avgPowerW = num(activity.avgPowerW ?? activity.avgPower);
  const normalizedPower = num(activity.normalizedPower ?? activity.normPower);
  const avgHR = num(activity.avgHR ?? activity.avgHeartRate);
  const maxHR = num(activity.maxHR ?? activity.maxHeartRate) ?? num(profile.maxHR);
  const ftpW = num(profile.ftpWatts ?? profile.ftp ?? profile.functionalThresholdPower);
  const thresholdHR = num(profile.thresholdHR);
  const durationSecs = num(activity.durationSecs) || 0;

  // nothing meaningful to show?
  if (!(avgPowerW > 0) && !(avgHR > 0)) return null;

  // Load (TSS). Prefer Garmin's own TSS; else derive HR-based load — the same
  // hrTSS the gauge/score engine uses (IF = avgHR / thresholdHR, threshold ≈
  // 88% of max when not set) — so a power-less indoor ride still reports a Load.
  let tss = num(activity.trainingStressScore);
  if (tss == null && avgHR > 0 && durationSecs > 0) {
    const tHR = thresholdHR || (maxHR > 0 ? maxHR * 0.88 : null);
    if (tHR) { const IFhr = avgHR / tHR; tss = Math.round((durationSecs / 3600) * IFhr * IFhr * 100 * 10) / 10; }
  }

  // Power intensity factor (NP/FTP) when available; HR %-of-max otherwise.
  const intensityFactor = (normalizedPower > 0 && ftpW > 0) ? +(normalizedPower / ftpW).toFixed(2) : null;
  const hrPctMax = (avgHR > 0 && maxHR > 0) ? +(avgHR / maxHR).toFixed(2) : null;
  const efficiency = (avgPowerW > 0 && avgHR > 0) ? +(avgPowerW / avgHR).toFixed(2) : null; // W/bpm

  return {
    avgPowerW, normalizedPower, avgHR, maxHR,
    intensityFactor,     // power-based IF (null if no FTP)
    hrPctMax,            // HR fallback effort
    efficiency,          // W per bpm
    tss, durationSecs,
  };
}

export default cyclingMetricsFor;
