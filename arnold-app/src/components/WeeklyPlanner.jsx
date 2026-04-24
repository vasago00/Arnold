// ─── Weekly Planner ──────────────────────────────────────────────────────────
// Compact single-row week strip with foldable editor + templates.

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
  const [expanded, setExpanded] = useState(false);

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
  const weLabel = weDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderLeft: '2px solid #a78bfa',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      marginBottom: 10,
    }}>
      {/* ── Header row ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.04em' }}>◈ Weekly Planner</span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{wsLabel} – {weLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[[thisWeek, 'This wk'], [next, 'Next wk']].map(([k, lbl]) => (
            <button key={k} onClick={() => reload(k)} style={{
              fontSize: 9, padding: '2px 8px', borderRadius: 10,
              border: '0.5px solid ' + (activeWeek === k ? 'var(--accent-border)' : 'var(--border-default)'),
              background: activeWeek === k ? 'var(--accent-dim)' : 'transparent',
              color: activeWeek === k ? 'var(--text-accent)' : 'var(--text-muted)',
              cursor: 'pointer', letterSpacing: '0.03em',
            }}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* ── Single-row week strip ── */}
      <div style={{ display: 'flex', padding: '6px 4px 8px' }}>
        {DAY_LABELS.map((lbl, idx) => {
          const entry = week.days?.[idx] || { type: 'rest' };
          const t = dayTypeMap[entry.type] || dayTypeMap.rest;
          const isEditing = editingDay === idx;
          const detail = entry.distanceMi ? `${entry.distanceMi}mi` : entry.durationMin ? `${entry.durationMin}m` : '';
          return (
            <div key={lbl}
              onClick={() => { setEditingDay(isEditing ? null : idx); if (!expanded) setExpanded(true); }}
              style={{
                flex: '1 1 0', minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                padding: '5px 1px', cursor: 'pointer', borderRadius: 6,
                background: isEditing ? 'rgba(167,139,250,0.08)' : 'transparent',
                transition: 'background 0.15s',
              }}>
              <span style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', lineHeight: 1 }}>{lbl}</span>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
              <span style={{ fontSize: 7.5, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>{t.label}</span>
              {detail && <span style={{ fontSize: 7, color: 'var(--text-muted)', lineHeight: 1 }}>{detail}</span>}
            </div>
          );
        })}
      </div>

      {/* ── Fold toggle ── */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4,
          padding: '3px 0', cursor: 'pointer', borderTop: '0.5px solid var(--border-subtle)',
          background: 'rgba(255,255,255,0.015)',
        }}>
        <span style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{expanded ? 'COLLAPSE' : 'EDIT'}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
      </div>

      {/* ── Foldable: editor + templates ── */}
      {expanded && (
        <div style={{ padding: '8px 12px 10px', borderTop: '0.5px solid var(--border-subtle)' }}>
          {/* Inline editor */}
          {editingDay != null && (() => {
            const entry = week.days[editingDay] || {};
            return (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
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
                  <input type="number" placeholder="dist (mi)" value={entry.distanceMi ?? ''}
                    onChange={e => updateDay(editingDay, { distanceMi: e.target.value ? parseFloat(e.target.value) : null })}
                    style={{ flex: 1, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
                  <input type="number" placeholder="mins" value={entry.durationMin ?? ''}
                    onChange={e => updateDay(editingDay, { durationMin: e.target.value ? parseInt(e.target.value) : null })}
                    style={{ flex: 1, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
                  <input type="text" placeholder="notes" value={entry.notes ?? ''}
                    onChange={e => updateDay(editingDay, { notes: e.target.value })}
                    style={{ flex: 2, fontSize: 11, padding: '5px 8px', background: 'var(--bg-input)', border: '0.5px solid var(--border-default)', borderRadius: 4, color: 'var(--text-primary)' }}/>
                </div>
              </div>
            );
          })()}

          {editingDay == null && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0 8px', fontStyle: 'italic' }}>
              Tap a day above to edit
            </div>
          )}

          {/* Templates */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginRight: 2 }}>Template:</span>
            {Object.entries(TEMPLATES).map(([id, tpl]) => (
              <button key={id} onClick={() => applyTpl(id)} style={{
                fontSize: 9, padding: '3px 8px', borderRadius: 10,
                background: 'rgba(167,139,250,0.10)', color: '#a78bfa',
                border: '0.5px solid rgba(167,139,250,0.25)', cursor: 'pointer',
                letterSpacing: '0.03em',
              }}>{tpl.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
