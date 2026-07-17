// LivingPlan (Sprint 3.2c) — replaces the static "✦ Generate plan" config panel.
//
// The plan is now LIVING: it auto-derives from your goal + proven recipe +
// current profile on mount (no "Generate" button to hunt for), leads with the
// marathon coach's verdict and the WEAK LINK it's prioritizing, previews the
// periodized ramp, and applies to the calendar in one tap. The manual controls
// still exist — demoted behind "Adjust" for when you want to reshape days/focus.
//
// Engine is unchanged (core/hub/planGenerator.js — pure, tested); coach read is
// getSeasonCoach(); weak link comes from the recipe-path (trainingProfile.js).
// This retires SeasonPlanGenerator's static-config-first UX per Emil (2026-07).

import { useMemo, useState, useEffect, useRef } from 'react';
import { storage } from '../core/storage.js';
import { getGoals } from '../core/goals.js';
import { generateSeasonBlock, pasteSeasonBlock, clearSeasonBlock, pacesFromHubFacts } from '../core/hub/planGenerator.js';
import { buildHubFromStorage } from '../core/hub/hubDebug.js';
import { allActivities } from '../core/dcyMath.js';
import { observedEasyPaceSecs } from '../core/coaching/observedPace.js';
import { fmtPaceMi } from '../core/coaching/vdot.js';
import { localDate } from '../core/time.js';
import { DAY_LABELS, getPlannerWeek, daySessions } from '../core/planner.js';
import { summarizePlanWeek } from '../core/planWeekSummary.js';   // per-day done/missed status (same source as calendar + mobile ticker)
import { getSeasonCoach } from '../core/seasonCoach.js';
import { saveRaces } from '../core/memory.js';
import { resolveTrainingProfile } from '../core/trainingProfile.js';
import { intentFor, buildSessionOptions } from '../core/sessionAdapt.js';
import { getModalities, setModalities, MODALITIES, MODALITY_LABEL } from '../core/modalities.js';
import { sessionAggravatesInjury, INJURY_LIBRARY } from '../core/injury.js';
import { volumeReadout } from '../core/volumeModel.js';
// Per-icon deep imports (official "./*" subpath → dist/csr/<Name>.es.js). Bypasses the
// barrel index so the bundler transforms only these 5 icons, not the whole ~1,500-icon
// library — the barrel import here was OOM-ing Rolldown at build. Same components, all weights.
import { PersonSimpleRun } from '@phosphor-icons/react/PersonSimpleRun';
import { PersonSimpleTaiChi } from '@phosphor-icons/react/PersonSimpleTaiChi';
import { Trophy } from '@phosphor-icons/react/Trophy';
import { Bed } from '@phosphor-icons/react/Bed';
import { Lightning } from '@phosphor-icons/react/Lightning';
import { buildQualityStructure } from '../core/workoutStructure.js';
import { scoreSession } from '../core/sessionScore.js';
import { CoachComment } from './CoachComment.jsx';   // plan-vs-execution oversight voice (narrative engine)

const FOCI = [
  { id: 'hybrid', label: 'Hybrid' }, { id: 'race', label: 'Race prep' },
  { id: 'base', label: 'Aerobic base' }, { id: 'maintain', label: 'Maintain' },
];
const PHASE_STYLE = {
  build:        { color: '#60a5fa', label: 'Build' },
  'mini-taper': { color: '#fbbf24', label: 'Taper' },
  'race-week':  { color: '#ef4444', label: 'Race' },
  recovery:     { color: '#34d399', label: 'Recovery' },
};
const VERDICT = {
  increase: { label: 'Increase', color: '#60a5fa' }, hold: { label: 'Hold', color: '#fbbf24' },
  cut: { label: 'Cut back', color: '#f87171' }, taper: { label: 'Taper', color: '#a78bfa' },
  recover: { label: 'Recover', color: '#4ade80' },
};
const SESSION_COLOR = {
  long_run: '#60a5fa', easy_run: '#5eead4', recovery: '#5eead4', tempo: '#fbbf24',
  intervals: '#fb7185', hiit: '#fb7185', strength: '#a78bfa', race: '#ef4444', mobility: '#34d399',
  cycle: '#eab308', cross: '#94a3b8', swim: '#38bdf8', ski: '#818cf8', walk: '#34d399',
};
const SHORT_NAME = {
  long_run: 'Long', easy_run: 'Easy', recovery: 'Recovery', tempo: 'Tempo',
  intervals: 'Intervals', hiit: 'HIIT', strength: 'Strength', race: 'Race', mobility: 'Mobility',
  cycle: 'Cycle', cross: 'Cross-train', swim: 'Swim', ski: 'Ski', walk: 'Walk',
};
// Any unmapped type falls back to a Capitalized form (never a raw lowercase enum
// like "cycle" — Emil). Covers future disciplines without a map edit.
const nameOf = (t) => SHORT_NAME[t] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '');
const RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit', 'recovery']);
// Training-priority for picking a day's PRIMARY session — mirrors the calendar's FAMILY_PRIORITY
// so the planner leads with the same workout the calendar does (a run/cycle over mobility). A
// run+mobility day used to show as "Recovery" here because toPlanDay took the first non-strength
// session instead of the highest-priority one (Emil).
const PLAN_PRIORITY = {
  race: 100, hiit: 90, long_run: 85, intervals: 80, tempo: 75, easy_run: 70, run: 70,
  recovery: 69, cycle: 68, ski: 67, swim: 66, cross: 61, strength: 60, walk: 40, mobility: 20, rest: 0,
};

// Session glyph — the Phosphor icons from the workout tiles (no dumbbell: a pure
// strength day uses the "STR" text badge instead of an icon).
function SessionGlyph({ type, color, size = 15 }) {
  if (RUN_TYPES.has(type)) return <PersonSimpleRun size={size} color={color} weight="bold" />;
  if (type === 'race') return <Trophy size={size} color={color} weight="bold" />;
  if (type === 'mobility') return <PersonSimpleTaiChi size={size} color={color} weight="bold" />;
  if (type === 'rest') return <Bed size={size} color={color} weight="duotone" />;
  return null;
}
const QUALITY_TYPES = new Set(['tempo', 'threshold', 'intervals', 'hiit']);
const KEEP_COLOR = { full: '#34d399', high: '#5eead4', partial: '#fbbf24' };   // how much a swap keeps

