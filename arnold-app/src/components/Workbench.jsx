// ─── Workbench — custom workout builder ──────────────────────────────────────
// Phase 4r.workbench.1
//
// Lives in the Plan tab. List on the left, editor on the right (stacks on
// narrow screens). Each workout has segments → steps. Export button writes a
// .FIT file users can import to Garmin Connect → syncs to watch.
//
// Multi-week run plans are out of scope for this pass; we land single
// workouts first and the data model supports references from the planner.

import { useState, useEffect, useMemo } from "react";
import {
  getWorkouts, saveWorkout, deleteWorkout, emptyWorkout, emptyStep,
  newId, downloadWorkoutFit, estimateDurationSec, planTypeForWorkout,
  SPORT_OPTIONS, TARGET_TYPES, INTENSITY_OPTIONS,
  HYROX_PRACTICE_PRESET, workoutFromTemplate,
} from "../core/workbench.js";
import {
  weekKey, getPlannerWeek, savePlannerWeek, DAY_LABELS,
} from "../core/planner.js";
import { formatPace, parsePace } from "../core/runTemplates.js";
import { ExercisePicker } from "./workbench/ExercisePicker.jsx";
import { SetGroupBuilder } from "./workbench/SetGroupBuilder.jsx";
import { IntervalPicker } from "./workbench/IntervalPicker.jsx";

const FAMILY_COLORS = {
  warmup:   '#5eead4',
  main:     '#fbbf24',
  cooldown: '#a78bfa',
};

