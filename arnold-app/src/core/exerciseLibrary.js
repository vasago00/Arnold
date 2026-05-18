// ─── Exercise Library ────────────────────────────────────────────────────────
// Phase 4r.workbench.8
//
// Curated library of common strength + functional exercises with sensible
// defaults (rep count, rest, equipment, FIT exerciseCategory mapping).
//
// Used by the Workbench's ExercisePicker and SetGroupBuilder to bootstrap
// new steps without making the user type free-form text. Free-form text is
// still allowed — this just gives the common cases a faster path.
//
// Each entry:
//   id           — stable identifier
//   name         — display label (also goes into wktStepName + ExerciseTitle)
//   category     — FIT exerciseCategory key (matches FIT_EX_CAT in workbench.js)
//   equipment    — barbell / dumbbell / kettlebell / bodyweight / band / cable
//                  / sandbag / sled / wall-ball / box / rope / machine / mixed
//   defaultReps  — reasonable starting count
//   defaultRestSec — rest between sets at this intensity
//   defaultWeightLb — sensible weight for an intermediate trainee (optional)
//   muscle       — primary muscle group(s)
//   tag          — categorization for the picker UI (push/pull/legs/core/cardio/hyrox)

export const EXERCISES = [
  // ── HYROX / functional stations ──
  { id: 'sled-push',           name: 'Sled Push',           category: 'sled',         equipment: 'sled',       defaultReps: 33, defaultRestSec: 60, muscle: 'legs',     tag: 'hyrox' },
  { id: 'sled-pull',           name: 'Sled Pull',           category: 'sled',         equipment: 'sled',       defaultReps: 33, defaultRestSec: 60, muscle: 'back',     tag: 'hyrox' },
  { id: 'ski-erg',             name: 'Ski Erg',             category: 'cardio',       equipment: 'machine',    defaultReps: null, defaultRestSec: 60, muscle: 'fullBody', tag: 'hyrox', defaultTarget: 'open' },
  { id: 'row-erg',             name: 'Row 1000m',           category: 'indoorRow',    equipment: 'machine',    defaultReps: null, defaultRestSec: 60, muscle: 'back',     tag: 'hyrox', defaultTarget: 'open' },
  { id: 'farmer-carry',        name: 'Farmer Carry',        category: 'carry',        equipment: 'dumbbell',   defaultReps: null, defaultRestSec: 60, muscle: 'fullBody', tag: 'hyrox', defaultTarget: 'distance', defaultValue: 200 },
  { id: 'sandbag-lunges',      name: 'Sandbag Lunges',      category: 'lunge',        equipment: 'sandbag',    defaultReps: null, defaultRestSec: 60, muscle: 'legs',     tag: 'hyrox', defaultTarget: 'distance', defaultValue: 100 },
  { id: 'wall-balls',          name: 'Wall Balls',          category: 'totalBody',    equipment: 'wall-ball',  defaultReps: 80, defaultRestSec: 60, muscle: 'fullBody', tag: 'hyrox', defaultWeightLb: 14 },
  { id: 'burpee-broad-jumps',  name: 'Burpee Broad Jumps',  category: 'plyo',         equipment: 'bodyweight', defaultReps: 12, defaultRestSec: 60, muscle: 'fullBody', tag: 'hyrox' },
  { id: 'box-jumps',           name: 'Box Jumps',           category: 'plyo',         equipment: 'box',        defaultReps: 10, defaultRestSec: 60, muscle: 'legs',     tag: 'hyrox', defaultWeightLb: 24 },

  // ── Squat family (legs) ──
  { id: 'back-squat',          name: 'Back Squat',          category: 'squat',        equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 120, muscle: 'quads',  tag: 'legs', defaultWeightLb: 135 },
  { id: 'front-squat',         name: 'Front Squat',         category: 'squat',        equipment: 'barbell',    defaultReps: 6,  defaultRestSec: 120, muscle: 'quads',  tag: 'legs', defaultWeightLb: 115 },
  { id: 'goblet-squat',        name: 'Goblet Squat',        category: 'squat',        equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 90,  muscle: 'quads',  tag: 'legs', defaultWeightLb: 40 },
  { id: 'overhead-squat',      name: 'Overhead Squat',      category: 'squat',        equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 90,  muscle: 'quads',  tag: 'legs', defaultWeightLb: 95 },
  { id: 'split-squat',         name: 'Bulgarian Split Squat', category: 'lunge',      equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 60,  muscle: 'quads',  tag: 'legs', defaultWeightLb: 30 },
  { id: 'walking-lunges',      name: 'Walking Lunges',      category: 'lunge',        equipment: 'bodyweight', defaultReps: 20, defaultRestSec: 60,  muscle: 'quads',  tag: 'legs' },
  { id: 'reverse-lunges',      name: 'Reverse Lunges',      category: 'lunge',        equipment: 'dumbbell',   defaultReps: 12, defaultRestSec: 60,  muscle: 'quads',  tag: 'legs', defaultWeightLb: 25 },
  { id: 'step-ups',            name: 'Step-ups',            category: 'lunge',        equipment: 'box',        defaultReps: 12, defaultRestSec: 60,  muscle: 'quads',  tag: 'legs', defaultWeightLb: 25 },
  { id: 'calf-raise',          name: 'Calf Raise',          category: 'calfRaise',    equipment: 'machine',    defaultReps: 15, defaultRestSec: 60,  muscle: 'calves', tag: 'legs', defaultWeightLb: 90 },

  // ── Deadlift family ──
  { id: 'deadlift',            name: 'Deadlift',            category: 'deadlift',     equipment: 'barbell',    defaultReps: 5,  defaultRestSec: 180, muscle: 'posterior', tag: 'pull', defaultWeightLb: 185 },
  { id: 'romanian-deadlift',   name: 'Romanian Deadlift',   category: 'deadlift',     equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 90,  muscle: 'hamstrings', tag: 'pull', defaultWeightLb: 115 },
  { id: 'single-leg-rdl',      name: 'Single-leg RDL',      category: 'deadlift',     equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 60,  muscle: 'hamstrings', tag: 'pull', defaultWeightLb: 30 },
  { id: 'kb-swing',            name: 'KB Swing',            category: 'core',         equipment: 'kettlebell', defaultReps: 20, defaultRestSec: 60,  muscle: 'posterior', tag: 'pull', defaultWeightLb: 53 },
  { id: 'hip-thrust',          name: 'Hip Thrust',          category: 'hipRaise',     equipment: 'barbell',    defaultReps: 10, defaultRestSec: 90,  muscle: 'glutes',  tag: 'pull', defaultWeightLb: 135 },

  // ── Push (chest/shoulder/triceps) ──
  { id: 'bench-press',         name: 'Bench Press',         category: 'benchPress',   equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 120, muscle: 'chest',  tag: 'push', defaultWeightLb: 135 },
  { id: 'db-bench',            name: 'DB Bench',            category: 'benchPress',   equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 90,  muscle: 'chest',  tag: 'push', defaultWeightLb: 50 },
  { id: 'incline-bench',       name: 'Incline Bench',       category: 'benchPress',   equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 120, muscle: 'chest',  tag: 'push', defaultWeightLb: 115 },
  { id: 'overhead-press',      name: 'Overhead Press',      category: 'shoulderPress',equipment: 'barbell',    defaultReps: 6,  defaultRestSec: 120, muscle: 'shoulders', tag: 'push', defaultWeightLb: 85 },
  { id: 'db-shoulder-press',   name: 'DB Shoulder Press',   category: 'shoulderPress',equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 90,  muscle: 'shoulders', tag: 'push', defaultWeightLb: 35 },
  { id: 'push-up',             name: 'Push-up',             category: 'pushUp',       equipment: 'bodyweight', defaultReps: 15, defaultRestSec: 60,  muscle: 'chest',  tag: 'push' },
  { id: 'dip',                 name: 'Dip',                 category: 'pushUp',       equipment: 'bodyweight', defaultReps: 10, defaultRestSec: 90,  muscle: 'chest',  tag: 'push' },
  { id: 'lateral-raise',       name: 'Lateral Raise',       category: 'lateralRaise', equipment: 'dumbbell',   defaultReps: 12, defaultRestSec: 60,  muscle: 'shoulders', tag: 'push', defaultWeightLb: 15 },
  { id: 'triceps-extension',   name: 'Triceps Extension',   category: 'tricepsExtension', equipment: 'cable',  defaultReps: 12, defaultRestSec: 60,  muscle: 'triceps', tag: 'push', defaultWeightLb: 40 },

  // ── Pull (back/biceps) ──
  { id: 'pull-up',             name: 'Pull-up',             category: 'pullUp',       equipment: 'bodyweight', defaultReps: 8,  defaultRestSec: 90,  muscle: 'back',   tag: 'pull' },
  { id: 'chin-up',             name: 'Chin-up',             category: 'pullUp',       equipment: 'bodyweight', defaultReps: 8,  defaultRestSec: 90,  muscle: 'back',   tag: 'pull' },
  { id: 'lat-pulldown',        name: 'Lat Pulldown',        category: 'pullUp',       equipment: 'cable',      defaultReps: 10, defaultRestSec: 75,  muscle: 'back',   tag: 'pull', defaultWeightLb: 115 },
  { id: 'barbell-row',         name: 'Barbell Row',         category: 'row',          equipment: 'barbell',    defaultReps: 8,  defaultRestSec: 90,  muscle: 'back',   tag: 'pull', defaultWeightLb: 115 },
  { id: 'db-row',              name: 'DB Row',              category: 'row',          equipment: 'dumbbell',   defaultReps: 10, defaultRestSec: 60,  muscle: 'back',   tag: 'pull', defaultWeightLb: 45 },
  { id: 'cable-row',           name: 'Cable Row',           category: 'row',          equipment: 'cable',      defaultReps: 10, defaultRestSec: 60,  muscle: 'back',   tag: 'pull', defaultWeightLb: 100 },
  { id: 'face-pull',           name: 'Face Pull',           category: 'row',          equipment: 'cable',      defaultReps: 15, defaultRestSec: 60,  muscle: 'rear-delt', tag: 'pull', defaultWeightLb: 35 },
  { id: 'bicep-curl',          name: 'Bicep Curl',          category: 'curl',         equipment: 'dumbbell',   defaultReps: 12, defaultRestSec: 60,  muscle: 'biceps', tag: 'pull', defaultWeightLb: 25 },

  // ── Core ──
  { id: 'plank',               name: 'Plank',               category: 'plank',        equipment: 'bodyweight', defaultReps: null, defaultRestSec: 45, muscle: 'core', tag: 'core', defaultTarget: 'time', defaultValue: 60 },
  { id: 'side-plank',          name: 'Side Plank',          category: 'plank',        equipment: 'bodyweight', defaultReps: null, defaultRestSec: 45, muscle: 'core', tag: 'core', defaultTarget: 'time', defaultValue: 45 },
  { id: 'hollow-hold',         name: 'Hollow Hold',         category: 'core',         equipment: 'bodyweight', defaultReps: null, defaultRestSec: 45, muscle: 'core', tag: 'core', defaultTarget: 'time', defaultValue: 30 },
  { id: 'dead-bug',            name: 'Dead Bug',            category: 'core',         equipment: 'bodyweight', defaultReps: 10, defaultRestSec: 45, muscle: 'core', tag: 'core' },
  { id: 'sit-up',              name: 'Sit-up',              category: 'sitUp',        equipment: 'bodyweight', defaultReps: 20, defaultRestSec: 45, muscle: 'core', tag: 'core' },
  { id: 'russian-twist',       name: 'Russian Twist',       category: 'core',         equipment: 'bodyweight', defaultReps: 30, defaultRestSec: 45, muscle: 'core', tag: 'core' },
  { id: 'leg-raise',           name: 'Leg Raise',           category: 'legRaise',     equipment: 'bodyweight', defaultReps: 12, defaultRestSec: 45, muscle: 'core', tag: 'core' },

  // ── Warm-up & mobility ──
  { id: 'leg-swings',          name: 'Leg Swings',          category: 'warmUp',       equipment: 'bodyweight', defaultReps: 10, defaultRestSec: 0, muscle: 'hips',   tag: 'warmup' },
  { id: 'walking-knee-hugs',   name: 'Walking Knee Hugs',   category: 'warmUp',       equipment: 'bodyweight', defaultReps: 10, defaultRestSec: 0, muscle: 'hips',   tag: 'warmup' },
  { id: 'world-greatest',      name: "World's Greatest Stretch", category: 'warmUp',  equipment: 'bodyweight', defaultReps: 5,  defaultRestSec: 0, muscle: 'fullBody', tag: 'warmup' },
  { id: 'band-pull-apart',     name: 'Band Pull-apart',     category: 'bandedExercises', equipment: 'band',    defaultReps: 20, defaultRestSec: 0, muscle: 'rear-delt', tag: 'warmup' },
  { id: 'hip-flexor-stretch',  name: 'Hip Flexor Stretch',  category: 'warmUp',       equipment: 'bodyweight', defaultReps: null, defaultRestSec: 0, muscle: 'hips', tag: 'mobility', defaultTarget: 'time', defaultValue: 60 },
  { id: 'thoracic-mobility',   name: 'Thoracic Mobility',   category: 'warmUp',       equipment: 'bodyweight', defaultReps: null, defaultRestSec: 0, muscle: 'thoracic', tag: 'mobility', defaultTarget: 'time', defaultValue: 60 },
  { id: 'diaphragmatic-breath',name: 'Diaphragmatic Breathing', category: 'warmUp',   equipment: 'bodyweight', defaultReps: null, defaultRestSec: 0, muscle: 'core', tag: 'mobility', defaultTarget: 'time', defaultValue: 300 },
];

