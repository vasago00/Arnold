// core/derive/marathonExperience.js — the DURABILITY-from-career signal.
//
// Emil's principle, made precise: the LEVEL (current speed / VDOT) must come from RECENT data only — a race
// from last year says nothing about today's fitness. But marathon DURABILITY is different: finishing many
// marathons is a real, slow-to-fade physiological adaptation (tendon/muscle resilience, fat oxidation, the
// pacing/fuelling skill of covering 42 km). A 15-time marathoner with only a 13-mile recent long run is NOT as
// under-prepared as a first-timer with the same recent volume — their legs remember the distance. This computes
// how marathon-proven the athlete is, so the projection's "unproven-distance" fade can be RELAXED (never
// eliminated — an experienced runner still needs some recent endurance) without ever touching the current level.
//
// Reads the athlete's OWN run history (marathons only — the run-gate keeps a 45 km ski out), weights by count
// (durability saturates after a few marathons) and recency (the adaptation persists for years but does fade).
// PURE + node-testable.

const KM_PER_MI = 1.60934;
const DAY_MS = 86400000;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
import { clamp } from '../stats.js';

// Same run-gate the observation layer uses — a non-run of marathon distance (a ski, a long ride) is NOT a
// marathon finish.
const NON_RUN = /\b(ski|snowboard|cycl|bik|ride|swim|strength|hiit|walk|hik|row|ellipt|yoga|mobility|breath|skate|hyrox|cardio)\w*/i;
function isRunMarathon(a) {
  if (!a) return false;
  const type = String(a.activityType ?? a.type ?? a.sport ?? a.garminTypeKey ?? '').toLowerCase();
  if (a.isRun === false || (a.isRun !== true && NON_RUN.test(type))) return false;
  const mi = num(a.distanceMi ?? a.distance_mi);
  const km = mi != null ? mi * KM_PER_MI : num(a.distanceKm ?? a.distance_km);
  return km != null && km >= 40;   // ≥40 km → a marathon-distance run (allows small GPS under-read)
}

function ageDays(dateStr, today) {
  if (!dateStr) return Infinity;
  const d = new Date(`${dateStr}T12:00:00`).getTime();
  const t = (today instanceof Date ? today.getTime() : new Date(`${today}T12:00:00`).getTime());
  return (Number.isFinite(d) && Number.isFinite(t)) ? (t - d) / DAY_MS : Infinity;
}

/**
 * marathonExperience(activities, { today }) → { finishes, lastDaysAgo, provenKm, expFactor }.
 *   expFactor ∈ [0,1]: 0 = never run a marathon (or too long ago to count); 1 = a seasoned, recently-active
 *   marathoner. Combines COUNT (saturates at 3 finishes — durability adaptation plateaus) with RECENCY of the
 *   most recent marathon (full weight ≤ 12 months, fading to a floor by ~3 years).
 */
export function marathonExperience(activities, opts = {}) {
  const today = opts.today || new Date();
  // Two sources: the recent activity STREAM (a marathon just run) and the curated career RÉSUMÉ (careerRaces —
  // his major finishes, which don't all live in Garmin). Merge + dedup by date so a marathon in both counts once.
  const pool = [...(Array.isArray(activities) ? activities : []), ...(Array.isArray(opts.careerRaces) ? opts.careerRaces : [])];
  const seen = new Set();
  const mars = pool
    .filter(isRunMarathon)
    .map((a) => { const mi = num(a.distanceMi ?? a.distance_mi); const km = mi != null ? mi * KM_PER_MI : num(a.distanceKm ?? a.distance_km); return { date: a.date, km, days: ageDays(a.date, today) }; })
    .filter((m) => Number.isFinite(m.days) && m.date)
    .filter((m) => { if (seen.has(m.date)) return false; seen.add(m.date); return true; })   // one finish per date
    .sort((a, b) => a.days - b.days);   // most recent first

  if (!mars.length) return { finishes: 0, lastDaysAgo: null, provenKm: 0, expFactor: 0 };

  const finishes = mars.length;
  const lastDaysAgo = mars[0].days;
  const provenKm = Math.max(...mars.map((m) => m.km));

  const countFactor = clamp(finishes / 3, 0, 1);                       // 3+ marathons → durability plateau
  const recencyFactor = lastDaysAgo <= 365 ? 1                          // within a year → full
    : lastDaysAgo >= 1095 ? 0.1                                          // >3 years → a small residual only
    : +(1 - ((lastDaysAgo - 365) / 730) * 0.9).toFixed(3);              // linear fade in between
  const expFactor = +clamp(countFactor * recencyFactor, 0, 1).toFixed(2);

  return { finishes, lastDaysAgo: Math.round(lastDaysAgo), provenKm: +provenKm.toFixed(1), expFactor };
}

export default marathonExperience;
