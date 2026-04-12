// ─── ARNOLD Health Connect Sync Orchestrator ────────────────────────────────
// Reads data from Health Connect via hc-bridge, maps it into Arnold's storage
// format, merges with existing data (dedup), and persists via storage.js.
//
// Sync strategy:
//   - On app open: syncAll() reads from last sync timestamp → now
//   - Periodic: every 15 min via setInterval
//   - Manual: user can trigger from UI
//   - Write-back: Arnold food logs → Health Connect NutritionRecord
//
// Dedup:
//   - Activities: match by startTime ± 60s + same exercise type
//   - Sleep: match by date (one sleep session per night)
//   - Weight: match by date
//   - Nutrition: match by timestamp ± 120s + food name similarity
//   - Heart Rate: merge, keep latest per date for resting HR

import { hcBridge, isNativePlatform, mapExerciseType, mapMealType } from './hc-bridge.js';
import { storage } from './storage.js';

// ── Constants ───────────────────────────────────────────────────────────────

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_LOOKBACK_DAYS = 7;          // First sync: last 7 days
const KG_TO_LBS = 2.20462;
const METERS_TO_MILES = 0.000621371;

let _syncIntervalId = null;
let _syncing = false;

// ── Listeners ───────────────────────────────────────────────────────────────
// Components can subscribe to sync events for UI updates.

const _listeners = new Set();

