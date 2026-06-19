// Session-signature figures — THE single source of truth (Phase 0.3).
//
// Was duplicated across three files, each with its own SIG_VERSION to bump by hand:
//   • PlannedWorkoutTile.SIGNATURE_SRC
//   • WeeklyPlanner.PLAN_SIGNATURE
//   • CalendarTab.SIG_FILE / sigSrc()
// They drifted (e.g. a stale run.png path) and forced 3 edits per change. Now: one map,
// one version, one resolver. Keyed by BOTH plan type (easy_run, tempo, intervals…) and
// family (run, strength…) so callers can try the plan-specific image then fall back to
// the family — exactly what SessionSignature does.

export const SIG_VERSION = 'v12';

const FILE = {
  // run family + sub-types (intervals/speed share the "speed" runner)
  easy_run:  'easy-run.png',
  long_run:  'easy-run.png',
  run:       'easy-run.png',
  tempo:     'tempo.png',
  intervals: 'speed.png',
  speed_run: 'speed.png',
  // other disciplines
  strength:  'strength.png',
  hiit:      'hiit.png',
  mobility:  'mobility.png',
  cross:     'cross.png',
  cycle:     'cycle.png',
  swim:      'swim.png',
  ski:       'ski.png',
  walk:      'walk.png',
  race:      'race.png',
};

// Full cache-busted URL for a plan type or family, or null if unmapped.
export function sigSrc(key) {
  const f = key && FILE[key];
  return f ? `/session-signatures/${f}?${SIG_VERSION}` : null;
}

// Bare filename (for callers that build their own URL), or null.
export function sigFile(key) {
  return (key && FILE[key]) || null;
}