// Effort silhouette — the whole quality session as one flowing filled curve
// (warm-up rises → work reps plateau with recovery valleys → cool-down falls).
function WorkoutSilhouette({ profile, color, height = 38 }) {
  if (!profile || !profile.length) return null;
  const W = 320, H = 34, total = profile.reduce((s, x) => s + x[0], 0) || 1;
  let x = 0; const pts = [[0, H]];
  profile.forEach(([d, e]) => { const w = d / total * W; pts.push([x, H - e * (H - 2)]); pts.push([x + w, H - e * (H - 2)]); x += w; });
  pts.push([W, H]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const mini = height < 24;
  const gid = `wsg-${color.replace('#', '')}-${mini ? 'm' : 'f'}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', margin: mini ? 0 : '7px 0 6px' }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={mini ? 0.35 : 0.5} /><stop offset="100%" stopColor={color} stopOpacity="0.04" /></linearGradient></defs>
      <path d={`${line} L${W},${H} Z`} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={mini ? 1 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const loadPrefs = () => {
  const p = (() => { try { return storage.get('planPrefs'); } catch { return null; } })() || {};
  return {
    availableDays: Array.isArray(p.availableDays) && p.availableDays.length ? p.availableDays : [0, 1, 2, 3, 4, 5, 6],
    runDays: p.runDays ?? 5, strengthDays: p.strengthDays ?? 2, focus: p.focus || 'hybrid',
    target: p.target || null,   // remember the race the user is building toward (else it reverts to the default)
    startDate: p.startDate || null,   // when the plan begins (ISO); rolls forward if stale
    longRunDow: (p.longRunDow ?? null),           // pinned long-run day-of-week (Mon=0..Sun=6)
    strengthDows: Array.isArray(p.strengthDows) ? p.strengthDows : [],   // pinned strength days
  };
};
const fmtWk = (key) => { try { return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return key; } };
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v) || lo));
// Goal finish time parse/format. Accepts "3:30", "3:30:00", or bare digits "330".
const parseGoal = (str) => {
  if (!str) return null;
  const s = String(str).trim();
  if (s.includes(':')) {
    const p = s.split(':').map(Number);
    if (p.some(n => !Number.isFinite(n))) return null;
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    if (p.length === 2) return p[0] * 3600 + p[1] * 60;
    return null;
  }
  const d = s.replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 2) return Number(d) * 60;                        // "45" → 45 min
  const mm = d.slice(-2), hh = d.slice(0, -2);                     // "329" → 3:29, "330" → 3:30
  return Number(hh) * 3600 + Number(mm) * 60;
};
const fmtGoal = (secs) => { if (!(secs > 0)) return ''; const h = Math.floor(secs / 3600), m = Math.round((secs % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}`; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Start-date options — today through +14 days, computed from TODAY each render so
// they roll forward as the date changes. Any day, not just Mondays.
const startDateOptions = () => {
  const out = []; const base = new Date();
  for (let i = 0; i <= 14; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const nice = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ iso: ymd(d), label: i === 0 ? `Today · ${nice}` : i === 1 ? `Tomorrow · ${nice}` : nice });
  }
  return out;
};
const shortName = (n) => (n || '').split(' ')[0];

