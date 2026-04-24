// ─── ARNOLD Goals ────────────────────────────────────────────────────────────
// Single source of truth for every target. All tabs read from here.
// During the transition we fall back to profile fields when a goal is unset
// so nothing breaks while users move targets into the Hub.

import { storage } from "./storage.js";

// Canonical goal schema with sensible defaults. The Hub renders one row per
// entry. Add new goals here and they'll automatically appear in the editor.
export const GOAL_DEFS = [
  // ─── Run ──────────────────────────────────────────────────────────────────
  { id: 'weeklyRunDistanceTarget', group: 'Run', label: 'Weekly run distance', unit: 'mi',  type: 'number', default: 20  },
  { id: 'weeklyTimeTargetHrs',     group: 'Run', label: 'Weekly run time',     unit: 'hrs', type: 'number', default: 5 },
  { id: 'weeklySpeedSessions',     group: 'Run', label: 'Weekly speed work',   unit: '/wk', type: 'number', default: 1 },
  { id: 'zone2Pct',                group: 'Run', label: 'Zone 2 training',     unit: '%',   type: 'number', default: 80 },
  { id: 'targetRacePace',          group: 'Run', label: 'Target marathon pace',unit: 'min/mi', type: 'string', default: '9:30', placeholder: 'mm:ss' },
  { id: 'targetAvgRunHR',          group: 'Run', label: 'Target avg run HR',   unit: 'bpm', type: 'number', default: 145 },
  { id: 'annualRunDistanceTarget', group: 'Run', label: 'Annual run distance', unit: 'mi',  type: 'number', default: 800 },

  // ─── Strength ─────────────────────────────────────────────────────────────
  { id: 'weeklyStrengthTarget',    group: 'Strength', label: 'Weekly strength sessions', unit: '/wk', type: 'number', default: 2 },
  { id: 'weeklyStrengthMinutesTarget', group: 'Strength', label: 'Weekly strength minutes', unit: 'min', type: 'number', default: 60 },
  { id: 'weeklyMobilitySessions',  group: 'Strength', label: 'Weekly mobility',     unit: '/wk', type: 'number', default: 2 },
  { id: 'pullUpsTarget',           group: 'Strength', label: 'Pull-ups',            unit: 'reps', type: 'number', default: 10 },
  { id: 'handstandPushupsTarget',  group: 'Strength', label: 'Handstand push-ups',  unit: 'reps', type: 'number', default: 5 },
  { id: 'annualWorkoutsTarget',    group: 'Strength', label: 'Annual workouts',     unit: '',    type: 'number', default: 200 },

  // ─── Recovery (HR-derived) ───────────────────────────────────────────────
  { id: 'targetRHR',               group: 'Recovery', label: 'Target resting HR',   unit: 'bpm', type: 'number', default: 55 },
  { id: 'targetHRV',               group: 'Recovery', label: 'Target overnight HRV', unit: 'ms', type: 'number', default: 70 },

  // ─── Body ────────────────────────────────────────────────────────────────
  { id: 'targetWeight',            group: 'Body',     label: 'Target weight',       unit: 'lbs', type: 'number', default: 175 },
  { id: 'targetWeightDate',        group: 'Body',     label: 'Target weight by',    unit: '',    type: 'string', default: '' },
  { id: 'targetBodyFat',           group: 'Body',     label: 'Target body fat',     unit: '%',   type: 'number', default: 18  },

  // ─── Nutrition ───────────────────────────────────────────────────────────
  // Macro grams are DERIVED from calories × split %. Edit calories + the
  // three percentages; grams update automatically (4/4/9 kcal per gram).
  { id: 'dailyCalorieTarget',      group: 'Nutrition', label: 'Daily calories',     unit: 'kcal',type: 'number', default: 2200 },
  { id: 'proteinPct',              group: 'Nutrition', label: 'Protein split',      unit: '%',   type: 'number', default: 30, hidden: true },
  { id: 'carbPct',                 group: 'Nutrition', label: 'Carb split',         unit: '%',   type: 'number', default: 40, hidden: true },
  { id: 'fatPct',                  group: 'Nutrition', label: 'Fat split',          unit: '%',   type: 'number', default: 30, hidden: true },
  { id: 'dailyProteinTarget',      group: 'Nutrition', label: 'Daily protein',      unit: 'g',   type: 'number', default: 150, derived: true },
  { id: 'dailyCarbTarget',         group: 'Nutrition', label: 'Daily carbs',        unit: 'g',   type: 'number', default: 180, derived: true },
  { id: 'dailyFatTarget',          group: 'Nutrition', label: 'Daily fat',          unit: 'g',   type: 'number', default: 65,  derived: true },

  // ─── Recovery ────────────────────────────────────────────────────────────
  { id: 'targetSleepHours',        group: 'Recovery', label: 'Target sleep',        unit: 'hrs', type: 'number', default: 7.5 },
  { id: 'targetSleepScore',        group: 'Recovery', label: 'Target sleep score',  unit: '/100', type: 'number', default: 85 },
];

