// ─── Intermittent Fasting detection + helpers ───────────────────────────────
// Some users (Emil) eat in a compressed window — typically lunch onwards,
// fasted through the morning beyond water / coffee / supplements. Without
// awareness of this pattern:
//   • Nutrition components in HS scoring crater every morning (no food yet
//     today → score = 0 → drags whole system score down).
//   • Coach signals that depend on TODAY's intake (energyAvailability,
//     tdeeDrift, glycogen, monotonyStrain) return null on fasted mornings,
//     which silently demotes systems like Gut and Metabolism.
//   • Coach copy says "morning fuel low" before the eating window opens,
//     which is wrong and demoralizing.
//
// This module:
//   • Detects IF pattern from Cronometer per-meal timestamps in the
//     nutritionLog (existing data — no new storage write required by user).
//   • Caches the detected profile in `ifProfile` storage key (computed once
//     per day on first read; recomputes if older than 24h).
//   • Provides helpers consumers use: `getIFProfile()`, `isInFastingWindow()`,
//     `rollingIntakeForIF(daysBack)` — so consumers don't have to re-derive.
//
// The detection is robust to occasional early-eating days (races, hard early
// workouts) by using the MEDIAN first-meal time over the last 14 days.

import { storage } from './storage.js';
import { localDate, ymd } from './time.js';
import { parseLocalDate } from './dateUtils.js';

// Cronometer per-meal rows have source='cronometer-live-meal' and carry an
// ISO `timestamp`. Calories threshold filters out coffee/water/tea (the user
// described "hot water with lemon, coffee with very little milk" as the
// morning baseline — none of those count as breaking the fast).
const REAL_MEAL_KCAL_THRESHOLD = 50;
const IF_FIRST_MEAL_HOUR_THRESHOLD = 11; // first real meal ≥ 11am on most days = IF
const DAYS_ANALYZED = 14;
const RECOMPUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ─── Detection ─────────────────────────────────────────────────────────────

/**
 * Walk per-meal entries from the last `daysBack` days. For each date, find
 * the EARLIEST timestamp on a meal with calories above the "real meal"
 * threshold. Return median first-meal hour-of-day plus IF classification.
 *
 * Returns:
 *   { isIF: bool, daysAnalyzed: int, medianFirstMealHour: number|null,
 *     typicalEatingWindowStart: int|null, reason?: string }
 */
export function detectIntermittentFasting(daysBack = DAYS_ANALYZED) {
  const log = storage.get('nutritionLog') || [];
  const today = parseLocalDate(localDate());
  if (!today) {
    return { isIF: false, daysAnalyzed: 0, medianFirstMealHour: null, typicalEatingWindowStart: null, reason: 'no_today' };
  }
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - daysBack);

  // For each date, capture the earliest timestamp of a "real" meal.
  const earliestByDate = {};
  for (const entry of log) {
    if (entry?.source !== 'cronometer-live-meal') continue;
    if (!entry?.date || !entry?.timestamp) continue;
    const d = parseLocalDate(entry.date);
    if (!d || d < cutoff || d >= today) continue; // ignore today (still in progress)
    const cal = Number(entry?.macros?.calories) || 0;
    if (cal < REAL_MEAL_KCAL_THRESHOLD) continue;
    const ts = new Date(entry.timestamp);
    if (!Number.isFinite(ts.getTime())) continue;
    if (!earliestByDate[entry.date] || ts < new Date(earliestByDate[entry.date])) {
      earliestByDate[entry.date] = entry.timestamp;
    }
  }

  const firstMealHours = Object.values(earliestByDate)
    .map(ts => { const d = new Date(ts); return d.getHours() + d.getMinutes() / 60; });

  if (firstMealHours.length < 5) {
    return {
      isIF: false,
      daysAnalyzed: firstMealHours.length,
      medianFirstMealHour: null,
      typicalEatingWindowStart: null,
      reason: 'insufficient_data',
    };
  }

  // Median is robust to single early-eating days (race, hard AM workout).
  const sorted = [...firstMealHours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  const isIF = median >= IF_FIRST_MEAL_HOUR_THRESHOLD;

  return {
    isIF,
    daysAnalyzed: firstMealHours.length,
    medianFirstMealHour: +median.toFixed(2),
    // Round DOWN to start-of-hour so "median = 12.5" means eating window
    // typically opens at noon, not 12:30 (cleaner Coach copy boundary).
    typicalEatingWindowStart: isIF ? Math.floor(median) : null,
  };
}

// ─── Cached accessor (most callers use this, not detectIntermittentFasting) ──

/**
 * Manual override from Goals → `intermittentFastingOverride` ('auto'|'on'|'off').
 * Goals take precedence over profile. Anything else falls back to 'auto'.
 */
function readIFOverride() {
  try {
    const g = storage.get('goals') || {};
    const p = storage.get('profile') || {};
    const v = (g.intermittentFastingOverride ?? p.intermittentFastingOverride);
    return (v === 'on' || v === 'off') ? v : 'auto';
  } catch { return 'auto'; }
}

/**
 * Apply the manual override on top of a (detected or cached) profile.
 * 'on' forces IF awareness (keeps detected window, defaults to noon);
 * 'off' disables it; 'auto' leaves detection untouched.
 */
