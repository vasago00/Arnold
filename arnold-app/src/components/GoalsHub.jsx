// ─── Goals Hub (v2 — outcome-only, Phase B Turn 3) ──────────────────────────
//
// Outcome-only goals form. User sets WHAT they want to achieve; the
// system derives every tangible target (calorie target, protein floor,
// training volume) from the outcomes via goalModel.js.
//
// Sections:
//   • Body         — weight, body fat, lean mass (target value + date + priority)
//   • Recovery     — sleep floor, HRV baseline, RHR baseline (ongoing, no date)
//   • Performance  — endurance (5K/10K/half/marathon), strength (1RM lifts),
//                    composite (hyrox), each with target value + date + priority
//   • Races        — first-class race entries with A/B/C priority + date.
//                    Auto-escalates to effectively-P1 when within 4 weeks
//                    (per DATAMODEL.md decision 2)
//   • Advanced overrides — manually pinned calorie/protein values, displayed
//                          alongside the derived shadow ("pinned 1750,
//                          derived would be 2105")
//
// Storage: v2 schema (see DATAMODEL.md). Compat adapter reads legacy v1
// fields (targetWeight, targetWeightDate, dailyCalorieTarget, etc.) and
// normalizes to v2 internally. Writes always go to v2 shape. Turn 4 will
// move the adapter into goalModel.js; for now it lives here so the UI
// works immediately.
//
// Diagnostic: NutritionCalibrationPanel preserved at the bottom of the
// form — shows RMR + empirical/model TDEE + recommended targets + drift,
// so the user can see WHY the system is deriving what it is.

import { useState, useMemo, useEffect, useRef } from "react";
import { storage } from "../core/storage.js";
import { getCutMode, refreshCutMode, getCutModeOverride, setCutModeOverride } from "../core/cutMode.js";
import {
  computeRMR,
  computeTDEE,
  empiricalTDEE,
  assessCalibration,
  recommendCalorieTarget,
  getCurrentBodyComp,
} from "../core/energyBalance.js";
import {
  getEffectiveTargets,
  getOverrides,
  setOverride,
  clearOverride,
} from "../core/goalModel.js";
import { getGoals, setGoals } from "../core/goals.js";
import { predictRaceFinish } from "../core/derive/tileMetrics.js";
import { allActivities as getUnifiedActivities } from "../core/dcyMath.js";

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE ADAPTER — read/write v2 with v1 compat
// ═══════════════════════════════════════════════════════════════════════════

const EMPTY_V2 = () => ({
  schemaVersion: 2,
  body:        { weight: null, bodyFat: null, leanMass: null },
  recovery:    { sleepHoursMin: null, hrvBaseline: null, rhrBaseline: null },
  performance: {
    // Endurance — fixed canonical distances (universal PRs).
    run5K: null, run10K: null, halfMarathon: null, marathon: null,
    // Custom strength entries (Phase 4r.dataspine.12) — user defines
    // their own based on training type. Each: { id, label, valueNum,
    // unit, targetDate, priority }.
    customStrength: [],
  },
  races: [],
});