// Read all goals as a flat object, falling back to profile then defaults.
// Macro gram targets are ALWAYS derived from calories × split, never stored.
export function getGoals() {
  const goals = storage.get('goals') || {};
  const profile = storage.get('profile') || {};
  const out = {};
  for (const def of GOAL_DEFS) {
    if (def.derived) continue;
    if (goals[def.id] != null && goals[def.id] !== '') out[def.id] = goals[def.id];
    else if (profile[def.id] != null && profile[def.id] !== '') out[def.id] = profile[def.id];
    else out[def.id] = def.default;
  }
  // Derived macros — kcal × pct ÷ kcal-per-gram (P/C 4, F 9)
  const cals = parseFloat(out.dailyCalorieTarget) || 0;
  const pp = parseFloat(out.proteinPct) || 0;
  const cp = parseFloat(out.carbPct) || 0;
  const fp = parseFloat(out.fatPct) || 0;
  out.dailyProteinTarget = Math.round((cals * pp / 100) / 4);
  out.dailyCarbTarget    = Math.round((cals * cp / 100) / 4);
  out.dailyFatTarget     = Math.round((cals * fp / 100) / 9);
  return out;
}

// Helper for UI: returns the derived gram values plus the % sum so the editor
// can warn when the splits don't add to 100.
export function getMacroBreakdown() {
  const g = getGoals();
  const sum = (parseFloat(g.proteinPct)||0) + (parseFloat(g.carbPct)||0) + (parseFloat(g.fatPct)||0);
  return {
    cals: g.dailyCalorieTarget,
    proteinG: g.dailyProteinTarget,
    carbG: g.dailyCarbTarget,
    fatG: g.dailyFatTarget,
    pctSum: sum,
  };
}

// Read a single goal with the same fallback chain.
export function getGoal(id) {
  return getGoals()[id];
}

// Save a partial update. Records the previous value in history for undo/audit.
export function setGoals(partial) {
  const current = storage.get('goals') || {};
  const next = { ...current, ...partial };
  storage.set('goals', next, { skipValidation: true });
  // Append to history for the change log
  const history = storage.get('goalsHistory') || [];
  for (const [id, value] of Object.entries(partial)) {
    if (current[id] !== value) {
      history.unshift({ ts: Date.now(), id, from: current[id] ?? null, to: value });
    }
  }
  // Bound history to 100 entries
  try { localStorage.setItem('arnold:goalsHistory', JSON.stringify(history.slice(0, 100))); } catch {}
  return next;
}

// Group definitions by domain for the editor UI.
export function goalsByGroup() {
  const groups = {};
  for (const def of GOAL_DEFS) {
    if (!groups[def.group]) groups[def.group] = [];
    groups[def.group].push(def);
  }
  return groups;
}
