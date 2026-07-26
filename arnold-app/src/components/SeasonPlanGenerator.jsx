// SeasonPlanGenerator — Sprint 2 · 2.1 UI (chunk C1). The periodized, multi-week plan
// generator: pick a TARGET (a specific race on your calendar, or a rolling horizon) + how
// you train, Generate a season block (build → mini-taper → race-week → recovery, folding
// intermediate marathons in), PREVIEW it week-by-week (phase • mileage • long run), then
// PASTE it to the calendar (fill-empty by default — never clobbers a day you hand-edited).
//
// Self-contained: reads races from storage if not passed, so it can mount anywhere. The
// engine is core/hub/planGenerator.js (pure, tested). Per PLANNER_PLACEMENT_STRATEGY.md
// this moves INTO the Calendar in C2 (tap a race → generate to it); mounted in the Plan
// tab for now so it's visible/testable.

import { useMemo, useState, useEffect, useRef } from 'react';
import { storage, savePlanPrefs } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { generateSeasonBlock, pasteSeasonBlock, clearSeasonBlock, pacesFromHubFacts } from '../core/hub/planGenerator.js';
import { buildHubFromStorage } from '../core/hub/hubDebug.js';
import { allActivities } from '../core/dcyMath.js';
import { observedEasyPaceSecs } from '../core/coaching/observedPace.js';
import { fmtPaceMi } from '../core/coaching/vdot.js';
import { localDate } from '../core/time.js';
import { DAY_LABELS } from '../core/planner.js';

const FOCI = [
  { id: 'hybrid', label: 'Hybrid' }, { id: 'race', label: 'Race prep' },
  { id: 'base', label: 'Aerobic base' }, { id: 'maintain', label: 'Maintain' },
];
const PHASE_STYLE = {
  build:         { color: '#60a5fa', label: 'Build' },
  'mini-taper':  { color: '#fbbf24', label: 'Taper' },
  'race-week':   { color: '#ef4444', label: 'Race' },
  recovery:      { color: '#34d399', label: 'Recovery' },
};

const loadPrefs = () => {
  const p = (() => { try { return storage.get('planPrefs'); } catch { return null; } })() || {};
  return {
    availableDays: Array.isArray(p.availableDays) && p.availableDays.length ? p.availableDays : [0, 1, 2, 3, 4, 5, 6],
    runDays: p.runDays ?? 5, strengthDays: p.strengthDays ?? 2, focus: p.focus || 'hybrid',
  };
};

const fmtWk = (key) => { try { return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return key; } };
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v) || lo));

