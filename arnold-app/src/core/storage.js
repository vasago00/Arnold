// ─── ARNOLD Browser Storage Service ──────────────────────────────────────────
// Thin wrapper over localStorage for all imported data persistence.

const KEYS = {
  activities: 'arnold:garmin-activities',
  hrv: 'arnold:garmin-hrv',
  sleep: 'arnold:garmin-sleep',
  weight: 'arnold:garmin-weight',
  cronometer: 'arnold:cronometer',
  workouts: 'arnold:workouts',
  importHistory: 'arnold:import-history',
  profile: 'arnold:profile',
  races: 'arnold:races',
};

export const storage = {
  get: (key) => {
    try {
      const val = localStorage.getItem(KEYS[key] || key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },
  set: (key, data) => {
    try {
      localStorage.setItem(KEYS[key] || key, JSON.stringify(data));
      return true;
    } catch { return false; }
  },
  merge: (key, newItems, dedupeField = 'date') => {
    const existing = storage.get(key) || [];
    const existingMap = new Map(existing.map(i => [i[dedupeField], i]));
    for (const item of newItems) {
      existingMap.set(item[dedupeField], item);
    }
    const merged = [...existingMap.values()].sort((a, b) =>
      (b[dedupeField] || '').localeCompare(a[dedupeField] || '')
    );
    storage.set(key, merged);
    return merged;
  },
  clear: (key) => localStorage.removeItem(KEYS[key] || key),
};
