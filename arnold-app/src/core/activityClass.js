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

/**
 * STRENGTH-VOLUME predicate — true for resistance training AND hybrid events
 * (HYROX, CrossFit, circuits) that are resistance-heavy. Use this for VOLUME /
 * TRACKING surfaces (weekly strength minutes/sessions, YTD strength counts,
 * the strength hero quality cluster) so HYROX counts toward strength load.
 *
 * Deliberately SEPARATE from isStrength(): isStrength stays pure for
 * CLASSIFICATION (calendar icon/family, activityKind) where hybrid routes to
 * 'hiit' first by design. This is the single source of truth that ended the
 * per-surface HYROX-excluded-from-strength whack-a-mole (Phase 4r.hybrid.root).
 */
export function isStrengthVolume(a) {
  if (!a) return false;
  if (isMobility(a)) return false;
  return isStrength(a) || isHybridWorkout(a);
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
// Phase 4r.calendar.fix.4 — explicit HIIT signal in the activity TYPE or NAME
// wins over "run with distance". The old rule sent every distance-bearing
// activity to 'run' even when the user/Garmin explicitly labelled it HIIT,
// so "HIIT 30 min" with a couple of run intervals would show up as a Run in
// the Calendar tile, the Daily digest, and the Coach. Now any clear HIIT
// signal — bare `hiit` token in type/name, or a Garmin `cardio_training` /
// `high_intensity_interval_training` activityType — promotes the kind to
// 'hiit'. Fartlek/intervals/sprints/tempo without "HIIT" stay as runs (they
// are run training; mileage and pace still matter for them).
// Phase 4r.calendar.fix.5 — STRUCTURED Garmin typeKey source-of-truth.
// Garmin's menu choice (Run / HIIT / Strength / Cycling …) is recorded on
// the activity's `garminTypeKey` field by the parser. This is the most
// reliable signal — it survives the historical activityType-rewrite bug
// that mutated Fartlek runs into HIIT. The local `activityType` field is
// a secondary check; name regex is the last resort.
const RUN_TYPEKEY_RE  = /^(running|treadmill_running|trail_running|indoor_running|road_running|track_running|virtual_run|street_running)$/i;
const HIIT_TYPEKEY_RE = /^(hiit|high_intensity_interval_training|cardio_training)$/i;
const RUN_TYPE_RE     = /^Run\b|^Running\b/i;
const HIIT_TYPE_RE    = /^HIIT$|^high_intensity_interval_training$|^cardio_training$/i;

/**
 * True when Garmin's structured signal identifies this as a Run (Run menu
 * — outdoor / treadmill / trail / track / virtual / street). Checks the
 * preserved garminTypeKey first (most reliable, survives the legacy
 * activityType-rewrite bug), then activityType. When true, the activity is
 * definitively a Run regardless of what the name contains ("Fartlek" /
 * "interval" / "tempo" all stay as Run).
 */
export function isExplicitRun(a) {
  if (!a) return false;
  // 1. Garmin typeKey is the menu-choice truth (preserved by the parser).
  if (RUN_TYPEKEY_RE.test(String(a?.garminTypeKey || ''))) return true;
  // 2. activityType direct match.
  if (RUN_TYPE_RE.test(String(a?.activityType || ''))) return true;
  // Phase 4r.calendar.fix.6 — legacy heuristic retired. It conflated genuine
  // HIIT-menu sessions that happened to include running with parser-corrupted
  // Fartlek runs. The only reliable distinguisher is Garmin's original
  // typeKey, which isn't on activities synced before the parser fix. Path
  // forward: re-sync the affected dates (handleGarminBackfillRange below)
  // so the new parser repopulates garminTypeKey from Garmin's API.
  return false;
}

/**
 * True when the activity is EXPLICITLY tagged HIIT via Garmin's menu.
 * Checks garminTypeKey first (definitive), then activityType, then a
 * conservative bare-"HIIT" name match — but ONLY when nothing else points
 * to Run. The legacy a.isHIIT flag is NOT trusted alone: it was being set
 * by parser auto-promotion based on name tokens, which Phase 4r.calendar.
 * fix.5 retired.
 */
export function isExplicitHIIT(a) {
  if (!a) return false;
  if (isExplicitRun(a)) return false; // Garmin Run menu always wins
  if (HIIT_TYPEKEY_RE.test(String(a?.garminTypeKey || ''))) return true;
  if (HIIT_TYPE_RE.test(String(a?.activityType || ''))) return true;
  // Name-based fallback only when neither structured signal pointed to Run.
  return /\bhiit\b/i.test(_both(a));
}

export function activityKind(a) {
  if (isMobility(a)) return 'mobility';
  // Phase 4r.calendar.fix.3 — hybrid multi-modal workouts (HYROX, CrossFit,
  // AMRAP/EMOM, circuits) classify as 'hiit' even if they include running
  // distance. The running is one COMPONENT, not the whole workout.
  if (isHybridWorkout(a)) return 'hiit';
  // Phase 4r.calendar.fix.4 — explicit HIIT label beats the distance rule.
  if (isExplicitHIIT(a)) return 'hiit';
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
