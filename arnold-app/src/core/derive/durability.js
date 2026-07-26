// core/derive/durability.js — P2: DURABILITY as a first-class, trended metric + coach signal.
//
// WHY (ARNOLD_SCIENCE_AND_STRATEGY_2026.md §3): "physiological resilience / durability" is a peer-reviewed
// FOURTH pillar of endurance performance, INDEPENDENT of VO2max, and it improves marathon prediction beyond
// critical speed alone (Smyth & Muniz-Pumares 2022, 82,303 marathoners). Almost no consumer app coaches it.
// It's the clearest differentiation play for Arnold — and it's exactly what a marathoner needs: not just top
// speed, but the ability to HOLD pace late.
//
// DATA REALITY (honest): true aerobic decoupling needs WITHIN-run data (first-half vs second-half HR:pace).
// Arnold currently stores summary-only activities, and the `aerobicDecoupling` field is a rarely-populated
// passthrough. So this module has two sources, most-trustworthy first:
//   1. 'decoupling'  — real per-run aerobic decoupling (a.aerobicDecoupling) when present on ≥2 long runs.
//                      Gives an ABSOLUTE fade read (<5% durable · 5–8% holding · >8% fading).
//   2. 'ef-trend'    — a durability-specific proxy from summary data: is aerobic EFFICIENCY on LONG runs
//                      (speed per heartbeat) TRENDING UP over the block? Rising long-run EF = building
//                      durability. No absolute fade claim (we can't see late fade without intra-run data) —
//                      only a trend, clearly labeled. This is what makes the signal exist for everyone today.
// Follow-up (data layer): ingest Garmin/​FIT splits or HR streams → true per-run decoupling for all runs.
//
// PURE + node-testable: `today` injected, no storage/date imports.

const KM_PER_MI = 1.60934;
const DAY_MS = 86400000;
const WINDOW_DAYS = 84;        // 12 weeks
const LONG_KM = 14;            // a "long run" for durability purposes (≥ ~8.7 mi), or ≥75 min
const LONG_MIN = 75;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';
const median = (arr) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function runKmSec(a) {
  const mi = num(a && (a.distanceMi ?? a.distance_mi ?? a.miles));
  const km = mi != null ? mi * KM_PER_MI : num(a && (a.distanceKm ?? a.distance_km));
  const sec = num(a && (a.durationSecs ?? a.durationSeconds)) ?? (num(a && a.durationMinutes) != null ? num(a.durationMinutes) * 60 : null);
  return { km: km && km > 0 ? km : null, sec: sec && sec > 0 ? sec : null };
}
function ageDays(dateStr, today) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  if (!Number.isFinite(d) || !Number.isFinite(t)) return Infinity;
  return (t - d) / DAY_MS;
}
const isRunAct = (a) => { const t = String((a && (a.activityType ?? a.type)) || '').toLowerCase(); return t.includes('run') || t === '' || t.includes('long'); };

// Efficiency factor for a run: metres/min per heart-beat (speed per HR). Higher = more efficient. Needs HR.
function efOf(km, sec, avgHR) {
  if (!km || !sec || !avgHR) return null;
  const speedMPerMin = (km * 1000) / (sec / 60);
  return speedMPerMin / avgHR;
}

const STATE_FROM_DECOUP = (d) => (d <= 5 ? 'durable' : d <= 8 ? 'holding' : 'fading');

/**
 * estimateDurability(activities, opts) → durability state, or null when there's no usable long-run signal.
 *   opts.today — Date | 'YYYY-MM-DD'.
 * Returns { source:'decoupling'|'ef-trend', fadePct?, trendPct?, state?, trend, label, confidence, asOf,
 *           nLong, basis[] }.
 *   trend ∈ 'improving' | 'flat' | 'declining'
 */