function applyIFOverride(profile) {
  if (!profile) return profile;
  const ov = readIFOverride();
  if (ov === 'auto') return profile;
  if (ov === 'off') return { ...profile, isIF: false, typicalEatingWindowStart: null, overridden: 'off' };
  return { ...profile, isIF: true, typicalEatingWindowStart: profile.typicalEatingWindowStart ?? 12, overridden: 'on' };
}

/**
 * Returns the cached IF profile. Recomputes if stale (> 24h old) or absent.
 * Caches under storage key `ifProfile`. The manual override is applied at
 * read time so a Goals change takes effect immediately, without waiting for
 * the 24h cache to expire.
 */
export function getIFProfile() {
  const cached = storage.get('ifProfile');
  const age = cached?.computedAt ? Date.now() - cached.computedAt : Infinity;
  if (cached && age < RECOMPUTE_MAX_AGE_MS) return applyIFOverride(cached);
  return applyIFOverride(refreshIFProfile());
}

/**
 * Force a recompute and write to storage. Returns the new profile.
 */
export function refreshIFProfile() {
  const detected = detectIntermittentFasting(DAYS_ANALYZED);
  const profile = { ...detected, computedAt: Date.now() };
  try { storage.set('ifProfile', profile, { skipValidation: true }); } catch (e) {}
  return profile;
}

// ─── Consumer helpers ──────────────────────────────────────────────────────

/**
 * True if today is a scheduled race day. On race days the user breaks the
 * fast early (pre-race fuel / early gun time), so the fasting-window gate
 * must NOT treat the morning as fasted — otherwise we'd suppress legitimate
 * fuel guidance and mis-handle early intake. Detection (median over 14d)
 * already shrugs off the occasional early-eating day; this is the runtime
 * exception for the race day itself.
 */
export function isRaceDayToday() {
  try {
    const races = storage.get('races') || [];
    const t = localDate();
    return races.some(r => r?.date === t);
  } catch { return false; }
}

/**
 * True if the user is an IF user AND `nowHour` (defaults to current local
 * clock) is before their typical eating-window start. Use this to gate
 * "morning fuel" Coach copy and Nutrition-component penalties. Returns false
 * on race days (eating window opens early — see isRaceDayToday).
 */
export function isInFastingWindow(nowHour = null) {
  if (isRaceDayToday()) return false;
  const p = getIFProfile();
  if (!p?.isIF || p.typicalEatingWindowStart == null) return false;
  const h = nowHour != null ? nowHour : new Date().getHours();
  return h < p.typicalEatingWindowStart;
}

/**
 * Compute a "rolling intake" baseline over the last `daysBack` complete
 * days. Used as a Coach-signal fallback when today is sparse because the
 * user is fasting. Returns null when there isn't enough history.
 *
 * Returns: { calories, protein, carbs, fat, water, n } or null
 */
export function rollingIntakeForIF(daysBack = 3) {
  const log = storage.get('nutritionLog') || [];
  const today = parseLocalDate(localDate());
  if (!today) return null;
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - daysBack);

  const totals = {};
  for (const entry of log) {
    // Same source filter detection uses — keeps the rolling baseline
    // numbers honest. Including rollup rows alongside per-meal rows
    // double-counts (a day appears once as rollup and again per meal).
    if (entry?.source !== 'cronometer-live-meal') continue;
    if (!entry?.date) continue;
    const d = parseLocalDate(entry.date);
    if (!d || d < cutoff || d >= today) continue;
    const m = entry?.macros || {};
    totals[entry.date] = totals[entry.date] || { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 };
    totals[entry.date].calories += Number(m.calories) || 0;
    totals[entry.date].protein  += Number(m.protein)  || 0;
    totals[entry.date].carbs    += Number(m.carbs)    || 0;
    totals[entry.date].fat      += Number(m.fat)      || 0;
    totals[entry.date].water    += Number(m.water)    || 0;
  }

  const dailyTotals = Object.values(totals).filter(d => d.calories > 0);
  if (dailyTotals.length === 0) return null;

  const avg = dailyTotals.reduce((acc, d) => {
    acc.calories += d.calories; acc.protein += d.protein;
    acc.carbs += d.carbs; acc.fat += d.fat; acc.water += d.water;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, water: 0 });
  const n = dailyTotals.length;
  for (const k of ['calories', 'protein', 'carbs', 'fat', 'water']) avg[k] /= n;
  avg.n = n;
  return avg;
}

// ─── Debug helper ──────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.ifDebug = () => {
    const detected = detectIntermittentFasting();
    const cached = storage.get('ifProfile');
    const rolling3 = rollingIntakeForIF(3);
    console.log('━━ IF Detection ━━');
    console.log('detected (fresh compute):', detected);
    console.log('cached profile:', cached);
    console.log('manual override (goals):', readIFOverride());
    console.log('effective profile (override applied):', getIFProfile());
    console.log('is race day today:', isRaceDayToday());
    console.log('isInFastingWindow() right now:', isInFastingWindow());
    console.log('rolling 3d intake baseline:', rolling3);
    return { detected, cached, rolling3 };
  };
}
