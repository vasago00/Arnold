// ─── ARNOLD Memory (compatibility shim) ──────────────────────────────────────
// This file used to maintain its own `arnold-memory:*` localStorage namespace,
// which caused silent data divergence with `storage.js` (`arnold:*`).
//
// As of Phase 1 of the refactor, memory.js is a thin async wrapper over the
// unified `storage` service in storage.js. All reads/writes go through the
// SAME canonical keys. Existing call sites (which used the async signatures)
// keep working without changes.
//
// New code should import { storage } from './storage.js' directly.

import { storage } from './storage.js';

// ─── Workouts ──────────────────────────────────────────────────────────────────
export async function getWorkouts() {
  return storage.get('workouts') || [];
}

export async function saveWorkout(entry) {
  const all = await getWorkouts();
  const idx = all.findIndex(w => w.id === entry.id);
  if (idx >= 0) all[idx] = entry; else all.unshift(entry);
  all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  storage.set('workouts', all, { skipValidation: true });
  return all;
}

export async function findRelevantWorkouts(type, limit = 3) {
  const all = await getWorkouts();
  return all.filter(w => w.type === type).slice(0, limit);
}

// ─── Races ────────────────────────────────────────────────────────────────────
export async function getRaces() {
  return storage.get('races') || [];
}

export async function saveRaces(races) {
  storage.set('races', races, { skipValidation: true });
  return races;
}

// ─── Garmin (legacy aggregate, kept for Training tab compatibility) ──────────
export async function getGarmin() {
  // Falls back to the unified activities collection
  return storage.get('activities') || [];
}

export async function saveGarmin(entries) {
  // Merge into activities so the Training tab and other readers see them
  const existing = storage.get('activities') || [];
  const map = new Map(existing.map(e => [`${e.date}|${e.title || ''}`, e]));
  for (const e of entries) {
    map.set(`${e.date}|${e.title || ''}`, { ...(map.get(`${e.date}|${e.title || ''}`) || {}), ...e });
  }
  storage.set('activities', [...map.values()].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
  return entries;
}

// ─── Cronometer ───────────────────────────────────────────────────────────────
export async function getCronometer() {
  return storage.get('cronometer') || [];
}

export async function saveCronometer(entries) {
  storage.set('cronometer', entries);
  return entries;
}

// ─── Garmin Activities ────────────────────────────────────────────────────────
export async function getGarminActivities() {
  return storage.get('activities') || [];
}
export async function saveGarminActivities(entries) {
  storage.set('activities', entries);
  return entries;
}

// ─── Garmin HRV ───────────────────────────────────────────────────────────────
export async function getGarminHRV() {
  return storage.get('hrv') || [];
}
export async function saveGarminHRV(entries) {
  storage.set('hrv', entries);
  return entries;
}

// ─── Garmin Sleep ─────────────────────────────────────────────────────────────
export async function getGarminSleep() {
  return storage.get('sleep') || [];
}
export async function saveGarminSleep(entries) {
  storage.set('sleep', entries);
  return entries;
}

// ─── Garmin Weight ────────────────────────────────────────────────────────────
export async function getGarminWeight() {
  return storage.get('weight') || [];
}
export async function saveGarminWeight(entries) {
  storage.set('weight', entries);
  return entries;
}

// ─── Import History ───────────────────────────────────────────────────────────
export async function getImportHistory() {
  return storage.get('importHistory') || [];
}
export async function saveImportHistory(entries) {
  storage.set('importHistory', entries.slice(0, 20), { skipValidation: true });
  return entries;
}

// ─── Memory index (rebuilt on demand from inventory) ─────────────────────────
export async function getMemoryIndex() {
  const inv = storage.inventory();
  const idx = {};
  for (const [name, count] of Object.entries(inv)) {
    if (count > 0) idx[name] = { count, lastUpdated: new Date().toISOString() };
  }
  return idx;
}

// ─── AI context builder ───────────────────────────────────────────────────────
export async function buildWorkoutMemoryContext(type, limit = 3) {
  const workouts = await findRelevantWorkouts(type, limit);
  if (!workouts.length) return '';
  const lines = workouts.map(w => {
    const parts = [`${w.date} | ${w.type}${w.distance ? ` | ${w.distance}km` : ''} | RPE ${w.rpe}`];
    if (w.reflection) parts.push(`Reflection: "${w.reflection.slice(0, 130)}${w.reflection.length > 130 ? '...' : ''}"`);
    if (w.weather?.temp != null) parts.push(`Weather: ${w.weather.temp}°C, ${w.weather.condition || ''}, ${w.weather.wind ?? '?'}km/h wind`);
    return parts.join('\n');
  });
  return `[ARNOLD MEMORY — PAST WORKOUTS]\n${lines.join('\n\n')}\n[END MEMORY]`;
}
