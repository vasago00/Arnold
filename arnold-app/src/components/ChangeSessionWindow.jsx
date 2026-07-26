// ChangeSessionWindow — THE single hub for changing a planned session (Option B: a compact
// 3-row hub that drills one level in). Replaces the scattered swap paths (auto-pick "Move to…",
// the per-session ⇄ pick-mode, the read-only plan ladder). Opens from ANY surface that shows a
// session — a calendar chip, a plan tile, the day drawer — and a drag onto a day is just a
// shortcut that drops you at the Move drill with that day pre-selected. Every path ends the same
// way: a proposed change → its impact → confirm. INFORMS, never blocks (conflict philosophy).
//
// Pure-ish: it imports the what-if engine (weekResolve) + the option engine (sessionAdapt) and
// computes impacts on the fly; the PARENT owns the actual planner writes via the on* callbacks.
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { evaluateReschedule, evaluateSessionMove, evaluateSubstitute } from '../core/weekResolve.js';
import { buildSessionOptions } from '../core/sessionAdapt.js';
import { MODALITIES, MODALITY_LABEL, setModalities } from '../core/modalities.js';

const RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit']);
const TONE_DOT = { affirming: '#4ade80', gentle: '#fbbf24', corrective: '#f87171', neutral: '#5eead4' };

