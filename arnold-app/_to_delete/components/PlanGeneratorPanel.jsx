// PlanGeneratorPanel — the hub's plan generator, surfaced in the Plan tab next to
// the Workbench. You configure how you train (which days you're actually free, how
// many runs + strength sessions, the focus), hit Generate, preview the week the hub
// lays out (paces from your race fitness, sessions only on your available days,
// doubled when days are scarce), then PASTE it onto the calendar (this week or next).
// Re-configure + regenerate any time — schedules change, the plan flexes.
//
// Engine is core/hub/planGenerator.js (pure, tested); this is the thin UI + the
// paste-to-planner via core/planner.js. Prefs persist in storage('planPrefs').

import { useState } from 'react';
import { storage } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { generateWeeklyPlan, pacesFromHubFacts } from '../core/hub/planGenerator.js';
import { buildHubFromStorage } from '../core/hub/hubDebug.js';
import { weekKey, nextWeekKey, getPlannerWeek, savePlannerWeek, DAY_LABELS } from '../core/planner.js';

const FOCI = [
  { id: 'hybrid', label: 'Hybrid' }, { id: 'race', label: 'Race prep' },
  { id: 'base', label: 'Aerobic base' }, { id: 'maintain', label: 'Maintain' },
];

const loadPrefs = () => {
  const p = (() => { try { return storage.get('planPrefs'); } catch { return null; } })() || {};
  return {
    availableDays: Array.isArray(p.availableDays) && p.availableDays.length ? p.availableDays : [0, 1, 2, 3, 4, 5, 6],
    runDays: p.runDays ?? 5,
    strengthDays: p.strengthDays ?? 2,
    focus: p.focus || 'hybrid',
  };
};

// Map the generator's day objects → planner day records.
const toPlannerDays = days => days.map(d => d ? {
  type: d.type, notes: d.note || d.label, label: d.label,
  distanceMi: d.distanceMi ?? null, paceTarget: d.paceTarget ?? null,
  strength: !!d.strength, generated: true,
} : { type: 'rest' });

export function PlanGeneratorPanel({ showToast }) {
  const [expanded, setExpanded] = useState(false);
  const init = loadPrefs();
  const [avail, setAvail] = useState(init.availableDays);
  const [runDays, setRunDays] = useState(init.runDays);
  const [strengthDays, setStrengthDays] = useState(init.strengthDays);
  const [focus, setFocus] = useState(init.focus);
  const [plan, setPlan] = useState(null);

  const toggleDay = i => setAvail(a => a.includes(i) ? a.filter(d => d !== i) : [...a, i].sort((x, y) => x - y));

  const generate = () => {
    let paces = null, weekly = 30;
    try { paces = pacesFromHubFacts(buildHubFromStorage().facts); } catch {}
    try { weekly = Number({ ...(storage.get('profile') || {}), ...getGoals() }.weeklyRunDistanceTarget) || 30; } catch {}
    const opts = { availableDays: avail, runDays, strengthDays, focus, weeklyMileageTarget: weekly, paces };
    const result = generateWeeklyPlan(opts);
    setPlan(result);
    try { storage.set('planPrefs', { availableDays: avail, runDays, strengthDays, focus }, { skipValidation: true }); } catch {}
  };

  const paste = (which) => {
    if (!plan) return;
    const key = which === 'next' ? nextWeekKey() : weekKey();
    const wk = getPlannerWeek(key);
    savePlannerWeek(key, { ...wk, days: toPlannerDays(plan.days) });
    showToast?.(`Plan pasted to ${which === 'next' ? 'next' : 'this'} week's calendar`);
  };

  return (
    <div style={card}>
      <div onClick={() => setExpanded(e => !e)} style={headerRow}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>✦ Plan Generator</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Build a week from your schedule · paste to calendar</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Available days */}
          <div>
            <div style={lbl}>Days you can train</div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {DAY_LABELS.map((d, i) => (
                <button key={i} onClick={() => toggleDay(i)} style={{
                  ...chip,
                  background: avail.includes(i) ? 'rgba(94,234,212,0.14)' : 'transparent',
                  color: avail.includes(i) ? '#5eead4' : 'var(--text-muted)',
                  borderColor: avail.includes(i) ? 'rgba(94,234,212,0.4)' : 'var(--border-default)',
                }}>{d}</button>
              ))}
            </div>
          </div>

          {/* Counts + focus */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={field}><span style={lbl}>Run days</span>
              <input type="number" min={1} max={7} value={runDays} onChange={e => setRunDays(clampNum(e.target.value, 1, 7))} style={num} /></label>
            <label style={field}><span style={lbl}>Strength / wk</span>
              <input type="number" min={0} max={7} value={strengthDays} onChange={e => setStrengthDays(clampNum(e.target.value, 0, 7))} style={num} /></label>
            <label style={field}><span style={lbl}>Focus</span>
              <select value={focus} onChange={e => setFocus(e.target.value)} style={sel}>
                {FOCI.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select></label>
            <button onClick={generate} style={primaryBtn}>Generate</button>
          </div>

          {/* Preview */}
          {plan && (
            <div style={{ marginTop: 2 }}>
              {plan.summary.compressed && (
                <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 6 }}>
                  Tight schedule — fit {plan.summary.runDaysPlaced} of {plan.summary.runDaysWanted} runs into {avail.length} day{avail.length === 1 ? '' : 's'}{plan.summary.strengthOnHard ? ', some strength shares a hard day' : ''}.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {plan.days.map((d, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '2px 0', borderBottom: '0.5px solid var(--border-subtle)' }}>
                    <span style={{ width: 34, color: 'var(--text-muted)', fontWeight: 600 }}>{DAY_LABELS[i]}</span>
                    <span style={{ color: d ? 'var(--text-primary)' : 'var(--text-muted)' }}>{d ? (d.note || d.label) : 'Rest'}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Paste to calendar:</span>
                <button onClick={() => paste('this')} style={pasteBtn}>This week</button>
                <button onClick={() => paste('next')} style={pasteBtn}>Next week</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v) || lo));

const card = { background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderLeft: '2px solid #5eead4', borderRadius: 'var(--radius-md)', padding: '8px 14px', marginBottom: 10 };
const headerRow = { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer' };
const lbl = { fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const field = { display: 'flex', flexDirection: 'column', gap: 3 };
const chip = { all: 'unset', cursor: 'pointer', fontSize: 11, padding: '4px 9px', borderRadius: 6, border: '0.5px solid var(--border-default)', textAlign: 'center' };
const num = { width: 54, fontSize: 13, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, outline: 'none' };
const sel = { fontSize: 12, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, cursor: 'pointer' };
const primaryBtn = { all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 16px', borderRadius: 6, background: 'rgba(94,234,212,0.14)', color: '#5eead4', border: '0.5px solid rgba(94,234,212,0.4)' };
const pasteBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '4px 12px', borderRadius: 6, background: 'rgba(96,165,250,0.10)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.25)' };

export default PlanGeneratorPanel;
