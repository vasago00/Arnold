// ─── ARNOLD Memory System ─────────────────────────────────────────────────────
// Single service for all arnold-memory persistence. Uses window.storage (Tauri/
// Claude Desktop bridge) with localStorage as fallback.

const KEYS = {
  workouts:       'arnold-memory:workouts',
  races:          'arnold:races',
  garmin:         'arnold-memory:garmin',
  cronometer:     'arnold-memory:cronometer',
  garminActivities: 'arnold-memory:garmin-activities',
  garminHRV:      'arnold-memory:garmin-hrv',
  garminSleep:    'arnold-memory:garmin-sleep',
  garminWeight:   'arnold-memory:garmin-weight',
  importHistory:  'arnold-memory:import-history',
  index:          'arnold-memory:index',
};

async function storageGet(key) {
  try {
    if (window.storage?.get) {
      const r = await window.storage.get(key);
      return r?.value ? JSON.parse(r.value) : null;
    }
  } catch {}
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {}
  return null;
}

async function storageSet(key, data) {
  const json = JSON.stringify(data);
  try {
    if (window.storage?.set) { await window.storage.set(key, json); return; }
  } catch {}
  try { localStorage.setItem(key, json); } catch {}
}

async function updateIndex(type, entries) {
  const idx = (await storageGet(KEYS.index)) || {};
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  idx[type] = {
    count: entries.length,
    lastUpdated: new Date().toISOString(),
    dateRange: entries.length
      ? { oldest: sorted[0]?.date || null, newest: sorted[sorted.length - 1]?.date || null }
      : null,
  };
  await storageSet(KEYS.index, idx);
}

// ── Workouts ──────────────────────────────────────────────────────────────────
export async function getWorkouts() {
  return (await storageGet(KEYS.workouts)) || [];
}

export async function saveWorkout(entry) {
  const all = await getWorkouts();
  const idx = all.findIndex(w => w.id === entry.id);
  if (idx >= 0) all[idx] = entry; else all.unshift(entry);
  all.sort((a, b) => b.date.localeCompare(a.date));
  await storageSet(KEYS.workouts, all);
  await updateIndex('workouts', all);
  return all;
}

export async function findRelevantWorkouts(type, limit = 3) {
  const all = await getWorkouts();
  return all.filter(w => w.type === type).slice(0, limit);
}

// ── Races ─────────────────────────────────────────────────────────────────────
export async function getRaces() {
  return (await storageGet(KEYS.races)) || [];
}

export async function saveRaces(races) {
  await storageSet(KEYS.races, races);
  await updateIndex('races', races);
  return races;
}

// ── Garmin ────────────────────────────────────────────────────────────────────
export async function getGarmin() {
  return (await storageGet(KEYS.garmin)) || [];
}

export async function saveGarmin(entries) {
  await storageSet(KEYS.garmin, entries);
  await updateIndex('garmin', entries);
  return entries;
}

// ── Cronometer ────────────────────────────────────────────────────────────────
export async function getCronometer() {
  return (await storageGet(KEYS.cronometer)) || [];
}

export async function saveCronometer(entries) {
  await storageSet(KEYS.cronometer, entries);
  await updateIndex('cronometer', entries);
  return entries;
}

// ── Garmin Activities ────────────────────────────────────────────────────────
export async function getGarminActivities() {
  return (await storageGet(KEYS.garminActivities)) || [];
}
export async function saveGarminActivities(entries) {
  await storageSet(KEYS.garminActivities, entries);
  await updateIndex('garminActivities', entries);
  return entries;
}

// ── Garmin HRV ───────────────────────────────────────────────────────────────
export async function getGarminHRV() {
  return (await storageGet(KEYS.garminHRV)) || [];
}
export async function saveGarminHRV(entries) {
  await storageSet(KEYS.garminHRV, entries);
  await updateIndex('garminHRV', entries);
  return entries;
}

// ── Garmin Sleep ─────────────────────────────────────────────────────────────
export async function getGarminSleep() {
  return (await storageGet(KEYS.garminSleep)) || [];
}
export async function saveGarminSleep(entries) {
  await storageSet(KEYS.garminSleep, entries);
  await updateIndex('garminSleep', entries);
  return entries;
}

// ── Garmin Weight ────────────────────────────────────────────────────────────
export async function getGarminWeight() {
  return (await storageGet(KEYS.garminWeight)) || [];
}
export async function saveGarminWeight(entries) {
  await storageSet(KEYS.garminWeight, entries);
  await updateIndex('garminWeight', entries);
  return entries;
}

// ── Import History ───────────────────────────────────────────────────────────
export async function getImportHistory() {
  return (await storageGet(KEYS.importHistory)) || [];
}
export async function saveImportHistory(entries) {
  await storageSet(KEYS.importHistory, entries.slice(0, 20));
  return entries;
}

// ── Memory index ──────────────────────────────────────────────────────────────
export async function getMemoryIndex() {
  return (await storageGet(KEYS.index)) || {};
}

// ── AI context builder ────────────────────────────────────────────────────────
// Builds the memory recall block prepended to AI prompts
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
