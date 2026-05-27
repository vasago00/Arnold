// ─── ARNOLD Activity Classification — single source of truth ────────────────
// Every screen that filters or buckets activities should import these
// helpers instead of running its own regex against `activityType`. The
// rules below converge into the same answer regardless of where the
// activity originated (FIT parser, Garmin Worker, CSV import, HC sync).
//
// CLASSIFICATION CONTRACT (post-Phase 4j):
//   • isRun       → outdoor/treadmill running, HIIT runs, Fartlek, intervals
//                   (anything with running distance + cardio nature)
//   • isStrength  → resistance training, hyrox, crossfit, circuits
//                   (NOT HIIT — HIIT is intensity-based cardio, not resistance)
//   • isMobility  → yoga, pilates, stretching, breathwork, meditation
//   • isHIIT      → high-intensity intervals, fartlek, sprints, cardio_training
//                   subset of "run-like" — also passes isRun() for distance.
//   • isCycling   → road, gravel, indoor cycling
//   • isSwim      → pool/open water swimming
//
// Mutual exclusion: a single activity is exactly ONE kind via activityKind().
// Inclusion: HIIT activities pass BOTH isRun() and isHIIT() — they
// contribute to run mileage tracking AND fire HIIT-specific rules.

const RUN_RE      = /\b(run|jog|hiit|interval|tempo|trail|fartlek|sprint|track|jogging|running|hyrox)\b/i;
// HYROX is mixed cardio + functional stations — counts as HIIT, not pure
// strength. Anyone using Arnold's Workbench HYROX preset exports sport=hiit;
// the name-based regex catches imported activities + manually-named ones.
const HIIT_RE     = /\b(hiit|interval|fartlek|cardio[_ ]training|hyrox)\b/i;
// Phase 4r.calendar.fix.3 — hybrid / multi-modal workout markers. Used to
// distinguish HYROX-style sessions (running + stations) from pure-running
// intervals (Fartlek, track repeats). Both pass isHIIT() AND isRun() but
// they're shaped differently and the user's mental model treats them as
// distinct visuals:
//   • Fartlek / intervals: structured running → 'intervals' family → speed.png
//   • HYROX / CrossFit / AMRAP / circuit: hybrid → 'hiit' family → hiit.png
// Matches both Garmin activityType strings and free-form workout names.
const HYBRID_RE   = /\b(hyrox|crossfit|cross[_ ]fit|metcon|amrap|emom|wod|circuit|f45|orangetheory|otf|bootcamp|hybrid|stations?|functional[_ ]training|cardio[_ ]training|hiit[_ ]training|cross[_ ]training)\b/i;
const STRENGTH_RE = /\b(strength|weight|lifting|gym|crossfit|circuit|resistance)\b/i;
const MOBILITY_RE = /\b(mobility|stretch|stretching|yoga|pilates|flexibility|breathwork|meditation)\b/i;
const CYCLING_RE  = /\b(cycle|cycling|bike|biking|spin)\b/i;
const SWIM_RE     = /\b(swim|swimming|pool|open[_ ]water)\b/i;

function _typ(a) { return String(a?.activityType || ''); }
function _name(a) { return String(a?.activityName || ''); }
function _both(a) { return `${_typ(a)} ${_name(a)}`; }

/** True if the activity is mobility/yoga/stretching. Highest priority — checked first. */
export function isMobility(a) {
  if (!a) return false;
  if (a.isMobility === true) return true;
  return MOBILITY_RE.test(_both(a));
}

/** True if the activity is HIIT / Fartlek / interval cardio. */
export function isHIIT(a) {
  if (!a) return false;
  if (isMobility(a)) return false;
  if (a.isHIIT === true || _typ(a) === 'HIIT') return true;
  // Name-based: "Fartlek 100", "HIIT run", "interval session" — any of these
  // count as HIIT even if the parser stamped activityType as Run.
  return HIIT_RE.test(_both(a));
}

/**
 * True if the activity is a HYBRID / MULTI-MODAL workout — HYROX, CrossFit,
 * AMRAP/EMOM, circuits, F45, Orangetheory, etc. These differ from pure
 * interval running (Fartlek, track repeats) in that they combine running
 * with non-running components (sled push, wall balls, dumbbells, rowing,
 * stations). The user's mental model: HIIT = "running + something else",
 * Intervals = "running structured as bursts." Phase 4r.calendar.fix.3.
 */
export function isHybridWorkout(a) {
  if (!a) return false;
  if (isMobility(a)) return false;
  return HYBRID_RE.test(_both(a));
}

/**
 * True if the activity is run-like — outdoor/treadmill running, HIIT, Fartlek.
 * HIIT runs deliberately pass this AND isHIIT() so they count toward both
 * running distance and HIIT-specific coaching rules.
 */
export function isRun(a) {
  if (!a) return false;
  if (isMobility(a)) return false;
  if (a.isRun === true) return true;
  if (isHIIT(a) && (a.distanceMi || 0) > 0) return true;
  return RUN_RE.test(_both(a));
}

