// ─── ARNOLD Health Connect Bridge ────────────────────────────────────────────
// Abstraction layer between Arnold's web code and the native Health Connect API.
// In Capacitor (Android), calls go through the Kotlin HealthConnectPlugin.
// On the web (GitHub Pages), provides a no-op/fallback so all existing features
// continue to work without Health Connect.
//
// Usage:
//   import { hcBridge, isNativePlatform } from './hc-bridge.js';
//   if (isNativePlatform()) {
//     const sessions = await hcBridge.readExerciseSessions(start, end);
//   }

// ── Platform detection ──────────────────────────────────────────────────────

let _isNative = null;

/**
 * Returns true when running inside Capacitor's Android WebView.
 * Cached after first call.
 */
export function isNativePlatform() {
  if (_isNative !== null) return _isNative;
  try {
    // Capacitor injects window.Capacitor on native platforms
    _isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch {
    _isNative = false;
  }
  return _isNative;
}

// ── Native bridge (Capacitor) ───────────────────────────────────────────────

function getNativePlugin() {
  try {
    return window.Capacitor.Plugins.HealthConnect;
  } catch {
    console.warn('[hc-bridge] HealthConnect plugin not available');
    return null;
  }
}

const nativeBridge = {
  /**
   * Request Health Connect permissions for the specified data types.
   * @param {string[]} dataTypes - e.g. ['ExerciseSession','SleepSession','Weight','HeartRate','Nutrition']
   * @returns {Promise<{granted: boolean, denied: string[]}>}
   */
  async requestPermissions(dataTypes = ['ExerciseSession', 'SleepSession', 'Weight', 'HeartRate', 'Nutrition', 'Hydration']) {
    const plugin = getNativePlugin();
    if (!plugin) return { granted: false, denied: dataTypes };
    return plugin.requestPermissions({ dataTypes });
  },

  /**
   * Check if Health Connect is available on the device.
   * @returns {Promise<{available: boolean, installed: boolean}>}
   */
  async checkAvailability() {
    const plugin = getNativePlugin();
    if (!plugin) return { available: false, installed: false };
    return plugin.checkAvailability();
  },

  /**
   * Read exercise sessions in date range.
   * @param {string} startDate - ISO date string (YYYY-MM-DD)
   * @param {string} endDate   - ISO date string (YYYY-MM-DD)
   * @returns {Promise<ExerciseRecord[]>}
   *
   * ExerciseRecord shape:
   *   { id, exerciseType, startTime, endTime, title,
   *     calories, distanceMeters, avgHeartRate, maxHeartRate,
   *     hrSamples: [{bpm, time}], route: [{lat, lng, time}] }
   */
  async readExerciseSessions(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readExerciseSessions({ startDate, endDate });
    return result?.sessions || [];
  },

  /**
   * Read sleep sessions in date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<SleepRecord[]>}
   *
   * SleepRecord shape:
   *   { id, startTime, endTime, durationMinutes,
   *     stages: [{stage: 'awake'|'light'|'deep'|'rem', startTime, endTime}] }
   */
  async readSleepSessions(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readSleepSessions({ startDate, endDate });
    return result?.sessions || [];
  },

  /**
   * Read weight records in date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<WeightRecord[]>}
   *
   * WeightRecord shape:
   *   { id, weightKg, time }
   */
  async readWeight(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readWeight({ startDate, endDate });
    return result?.records || [];
  },

  /**
   * Read heart rate records (resting) in date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<HeartRateRecord[]>}
   *
   * HeartRateRecord shape:
   *   { bpm, time }
   */
  async readHeartRate(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readHeartRate({ startDate, endDate });
    return result?.records || [];
  },

  /**
   * Read nutrition records in date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<NutritionRecord[]>}
   *
   * NutritionRecord shape:
   *   { id, name, mealType, startTime, endTime,
   *     energy: {calories}, protein: {grams}, carbs: {grams}, fat: {grams},
   *     fiber: {grams}, sugar: {grams}, sodium: {mg}, potassium: {mg},
   *     calcium: {mg}, iron: {mg}, vitaminA: {mcg}, vitaminC: {mg},
   *     vitaminD: {mcg}, vitaminE: {mg}, vitaminK: {mcg},
   *     cholesterol: {mg}, saturatedFat: {grams}, unsaturatedFat: {grams},
   *     source: string }
   */
  async readNutrition(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readNutrition({ startDate, endDate });
    return result?.records || [];
  },

  /**
   * Read hydration records in date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {Promise<HydrationRecord[]>}
   *
   * HydrationRecord shape:
   *   { id, volumeMl, startTime, endTime }
   */
  async readHydration(startDate, endDate) {
    const plugin = getNativePlugin();
    if (!plugin) return [];
    const result = await plugin.readHydration({ startDate, endDate });
    return result?.records || [];
  },

  /**
   * Write a nutrition record to Health Connect (Arnold → HC write-back).
   * @param {Object} record - NutritionRecord to write
   * @returns {Promise<{success: boolean, id?: string}>}
   */
  async writeNutrition(record) {
    const plugin = getNativePlugin();
    if (!plugin) return { success: false };
    return plugin.writeNutrition({ record });
  },

  /**
   * Write a hydration record to Health Connect.
   * @param {Object} record - { volumeMl, startTime, endTime }
   * @returns {Promise<{success: boolean}>}
   */
  async writeHydration(record) {
    const plugin = getNativePlugin();
    if (!plugin) return { success: false };
    return plugin.writeHydration({ record });
  },

  /**
   * Get the last successful sync timestamp for a data type.
   * Stored locally in localStorage.
   * @param {string} dataType - 'exercise'|'sleep'|'weight'|'heartRate'|'nutrition'|'hydration'
   * @returns {string|null} ISO timestamp
   */
  getLastSyncTime(dataType) {
    try {
      return localStorage.getItem(`arnold:hc-sync:${dataType}`) || null;
    } catch {
      return null;
    }
  },

  /**
   * Set the last successful sync timestamp.
   * @param {string} dataType
   * @param {string} isoTime
   */
  setLastSyncTime(dataType, isoTime) {
    try {
      localStorage.setItem(`arnold:hc-sync:${dataType}`, isoTime);
    } catch { /* ignore */ }
  },
};

// ── Web fallback (no-op) ────────────────────────────────────────────────────
// Returns empty results so callers don't need platform checks everywhere.

const webFallback = {
  async requestPermissions() { return { granted: false, denied: ['Not available on web'] }; },
  async checkAvailability() { return { available: false, installed: false }; },
  async readExerciseSessions() { return []; },
  async readSleepSessions() { return []; },
  async readWeight() { return []; },
  async readHeartRate() { return []; },
  async readNutrition() { return []; },
  async readHydration() { return []; },
  async writeNutrition() { return { success: false }; },
  async writeHydration() { return { success: false }; },
  getLastSyncTime() { return null; },
  setLastSyncTime() {},
};

// ── Export the appropriate bridge ───────────────────────────────────────────

export const hcBridge = isNativePlatform() ? nativeBridge : webFallback;

// ── Exercise type mapping (Health Connect → Arnold) ─────────────────────────
// Health Connect uses integer exercise type codes. Map them to Arnold's string types.

export const HC_EXERCISE_TYPE_MAP = {
  // Running variants
  56: 'running',        // EXERCISE_TYPE_RUNNING
  57: 'running',        // EXERCISE_TYPE_RUNNING_TREADMILL
  73: 'trail_running',  // EXERCISE_TYPE_HIKING (close enough)

  // Strength
  80: 'strength_training',  // EXERCISE_TYPE_WEIGHTLIFTING
  68: 'strength_training',  // EXERCISE_TYPE_STRENGTH_TRAINING
  44: 'hiit',               // EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING

  // Cardio
  8:  'cycling',       // EXERCISE_TYPE_BIKING
  9:  'cycling',       // EXERCISE_TYPE_BIKING_STATIONARY
  71: 'swimming',      // EXERCISE_TYPE_SWIMMING_OPEN_WATER
  72: 'swimming',      // EXERCISE_TYPE_SWIMMING_POOL
  61: 'rowing',        // EXERCISE_TYPE_ROWING_MACHINE
  79: 'walking',       // EXERCISE_TYPE_WALKING
  29: 'elliptical',    // EXERCISE_TYPE_ELLIPTICAL
  82: 'yoga',          // EXERCISE_TYPE_YOGA
  50: 'pilates',       // EXERCISE_TYPE_PILATES

  // Fallback
  0:  'other',         // EXERCISE_TYPE_OTHER_WORKOUT
};

/**
 * Convert HC exercise type code to Arnold activity type string.
 * @param {number} code
 * @returns {string}
 */
export function mapExerciseType(code) {
  return HC_EXERCISE_TYPE_MAP[code] || 'other';
}

// ── Meal type mapping (Health Connect → Arnold) ─────────────────────────────

export const HC_MEAL_TYPE_MAP = {
  1: 'breakfast',
  2: 'lunch',
  3: 'dinner',
  4: 'snack',
  0: 'unknown',
};

export function mapMealType(code) {
  return HC_MEAL_TYPE_MAP[code] || 'unknown';
}
