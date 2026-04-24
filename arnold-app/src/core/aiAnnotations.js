// ─── Inline AI Annotations (Phase 8) ─────────────────────────────────────────
// Advisory-only observations that surface patterns Arnold notices in your
// data. Decisions stay with the user — these are coaching notes, not
// instructions. Pattern detection runs in pure JS (no LLM call) for the
// obvious cases; the LLM is reserved for narrative summaries via the per-tab
// AI buttons.
//
// Each annotation: { text, severity, source, hash }
//   text     — the observation, written as a fact, not a directive
//   severity — 'ok' | 'warn' | 'critical' | 'neutral' (drives color)
//   source   — which detector produced it (for debugging)
//   hash     — content fingerprint for cache invalidation

import { storage } from './storage.js';
import { weeklyRunVolume, weeklyStrengthVolume } from './derive/volume.js';
import { hrZoneFromBpm } from './derive/hr.js';

// ─── Detectors ───────────────────────────────────────────────────────────────

function detectSleepDip(sleepData) {
  if (!sleepData?.length) return null;
  const last7 = sleepData.slice(0, 7).filter(s => s.durationMinutes);
  const prev7 = sleepData.slice(7, 14).filter(s => s.durationMinutes);
  if (last7.length < 3 || prev7.length < 3) return null;
  const a = last7.reduce((s, r) => s + r.durationMinutes, 0) / last7.length;
  const b = prev7.reduce((s, r) => s + r.durationMinutes, 0) / prev7.length;
  const delta = a - b;
  if (Math.abs(delta) < 20) return null;
  return {
    text: `Sleep ${delta < 0 ? 'down' : 'up'} ${Math.abs(Math.round(delta))}min vs prior week (${(a/60).toFixed(1)}h avg).`,
    severity: delta < -45 ? 'critical' : delta < 0 ? 'warn' : 'ok',
    source: 'sleepDip',
  };
}

function detectHRVDrop(hrvData) {
  if (!hrvData?.length) return null;
  const last7 = hrvData.slice(0, 7).filter(h => h.overnightHRV);
  const prev7 = hrvData.slice(7, 14).filter(h => h.overnightHRV);
  if (last7.length < 3 || prev7.length < 3) return null;
  const a = last7.reduce((s, r) => s + r.overnightHRV, 0) / last7.length;
  const b = prev7.reduce((s, r) => s + r.overnightHRV, 0) / prev7.length;
  const pctDelta = ((a - b) / b) * 100;
  if (Math.abs(pctDelta) < 5) return null;
  return {
    text: `HRV ${pctDelta < 0 ? 'down' : 'up'} ${Math.abs(pctDelta).toFixed(0)}% vs prior week (${a.toFixed(0)}ms avg).`,
    severity: pctDelta < -12 ? 'critical' : pctDelta < 0 ? 'warn' : 'ok',
    source: 'hrvDrop',
  };
}

function detectVolumeSpike(activities) {
  if (!activities?.length) return null;
  const thisWk = weeklyRunVolume(activities);
  const lastWeek = new Date(); lastWeek.setDate(lastWeek.getDate() - 7);
  const last = weeklyRunVolume(activities, lastWeek);
  if (last.miles < 5) return null;
  const ratio = thisWk.miles / last.miles;
  if (ratio < 1.3 && ratio > 0.7) return null;
  return {
    text: `Weekly miles ${thisWk.miles.toFixed(1)} (${ratio < 1 ? 'down' : 'up'} ${Math.abs(Math.round((ratio - 1) * 100))}% vs last week).`,
    severity: ratio > 1.5 ? 'warn' : ratio < 0.6 ? 'warn' : 'ok',
    source: 'volumeSpike',
  };
}

function detectStrengthGap(activities) {
  const wk = weeklyStrengthVolume(activities || []);
  if (wk.sessions === 0) {
    return {
      text: 'No strength sessions logged this week yet.',
      severity: 'warn',
      source: 'strengthGap',
    };
  }
  return null;
}

function detectIntensityCorrelation(activities, sleepData) {
  if (!activities?.length || !sleepData?.length) return null;
  // Find runs in the last 7 days where the next-day sleep was logged
  const sleepByDate = Object.fromEntries(sleepData.map(s => [s.date, s.durationMinutes]));
  const recent = activities
    .filter(a => /running/i.test(a.activityType || '') && a.avgHR && a.maxHR && a.date)
    .slice(0, 10);
  if (recent.length < 3) return null;
  let highIntensityShortSleep = 0;
  for (const a of recent) {
    const next = new Date(a.date); next.setDate(next.getDate() + 1);
    const nextISO = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
    const sleep = sleepByDate[nextISO];
    if (!sleep) continue;
    const zone = hrZoneFromBpm(a.avgHR, a.maxHR);
    if ((zone === 'Z4' || zone === 'Z5') && sleep < 360) highIntensityShortSleep++;
  }
  if (highIntensityShortSleep < 2) return null;
  return {
    text: `${highIntensityShortSleep} hard runs were followed by sub-6h sleep this period.`,
    severity: 'warn',
    source: 'intensityCorrelation',
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

// Returns annotations relevant to the Training tab.
export function trainingAnnotations() {
  const activities = storage.get('activities') || [];
  const sleepData  = storage.get('sleep')      || [];
  const hrvData    = storage.get('hrv')        || [];
  return [
    detectVolumeSpike(activities),
    detectStrengthGap(activities),
    detectIntensityCorrelation(activities, sleepData),
    detectHRVDrop(hrvData),
    detectSleepDip(sleepData),
  ].filter(Boolean);
}

// Returns annotations relevant to the Daily tab (today's snapshot).
export function dailyAnnotations() {
  const sleepData = storage.get('sleep') || [];
  const hrvData   = storage.get('hrv')   || [];
  return [
    detectSleepDip(sleepData),
    detectHRVDrop(hrvData),
  ].filter(Boolean);
}