const fmtSec = (s) => {
  if (!s) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const fmtStepTarget = (step) => {
  if (step.target === 'time')     return `${fmtSec(step.value)} time`;
  if (step.target === 'distance') return `${step.value} m`;
  if (step.target === 'reps')     return `${step.value} ${step.kind === 'exercise' ? 'reps' : 'steps'}`;
  if (step.target === 'open')     return 'open · lap-press';
  return '—';
};

export function Workbench({ showToast }) {
  const [workouts, setWorkouts] = useState(() => getWorkouts());
  const [selectedId, setSelectedId] = useState(workouts[0]?.id || null);
  const selected = useMemo(() => workouts.find(w => w.id === selectedId) || null, [workouts, selectedId]);
  const [exporting, setExporting] = useState(false);
  // Phase 4r.dataspine.7 — Workbench is now collapsible like GoalsHub,
  // so the Plan tab can default to "see priorities + targets" and the
  // user expands the workout builder when they want it. Defaults to
  // collapsed since most Plan-tab visits are for goal review, not
  // workout authoring.
  const [expanded, setExpanded] = useState(false);

  // Persist any in-memory edits when selected changes.
  const updateSelected = (patch) => {
    if (!selected) return;
    const updated = { ...selected, ...patch };
    const next = workouts.map(w => w.id === selected.id ? updated : w);
    setWorkouts(next);
    saveWorkout(updated);
  };

  const updateSegment = (segIdx, patch) => {
    if (!selected) return;
    const newSegs = selected.segments.map((s, i) => i === segIdx ? { ...s, ...patch } : s);
    updateSelected({ segments: newSegs });
  };

  const updateStep = (segIdx, stepIdx, patch) => {
    if (!selected) return;
    const newSegs = selected.segments.map((s, i) => {
      if (i !== segIdx) return s;
      const newSteps = s.steps.map((st, j) => j === stepIdx ? { ...st, ...patch } : st);
      return { ...s, steps: newSteps };
    });
    updateSelected({ segments: newSegs });
  };

  const addStep = (segIdx, kind = 'run') => {
    if (!selected) return;
    const newSegs = selected.segments.map((s, i) => {
      if (i !== segIdx) return s;
      return { ...s, steps: [...s.steps, emptyStep(kind)] };
    });
    updateSelected({ segments: newSegs });
  };

  // Bulk-append (for SetGroupBuilder + ExercisePicker → many-at-once).
  const addSteps = (segIdx, steps) => {
    if (!selected || !steps?.length) return;
    const newSegs = selected.segments.map((s, i) => {
      if (i !== segIdx) return s;
      return { ...s, steps: [...s.steps, ...steps] };
    });
    updateSelected({ segments: newSegs });
  };

  const removeStep = (segIdx, stepIdx) => {
    if (!selected) return;
    const newSegs = selected.segments.map((s, i) => {
      if (i !== segIdx) return s;
      return { ...s, steps: s.steps.filter((_, j) => j !== stepIdx) };
    });
    updateSelected({ segments: newSegs });
  };

  const moveStep = (segIdx, stepIdx, direction) => {
    if (!selected) return;
    const newSegs = selected.segments.map((s, i) => {
      if (i !== segIdx) return s;
      const newSteps = [...s.steps];
      const j = stepIdx + direction;
      if (j < 0 || j >= newSteps.length) return s;
      [newSteps[stepIdx], newSteps[j]] = [newSteps[j], newSteps[stepIdx]];
      return { ...s, steps: newSteps };
    });
    updateSelected({ segments: newSegs });
  };

  const createNew = () => {
    const w = emptyWorkout('New workout');
    setWorkouts([...workouts, w]);
    saveWorkout(w);
    setSelectedId(w.id);
  };

  const cloneHyrox = () => {
    const w = { ...HYROX_PRACTICE_PRESET, id: newId(), name: HYROX_PRACTICE_PRESET.name + ' (copy)' };
    setWorkouts([...workouts, w]);
    saveWorkout(w);
    setSelectedId(w.id);
    showToast?.('HYROX preset copied to your workouts');
  };

  // Overwrite the currently selected workout with a fresh copy of the
  // HYROX preset (preserve id so any planner references still resolve).
  // Useful when the in-code preset gets updated (e.g. new step splits)
  // but the user's saved copy is the old version.
  const resetToHyroxPreset = () => {
    if (!selected) return;
    if (!confirm('Replace this workout with the latest HYROX preset?\n\nAny manual edits to steps will be lost.')) return;
    const fresh = { ...HYROX_PRACTICE_PRESET, id: selected.id, name: selected.name };
    const next = workouts.map(w => w.id === selected.id ? fresh : w);
    setWorkouts(next);
    saveWorkout(fresh);
    showToast?.(`Reset "${selected.name}" to latest HYROX preset`);
  };

  // Show "Reset to preset" only when the selected workout looks like a
  // HYROX-derived workout (heuristic on id or name).
  const isHyroxWorkout = selected && (
    selected.id === HYROX_PRACTICE_PRESET.id ||
    /hyrox/i.test(selected.name || '')
  );

  const del = (id) => {
    if (!confirm('Delete this workout?')) return;
    deleteWorkout(id);
    const next = workouts.filter(w => w.id !== id);
    setWorkouts(next);
    if (selectedId === id) setSelectedId(next[0]?.id || null);
  };

  const onExport = async () => {
    if (!selected) return;
    setExporting(true);
    try {
      await downloadWorkoutFit(selected);
      showToast?.(`Downloaded ${selected.name}.fit — import in Garmin Connect web`);
    } catch (e) {
      showToast?.(`Export failed: ${e.message}`);
      console.error('FIT export error:', e);
    } finally {
      setExporting(false);
    }
  };

  // Interval-template picker (creates a brand-new workout from a template).
  const [intervalOpen, setIntervalOpen] = useState(false);
  const buildFromTemplate = (template, params) => {
    const w = workoutFromTemplate(template, params);
    setWorkouts([...workouts, w]);
    saveWorkout(w);
    setSelectedId(w.id);
    showToast?.(`Built "${w.name}" — review the steps and export`);
  };

  // Apply this workout to a planner day (this week or next week).
  const [applyOpen, setApplyOpen] = useState(false);
  const applyToDay = (dayIdx, weekKeyVal) => {
    if (!selected) return;
    const wk = getPlannerWeek(weekKeyVal);
    const newDays = [...(wk.days || Array(7).fill({ type: 'rest' }))];
    while (newDays.length < 7) newDays.push({ type: 'rest' });
    newDays[dayIdx] = {
      type: planTypeForWorkout(selected),
      durationMin: Math.round(estimateDurationSec(selected) / 60),
      notes: selected.name,
      workoutRef: { id: selected.id, name: selected.name },
    };
    savePlannerWeek(weekKeyVal, { ...wk, days: newDays });
    showToast?.(`Applied "${selected.name}" to ${DAY_LABELS[dayIdx]}`);
    setApplyOpen(false);
  };

  const totalSec = selected ? estimateDurationSec(selected) : 0;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderLeft: '2px solid #fbbf24',
      borderRadius: 'var(--radius-md)',
      padding: expanded ? '10px 14px' : '8px 14px',
      marginBottom: 10,
    }}>
      {/* Phase 4r.dataspine.7 — collapsible header. Click anywhere on
          the title row to toggle. Workout count + duration shown in the
          header so the user can see at-a-glance whether they have anything
          to expand to. */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: expanded ? 10 : 0, flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>⚒ Workbench</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {workouts.length} workout{workouts.length === 1 ? '' : 's'} · Build custom workouts · export to .fit
        </span>
        <span style={{ flex: 1 }}/>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s ease', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </div>

      {!expanded ? null : (
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12 }}>
        {/* ── LEFT: workout list ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {workouts.map(w => (
            <button key={w.id}
              onClick={() => setSelectedId(w.id)}
              style={{
                all: 'unset', cursor: 'pointer',
                padding: '6px 8px', borderRadius: 4,
                background: w.id === selectedId ? 'rgba(251,191,36,0.10)' : 'transparent',
                border: `0.5px solid ${w.id === selectedId ? 'rgba(251,191,36,0.4)' : 'var(--border-subtle)'}`,
                fontSize: 11, color: 'var(--text-primary)',
              }}>
              <div style={{ fontWeight: 500 }}>{w.name}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
                {w.sport} · {(w.segments || []).reduce((s, seg) => s + seg.steps.length, 0)} steps
              </div>
            </button>
          ))}
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <button onClick={createNew} style={btnStyle}>+ New</button>
            <button onClick={cloneHyrox} style={btnStyle}>+ HYROX</button>
            <button onClick={() => setIntervalOpen(v => !v)}
              style={{ ...btnStyle, background: 'rgba(94,234,212,0.10)', color: '#5eead4', borderColor: 'rgba(94,234,212,0.3)' }}>
              + Run template
            </button>
          </div>
          {intervalOpen && (
            <IntervalPicker onCreate={buildFromTemplate} onClose={() => setIntervalOpen(false)}/>
          )}
        </div>

        {/* ── RIGHT: editor for selected workout ── */}
        {!selected ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 12 }}>
            Pick a workout from the left, or hit <strong>+ New</strong>.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
            {/* Header — name, sport, totals, actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input type="text" value={selected.name}
                onChange={(e) => updateSelected({ name: e.target.value })}
                style={{
                  flex: 1, minWidth: 180,
                  fontSize: 13, fontWeight: 500,
                  background: 'var(--bg-input)', color: 'var(--text-primary)',
                  border: '0.5px solid var(--border-default)', borderRadius: 4,
                  padding: '4px 8px',
                }}/>
              <select value={selected.sport}
                onChange={(e) => updateSelected({ sport: e.target.value })}
                style={selectStyle}>
                {SPORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                ~{fmtSec(totalSec)} · {(selected.segments || []).reduce((s, seg) => s + seg.steps.length, 0)} steps
              </span>
              <button onClick={() => setApplyOpen(v => !v)} style={btnStyle}>Apply →</button>
              <button onClick={onExport} disabled={exporting} style={{ ...btnStyle, background: 'rgba(251,191,36,0.18)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)' }}>
                {exporting ? 'Exporting…' : '⬇ Export .fit'}
              </button>
              {isHyroxWorkout && (
                <button onClick={resetToHyroxPreset} style={{ ...btnStyle, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' }} title="Replace with latest in-code HYROX preset">
                  ⟲ Reset preset
                </button>
              )}
              <button onClick={() => del(selected.id)} style={{ ...btnStyle, color: '#f87171' }}>Delete</button>
            </div>

            {/* Apply-to-planner popover */}
            {applyOpen && (
              <ApplyPopover onPick={applyToDay} onClose={() => setApplyOpen(false)}/>
            )}

            {/* Notes */}
            <textarea value={selected.notes || ''}
              onChange={(e) => updateSelected({ notes: e.target.value })}
              placeholder="Notes — what this workout targets, when to use it, etc."
              style={{
                width: '100%', minHeight: 36, resize: 'vertical',
                fontSize: 10, padding: '5px 8px', lineHeight: 1.4,
                background: 'var(--bg-input)', color: 'var(--text-primary)',
                border: '0.5px solid var(--border-default)', borderRadius: 4,
                boxSizing: 'border-box', outline: 'none',
                fontFamily: 'var(--font-sans)',
              }}/>

            {/* Segments */}
            {(selected.segments || []).map((seg, segIdx) => (
              <SegmentEditor key={segIdx}
                seg={seg} segIdx={segIdx}
                onChangeSeg={(patch) => updateSegment(segIdx, patch)}
                onChangeStep={(stepIdx, patch) => updateStep(segIdx, stepIdx, patch)}
                onAddStep={(kind) => addStep(segIdx, kind)}
                onAddSteps={(steps) => addSteps(segIdx, steps)}
                onRemoveStep={(stepIdx) => removeStep(segIdx, stepIdx)}
                onMoveStep={(stepIdx, dir) => moveStep(segIdx, stepIdx, dir)}
              />
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Segment + step editor ────────────────────────────────────────────────────

function SegmentEditor({ seg, segIdx, onChangeSeg, onChangeStep, onAddStep, onAddSteps, onRemoveStep, onMoveStep }) {
  const color = FAMILY_COLORS[seg.type] || '#94a3b8';
  const [pickerOpen, setPickerOpen]    = useState(false);
  const [setBuilderOpen, setSetBuilderOpen] = useState(false);

  return (
    <div style={{
      border: `0.5px solid ${color}33`,
      background: `${color}06`,
      borderRadius: 6, padding: '8px 10px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {seg.type}
        </span>
        <input type="text" value={seg.name || ''}
          onChange={(e) => onChangeSeg({ name: e.target.value })}
          style={{
            flex: 1, minWidth: 100,
            fontSize: 11, padding: '3px 6px',
            background: 'var(--bg-input)', color: 'var(--text-primary)',
            border: '0.5px solid var(--border-default)', borderRadius: 4,
          }}/>
      </div>

      {/* Step rows */}
      {(seg.steps || []).map((step, i) => (
        <StepRow key={i} step={step} idx={i}
          isFirst={i === 0} isLast={i === seg.steps.length - 1}
          onChange={(patch) => onChangeStep(i, patch)}
          onRemove={() => onRemoveStep(i)}
          onMove={(dir) => onMoveStep(i, dir)}
        />
      ))}

      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
        <button onClick={() => onAddStep('run')} style={btnStyle}>+ run</button>
        <button onClick={() => onAddStep('exercise')} style={btnStyle}>+ exercise</button>
        <button onClick={() => { setPickerOpen(v => !v); setSetBuilderOpen(false); }}
          style={{ ...btnStyle, color: '#fbbf24', borderColor: 'rgba(251,191,36,0.3)' }}>
          + pick exercise
        </button>
        <button onClick={() => { setSetBuilderOpen(v => !v); setPickerOpen(false); }}
          style={{ ...btnStyle, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)' }}>
          + set group (N×reps)
        </button>
      </div>

      {pickerOpen && (
        <ExercisePicker
          onPick={(step) => onAddSteps([step])}
          onClose={() => setPickerOpen(false)}/>
      )}
      {setBuilderOpen && (
        <SetGroupBuilder
          onAddSteps={(steps) => onAddSteps(steps)}
          onClose={() => setSetBuilderOpen(false)}/>
      )}
    </div>
  );
}

function StepRow({ step, idx, isFirst, isLast, onChange, onRemove, onMove }) {
  const [expanded, setExpanded] = useState(false);
  const hasExtras = step.weightLb != null || step.paceLowSecPerMi != null || step.hrLowBpm != null;

  return (
    <div style={{ borderTop: idx === 0 ? 'none' : '0.5px solid var(--border-subtle)', paddingTop: idx === 0 ? 0 : 2 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '20px 70px 1fr 130px 90px 24px auto',
        gap: 6, alignItems: 'center', padding: '3px 0',
        fontSize: 11,
      }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{idx + 1}.</span>
        <select value={step.kind}
          onChange={(e) => onChange({ kind: e.target.value })}
          style={selectStyle}>
          <option value="run">Run</option>
          <option value="exercise">Exercise</option>
          <option value="rest">Rest</option>
        </select>
        {step.kind === 'exercise' ? (
          <input type="text" value={step.exerciseName || ''} placeholder="Exercise name"
            onChange={(e) => onChange({ exerciseName: e.target.value })}
            style={inputStyle}/>
        ) : (
          <input type="text" value={step.exerciseName || ''} placeholder={step.kind === 'run' ? 'Run label (optional)' : 'Label'}
            onChange={(e) => onChange({ exerciseName: e.target.value })}
            style={inputStyle}/>
        )}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <select value={step.target}
            onChange={(e) => onChange({ target: e.target.value })}
            style={{ ...selectStyle, minWidth: 80 }}>
            {TARGET_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {step.target !== 'open' && (
            <input type="number" value={step.value ?? ''}
              onChange={(e) => onChange({ value: e.target.value === '' ? null : parseFloat(e.target.value) })}
              style={{ ...inputStyle, width: 60 }}/>
          )}
          {step.target === 'open' && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>lap</span>
          )}
        </div>
        <select value={step.intensity || 'active'}
          onChange={(e) => onChange({ intensity: e.target.value })}
          style={selectStyle}>
          {INTENSITY_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Hide details' : 'Show pace / weight / HR / notes'}
          style={{
            ...iconBtn,
            color: hasExtras ? '#fbbf24' : 'var(--text-muted)',
            fontSize: 12,
          }}>{expanded ? '▾' : '▸'}</button>
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={() => onMove(-1)} disabled={isFirst} style={iconBtn}>↑</button>
          <button onClick={() => onMove(+1)} disabled={isLast} style={iconBtn}>↓</button>
          <button onClick={onRemove} style={{ ...iconBtn, color: '#f87171' }}>✕</button>
        </div>
      </div>

      {expanded && (
        <StepDetails step={step} onChange={onChange}/>
      )}
    </div>
  );
}

// ── StepDetails: secondary fields (weight, pace/HR target, notes) ────────────

function StepDetails({ step, onChange }) {
  const isRun = step.kind === 'run';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isRun ? '1fr 1fr 2fr' : '1fr 1fr 2fr',
      gap: 6, padding: '6px 0 8px 26px',
      fontSize: 10,
    }}>
      {!isRun && (
        <label style={fieldStyle}>
          <span style={fieldLabel}>Weight (lb)</span>
          <input type="number" value={step.weightLb ?? ''} min={0} step={5}
            onChange={(e) => onChange({ weightLb: e.target.value === '' ? null : parseFloat(e.target.value) })}
            style={miniInput}/>
        </label>
      )}

      {isRun && (
        <>
          <label style={fieldStyle}>
            <span style={fieldLabel}>Pace target /mi (slower bound, e.g. 7:35)</span>
            <input type="text" value={step.paceLowSecPerMi ? formatPace(step.paceLowSecPerMi) : ''} placeholder="—"
              onChange={(e) => onChange({ paceLowSecPerMi: parsePace(e.target.value) })}
              style={miniInput}/>
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabel}>Pace target /mi (faster bound, e.g. 7:25)</span>
            <input type="text" value={step.paceHighSecPerMi ? formatPace(step.paceHighSecPerMi) : ''} placeholder="—"
              onChange={(e) => onChange({ paceHighSecPerMi: parsePace(e.target.value) })}
              style={miniInput}/>
          </label>
        </>
      )}

      {!isRun && (
        <>
          <label style={fieldStyle}>
            <span style={fieldLabel}>HR target — low bpm</span>
            <input type="number" value={step.hrLowBpm ?? ''} min={60} max={220}
              onChange={(e) => onChange({ hrLowBpm: e.target.value === '' ? null : parseInt(e.target.value) })}
              style={miniInput}/>
          </label>
        </>
      )}

      <label style={{ ...fieldStyle, gridColumn: isRun ? '3 / -1' : 'auto' }}>
        <span style={fieldLabel}>Note (shown on watch + step list)</span>
        <input type="text" value={step.note || ''}
          onChange={(e) => onChange({ note: e.target.value })}
          style={miniInput}/>
      </label>
    </div>
  );
}

const fieldStyle = { display: 'flex', flexDirection: 'column', gap: 2 };
const fieldLabel = { fontSize: 9, color: 'var(--text-muted)' };
const miniInput = {
  fontSize: 10, padding: '3px 6px',
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)', borderRadius: 4,
  width: '100%', boxSizing: 'border-box', outline: 'none',
};

// ── Apply-to-planner popover ─────────────────────────────────────────────────

function ApplyPopover({ onPick, onClose }) {
  const thisWeek = weekKey();
  const nextWeekVal = (() => {
    const d = new Date(thisWeek + 'T12:00:00'); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 6, padding: '8px 10px',
      fontSize: 11,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 500 }}>Apply to which day?</span>
        <button onClick={onClose} style={{ ...iconBtn, fontSize: 12 }}>✕</button>
      </div>
      {[[thisWeek, 'This week'], [nextWeekVal, 'Next week']].map(([wk, lbl]) => (
        <div key={wk} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{lbl}</div>
          <div style={{ display: 'flex', gap: 3 }}>
            {DAY_LABELS.map((d, i) => (
              <button key={i} onClick={() => onPick(i, wk)} style={dayBtnStyle}>{d}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const btnStyle = {
  all: 'unset', cursor: 'pointer',
  fontSize: 10, padding: '3px 8px', borderRadius: 4,
  background: 'transparent', color: 'var(--text-muted)',
  border: '0.5px solid var(--border-default)',
  textAlign: 'center',
};
const selectStyle = {
  fontSize: 10, padding: '3px 6px', borderRadius: 4,
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)',
  cursor: 'pointer',
};
const inputStyle = {
  fontSize: 10, padding: '3px 6px', borderRadius: 4,
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)',
  outline: 'none',
};
const iconBtn = {
  all: 'unset', cursor: 'pointer',
  fontSize: 11, padding: '2px 5px',
  color: 'var(--text-muted)',
};
const dayBtnStyle = {
  all: 'unset', cursor: 'pointer',
  flex: 1,
  fontSize: 10, padding: '4px 0', borderRadius: 4,
  textAlign: 'center',
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)',
};
