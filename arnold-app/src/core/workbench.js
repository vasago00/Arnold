// ─── Workbench — custom workouts + FIT export ────────────────────────────────
// Phase 4r.workbench.1
//
// Data model for user-defined workouts:
//   - A workout has segments (warmup / main / cooldown).
//   - Each segment has steps.
//   - Each step has a kind (run / exercise / rest), a target type
//     (time / distance / reps / open), and a value.
//
// FIT export uses @garmin/fitsdk Encoder to produce a binary .FIT file
// compatible with Garmin Connect's "Import workout" feature. Once imported,
// the workout syncs to the watch on the next Connect sync.
//
// HYROX is included as a built-in preset users can copy and edit.

import { storage } from './storage.js';
import { Encoder, Profile } from '@garmin/fitsdk';

// ── Constants ────────────────────────────────────────────────────────────────

export const SPORT_OPTIONS = [
  { id: 'running', label: 'Running' },
  { id: 'hiit',    label: 'HIIT / HYROX (mixed)' },  // best for mixed run+strength
  { id: 'strength', label: 'Strength' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'walking', label: 'Walking' },
  { id: 'generic', label: 'Generic / Multi' },
];

export const TARGET_TYPES = [
  { id: 'time',     label: 'Time',     hint: 'seconds' },
  { id: 'distance', label: 'Distance', hint: 'meters' },
  { id: 'reps',     label: 'Reps / Steps', hint: 'count' },
  { id: 'open',     label: 'Open (lap-press)', hint: 'manual advance' },
];

export const INTENSITY_OPTIONS = [
  { id: 'warmup',   label: 'Warmup' },
  { id: 'active',   label: 'Active' },
  { id: 'rest',     label: 'Rest' },
  { id: 'cooldown', label: 'Cooldown' },
];

export const SEGMENT_TYPES = [
  { id: 'warmup',   label: 'Warmup' },
  { id: 'main',     label: 'Main' },
  { id: 'cooldown', label: 'Cooldown' },
];

// ── Storage helpers ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'arnold:workbench:workouts';

export function getWorkouts() {
  try {
    const raw = storage.get(STORAGE_KEY);
    if (Array.isArray(raw) && raw.length) return raw;
  } catch {}
  // First-run: return the HYROX preset so the user has something to edit.
  return [HYROX_PRACTICE_PRESET];
}

export function saveWorkouts(workouts) {
  storage.set(STORAGE_KEY, workouts, { skipValidation: true });
}

export function saveWorkout(workout) {
  const all = getWorkouts();
  const idx = all.findIndex(w => w.id === workout.id);
  if (idx >= 0) all[idx] = workout;
  else all.push(workout);
  saveWorkouts(all);
  return workout;
}

export function deleteWorkout(id) {
  const all = getWorkouts().filter(w => w.id !== id);
  saveWorkouts(all);
}

