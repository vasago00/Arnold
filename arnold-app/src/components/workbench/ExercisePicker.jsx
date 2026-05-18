// ─── Exercise Picker ─────────────────────────────────────────────────────────
// Phase 4r.workbench.8
//
// Inline dropdown for picking a curated exercise to add as a new step.
// Filter chips on top (HYROX / Push / Pull / Legs / Core / Warm-up).
// Click an exercise → adds it to the parent segment with its default
// reps/weight/target. User can edit the resulting step row afterward.

import { useState } from "react";
import { EXERCISES, EXERCISE_TAGS, exercisesByTag, stepFromExercise } from "../../core/exerciseLibrary.js";

export function ExercisePicker({ onPick, onClose }) {
  const [tag, setTag] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = exercisesByTag(tag).filter(e =>
    !search || e.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 6,
      padding: '8px 10px',
      marginTop: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search exercises…"
          style={{
            flex: 1, fontSize: 11, padding: '4px 8px',
            background: 'var(--bg-input)', color: 'var(--text-primary)',
            border: '0.5px solid var(--border-default)', borderRadius: 4,
          }}/>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer',
          fontSize: 11, padding: '3px 6px',
          color: 'var(--text-muted)',
        }}>✕</button>
      </div>

      {/* Tag filter chips */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {EXERCISE_TAGS.map(t => (
          <button key={t.id} onClick={() => setTag(t.id)} style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 9, padding: '3px 8px', borderRadius: 10,
            background: tag === t.id ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.03)',
            color: tag === t.id ? '#fbbf24' : 'var(--text-muted)',
            border: `0.5px solid ${tag === t.id ? 'rgba(251,191,36,0.4)' : 'var(--border-subtle)'}`,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Exercise grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
        gap: 4,
        maxHeight: 260, overflowY: 'auto',
      }}>
        {filtered.map(e => (
          <button key={e.id}
            onClick={() => { onPick(stepFromExercise(e)); onClose(); }}
            style={{
              all: 'unset', cursor: 'pointer',
              padding: '6px 8px', borderRadius: 4,
              background: 'rgba(255,255,255,0.02)',
              border: '0.5px solid var(--border-subtle)',
              fontSize: 11, color: 'var(--text-primary)',
            }}>
            <div style={{ fontWeight: 500 }}>{e.name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
              {e.equipment} · {defaultLabel(e)}
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: 8, fontStyle: 'italic' }}>
            No exercises match. Try a different filter or search.
          </div>
        )}
      </div>
    </div>
  );
}

function defaultLabel(e) {
  if (e.defaultTarget === 'time')     return `${e.defaultValue || '?'}s`;
  if (e.defaultTarget === 'distance') return `${e.defaultValue || '?'}m`;
  if (e.defaultTarget === 'open')     return 'lap-press';
  if (e.defaultReps != null)          return `${e.defaultReps} reps`;
  return 'pick reps';
}