const S = {
  overlay: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  win: { width: '100%', maxWidth: 380, background: 'var(--bg-surface, #16181d)', border: '1px solid var(--border-subtle, #2a2d34)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,0.5)' },
  head: { padding: '14px 16px 12px', borderBottom: '1px solid var(--border-subtle, #23262d)', position: 'relative' },
  title: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #e8eaed)' },
  close: { position: 'absolute', top: 12, right: 14, color: 'var(--text-muted, #7a7f88)', cursor: 'pointer', fontSize: 16 },
  sub: { marginTop: 6, fontSize: 12.5, color: 'var(--text-secondary, #b4b8c0)' },
  warn: { marginTop: 8, fontSize: 11, color: '#fbbf24', lineHeight: 1.4 },
  sec: { padding: '13px 16px', borderBottom: '1px solid var(--border-subtle, #23262d)' },
  lbl: { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted, #7a7f88)', marginBottom: 9 },
  seg: { display: 'inline-flex', background: 'var(--bg-surface-2, #1c1f26)', border: '1px solid var(--border-subtle, #2a2d34)', borderRadius: 9, padding: 2, gap: 2 },
  row: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 6px', cursor: 'pointer', borderRadius: 9 },
  chev: { color: 'var(--text-faint, #5b606a)', alignSelf: 'center', fontSize: 14 },
  impact: { marginTop: 10, background: 'var(--bg-surface-2, #1c1f26)', border: '1px solid var(--border-subtle, #23262d)', borderRadius: 10, padding: '9px 11px' },
  iline: { display: 'flex', gap: 8, fontSize: 11, margin: '2px 0' },
  ik: { width: 62, color: 'var(--text-muted, #7a7f88)', textTransform: 'uppercase', fontSize: 9, letterSpacing: '0.05em', flex: 'none', paddingTop: 1 },
  foot: { display: 'flex', gap: 8, padding: '13px 16px' },
  back: { all: 'unset', cursor: 'pointer', color: '#5eead4', fontSize: 11.5, fontWeight: 600 },
};
const btn = (go) => ({ all: 'unset', cursor: 'pointer', flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, fontSize: 12, fontWeight: go ? 700 : 600, background: go ? '#5eead4' : 'transparent', color: go ? '#08110f' : 'var(--text-secondary, #b4b8c0)', border: go ? 'none' : '1px solid var(--border-subtle, #2a2d34)' });
const chip = (on, warn) => ({ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '7px 11px', borderRadius: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 52, background: on ? 'rgba(94,234,212,0.10)' : 'var(--bg-surface-2, #1c1f26)', border: `1px solid ${on ? '#5eead4' : warn ? 'rgba(251,191,36,0.45)' : 'var(--border-subtle, #2a2d34)'}`, color: on ? '#5eead4' : 'var(--text-secondary, #b4b8c0)' });
const segBtn = (on) => ({ all: 'unset', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: on ? '#5eead4' : 'var(--text-secondary, #b4b8c0)', padding: '5px 12px', borderRadius: 7, background: on ? 'rgba(94,234,212,0.16)' : 'transparent' });

function ImpactBox({ impact }) {
  if (!impact || !impact.valid) return null;
  const v = impact.volume;
  const volChanged = v && v.delta !== 0;
  return (
    <div style={S.impact}>
      <div style={S.iline}><span style={S.ik}>Change</span><span style={{ color: 'var(--text-secondary, #b4b8c0)' }}>{impact.summary.split('.')[0]}.</span></div>
      {v && <div style={S.iline}><span style={S.ik}>Volume</span><span style={{ color: volChanged ? '#fbbf24' : '#4ade80' }}>{volChanged ? `${v.before} → ${v.after} mi` : `${v.after} mi · unchanged`}</span></div>}
      {(impact.conflicts || []).map((c, i) => <div key={i} style={S.iline}><span style={S.ik}>Spacing</span><span style={{ color: '#fbbf24' }}>{c.text}</span></div>)}
      {impact.losesRest && <div style={S.iline}><span style={S.ik}>Recovery</span><span style={{ color: '#f87171' }}>No rest day left this week</span></div>}
      {impact.protectsSessions && !(impact.conflicts || []).length && !impact.losesRest && <div style={S.iline}><span style={S.ik}>Sessions</span><span style={{ color: '#4ade80' }}>All kept</span></div>}
    </div>
  );
}

export function ChangeSessionWindow({
  date, dayLabel, sessions = [], normWeek, fromIdx, targetDays = [], modalities = null, injuryArea = null,
  weekOpenDays = null, openDayLabels = [], initialTarget = null, initialScope = null,
  onCommitMove, onCommitSubstitute, onCommitSkip, onClose,
}) {
  const isDouble = sessions.length > 1;
  const [view, setView] = useState(initialTarget ? 'move' : 'hub');
  // Move scope: which session moves. A drag pre-sets it ('both' for a day drag, or a session idx);
  // otherwise default the primary (first) session; 'both' moves the whole day.
  const [scope, setScope] = useState(initialScope != null ? initialScope : (isDouble ? sessions[0].idx : (sessions[0] ? sessions[0].idx : 'both')));
  const [target, setTarget] = useState(initialTarget);
  // Equipment profile, held locally so toggling it in-window re-derives the cross-train
  // options instantly (and persists globally). Empty profile = the reason a run shows no
  // bike/pool/rower option (Emil — "that is not possible, these are the choices").
  const [mods, setMods] = useState(modalities);
  const profileEmpty = !mods || !MODALITIES.some((k) => mods[k]);
  const toggleMod = (k) => {
    const next = { ...(mods || {}), [k]: !(mods && mods[k]) };
    setMods(next);
    try { setModalities(next); } catch { /* best-effort persist */ }
  };

  const scopeSession = sessions.find((s) => s.idx === scope) || sessions[0] || null;
  const moveLabel = scope === 'both' ? 'the day' : (scopeSession ? scopeSession.label : 'it');

  // MOVE impact for the currently-selected target.
  const moveImpact = useMemo(() => {
    if (!target || !normWeek) return null;
    const toIdx = (targetDays.find((d) => d.date === target) || {}).idx;
    if (toIdx == null) return null;
    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return scope === 'both'
      ? evaluateReschedule({ normWeek, fromIdx, toIdx, dayLabels })
      : evaluateSessionMove({ normWeek, fromIdx, fromSessionIdx: scope, toIdx, dayLabels });
  }, [target, scope, normWeek, fromIdx, targetDays]);

  // CHANGE-THE-WORKOUT options for the scoped session (coach-offered, equipment-gated) — the
  // sessionAdapt ladder MINUS the 'swap' move (Move lives in its own drill).
  const changeOpts = useMemo(() => {
    const sess = scope === 'both' ? sessions[0] : scopeSession;
    if (!sess) return [];
    const isQuality = ['tempo', 'intervals', 'hiit', 'threshold'].includes(sess.type);
    const isRun = RUN_TYPES.has(sess.type);
    const out = [];
    // De-load a hard day to an easy run — ALWAYS available for a quality run, because backing intensity
    // off while still running is a legitimate call on its own (fatigue, a niggle, a heavy week), not only
    // an injury response (Emil: "this is not an option available to me"). When the session aggravates an
    // injury we still OFFER it, but say plainly that an easy run keeps the impact (cross-train spares the joint more).
    if (isQuality) out.push({
      id: 'to_easy', title: 'Easy run instead',
      how: sess.aggravated
        ? 'De-load to an easy run — keeps the aerobic base, but still has impact (cross-train below spares the joint more).'
        : 'De-load — keep the aerobic base, drop the hard stimulus.',
      keeps: 'aerobic base',
      tradeoff: sess.aggravated ? 'still pounds the joint' : 'no threshold / VO₂ today',
    });
    // Equipment-gated cross-train + intent-preserving reduces from the tested engine (minus 'swap').
    const eng = buildSessionOptions(
      { type: sess.type, distanceMi: sess.distanceMi, minutes: sess.minutes },
      { injury: injuryArea || undefined },
      { modalities: profileEmpty ? null : mods, weekOpenDays, openDayLabels },
    );
    if (eng) for (const o of eng.options) if (o.id !== 'swap') out.push(o);
    // Make today a recovery day instead.
    if (isRun) out.push({ id: 'to_mobility', title: 'Mobility instead', how: 'Make today recovery — the session drops from the week.', keeps: 'rest / recovery', tradeoff: 'drops this session' });
    return out;
  }, [scope, sessions, injuryArea, mods, profileEmpty, weekOpenDays, openDayLabels]);

  // Does the current session even accept cross-train? (runs + strength do.) Used to decide
  // whether an empty equipment profile is worth flagging inside the Change drill.
  const scopedForCross = scope === 'both' ? sessions[0] : scopeSession;
  const crossTrainable = !!scopedForCross && (RUN_TYPES.has(scopedForCross.type) || scopedForCross.type === 'strength');

  const [chosenOpt, setChosenOpt] = useState(null);
  // Cross-train (bike/pool/rower/…) is time-based, not run-mileage. When one is picked we
  // let the athlete enter how long they'll go (Emil), seeded from the run's own length.
  const [subMinutes, setSubMinutes] = useState(null);
  const defaultSubMin = useMemo(() => {
    const s = scope === 'both' ? sessions[0] : scopeSession;
    if (s && Number(s.minutes) > 0) return Math.round(Number(s.minutes));
    if (s && Number(s.distanceMi) > 0) return Math.max(20, Math.round(Number(s.distanceMi) * 9));  // ~9 min/mi
    return 45;
  }, [scope, sessions, scopeSession]);
  const isModalitySub = !!(chosenOpt && chosenOpt.id.startsWith('sub_'));
  const substituteImpact = useMemo(() => {
    if (!chosenOpt || !normWeek) return null;
    // Modality substitutes drop the run miles; reduce/hold keep some — evaluateSubstitute gives the honest read.
    if (chosenOpt.id.startsWith('sub_') || chosenOpt.id === 'to_mobility') return evaluateSubstitute({ normWeek, dayIdx: fromIdx, modalityLabel: chosenOpt.title.toLowerCase(), keeps: chosenOpt.keeps, dayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] });
    return null;
  }, [chosenOpt, normWeek, fromIdx]);

  return createPortal(
    <div style={S.overlay} onClick={onClose}>
      <div style={S.win} role="dialog" aria-label={`Change ${dayLabel}`} onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div style={S.head}>
          <span style={S.title}>Change {dayLabel}</span>
          <span style={S.close} onClick={onClose}>✕</span>
          <div style={S.sub}>{sessions.map((s) => s.label).join(' + ')}{scopeSession && scopeSession.distanceMi ? ` · ${scopeSession.distanceMi} mi` : ''}</div>
          {injuryArea && injuryArea !== 'generic' && scopeSession && (scopeSession.aggravated) && (
            <div style={S.warn}>⚠ Protecting your {injuryArea} — this session aggravates it.</div>
          )}
        </div>

        {/* apply-to toggle (doubles only) */}
        {isDouble && view === 'hub' && (
          <div style={S.sec}>
            <div style={S.lbl}>Apply to</div>
            <div style={S.seg}>
              {sessions.map((s) => <button key={s.idx} style={segBtn(scope === s.idx)} onClick={() => setScope(s.idx)}>{s.label}</button>)}
              <button style={segBtn(scope === 'both')} onClick={() => setScope('both')}>Both</button>
            </div>
          </div>
        )}

        {/* HUB */}
        {view === 'hub' && (
          <div style={{ padding: '6px 16px 10px' }}>
            <div style={S.row} onClick={() => setView('move')}>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14 }}>⇄</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>Move to another day</div><div style={{ fontSize: 10.5, color: 'var(--text-muted, #7a7f88)' }}>{targetDays.length ? `${targetDays.filter((d) => !d.disabled).map((d) => d.label).slice(0, 3).join(' · ')} open — or drag it` : 'drag it onto a day'}</div></div>
              <span style={S.chev}>›</span>
            </div>
            <div style={S.row} onClick={() => setView('change')}>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14 }}>↻</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>Change the workout</div><div style={{ fontSize: 10.5, color: 'var(--text-muted, #7a7f88)' }}>{changeOpts.length ? changeOpts.slice(0, 3).map((o) => o.title).join(' · ') : 'easier · shorter · cross-train'}</div></div>
              <span style={S.chev}>›</span>
            </div>
            <div style={S.row} onClick={() => setView('skip')}>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14 }}>⏭</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12.5, fontWeight: 600 }}>Skip it</div><div style={{ fontSize: 10.5, color: 'var(--text-muted, #7a7f88)' }}>The one option that sets the block back.</div></div>
              <span style={S.chev}>›</span>
            </div>
          </div>
        )}

        {/* MOVE drill */}
        {view === 'move' && (
          <>
            <div style={S.sec}>
              <button style={S.back} onClick={() => (initialTarget ? onClose() : setView('hub'))}>‹ Back</button>
              <div style={{ ...S.lbl, marginTop: 9 }}>Move {moveLabel} to…</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                {targetDays.map((d) => (
                  <button key={d.date} disabled={d.disabled} style={{ ...chip(target === d.date, d.warn), opacity: d.disabled ? 0.4 : 1 }} onClick={() => !d.disabled && setTarget(d.date)}>{d.label}{d.hint ? <span style={{ fontSize: 8.5, fontWeight: 500, color: target === d.date ? '#5eead4' : 'var(--text-faint, #5b606a)' }}>{d.hint}</span> : null}</button>
                ))}
                <span style={{ fontSize: 10.5, color: 'var(--text-faint, #5b606a)', alignSelf: 'center' }}>…or drag it</span>
              </div>
              <ImpactBox impact={moveImpact} />
            </div>
            <div style={S.foot}>
              <button style={btn(false)} onClick={() => (initialTarget ? onClose() : setView('hub'))}>Cancel</button>
              <button style={btn(true)} onClick={() => { if (target && moveImpact && moveImpact.valid) { onCommitMove(scope, target); onClose(); } }}>Move it</button>
            </div>
          </>
        )}

        {/* CHANGE-THE-WORKOUT drill */}
        {view === 'change' && (
          <>
            <div style={S.sec}>
              <button style={S.back} onClick={() => { setChosenOpt(null); setView('hub'); }}>‹ Back</button>
              <div style={{ ...S.lbl, marginTop: 9 }}>Change the workout</div>
              {changeOpts.length === 0 && <div style={{ fontSize: 11, color: 'var(--text-muted, #7a7f88)' }}>No alternatives for this session.</div>}
              {changeOpts.map((o) => {
                const on = chosenOpt && chosenOpt.id === o.id;
                return (
                  <div key={o.id} style={{ ...S.row, background: on ? 'rgba(94,234,212,0.06)' : 'transparent' }} onClick={() => { setChosenOpt(o); if (o.id.startsWith('sub_')) setSubMinutes((m) => (m == null ? defaultSubMin : m)); }}>
                    <span style={{ width: 20, textAlign: 'center', fontSize: 13 }}>{on ? '◉' : '○'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{o.title}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted, #7a7f88)', lineHeight: 1.35 }}>{o.how}</div>
                      {o.tradeoff && <div style={{ fontSize: 9.5, color: 'var(--text-faint, #5b606a)', marginTop: 1 }}>trade-off · {o.tradeoff}</div>}
                    </div>
                    <span style={{ fontSize: 9.5, color: '#5eead4', whiteSpace: 'nowrap', paddingTop: 2 }}>{o.keeps}</span>
                  </div>
                );
              })}
              {/* Indoor / cross-train duration — time-based, so let the athlete set how long
                  (defaults from the run's length). Committed as durationMin; miles are dropped. */}
              {isModalitySub && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 6px 2px' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #7a7f88)' }}>How long?</span>
                  <input type="number" min="5" max="300" step="5" value={subMinutes == null ? '' : subMinutes}
                    onChange={(e) => { const v = e.target.value; setSubMinutes(v === '' ? null : Math.max(1, Math.min(300, parseInt(v, 10) || 0))); }}
                    style={{ width: 62, background: 'var(--bg-surface-2, #1c1f26)', border: '1px solid var(--border-subtle, #2a2d34)', borderRadius: 8, color: 'var(--text-primary, #e8eaed)', fontSize: 12, padding: '6px 8px' }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted, #7a7f88)' }}>min</span>
                </div>
              )}

              {substituteImpact && <ImpactBox impact={substituteImpact} />}

              {/* Cross-train is EQUIPMENT-GATED. When nothing's enabled a run shows only
                  easy/mobility — so surface the gate here and let the athlete flip on what
                  they own without leaving the window; options re-derive live (Emil). */}
              {crossTrainable && profileEmpty && (
                <div style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--border-subtle, #23262d)' }}>
                  <div style={{ fontSize: 10.5, color: 'var(--text-muted, #7a7f88)', lineHeight: 1.45, marginBottom: 9 }}>
                    Have a bike, pool, or other gear? Turn it on and I’ll add cross-train swaps that keep this session’s stimulus while sparing the impact.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {MODALITIES.map((k) => (
                      <button key={k} style={chip(!!(mods && mods[k]))} onClick={() => toggleMod(k)}>{MODALITY_LABEL[k]}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div style={S.foot}>
              <button style={btn(false)} onClick={() => { setChosenOpt(null); setView('hub'); }}>Cancel</button>
              <button style={btn(true)} onClick={() => { if (chosenOpt) { onCommitSubstitute(scope, isModalitySub ? { ...chosenOpt, minutes: subMinutes } : chosenOpt); onClose(); } }}>Confirm</button>
            </div>
          </>
        )}

        {/* SKIP */}
        {view === 'skip' && (
          <>
            <div style={S.sec}>
              <button style={S.back} onClick={() => setView('hub')}>‹ Back</button>
              <div style={{ ...S.lbl, marginTop: 9 }}>Skip {moveLabel}?</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary, #b4b8c0)', lineHeight: 1.5 }}>
                Skipping {scope === 'both' ? "the day's sessions" : `the ${scopeSession ? scopeSession.label.toLowerCase() : 'session'}`} removes it from the week. The move and change options above don't set the block back — this one does.
              </div>
            </div>
            <div style={S.foot}>
              <button style={btn(false)} onClick={() => setView('hub')}>Cancel</button>
              <button style={{ ...btn(true), background: '#f87171', color: '#1a0b0b' }} onClick={() => { onCommitSkip(scope); onClose(); }}>Skip it</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default ChangeSessionWindow;
