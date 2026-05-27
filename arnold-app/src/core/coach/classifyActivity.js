// Phase 4r.test.1 — classifier extracted to a leaf module so the Node test
// runner can import it without pulling in storage / Dexie / IndexedDB
// transitive deps. Pure function, no side effects, no globals.
//
// Buckets are deliberately HYROX-flavoured for now (running, erg, strength,
// metcon, other) but the logic generalises — Coach v3 will swap this for
// a format-driven template (see RACES.md / COACH.md Phase v3).

export function classifyActivityForHyrox(activity) {
  if (!activity) return 'other';
  const fields = [
    activity.name,
    activity.title,
    activity.activityName,
    activity.activityType,
    activity.type,
    activity.notes,
    activity.workoutType,
  ].map(v => String(v || '').toLowerCase()).filter(Boolean);
  const combined = fields.join(' ');
  if (/run|jog/.test(combined))                                                  return 'running';
  if (/row|skierg|ski.?erg|erg\b|concept2|c2\b/.test(combined))                  return 'erg';
  if (/strength|weight|lift|deadlift|squat|press|barbell|dumbbell/.test(combined)) return 'strength';
  if (/hiit|interval|crossfit|functional|metcon|hyrox|bootcamp|burpee|wall.?ball|sled|farmer|sandbag|lunge/.test(combined)) return 'metcon';
  return 'other';
}
