// ─── Run Interval Templates ──────────────────────────────────────────────────
// Phase 4r.workbench.8
//
// Each template builds a complete workout step list parameterized by the
// user's paces or HR zones. Distances are in meters internally; paces in
// seconds-per-mile (the user's chosen unit) and converted to meters/second
// for FIT encoding (targetType=speed, customTargetSpeedLow/High).
//
// Templates are intentionally opinionated — sensible defaults rather than
// every-knob-tunable. User can edit the resulting steps in the Workbench
// after applying a template.
//
// Pace targets are encoded as a ±5 sec/mi window around the goal pace —
// gives the watch's pace alert room to breathe without screaming on every
// minor variation.

const MI_TO_M = 1609.34;

// Parse "7:30" or "7:30/mi" or just "450" → sec/mi (number).
export function parsePace(str) {
  if (typeof str === 'number') return str;
  if (!str) return null;
  const s = String(str).trim().replace('/mi', '').replace('/m', '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Format sec/mi → "7:30"
export function formatPace(secPerMi) {
  if (secPerMi == null) return '—';
  const m = Math.floor(secPerMi / 60);
  const s = Math.round(secPerMi % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Build a step with a pace target. Window is goal ±5 sec/mi by default.
// Returns step object with paceLowSecPerMi/paceHighSecPerMi populated so
// the FIT encoder knows to emit targetType=speed.
export function paceStep({ target = 'distance', value, intensity = 'active', exerciseName, paceSecPerMi, window = 5, note = '' }) {
  return {
    kind: 'run',
    target,
    value,
    intensity,
    exerciseName,
    note,
    paceLowSecPerMi:  paceSecPerMi ? paceSecPerMi + window : null,   // slower bound = higher sec/mi
    paceHighSecPerMi: paceSecPerMi ? paceSecPerMi - window : null,   // faster bound = lower sec/mi
  };
}

// ── Templates ───────────────────────────────────────────────────────────────
// Each template has:
//   id, name, description, inputs (which paces to ask the user for)
//   build(paces) → { name, sport, segments: [...] }

export const RUN_TEMPLATES = [
  {
    id: 'easy-base',
    name: 'Easy Base Run',
    description: '30–60 min steady at conversational pace.',
    inputs: [
      { key: 'minutes',      label: 'Duration (min)',   default: 45, type: 'number' },
      { key: 'easyPace',     label: 'Easy pace (/mi)',  default: '9:00', type: 'pace' },
    ],
    build(p) {
      const min = Math.max(10, parseInt(p.minutes) || 45);
      const pace = parsePace(p.easyPace);
      return {
        name: `Easy ${min}min`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 5 * 60, intensity: 'warmup', exerciseName: 'Easy jog', paceSecPerMi: pace + 30, window: 20 }),
          ]},
          { type: 'main', name: 'Steady', steps: [
            paceStep({ target: 'time', value: (min - 10) * 60, intensity: 'active', exerciseName: 'Easy run', paceSecPerMi: pace, window: 15 }),
          ]},
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 5 * 60, intensity: 'cooldown', exerciseName: 'Cool-down jog', paceSecPerMi: pace + 30, window: 20 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'threshold-tempo',
    name: 'Threshold Tempo',
    description: '4×1mi at threshold with 60s jog. Lactate-clearance work.',
    inputs: [
      { key: 'reps',          label: 'Number of mile reps', default: 4, type: 'number' },
      { key: 'thresholdPace', label: 'Threshold pace (/mi)', default: '7:30', type: 'pace' },
      { key: 'easyPace',      label: 'Recovery pace (/mi)',  default: '9:30', type: 'pace' },
    ],
    build(p) {
      const n = Math.max(2, parseInt(p.reps) || 4);
      const tp = parsePace(p.thresholdPace);
      const ep = parsePace(p.easyPace);
      const main = [];
      for (let i = 1; i <= n; i++) {
        main.push(paceStep({ target: 'distance', value: MI_TO_M, intensity: 'active', exerciseName: `Threshold mi ${i}/${n}`, paceSecPerMi: tp, note: 'Smooth, controlled, comfortably hard' }));
        if (i < n) {
          main.push(paceStep({ target: 'time', value: 60, intensity: 'rest', exerciseName: 'Jog recovery', paceSecPerMi: ep + 30, window: 30 }));
        }
      }
      return {
        name: `${n}×1mi Threshold`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
            { kind: 'run', target: 'distance', value: 100, intensity: 'active', exerciseName: 'Strides 100m', note: '4 strides × 100m', repeats: 4 },
          ]},
          { type: 'main', name: 'Threshold reps', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'vo2-intervals',
    name: 'VO2 Intervals (5×3min)',
    description: '5×3min at 5K pace with 2:30 jog recovery. Aerobic ceiling.',
    inputs: [
      { key: 'reps',     label: 'Number of reps',      default: 5, type: 'number' },
      { key: 'fivePace', label: '5K pace (/mi)',       default: '6:50', type: 'pace' },
      { key: 'easyPace', label: 'Recovery pace (/mi)', default: '9:30', type: 'pace' },
    ],
    build(p) {
      const n = Math.max(3, parseInt(p.reps) || 5);
      const fp = parsePace(p.fivePace);
      const ep = parsePace(p.easyPace);
      const main = [];
      for (let i = 1; i <= n; i++) {
        main.push(paceStep({ target: 'time', value: 3 * 60, intensity: 'active', exerciseName: `5K-pace 3:00 #${i}`, paceSecPerMi: fp }));
        if (i < n) main.push(paceStep({ target: 'time', value: 150, intensity: 'rest', exerciseName: 'Jog recovery', paceSecPerMi: ep + 30, window: 30 }));
      }
      return {
        name: `${n}×3min VO2`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 12 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
            { kind: 'run', target: 'distance', value: 100, intensity: 'active', exerciseName: 'Strides 100m', repeats: 4 },
          ]},
          { type: 'main', name: 'VO2 intervals', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'yasso-800s',
    name: 'Yasso 800s',
    description: '10×800m at marathon-goal pace (per Bart Yasso), 90s jog rest.',
    inputs: [
      { key: 'reps',          label: 'Number of 800s', default: 10, type: 'number' },
      { key: 'marathonGoal',  label: 'Goal marathon time (h:mm)', default: '3:30', type: 'text' },
      { key: 'easyPace',      label: 'Recovery pace (/mi)', default: '9:30', type: 'pace' },
    ],
    build(p) {
      const n = Math.max(4, parseInt(p.reps) || 10);
      // Yasso rule: marathon goal 3:30 → 800m in 3:30 (min). Convert.
      const m = /^(\d+):(\d{2})$/.exec(String(p.marathonGoal || '3:30'));
      const goal800sec = m ? (parseInt(m[1]) * 60 + parseInt(m[2])) : 210;
      const goal800pace = Math.round(goal800sec * (MI_TO_M / 800));   // sec/mi equivalent
      const ep = parsePace(p.easyPace);
      const main = [];
      for (let i = 1; i <= n; i++) {
        main.push(paceStep({ target: 'distance', value: 800, intensity: 'active', exerciseName: `Yasso 800 #${i}`, paceSecPerMi: goal800pace, note: `Goal: ${formatPace(goal800sec / (800 / MI_TO_M))} pace` }));
        if (i < n) main.push(paceStep({ target: 'time', value: 90, intensity: 'rest', exerciseName: 'Jog recovery', paceSecPerMi: ep + 30, window: 30 }));
      }
      return {
        name: `Yasso ${n}×800`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
            { kind: 'run', target: 'distance', value: 100, intensity: 'active', exerciseName: 'Strides 100m', repeats: 4 },
          ]},
          { type: 'main', name: 'Yasso 800s', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'ladder',
    name: 'Ladder (200/400/600/800/600/400/200)',
    description: 'Pyramid intervals at 5K pace, jog rest equal to rep time.',
    inputs: [
      { key: 'fivePace', label: '5K pace (/mi)',       default: '6:50', type: 'pace' },
      { key: 'easyPace', label: 'Recovery pace (/mi)', default: '9:30', type: 'pace' },
    ],
    build(p) {
      const fp = parsePace(p.fivePace);
      const ep = parsePace(p.easyPace);
      const dists = [200, 400, 600, 800, 600, 400, 200];
      const main = [];
      dists.forEach((d, i) => {
        main.push(paceStep({ target: 'distance', value: d, intensity: 'active', exerciseName: `${d}m`, paceSecPerMi: fp }));
        if (i < dists.length - 1) {
          // Recovery: rough estimate equal to rep time
          const recoverySec = Math.round(d * fp / MI_TO_M);
          main.push(paceStep({ target: 'time', value: recoverySec, intensity: 'rest', exerciseName: 'Jog recovery', paceSecPerMi: ep + 30, window: 30 }));
        }
      });
      return {
        name: 'Ladder 200→800→200', sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 12 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
            { kind: 'run', target: 'distance', value: 100, intensity: 'active', exerciseName: 'Strides 100m', repeats: 4 },
          ]},
          { type: 'main', name: 'Ladder', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'hill-repeats',
    name: 'Hill Repeats (8×60s)',
    description: '8 × 60s hard uphill, jog down recovery. Build leg strength + form.',
    inputs: [
      { key: 'reps',     label: 'Number of hills', default: 8, type: 'number' },
      { key: 'easyPace', label: 'Recovery pace (/mi)', default: '9:30', type: 'pace' },
    ],
    build(p) {
      const n = Math.max(4, parseInt(p.reps) || 8);
      const ep = parsePace(p.easyPace);
      const main = [];
      for (let i = 1; i <= n; i++) {
        main.push({ kind: 'run', target: 'time', value: 60, intensity: 'active', exerciseName: `Hill ${i} (uphill)`, note: 'Hard effort, drive arms, tall posture' });
        if (i < n) main.push(paceStep({ target: 'time', value: 120, intensity: 'rest', exerciseName: 'Jog down', paceSecPerMi: ep + 60, window: 60 }));
      }
      return {
        name: `${n}× Hill Repeats`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
          ]},
          { type: 'main', name: 'Hills', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },

  {
    id: 'long-run-progression',
    name: 'Long Run with Progression',
    description: 'Long run finishing the last 3 miles at marathon pace.',
    inputs: [
      { key: 'totalMi',      label: 'Total miles',         default: 16, type: 'number' },
      { key: 'progressionMi',label: 'Progression miles',   default: 3, type: 'number' },
      { key: 'easyPace',     label: 'Easy pace (/mi)',     default: '9:00', type: 'pace' },
      { key: 'mpPace',       label: 'Marathon pace (/mi)', default: '8:00', type: 'pace' },
    ],
    build(p) {
      const total = Math.max(6, parseInt(p.totalMi) || 16);
      const prog  = Math.min(Math.max(1, parseInt(p.progressionMi) || 3), total - 2);
      const easy  = total - prog;
      const ep = parsePace(p.easyPace);
      const mp = parsePace(p.mpPace);
      return {
        name: `LR ${total}mi (${prog}mi MP)`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Easy start', steps: [
            paceStep({ target: 'distance', value: easy * MI_TO_M, intensity: 'active', exerciseName: `Easy ${easy}mi`, paceSecPerMi: ep, window: 20 }),
          ]},
          { type: 'main', name: 'Progression', steps: [
            paceStep({ target: 'distance', value: prog * MI_TO_M, intensity: 'active', exerciseName: `Marathon-pace ${prog}mi`, paceSecPerMi: mp }),
          ]},
          { type: 'cooldown', name: 'Walk-off', steps: [
            { kind: 'run', target: 'time', value: 5 * 60, intensity: 'cooldown', exerciseName: 'Walk / easy', note: 'Easy walk + stretches' },
          ]},
        ],
      };
    },
  },

  {
    id: 'fartlek',
    name: 'Fartlek (8×1min on/off)',
    description: 'Unstructured speed play: 1 min hard + 1 min easy × 8.',
    inputs: [
      { key: 'reps',     label: 'Number of efforts', default: 8, type: 'number' },
      { key: 'easyPace', label: 'Easy pace (/mi)',   default: '9:00', type: 'pace' },
    ],
    build(p) {
      const n = Math.max(4, parseInt(p.reps) || 8);
      const ep = parsePace(p.easyPace);
      const main = [];
      for (let i = 1; i <= n; i++) {
        main.push({ kind: 'run', target: 'time', value: 60, intensity: 'active', exerciseName: `1min hard #${i}`, note: 'Strong, controlled' });
        main.push(paceStep({ target: 'time', value: 60, intensity: 'rest', exerciseName: '1min easy', paceSecPerMi: ep, window: 30 }));
      }
      return {
        name: `Fartlek ${n}×1min`, sport: 'running',
        segments: [
          { type: 'warmup', name: 'Warm-up', steps: [
            paceStep({ target: 'time', value: 10 * 60, intensity: 'warmup', exerciseName: 'Easy warm-up', paceSecPerMi: ep, window: 30 }),
          ]},
          { type: 'main', name: 'Fartlek', steps: main },
          { type: 'cooldown', name: 'Cool-down', steps: [
            paceStep({ target: 'time', value: 8 * 60, intensity: 'cooldown', exerciseName: 'Easy cool-down', paceSecPerMi: ep, window: 30 }),
          ]},
        ],
      };
    },
  },
];

// Convert sec/mi → m/s (FIT speed unit is m/s × 1000 = mm/s).
// Returns null if input is null/invalid.
export function paceToMs(secPerMi) {
  if (secPerMi == null || secPerMi <= 0) return null;
  return MI_TO_M / secPerMi;     // meters / (sec/mi × 1mi / MI_TO_Mm) = m/s
}
