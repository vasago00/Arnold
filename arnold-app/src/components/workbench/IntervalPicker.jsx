// ─── Interval / Run-Template Picker ──────────────────────────────────────────
// Phase 4r.workbench.8
//
// Pick a run interval template, fill in your paces, get a fully built
// workout you can edit afterward. Lives as a top-level option from the
// Workbench (creates a NEW workout, not adds-to-existing).

import { useState } from "react";
import { RUN_TEMPLATES } from "../../core/runTemplates.js";

export function IntervalPicker({ onCreate, onClose }) {
  const [templateId, setTemplateId] = useState(RUN_TEMPLATES[0].id);
  const template = RUN_TEMPLATES.find(t => t.id === templateId) || RUN_TEMPLATES[0];

  // Form values keyed by input.key, seeded from template defaults.
  const [values, setValues] = useState(() => {
    const v = {};
    template.inputs.forEach(i => { v[i.key] = i.default; });
    return v;
  });

  // When template changes, reset values to its defaults.
  const pickTemplate = (id) => {
    const t = RUN_TEMPLATES.find(x => x.id === id);
    setTemplateId(id);
    if (t) {
      const v = {};
      t.inputs.forEach(i => { v[i.key] = i.default; });
      setValues(v);
    }
  };

  const onConfirm = () => {
    onCreate(template, values);
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
          BUILD FROM RUN TEMPLATE
        </span>
        <span style={{ flex: 1 }}/>
        <button onClick={onClose} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)' }}>✕</button>
      </div>

      <select value={templateId} onChange={(e) => pickTemplate(e.target.value)} style={{
        width: '100%', fontSize: 11, padding: '4px 6px', marginBottom: 6,
        background: 'var(--bg-input)', color: 'var(--text-primary)',
        border: '0.5px solid var(--border-default)', borderRadius: 4,
      }}>
        {RUN_TEMPLATES.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10, fontStyle: 'italic' }}>
        {template.description}
      </div>

      {/* Inputs grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
        {template.inputs.map(input => (
          <label key={input.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{input.label}</span>
            <input
              type={input.type === 'number' ? 'number' : 'text'}
              value={values[input.key] ?? ''}
              onChange={(e) => setValues(v => ({ ...v, [input.key]: e.target.value }))}
              style={{
                fontSize: 11, padding: '4px 6px',
                background: 'var(--bg-input)', color: 'var(--text-primary)',
                border: '0.5px solid var(--border-default)', borderRadius: 4,
              }}/>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button onClick={onClose} style={btn}>Cancel</button>
        <button onClick={onConfirm} style={{ ...btn, background: 'rgba(94,234,212,0.18)', color: '#5eead4', borderColor: 'rgba(94,234,212,0.4)' }}>
          Build workout →
        </button>
      </div>
    </div>
  );
}

const btn = {
  all: 'unset', cursor: 'pointer',
  fontSize: 10, padding: '4px 10px', borderRadius: 4,
  background: 'transparent', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)',
};
