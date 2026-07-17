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
import { daySessions, makeDay } from './planner.js';

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
  // Mirror to raw localStorage — ~10 surfaces (EdgeIQ, LogDay, TrainingTab,
  // goalModel, MobileHome's nextRace…) read 'arnold:races' straight from
  // localStorage, which the IndexedDB engine does NOT auto-mirror. GoalsHub's
  // saveGoalsV2 dual-writes the same way, so the Calendar and the Plan tab now
  // share ONE consistent race list.
  try { localStorage.setItem('arnold:races', JSON.stringify(races || [])); } catch {}
  return races;
}

// Authoritative race deletion. Removing a race from the canonical store alone is
// NOT enough — GoalsHub.loadGoalsV2 resurrects it from two drift sources on the
// next Plan-tab open: (a) races still nested in the goals blob, and (b) planner
// days marked type:'race' (the race also lives on the Calendar as a planner day —
// the red flag on the week strip). This clears ALL THREE so a deleted race stays
// deleted everywhere (hero, season phase, strip, Plan list).
//   id       — the race id to remove
//   dateHint — the race's date (pass it: once the store is cleared we can't look
//              it up to find the planner day to remove)
export async function deleteRaceEverywhere(id, dateHint = null) {
  const races = storage.get('races') || [];
  const target = races.find(r => r.id === id) || null;
  const date = target?.date || dateHint || null;

  // 1. canonical races store (+ localStorage mirror)
  const next = races.filter(r => r.id !== id);
  await saveRaces(next);

  // 2. legacy races nested in the goals blob (historical drift → mergeRaces resurrects)
  try {
    const goals = storage.get('goals') || {};
    if (Array.isArray(goals.races) && goals.races.length) {
      const trimmed = goals.races.filter(r => r.id !== id && !(date && r.date === date));
      if (trimmed.length !== goals.races.length) storage.set('goals', { ...goals, races: trimmed });
    }
  } catch { /* ignore */ }

  // 3. planner day(s) marked type:'race' on that date (plannerRaceDays resurrects)
  try {
    if (date) {
      const { planner, changed } = clearPlannerRaceDay(storage.get('planner') || {}, date);
      if (changed) storage.set('planner', planner, { skipValidation: true });
    }
  } catch { /* ignore */ }

  return next;
}

// Pure: remove any type:'race' session from planner days that fall on `date`.
// Returns { planner, changed }. Exported for testing (the date math is the
// fiddly bit — Monday-anchored week + day offset → ISO date).
export function clearPlannerRaceDay(planner, date) {
  if (!planner || !date) return { planner, changed: false };
  let changed = false;
  const out = {};
  for (const [k, wk] of Object.entries(planner)) {
    if (!wk || !wk.weekStart || !Array.isArray(wk.days)) { out[k] = wk; continue; }
    const days = wk.days.map((day, i) => {
      const d = new Date(wk.weekStart + 'T12:00:00'); d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      if (iso !== date || !day) return day;
      const kept = daySessions(day).filter(s => s.type !== 'race');
      if (kept.length !== daySessions(day).length) { changed = true; return makeDay(kept); }
      return day;
    });
    out[k] = { ...wk, days };
  }
  return { planner: out, changed };
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