export function LivingPlan({ races: propRaces, initialTargetDate = null, onApplied, showToast, openRaceReq = null, onPreview, isMobile = false, onChangeSession = null }) {
  const rootRef = useRef(null);
  const races = useMemo(() => {
    const r = (propRaces && propRaces.length) ? propRaces : (() => { try { return storage.get('races') || []; } catch { return []; } })();
    return r.filter(x => x && x.date);
  }, [propRaces]);
  const futureRaces = useMemo(() => races.filter(r => r.date >= localDate()).sort((a, b) => String(a.date).localeCompare(String(b.date))), [races]);

  const init = loadPrefs();
  const [expanded, setExpanded] = useState(false);   // "Adjust" — collapsed by default now
  const [avail, setAvail] = useState(init.availableDays);
  const [runDays, setRunDays] = useState(init.runDays);
  const [strengthDays, setStrengthDays] = useState(init.strengthDays);
  const [focus, setFocus] = useState(init.focus);
  // When the plan begins. Any date in the next 2 weeks; if a saved date has passed, roll to today.
  const [startDate, setStartDate] = useState(() => (init.startDate && init.startDate >= localDate()) ? init.startDate : localDate());
  const [longRunDow, setLongRunDow] = useState(init.longRunDow);       // pinned long-run day (null = auto)
  const [strengthDows, setStrengthDows] = useState(init.strengthDows); // pinned strength days ([] = auto by count)
  // Default to building toward the GOAL (A-race), not the soonest tune-up — else a
  // race a few days out produces a trivial 1-week block. Explicit initialTargetDate wins.
  const defaultTarget = initialTargetDate
    ? `race:${initialTargetDate}`
    : (() => {
        // Prefer the GOAL race: an explicit A-race, else the soonest marathon you've
        // set a goal TIME on (that's the one you're training for — e.g. Valencia over
        // an earlier Berlin), else just the soonest marathon.
        const a = futureRaces.find(r => String(r.priority || '').toUpperCase() === 'A')
          || futureRaces.find(r => Number(r.goalTimeSecs) > 0 && (Number(r.distanceMi) || 0) >= 24)
          || futureRaces.find(r => (Number(r.distanceMi) || 0) >= 24);
        return a ? `race:${a.date}` : 'next-race';
      })();
  // A saved choice wins over the computed default — otherwise picking Valencia
  // reverts to the soonest marathon (Berlin) on every remount.
  const [target, setTarget] = useState(init.target || defaultTarget);
  const [block, setBlock] = useState(null);
  const [overwrite, setOverwrite] = useState(false);
  const [paces, setPaces] = useState(null);
  // Pace is a FUNCTION of the session type, not a stored value — so a changed session (tempo→easy
  // or easy→tempo) shows the right pace, both directions, and never a stale one. Derived from the
  // athlete's VDOT paces. (Quality days show a structure, not a single pace, so this is for the
  // steady types.)
  const PACE_KEY = { easy_run: 'easy', recovery: 'easy', long_run: 'long', tempo: 'tempo', threshold: 'tempo', intervals: 'interval', hiit: 'interval' };
  const paceForType = (t) => { const k = PACE_KEY[t]; return (paces && k && paces[k]) ? fmtPaceMi(paces[k]) : null; };
  const [pasted, setPasted] = useState(false);

  // Living reads: the marathon coach verdict + the recipe-path weak link.
  const coach = useMemo(() => { try { return getSeasonCoach(); } catch { return null; } }, [races]);
  const [profile, setProfile] = useState(null);
  const [goalVol, setGoalVol] = useState(null);   // goal-driven peak readout
  const [openSession, setOpenSession] = useState(null);   // day index whose drill-down is open
  const [adaptOpen, setAdaptOpen] = useState(false);      // "can't do it today?" ladder within the drill-down
  const [injury, setInjury] = useState(() => { try { return storage.get('injury') || ''; } catch { return ''; } });
  const setInjuryStore = (v) => { setInjury(v); try { storage.set('injury', v, { skipValidation: true }); } catch {} };
  // Equipment / modality profile — the gate for cross-train swap options (session agility).
  const [modalities, setModalitiesState] = useState(() => getModalities() || {});
  const toggleModality = (k) => { const next = { ...modalities, [k]: !modalities[k] }; setModalitiesState(next); setModalities(next); };
  const [goalInput, setGoalInput] = useState('');   // goal finish time for the target race (drives the peak)
  useEffect(() => {
    let alive = true;
    resolveTrainingProfile().then(p => { if (alive) setProfile(p); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const generate = (nextTarget = target, { preview = true } = {}) => {
    const goals = (() => { try { return getGoals(); } catch { return {}; } })();
    let p = null, easyMeta = null;
    try {
      const age = Number(goals.age) || Number((storage.get('profile') || {}).age) || null;
      const obs = observedEasyPaceSecs((() => { try { return allActivities(); } catch { return []; } })(), { age });
      p = pacesFromHubFacts(buildHubFromStorage().facts, { observedEasySecs: obs.secs });
      easyMeta = { source: obs.secs ? obs.source : 'vdot', n: obs.n };
    } catch {}
    setPaces(p ? { ...p, _easyMeta: easyMeta } : null);
    const weeklyMiles = Number(goals.weeklyRunDistanceTarget) || 30;
    // Goal-driven peak: the ceiling comes from what the A-race goal REQUIRES —
    // not the athlete's current target (the old 1.4× cap made targeting a goal
    // do nothing). recommendedPeakMi maps goal marathon time → peak volume.
    // Read the target race + its goal FRESH from storage (so a goal just saved via
    // the Adjust field is seen this pass). Goal time = the race's goalTimeSecs, else
    // derived from your "Target marathon pace" goal.
    const freshRaces = (() => { try { return storage.get('races') || races; } catch { return races; } })();
    const aRaceObj = nextTarget.startsWith('race:')
      ? freshRaces.find(r => r.date === nextTarget.slice(5))
      : (freshRaces.find(r => String(r.priority || '').toUpperCase() === 'A')
         || freshRaces.find(r => (Number(r.distanceMi) || 0) >= 24));
    let goalSecs = Number(aRaceObj?.goalTimeSecs) || null;
    // Fall back to the Performance-goals Marathon target (goals.marathon.targetSecs)
    // — that's where Emil's 3:29 lives, separate from the race's goalTimeSecs.
    if (!goalSecs && goals?.marathon && Number(goals.marathon.targetSecs) > 0) goalSecs = Number(goals.marathon.targetSecs);
    if (!goalSecs && goals.targetRacePace) {
      const [gm, gs] = String(goals.targetRacePace).split(':').map(Number);
      const spm = gm * 60 + (gs || 0);
      if (spm > 0) goalSecs = Math.round(spm * (Number(aRaceObj?.distanceMi) || 26.2));
    }
    const vr = goalSecs
      ? volumeReadout({ goalTimeSecs: goalSecs, distanceMi: Number(aRaceObj?.distanceMi) || 26.2, currentWeeklyMi: weeklyMiles })
      : null;
    setGoalVol(vr);
    // Ceiling = what the GOAL needs. When the A-race goal sets a required peak
    // (vr.peakMi, e.g. ~48 for a 3:29 marathon), THAT is the ceiling — do NOT let
    // `1.4 × current base` inflate it past the goal (that old cap is exactly what the
    // goal-volume model replaces; keeping it in the max pushed the ramp to ~62 for a
    // goal that only needs ~48, so the displayed "peak 48" never matched the plan).
    // Floor at the current base (never prescribe below what you're already running)
    // and honor an explicit user ceiling only if they set one HIGHER. No goal set →
    // fall back to the classic 1.4×base ramp.
    const ceilingMiles = vr?.peakMi
      ? Math.max(vr.peakMi, Number(goals.weeklyMileageCeiling) || 0, Math.round(weeklyMiles) || 0, 30)
      : Math.max(Number(goals.weeklyMileageCeiling) || 0, Math.round(weeklyMiles * 1.4) || 0, 30);
    const longestRecentMi = Number(goals.longRunTargetMi) || 10;
    const base = { races, today: startDate, availableDays: avail, runDays, strengthDays, focus, paces: p, weeklyMiles, longestRecentMi, ceilingMiles, longRunDow: (longRunDow == null ? undefined : longRunDow), strengthDows: (strengthDows && strengthDows.length ? strengthDows : undefined) };
    const opts = nextTarget.startsWith('race:')
      ? { ...base, targetRaceDate: nextTarget.slice(5) }
      : { ...base, horizon: nextTarget === 'next-race' ? 'next-race' : parseInt(nextTarget, 10) };
    const result = generateSeasonBlock(opts);
    setBlock(result);
    setPasted(false);
    // Only paint the calendar preview rings on an EXPLICIT (re)generate — not on the
    // auto-derive at mount, which otherwise circled every future day in blue permanently.
    if (preview) onPreview?.(result);
    try { storage.set('planPrefs', { availableDays: avail, runDays, strengthDays, focus, target: nextTarget, startDate, longRunDow, strengthDows }, { skipValidation: true }); } catch {}
  };

  // Auto-derive the plan on mount — the "living" part: no button to press. No preview
  // rings on the calendar for this silent pass (see the blue-circles fix).
  const _mounted = useRef(false);
  useEffect(() => { generate(target, { preview: false }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // Config changes (days / run+strength counts / focus) re-derive immediately, so
  // asking for 3 strength days shows 3 without hunting for a Regenerate button.
  useEffect(() => {
    if (!_mounted.current) { _mounted.current = true; return; }
    generate(target, { preview: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDays, strengthDays, focus, avail, startDate, longRunDow, strengthDows]);
  // Keep the goal-time field in sync — the race's goalTimeSecs, else pre-fill from
  // the Performance-goals Marathon target so the existing 3:29 shows up here.
  useEffect(() => {
    try {
      const rs = storage.get('races') || [];
      const tr = target.startsWith('race:') ? rs.find(r => r.date === target.slice(5)) : null;
      let secs = Number(tr?.goalTimeSecs) || null;
      // v2 Performance-goals Marathon target (goals.performance.marathon.targetSecs) —
      // the real path; getGoals() is flat and has no .marathon.
      if (!secs) { const m = (storage.get('goals') || {})?.performance?.marathon; const t = m && typeof m === 'object' ? Number(m.targetSecs) : Number(m); if (t > 0) secs = t; }
      if (!secs) { const g = getGoals(); if (g?.marathon && Number(g.marathon.targetSecs) > 0) secs = Number(g.marathon.targetSecs); }
      setGoalInput(secs ? fmtGoal(secs) : '');
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Save the goal onto the target race (single source; drives volume + profile) → regenerate.
  const commitGoal = async () => {
    const secs = parseGoal(goalInput);
    if (secs) setGoalInput(fmtGoal(secs));   // auto-format the display ("330" → "3:30")
    const tRaceDate = target.startsWith('race:') ? target.slice(5) : null;
    if (secs && tRaceDate) {
      try {
        const rs = storage.get('races') || [];
        await saveRaces(rs.map(r => r.date === tRaceDate ? { ...r, goalTimeSecs: secs } : r));
      } catch {}
    }
    generate(target, { preview: false });
  };

  // Tap-a-race on the calendar → retarget to it + open Adjust + scroll here.
  useEffect(() => {
    if (openRaceReq && openRaceReq.date) {
      setTarget(`race:${openRaceReq.date}`);
      setExpanded(true);
      generate(`race:${openRaceReq.date}`);
      setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRaceReq && openRaceReq.n]);

  const toggleDay = i => setAvail(a => a.includes(i) ? a.filter(d => d !== i) : [...a, i].sort((x, y) => x - y));
  const storeApi = () => ({ get: (k) => storage.get(k), set: (k, v) => storage.set(k, v, { skipValidation: true }) });

  const apply = () => {
    if (!block) return;
    const { written } = pasteSeasonBlock(storeApi(), block.weeks, { mode: overwrite ? 'overwrite' : 'fill-empty' });
    showToast?.(`Plan applied — ${written} week${written === 1 ? '' : 's'} to your calendar`);
    setPasted(true);
    onPreview?.(null);
    onApplied?.();
  };
  const removeFromCalendar = () => {
    if (!block) return;
    const { cleared } = clearSeasonBlock(storeApi(), block.weeks.map(w => w.weekKey));
    showToast?.(`Removed the plan from ${cleared} week${cleared === 1 ? '' : 's'} (your hand-edits kept)`);
    setPasted(false);
    onApplied?.();
  };

  const plan = coach?.plan;
  const v = plan ? (VERDICT[plan.verdict] || { label: plan.verdict, color: '#9aa0a6' }) : null;
  // The weak link the plan is built to close (from the recipe-path).
  const weakLink = profile?.weakLink || null;
  const peakMi = block?.weeks?.length ? Math.max(1, ...block.weeks.map(w => w.targetWeeklyMiles || 0)) : 0;
  // The race the plan is actually building toward (the countdown should reflect
  // THIS, not the soonest marathon — otherwise it reads "→ Berlin" while you build to Valencia).
  const targetRace = target.startsWith('race:') ? races.find(r => r.date === target.slice(5)) : null;
  const targetDays = targetRace ? Math.max(0, Math.round((new Date(targetRace.date + 'T12:00:00') - new Date()) / 86400000)) : null;

  return (
    <div style={card} ref={rootRef}>
      {/* Executive header — plan + phase + countdown on ONE line */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Your plan</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Living · goal · recipe · profile</span>
        <span style={{ flex: 1 }} />
        {plan && v && (
          <span style={{ fontSize: 9, fontWeight: 700, color: v.color, background: `${v.color}1a`, border: `0.5px solid ${v.color}55`, borderRadius: 6, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
            {plan.phase} · {v.label}
          </span>
        )}
        {(targetRace || plan?.nextMarathon) && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {targetRace ? `${targetDays}d → ${shortName(targetRace.name)}` : `${plan.nextMarathon.daysToMarathon}d → ${shortName(plan.nextMarathon.name)}`}
          </span>
        )}
      </div>

      {/* Plan-vs-execution oversight — the Coach's read on how the week is tracking against the
          plan and the goal (missed sessions / drift off target / strength-frequency progress /
          purpose toward the race). Routes through the narrative engine's 'plan' surface, so it's
          the same reasoned voice as Play/Daily. Shows on web + mobile (unlike the web-only plan
          CoachComment in Arnold). Emil: "where do I see the voice that oversees plan + execution?" */}
      <div style={{ marginTop: 8 }}>
        <CoachComment surface="plan" />
      </div>

      {/* Fact row — ONLY the plan-specific numbers (peak + weak link). The
          verdict / this-week / long-run / "why" live on Start's Marathon Coach,
          so the Calendar plan no longer repeats them (de-dupe, 2026-07): Start =
          the glance, Calendar = the execution. */}
      {(peakMi > 0 || weakLink) && (
        <div style={{ display: 'flex', gap: 26, marginTop: 12, paddingBottom: 12, borderBottom: '0.5px solid var(--border-subtle)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {peakMi > 0 && <Stat val={Math.round(peakMi)} unit=" mi" label="peak" />}
          {weakLink && (
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171', lineHeight: 1.15 }}>{weakLink.label}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4, whiteSpace: 'nowrap' }}>weak link</div>
            </div>
          )}
        </div>
      )}

      {/* Goal-driven volume — what the goal REQUIRES (not the old target cap) */}
      {goalVol && (
        <div style={{ fontSize: 11, color: '#5eead4', lineHeight: 1.4, marginTop: 6 }}>
          ◎ {goalVol.note}{goalVol.gapMi > 0 ? ` Building the base toward it — +${goalVol.gapMi} mi to the peak.` : ''}
        </div>
      )}

      {/* THIS WEEK — web shows the FULL week (rest/mobility as recessive tiles);
          mobile shows only WORKOUT days and summarizes rest/mobility in the header
          (Emil design). Phosphor icons from the workout tiles; no dumbbell (STR text). */}
      {block?.weeks?.length > 0 && (() => {
        const wk = block.weeks[0];
        // SYNC (single source of truth): show the APPLIED planner week — what the calendar reflects,
        // including any swaps/edits the athlete made there — falling back to the freshly-generated
        // week only when nothing's been applied yet. Reconstructs the tile shape (type/mi/pace + the
        // strength double-flag) from the stored sessions so the plan tab and calendar never diverge.
        const toPlanDay = (day) => {
          const sess = daySessions(day);
          if (!sess.length) return { type: 'rest' };
          // Primary = the HIGHEST-PRIORITY session (the same dominant pick the calendar makes),
          // not just the first non-strength one — else a run+mobility day with mobility stored
          // first showed as "Recovery" here while the calendar correctly led with the run (Emil).
          const rank = (t) => (PLAN_PRIORITY[t] != null ? PLAN_PRIORITY[t] : 50);
          const primary = [...sess].sort((a, b) => rank(b.type) - rank(a.type))[0];
          const strengthAlso = sess.some(s => s.type === 'strength') && primary.type !== 'strength';
          return { type: primary.type, distanceMi: primary.distanceMi ?? null, durationMin: primary.durationMin ?? null, paceTarget: primary.paceTarget ?? null, strength: strengthAlso };
        };
        const appliedDays = (() => {
          try { const pw = getPlannerWeek(wk.weekKey); return (pw && Array.isArray(pw.days) && pw.days.some(d => d && daySessions(d).length)) ? pw.days.map(toPlanDay) : null; }
          catch { return null; }
        })();
        const days = (appliedDays || wk.days || []).map((d, i) => ({ d, i }));
        const isOff = ({ d }) => !d || d.type === 'rest' || d.type === 'mobility';
        // Completion overlay — the SAME per-day done/missed the calendar + mobile ticker read, so
        // the plan tab reflects reality (yesterday done, a missed run) instead of just the plan.
        let weekStatus = null;
        try { weekStatus = appliedDays ? summarizePlanWeek(new Date()) : null; } catch { weekStatus = null; }
        const statusOf = (i) => (weekStatus && weekStatus.days && weekStatus.days[i]) ? weekStatus.days[i].status : null;
        const RUN_SET = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit']);
        const plannedMi = weekStatus && weekStatus.totals ? Math.round(weekStatus.totals.runMiles) : Math.round(wk.targetWeeklyMiles);
        let doneMi = 0, missedCount = 0;
        if (weekStatus) days.forEach(({ d, i }) => {
          const st = statusOf(i);
          if (st === 'done' && RUN_SET.has(d.type)) doneMi += Number(d.distanceMi) || 0;
          if (st === 'missed') missedCount += 1;
        });
        const offDays = days.filter(isOff);
        const workoutDays = days.filter(x => !isOff(x));

        // A full workout tile: day (+STR) / icon+type+mileage / effort or structure tag.
        // Quality days (tempo/intervals) show their structure tag and are tappable
        // to open the effort-silhouette drill-down below.
        const WorkoutTile = ({ d, i }) => {
          const c = SESSION_COLOR[d.type] || '#5eead4';
          const name = nameOf(d.type);
          const pace = paceForType(d.type);   // derive from type, not the stored (possibly stale) paceTarget
          // Miles belong to run-family sessions only. A cross-train type ignores any leftover
          // distanceMi (e.g. a Tempo→Bike swap that predates the duration fix) — Emil.
          const isRunFam = RUN_TYPES.has(d.type) || d.type === 'race' || d.type === 'run';
          const mi = isRunFam ? d.distanceMi : null;
          const durMin = Number(d.durationMin) || 0;   // cross-train (bike/pool/…) is time-based, not miles
          const str = d.strength && d.type !== 'strength';
          const structure = QUALITY_TYPES.has(d.type) ? buildQualityStructure({ type: d.type, phase: wk.phase, paces, seed: i }) : null;
          const aggr = !!injury && sessionAggravatesInjury(d.type, injury);
          const isOpen = openSession === i;
          const status = statusOf(i);   // done | missed | today | upcoming | null
          return (
            <div key={i} onClick={() => { setAdaptOpen(false); setOpenSession(isOpen ? null : i); }}
              title={structure ? 'Tap for the workout structure' : 'Tap for the session detail'}
              style={{ position: 'relative', overflow: 'hidden', borderRadius: 11, padding: '9px 10px', minHeight: 80, display: 'flex', flexDirection: 'column', gap: 5, background: `linear-gradient(160deg, ${c}1f, transparent 72%)`, border: `0.5px solid ${status === 'today' ? '#5eead4' : isOpen ? c : c + '44'}`, opacity: status === 'missed' ? 0.5 : 1, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 18 }}>
                <span title={aggr ? `Aggravates your ${injury}` : undefined} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: aggr ? '#fbbf24' : 'var(--text-muted)' }}>{DAY_LABELS[i]}{aggr ? ' ⚠' : ''}</span>
                {/* Top-right corner, CONSISTENTLY: the STR chip whenever there's a strength double
                    (quality days too — it sits next to the silhouette, not hidden by it), plus the
                    effort silhouette on quality days. One home for the lift indicator on every tile. */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                  {str && <span style={{ fontSize: 8, fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.16)', borderRadius: 4, padding: '1px 5px' }}>STR</span>}
                  {structure && <span style={{ width: isMobile ? 50 : 84, flex: 'none' }}><WorkoutSilhouette profile={structure.profile} color={c} height={isMobile ? 16 : 22} /></span>}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <SessionGlyph type={d.type} color={c} size={15} />
                <span style={{ fontSize: 12, fontWeight: 600, color: c, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                {status === 'done' && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#34d399', fontWeight: 700, flex: 'none' }}>✓</span>}
                {status === 'missed' && <span style={{ marginLeft: 'auto', fontSize: 8, color: '#f87171', fontWeight: 700, flex: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}>missed</span>}
              </div>
              {/* bottom row — effort/tag on the left, mileage big on the bottom-right */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 5, marginTop: 'auto' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  {structure
                    ? <span style={{ fontSize: 9, fontWeight: 700, color: c, background: `${c}1e`, borderRadius: 4, padding: '1px 5px' }}>{structure.tag} ▸</span>
                    : (pace
                        ? <><Lightning size={11} color="rgba(255,255,255,0.5)" weight="fill" /><span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{pace}</span></>
                        : (d.type === 'strength' ? <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>~45 min</span> : null))}
                </span>
                {mi != null
                  ? <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 0.9 }}>{mi}<span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500 }}>mi</span></span>
                  : (durMin > 0 && <span style={{ fontSize: 20, fontWeight: 800, lineHeight: 0.9 }}>{durMin}<span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 500 }}> min</span></span>)}
              </div>
            </div>
          );
        };

        // A recessive RECOVERY tile — rest and mobility are one bucket; the athlete
        // elects rest or a light mobility session. Web full-week only.
        const OffTile = ({ i }) => {
          const c = '#34d399';
          return (
            <div key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 11, padding: '9px 10px', minHeight: 80, display: 'flex', flexDirection: 'column', gap: 5, border: '0.5px dashed rgba(255,255,255,0.08)', opacity: 0.7 }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', height: 16 }}>{DAY_LABELS[i]}</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SessionGlyph type="mobility" color={c} size={15} />
                <span style={{ fontSize: 12, fontWeight: 600, color: c }}>Recovery</span>
              </span>
              <div style={{ fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.2 }}>rest or 15-min mobility — your call</div>
            </div>
          );
        };

        // Header recovery chip (mobile).
        const OffChip = ({ i }) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: 'var(--text-muted)', textTransform: 'none' }}>
            <span>·</span><b style={{ color: 'var(--text-muted)' }}>{DAY_LABELS[i]}</b>
            <SessionGlyph type="mobility" color="#34d399" size={12} />
            Recovery
          </span>
        );

        return (
          <div style={{ marginTop: 13 }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, fontSize: 9, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              <span style={{ fontWeight: 700 }}>
                {startDate > localDate() ? `Week 1 · starts ${fmtWk(startDate)}` : 'This week'} · {weekStatus ? `${Math.round(doneMi)} / ${plannedMi}` : plannedMi} mi
              </span>
              {missedCount > 0 && <span style={{ color: '#f87171', fontWeight: 600 }}>· {missedCount} missed</span>}
              {isMobile && offDays.map(OffChip)}
            </div>
            {isMobile ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {workoutDays.map(WorkoutTile)}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
                {days.map((x) => (isOff(x) ? OffTile(x) : WorkoutTile(x)))}
              </div>
            )}
            {/* Session drill-down — tap any workout tile. Quality → the effort
                silhouette + shorthand; easy/long → the purpose + target pace. */}
            {openSession != null && (() => {
              // Read the SAME applied week the tiles render (not the generated block) — else a
              // swapped session (e.g. intervals moved to Thu) opens the generated day at that
              // index (Recovery → blank), which is exactly the "tap Thu, nothing / wrong day" bug.
              const od = (appliedDays || wk.days || [])[openSession];
              if (!od || od.type === 'rest' || od.type === 'mobility') return null;
              const c = SESSION_COLOR[od.type] || '#5eead4';
              const s = QUALITY_TYPES.has(od.type) ? buildQualityStructure({ type: od.type, phase: wk.phase, paces, seed: openSession }) : null;
              const _pRaw = intentFor(od)?.purpose || '';
              const purpose = _pRaw ? _pRaw.charAt(0).toUpperCase() + _pRaw.slice(1) : '';   // sentences/labels start capitalized
              const durMin = Number(od.durationMin) || 0;   // cross-train is time-based (no miles/pace)
              const odMi = (RUN_TYPES.has(od.type) || od.type === 'race' || od.type === 'run') ? od.distanceMi : null;
              const bodyPurpose = purpose || (durMin && od.type !== 'strength' ? 'Aerobic cross-training' : '');
              return (
                <div style={{ background: 'rgba(255,255,255,0.02)', border: `0.5px solid ${c}40`, borderRadius: 12, padding: '11px 13px', marginTop: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: c }}>{DAY_LABELS[openSession]} · {nameOf(od.type)}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{purpose.split(',')[0] || ''}{odMi ? ` · ~${odMi} mi` : (durMin ? ` · ${durMin} min` : '')}</span>
                  </div>
                  {/* Execution score — for a PAST day, how the logged run matched the plan. */}
                  {(() => {
                    let execution = null;
                    try {
                      const dd = new Date(wk.weekKey + 'T12:00:00'); dd.setDate(dd.getDate() + openSession);
                      const dayDate = dd.toISOString().slice(0, 10);
                      if (dayDate < localDate()) {
                        const act = (allActivities() || []).find(a => a.date === dayDate && Number(a.distanceMi) >= 0);
                        if (act) execution = scoreSession({ planned: { type: od.type, distanceMi: od.distanceMi, paceTarget: od.paceTarget }, actual: { distanceMi: act.distanceMi, avgPaceRaw: act.avgPaceRaw, durationSecs: act.durationSecs } });
                      }
                    } catch { /* no score */ }
                    if (!execution || execution.score == null) return null;
                    const vc = { nailed: '#34d399', solid: '#5eead4', partial: '#fbbf24', off: '#f87171' }[execution.verdict] || 'var(--text-muted)';
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 10 }}>
                        <span style={{ fontWeight: 700, color: vc, textTransform: 'capitalize' }}>Executed · {execution.verdict}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{execution.score}/100</span>
                      </div>
                    );
                  })()}
                  {s ? (
                    <>
                      <WorkoutSilhouette profile={s.profile} color={c} />
                      <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' }}>{s.shorthand}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', lineHeight: 1.45, marginTop: 7 }}>
                      {bodyPurpose}{paceForType(od.type) ? ` · ${odMi ? odMi + ' mi ' : ''}@ ${paceForType(od.type)}/mi` : (od.type === 'strength' ? ' · ~45 min' : (durMin ? ` · ${durMin} min` : ''))}
                    </div>
                  )}
                  {/* Adaptation ladder (3.2d) — "can't do it today?" → ranked swaps
                      that protect the session's intent, from the sessionAdapt engine. */}
                  {onChangeSession && (() => {
                    // Unified: the ONE Change window (move / change the workout / skip) — this used
                    // to be a read-only ladder; the options now live in the window (same as the calendar).
                    let aggr = false; try { aggr = !!injury && sessionAggravatesInjury(od.type, injury); } catch { aggr = false; }
                    const _cd = new Date(wk.weekKey + 'T12:00:00'); _cd.setDate(_cd.getDate() + openSession);
                    const dStr = `${_cd.getFullYear()}-${String(_cd.getMonth() + 1).padStart(2, '0')}-${String(_cd.getDate()).padStart(2, '0')}`;
                    return (
                      <div style={{ marginTop: 9, paddingTop: 9, borderTop: '0.5px solid var(--border-subtle)' }}>
                        {aggr && <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 6, lineHeight: 1.4 }}>⚠ Protecting your {injury} — this session aggravates it.</div>}
                        <button className="arnold-compact-btn" onClick={() => onChangeSession(dStr)}
                          style={{ all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '4px 11px', borderRadius: 999, color: aggr ? '#fbbf24' : '#5eead4', background: 'rgba(94,234,212,0.10)', border: '0.5px solid rgba(94,234,212,0.30)' }}>
                          ↻ {aggr ? 'Protect it — change this session' : 'Change this session'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
            {offDays.length === 0 && (
              <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 7, lineHeight: 1.4 }}>
                No recovery day this week — I'd protect one for adaptation; recovery is where the training sticks.
              </div>
            )}
            <div style={{ fontSize: 9.5, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.4 }}>
              🧘 Add ~10 min mobility on most days — even workout days keep you loose and injury-proof.
            </div>
          </div>
        );
      })()}

      {/* THE ARC — a real mileage curve (rise → peak → taper), phase-tinted + apply */}
      {block?.weeks?.length > 0 && (() => {
        const wks = block.weeks, n = wks.length;
        const peak = Math.max(1, ...wks.map(w => w.targetWeeklyMiles || 0));
        const W = 100, H = 30, PAD = 2;
        const pts = wks.map((w, i) => ({
          x: n > 1 ? (i / (n - 1)) * W : W / 2,
          y: H - PAD - ((w.targetWeeklyMiles || 0) / peak) * (H - PAD * 2),
          w,
        }));
        const peakIdx = wks.reduce((bi, w, i, arr) => (w.targetWeeklyMiles > (arr[bi].targetWeeklyMiles || 0) ? i : bi), 0);
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
        const area = `${line} L${W},${H} L0,${H} Z`;
        return (
          <div style={{ marginTop: 15 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>THE ARC</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{n}wk · <b style={{ color: 'var(--text-primary)' }}>peak {Math.round(peak)} mi</b></span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 46, display: 'block' }}>
              <defs>
                <linearGradient id="arcFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5eead4" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#5eead4" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#arcFill)" />
              <path d={line} fill="none" stroke="#5eead4" strokeWidth="1.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            <div style={{ display: 'flex', gap: 10, marginTop: 11, alignItems: 'center', flexWrap: 'wrap' }}>
              {!pasted && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <input type="checkbox" className="arnold-compact-input" checked={overwrite} onChange={e => setOverwrite(e.target.checked)}
                    style={{ width: 15, height: 15, minHeight: 0, flex: 'none', margin: 0, padding: 0, accentColor: '#5eead4' }} />
                  Overwrite days I've hand-edited
                </label>
              )}
              {pasted && <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>✓ on your calendar</span>}
              <span style={{ flex: 1 }} />
              {pasted
                ? <button className="arnold-compact-btn" onClick={removeFromCalendar} style={dangerBtn}>Remove from calendar</button>
                : <button className="arnold-compact-btn" onClick={apply} style={pasteBtn}>Apply {block.weeks.length} wk{block.weeks.length === 1 ? '' : 's'} to calendar</button>}
            </div>
          </div>
        );
      })()}

      {/* Adjust — the old config, demoted. Power users can reshape + regenerate. */}
      <div onClick={() => setExpanded(e => !e)} style={{ ...adjustRow, marginTop: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Adjust plan</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12, transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}>▼</span>
      </div>
      {expanded && (() => {
        const card = { border: '0.5px solid var(--border-subtle)', borderRadius: 10, padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 9 };
        const hdr = { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase' };
        const opt = <span style={{ textTransform: 'none', opacity: 0.6, fontWeight: 400 }}> · optional</span>;
        const dayRow = { display: 'flex', gap: 4, flexWrap: 'wrap' };
        return (
        <div style={{ marginTop: 10 }}>
          {/* Compartments — four quadrants, controls at natural size (no stretching). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignItems: 'start' }}>

            {/* ── GOAL ── */}
            <div style={card}>
              <div style={hdr}>Goal</div>
              <label style={field}><span style={lbl}>Build toward</span>
                <select className="arnold-compact-input" value={target} onChange={e => { setTarget(e.target.value); generate(e.target.value); }} style={sel}>
                  <option value="1">This week only</option>
                  <option value="next-race">Next race</option>
                  <option value="4">Next 4 weeks</option>
                  <option value="8">Next 8 weeks</option>
                  <option value="12">Next 12 weeks</option>
                  {futureRaces.length > 0 && <option disabled>──────────</option>}
                  {futureRaces.map(r => <option key={r.date} value={`race:${r.date}`}>{r.name || 'Race'} · {fmtWk(r.date)}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={field}><span style={lbl}>Start</span>
                  <select className="arnold-compact-input" value={startDate} onChange={e => setStartDate(e.target.value)} style={sel}>
                    {startDateOptions().map(o => <option key={o.iso} value={o.iso}>{o.label}</option>)}
                  </select>
                </label>
                {target.startsWith('race:') && (
                  <label style={field}><span style={lbl}>Goal time</span>
                    <input type="text" className="arnold-compact-input" value={goalInput} placeholder="e.g. 3:30"
                      onChange={e => setGoalInput(e.target.value)} onBlur={commitGoal}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitGoal(); } }}
                      style={{ ...num, width: 92 }} />
                  </label>
                )}
              </div>
              {target.startsWith('race:') && !goalInput && (
                <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.4 }}>⚠ No goal time — enter one (e.g. 3:30) to size the peak to your goal.</div>
              )}
            </div>

            {/* ── SCHEDULE ── */}
            <div style={card}>
              <div style={hdr}>Schedule</div>
              <div><div style={lbl}>Days you can train</div>
                <div style={{ ...dayRow, marginTop: 4 }}>
                  {DAY_LABELS.map((d, i) => (
                    <button key={i} className="arnold-compact-btn" onClick={() => toggleDay(i)} style={{
                      ...chip,
                      background: avail.includes(i) ? 'rgba(94,234,212,0.14)' : 'transparent',
                      color: avail.includes(i) ? '#5eead4' : 'var(--text-muted)',
                      borderColor: avail.includes(i) ? 'rgba(94,234,212,0.4)' : 'var(--border-default)',
                    }}>{d}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label style={field}><span style={lbl}>Run days</span>
                  <input className="arnold-compact-input" type="number" min={1} max={7} value={runDays} onChange={e => setRunDays(clampNum(e.target.value, 1, 7))} style={num} /></label>
                <label style={field}><span style={lbl}>Strength / wk</span>
                  <input className="arnold-compact-input" type="number" min={0} max={7} value={strengthDays} onChange={e => setStrengthDays(clampNum(e.target.value, 0, 7))} style={num} /></label>
                <label style={field}><span style={lbl}>Focus</span>
                  <select className="arnold-compact-input" value={focus} onChange={e => setFocus(e.target.value)} style={sel}>
                    {FOCI.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select></label>
              </div>
            </div>

            {/* ── EQUIPMENT ── what you can cross-train on; gates the coach's swap options so it
                 never offers a pool you don't have (session agility). */}
            <div style={card}>
              <div style={hdr}>Equipment</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: -2 }}>
                What can you train on? The coach only offers swaps to gear you actually have.
              </div>
              <div style={{ ...dayRow, marginTop: 4 }}>
                {MODALITIES.map((k) => (
                  <button key={k} className="arnold-compact-btn" onClick={() => toggleModality(k)} style={{
                    ...chip,
                    background: modalities[k] ? 'rgba(94,234,212,0.14)' : 'transparent',
                    color: modalities[k] ? '#5eead4' : 'var(--text-muted)',
                    borderColor: modalities[k] ? 'rgba(94,234,212,0.4)' : 'var(--border-default)',
                  }}>{MODALITY_LABEL[k]}</button>
                ))}
              </div>
            </div>

            {/* ── DAY PREFERENCES ── */}
            <div style={card}>
              <div style={hdr}>Day preferences</div>
              <div><div style={lbl}>Long run day{opt}</div>
                <div style={{ ...dayRow, marginTop: 4 }}>
                  <button className="arnold-compact-btn" onClick={() => setLongRunDow(null)} style={{ ...chip, background: longRunDow == null ? 'rgba(96,165,250,0.14)' : 'transparent', color: longRunDow == null ? '#60a5fa' : 'var(--text-muted)', borderColor: longRunDow == null ? 'rgba(96,165,250,0.4)' : 'var(--border-default)' }}>Auto</button>
                  {DAY_LABELS.map((d, i) => (
                    <button key={i} className="arnold-compact-btn" disabled={!avail.includes(i)} onClick={() => setLongRunDow(longRunDow === i ? null : i)} style={{
                      ...chip, opacity: avail.includes(i) ? 1 : 0.35,
                      background: longRunDow === i ? 'rgba(96,165,250,0.14)' : 'transparent',
                      color: longRunDow === i ? '#60a5fa' : 'var(--text-muted)',
                      borderColor: longRunDow === i ? 'rgba(96,165,250,0.4)' : 'var(--border-default)',
                    }}>{d}</button>
                  ))}
                </div>
              </div>
              <div><div style={lbl}>Strength days{opt}</div>
                <div style={{ ...dayRow, marginTop: 4 }}>
                  {DAY_LABELS.map((d, i) => {
                    const on = strengthDows.includes(i);
                    return (
                      <button key={i} className="arnold-compact-btn" disabled={!avail.includes(i)} onClick={() => setStrengthDows(prev => on ? prev.filter(x => x !== i) : [...prev, i].sort((a, b) => a - b))} style={{
                        ...chip, opacity: avail.includes(i) ? 1 : 0.35,
                        background: on ? 'rgba(167,139,250,0.16)' : 'transparent',
                        color: on ? '#a78bfa' : 'var(--text-muted)',
                        borderColor: on ? 'rgba(167,139,250,0.4)' : 'var(--border-default)',
                      }}>{d}</button>
                    );
                  })}
                </div>
              </div>
              {(() => {
                const w0 = block?.weeks?.[0]?.days || [];
                const clash = w0.some(d => d && d.strength && (d.type === 'tempo' || d.type === 'intervals' || d.type === 'long_run'));
                return clash ? <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.4 }}>⚠ A strength day lands on a hard/long run — kept per your choice; the coach would space them.</div> : null;
              })()}
            </div>

            {/* ── HEALTH ── */}
            <div style={card}>
              <div style={hdr}>Health</div>
              <label style={field}><span style={lbl}>Injury / niggle</span>
                <select className="arnold-compact-input" value={injury} onChange={e => setInjuryStore(e.target.value)} style={sel}>
                  <option value="">None (healthy)</option>
                  {Object.entries(INJURY_LIBRARY).map(([id, v]) => <option key={id} value={id}>{v.label}</option>)}
                </select></label>
              {injury && INJURY_LIBRARY[injury]
                ? <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.4 }}>⚠ {INJURY_LIBRARY[injury].note}</div>
                : <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>Set a niggle to protect the sessions it aggravates; back to <b>None</b> when it clears.</div>}
            </div>
          </div>

          {/* Footer — regenerate + your training paces */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button className="arnold-compact-btn" onClick={() => generate()} style={primaryBtn}>Regenerate</button>
            {paces && (
              <div style={{ flex: 1, minWidth: 220, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)' }}>
                <span><b style={{ color: '#5eead4' }}>Easy</b> {fmtPaceMi(paces.easy) || '—'}</span>
                <span><b style={{ color: '#60a5fa' }}>Long</b> {fmtPaceMi(paces.long) || '—'}</span>
                <span><b style={{ color: '#fbbf24' }}>Tempo</b> {fmtPaceMi(paces.tempo) || '—'}</span>
                <span><b style={{ color: '#fb7185' }}>Interval</b> {fmtPaceMi(paces.interval) || '—'}</span>
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}

function Stat({ val, unit, label, align, color }) {
  return (
    <div style={{ textAlign: align || 'left' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || 'var(--text-primary)', lineHeight: 1 }}>{val}<span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{unit}</span></div>
      <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</div>
    </div>
  );
}

const card = { background: 'var(--bg-surface)', border: '0.5px solid var(--border-default)', borderLeft: '2px solid #5eead4', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: 10 };
const adjustRow = { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderTop: '0.5px solid var(--border-subtle)', paddingTop: 10 };
const lbl = { fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' };
const field = { display: 'flex', flexDirection: 'column', gap: 3 };
const chip = { all: 'unset', cursor: 'pointer', fontSize: 11, padding: '4px 9px', borderRadius: 6, border: '0.5px solid var(--border-default)', textAlign: 'center' };
const num = { width: 54, fontSize: 13, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, outline: 'none' };
const sel = { fontSize: 12, padding: '4px 8px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '0.5px solid var(--border-default)', borderRadius: 4, cursor: 'pointer' };
const primaryBtn = { all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 600, padding: '6px 16px', borderRadius: 6, background: 'rgba(94,234,212,0.14)', color: '#5eead4', border: '0.5px solid rgba(94,234,212,0.4)' };
const pasteBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '5px 14px', borderRadius: 6, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', border: '0.5px solid rgba(96,165,250,0.3)' };
const dangerBtn = { all: 'unset', cursor: 'pointer', fontSize: 10, fontWeight: 600, padding: '5px 12px', borderRadius: 6, background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '0.5px solid rgba(239,68,68,0.3)' };

export default LivingPlan;
