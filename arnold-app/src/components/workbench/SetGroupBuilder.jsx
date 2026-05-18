// ─── Set Group Builder ───────────────────────────────────────────────────────
// Phase 4r.workbench.8
//
// One-shot expander: pick exercise + sets × reps × weight → produces N
// work steps + (N-1) rest steps. Faster than adding each set as its own
// step manually.

import { useState } from "react";
import { EXERCISES, EXERCISE_TAGS, exercisesByTag, expandSetGroup } from "../../core/exerciseLibrary.js";

export function SetGroupBuilder({ onAddSteps, onClose }) {
  const [exerciseId, setExerciseId] = useState(EXERCISES[0].id);
  const [tag, setTag] = useState('all');
  const [sets, setSets] = useState(4);
  const [reps, setReps] = useState(8);
  const [weightLb, setWeightLb] = useState('');
  const [restSec, setRestSec] = useState(90);

  const filtered = exercisesByTag(tag);
  const ex = EXERCISES.find(e => e.id === exerciseId) || EXERCISES[0];

  // When user changes exercise, seed reps/weight/rest from its defaults
  // (but only if the corresponding input was at default — non-destructive).
  const pickExercise = (id) => {
    const e = EXERCISES.find(x => x.id === id);
    setExerciseId(id);
    if (e) {
      if (e.defaultReps != null)   setReps(e.defaultReps);
      if (e.defaultRestSec != null) setRestSec(e.defaultRestSec);
      if (e.defaultWeightLb)        setWeightLb(String(e.defaultWeightLb));
    }
  };

  const onConfirm = () => {
    const steps = expandSetGroup({
      exercise: ex,
      sets, reps,
      weightLb: weightLb === '' ? null : parseFloat(weightLb),
      restSec,
    });
    onAddSteps(steps);
    onClose();
  };

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 6, padding: '10px 12px', marginTop: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
          ADD SET GROUP
        </span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>✕</button>
      </div>

      {/* Tag chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        {EXERCISE_TAGS.map(t => (
          <button key={t.id} onClick={() => setTag(t.id)} style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 9, padding: '2px 7px', borderRadius: 10,
            background: tag === t.id ? 'rgba(251,191,36,0.18)' : 'transparent',
            color: tag === t.id ? '#fbbf24' : 'var(--text-muted)',
            border: `0.5px solid ${tag === t.id ? 'rgba(251,191,36,0.4)' : 'var(--border-subtle)'}`,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Exercise dropdown */}
      <select value={exerciseId} onChange={(e) => pickExercise(e.target.value)} style={{
        width: '100%', fontSize: 11, padding: '4px 6px', marginBottom: 8,
        background: 'var(--bg-input)', color: 'var(--text-primary)',
        border: '0.5px solid var(--border-default)', borderRadius: 4,
      }}>
        {filtered.map(e => (
          <option key={e.id} value={e.id}>{e.name} ({e.equipment})</option>
        ))}
      </select>

      {/* Numeric inputs row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 8 }}>
        <NumField label="Sets"    value={sets}    onChange={setSets}    min={1} max={20}/>
        <NumField label="Reps"    value={reps}    onChange={setReps}    min={1} max={100}/>
        <NumField label="Weight (lb)" value={weightLb} onChange={setWeightLb} min={0} max={1000} allowEmpty/>
        <NumField label="Rest (s)" value={restSec} onChange={setRestSec} min={0} max={600}/>
      </div>

      {/* Preview line */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--font-mono)' }}>
        Preview: {sets} × {reps} {ex.name}
        {weightLb && weightLb !== '0' ? ` @ ${weightLb}lb` : ''}
        {' · '}{restSec}s rest between sets
        {' → '}{sets * 2 - 1} steps total
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button onClick={onClose} style={btn}>Cancel</button>
        <button onClick={onConfirm} style={{ ...btn, background: 'rgba(251,191,36,0.18)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)' }}>
          Add to segment
        </button>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange, min, max, allowEmpty }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</span>
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => {
          const v = e.target.value;
          if (allowEmpty && v === '') { onChange(''); return; }
          onChange(v === '' ? '' : parseFloat(v));
        }}
        style={{
          fontSize: 11, padding: '4px 6px',
          background: 'var(--bg-input)', color: 'var(--text-primary)',
          border: '0.5px solid var(--border-default)', borderRadius: 4,
          width: '100%', boxSizing: 'border-box',
        }}/>
    </label>
  );
}

const btn = {
  all: 'unset', cursor: 'pointer',
  fontSize: 10, padding: '4px 10px', borderRadius: 4,
  background: 'transparent', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)',
};