/**
 * True if the activity is resistance training. Excludes HIIT and Run —
 * those are cardio. A "Strength" tag with running distance is treated as
 * mis-classified and falls to isRun() instead.
 */
export function isStrength(a) {
  if (!a) return false;
  if (isMobility(a)) return false;
  if (isRun(a))      return false; // run/HIIT take precedence
  if (a.isStrength === true) return true;
  return STRENGTH_RE.test(_both(a));
}

export function isCycling(a) {
  if (!a) return false;
  if (isRun(a) || isMobility(a) || isStrength(a)) return false;
  return CYCLING_RE.test(_both(a));
}

export function isSwim(a) {
  if (!a) return false;
  return SWIM_RE.test(_both(a));
}

/**
 * Single-kind classification — returns one of:
 *   'mobility' | 'hiit' | 'run' | 'strength' | 'cycling' | 'swim' | 'other'
 *
 * Used for grouping (e.g. "0 runs · 2 strength · 1 other"), icons, labels,
 * and Calendar tile visuals (via iconTypeFor / activityLabel).
 *
 * Phase 4r.calendar.fix.1 — when an activity has actual running distance,
 * 'run' takes precedence over 'hiit' even if both isRun() and isHIIT()
 * are true. A 3.7-mile Fartlek is a RUN with intervals; calling it HIIT
 * elides the dominant fact (distance + sustained cardio nature). The
 * 'hiit' kind is now reserved for zero-distance HIIT — bodyweight
 * intervals, HYROX stations, HIIT classes — where there isn't a more
 * specific identity to fall back on.
 *
 * isHardSession() still uses isHIIT() directly, so quality-session
 * detection for cards/coaching rules continues to work for distance-
 * bearing HIIT runs.
 *
 * User feedback 2026-05-26: Fartlek 100 was rendering as the orange HIIT
 * figure on web + mobile Calendar but as the blue run figure on mobile
 * Start. Same activity, two visual identities. Run-first ordering
 * resolves the inconsistency in favor of Start's framing.
 */
export function activityKind(a) {
  if (isMobility(a)) return 'mobility';
  // Phase 4r.calendar.fix.3 — hybrid multi-modal workouts (HYROX, CrossFit,
  // AMRAP/EMOM, circuits) classify as 'hiit' even if they include running
  // distance. The running is one COMPONENT, not the whole workout.
  if (isHybridWorkout(a)) return 'hiit';
  // Pure-running with distance (incl. Fartlek/intervals/sprints) → 'run'.
  // Mileage counts toward run totals; visual identity is run-flavored.
  if (isRun(a) && (Number(a?.distanceMi) || 0) > 0) return 'run';
  if (isHIIT(a))     return 'hiit';
  // No-distance runs (rare — treadmill incidents with no distance recorded)
  // still classify as run rather than HIIT.
  if (isRun(a))      return 'run';
  if (isStrength(a)) return 'strength';
  if (isCycling(a))  return 'cycling';
  if (isSwim(a))     return 'swim';
  return 'other';
}

/**
 * For UI labels: "Run", "HIIT", "Strength", "Mobility", "Cycling", "Swim",
 * "Activity". Always returns a non-empty string.
 */
export function activityLabel(a) {
  switch (activityKind(a)) {
    case 'mobility': return 'Mobility';
    case 'hiit':     return 'HIIT';
    case 'run':      return 'Run';
    case 'strength': return 'Strength';
    case 'cycling':  return 'Cycling';
    case 'swim':     return 'Swim';
    default:         return a?.activityType || 'Activity';
  }
}

/**
 * Is this a "hard" / high-quality session whose metrics deserve a
 * standalone card on Daily/Play? HIIT, Fartlek, intervals, tempo, sprints,
 * track work — these have individually meaningful pace splits, HR profiles,
 * power, training effect, etc. Aggregating them with other runs would
 * average away the signal.
 *
 * Easy / Z2 / recovery / long-slow runs do NOT count as hard — those
 * naturally bucket together for "today's easy mileage".
 */
export function isHardSession(a) {
  if (!a) return false;
  if (isHIIT(a)) return true;
  // Name-based: "Tempo run", "Speed work", "Sprint intervals", "Track session"
  if (/\b(tempo|sprint|speed|track|threshold)\b/i.test(_both(a))) return true;
  return false;
}

/**
 * iconType used by Today's Plan / TodaysPlan to match planned slots to
 * done activities. Same key the planner uses, so a HIIT run logged from
 * Garmin will match a planned HIIT slot.
 */
export function iconTypeFor(a) {
  switch (activityKind(a)) {
    case 'mobility': return 'stretch';
    case 'hiit':     return 'bolt';
    case 'run':      return 'run';
    case 'strength': return 'strength';
    case 'cycling':  return 'bike';
    case 'swim':     return 'swim';
    default:         return 'run';
  }
}