export function SeasonPlanGenerator({ races: propRaces, initialTargetDate = null, onApplied, showToast, openRaceReq = null, onPreview }) {
  const rootRef = useRef(null);
  const races = useMemo(() => {
    const r = (propRaces && propRaces.length) ? propRaces : (() => { try { return storage.get('races') || []; } catch { return []; } })();
    return r.filter(x => x && x.date);
  }, [propRaces]);
  const futureRaces = useMemo(() => races.filter(r => r.date >= localDate()).sort((a, b) => String(a.date).localeCompare(String(b.date))), [races]);

  const init = loadPrefs();
  const [expanded, setExpanded] = useState(false);
  const [avail, setAvail] = useState(init.availableDays);
  const [runDays, setRunDays] = useState(init.runDays);
  const [strengthDays, setStrengthDays] = useState(init.strengthDays);
  const [focus, setFocus] = useState(init.focus);
  const [target, setTarget] = useState(initialTargetDate ? `race:${initialTargetDate}` : 'next-race');
  const [block, setBlock] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [paces, setPaces] = useState(null);   // the computed E/T/L/I paces, for the visible summary
  const [pasted, setPasted] = useState(false); // whether the current block has been pasted to the calendar

  // Tap-a-race on the calendar → open pre-targeted to that race (as the A-race) + scroll here.
  useEffect(() => {
    if (openRaceReq && openRaceReq.date) {
      setTarget(`race:${openRaceReq.date}`);
      setExpanded(true);
      setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }
  }, [openRaceReq && openRaceReq.n]);

  const toggleDay = i => setAvail(a => a.includes(i) ? a.filter(d => d !== i) : [...a, i].sort((x, y) => x - y));

  const generate = () => {
    const goals = (() => { try { return getGoals(); } catch { return {}; } })();
    // YOUR observed easy pace leads the easy/long prescription (VDOT guards). Age → aerobic HR cap.
    let paces = null, easyMeta = null;
    try {
      const age = Number(goals.age) || Number((storage.get('profile') || {}).age) || null;
      const obs = observedEasyPaceSecs((() => { try { return allActivities(); } catch { return []; } })(), { age });
      paces = pacesFromHubFacts(buildHubFromStorage().facts, { observedEasySecs: obs.secs });
      easyMeta = { source: obs.secs ? obs.source : 'vdot', n: obs.n };
    } catch {}
    setPaces(paces ? { ...paces, _easyMeta: easyMeta } : null);
    const weeklyMiles = Number(goals.weeklyRunDistanceTarget) || 30;
    const ceilingMiles = Number(goals.weeklyMileageCeiling) || Math.round(weeklyMiles * 1.4) || 50;
    const longestRecentMi = Number(goals.longRunTargetMi) || 10;
    const base = { races, today: localDate(), availableDays: avail, runDays, strengthDays, focus, paces, weeklyMiles, longestRecentMi, ceilingMiles };
    const opts = target.startsWith('race:')
      ? { ...base, targetRaceDate: target.slice(5) }
      : { ...base, horizon: target === 'next-race' ? 'next-race' : parseInt(target, 10) };
    const result = generateSeasonBlock(opts);
    setBlock(result);
    setPasted(false);
    onPreview?.(result);   // C3 — light up the grid where the block will land
    // MERGE, never replace — storage.set is a whole-value overwrite, so writing these four
    // fields used to DELETE target/tier/startDate/customGoalSecs and then sync the truncated
    // object to the other device. See savePlanPrefs in core/storage.js.
    savePlanPrefs({ availableDays: avail, runDays, strengthDays, focus });
  };

  const storeApi = () => ({ get: (k) => storage.get(k), set: (k, v) => storage.set(k, v, { skipValidation: true }) });

  const apply = () => {
    if (!block) return;
    const { written } = pasteSeasonBlock(storeApi(), block.weeks, { mode: overwrite ? 'overwrite' : 'fill-empty' });
    showToast?.(`Plan pasted — ${written} week${written === 1 ? '' : 's'} to your calendar`);
    setPasted(true);
    onPreview?.(null);   // real days now render on the grid; drop the preview ring
    onApplied?.();
  };

  const removeFromCalendar = () => {
    if (!block) return;
    const { cleared } = clearSeasonBlock(storeApi(), block.weeks.map(w => w.weekKey));
    showToast?.(`Removed the generated plan from ${cleared} week${cleared === 1 ? '' : 's'} (your hand-edits kept)`);
    setPasted(false);
    onApplied?.();
  };

  const clearPreview = () => { setBlock(null); setPaces(null); setPasted(false); onPreview?.(null); };

  return (
    <div style={card} ref={rootRef}>
      <div onClick={() => setExpanded(e => !e)} style={headerRow}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>✦ Generate plan</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Periodized block to a race · paste to calendar</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Target */}
          <label style={field}><span style={lbl}>Build toward</span>
            <select value={target} onChange={e => setTarget(e.target.value)} style={{ ...sel, minWidth: 200 }}>
              <option value="1">This week only</option>
              <option value="next-race">Next race</option>
              <option value="4">Next 4 weeks</option>
              <option value="8">Next 8 weeks</option>
              <option value="12">Next 12 weeks</option>
              {futureRaces.length > 0 && <option disabled>──────────</option>}
              {futureRaces.map(r => <option key={r.date} value={`race:${r.date}`}>{r.name || 'Race'} · {fmtWk(r.date)}</option>)}
            </select>
          </label>
          {target.startsWith('race:') && (
            <div style={{ fontSize: 10, color: '#5eead4', marginTop: -4, lineHeight: 1.4 }}>
              ⓘ Treated as your goal (A-)race — the build peaks for it; any earlier races become supported efforts, not full tapers.
            </div>
          )}

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

          {/* Counts + focus + generate */}
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

          {/* Your training paces — the visible, testable output of the coaching engine. */}
          {paces && (
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)', border: '0.5px solid var(--border-subtle)' }}>
              <div style={lbl}>Your training paces · min/mi</div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 5, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                <span><b style={{ color: '#5eead4' }}>Easy</b> {fmtPaceMi(paces.easy) || '—'}</span>
                <span><b style={{ color: '#60a5fa' }}>Long</b> {fmtPaceMi(paces.long) || '—'}</span>
                <span><b style={{ color: '#fbbf24' }}>Tempo</b> {fmtPaceMi(paces.tempo) || '—'}</span>
                <span><b style={{ color: '#fb7185' }}>Interval</b> {fmtPaceMi(paces.interval) || '—'}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                {paces._easyMeta && (paces._easyMeta.source === 'hr' || paces._easyMeta.source === 'pace-split')
                  ? `Easy/Long from YOUR ${paces._easyMeta.n} recent easy runs`
                  : 'Easy/Long from VDOT — log a few easy runs and it switches to your real pace'} · Tempo/Interval from Daniels VDOT at your fitness.
              </div>
            </div>
          )}

          {/* Preview — weekly mileage as bars so the ramp/peak/taper is visible before pasting. */}
          {block && block.weeks && (() => {
            const peakMi = Math.max(1, ...block.weeks.map(w => w.targetWeeklyMiles || 0));
            return (
            <div style={{ marginTop: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
                <span>{block.weeks.length} week{block.weeks.length === 1 ? '' : 's'} · peak {Math.round(peakMi)} mi</span>
                {pasted && <span style={{ color: '#34d399', fontWeight: 600 }}>✓ on your calendar</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
                {block.weeks.map((w, i) => {
                  const ps = PHASE_STYLE[w.phase] || { color: 'var(--text-muted)', label: w.phase };
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', borderBottom: '0.5px solid var(--border-subtle)' }}>
                      <span style={{ width: 42, color: 'var(--text-muted)', fontWeight: 600 }}>{fmtWk(w.weekKey)}</span>
                      <span style={{ width: 54, fontSize: 9, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', color: ps.color }}>{ps.label}</span>
                      <span style={{ width: 40, textAlign: 'right', color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(w.targetWeeklyMiles)}</span>
                      <span style={{ flex: 1, height: 7, background: 'rgba(148,163,184,0.12)', borderRadius: 4, overflow: 'hidden', minWidth: 30 }}>
                        <span style={{ display: 'block', height: '100%', width: `${Math.round((w.targetWeeklyMiles / peakMi) * 100)}%`, background: ps.color, opacity: 0.75 }} />
                      </span>
                      {w.longRunTargetMi > 0 && w.phase !== 'race-week'
                        ? <span style={{ width: 34, textAlign: 'right', fontSize: 9, color: 'var(--text-muted)' }}>L{Math.round(w.longRunTargetMi)}</span>
                        : <span style={{ width: 34 }} />}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {!pasted && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
                    Overwrite days I've hand-edited
                  </label>
                )}
                <span style={{ flex: 1 }} />
                <button onClick={clearPreview} style={ghostBtn}>Clear</button>
                {pasted
                  ? <button onClick={removeFromCalendar} style={dangerBtn}>Remove from calendar</button>
                  : <button onClick={apply} style={pasteBtn}>Paste {block.weeks.length} wk{block.weeks.length === 1 ? '' : 's'} to calendar</button>}
              </div>
              {pasted && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>Change days on the calendar, or tweak settings above and Generate again to redo.</div>}
            </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const card = { background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderLeft: '2px solid #5eead4', borderRadius: 'var(--radius-md)', padding: '8px 14px', marginBottom: 10 };
const headerRow = { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', cursor: 'pointer' };
const lbl = { fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const field = { display: 'flex', flexDirection: 'column', gap: 3 };
const chip = { all: 'unset', cursor: 'pointer', fontSize: 11, padding: '4px 9px', borderRadius: 6, border: '0.5px solid var(--border-default)', textAlign: 'center' };
const num = { width: 54, fontSize: 13, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, outline: 'none' };
const sel = { fontSize: 12, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, cursor: 'pointer' };
const primaryBtn = { all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 16px', borderRadius: 6, background: 'rgba(94,234,212,0.14)', color: '#5eead4', border: '0.5px solid rgba(94,234,212,0.4)' };
const pasteBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '5px 14px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.3)' };
const ghostBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 500, padding: '5px 10px', borderRadius: 6, color: 'var(--text-muted)', border: '0.5px solid var(--border-default)' };
const dangerBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '0.5px solid rgba(239,68,68,0.3)' };

export default SeasonPlanGenerator;