/** Build a v2-shape object from legacy v1 goals + localStorage races. */
function buildV2FromV1(v1) {
  const out = EMPTY_V2();
  if (!v1 || typeof v1 !== 'object') return out;

  // Body
  if (v1.targetWeight) {
    out.body.weight = {
      targetLbs:  parseFloat(v1.targetWeight) || null,
      targetDate: v1.targetWeightDate || null,
      priority:   1,
    };
  }
  if (v1.targetBodyFat) {
    out.body.bodyFat = {
      targetPct:  parseFloat(v1.targetBodyFat) || null,
      targetDate: v1.targetWeightDate || null,  // legacy shared date
      priority:   2,
    };
  }
  // Recovery
  if (v1.targetSleepScore || v1.targetSleepHours) {
    out.recovery.sleepHoursMin = {
      value:    parseFloat(v1.targetSleepHours) || 7.5,
      priority: 1,
    };
  }
  // Performance — race pace
  if (v1.targetRacePace) {
    // legacy: targetRacePace is a string like '8:30' per mile, no specific distance.
    // Don't migrate to a specific run distance; let the user re-enter explicitly.
  }
  // Races: pull from localStorage 'arnold:races'
  try {
    const racesRaw = localStorage.getItem('arnold:races');
    const races = racesRaw ? JSON.parse(racesRaw) : [];
    if (Array.isArray(races)) {
      out.races = races.map(r => ({
        id:           r.id || `race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name:         r.name || 'Race',
        date:         r.date || null,
        city:         r.city || null,
        type:         r.type || 'other',
        distanceMi:   r.distanceMi != null ? Number(r.distanceMi) : null,
        priority:     (r.priority || 'A').toUpperCase(),
        goalTimeSecs: r.goalTimeSecs != null ? Number(r.goalTimeSecs) : null,
      }));
    }
  } catch {}

  return out;
}

/** Load v2 goals from storage, falling back to v1 compat. */
function loadGoalsV2() {
  const raw = storage.get('goals') || {};
  if (raw.schemaVersion === 2) {
    // Merge with empty defaults so missing categories don't crash UI.
    return { ...EMPTY_V2(), ...raw };
  }
  // v1 → v2 compat normalization. We do NOT write v2 back yet —
  // Turn 4 owns the migration write. Turn 3 just reads in v2 shape.
  return buildV2FromV1(raw);
}

/**
 * Save v2 goals to storage. Preserves any v1 fields the user hasn't
 * migrated yet (so old code paths reading goals.dailyCalorieTarget
 * still work during the 2-week compat window).
 */
function saveGoalsV2(v2) {
  const existing = storage.get('goals') || {};
  storage.set('goals', { ...existing, ...v2, schemaVersion: 2 });
  // Also write any race changes to legacy localStorage so the rest of
  // the app's existing race reads keep working until Turn 4.
  try {
    localStorage.setItem('arnold:races', JSON.stringify(v2.races || []));
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS — labels, units, formatters
// ═══════════════════════════════════════════════════════════════════════════

const SECTION_COLOR = {
  body:        '#22d3ee',
  recovery:    '#4ade80',
  performance: '#a78bfa',
  races:       '#ef4444',
  overrides:   '#fbbf24',
};

const PRIORITY_LABEL = { 1: 'P1', 2: 'P2', 3: 'P3' };
const PRIORITY_COLOR = { 1: '#ef4444', 2: '#fbbf24', 3: '#94a3b8' };

const BODY_DEFS = [
  { id: 'weight',   label: 'Target weight',   field: 'targetLbs', unit: 'lb', step: 0.1, dateField: 'targetDate' },
  { id: 'bodyFat',  label: 'Target body fat', field: 'targetPct', unit: '%',  step: 0.1, dateField: 'targetDate' },
  { id: 'leanMass', label: 'Target lean mass',field: 'targetLbs', unit: 'lb', step: 0.1, dateField: 'targetDate' },
];
const RECOVERY_DEFS = [
  { id: 'sleepHoursMin', label: 'Minimum sleep', field: 'value',    unit: 'h/night', step: 0.1 },
  { id: 'hrvBaseline',   label: 'HRV baseline',  field: 'valueMs',  unit: 'ms',      step: 1 },
  { id: 'rhrBaseline',   label: 'Resting HR',    field: 'valueBpm', unit: 'bpm',     step: 1 },
];
// Phase 4r.dataspine.12 — Endurance kept as fixed defs (universally
// meaningful PRs). Strength is now user-defined via customStrength
// entries (see goals.performance.customStrength) — the previous
// powerlifting defaults (bench/squat/deadlift/OHP) didn't match the
// majority use case (Hyrox / HIIT / functional). Composite removed
// entirely — race-specific time goals like Hyrox belong in Races
// (which already carries goalTimeSecs), not duplicated here.
const PERFORMANCE_DEFS = {
  Endurance: [
    { id: 'run5K',        label: '5K (finish time)',           field: 'targetSecs', unit: 'time', step: 1, dateField: 'targetDate' },
    { id: 'run10K',       label: '10K (finish time)',          field: 'targetSecs', unit: 'time', step: 1, dateField: 'targetDate' },
    { id: 'halfMarathon', label: 'Half marathon (finish time)',field: 'targetSecs', unit: 'time', step: 1, dateField: 'targetDate' },
    { id: 'marathon',     label: 'Marathon (finish time)',     field: 'targetSecs', unit: 'time', step: 1, dateField: 'targetDate' },
  ],
};

/** Format seconds as M:SS or H:MM:SS. */
function fmtSecs(s) {
  if (s == null || !Number.isFinite(Number(s))) return '—';
  const n = Number(s);
  if (n >= 3600) {
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const ss = Math.round(n % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  const m = Math.floor(n / 60);
  const ss = Math.round(n % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}
/** Parse 'M:SS' or 'H:MM:SS' or raw seconds → seconds. */
function parseSecs(str) {
  if (str == null || str === '') return null;
  const s = String(str).trim();
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
/**
 * Normalize a date string to YYYY-MM-DD. Accepts ISO, MM-DD-YYYY,
 * MM/DD/YYYY, or anything Date() can parse. Returns null if unparseable.
 * Was the source of "Invalid Date" in the BODY section — legacy v1
 * goals stored targetWeightDate in MM-DD-YYYY which broke our ISO
 * concatenation (`'08-31-2026' + 'T12:00:00'` is not a valid date).
 */
function normalizeDate(d) {
  if (!d) return null;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM-DD-YYYY or MM/DD/YYYY
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) {
    const [, mo, da, yr] = m;
    return `${yr}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
  }
  // Last resort: let Date() try
  const parsed = new Date(s);
  if (!isNaN(parsed)) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function fmtDate(d) {
  if (!d) return '—';
  const iso = normalizeDate(d);
  if (!iso) return '—';
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return '—'; }
}
// Abbreviate common long city names for the dense Races table. Clear in
// context (the race name already carries the full identity).
const _CITY_ABBREV = { 'New York': 'NY', 'Los Angeles': 'LA', 'San Francisco': 'SF', 'Washington DC': 'DC' };
function abbrevCity(city) {
  if (!city) return city;
  return _CITY_ABBREV[city] || city;
}
function daysFromNow(dateStr) {
  if (!dateStr) return null;
  const iso = normalizeDate(dateStr);
  if (!iso) return null;
  try {
    const ms = new Date(iso + 'T00:00:00').getTime();
    const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0); // midnight->midnight: was Date.now(), which drifted DOWN through the day (4d->3d vs EdgeIQ).
    return Math.round((ms - todayMid.getTime()) / 86400000);
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED STYLES
// ═══════════════════════════════════════════════════════════════════════════

const styles = {
  panel: {
    background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    marginBottom: 10,
  },
  sectionHeader: {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 11, fontWeight: 600, letterSpacing: '0.10em',
    textTransform: 'uppercase',
  },
  sectionHint: {
    fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.05em',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) auto auto auto',
    gap: 8, alignItems: 'center', padding: '6px 0',
    borderBottom: '0.5px dashed var(--border-subtle)',
  },
  rowLabel: { fontSize: 12, color: 'var(--text-secondary)' },
  rowValue: { fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' },
  rowDate:  { fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' },
  priorityChip: (p) => ({
    fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
    color: PRIORITY_COLOR[p] || '#94a3b8',
    background: `${PRIORITY_COLOR[p] || '#94a3b8'}1a`,
    border: `0.5px solid ${PRIORITY_COLOR[p] || '#94a3b8'}44`,
    padding: '1px 6px', borderRadius: 4,
  }),
  raceChip: (priority) => ({
    fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
    color: priority === 'A' ? '#ef4444' : priority === 'B' ? '#fbbf24' : '#94a3b8',
    background: priority === 'A' ? 'rgba(239,68,68,0.16)' : priority === 'B' ? 'rgba(251,191,36,0.14)' : 'rgba(148,163,184,0.14)',
    border: `0.5px solid ${priority === 'A' ? 'rgba(239,68,68,0.4)' : priority === 'B' ? 'rgba(251,191,36,0.4)' : 'rgba(148,163,184,0.3)'}`,
    padding: '1px 6px', borderRadius: 4,
  }),
  editBtn: {
    all: 'unset', cursor: 'pointer', position: 'relative',
    fontSize: 10, padding: '2px 8px', borderRadius: 4,
    color: 'var(--text-muted)',
    border: '0.5px solid var(--border-subtle)',
  },
  addBtn: {
    all: 'unset', cursor: 'pointer', position: 'relative',
    fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 999,
    color: 'var(--text-accent)',
    background: 'var(--accent-dim)',
    border: '0.5px solid var(--accent-border)',
    marginTop: 6, display: 'inline-block',
  },
  editForm: {
    gridColumn: '1 / -1',
    background: 'rgba(96,165,250,0.04)',
    border: '0.5px solid rgba(96,165,250,0.20)',
    borderRadius: 6,
    padding: '8px 10px',
    margin: '4px 0',
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'center',
  },
  editInput: {
    fontSize: 12, padding: '5px 8px',
    background: 'var(--bg-input)', border: '0.5px solid var(--border-default)',
    borderRadius: 4, color: 'var(--text-primary)',
    width: '100%', boxSizing: 'border-box',
  },
  editLabel: { fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 2 },
  saveBtn: {
    background: 'var(--accent-dim)', color: 'var(--text-accent)',
    border: '0.5px solid var(--accent-border)',
    borderRadius: 4, padding: '5px 12px',
    fontSize: 11, cursor: 'pointer',
  },
  cancelBtn: {
    background: 'transparent', color: 'var(--text-muted)',
    border: '0.5px solid var(--border-subtle)',
    borderRadius: 4, padding: '5px 10px',
    fontSize: 11, cursor: 'pointer', marginLeft: 4,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// TILE WRAPPER — Phase 4r.dataspine.8 (command-center uniform shell)
// ═══════════════════════════════════════════════════════════════════════════
//
// Every Goals Hub section panel uses this wrapper so all six tiles share
// the same chrome: 3px accent border-left, header row with title + hint,
// scrollable body that fills remaining height. Parent grid enforces the
// tile dimensions (grid-auto-rows: 360px); this component just lives
// inside the cell and scrolls its overflow.

function Tile({ accent, title, hint, children, headerExtra = null, fillHeight = false }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border-default)',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      // Phase 4r.dataspine.10 — auto height up to a cap; overflow scrolls.
      // Short tiles (Body / Recovery / Manual pins with ~3 rows) shrink
      // to fit instead of forcing 280-360px of empty space below content.
      // Tall tiles (Performance with 9 rows, Races with 13+) hit the
      // cap and scroll internally.
      // fillHeight (Phase 4r.goals.training.2) — grow to fill the grid cell
      // so a column-spanning neighbor (Performance + Training targets stack)
      // stays aligned; lifts the maxHeight cap for that case.
      maxHeight: fillHeight ? 'none' : 360,
      height: fillHeight ? '100%' : undefined,
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 8, marginBottom: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: accent }}>
          {title}
        </span>
        {hint && (
          <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>
            {hint}
          </span>
        )}
        {headerExtra}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, marginRight: -4, paddingRight: 4 }}>
        {children}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME INPUT — Phase 4r.dataspine.13 (H:MM:SS with auto-advance)
// ═══════════════════════════════════════════════════════════════════════════
//
// Three numeric cells separated by colons. Used by GoalRow when a field
// represents a duration (5K/10K/half-marathon/marathon finish times,
// any future time-based PR). Replaces the single text input that
// previously let a user accidentally enter "26:00" as a marathon goal
// and have it interpret as 26 minutes.
//
// Behaviour:
//   • Each cell is digits-only, max 2 characters.
//   • Typing the 2nd digit auto-advances to the next cell.
//   • Typing `:` (or `;` / `.` for keyboard-quirk forgiveness) manually
//     advances even if only 1 digit was typed (so the user can enter
//     "1:35:00" naturally).
//   • Backspace on an empty cell jumps focus to the previous cell.
//   • Empty HH means "no hours" — string emitted is M:SS (preserves
//     parseSecs back-compat).
//
// Emits the value as a string ("1:35:00" or "22:00") via onChange so
// the parent GoalRow's existing parseSecs path keeps working unchanged.

function TimeInput({ value, onChange, autoFocus = false }) {
  const hhRef = useRef(null);
  const mmRef = useRef(null);
  const ssRef = useRef(null);

  // Phase 4r.dataspine.13-fix2 — local state per cell. The previous
  // implementation derived cell contents from the parent's value string
  // on every render, AND padded empty cells to "00" in the emit step,
  // which made each cell look "full" (maxLength=2 blocked further
  // typing) the moment the user filled ANY cell. Specifically: typing
  // "3" in HH triggered emit("3","","") → onChange("3:00:00") → next
  // render's parts.m = "00", parts.s = "00" → MM and SS cells refused
  // any input. Local state breaks that loop — cells show ONLY what
  // the user has typed; padding happens once on emit and never round-
  // trips back into the cell displays.

  // Parse value into initial parts (runs once on mount; component
  // remounts when GoalRow's editingId changes so re-edit gets fresh state).
  const initial = (() => {
    if (!value) return { h: '', m: '', s: '' };
    const tokens = String(value).split(':');
    if (tokens.length === 3) return { h: tokens[0] || '', m: tokens[1] || '', s: tokens[2] || '' };
    if (tokens.length === 2) return { h: '', m: tokens[0] || '', s: tokens[1] || '' };
    return { h: '', m: '', s: tokens[0] || '' };
  })();
  // Strip any leading zeros from display state (so "00" round-trips as "")
  // but preserve "0" if user genuinely typed a zero.
  const stripPad = (v) => {
    if (v == null || v === '') return '';
    const s = String(v).replace(/\D/g, '');
    if (s === '' || s === '0' || s === '00') return '';
    return s.slice(0, 2);
  };
  const [h, setH] = useState(stripPad(initial.h));
  const [m, setM] = useState(stripPad(initial.m));
  const [s, setS] = useState(stripPad(initial.s));

  // Emit canonical string upward whenever any cell changes. We DO pad
  // here so parseSecs can read it cleanly, but the padded result never
  // flows back into the cells (cells are driven by local state).
  useEffect(() => {
    const formatted = (() => {
      if (h && h !== '0') {
        return `${h}:${(m || '0').padStart(2, '0')}:${(s || '0').padStart(2, '0')}`;
      }
      if (m || s) {
        return `${m || '0'}:${(s || '0').padStart(2, '0')}`;
      }
      return '';
    })();
    onChange(formatted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, m, s]);

  const handleChange = (setter, raw, nextRef) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 2);
    setter(cleaned);
    if (cleaned.length === 2 && nextRef?.current) {
      // Defer to next tick so React flushes the state update first
      setTimeout(() => nextRef.current?.focus(), 0);
    }
  };

  const handleKeyDown = (e, prevRef, nextRef) => {
    // Colon (or near-miss separators) → manual advance
    if ((e.key === ':' || e.key === ';' || e.key === '.') && nextRef?.current) {
      e.preventDefault();
      nextRef.current.focus();
      return;
    }
    // Backspace on empty cell → jump back
    if (e.key === 'Backspace' && e.currentTarget.value === '' && prevRef?.current) {
      e.preventDefault();
      prevRef.current.focus();
    }
  };

  const cellStyle = {
    ...styles.editInput,
    width: 36, textAlign: 'center', padding: '5px 4px',
    fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
  };
  const sep = { color: 'var(--text-muted)', fontSize: 13, padding: '0 2px', userSelect: 'none' };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <input
        ref={hhRef}
        value={h}
        onChange={e => handleChange(setH, e.target.value, mmRef)}
        onKeyDown={e => handleKeyDown(e, null, mmRef)}
        placeholder="hh"
        maxLength={2}
        inputMode="numeric"
        style={cellStyle}
        autoFocus={autoFocus}
      />
      <span style={sep}>:</span>
      <input
        ref={mmRef}
        value={m}
        onChange={e => handleChange(setM, e.target.value, ssRef)}
        onKeyDown={e => handleKeyDown(e, hhRef, ssRef)}
        placeholder="mm"
        maxLength={2}
        inputMode="numeric"
        style={cellStyle}
      />
      <span style={sep}>:</span>
      <input
        ref={ssRef}
        value={s}
        onChange={e => handleChange(setS, e.target.value, null)}
        onKeyDown={e => handleKeyDown(e, mmRef, null)}
        placeholder="ss"
        maxLength={2}
        inputMode="numeric"
        style={cellStyle}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// GOAL ROW — generic inline-editable row
// ═══════════════════════════════════════════════════════════════════════════

function GoalRow({ def, goal, sectionKey, onUpdate, onClear, editingId, setEditingId }) {
  const rowKey = `${sectionKey}.${def.id}`;
  const isEditing = editingId === rowKey;
  // Display values
  const valDisplay = (() => {
    if (!goal) return '—';
    const raw = goal[def.field];
    if (raw == null) return '—';
    if (def.unit === 'time') return fmtSecs(raw);
    return `${raw} ${def.unit}`;
  })();
  const dateDisplay = def.dateField && goal?.[def.dateField] ? fmtDate(goal[def.dateField]) : null;
  const priority = goal?.priority || null;

  // Edit form state
  const [drVal,  setDrVal]  = useState('');
  const [drDate, setDrDate] = useState('');
  const [drPri,  setDrPri]  = useState(2);
  useEffect(() => {
    if (isEditing) {
      setDrVal(goal?.[def.field] != null
        ? (def.unit === 'time' ? fmtSecs(goal[def.field]) : String(goal[def.field]))
        : '');
      setDrDate(goal?.[def.dateField] || '');
      setDrPri(goal?.priority || 2);
    }
  }, [isEditing, goal, def]);

  const handleSave = () => {
    let parsedVal;
    if (def.unit === 'time') parsedVal = parseSecs(drVal);
    else                     parsedVal = drVal === '' ? null : parseFloat(drVal);
    if (parsedVal == null || isNaN(parsedVal)) {
      onClear?.();
    } else {
      const next = {
        [def.field]: parsedVal,
        priority: drPri,
      };
      if (def.dateField) next[def.dateField] = normalizeDate(drDate);
      onUpdate?.(next);
    }
    setEditingId(null);
  };

  return (
    <>
      <div style={styles.row}>
        <div style={styles.rowLabel}>{def.label}</div>
        <div style={styles.rowValue}>{valDisplay}</div>
        <div style={styles.rowDate}>{dateDisplay || ''}</div>
        {priority ? <span style={styles.priorityChip(priority)}>{PRIORITY_LABEL[priority]}</span> : <span/>}
        <button
          className="arnold-compact-btn"
          style={styles.editBtn}
          onClick={() => setEditingId(isEditing ? null : rowKey)}
          aria-label={isEditing ? 'Cancel edit' : 'Edit goal'}
        >
          {isEditing ? '×' : (goal ? 'edit' : '+ set')}
        </button>
      </div>
      {isEditing && (
        <div style={styles.editForm}>
          <div>
            <div style={styles.editLabel}>Target {def.unit === 'time' ? '(H:MM:SS)' : `(${def.unit})`}</div>
            {def.unit === 'time' ? (
              <TimeInput value={drVal} onChange={setDrVal} autoFocus/>
            ) : (
              <input
                style={styles.editInput}
                value={drVal}
                onChange={e => setDrVal(e.target.value)}
                autoFocus
              />
            )}
          </div>
          {def.dateField && (
            <div>
              <div style={styles.editLabel}>By date</div>
              <input
                type="date"
                style={styles.editInput}
                value={drDate}
                onChange={e => setDrDate(e.target.value)}
              />
            </div>
          )}
          <div>
            <div style={styles.editLabel}>Priority</div>
            <select
              style={styles.editInput}
              value={drPri}
              onChange={e => setDrPri(Number(e.target.value))}
            >
              <option value={1}>P1 — Primary</option>
              <option value={2}>P2 — Secondary</option>
              <option value={3}>P3 — Background</option>
            </select>
          </div>
          <div style={{ display: 'flex' }}>
            <button style={styles.saveBtn} onClick={handleSave}>Save</button>
            {goal && (
              <button
                style={styles.cancelBtn}
                onClick={() => { onClear?.(); setEditingId(null); }}
              >Clear</button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOM STRENGTH EDITOR — Phase 4r.dataspine.12
// ═══════════════════════════════════════════════════════════════════════════
//
// Inline form for adding/editing a user-defined strength PR. Used inside
// the Performance tile's Strength subgroup. Each entry has:
//   - label   (free-text name, e.g. "Pull-ups 1RM", "Sled push 100m")
//   - valueNum (numeric target)
//   - unit    (free-text, e.g. "reps", "lbs", "sec", "m")
//   - targetDate (optional ISO date)
//   - priority (1/2/3)

function CustomStrengthEditor({ initial, onSave, onCancel, onDelete }) {
  const [label, setLabel] = useState(initial?.label || '');
  const [valueNum, setValueNum] = useState(initial?.valueNum != null ? String(initial.valueNum) : '');
  const [unit, setUnit] = useState(initial?.unit || '');
  const [date, setDate] = useState(initial?.targetDate || '');
  const [prio, setPrio] = useState(initial?.priority || 2);

  const canSave = label.trim() && valueNum !== '';

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: initial?.id || `strength-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: label.trim(),
      valueNum: parseFloat(valueNum),
      unit: unit.trim() || null,
      targetDate: normalizeDate(date),
      priority: prio,
    });
  };

  return (
    <div style={{
      ...styles.editForm,
      gridTemplateColumns: '1.4fr 0.7fr 0.7fr 1fr 0.6fr auto',
      margin: '6px 0',
    }}>
      <div>
        <div style={styles.editLabel}>Name</div>
        <input
          style={styles.editInput}
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Pull-ups 1RM"
          autoFocus
        />
      </div>
      <div>
        <div style={styles.editLabel}>Value</div>
        <input
          style={styles.editInput}
          value={valueNum}
          onChange={e => setValueNum(e.target.value)}
          placeholder="20"
        />
      </div>
      <div>
        <div style={styles.editLabel}>Unit</div>
        <input
          style={styles.editInput}
          value={unit}
          onChange={e => setUnit(e.target.value)}
          placeholder="reps"
        />
      </div>
      <div>
        <div style={styles.editLabel}>By date</div>
        <input
          type="date"
          style={styles.editInput}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>
      <div>
        <div style={styles.editLabel}>Priority</div>
        <select
          style={styles.editInput}
          value={prio}
          onChange={e => setPrio(Number(e.target.value))}
        >
          <option value={1}>P1</option>
          <option value={2}>P2</option>
          <option value={3}>P3</option>
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'end' }}>
        <button
          style={{ ...styles.saveBtn, opacity: canSave ? 1 : 0.5 }}
          onClick={handleSave}
          disabled={!canSave}
        >Save</button>
        {onDelete && initial && (
          <button
            style={{ ...styles.cancelBtn, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
            onClick={onDelete}
          >Delete</button>
        )}
        <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RACE MODAL — add / edit a single race
// ═══════════════════════════════════════════════════════════════════════════

function RaceModal({ race, onClose, onSave, onDelete }) {
  const [name, setName]   = useState(race?.name || '');
  const [date, setDate]   = useState(race?.date || '');
  const [city, setCity]   = useState(race?.city || '');
  const [type, setType]   = useState(race?.type || 'other');
  const [dist, setDist]   = useState(race?.distanceMi != null ? String(race.distanceMi) : '');
  const [prio, setPrio]   = useState(race?.priority || 'A');
  const [goal, setGoal]   = useState(race?.goalTimeSecs != null ? fmtSecs(race.goalTimeSecs) : '');

  const canSave = name.trim() && date;

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      id: race?.id || `race-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      date,
      city: city.trim() || null,
      type,
      distanceMi:   dist === '' ? null : Number(dist),
      priority:     prio.toUpperCase(),
      goalTimeSecs: parseSecs(goal),
    });
    onClose();
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-elevated)', borderRadius: 8,
        border: '0.5px solid var(--border-default)',
        padding: 16, width: '100%', maxWidth: 420,
        boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            {race ? 'Edit race' : 'Add race'}
          </div>
          <button
            onClick={onClose}
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: '0 4px' }}
          >×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={styles.editLabel}>Name</div>
            <input style={styles.editInput} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Hyrox NY" autoFocus />
          </div>
          <div>
            <div style={styles.editLabel}>Date</div>
            <input type="date" style={styles.editInput} value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <div style={styles.editLabel}>Priority</div>
            <select style={styles.editInput} value={prio} onChange={e => setPrio(e.target.value)}>
              <option value="A">A — focused peak</option>
              <option value="B">B — key tune-up</option>
              <option value="C">C — training race</option>
            </select>
          </div>
          <div>
            <div style={styles.editLabel}>Type</div>
            <select style={styles.editInput} value={type} onChange={e => setType(e.target.value)}>
              <option value="hyrox">Hyrox</option>
              <option value="5K">5K</option>
              <option value="10K">10K</option>
              <option value="half">Half marathon</option>
              <option value="marathon">Marathon</option>
              <option value="ultra">Ultra</option>
              <option value="tri">Triathlon</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <div style={styles.editLabel}>City (optional)</div>
            <input style={styles.editInput} value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. New York" />
          </div>
          <div>
            <div style={styles.editLabel}>Distance (mi, optional)</div>
            <input style={styles.editInput} value={dist} onChange={e => setDist(e.target.value)} placeholder="e.g. 13.1" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={styles.editLabel}>Goal time (M:SS or H:MM:SS, optional)</div>
            <input style={styles.editInput} value={goal} onChange={e => setGoal(e.target.value)} placeholder="e.g. 75:00" />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
          {race && onDelete ? (
            <button
              onClick={() => { onDelete(race.id); onClose(); }}
              style={{ ...styles.cancelBtn, color: '#f87171', borderColor: 'rgba(248,113,113,0.4)' }}
            >Delete</button>
          ) : <span/>}
          <div>
            <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button
              style={{ ...styles.saveBtn, marginLeft: 6, opacity: canSave ? 1 : 0.5 }}
              onClick={handleSave}
              disabled={!canSave}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAN HERO RAIL — Phase 4r.dataspine.8 (matches EdgeIQ rail aesthetic)
// ═══════════════════════════════════════════════════════════════════════════
//
// Compact rail at the top of the Plan tab. Mirrors the EdgeIQ hero rail
// pattern: RailColumns grouped by bracket headers, vertical dividers,
// MiniStat tiles inside (8px label / 15px value / 8px sub). Same visual
// language so the user feels they're in one cockpit, not switching apps.
//
// Five bracket groups:
//   BODY        — weight, bodyFat
//   RECOVERY    — sleep, HRV, RHR
//   PERFORMANCE — endurance, strength, composite (top P1 per family)
//   RACES       — next race, countdown
//   CALIBRATION — drift, status
//
// Each tile carries a value + sub-text (typically a target date countdown
// or a category label). Empty slots render '—' so the grid stays aligned.

function PlanRailMiniStat({ label, value, sub, color = 'var(--text-primary)' }) {
  const isEmpty = value == null || value === '';
  return (
    <div style={{
      display: 'grid',
      gridTemplateRows: '12px 22px 12px',
      rowGap: 1,
      minWidth: 58,
      flex: '1 1 0',
      alignContent: 'start',
      // Empty slots get a muted opacity so they recede visually and
      // don't compete with active goals for the user's attention.
      opacity: isEmpty ? 0.45 : 1,
    }}>
      <div style={{
        fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.08em', whiteSpace: 'nowrap',
        overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</div>
      <div style={{
        // Phase 4r.dataspine.10 — empty slots show "+ set" (smaller,
        // italic, muted) instead of the cold "—". Makes the slot read
        // as an invitation to act rather than missing data.
        fontSize: isEmpty ? 10 : 15,
        fontWeight: isEmpty ? 400 : 600,
        fontStyle: isEmpty ? 'italic' : 'normal',
        color: isEmpty ? 'var(--text-muted)' : color,
        lineHeight: 1.05,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        display: 'flex', alignItems: 'center',
        fontFamily: isEmpty ? 'var(--font-ui)' : 'var(--font-mono)',
      }}>
        {isEmpty ? '+ set' : value}
      </div>
      <div style={{
        fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.2,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{sub || ''}</div>
    </div>
  );
}

function PlanRailColumn({ bracket, color, children, flexWeight = 1 }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0,
      flex: `${flexWeight} 1 0`,
    }}>
      <div style={{
        height: 14,
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 7, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: bracket ? color : 'transparent',
        marginBottom: 4,
      }}>
        {bracket ? (
          <>
            <div style={{ flex: 1, height: 1, background: `${color}55` }}/>
            <span style={{ whiteSpace: 'nowrap' }}>{bracket}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }}/>
          </>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 'clamp(6px,0.7vw,10px)', alignItems: 'flex-start' }}>
        {children}
      </div>
    </div>
  );
}

function PlanRailSep() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)', flexShrink: 0, marginTop: 18 }}/>;
}

function PlanHeroRail({ goalsV2 }) {
  // ── Pick top priority per family ──
  const topOf = (entries) => {
    const cands = entries.filter(([_, v]) => v).map(([k, v]) => ({ kind: k, ...v }));
    if (!cands.length) return null;
    return cands.sort((a, b) => (a.priority || 3) - (b.priority || 3))[0];
  };
  const bWeight  = goalsV2.body.weight;
  const bBodyFat = goalsV2.body.bodyFat;
  const rSleep   = goalsV2.recovery.sleepHoursMin;
  const rHRV     = goalsV2.recovery.hrvBaseline;
  const rRHR     = goalsV2.recovery.rhrBaseline;
  const topEndurance = topOf(Object.entries(goalsV2.performance || {})
    .filter(([k, _]) => PERFORMANCE_DEFS.Endurance.some(d => d.id === k)));
  // Phase 4r.dataspine.12 — Strength now comes from customStrength array
  // (user-defined). topOf picks the highest-priority entry across all
  // user-added strength PRs.
  const topStrength = (() => {
    const cs = goalsV2.performance?.customStrength || [];
    if (!cs.length) return null;
    return [...cs].sort((a, b) => (a.priority || 3) - (b.priority || 3))[0];
  })();
  const nextRace = (() => {
    const now = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })(); // midnight, matches daysFromNow / EdgeIQ
    return (goalsV2.races || [])
      .map(r => {
        const iso = normalizeDate(r.date);
        if (!iso) return null;
        const ms = new Date(iso + 'T00:00:00').getTime();
        return { ...r, _date: iso, _days: Math.round((ms - now) / 86400000) };
      })
      .filter(r => r && r._days >= 0)
      .sort((a, b) => a._days - b._days)[0];
  })();

  // ── Calibration (live diagnostic) ──
  const cal = (() => { try { return assessCalibration({ weeks: 4 }); } catch { return null; } })();
  const rec = (() => { try { return recommendCalorieTarget(); } catch { return null; } })();
  const calStatusColor =
    cal?.status === 'aligned'    ? '#4ade80' :
    cal?.status === 'under-loss' ? '#fbbf24' :
    cal?.status === 'over-loss'  ? '#60a5fa' :
                                    'var(--text-muted)';
  const calLabel =
    cal?.status === 'aligned'    ? 'On pace' :
    cal?.status === 'under-loss' ? 'Behind'  :
    cal?.status === 'over-loss'  ? 'Ahead'   :
                                   '—';

  // ── Helpers for tile values ──
  const countdownStr = (date) => {
    const d = daysFromNow(date);
    if (d == null) return '';
    return d >= 0 ? `in ${d}d` : `${-d}d ago`;
  };
  const perfTile = (g) => {
    if (!g) return { value: '—', sub: '' };
    // Endurance goals use fixed defs
    const def = PERFORMANCE_DEFS.Endurance.find(d => d.id === g.kind);
    if (def) {
      const raw = g[def.field];
      const value = fmtSecs(raw);
      return { value, sub: g.targetDate ? countdownStr(g.targetDate) : def.label.split(' ')[0] };
    }
    // Custom strength entries have their own shape
    if (g.label) {
      const v = g.valueNum != null ? `${g.valueNum}${g.unit ? g.unit : ''}` : '—';
      return { value: v, sub: g.label.length > 14 ? g.label.slice(0, 12) + '…' : g.label };
    }
    return { value: '—', sub: '' };
  };

  return (
    <section style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: 'clamp(12px,1.2vw,16px)',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'clamp(8px,0.8vw,12px)', flexWrap: 'wrap' }}>

        {/* BODY */}
        <PlanRailColumn bracket="Body" color={SECTION_COLOR.body} flexWeight={2}>
          <PlanRailMiniStat
            label="Weight"
            value={bWeight ? `${bWeight.targetLbs}lb` : null}
            sub={bWeight?.targetDate ? countdownStr(bWeight.targetDate) : 'no target'}
            color={SECTION_COLOR.body}
          />
          <PlanRailMiniStat
            label="Body fat"
            value={bBodyFat ? `${bBodyFat.targetPct}%` : null}
            sub={bBodyFat?.targetDate ? countdownStr(bBodyFat.targetDate) : 'no target'}
            color={SECTION_COLOR.body}
          />
        </PlanRailColumn>

        <PlanRailSep/>

        {/* RECOVERY */}
        <PlanRailColumn bracket="Recovery" color={SECTION_COLOR.recovery} flexWeight={3}>
          <PlanRailMiniStat
            label="Sleep"
            value={rSleep ? `≥${rSleep.value}h` : null}
            sub="floor"
            color={SECTION_COLOR.recovery}
          />
          <PlanRailMiniStat
            label="HRV"
            value={rHRV ? `${rHRV.valueMs}ms` : null}
            sub="baseline"
            color={SECTION_COLOR.recovery}
          />
          <PlanRailMiniStat
            label="RHR"
            value={rRHR ? `${rRHR.valueBpm}bpm` : null}
            sub="baseline"
            color={SECTION_COLOR.recovery}
          />
        </PlanRailColumn>

        <PlanRailSep/>

        {/* PERFORMANCE — 2 tiles (Composite removed; race-specific goals
            like Hyrox live in the Races bracket, not duplicated here) */}
        <PlanRailColumn bracket="Performance" color={SECTION_COLOR.performance} flexWeight={2}>
          {(() => { const t = perfTile(topEndurance);  return <PlanRailMiniStat label="Endurance" value={t.value} sub={t.sub} color={SECTION_COLOR.performance}/>; })()}
          {(() => { const t = perfTile(topStrength);   return <PlanRailMiniStat label="Strength"  value={t.value} sub={t.sub} color={SECTION_COLOR.performance}/>; })()}
        </PlanRailColumn>

        <PlanRailSep/>

        {/* RACES */}
        <PlanRailColumn bracket="Races" color={SECTION_COLOR.races} flexWeight={2}>
          <PlanRailMiniStat
            label="Next"
            value={nextRace?.name ? nextRace.name.split(' ').slice(0,2).join(' ') : null}
            sub={nextRace ? `${nextRace.priority || 'A'}${nextRace._days <= 28 ? ' · auto-P1' : ''}` : 'none'}
            color={SECTION_COLOR.races}
          />
          <PlanRailMiniStat
            label="Countdown"
            value={nextRace ? `${nextRace._days}d` : null}
            sub={nextRace?.date ? new Date(normalizeDate(nextRace.date) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
            color={SECTION_COLOR.races}
          />
        </PlanRailColumn>

        <PlanRailSep/>

        {/* CALIBRATION */}
        <PlanRailColumn bracket="Calibration" color={calStatusColor} flexWeight={2}>
          <PlanRailMiniStat
            label="Status"
            value={calLabel}
            sub={cal?.driftLbs != null ? `${cal.driftLbs > 0 ? '+' : ''}${cal.driftLbs.toFixed(1)}lb drift` : ''}
            color={calStatusColor}
          />
          <PlanRailMiniStat
            label="Target ETA"
            value={rec?.projectedDate ? new Date(rec.projectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
            sub={rec?.weeksToTarget != null ? `${rec.weeksToTarget}wk` : ''}
            color={calStatusColor}
          />
        </PlanRailColumn>

      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// ─── Cut Mode badge ────────────────────────────────────────────────────────
// Shows the classifier's current verdict + a manual override dropdown so
// the user can force a state during off-season ("I'm not cutting") or when
// the auto-detection lags behind their actual plan. Sits at the top of the
// Goals tab so the user can see what Arnold thinks they're optimizing for.
function CutModeBadge({ showToast }) {
  const [cm, setCm] = useState(() => { try { return getCutMode(); } catch { return null; } });
  const [override, setOverrideState] = useState(() => getCutModeOverride() || 'auto');
  if (!cm) return null;

  // Visual treatment per state. Background_cut and maintenance are calm
  // colors; alarms (under_fueled, crash_cut, acute_cut) get warmer tones.
  const palette = {
    background_cut: { bg: 'rgba(94,234,212,0.06)',  border: 'rgba(94,234,212,0.35)',  accent: '#5eead4', label: 'Background cut' },
    stalled_cut:    { bg: 'rgba(251,191,36,0.06)',  border: 'rgba(251,191,36,0.35)',  accent: '#fbbf24', label: 'Cut stalled' },
    crash_cut:      { bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.35)', accent: '#f87171', label: 'Cut too steep' },
    acute_cut:      { bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.35)', accent: '#f87171', label: 'Acute intake drop' },
    under_fueled:   { bg: 'rgba(248,113,113,0.06)', border: 'rgba(248,113,113,0.35)', accent: '#f87171', label: 'Under-fueled' },
    surplus:        { bg: 'rgba(96,165,250,0.06)',  border: 'rgba(96,165,250,0.35)',  accent: '#60a5fa', label: 'Surplus' },
    maintenance:    { bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.35)', accent: '#94a3b8', label: 'Maintenance' },
    unknown:        { bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.35)', accent: '#94a3b8', label: 'Unknown' },
  };
  const p = palette[cm.state] || palette.unknown;

  const handleOverrideChange = (value) => {
    setCutModeOverride(value === 'auto' ? null : value);
    setOverrideState(value);
    const fresh = refreshCutMode();
    setCm(fresh);
    showToast?.(value === 'auto' ? 'Cut mode auto-detection on' : `Cut mode forced: ${value.replace('_', ' ')}`);
  };

  return (
    <div style={{
      background: p.bg,
      border: `0.5px solid ${p.border}`,
      borderLeft: `3px solid ${p.accent}`,
      borderRadius: 'var(--radius-md)',
      padding: '10px 14px',
      marginBottom: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: p.accent, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
            Cut Mode
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {p.label}
          </span>
          {cm.confidence != null && !cm.isOverride && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '1px 6px', background: 'var(--bg-elevated)', borderRadius: 8 }}>
              confidence {Math.round(cm.confidence * 100)}%
            </span>
          )}
          {cm.isOverride && (
            <span style={{ fontSize: 9, color: p.accent, padding: '1px 6px', background: 'var(--bg-elevated)', borderRadius: 8, border: `0.5px solid ${p.border}` }}>
              manual
            </span>
          )}
        </div>
        {/* Segmented control instead of <select> — much tighter and lets
            you see all four options at a glance. Active option uses the
            state-accent color so the selection reads at the same hierarchy
            as the rest of the badge. */}
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }} title="Force a cut-mode state, or leave on Auto for classifier-driven detection.">
          {[
            { value: 'auto',            label: 'Auto'    },
            { value: 'background_cut',  label: 'Cut'     },
            { value: 'maintenance',     label: 'Maint'   },
            { value: 'surplus',         label: 'Surplus' },
          ].map(opt => {
            const active = override === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleOverrideChange(opt.value)}
                style={{
                  fontSize: 9.5,
                  padding: '3px 8px',
                  background: active ? `${p.accent}1f` : 'var(--bg-elevated)',
                  color: active ? p.accent : 'var(--text-secondary)',
                  border: `0.5px solid ${active ? p.border : 'var(--border-default)'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 500,
                  letterSpacing: '0.02em',
                  transition: 'all 0.12s ease',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
      {cm.reasoning && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: cm.recommendation ? 6 : 0 }}>
          {cm.reasoning}
        </div>
      )}
      {cm.recommendation && (
        <div style={{ fontSize: 11, color: 'var(--text-primary)', lineHeight: 1.45, fontStyle: 'italic', opacity: 0.85 }}>
          {cm.recommendation}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TRAINING TARGETS TILE — weekly cadence (miles / sessions / hours)
// Phase 4r.goals.training — these flat goal keys (weeklyRunDistanceTarget,
// weeklyStrengthTarget, weeklyOtherSessionsTarget, weeklyTimeTargetHrs) were
// dropped from the editor when Goals moved to the v2 nested schema, leaving
// no in-app way to set them. This tile restores that. It reads/writes the
// flat keys directly via getGoals/setGoals (which coexist with v2), and
// auto-derives an annual target pro-rated for the REMAINDER of the calendar
// year so the yearly reminders stay realistic mid-year.
// ═══════════════════════════════════════════════════════════════════════════

const TRAINING_TARGET_DEFS = [
  { id: 'weeklyRunDistanceTarget',   label: 'Run distance',    unit: 'mi/wk',  annualUnit: 'mi',       fallback: 30 },
  { id: 'weeklyStrengthTarget',      label: 'Strength',        unit: '/wk',    annualUnit: 'sessions', fallback: 2  },
  { id: 'weeklyOtherSessionsTarget', label: 'Other sessions',  unit: '/wk',    annualUnit: 'sessions', fallback: 1  },
  { id: 'weeklyTimeTargetHrs',       label: 'Activity time',   unit: 'hrs/wk', annualUnit: 'hrs',      fallback: 5  },
];

// Whole weeks left in the current calendar year, counting from today.
function weeksLeftInYear(now = new Date()) {
  const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  const ms = endOfYear - now;
  return Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
}

function TrainingTargetsTile({ showToast }) {
  const [vals, setVals] = useState(() => {
    const g = (() => { try { return getGoals(); } catch { return {}; } })();
    const out = {};
    for (const d of TRAINING_TARGET_DEFS) {
      const v = parseFloat(g?.[d.id]);
      out[d.id] = Number.isFinite(v) ? v : d.fallback;
    }
    return out;
  });
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');

  const weeksLeft = weeksLeftInYear();

  const commit = (id) => {
    const num = parseFloat(draft);
    if (Number.isFinite(num) && num >= 0) {
      const next = { ...vals, [id]: num };
      setVals(next);
      try { setGoals({ [id]: num }); showToast?.('Target saved'); } catch {}
    }
    setEditingId(null);
    setDraft('');
  };

  return (
    <Tile accent="#60a5fa" title="Training targets" hint="Weekly cadence → annual pace">
      {TRAINING_TARGET_DEFS.map(def => {
        const weekly = vals[def.id];
        const annualRemaining = Math.round((weekly || 0) * weeksLeft);
        const isEditing = editingId === def.id;
        return (
          <div key={def.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--border-subtle)',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--text-primary)' }}>{def.label}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                ~{annualRemaining} {def.annualUnit} left this year
              </div>
            </div>
            {isEditing ? (
              <input
                autoFocus
                type="number"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onBlur={() => commit(def.id)}
                onKeyDown={e => { if (e.key === 'Enter') commit(def.id); if (e.key === 'Escape') { setEditingId(null); setDraft(''); } }}
                style={{
                  width: 64, textAlign: 'right', fontSize: 12,
                  background: 'var(--bg-surface)', color: 'var(--text-primary)',
                  border: '0.5px solid var(--border-default)', borderRadius: 4, padding: '2px 6px',
                }}
              />
            ) : (
              <button
                onClick={() => { setEditingId(def.id); setDraft(String(weekly ?? '')); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600, color: '#60a5fa', whiteSpace: 'nowrap',
                }}
              >
                {weekly} <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>{def.unit}</span>
              </button>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4, fontStyle: 'italic' }}>
        Annual figures are pro-rated for the {weeksLeft.toFixed(0)} weeks left in {new Date().getFullYear()} — tap a value to edit.
      </div>
    </Tile>
  );
}

export function GoalsHub({ showToast }) {
  const [goalsV2, setGoalsV2] = useState(loadGoalsV2);
  const [editingId, setEditingId] = useState(null);
  const [raceModal, setRaceModal] = useState(null);  // null | 'new' | raceId
  const [overrides, setOverridesState] = useState(() => { try { return getOverrides(); } catch { return {}; } });
  const [expanded, setExpanded] = useState(true);
  // Activities for per-race finish-time predictions (Phase 4r.race.allraces).
  const raceActivities = useMemo(() => {
    try { return getUnifiedActivities() || []; } catch { return []; }
  }, []);
  // Format predicted seconds → H:MM:SS / MM:SS.
  const fmtPredicted = (s) => {
    if (s == null || !Number.isFinite(s) || s <= 0) return null;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
                 : `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Refresh overrides whenever a save happens
  const refreshOverrides = () => {
    try { setOverridesState(getOverrides()); } catch {}
  };

  // ── Section updaters ──────────────────────────────────────────────────────
  const updateBody = (defId, value) => {
    const next = { ...goalsV2, body: { ...goalsV2.body, [defId]: value } };
    setGoalsV2(next); saveGoalsV2(next);
    showToast?.('Goal saved');
  };
  const clearBody = (defId) => updateBody(defId, null);

  const updateRecovery = (defId, value) => {
    const next = { ...goalsV2, recovery: { ...goalsV2.recovery, [defId]: value } };
    setGoalsV2(next); saveGoalsV2(next);
    showToast?.('Goal saved');
  };
  const clearRecovery = (defId) => updateRecovery(defId, null);

  const updatePerformance = (defId, value) => {
    const next = { ...goalsV2, performance: { ...goalsV2.performance, [defId]: value } };
    setGoalsV2(next); saveGoalsV2(next);
    showToast?.('Goal saved');
  };
  const clearPerformance = (defId) => updatePerformance(defId, null);

  const saveRace = (race) => {
    const idx = goalsV2.races.findIndex(r => r.id === race.id);
    const nextRaces = idx >= 0
      ? goalsV2.races.map(r => r.id === race.id ? race : r)
      : [...goalsV2.races, race];
    const next = { ...goalsV2, races: nextRaces };
    setGoalsV2(next); saveGoalsV2(next);
    showToast?.('Race saved');
  };
  const deleteRace = (id) => {
    const next = { ...goalsV2, races: goalsV2.races.filter(r => r.id !== id) };
    setGoalsV2(next); saveGoalsV2(next);
    showToast?.('Race removed');
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
    {/* Phase 4r.dataspine.7 — Always-visible hero rail showing the
        user's P1 priorities + next race countdown. Sits above the
        collapsible Goals Hub card so the answer to "what am I
        optimizing for right now?" is on screen even when the form
        is collapsed. */}
    <PlanHeroRail goalsV2={goalsV2}/>
    {/* Cut Mode badge — shows the classifier's verdict + manual override */}
    <CutModeBadge showToast={showToast}/>
    <div style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Collapsible header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }}
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.03em' }}>◉ Goals Hub</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>Set outcomes — the system derives every tangible target.</div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s ease', transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)' }}>▼</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px' }}>
          {/* Phase 4r.dataspine.12 — Scope clarified: this panel is
              currently the BODY & ENERGY calibration only (RMR / TDEE
              / weight drift). Performance + Recovery calibration come
              in Phase C when the burden catalog + multi-domain
              reasoner ship. The footer note below tells the user
              what's in scope and what's coming. */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              background: 'var(--bg-elevated)',
              border: '0.5px solid var(--border-default)',
              borderLeft: '3px solid #60a5fa',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase', color: '#60a5fa' }}>
                  Body & Energy Calibration
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  Read-only · explains the derived calorie + protein targets
                </span>
              </div>
              <NutritionCalibrationBody/>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 10, paddingTop: 8, borderTop: '0.5px dashed var(--border-subtle)', lineHeight: 1.4, fontStyle: 'italic' }}>
                Scope: weight + energy goals only. Performance calibration (training-load vs race-pace targets) and Recovery calibration (sleep + HRV vs baselines) ship in Phase C alongside the burden catalog and multi-domain reasoner.
              </div>
            </div>
          </div>

          {/* Phase 4r.dataspine.11 — Explicit two-row grid per user
              direction. Top row: Body / Recovery / Manual Pins (3 equal
              columns) — short tiles that the user reviews most often.
              Bottom row: Races / Performance (2 equal columns, both
              wider) — longer tiles that benefit from horizontal room
              and scroll internally when content exceeds the cap.
              Auto rows so each row takes only the height it needs. */}

          {/* ── Top row: 3 equal-width tiles, ALIGNED to same height ──
              Phase 4r.dataspine.12 — alignItems: stretch makes all
              three tiles match the height of the tallest (typically
              Manual Pins due to its descriptive paragraph). Looks
              clean as a uniform top band. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 10,
            marginBottom: 10,
            alignItems: 'stretch',
          }}>

          {/* ── Body tile ──────────────────────────────────────────────── */}
          <Tile accent={SECTION_COLOR.body} title="Body" hint="What you want your body to look like">
            {BODY_DEFS.map(def => (
              <GoalRow
                key={def.id}
                def={def}
                goal={goalsV2.body[def.id]}
                sectionKey="body"
                onUpdate={(v) => updateBody(def.id, v)}
                onClear={() => clearBody(def.id)}
                editingId={editingId}
                setEditingId={setEditingId}
              />
            ))}
          </Tile>

          {/* ── Recovery tile ──────────────────────────────────────────── */}
          <Tile accent={SECTION_COLOR.recovery} title="Recovery" hint="Continuous floors / baselines">
            {RECOVERY_DEFS.map(def => (
              <GoalRow
                key={def.id}
                def={def}
                goal={goalsV2.recovery[def.id]}
                sectionKey="recovery"
                onUpdate={(v) => updateRecovery(def.id, v)}
                onClear={() => clearRecovery(def.id)}
                editingId={editingId}
                setEditingId={setEditingId}
              />
            ))}
          </Tile>

          {/* ── Manual Pins tile (top row, 3rd column) ─────────────────── */}
          <OverridesTile overrides={overrides} onChange={refreshOverrides} showToast={showToast}/>

          </div>{/* end TOP row */}

          {/* ── Bottom row: 2 equal-width columns. Right column stacks
              Performance + Training targets; Races (left) stretches to
              match that combined height. Phase 4r.goals.training.2 — moved
              Training targets out of a full-width band into the right column
              under Performance per user direction. */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 10,
            alignItems: 'stretch',
          }}>

          {/* ── Races tile (bottom-left, future-only, sorted soonest-first) ── */}
          {(() => {
            const futureRaces = goalsV2.races
              .filter(r => {
                const d = daysFromNow(r.date);
                return d != null && d >= 0;
              })
              .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
            const pastCount = goalsV2.races.length - futureRaces.length;
            return (
              <Tile
                accent={SECTION_COLOR.races}
                title="Races"
                fillHeight
                hint={`${futureRaces.length} upcoming${pastCount ? ` · ${pastCount} past hidden` : ''} · ≤4wk auto-P1`}
                headerExtra={
                  <button
                    className="arnold-compact-btn"
                    style={{ ...styles.addBtn, marginTop: 0 }}
                    onClick={() => setRaceModal('new')}
                  >+ Add</button>
                }
              >
                {futureRaces.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>
                    No upcoming races. Tap + Add to enable race-prep fueling.
                  </div>
                ) : (() => {
                  // Phase 4r.race.allraces.col2 — ONE shared grid template for
                  // the header + every row so columns align exactly. Fixed
                  // widths on the right-side columns (were `auto`, which sized
                  // per-row and caused the misalignment); name flexes.
                  // Cols: name | date | predicted | days | priority | edit
                  const RACE_GRID = {
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) 92px 84px 44px 60px 40px',
                    gap: 8, alignItems: 'center',
                  };
                  const headCell = {
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  };
                  return (
                    <>
                      {/* Column headers */}
                      <div style={{ ...RACE_GRID, padding: '0 0 4px', borderBottom: '0.5px solid var(--border-default)' }}>
                        <span style={headCell}>Race</span>
                        <span style={headCell}>Date</span>
                        <span style={{ ...headCell, textAlign: 'right' }}>Predicted</span>
                        <span style={{ ...headCell, textAlign: 'right' }}>Out</span>
                        <span style={{ ...headCell, textAlign: 'center' }}>Pri</span>
                        <span/>
                      </div>
                      {futureRaces.map(r => {
                        const days = daysFromNow(r.date);
                        const autoP1 = days != null && days <= 28;
                        const pred = (() => {
                          try { return predictRaceFinish(r, raceActivities); } catch { return null; }
                        })();
                        const predStr = pred ? fmtPredicted(pred.seconds) : null;
                        return (
                          <div key={r.id} style={{ ...RACE_GRID, padding: '6px 0', borderBottom: '0.5px dashed var(--border-subtle)' }}>
                            <div style={{ ...styles.rowLabel, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.name}{r.city ? <span style={{ color: 'var(--text-muted)' }}> · {abbrevCity(r.city)}</span> : ''}
                            </div>
                            <div style={{ ...styles.rowValue, whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</div>
                            {/* Predicted finish — right-aligned, tabular for clean stacking. */}
                            <div style={{ fontSize: 11, color: predStr ? '#60a5fa' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right' }}
                                 title={predStr ? 'Predicted finish (Riegel, from your recent runs)' : (pred === null ? 'No run prediction for this race type' : '')}>
                              {predStr ? `⏱ ${predStr}` : '—'}
                            </div>
                            <div style={{ ...styles.rowDate, textAlign: 'right' }}>
                              {days != null ? `${days}d` : ''}
                            </div>
                            <span style={{ ...styles.raceChip(r.priority), justifySelf: 'center' }}>
                              {r.priority}{autoP1 ? '·auto' : ''}
                            </span>
                            <button
                              className="arnold-compact-btn"
                              style={{ ...styles.editBtn, justifySelf: 'end' }}
                              onClick={() => setRaceModal(r.id)}
                            >edit</button>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </Tile>
            );
          })()}

          {/* ── Right column: Performance + Training targets stacked ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>

          {/* ── Performance tile — Endurance (fixed) + Custom Strength PRs ── */}
          <Tile
            accent={SECTION_COLOR.performance}
            title="Performance"
            hint="Trained outcomes · tied to a race date"
          >
            {/* Endurance — canonical race distances */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>
                Endurance
              </div>
              {PERFORMANCE_DEFS.Endurance.map(def => (
                <GoalRow
                  key={def.id}
                  def={def}
                  goal={goalsV2.performance[def.id]}
                  sectionKey="performance"
                  onUpdate={(v) => updatePerformance(def.id, v)}
                  onClear={() => clearPerformance(def.id)}
                  editingId={editingId}
                  setEditingId={setEditingId}
                />
              ))}
            </div>

            {/* Strength — user-defined custom PRs */}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Strength · your PRs
                </span>
                <button
                  className="arnold-compact-btn"
                  style={{ ...styles.editBtn, padding: '2px 8px' }}
                  onClick={() => setEditingId(editingId === 'performance.customStrength.new' ? null : 'performance.customStrength.new')}
                >
                  {editingId === 'performance.customStrength.new' ? '× cancel' : '+ Add custom PR'}
                </button>
              </div>

              {/* Inline new-entry form */}
              {editingId === 'performance.customStrength.new' && (
                <CustomStrengthEditor
                  initial={null}
                  onSave={(entry) => {
                    const next = {
                      ...goalsV2,
                      performance: {
                        ...goalsV2.performance,
                        customStrength: [...(goalsV2.performance.customStrength || []), entry],
                      },
                    };
                    setGoalsV2(next); saveGoalsV2(next);
                    setEditingId(null);
                    showToast?.('Strength PR added');
                  }}
                  onCancel={() => setEditingId(null)}
                />
              )}

              {(goalsV2.performance.customStrength || []).length === 0 && editingId !== 'performance.customStrength.new' ? (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '6px 0', fontStyle: 'italic', lineHeight: 1.4 }}>
                  No strength PRs yet. Define your own — pull-ups, sled push, kettlebell swings, anything you train and want to track.
                </div>
              ) : (
                (goalsV2.performance.customStrength || []).map((s) => {
                  const rowKey = `performance.customStrength.${s.id}`;
                  const isEditing = editingId === rowKey;
                  if (isEditing) {
                    return (
                      <CustomStrengthEditor
                        key={s.id}
                        initial={s}
                        onSave={(entry) => {
                          const next = {
                            ...goalsV2,
                            performance: {
                              ...goalsV2.performance,
                              customStrength: (goalsV2.performance.customStrength || []).map(x => x.id === s.id ? entry : x),
                            },
                          };
                          setGoalsV2(next); saveGoalsV2(next);
                          setEditingId(null);
                          showToast?.('Strength PR updated');
                        }}
                        onCancel={() => setEditingId(null)}
                        onDelete={() => {
                          const next = {
                            ...goalsV2,
                            performance: {
                              ...goalsV2.performance,
                              customStrength: (goalsV2.performance.customStrength || []).filter(x => x.id !== s.id),
                            },
                          };
                          setGoalsV2(next); saveGoalsV2(next);
                          setEditingId(null);
                          showToast?.('Strength PR removed');
                        }}
                      />
                    );
                  }
                  return (
                    <div key={s.id} style={styles.row}>
                      <div style={styles.rowLabel}>{s.label}</div>
                      <div style={styles.rowValue}>{s.valueNum != null ? `${s.valueNum} ${s.unit || ''}`.trim() : '—'}</div>
                      <div style={styles.rowDate}>{s.targetDate ? fmtDate(s.targetDate) : ''}</div>
                      {s.priority ? <span style={styles.priorityChip(s.priority)}>{PRIORITY_LABEL[s.priority]}</span> : <span/>}
                      <button
                        className="arnold-compact-btn"
                        style={styles.editBtn}
                        onClick={() => setEditingId(rowKey)}
                      >edit</button>
                    </div>
                  );
                })
              )}
            </div>
          </Tile>

          {/* ── Training targets — weekly cadence + auto annual pace, under
              Performance per user direction (Phase 4r.goals.training.2). ── */}
          <TrainingTargetsTile showToast={showToast}/>

          </div>{/* end right column */}

          </div>{/* end BOTTOM row */}
        </div>
      )}

      {/* ── Race modal ─────────────────────────────────────────────────────── */}
      {raceModal && (
        <RaceModal
          race={raceModal === 'new' ? null : goalsV2.races.find(r => r.id === raceModal)}
          onClose={() => setRaceModal(null)}
          onSave={saveRace}
          onDelete={deleteRace}
        />
      )}
    </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED OVERRIDES PANEL — show pinned values + clear
// ═══════════════════════════════════════════════════════════════════════════

function OverridesTile({ overrides, onChange, showToast }) {
  const derived = useMemo(() => {
    try { return getEffectiveTargets(); } catch { return null; }
  }, [overrides]);

  const handleClear = (key) => {
    try {
      clearOverride(key);
      showToast?.('Override cleared');
      onChange?.();
    } catch (e) { showToast?.('Clear failed: ' + (e?.message || e)); }
  };
  const handlePin = (key, valueStr) => {
    const v = parseFloat(valueStr);
    if (!Number.isFinite(v)) return;
    try {
      setOverride(key, v);
      showToast?.('Override pinned');
      onChange?.();
    } catch (e) { showToast?.('Pin failed: ' + (e?.message || e)); }
  };

  const calDerived = derived?.dailyCalories?.derived;
  const proDerived = derived?.dailyProtein?.derived;
  const calOv = overrides?.dailyCalories;
  const proOv = overrides?.dailyProtein;
  const pinCount = (calOv ? 1 : 0) + (proOv ? 1 : 0);

  return (
    <Tile
      accent={SECTION_COLOR.overrides}
      title="Manual pins"
      hint={pinCount > 0 ? `${pinCount} pinned · these win over derived targets` : 'Skip unless you want to override a derived target'}
    >
      <OverrideRow
        label="Daily calorie target"
        unit="kcal"
        derived={calDerived}
        override={calOv}
        onPin={(v) => handlePin('dailyCalories', v)}
        onClear={() => handleClear('dailyCalories')}
      />
      <OverrideRow
        label="Daily protein target"
        unit="g"
        derived={proDerived}
        override={proOv}
        onPin={(v) => handlePin('dailyProtein', v)}
        onClear={() => handleClear('dailyProtein')}
      />
      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
        Most users never touch this. The system derives a daily calorie + protein target from your outcome goals + recovery + race calendar. Pin a value here only if you want to override the math for a stretch of days (e.g. a travel week). Derived shadow stays visible so you can compare.
      </div>
    </Tile>
  );
}

function OverrideRow({ label, unit, derived, override, onPin, onClear }) {
  const [drVal, setDrVal] = useState('');
  return (
    <div style={{ ...styles.row, borderBottom: '0.5px dashed var(--border-subtle)' }}>
      <div style={styles.rowLabel}>{label}</div>
      <div style={styles.rowValue}>
        {override
          ? <><span style={{ color: '#fbbf24' }}>pinned {override.value}{unit}</span> <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(derived: {derived ?? '—'})</span></>
          : <>{derived ?? '—'} {unit} <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>(derived)</span></>
        }
      </div>
      <input
        style={{ ...styles.editInput, maxWidth: 80 }}
        value={drVal}
        onChange={e => setDrVal(e.target.value)}
        placeholder={String(derived ?? '')}
      />
      <button
        style={styles.saveBtn}
        onClick={() => { onPin(drVal); setDrVal(''); }}
      >Pin</button>
      {override
        ? <button style={styles.cancelBtn} onClick={onClear}>Clear</button>
        : <span/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// NUTRITION CALIBRATION PANEL — preserved diagnostic
// ═══════════════════════════════════════════════════════════════════════════
//
// Live, deterministic readout of energy balance state — sourced from
// energyBalance.js. Shows the user actual RMR (Katch-McArdle from LBM),
// model TDEE, empirical TDEE (back-calculated from observed weight change),
// recommended cut/maintain targets with RMR floor enforcement, and
// calibration drift diagnostics. This is the "explain why" surface for
// the calorie target — kept verbatim from the previous GoalsHub.

function NutritionCalibrationBody() {
  const ctx = useMemo(() => {
    try {
      return {
        comp: getCurrentBodyComp(),
        rmrR: computeRMR(),
        tdeeModel: computeTDEE(),
        emp: empiricalTDEE(),
        cal: assessCalibration({ weeks: 4 }),
        rec: recommendCalorieTarget(),
      };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  }, []);

  if (ctx.error) {
    return (
      <div style={{ fontSize: 11, color: '#f87171' }}>
        Calibration unavailable: {ctx.error}
      </div>
    );
  }

  const { rmrR, tdeeModel, emp, cal, rec } = ctx;

  const statusColor =
    cal.status === 'aligned'    ? '#4ade80' :
    cal.status === 'under-loss' ? '#fbbf24' :
    cal.status === 'over-loss'  ? '#60a5fa' :
                                  'var(--text-muted)';
  const statusLabel =
    cal.status === 'aligned'    ? 'On pace' :
    cal.status === 'under-loss' ? 'Behind'  :
    cal.status === 'over-loss'  ? 'Ahead'   :
                                  '—';

  // Phase 4r.dataspine.11 — restructured into 3 vertical column groups
  // (TDEE / Targets / 4-Week) so the numbers read as organized sets
  // instead of scattered rows across mixed-column grids. Each column
  // has a small uppercase header and 3 stat rows beneath, all aligned.
  // Path-to-target callout and warnings sit below as full-width strips.

  const colHeader = {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.10em',
    color: 'var(--text-muted)', textTransform: 'uppercase',
    marginBottom: 8, paddingBottom: 4,
    borderBottom: '0.5px solid var(--border-subtle)',
  };
  const statRow = {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    gap: 8, marginBottom: 6, fontSize: 11,
  };
  const statLabel = { color: 'var(--text-secondary)', whiteSpace: 'nowrap' };
  const statValue = {
    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
    fontWeight: 500, whiteSpace: 'nowrap',
  };
  const statUnit = { color: 'var(--text-muted)', fontSize: 9, marginLeft: 3, fontWeight: 400 };

  const driftColor = cal.driftLbs != null && Math.abs(cal.driftLbs) > 1 ? statusColor : 'var(--text-primary)';

  return (
    <>
      {/* Three column groups, equal width, aligned */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 18 }}>

        {/* ── TDEE BREAKDOWN ── */}
        <div>
          <div style={colHeader}>TDEE breakdown</div>
          <div style={statRow}>
            <span style={statLabel}>RMR ({rmrR.formula.split('-')[0]})</span>
            <span style={statValue}>{rmrR.rmr}<span style={statUnit}>kcal</span></span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Model TDEE</span>
            <span style={statValue}>{tdeeModel?.tdee || '—'}<span style={statUnit}>kcal</span></span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Empirical TDEE</span>
            <span style={statValue}>{emp.empiricalTDEE || '—'}<span style={statUnit}>kcal · {emp.confidence}</span></span>
          </div>
        </div>

        {/* ── TARGETS ── */}
        <div>
          <div style={colHeader}>Targets</div>
          <div style={statRow}>
            <span style={statLabel}>Cut target</span>
            <span style={statValue}>{rec.cutTarget}<span style={statUnit}>kcal</span></span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Maintenance</span>
            <span style={statValue}>{rec.maintenanceTarget}<span style={statUnit}>kcal</span></span>
          </div>
          <div style={statRow}>
            <span style={statLabel}>Loss rate</span>
            <span style={statValue}>{rec.lossRatePerWeek}<span style={statUnit}>lb/wk</span></span>
          </div>
          {rec.cutTarget === rec.floorRmr && (
            <div style={{ fontSize: 9, color: '#fbbf24', marginTop: 2 }}>⚠ Hit RMR floor</div>
          )}
        </div>

        {/* ── 4-WEEK CALIBRATION ── */}
        <div>
          <div style={{ ...colHeader, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span>4-week pace</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: statusColor, padding: '1px 6px', borderRadius: 4, background: `${statusColor}1a`, letterSpacing: '0.04em' }}>
              {statusLabel}
            </span>
          </div>
          {cal.actualLossLbs != null ? (
            <>
              <div style={statRow}>
                <span style={statLabel}>Predicted</span>
                <span style={statValue}>{cal.predictedLossLbs > 0 ? '−' : '+'}{Math.abs(cal.predictedLossLbs).toFixed(1)}<span style={statUnit}>lb</span></span>
              </div>
              <div style={statRow}>
                <span style={statLabel}>Actual</span>
                <span style={statValue}>{cal.actualLossLbs > 0 ? '−' : '+'}{Math.abs(cal.actualLossLbs).toFixed(1)}<span style={statUnit}>lb</span></span>
              </div>
              <div style={statRow}>
                <span style={statLabel}>Drift</span>
                <span style={{ ...statValue, color: driftColor }}>
                  {cal.driftLbs > 0 ? '+' : ''}{cal.driftLbs.toFixed(1)}<span style={statUnit}>lb</span>
                </span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Insufficient weight history</div>
          )}
        </div>
      </div>

      {/* ── Path-to-target callout (full width) ── */}
      {rec.lbsToLose > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(74,222,128,0.05)', borderLeft: '3px solid #4ade80', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            <strong style={{ color: '#4ade80' }}>Path to target:</strong> {rec.lbsToLose} lb to {rec.targetWeight} lb · ~{rec.weeksToTarget} weeks at {rec.lossRatePerWeek} lb/wk · steady at {rec.maintenanceTarget} kcal post-cut.
          </div>
        </div>
      )}

      {/* ── Warnings (full width, stacked) ── */}
      {rec.warnings?.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rec.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.4 }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </>
  );
}
