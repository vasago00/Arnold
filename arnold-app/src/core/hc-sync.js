// ─── ARNOLD Health Connect Sync Orchestrator ────────────────────────────────
// Reads data from Health Connect via hc-bridge, maps it into Arnold's storage
// format, merges with existing data (dedup), and persists via storage.js.
//
// POLICY — ONE-WAY READER ONLY:
//   Arnold never writes back to Health Connect. HC is the upstream system of
//   record for steps, sleep, body comp, and active energy; Arnold consumes
//   that data, normalizes it, and merges it locally. We do NOT call
//   writeRecords / insertRecords / any HC mutation API. If a feature ever
//   needs to publish data outward (e.g. workout completion to HC), it must
//   go through a separate, opt-in module — not this orchestrator.
//
// Sync strategy:
//   - On app open: syncAll() reads from last sync timestamp → now
//   - Periodic: every 15 min via setInterval
//   - Manual: user can trigger from UI
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

    // One sleep record per night, with source-priority resolution:
    //   - garmin-worker (Phase 4c): Worker has Garmin's authoritative composite
    //     sleep score AND stage durations from the same upstream — do not
    //     overwrite under any circumstance.
    //   - health_connect: skip if we already wrote this date in a previous sweep.
    //   - csv import / other: HC supersedes (we keep iterating through and the
    //     `existingByDate.set` below replaces it).
    if (existingByDate.has(date)) {
      const ex = existingByDate.get(date);
      if (ex.source === 'garmin-worker') continue; // Worker is authoritative
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

    // Derive local-time HH:MM bedtime / waketime so the Sleep Regularity tile
    // (which reads `sleepStart`) computes 7-night SD on HC-sourced rows too.
    const startDate = new Date(sess.startTime);
    const endDate   = new Date(sess.endTime);
    const sleepStart = Number.isFinite(startDate.getTime())
      ? `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`
      : null;
    const wakeTime = Number.isFinite(endDate.getTime())
      ? `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`
      : null;
    const record = {
      date,
      durationMinutes: Math.round(sess.durationMinutes || ((new Date(sess.endTime) - new Date(sess.startTime)) / 60000)),
      deepSleepMinutes: Math.round(deepMins),
      remSleepMinutes: Math.round(remMins),
      lightSleepMinutes: Math.round(lightMins),
      awakeMinutes: Math.round(awakeMins),
      sleepStart,        // local "HH:MM" — used by Sleep Regularity tile
      wakeTime,          // local "HH:MM"
      restingHR: null, // Populated separately from HeartRate sync
      // sleepScore: Health Connect does NOT expose Garmin's proprietary
      // sleep score — only the stage breakdown. Earlier this code computed
      // an approximation from stages, which produced values that diverged
      // significantly from what Garmin Connect/the watch displays (e.g.
      // 86 from HC stages vs. 75 from Garmin's actual algorithm). The
      // approximation was misleading users into trusting an Arnold-computed
      // number as if it were Garmin's official score.
      //
      // Garmin's actual sleep score arrives only via the CSV export path
      // (parseKeyValueSleep() / parseSleepCSV() → 'garmin-kv' source). When
      // both an HC record and a CSV record exist for the same date, the
      // merge logic in storage.set('sleep', ...) keeps the most recent
      // write — so importing the daily Sleep.csv after HC has synced
      // overrides this null with Garmin's real number.
      sleepScore: null,
      source: 'health_connect',
      hcId: sess.id,
    };

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

// ── Sync: Daily Energy (Phase 4a — TDEE Tier 1 input) ───────────────────────
// Reads daily-aggregate Steps, Active Calories, and Total Calories from HC
// and writes them into the dedicated `hcDailyEnergy` collection (NOT the
// shared `dailyLogs` collection — that change was a Phase 4a bug fix).
//
// Why a separate collection?
//   FIT uploads (desktop) write to dailyLogs[today].fitActivities[].
//   HC sync (phone-only) used to write totalCalories/activeCalories/steps
//   onto the same dailyLogs[today] row. Two devices touching the same row
//   produced an LWW race: whichever device's snapshot was newer overwrote
//   the other's contribution, so a FIT uploaded on web could vanish after
//   the phone's next push. Splitting the writers into disjoint collections
//   eliminates the race entirely. tdee() Tier 1 reads from hcDailyEnergy.
//
// Schema:
//   hcDailyEnergy : array of { date, steps, activeCalories, totalCalories,
//                              wellnessSource, wellnessUpdatedAt }, newest first.

async function syncDailyEnergy() {
  const lastSync = hcBridge.getLastSyncTime('dailyEnergy');
  // First run: pull 14 days so DCY has a reasonable baseline immediately.
  // Subsequent runs overlap by a day to catch late-arriving data.
  const startDate = lastSync ? isoDate(lastSync) : daysAgo(14);
  const endDate = isoDate(new Date());

  const [stepsRows, activeKcalRows, totalKcalRows] = await Promise.all([
    hcBridge.readSteps(startDate, endDate),
    hcBridge.readActiveCaloriesBurned(startDate, endDate),
    hcBridge.readTotalCaloriesBurned(startDate, endDate),
  ]);

  // Index each stream by date for O(1) merge.
  const stepsByDate  = new Map(stepsRows.map(r => [r.date, r.steps]));
  const activeByDate = new Map(activeKcalRows.map(r => [r.date, r.kcal]));
  const totalByDate  = new Map(totalKcalRows.map(r => [r.date, r.kcal]));

  // Union: every date that had ANY movement signal in this window.
  const allDates = new Set([
    ...stepsByDate.keys(),
    ...activeByDate.keys(),
    ...totalByDate.keys(),
  ]);
  if (!allDates.size) {
    hcBridge.setLastSyncTime('dailyEnergy', nowISO());
    return { synced: 0 };
  }

  // Load existing hcDailyEnergy rows and index by date so we update in place.
  const existing = storage.get('hcDailyEnergy') || [];
  const byDate = new Map(existing.map(e => [e.date, e]));

  let updated = 0;
  for (const date of allDates) {
    const steps = Math.max(0, Math.round(stepsByDate.get(date) || 0));
    const activeCalories = Math.max(0, Math.round(activeByDate.get(date) || 0));
    const totalCalories = Math.max(0, Math.round(totalByDate.get(date) || 0));

    // Guard: don't write a row for a day HC has no real data for.
    // Small non-zero noise (< 100 steps, no cal totals) also gets skipped.
    if (steps < 100 && totalCalories === 0) continue;

    byDate.set(date, {
      date,
      steps,
      activeCalories,
      totalCalories,
      wellnessSource: 'health_connect',
      wellnessUpdatedAt: new Date().toISOString(),
    });
    updated++;
  }

  if (updated > 0) {
    const merged = Array.from(byDate.values())
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    storage.set('hcDailyEnergy', merged, { skipValidation: true });
  }

  hcBridge.setLastSyncTime('dailyEnergy', nowISO());
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
 * DISABLED — Arnold operates as a one-way reader of Health Connect.
 *
 * Cronometer is the authoritative source for nutrition / hydration: the
 * Cronometer app writes directly to HC, and Cronometer's own GWT-RPC
 * endpoint (Phase 3) is the live data path Arnold uses. Adding a second
 * Arnold→HC write here would just duplicate what Cronometer already wrote
 * (or worse — write conflicting values if Arnold's totals drift).
 *
 * Kept as a no-op stub so existing call sites keep working without changes.
 * If you ever want to flip this back on, restore the body and remove this
 * comment block.
 *
 * @returns {Promise<{success: false, disabled: true}>}
 */
export async function writeBackNutrition(_entry) {
  return { success: false, disabled: true };
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

    // Run all syncs in parallel where safe.
    //
    // DISABLED STREAMS
    //   exercise  — HC exercise data caused ghost mileage vs FIT uploads; FIT
    //               files via Cloud Sync are the authoritative source.
    //   nutrition — Cronometer live pull (Phase 3) is the authoritative source
    //               and writes a full-day entry to nutritionLog. HC's
    //               syncNutrition replays the same data (Cronometer app →
    //               HC → here) but also overwrites historical CSV imports in
    //               the `cronometer` collection, which we don't want. Keep
    //               the function in place for possible future re-enable, but
    //               don't run it as part of syncAll().
    //
    // dailyEnergy (Phase 4a) is safe to parallelize — it writes to a disjoint
    // set of dailyLogs fields and never touches the activities collection.
    const [sleep, weight, heartRate, dailyEnergy] = await Promise.allSettled([
      syncSleep(),
      syncWeight(),
      syncHeartRate(),
      syncDailyEnergy(),
    ]);

    results.exercise = { synced: 0, disabled: true };
    results.nutrition = { synced: 0, disabled: true, reason: 'Cronometer live pull is authoritative' };
    results.sleep = sleep.status === 'fulfilled' ? sleep.value : { error: sleep.reason?.message };
    results.weight = weight.status === 'fulfilled' ? weight.value : { error: weight.reason?.message };
    results.heartRate = heartRate.status === 'fulfilled' ? heartRate.value : { error: heartRate.reason?.message };
    results.dailyEnergy = dailyEnergy.status === 'fulfilled' ? dailyEnergy.value : { error: dailyEnergy.reason?.message };

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
      dailyEnergy: hcBridge.getLastSyncTime('dailyEnergy'),
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