export function estimateDurability(activities, opts = {}) {
  const today = opts.today || new Date();
  const longs = (Array.isArray(activities) ? activities : [])
    .filter(isRunAct)
    .map((a) => {
      const { km, sec } = runKmSec(a);
      if (!km || !sec) return null;
      const days = ageDays(a.date, today);
      return { a, km, sec, days, avgHR: num(a.avgHR ?? a.averageHR ?? a.avg_hr), decoup: num(a.aerobicDecoupling) };
    })
    .filter(Boolean)
    .filter((r) => r.days <= WINDOW_DAYS && (r.km >= LONG_KM || r.sec >= LONG_MIN * 60));
  if (longs.length < 2) return null;

  // ── Source 1: real aerobic decoupling (the gold signal, when present) ──
  const withDecoup = longs.filter((r) => Number.isFinite(r.decoup));
  if (withDecoup.length >= 2) {
    const decoups = withDecoup.map((r) => r.decoup);
    const fadePct = median(decoups);
    const state = STATE_FROM_DECOUP(fadePct);
    // Trend: recent decoupling vs older (lower decoupling = more durable = improving).
    const recent = withDecoup.filter((r) => r.days <= 28).map((r) => r.decoup);
    const older = withDecoup.filter((r) => r.days > 28).map((r) => r.decoup);
    let trend = 'flat', trendPct = null;
    if (recent.length && older.length) {
      const rm = median(recent), om = median(older);
      trendPct = +(om - rm).toFixed(1);   // positive = decoupling fell = improving durability
      trend = trendPct > 0.75 ? 'improving' : trendPct < -0.75 ? 'declining' : 'flat';
    }
    const asOf = withDecoup.map((r) => r.a.date).filter(Boolean).sort().slice(-1)[0] || null;
    const confidence = clamp(0.4 + 0.1 * withDecoup.length, 0, 0.9);
    return {
      source: 'decoupling', fadePct: +fadePct.toFixed(1), trendPct, state, trend,
      label: labelFor('decoupling', { state, trend, fadePct }),
      confidence: +confidence.toFixed(2), asOf, nLong: withDecoup.length,
      basis: withDecoup.sort((a, b) => (b.a.date || '').localeCompare(a.a.date || '')).slice(0, 5)
        .map((r) => ({ date: r.a.date, distanceMi: +(r.km / KM_PER_MI).toFixed(1), decoupPct: +r.decoup.toFixed(1) })),
    };
  }

  // ── Source 2: long-run efficiency TREND (proxy, summary-data only) ──
  const withEF = longs.filter((r) => r.avgHR).map((r) => ({ ...r, ef: efOf(r.km, r.sec, r.avgHR) })).filter((r) => r.ef);
  if (withEF.length >= 3) {
    const recent = withEF.filter((r) => r.days <= 28).map((r) => r.ef);
    const older = withEF.filter((r) => r.days > 28 && r.days <= WINDOW_DAYS).map((r) => r.ef);
    if (recent.length >= 1 && older.length >= 1) {
      const rm = median(recent), om = median(older);
      const trendPct = +(((rm - om) / om) * 100).toFixed(1);   // positive = EF up = building durability
      const trend = trendPct > 1.5 ? 'improving' : trendPct < -1.5 ? 'declining' : 'flat';
      const asOf = withEF.map((r) => r.a.date).filter(Boolean).sort().slice(-1)[0] || null;
      const confidence = clamp(0.25 + 0.06 * withEF.length, 0, 0.6);   // proxy → capped modest
      return {
        source: 'ef-trend', trendPct, state: null, trend,
        label: labelFor('ef-trend', { trend, trendPct }),
        confidence: +confidence.toFixed(2), asOf, nLong: withEF.length,
        basis: withEF.sort((a, b) => (b.a.date || '').localeCompare(a.a.date || '')).slice(0, 5)
          .map((r) => ({ date: r.a.date, distanceMi: +(r.km / KM_PER_MI).toFixed(1), ef: +r.ef.toFixed(3) })),
      };
    }
  }
  return null;
}

// Plain-language read (the coach's raw material — factCheck still bounds any LLM rephrase).
function labelFor(source, d) {
  if (source === 'decoupling') {
    if (d.state === 'durable') return `Your pace held late in long runs (${d.fadePct}% drift) — that's marathon-specific durability the pace tables miss.`;
    if (d.state === 'holding') return `Long-run drift is moderate (${d.fadePct}%) — durability is decent; more time-on-feet tightens it.`;
    return `You're fading late in long runs (${d.fadePct}% drift) — durability is the limiter to build before race pace.`;
  }
  // ef-trend
  if (d.trend === 'improving') return `Your efficiency on long runs is trending up (+${d.trendPct}%) — you're getting more durable, holding the same effort at a better pace.`;
  if (d.trend === 'declining') return `Long-run efficiency has slipped (${d.trendPct}%) lately — worth checking fatigue, fueling, or heat before the next big one.`;
  return `Long-run efficiency is steady — durability is holding; a longer or slightly faster long run is the next stimulus.`;
}

export default estimateDurability;
