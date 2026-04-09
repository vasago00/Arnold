// ─── Weekly Planner ──────────────────────────────────────────────────────────
// Mon-Sun grid for the upcoming week. Click a day to edit, apply a template,
// or build it manually. Saves to arnold:planner keyed by week start.

import { useState } from "react";
import {
  weekKey, nextWeekKey, getPlannerWeek, savePlannerWeek, applyTemplate,
  DAY_TYPES, DAY_LABELS, TEMPLATES,
} from "../core/planner.js";

const dayTypeMap = Object.fromEntries(DAY_TYPES.map(t => [t.id, t]));

export function WeeklyPlanner({ showToast }) {
  const thisWeek = weekKey();
  const next = nextWeekKey();
  const [activeWeek, setActiveWeek] = useState(thisWeek);
  const [week, setWeek] = useState(() => getPlannerWeek(thisWeek));
  const [editingDay, setEditingDay] = useState(null);

  const reload = (key) => {
    setActiveWeek(key);
    setWeek(getPlannerWeek(key));
  };

  const updateDay = (idx, patch) => {
    const newDays = [...week.days];
    newDays[idx] = { ...(newDays[idx] || {}), ...patch };
    const updated = { ...week, days: newDays };
    setWeek(updated);
    savePlannerWeek(activeWeek, updated);
  };

  const applyTpl = (id) => {
    const result = applyTemplate(activeWeek, id);
    if (result) {
      setWeek(result);
      showToast?.(`Applied "${TEMPLATES[id].label}" template`);
    }
  };

  const wsDate = new Date(activeWeek + 'T12:00:00');
  const wsLabel = wsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const weDate = new Date(wsDate); weDate.setDate(wsDate.getDate() + 6);
  const weLabel = weDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── styles ──
  const panel = {
    background: 'var(--bg-surface)',
    border: '0.5px solid var(--border-default)',
    borderLeft: '3px solid #a78bfa',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    marginBottom: 12,
  };
  const headerRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 };
  const weekToggle = (active) => ({
    fontSize: 11, padding: '5px 12px', borderRadius: 6,
    border: '0.5px solid ' + (active ? 'var(--accent-border)' : 'var(--border-default)'),
    background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
    color: active ? 'var(--text-accent)' : 'var(--text-muted)',
    cursor: 'pointer', marginRight: 6,
  });
  const grid = {
    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0,1fr))', gap: 6, marginBottom: 12,
  };
  const dayCard = (entry) => {
    const t = dayTypeMap[entry?.type] || dayTypeMap.rest;
    return {
      background: 'var(--bg-elevated)',
      borderRadius: 6,
      borderTop: `2px solid ${t.color}`,
      padding: '8px 6px', textAlign: 'center', cursor: 'pointer',
      minHeight: 88, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    };
  };
  const tplBtn = {
    fontSize: 10, padding: '4px 10px', borderRadius: 12,
    background: 'rgba(167,139,250,0.12)', color: '#a78bfa',
    border: '0.5px solid rgba(167,139,250,0.30)', cursor: 'pointer',
  };

  return (
    <div style={panel}>
      <div style={headerRow}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>◈ Weekly Planner</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{wsLabel} – {weLabel}</div>
        </div>
        <div>
          <button style={weekToggle(activeWeek === thisWeek)} onClick={() => reload(thisWeek)}>This week</button>
          <button style={weekToggle(activeWeek === next)} onClick={() => reload(next)}>Next week</button>
        </div>
      </div>

      {/* Mon-Sun grid */}
      <div style={grid}>
        {DAY_LABELS.map((lbl, idx) => {
          const entry = week.days?.[idx] || { type: 'rest' };
          const t = dayTypeMap[entry.type] || dayTypeMap.rest;
          return (
            <div key={lbl} style={dayCard(entry)} onClick={() => setEditingDay(idx)}>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{lbl}</div>
              <div style={{ fontSize: 18, color: t.color, margin: '4px 0' }}>{t.icon}</div>
              <div style={{ fontSize: 10, color: 'var(--text-primary)', fontWeight: 500 }}>{t.label}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {entry.distanceMi ? `${entry.distanceMi} mi` : entry.durationMin ? `${entry.durationMin} min` : ''}
              </div>
            </div>
          );
        })}
      </div>

      {/* Inline editor */}
      {editingDay != null && (() => {
        const entry = week.days[editingDay] || {};
        return (
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              Editing <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{DAY_LABELS[editingDay]}</span>
              <span style={{ float: 'right', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setEditingDay(null)}>✕</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {DAY_TYPES.map(t => (
                <button key={t.id}
                  onClick={() => updateDay(editingDay, { type: t.id })}
                  style={{
                    fontSize: 10, padding: '4px 9px', borderRadius: 12,
                    background: entry.type === t.id ? `${t.color}22` : 'var(--bg-input)',
                    color: entry.type === t.id ? t.color : 'var(--text-muted)',
                    border: `0.5px solid ${entry.type === t.id ? t.color : 'var(--border-default)'}`,
                    cursor: 'pointer',
                  }}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" placeholder="distance (mi)" value={entry.distanceMi ?? ''}
                onChange={e => updateDay(editingDay, { distanceMi: e.target.value ? parseFloat(e.target.value) : null })}
                style={{ flex: 1, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
              <input type="number" placeholder="duration (min)" value={entry.durationMin ?? ''}
                onChange={e => updateDay(editingDay, { durationMin: e.target.value ? parseInt(e.target.value) : null })}
                style={{ flex: 1, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
              <input type="text" placeholder="notes" value={entry.notes ?? ''}
                onChange={e => updateDay(editingDay, { notes: e.target.value })}
                style={{ flex: 2, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
            </div>
          </div>
        );
      })()}

      {/* Templates */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>Quick template:</span>
        {Object.entries(TEMPLATES).map(([id, tpl]) => (
          <button key={id} style={tplBtn} onClick={() => applyTpl(id)}>{tpl.label}</button>
        ))}
      </div>
    </div>
  );
}