export const EXERCISE_TAGS = [
  { id: 'all',    label: 'All' },
  { id: 'hyrox',  label: 'HYROX' },
  { id: 'push',   label: 'Push' },
  { id: 'pull',   label: 'Pull' },
  { id: 'legs',   label: 'Legs' },
  { id: 'core',   label: 'Core' },
  { id: 'warmup', label: 'Warm-up' },
  { id: 'mobility', label: 'Mobility' },
];

// Find exercise by id, or by approximate display name match.
export function findExercise(idOrName) {
  if (!idOrName) return null;
  const lookup = String(idOrName).toLowerCase().trim();
  return EXERCISES.find(e => e.id === lookup) ||
         EXERCISES.find(e => e.name.toLowerCase() === lookup) ||
         null;
}

export function exercisesByTag(tagId) {
  if (!tagId || tagId === 'all') return EXERCISES;
  return EXERCISES.filter(e => e.tag === tagId);
}

// Build a workout-step object from a library entry. Caller can override
// any field — useful when the user picks "Goblet Squat" but wants 12 reps
// instead of the default 10.
export function stepFromExercise(exercise, overrides = {}) {
  if (!exercise) throw new Error('stepFromExercise: exercise is required');
  const target = exercise.defaultTarget || 'reps';
  const value = exercise.defaultValue ?? exercise.defaultReps ?? null;
  return {
    kind: 'exercise',
    target,
    value,
    intensity: 'active',
    exerciseName: exercise.name,
    weightLb: exercise.defaultWeightLb || null,
    note: '',
    ...overrides,
  };
}