export function newId() {
  return `wo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── HYROX preset ─────────────────────────────────────────────────────────────
// Built from the user's screenshots. Sled push/pull use REPS target so the
// watch advances based on step count via the accelerometer (~33 steps for
// 50m at ~1.5m stride). Stations like ski erg use OPEN (press lap) because
// the watch can't track distance reliably on indoor cardio machines.

export const HYROX_PRACTICE_PRESET = {
  id: 'hyrox-practice-preset',
  name: 'HYROX Practice',
  sport: 'hiit',  // HIIT sport — FR955 renders mixed run+strength steps with per-step icons
  notes: 'Mixed running + strength stations. Hit lap when station is complete on open-target steps.',
  segments: [
    {
      type: 'warmup',
      name: 'Standard Dynamic Warm-up',
      steps: [
        { kind: 'run',      target: 'time',     value: 300, intensity: 'warmup',   note: 'Easy bike or jog' },
        { kind: 'exercise', target: 'reps',     value: 10,  intensity: 'warmup',   exerciseName: 'Leg swings',          note: 'each side' },
        { kind: 'exercise', target: 'reps',     value: 10,  intensity: 'warmup',   exerciseName: 'Walking lunges' },
        { kind: 'exercise', target: 'reps',     value: 5,   intensity: 'warmup',   exerciseName: "World's Greatest Stretch" },
        { kind: 'exercise', target: 'reps',     value: 20,  intensity: 'warmup',   exerciseName: 'Band pull-aparts' },
        { kind: 'run',      target: 'distance', value: 100, intensity: 'active',   note: '2× progressive runs', repeats: 2 },
      ],
    },
    {
      type: 'main',
      name: 'HYROX Sim',
      // Each 1km run is split into Out 500m + Back 500m so the watch
      // beeps at the turnaround when running an out-and-back route.
      // Stations use distance / reps / open depending on what makes
      // sense for the watch to measure.
      steps: [
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run out 500m' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run back 500m' },
        { kind: 'exercise', target: 'open',     value: null, intensity: 'active', exerciseName: 'Row 1000m',     note: 'Press lap when rower hits 1000m' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run out 500m' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run back 500m' },
        { kind: 'exercise', target: 'distance', value: 200,  intensity: 'active', exerciseName: 'Farmer Carry',  note: '200m total' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run out 500m' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run back 500m' },
        { kind: 'exercise', target: 'distance', value: 100,  intensity: 'active', exerciseName: 'Sandbag Lunges', note: '100m, ~100 lunges' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run out 500m' },
        { kind: 'run',      target: 'distance', value: 500,  intensity: 'active', exerciseName: 'Run back 500m' },
        { kind: 'exercise', target: 'reps',     value: 80,   intensity: 'active', exerciseName: 'Wall Balls' },
      ],
    },
    {
      type: 'cooldown',
      name: 'Cool Down',
      steps: [
        { kind: 'exercise', target: 'time', value: 600, intensity: 'cooldown', exerciseName: 'Easy bike', note: '10 min easy cooldown bike' },
      ],
    },
  ],
};

// Empty-workout template for the "+ New" button.
export function emptyWorkout(name = 'Untitled workout') {
  return {
    id: newId(),
    name,
    sport: 'running',
    notes: '',
    segments: [
      { type: 'warmup',   name: 'Warmup',   steps: [] },
      { type: 'main',     name: 'Main',     steps: [] },
      { type: 'cooldown', name: 'Cooldown', steps: [] },
    ],
  };
}

export function emptyStep(kind = 'run') {
  return {
    kind,
    target: kind === 'exercise' ? 'reps' : 'distance',
    value: kind === 'exercise' ? 10 : 1000,
    intensity: 'active',
    note: '',
    exerciseName: kind === 'exercise' ? 'Exercise' : undefined,
    weightLb: null,
    paceLowSecPerMi: null,
    paceHighSecPerMi: null,
    hrLowBpm: null,
    hrHighBpm: null,
  };
}

// Build a new workout object from a template (runTemplates.js). Wraps the
// template output with a fresh id + name + storable shape.
export function workoutFromTemplate(template, params) {
  const built = template.build(params);
  return {
    id: newId(),
    name: built.name || template.name,
    sport: built.sport || 'running',
    notes: template.description || '',
    segments: built.segments || [],
  };
}

// Flatten segments → linear step array for FIT export. Repeats are expanded
// inline rather than encoded as REPEAT_UNTIL_STEPS_CMPLT (the FIT spec
// supports loop blocks but Garmin Connect's import UI doesn't always render
// them cleanly; explicit expansion is bulletproof).
export function flattenSteps(workout) {
  const out = [];
  for (const seg of workout.segments || []) {
    for (const step of seg.steps || []) {
      const reps = step.repeats && step.repeats > 1 ? step.repeats : 1;
      for (let i = 0; i < reps; i++) {
        out.push({ ...step, _segmentType: seg.type, _repeatIdx: i, _repeatTotal: reps });
      }
    }
  }
  return out;
}

// ── FIT export ───────────────────────────────────────────────────────────────
// We use the @garmin/fitsdk Encoder. The minimal message set for a workout
// file is: file_id, workout, workout_step (one per step). Garmin Connect
// imports this and syncs to the watch on next connection.
//
// FIT enums (per the Garmin FIT Profile — values verified against
// @garmin/fitsdk profile.js wktStepDuration map). Using numeric values
// directly because the SDK's encoder does NOT auto-translate subField
// names like `durationDistance` → it always writes to the base field
// `durationValue` with scale=1, regardless of `durationType`. We must
// pre-scale the value ourselves (× 100 for distance, × 1000 for time).
//
//   wktStepDuration:  time=0, distance=1, hrLessThan=2, hrGreaterThan=3,
//                     calories=4, open=5, …, repetitionTime=28, reps=29
//   wktStepTarget:    speed=0, heartRate=1, open=2, cadence=3, power=4, …
//   wktStepIntensity: active=0, rest=1, warmup=2, cooldown=3, recovery=4
//
// NOTE: `reps` is 29, not 17. 17 is `repeatUntilPowerLastLapLessThan` —
// a flow-control directive that produced nonsense on the watch (the
// "26K miles" / illegible-steps bug from the HYROX preset).

const FIT_FILE_WORKOUT = 5;
// sport=62 (hiit) is the right pick for mixed run/strength workouts on
// modern Garmin watches — the FR955 Solar renders HIIT-workout steps with
// per-step exercise icons + names rather than the running-workout template
// that labels every step "Run". Pure-running workouts stay sport=1.
const FIT_SPORT = { running:1, cycling:2, training:10, walking:11, generic:0, hiit:62, cardio:26, strength:10 };
const FIT_DURATION = { time:0, distance:1, open:5, reps:29 };
const FIT_INTENSITY = { active:0, rest:1, warmup:2, cooldown:3 };
// wkt_step_target enum: speed=0, heartRate=1, open=2, cadence=3, power=4.
const FIT_TARGET_OPEN  = 2;
const FIT_TARGET_SPEED = 0;
const FIT_TARGET_HR    = 1;

// Unit conversions for FIT exporter.
const LB_TO_KG    = 0.453592;
const MI_TO_M_FIT = 1609.34;

// Pre-scale a weight in pounds to FIT's exerciseWeight units (kg × 100).
function encodeWeightLb(lb) {
  if (lb == null || lb <= 0) return null;
  return Math.round(lb * LB_TO_KG * 100);   // lb → kg, then × 100 (FIT scale)
}

// sec/mi → m/s (× 1000 to pre-scale for FIT base field, which has scale=1
// while the subField customTargetSpeedLow has scale=1000 → mm/s).
function encodeSpeedMmPerSec(secPerMi) {
  if (secPerMi == null || secPerMi <= 0) return null;
  const mps = MI_TO_M_FIT / secPerMi;
  return Math.round(mps * 1000);
}

// FIT workoutHr encoding: if value > 100, treated as bpm; otherwise as
// %HRMax. We always express our targets as absolute bpm.
function encodeHrBpm(bpm) {
  if (bpm == null || bpm <= 0) return null;
  return Math.round(bpm > 100 ? bpm : 100 + bpm);   // ensure >100 = bpm semantics
}

// exerciseCategory enum from the FIT Profile (subset relevant to HYROX +
// common gym moves). The watch uses this to pick the icon shown next to
// the step on its display. exerciseName (a per-category uint16 sub-enum)
// is intentionally omitted — wktStepName carries the text we want shown.
const FIT_EX_CAT = {
  cardio: 2, carry: 3, chop: 4, core: 5, crunch: 6, curl: 7,
  deadlift: 8, hipRaise: 10, lunge: 17, plank: 19, plyo: 20,
  pullUp: 21, pushUp: 22, row: 23, shoulderPress: 24, shrug: 26,
  sitUp: 27, squat: 28, totalBody: 29, warmUp: 31,
  run: 32, bike: 33, cardioSensors: 34, move: 35,
  bandedExercises: 37, battleRope: 38, indoorRow: 42, sandbag: 44,
  sled: 45, sledgeHammer: 46, suspension: 49, tire: 50,
};

// Map our user-facing exercise names → FIT exerciseCategory. Falls back
// to `totalBody` if no match. The match is loose (substring, lower-case)
// because users type free-form text.
function inferExerciseCategory(step) {
  const name = (step.exerciseName || step.note || '').toLowerCase();
  if (!name) return null;
  if (name.includes('sled'))            return FIT_EX_CAT.sled;
  if (name.includes('ski erg') || name.includes('ski-erg') || name.includes('ski_erg')) return FIT_EX_CAT.cardio;
  if (name.includes('row erg') || name.includes('rower') || /\brow\b/.test(name)) return FIT_EX_CAT.indoorRow;
  if (name.includes('wall ball') || name.includes('wallball')) return FIT_EX_CAT.totalBody;
  if (name.includes('bike') || name.includes('cycle'))      return FIT_EX_CAT.bike;
  if (name.includes('burpee'))          return FIT_EX_CAT.plyo;
  if (name.includes('jump') || name.includes('plyo'))       return FIT_EX_CAT.plyo;
  if (name.includes('lunge'))           return FIT_EX_CAT.lunge;
  if (name.includes('squat'))           return FIT_EX_CAT.squat;
  if (name.includes('deadlift'))        return FIT_EX_CAT.deadlift;
  if (name.includes('push'))            return FIT_EX_CAT.pushUp;
  if (name.includes('pull-up') || name.includes('pullup'))  return FIT_EX_CAT.pullUp;
  if (name.includes('row'))             return FIT_EX_CAT.row;
  if (name.includes('press'))           return FIT_EX_CAT.shoulderPress;
  if (name.includes('curl'))            return FIT_EX_CAT.curl;
  if (name.includes('plank'))           return FIT_EX_CAT.plank;
  if (name.includes('sit-up') || name.includes('situp'))    return FIT_EX_CAT.sitUp;
  if (name.includes('crunch'))          return FIT_EX_CAT.crunch;
  if (name.includes('core'))            return FIT_EX_CAT.core;
  if (name.includes('carry') || name.includes('farmer'))    return FIT_EX_CAT.carry;
  if (name.includes('band'))            return FIT_EX_CAT.bandedExercises;
  if (name.includes('sandbag'))         return FIT_EX_CAT.sandbag;
  if (name.includes('battle rope') || name.includes('rope'))return FIT_EX_CAT.battleRope;
  if (name.includes('stretch') || name.includes('mobility') ||
      name.includes('swing') || name.includes('breathing') ||
      name.includes('warm'))            return FIT_EX_CAT.warmUp;
  return FIT_EX_CAT.totalBody;
}

// Manual pre-scaling. The base `durationValue` field has scale=1 in the
// profile; the per-type scale (1000 for time, 100 for distance) lives on
// the subField. Writing the base field with pre-scaled raw values is the
// surest way to round-trip correctly through any FIT decoder.
function encodeDurationValue(target, value) {
  if (value == null) return null;
  if (target === 'time')     return Math.round(value * 1000);   // seconds → ms
  if (target === 'distance') return Math.round(value * 100);    // meters → cm
  if (target === 'reps')     return Math.round(value);          // count
  return null;
}

// FIT exerciseCategory UNKNOWN sentinel — when set on a workout_step, the
// watch is supposed to look up the corresponding exerciseTitle (msg 264)
// by the step's exerciseName int and render that string verbatim.
const FIT_EX_CAT_UNKNOWN = 65534;

// Build a dedup'd table of unique step display names found across
// the workout so we can write one exerciseTitle (msg 264) per unique
// label. Run steps need titles too — without one the watch displays
// "Go" as the default placeholder for an unnamed run step.
//
// Returns: { titles, stepName2Idx } where `idx` is the messageIndex
// we'll write to msg 264 AND set as workout_step.exerciseName (the
// cross-reference key the watch follows).
function buildExerciseTitles(flat) {
  const titles = [];
  const stepName2Idx = new Map();
  let nextIdx = 0;

  // Default fallback labels for run-kind steps with no exerciseName/note.
  // We use the intensity to pick a sensible name so the watch shows
  // something meaningful (not just "run" lower-case).
  const runLabelFor = (step) => {
    if (step.exerciseName) return step.exerciseName;
    if (step.note)         return step.note;
    if (step.intensity === 'warmup')   return 'Warm-up run';
    if (step.intensity === 'cooldown') return 'Cool-down run';
    if (step.intensity === 'rest')     return 'Recovery jog';
    return 'Run';
  };

  for (const step of flat) {
    let label;
    if (step.kind === 'run')                                     label = runLabelFor(step);
    else if (step.kind === 'exercise' || step.kind === 'strength') label = step.exerciseName || step.note || 'Exercise';
    else                                                          label = step.note || step.kind;

    label = (label + '').slice(0, 24);
    if (!label) continue;
    if (stepName2Idx.has(label)) continue;

    titles.push({ idx: nextIdx, name: label });
    stepName2Idx.set(label, nextIdx);
    nextIdx++;
  }
  return { titles, stepName2Idx, runLabelFor };
}

export async function exportWorkoutToFit(workout) {
  const flat = flattenSteps(workout);
  if (!flat.length) throw new Error('Workout has no steps to export.');
  if (flat.length > 100) throw new Error(`Workout has ${flat.length} steps — Garmin imports cap around 100.`);

  const encoder = new Encoder();

  // file_id — declare this as a workout file (type=5).
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: FIT_FILE_WORKOUT,
    manufacturer: 255,         // 255 = "development" per FIT spec
    product: 0,
    timeCreated: new Date(),
    serialNumber: 0,
  });

  encoder.onMesg(Profile.MesgNum.FILE_CREATOR, {
    softwareVersion: 100,
    hardwareVersion: 0,
  });

  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    wktName: (workout.name || 'Workout').slice(0, 15),
    sport: FIT_SPORT[workout.sport] ?? FIT_SPORT.running,
    numValidSteps: flat.length,
    capabilities: 32,          // bit 5 = "TCX" — minimum capability flag most decoders expect
  });

  // ── ExerciseTitleMessage (msg 264) ──
  // Without these the watch displays generic placeholder labels ("Go"
  // for runs, the category name for exercises). Every step — run AND
  // exercise — gets a title entry so the watch always has a string to
  // show. Step references the title via exerciseCategory=UNKNOWN +
  // exerciseName=<title.messageIndex>. The intensity badge
  // (warmup/active/cooldown) is independent — set on the step itself
  // and rendered separately by the watch.
  const { titles, stepName2Idx, runLabelFor } = buildExerciseTitles(flat);
  titles.forEach(t => {
    encoder.onMesg(Profile.MesgNum.EXERCISE_TITLE, {
      messageIndex:     t.idx,
      exerciseCategory: FIT_EX_CAT_UNKNOWN,
      exerciseName:     t.idx,
      wktStepName:      t.name,
    });
  });

  flat.forEach((step, i) => {
    const dType = FIT_DURATION[step.target] ?? FIT_DURATION.open;
    const dValue = encodeDurationValue(step.target, step.value);
    const intensity = FIT_INTENSITY[step.intensity] ?? FIT_INTENSITY.active;

    // Pick the label this step's title was registered under (must
    // match exactly so the cross-reference resolves).
    let label;
    if (step.kind === 'run')                                       label = runLabelFor(step);
    else if (step.kind === 'exercise' || step.kind === 'strength') label = step.exerciseName || step.note || 'Exercise';
    else                                                            label = step.note || step.kind;
    label = (label + '').slice(0, 24);

    const titleIdx = stepName2Idx.get(label);
    const hasTitle = titleIdx != null;

    // Determine target type + custom target range from step data.
    // Pace targets win over HR if both set (rare). Falls back to open.
    let targetType = FIT_TARGET_OPEN;
    let customLow = 0;
    let customHigh = 0;
    if (step.paceLowSecPerMi != null && step.paceHighSecPerMi != null) {
      targetType = FIT_TARGET_SPEED;
      // paceLow = slower bound (higher sec/mi) → lower m/s → write as Low
      customLow  = encodeSpeedMmPerSec(step.paceLowSecPerMi)  ?? 0;
      customHigh = encodeSpeedMmPerSec(step.paceHighSecPerMi) ?? 0;
    } else if (step.hrLowBpm != null && step.hrHighBpm != null) {
      targetType = FIT_TARGET_HR;
      customLow  = encodeHrBpm(step.hrLowBpm)  ?? 0;
      customHigh = encodeHrBpm(step.hrHighBpm) ?? 0;
    }

    const msg = {
      messageIndex: i,
      wktStepName: label.slice(0, 15),
      intensity,
      notes: (step.note || '').slice(0, 50),
      durationType: dType,
      targetType,
      targetValue: 0,
      customTargetValueLow:  customLow,
      customTargetValueHigh: customHigh,
    };
    if (dValue != null) msg.durationValue = dValue;
    if (hasTitle) {
      msg.exerciseCategory = FIT_EX_CAT_UNKNOWN;
      msg.exerciseName     = titleIdx;
    }
    // exerciseWeight (FIT field 12) — encoded in kg × 100. Garmin watches
    // display in whatever unit the user has configured (lb/kg).
    const wt = encodeWeightLb(step.weightLb);
    if (wt != null) msg.exerciseWeight = wt;

    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, msg);
  });

  return encoder.close();
}

// Trigger a browser download of the FIT file. Caller has the workout object.
export async function downloadWorkoutFit(workout) {
  const buffer = await exportWorkoutToFit(workout);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(workout.name)}.fit`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(s) {
  return String(s || 'workout')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'workout';
}

// ── Apply-to-planner helpers ──────────────────────────────────────────────────
// A Workbench workout can be referenced from a planner day. We store the
// reference as { workoutId, name } on the planner day entry alongside the
// usual { type, distanceMi, durationMin, notes } fields.

export function planTypeForWorkout(workout) {
  // Map workout sport → planner day type so the planner color/label matches.
  const s = workout?.sport;
  if (s === 'running')  return 'easy_run';  // user can refine in the planner editor
  if (s === 'strength') return 'strength';
  if (s === 'cardio')   return 'hiit';
  if (s === 'cycling')  return 'cross';
  if (s === 'walking')  return 'cross';
  return 'easy_run';
}

// Total estimated duration for a workout (seconds). Time steps are summed
// directly; distance steps at running pace are estimated at ~6:30/mi
// (~4:00/km), reps use a per-rep duration heuristic.
export function estimateDurationSec(workout) {
  let total = 0;
  for (const seg of workout.segments || []) {
    for (const step of seg.steps || []) {
      const reps = step.repeats && step.repeats > 1 ? step.repeats : 1;
      let single = 0;
      if (step.target === 'time')     single = step.value || 0;
      else if (step.target === 'distance') single = (step.value || 0) * 0.24;  // 4:00/km ≈ 0.24 s/m
      else if (step.target === 'reps') single = (step.value || 0) * 3;          // 3s/rep heuristic
      else single = 60;                                                         // open: assume 1 min
      total += single * reps;
    }
  }
  return total;
}