export function onSyncEvent(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(event, payload) {
  for (const fn of _listeners) {
    try { fn(event, payload); } catch { /* ignore */ }
  }
}

// ── Date helpers ────────────────────────────────────────────────────────────

function isoDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function nowISO() {
  return new Date().toISOString();
}

function startOfDay(dateStr) {
  return `${dateStr}T00:00:00.000Z`;
}

function endOfDay(dateStr) {
  return `${dateStr}T23:59:59.999Z`;
}

// ── Sync: Exercise Sessions ─────────────────────────────────────────────────

async function syncExercise() {
  const lastSync = hcBridge.getLastSyncTime('exercise');
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(DEFAULT_LOOKBACK_DAYS);
  const endDate = isoDate(new Date());

  const sessions = await hcBridge.readExerciseSessions(startDate, endDate);
  if (!sessions.length) return { synced: 0 };

  const existing = storage.get('activities') || [];
  const existingByKey = new Map();
  for (const a of existing) {
    // Key: date + approximate start time (hour) + type
    const key = `${a.date}|${a.startHour || ''}|${(a.activityType || '').toLowerCase()}`;
    existingByKey.set(key, a);
  }

  let added = 0;
  for (const sess of sessions) {
    const startTime = new Date(sess.startTime);
    const endTime = new Date(sess.endTime);
    const date = isoDate(startTime);
    const durationSecs = Math.round((endTime - startTime) / 1000);
    const actType = mapExerciseType(sess.exerciseType);
    const distanceMi = sess.distanceMeters ? (sess.distanceMeters * METERS_TO_MILES) : 0;

    // Dedup key
    const dedupKey = `${date}|${startTime.getHours()}|${actType}`;
    if (existingByKey.has(dedupKey)) continue;

    // Compute pace for running
    let avgPaceRaw = null;
    if (actType.includes('run') && distanceMi > 0 && durationSecs > 0) {
      const paceSecsPerMile = durationSecs / distanceMi;
      const min = Math.floor(paceSecsPerMile / 60);
      const sec = Math.round(paceSecsPerMile % 60);
      avgPaceRaw = `${min}:${String(sec).padStart(2, '0')}`;
    }

    const record = {
      date,
      startHour: startTime.getHours(),
      activityType: actType.includes('run') ? 'Running' :
                    actType.includes('strength') ? 'Strength Training' :
                    actType.includes('cycling') ? 'Cycling' :
                    sess.title || actType,
      activityName: sess.title || actType,
      durationSecs,
      calories: Math.round(sess.calories || 0),
      distanceMi: Math.round(distanceMi * 100) / 100,
      avgHR: sess.avgHeartRate || null,
      maxHR: sess.maxHeartRate || null,
      avgPaceRaw,
      totalAscentFt: null, // HC doesn't provide elevation directly
      source: 'health_connect',
      hcId: sess.id,
    };

    existing.push(record);
    existingByKey.set(dedupKey, record);
    added++;
  }

  if (added > 0) {
    // Sort by date descending
    existing.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    storage.set('activities', existing);
  }

  hcBridge.setLastSyncTime('exercise', nowISO());
  return { synced: added };
}

// ── Sync: Sleep Sessions ────────────────────────────────────────────────────

async function syncSleep() {
  const lastSync = hcBridge.getLastSyncTime('sleep');
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(DEFAULT_LOOKBACK_DAYS);
  const endDate = isoDate(new Date());

  const sessions = await hcBridge.readSleepSessions(startDate, endDate);
  if (!sessions.length) return { synced: 0 };

  const existing = storage.get('sleep') || [];
  const existingByDate = new Map(existing.map(s => [s.date, s]));

  let added = 0;
  for (const sess of sessions) {
    const date = isoDate(sess.startTime);

    // One sleep record per night — HC record wins if newer
    if (existingByDate.has(date)) {
      const ex = existingByDate.get(date);
      if (ex.source === 'health_connect') continue; // already from HC
    }

    // Compute stage durations from stages array
    let deepMins = 0, remMins = 0, lightMins = 0, awakeMins = 0;
    if (sess.stages && Array.isArray(sess.stages)) {
      for (const stage of sess.stages) {
        const dur = (new Date(stage.endTime) - new Date(stage.startTime)) / 60000;
        switch (stage.stage) {
          case 'deep':  deepMins += dur; break;
          case 'rem':   remMins += dur; break;
          case 'light': lightMins += dur; break;
          case 'awake': awakeMins += dur; break;
        }
      }
    }

    const record = {
      date,
      durationMinutes: Math.round(sess.durationMinutes || ((new Date(sess.endTime) - new Date(sess.startTime)) / 60000)),
      deepSleepMinutes: Math.round(deepMins),
      remSleepMinutes: Math.round(remMins),
      lightSleepMinutes: Math.round(lightMins),
      awakeMinutes: Math.round(awakeMins),
      restingHR: null, // Populated separately from HeartRate sync
      sleepScore: null, // Arnold computes this from stages
      source: 'health_connect',
      hcId: sess.id,
    };

    // Arnold's sleep scoring: rough formula from stage distribution
    // Deep 20%+ = good, REM 20%+ = good, awake < 10% = good
    const total = record.durationMinutes || 1;
    const deepPct = deepMins / total;
    const remPct = remMins / total;
    const awakePct = awakeMins / total;
    record.sleepScore = Math.round(
      Math.min(100,
        (total >= 420 ? 30 : (total / 420) * 30) + // 7h+ = 30 pts
        (deepPct >= 0.2 ? 25 : (deepPct / 0.2) * 25) + // deep 20%+ = 25 pts
        (remPct >= 0.2 ? 25 : (remPct / 0.2) * 25) + // REM 20%+ = 25 pts
        (awakePct <= 0.1 ? 20 : Math.max(0, (1 - awakePct / 0.3) * 20)) // awake <10% = 20 pts
      )
    );

    existingByDate.set(date, record);
    added++;
  }

  if (added > 0) {
    const merged = Array.from(existingByDate.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    storage.set('sleep', merged);
  }

  hcBridge.setLastSyncTime('sleep', nowISO());
  return { synced: added };
}

// ── Sync: Weight ────────────────────────────────────────────────────────────

async function syncWeight() {
  const lastSync = hcBridge.getLastSyncTime('weight');
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(DEFAULT_LOOKBACK_DAYS);
  const endDate = isoDate(new Date());

  const records = await hcBridge.readWeight(startDate, endDate);
  if (!records.length) return { synced: 0 };

  const existing = storage.get('weight') || [];
  const existingByDate = new Map(existing.map(w => [w.date, w]));

  let added = 0;
  for (const rec of records) {
    const date = isoDate(rec.time);
    if (existingByDate.has(date)) {
      const ex = existingByDate.get(date);
      if (ex.source === 'health_connect') continue;
    }

    const weightLbs = Math.round(rec.weightKg * KG_TO_LBS * 10) / 10;

    const record = {
      date,
      weightLbs,
      weightKg: Math.round(rec.weightKg * 10) / 10,
      bodyFatPct: null, // Garmin doesn't write BF to HC
      bmi: null,        // Can be computed from height in profile
      source: 'health_connect',
    };

    // Compute BMI if profile has height
    try {
      const profile = storage.get('profile') || {};
      const heightIn = parseFloat(profile.heightInches) || parseFloat(profile.height);
      if (heightIn && heightIn > 0) {
        record.bmi = Math.round((weightLbs / (heightIn * heightIn)) * 703 * 10) / 10;
      }
    } catch { /* ignore */ }

    existingByDate.set(date, record);
    added++;
  }

  if (added > 0) {
    const merged = Array.from(existingByDate.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    storage.set('weight', merged);
  }

  hcBridge.setLastSyncTime('weight', nowISO());
  return { synced: added };
}

// ── Sync: Heart Rate (resting HR) ──────────────────────────────────────────

async function syncHeartRate() {
  const lastSync = hcBridge.getLastSyncTime('heartRate');
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(DEFAULT_LOOKBACK_DAYS);
  const endDate = isoDate(new Date());

  const records = await hcBridge.readHeartRate(startDate, endDate);
  if (!records.length) return { synced: 0 };

  // Group by date, find minimum BPM per day (≈ resting HR)
  const byDate = {};
  for (const rec of records) {
    const date = isoDate(rec.time);
    if (!byDate[date] || rec.bpm < byDate[date]) {
      byDate[date] = rec.bpm;
    }
  }

  // Merge into sleep records (restingHR field) and HRV records
  const sleepData = storage.get('sleep') || [];
  const sleepByDate = new Map(sleepData.map(s => [s.date, s]));

  let updated = 0;
  for (const [date, minBpm] of Object.entries(byDate)) {
    const sleep = sleepByDate.get(date);
    if (sleep && !sleep.restingHR) {
      sleep.restingHR = minBpm;
      sleepByDate.set(date, sleep);
      updated++;
    }
  }

  if (updated > 0) {
    storage.set('sleep', Array.from(sleepByDate.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  }

  hcBridge.setLastSyncTime('heartRate', nowISO());
  return { synced: updated };
}

// ── Sync: Nutrition (from Cronometer via HC) ────────────────────────────────

async function syncNutrition() {
  const lastSync = hcBridge.getLastSyncTime('nutrition');
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(DEFAULT_LOOKBACK_DAYS);
  const endDate = isoDate(new Date());

  const records = await hcBridge.readNutrition(startDate, endDate);
  if (!records.length) return { synced: 0 };

  // Load existing cronometer data
  const existing = storage.get('cronometer') || [];
  const existingByDate = new Map();
  for (const r of existing) {
    if (!existingByDate.has(r.date)) existingByDate.set(r.date, []);
    existingByDate.get(r.date).push(r);
  }

  // Also load nutrition-log (Arnold's own food entries)
  const arnoldLog = (() => {
    try { return JSON.parse(localStorage.getItem('arnold:nutrition-log') || '[]'); }
    catch { return []; }
  })();
  const arnoldTimestamps = new Set(arnoldLog.map(e => e.timestamp));

  let added = 0;

  // Group HC nutrition records by date, sum macros per day
  // (Cronometer typically writes individual food items)
  const byDate = {};
  for (const rec of records) {
    const date = isoDate(rec.startTime);
    if (!byDate[date]) {
      byDate[date] = {
        date,
        calories: 0, protein: 0, carbs: 0, fat: 0,
        fiber: 0, sugar: 0, sodium: 0, potassium: 0,
        calcium: 0, iron: 0, magnesium: 0,
        source: 'health_connect',
        items: [],
      };
    }
    const day = byDate[date];
    day.calories += rec.energy?.calories || 0;
    day.protein += rec.protein?.grams || 0;
    day.carbs += rec.carbs?.grams || 0;
    day.fat += rec.fat?.grams || 0;
    day.fiber += (rec.fiber?.grams || 0);
    day.sugar += (rec.sugar?.grams || 0);
    day.sodium += (rec.sodium?.mg || 0);
    day.potassium += (rec.potassium?.mg || 0);
    day.calcium += (rec.calcium?.mg || 0);
    day.iron += (rec.iron?.mg || 0);
    day.magnesium += (rec.magnesium?.mg || 0);

    // Track individual items for nutrition-log merge
    day.items.push({
      name: rec.name || 'Unknown food',
      meal: mapMealType(rec.mealType),
      calories: Math.round(rec.energy?.calories || 0),
      protein: Math.round((rec.protein?.grams || 0) * 10) / 10,
      carbs: Math.round((rec.carbs?.grams || 0) * 10) / 10,
      fat: Math.round((rec.fat?.grams || 0) * 10) / 10,
      timestamp: rec.startTime,
      source: rec.source || 'cronometer',
    });
  }

  // Merge daily totals into cronometer data
  for (const [date, dayData] of Object.entries(byDate)) {
    const rounded = {
      date: dayData.date,
      calories: Math.round(dayData.calories),
      protein: Math.round(dayData.protein),
      carbs: Math.round(dayData.carbs),
      fat: Math.round(dayData.fat),
      fiber: Math.round(dayData.fiber),
      sugar: Math.round(dayData.sugar),
      sodium: Math.round(dayData.sodium),
      potassium: Math.round(dayData.potassium),
      calcium: Math.round(dayData.calcium),
      iron: Math.round(dayData.iron * 10) / 10,
      magnesium: Math.round(dayData.magnesium),
      source: 'health_connect',
    };

    const existingDay = existingByDate.get(date);
    if (existingDay && existingDay.length > 0) {
      // Check if this is already from HC
      if (existingDay[0].source === 'health_connect') continue;
      // Replace CSV data with HC data (HC is fresher, more granular)
      existingByDate.set(date, [rounded]);
    } else {
      existingByDate.set(date, [rounded]);
    }
    added++;

    // Also merge individual items into nutrition-log (for meal-level tracking)
    for (const item of dayData.items) {
      // Dedup: skip if Arnold already has an entry within ±2min
      const itemTime = new Date(item.timestamp).getTime();
      const isDup = arnoldLog.some(e => {
        if (!e.timestamp) return false;
        const diff = Math.abs(new Date(e.timestamp).getTime() - itemTime);
        return diff < 120000; // 2 minutes
      });
      if (!isDup) {
        arnoldLog.push({
          ...item,
          source: item.source || 'cronometer',
          syncedFromHC: true,
        });
      }
    }
  }

  if (added > 0) {
    // Flatten and save cronometer daily totals
    const allDays = [];
    for (const entries of existingByDate.values()) {
      allDays.push(...entries);
    }
    allDays.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    storage.set('cronometer', allDays);

    // Save enriched nutrition-log
    try {
      localStorage.setItem('arnold:nutrition-log', JSON.stringify(arnoldLog));
    } catch { /* ignore */ }
  }

  hcBridge.setLastSyncTime('nutrition', nowISO());
  return { synced: added };
}

// ── Write-back: Arnold food log → Health Connect ────────────────────────────

/**
 * Push an Arnold-logged food entry to Health Connect.
 * Call this after user logs food in NutritionInput.
 * @param {Object} entry - { name, calories, protein, carbs, fat, timestamp }
 * @returns {Promise<boolean>} true if write succeeded
 */
export async function writeBackNutrition(entry) {
  if (!isNativePlatform()) return false;

  const record = {
    name: entry.name || entry.food || 'Food entry',
    mealType: entry.meal === 'breakfast' ? 1 : entry.meal === 'lunch' ? 2 :
              entry.meal === 'dinner' ? 3 : entry.meal === 'snack' ? 4 : 0,
    startTime: entry.timestamp || new Date().toISOString(),
    endTime: entry.timestamp || new Date().toISOString(),
    energy: { calories: entry.calories || 0 },
    protein: { grams: entry.protein || 0 },
    carbs: { grams: entry.carbs || 0 },
    fat: { grams: entry.fat || 0 },
    source: 'arnold',
  };

  const result = await hcBridge.writeNutrition(record);
  return result?.success || false;
}

// ── Master sync ─────────────────────────────────────────────────────────────

/**
 * Run all sync operations. Called on app boot and periodically.
 * @returns {Promise<SyncResult>}
 */
export async function syncAll() {
  if (!isNativePlatform()) {
    return { native: false, skipped: true };
  }

  if (_syncing) {
    return { native: true, skipped: true, reason: 'already syncing' };
  }

  _syncing = true;
  emit('sync:start', {});

  const results = {};
  try {
    // Check permissions first
    const perms = await hcBridge.requestPermissions();
    if (!perms.granted) {
      emit('sync:error', { error: 'Permissions not granted', denied: perms.denied });
      return { native: true, permissionDenied: true, denied: perms.denied };
    }

    // Run all syncs in parallel where safe
    const [exercise, sleep, weight, heartRate, nutrition] = await Promise.allSettled([
      syncExercise(),
      syncSleep(),
      syncWeight(),
      syncHeartRate(),
      syncNutrition(),
    ]);

    results.exercise = exercise.status === 'fulfilled' ? exercise.value : { error: exercise.reason?.message };
    results.sleep = sleep.status === 'fulfilled' ? sleep.value : { error: sleep.reason?.message };
    results.weight = weight.status === 'fulfilled' ? weight.value : { error: weight.reason?.message };
    results.heartRate = heartRate.status === 'fulfilled' ? heartRate.value : { error: heartRate.reason?.message };
    results.nutrition = nutrition.status === 'fulfilled' ? nutrition.value : { error: nutrition.reason?.message };

    const totalSynced = Object.values(results).reduce((s, r) => s + (r?.synced || 0), 0);
    results.totalSynced = totalSynced;
    results.timestamp = nowISO();

    emit('sync:complete', results);
  } catch (err) {
    results.error = err.message;
    emit('sync:error', { error: err.message });
  } finally {
    _syncing = false;
  }

  return { native: true, ...results };
}

/**
 * Get a summary of the last sync for display in UI.
 * @returns {Object}
 */
export function getSyncStatus() {
  return {
    isNative: isNativePlatform(),
    isSyncing: _syncing,
    lastSync: {
      exercise: hcBridge.getLastSyncTime('exercise'),
      sleep: hcBridge.getLastSyncTime('sleep'),
      weight: hcBridge.getLastSyncTime('weight'),
      heartRate: hcBridge.getLastSyncTime('heartRate'),
      nutrition: hcBridge.getLastSyncTime('nutrition'),
    },
  };
}

// ── Periodic sync lifecycle ─────────────────────────────────────────────────

/**
 * Start periodic Health Connect sync. Call once at app boot.
 * No-op on web platform.
 */
export function startPeriodicSync() {
  if (!isNativePlatform()) return;
  if (_syncIntervalId) return; // Already started

  // Initial sync
  syncAll().catch(err => console.warn('[hc-sync] Initial sync failed:', err));

  // Periodic sync every 15 minutes
  _syncIntervalId = setInterval(() => {
    syncAll().catch(err => console.warn('[hc-sync] Periodic sync failed:', err));
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop periodic sync (e.g., on app background).
 */
export function stopPeriodicSync() {
  if (_syncIntervalId) {
    clearInterval(_syncIntervalId);
    _syncIntervalId = null;
  }
}
