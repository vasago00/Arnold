// ─── Arnold Mobile Storage ──────────────────────────────────────────────────
// AsyncStorage wrapper matching the web app's storage.get/set API.
// Uses JSON serialization under 'arnold:*' keys.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'arnold:';

export const storage = {
  // Synchronous in-memory cache — hydrated on app start
  _cache: {},

  async hydrate() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const arnoldKeys = keys.filter(k => k.startsWith(PREFIX));
      const pairs = await AsyncStorage.multiGet(arnoldKeys);
      for (const [key, val] of pairs) {
        if (val != null) {
          try { this._cache[key.slice(PREFIX.length)] = JSON.parse(val); }
          catch { this._cache[key.slice(PREFIX.length)] = val; }
        }
      }
    } catch (e) { console.error('storage hydrate error:', e); }
  },

  get(key) {
    return this._cache[key] ?? null;
  },

  set(key, data) {
    this._cache[key] = data;
    AsyncStorage.setItem(PREFIX + key, JSON.stringify(data)).catch(e =>
      console.error(`storage.set(${key}) error:`, e)
    );
  },

  remove(key) {
    delete this._cache[key];
    AsyncStorage.removeItem(PREFIX + key).catch(() => {});
  },
};