// Expand a "set group" — e.g. Bench 4×8 @ 135lb w/ 90s rest — into the
// underlying step list. Each work step is one exercise step; rest steps
// are inserted between (but not after the last set).
//
// opts: { exercise, sets, reps, weightLb, restSec, intensity='active' }
// Returns an array of step objects ready to append to a segment.
export function expandSetGroup({ exercise, sets, reps, weightLb, restSec, intensity = 'active' }) {
  if (!exercise) throw new Error('expandSetGroup: exercise required');
  const setsN = Math.max(1, parseInt(sets) || 1);
  const repsN = Math.max(1, parseInt(reps) || exercise.defaultReps || 8);
  const rest  = Math.max(0, parseInt(restSec) ?? exercise.defaultRestSec ?? 60);
  const wt    = weightLb != null ? parseFloat(weightLb) : (exercise.defaultWeightLb || null);

  const out = [];
  for (let s = 1; s <= setsN; s++) {
    out.push({
      kind: 'exercise',
      target: 'reps',
      value: repsN,
      intensity,
      exerciseName: exercise.name,
      weightLb: wt,
      note: `Set ${s} of ${setsN}`,
    });
    if (s < setsN && rest > 0) {
      out.push({
        kind: 'exercise',
        target: 'time',
        value: rest,
        intensity: 'rest',
        exerciseName: 'Rest',
        weightLb: null,
        note: `Rest before set ${s + 1}`,
      });
    }
  }
  return out;
}
