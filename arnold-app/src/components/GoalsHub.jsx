// ─── Goals Hub ───────────────────────────────────────────────────────────────
// One place to define, edit, and review every target Arnold tracks.
// Reads from core/goals.js (which has profile fallback during transition).

import { useState, useMemo } from "react";
import { GOAL_DEFS, getGoals, setGoals, goalsByGroup, getMacroBreakdown } from "../core/goals.js";
import { storage } from "../core/storage.js";
import {
  computeRMR,
  computeTDEE,
  empiricalTDEE,
  assessCalibration,
  recommendCalorieTarget,
  getCurrentBodyComp,
} from "../core/energyBalance.js";

const GROUP_COLOR = {
  Run:       '#60a5fa',
  Strength:  '#a78bfa',
  Recovery:  '#4ade80',
  Body:      '#22d3ee',
  Nutrition: '#fbbf24',
};

export function GoalsHub({ showToast }) {
  const [draft, setDraft] = useState(() => getGoals());
  const [saved, setSaved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const groups = goalsByGroup();
  const history = storage.get('goalsHistory') || [];

  const handleSave = () => {
    // Coerce numeric strings → numbers before save
    const cleaned = {};
    for (const def of GOAL_DEFS) {
      if (def.derived) continue; // grams are computed, never stored
      const v = draft[def.id];
      if (v == null || v === '') continue;
      cleaned[def.id] = def.type === 'number' ? parseFloat(v) : String(v);
    }
    setGoals(cleaned);
    setSaved(true);
    showToast?.('Goals saved');
    setTimeout(() => setSaved(false), 2000);
  };

  const panel = {
    background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    marginBottom: 8,
  };
  const header = {
    fontSize: 9, fontWeight: 500, letterSpacing: '0.07em',
    color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2,
  };
  // Unified 4-col layout: label · value · unit · suffix(% or blank)
  const row = {
    display: 'grid', gridTemplateColumns: '1fr 90px 30px 42px',
    gap: 8, alignItems: 'center', marginBottom: 3,
  };
  const label = { fontSize: 12, color: 'var(--text-secondary)' };
  const input = {
    fontSize: 12, padding: '5px 8px',
    background: 'var(--bg-input)', border: '0.5px solid var(--border-default)',
    borderRadius: 4, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
    textAlign: 'right',
    MozAppearance: 'textfield',
  };
  const unit = { fontSize: 10, color: 'var(--text-muted)' };
  const suffix = { fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textAlign: 'right' };
  const saveBtn = {
    background: 'var(--accent-dim)', color: 'var(--text-accent)',
    border: '0.5px solid var(--accent-border)', borderLeft: '3px solid var(--accent)',
    borderRadius: 'var(--radius-md)', padding: '9px 24px',
    fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%', marginTop: 8,
  };

  return (
    <div style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      {/* Collapsible header */}
      <div onClick={() => setExpanded(e => !e)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '0.03em' }}>◉ Goals Hub</div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>Single source of truth for every target.</div>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transition: 'transform 0.2s ease', transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)' }}>▼</span>
      </div>

      {expanded && <div style={{ padding: '0 14px 14px' }}>

      <NutritionCalibrationPanel draft={draft} />

      <div className="arnold-goals-grid" style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, alignItems:'start' }}>
      {(() => {
        const order = ['Run','Strength','Recovery','Body','Nutrition'];
        const ordered = order.filter(g=>groups[g]).map(g=>[g,groups[g]]);
        const left = ordered.filter(([g])=>g==='Run'||g==='Strength');
        const right = ordered.filter(([g])=>g==='Recovery'||g==='Body'||g==='Nutrition');
        const renderPanel = ([groupName, defs]) => (
        <div key={groupName} style={{ ...panel, borderLeft: `3px solid ${GROUP_COLOR[groupName] || '#60a5fa'}` }}>
          <div style={{ ...header, color: GROUP_COLOR[groupName] || 'var(--text-muted)' }}>{groupName}</div>
          {defs.map(def => {
            if (def.hidden) return null;
            // Editable macro grams with inline % readout, no borders.
            if (def.derived) {
              const cals = parseFloat(draft.dailyCalorieTarget)||0;
              const pctKey = def.id==='dailyProteinTarget'?'proteinPct':def.id==='dailyCarbTarget'?'carbPct':'fatPct';
              const kcalPerG = def.id==='dailyFatTarget' ? 9 : 4;
              const pct = parseFloat(draft[pctKey])||0;
              const grams = Math.round((cals*pct/100)/kcalPerG);
              const onGramChange = (newG) => {
                const c = parseFloat(draft.dailyCalorieTarget)||0;
                if (!c || newG==null || isNaN(newG)) return;
                const newPct = Math.min(100, Math.max(0, (newG*kcalPerG/c)*100));
                const otherKeys = ['proteinPct','carbPct','fatPct'].filter(k=>k!==pctKey);
                const otherSum = otherKeys.reduce((s,k)=>s+(parseFloat(draft[k])||0),0);
                const remaining = 100 - newPct;
                let next = { ...draft, [pctKey]: newPct };
                if (otherSum > 0) {
                  for (const k of otherKeys) {
                    const cur = parseFloat(draft[k])||0;
                    next[k] = (cur/otherSum)*remaining;
                  }
                } else {
                  for (const k of otherKeys) next[k] = remaining/2;
                }
                setDraft(next);
              };
              return (
                <div key={def.id} style={row}>
                  <span style={label}>{def.label}</span>
                  <input
                    key={`${def.id}-${grams}`}
                    style={input}
                    type="text"
                    inputMode="numeric"
                    defaultValue={grams}
                    onBlur={e => onGramChange(parseFloat(e.target.value))}
                    onKeyDown={e => { if (e.key==='Enter') e.target.blur(); }}
                  />
                  <span style={unit}>g</span>
                  <span style={suffix}>{Math.round(pct)}%</span>
                </div>
              );
            }
            // Date input — MM-DD-YYYY display format, accepts slashes/dashes
            if (def.id === 'targetWeightDate') {
              const normalizeDate = (v) => {
                if (!v) return '';
                const s = String(v).trim();
                // MM-DD-YYYY or MM/DD/YYYY with separators
                let m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
                if (m) return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3]}`;
                // YYYY-MM-DD ISO
                m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
                if (m) return `${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}-${m[1]}`;
                // 8 digits no separator — MMDDYYYY
                m = s.match(/^(\d{2})(\d{2})(\d{4})$/);
                if (m) return `${m[1]}-${m[2]}-${m[3]}`;
                // 8 digits YYYYMMDD
                m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
                if (m) return `${m[2]}-${m[3]}-${m[1]}`;
                return s;
              };
              return (
                <div key={def.id} style={row}>
                  <span style={label}>{def.label}</span>
                  <input
                    style={input}
                    type="text"
                    placeholder="MM-DD-YYYY"
                    value={draft[def.id] ?? ''}
                    onChange={e => setDraft({ ...draft, [def.id]: e.target.value })}
                    onBlur={e => setDraft({ ...draft, [def.id]: normalizeDate(e.target.value) })}
                    onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); setDraft({ ...draft, [def.id]: normalizeDate(e.target.value) }); handleSave(); e.target.blur(); } }}
                  />
                  <span style={unit}></span>
                  <span></span>
                </div>
              );
            }
            // Pace input — normalize to M:SS on blur
            if (def.id === 'targetRacePace') {
              const normalizePace = (v) => {
                if (!v) return '';
                const s = String(v).trim().replace(/[.]/,':');
                // M:SS or MM:SS with colon
                let m = s.match(/^(\d{1,2}):(\d{1,2})$/);
                if (m) return `${parseInt(m[1],10)}:${m[2].padStart(2,'0')}`;
                // Pure digits: "8" → "8:00", "830" → "8:30", "1030" → "10:30"
                if (/^\d+$/.test(s)) {
                  if (s.length <= 2) return `${parseInt(s,10)}:00`;
                  if (s.length === 3) return `${s[0]}:${s.slice(1)}`;
                  if (s.length === 4) return `${s.slice(0,2)}:${s.slice(2)}`;
                }
                return s;
              };
              return (
                <div key={def.id} style={row}>
                  <span style={label}>{def.label}</span>
                  <input
                    style={input}
                    type="text"
                    placeholder="MM:SS"
                    value={draft[def.id] ?? ''}
                    onChange={e => setDraft({ ...draft, [def.id]: e.target.value })}
                    onBlur={e => setDraft({ ...draft, [def.id]: normalizePace(e.target.value) })}
                    onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); setDraft({ ...draft, [def.id]: normalizePace(e.target.value) }); handleSave(); e.target.blur(); } }}
                  />
                  <span style={unit}>{def.unit}</span>
                  <span></span>
                </div>
              );
            }
            return (
              <div key={def.id} style={row}>
                <span style={label}>{def.label}</span>
                <input
                  style={input}
                  type="text"
                  inputMode={def.type === 'number' ? 'decimal' : 'text'}
                  value={draft[def.id] ?? ''}
                  placeholder={def.placeholder || String(def.default)}
                  onChange={e => setDraft({ ...draft, [def.id]: e.target.value })}
                  onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); handleSave(); e.target.blur(); } }}
                />
                <span style={unit}>{def.unit}</span>
                <span></span>
              </div>
            );
          })}
        </div>
        );
        return (<>
          <div>{left.map(renderPanel)}</div>
          <div>{right.map(renderPanel)}</div>
        </>);
      })()}
      </div>

      <button style={saveBtn} onClick={handleSave}>{saved ? '✓ Saved' : 'Save Goals'}</button>

      {history.length > 0 && (
        <div style={{ ...panel, marginTop: 10, borderLeft: '3px solid var(--text-muted)' }}>
          <div style={header}>Recent changes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {history.slice(0, 8).map((h, i) => (
              <div key={i} style={{ fontSize: 10, display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                <span>{h.id}</span>
                <span><span style={{ color: '#f87171' }}>{String(h.from ?? '—')}</span> → <span style={{ color: '#4ade80' }}>{String(h.to)}</span></span>
                <span>{new Date(h.ts).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>}
    </div>
  );
}

// ─── Nutrition Calibration Panel ────────────────────────────────────────────
// Live, deterministic readout of your energy balance state — sourced from
// energyBalance.js. Replaces guesswork with: actual RMR (Katch-McArdle from
// LBM), model TDEE, empirical TDEE (back-calculated from observed weight
// change), recommended cut/maintain targets with RMR floor enforcement, and
// calibration drift diagnostics.
//
// Phase 4j-b + 4j-c — combined into a single panel so the user sees:
//   • Computed RMR + body comp source
//   • TDEE: model vs empirical (with confidence)
//   • Recommended kcal targets (cut/maintain)
//   • RMR-floor warning if their dailyCalorieTarget < RMR
//   • 4-week predicted vs actual weight + drift diagnostics
function NutritionCalibrationPanel({ draft }) {
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
  }, [draft.dailyCalorieTarget, draft.targetWeight]);

  if (ctx.error) {
    return (
      <div style={{ padding: '10px 14px', marginBottom: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: '#f87171' }}>Calibration unavailable: {ctx.error}</div>
      </div>
    );
  }

  const { comp, rmrR, tdeeModel, emp, cal, rec } = ctx;
  const draftCal = parseFloat(draft.dailyCalorieTarget) || 0;

  // RMR floor warning — Phase 4j-c
  const belowRmr = draftCal > 0 && draftCal < rmrR.rmr;

  // Calibration status color
  const statusColor =
    cal.status === 'aligned'    ? '#4ade80' :
    cal.status === 'under-loss' ? '#fbbf24' :
    cal.status === 'over-loss'  ? '#60a5fa' :
                                  'var(--text-muted)';

  const sectionStyle = {
    padding: '10px 14px', marginBottom: 8,
    background: 'var(--bg-elevated)',
    border: '0.5px solid var(--border-default)',
    borderLeft: '3px solid #fbbf24',
    borderRadius: 'var(--radius-md)',
  };
  const labelStyle  = { fontSize: 9, fontWeight: 500, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 };
  const subLabel    = { fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 };
  const value       = { fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' };
  const smallNote   = { fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' };
  const grid3       = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 10 };
  const grid4       = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 };

  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>◎ Nutrition Calibration · live from your data</div>

      {/* RMR + Body Comp */}
      <div style={grid3}>
        <div>
          <div style={subLabel}>RMR</div>
          <div style={value}>{rmrR.rmr} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>kcal</span></div>
          <div style={smallNote}>{rmrR.formula} · LBM {Math.round(comp.leanMassLbs * 10) / 10} lb</div>
        </div>
        <div>
          <div style={subLabel}>Body Composition</div>
          <div style={value}>{Math.round(comp.weightLbs * 10) / 10} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>lb · {comp.bodyFatPct?.toFixed(1) ?? '—'}% BF</span></div>
          <div style={smallNote}>source: {comp.source}{comp.sourceDate ? ` (${comp.sourceDate})` : ''}</div>
        </div>
        <div>
          <div style={subLabel}>Activity (28d avg)</div>
          <div style={value}>{rec.avgActivityKcal} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>kcal/day</span></div>
          <div style={smallNote}>from FIT-recorded sessions</div>
        </div>
      </div>

      {/* TDEE — Model vs Empirical */}
      <div style={{ ...grid3, borderTop: '0.5px solid var(--border-default)', paddingTop: 10 }}>
        <div>
          <div style={subLabel}>TDEE · Model</div>
          <div style={value}>{tdeeModel.tdee} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>kcal</span></div>
          <div style={smallNote}>RMR + activity + NEAT + TEF</div>
        </div>
        <div>
          <div style={subLabel}>TDEE · Empirical</div>
          <div style={{ ...value, color: emp.confidence === 'insufficient' ? 'var(--text-muted)' : 'var(--text-primary)' }}>
            {emp.empiricalTDEE ?? '—'} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>kcal</span>
          </div>
          <div style={smallNote}>
            {emp.confidence === 'insufficient'
              ? `need ≥14 logged days + weight at both ends (${Math.round(emp.observedDayPct * 100)}% covered)`
              : `${emp.confidence} confidence · avg intake ${emp.avgIntake} · loss ${emp.actualLossLbs} lb`}
          </div>
        </div>
        <div>
          <div style={subLabel}>Used for recommendation</div>
          <div style={{ ...value, color: rec.tdeeSource?.startsWith('empirical') ? '#4ade80' : 'var(--text-primary)' }}>
            {rec.tdeeCurrent} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>kcal</span>
          </div>
          <div style={smallNote}>{rec.tdeeSource}</div>
        </div>
      </div>

      {/* Recommended targets */}
      <div style={{ ...grid4, borderTop: '0.5px solid var(--border-default)', paddingTop: 10 }}>
        <div>
          <div style={subLabel}>Cut target</div>
          <div style={{ ...value, color: '#fbbf24' }}>{rec.cutTarget}</div>
          <div style={smallNote}>{rec.lossRatePerWeek} lb/wk · {rec.cutDeficit} kcal deficit</div>
        </div>
        <div>
          <div style={subLabel}>Maintain (current)</div>
          <div style={value}>{rec.maintenanceCurrent}</div>
          <div style={smallNote}>{Math.round(rec.currentWeight)} lb</div>
        </div>
        <div>
          <div style={subLabel}>Maintain (target)</div>
          <div style={{ ...value, color: '#4ade80' }}>{rec.maintenanceTarget}</div>
          <div style={smallNote}>{rec.targetWeight} lb · post-cut "forever" number</div>
        </div>
        <div>
          <div style={subLabel}>RMR floor</div>
          <div style={{ ...value, color: '#f87171' }}>{rec.floorRmr}</div>
          <div style={smallNote}>never eat below this</div>
        </div>
      </div>

      {/* RMR-floor guardrail — Phase 4j-c */}
      {belowRmr && (
        <div style={{
          marginTop: 8, padding: '10px 12px',
          background: 'rgba(248,113,113,0.10)',
          border: '1px solid rgba(248,113,113,0.35)',
          borderRadius: 8,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ fontSize: 14, color: '#f87171' }}>⚠</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 3 }}>
              Daily calories ({draftCal}) below RMR ({rmrR.rmr})
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Eating below resting metabolic rate triggers metabolic adaptation, lean-mass loss, and rebound — the failure mode the eat-for-target-weight philosophy is built to avoid (Helms / Norton / Aragon consensus). Raise to ≥{rmrR.rmr} and use a slower loss rate or more activity instead.
            </div>
          </div>
        </div>
      )}

      {/* Calibration verdict */}
      {cal.status !== 'no-data' && (
        <div style={{
          marginTop: 8, padding: '10px 12px',
          background: 'rgba(255,255,255,0.025)',
          borderLeft: `3px solid ${statusColor}`,
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: statusColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Calibration · last {cal.windowDays / 7} weeks · {cal.status}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: cal.diagnostics?.length ? 6 : 0 }}>
            {cal.message}
          </div>
          {cal.diagnostics?.length > 0 && (
            <details>
              <summary style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>
                {cal.diagnostics.length} likely causes (in order of probability)
              </summary>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cal.diagnostics.map((d, i) => (
                  <div key={i} style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>{d.cause}</strong> — {d.detail}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Predicted vs actual snapshot */}
      {cal.actualLossLbs != null && (
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div>
            <div style={subLabel}>Predicted (4 wk)</div>
            <div style={value}>{cal.predictedLossLbs > 0 ? '−' : '+'}{Math.abs(cal.predictedLossLbs).toFixed(1)} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>lb</span></div>
          </div>
          <div>
            <div style={subLabel}>Actual (4 wk)</div>
            <div style={value}>{cal.actualLossLbs > 0 ? '−' : '+'}{Math.abs(cal.actualLossLbs).toFixed(1)} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>lb</span></div>
          </div>
          <div>
            <div style={subLabel}>Drift</div>
            <div style={{ ...value, color: Math.abs(cal.driftLbs) > 1 ? statusColor : 'var(--text-primary)' }}>
              {cal.driftLbs > 0 ? '+' : ''}{cal.driftLbs.toFixed(1)} <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>lb</span>
            </div>
          </div>
        </div>
      )}

      {/* Path to target */}
      {rec.lbsToLose > 0 && (
        <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(74,222,128,0.05)', borderLeft: '3px solid #4ade80', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            <strong style={{ color: '#4ade80' }}>Path to target:</strong> {rec.lbsToLose} lb to {rec.targetWeight} lb · ~{rec.weeksToTarget} weeks at {rec.lossRatePerWeek} lb/wk · steady at {rec.maintenanceTarget} kcal post-cut.
          </div>
        </div>
      )}

      {/* Engine warnings */}
      {rec.warnings?.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rec.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.4 }}>⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
