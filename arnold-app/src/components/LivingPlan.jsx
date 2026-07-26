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
import { localDate, fmtFinish } from '../core/time.js';
import { DAY_LABELS, getPlannerWeek, daySessions } from '../core/planner.js';
import { summarizePlanWeek } from '../core/planWeekSummary.js';   // per-day done/missed status (same source as calendar + mobile ticker)
// recentRunStats = the ONE 28-day mean (chronic load). rampBaseMi = the ONE ramp start
// (median of the last four complete weeks). Two questions, two names, one module.
import { getSeasonCoach, recentRunStats, rampBaseMi } from '../core/seasonCoach.js';
import { saveRaces } from '../core/memory.js';
import { resolveTrainingProfile } from '../core/trainingProfile.js';
import { intentFor, buildSessionOptions } from '../core/sessionAdapt.js';
import { getModalities, setModalities, MODALITIES, MODALITY_LABEL } from '../core/modalities.js';
import { sessionAggravatesInjury, INJURY_LIBRARY } from '../core/injury.js';
import { volumeReadout } from '../core/volumeModel.js';
import { useStorageVersion } from '../hooks/useStorageVersion.js';   // makes the plan react to logged runs (living)
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
import { resolveZones } from '../core/zones.js';   // the app's ONE easy ceiling — target HR + easy-run evaluation
import { CoachComment } from './CoachComment.jsx';   // plan-vs-execution oversight voice (narrative engine)
import { getRaceOutlook } from '../core/derive/raceOutlookLive.js';   // ONE live read — clamps the plan's build-target to the evidence-backed Target
import { resolveARace } from '../core/aRace.js';   // THE one A-race definition — shared with the outlook, goalResolve and raceRecipe
// The ladder options as OPTIONS: what each finish time demands in volume, and whether the athlete's
// demonstrated capacity can actually get there. One module, one verdict — the dropdown below and the
// coach's recalibration card both read these same rows rather than each deciding "reachable" for itself.
import { tierFeasibility, demonstratedVolume, recommendedTier, TIER_LABEL, recalibrationVerdict } from '../core/tierFeasibility.js';
import { getCommitment, setCommitment, clearCommitment, commitmentAppliesTo } from '../core/planCommitment.js';
import { planAdherence } from '../core/planAdherence.js';   // planned-vs-actual per week — the evidence the recalibration speaks from
// The tier TRIAD. Emil's design: "3-4 mileage numbers on each run day, that move with the
// session ... so the runner knows what tier they are hitting." solveRampForPeak is the piece
// that makes those numbers differ at all — before it, every option was built at the same
// hard-coded 10%/wk ramp and therefore reached the same peak, which is exactly why picking a
// faster finish time appeared to change nothing.
import { buildTierTriad, mergeTriadWeeks, weekBudgetStatus, solveRampForPeak, packTriad, refreshTriadForward, classifySessionRung, RUNG_ORDER, RUNG_LABEL } from '../core/planTiers.js';
// The rebase loop: did you actually run the rung you were shown? Reads the FROZEN triad off
// the commitment and joins it to logged runs — never recomputes what a past week's Reach was.
import { tierProgress } from '../core/tierProgress.js';

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
// The triad's three rungs, as colour. Deliberately NOT the session colours: the rung is a
// property of the CHOICE, not of the workout, and painting "reach" in long-run blue would
// make the ladder read as a second kind of session. Muted → teal → amber is the same
// escalation grammar the rest of the app already uses for effort.
const RUNG_TONE = { baseline: '#94a3b8', reach: '#5eead4', challenge: '#e0b45e' };
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
    // Was that target CHOSEN by the athlete (dropdown / tap-a-race), or just whatever the auto-default
    // computed on mount? Until 2026-07 there was no distinction: the mount auto-generate persisted its own
    // default straight back into planPrefs, so a bad default became a sticky "user preference" that outlived
    // the bug that produced it. Only an explicit pick is honored now; an inherited one is re-resolved.
    targetExplicit: !!p.targetExplicit,
    // Which option of the outlook ladder the plan builds toward ('current'|'target'|'stretch'|'goal'|'ceiling').
    // null = let the coach pick the honest default (recommendedTier). Same explicit-vs-inherited discipline as
    // `target` above: an option the athlete never chose must never harden into a preference.
    tier: p.tier || null,
    tierExplicit: !!p.tierExplicit,
    // The athlete's own typed finish time, when they have entered one. Persisted so the
    // option they created still exists on the ladder after a reload — a goal you have to
    // re-type every session is not a goal the app is holding for you.
    customGoalSecs: Number(p.customGoalSecs) > 0 ? Number(p.customGoalSecs) : null,
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
// One formatter for every finish time in the app — see core/time.js fmtFinish for why it
// truncates. This used to be a local Math.round copy, which is how EdgeIQ came to print
// 3:48 while this card printed 3:49 for the same goal.
const fmtGoal = fmtFinish;
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
  const storageVersion = useStorageVersion();
  // CalendarTab mounts <LivingPlan/> with NO races prop, so this falls through to storage — and the memo used
  // to key only on `propRaces`, which therefore never changed. The list the generator periodizes around was
  // frozen at mount: add Berlin and the plan kept building around whatever races existed when the tab opened.
  //
  // Re-reading on every storage write would fix that but hand back a NEW array each time, re-running the
  // (expensive) season-coach read on every planner/activity write. So the raw read is keyed on the storage
  // version while the exported `races` is keyed on a CONTENT signature: identity changes when the race list
  // actually changes, and not one write sooner. `seasonSig` below extends the same signature with goal times.
  const rawRaces = useMemo(() => {
    const r = (propRaces && propRaces.length) ? propRaces : (() => { try { return storage.get('races') || []; } catch { return []; } })();
    return r.filter(x => x && x.date);
  }, [propRaces, storageVersion]);
  const racesSig = rawRaces.map(r => `${r.date}:${r.name || ''}:${r.goalTimeSecs || 0}:${r.distanceMi || 0}:${r.priority || ''}`).sort().join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const races = useMemo(() => rawRaces, [racesSig]);
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
        // THE STALE-CALENDAR BUG (Emil, 2026-07: "The actual Calendar is not updated either").
        // This used to try `priority === 'A'` FIRST over a date-ASCENDING list. But the race editor
        // defaults EVERY race to priority 'A' — all 12 of Emil's are 'A' — so that first clause always
        // matched the SOONEST race, whatever it was: on 2026-07-25 that's the Harlem 5K (Aug 8), three
        // weeks out. The Calendar then built a 3-week block toward a 5K — and since the living re-sync only
        // rewrites weeks INSIDE the block, the other 17 weeks of the marathon season kept whatever numbers
        // were written the last time a full block ran (in Emil's export: every week from Aug 10 on still
        // stamped generatedAt 2026-07-13, storing 22/50/51/52/42/32/28 mpw where the real road says
        // 48/38/48/48/48/38/48). The days were there; they had just stopped being updated.
        // core/aRace.js is the app's ONE definition and puts `priority` LAST for exactly this reason:
        // the race you set a GOAL TIME on is the race you're training for → Valencia. Same resolver the
        // outlook uses, so the EdgeIQ ladder and the Calendar can no longer name different races.
        const a = resolveARace(futureRaces, localDate(), (() => { try { return getGoals()?.aRaceDate || null; } catch { return null; } })());
        return a ? `race:${a.date}` : 'next-race';
      })();
  // A saved EXPLICIT choice wins over the computed default — otherwise picking Valencia reverts on every
  // remount. But an auto-persisted default does NOT win (see loadPrefs): that's what let the priority-first
  // bug freeze the calendar on a 5K and then keep it there even after the picker was fixed.
  // Honor a saved target only if it was EXPLICIT and its race is still ahead — a target whose race has
  // already been run is stale by definition. Resolved here, before the mount generate reads it, so there's
  // no second render pass and no block built toward a date in the past.
  const savedTargetUsable = init.targetExplicit && init.target
    && (!init.target.startsWith('race:') || init.target.slice(5) >= localDate());
  const targetExplicit = useRef(!!savedTargetUsable);
  const [target, setTarget] = useState(savedTargetUsable ? init.target : defaultTarget);
  // The ladder option this plan builds toward. A saved option is honored only if it was an explicit pick
  // (see loadPrefs) — otherwise the coach re-resolves it every generate, so an option that has since gone
  // out of reach (or newly come into reach) is not carried forward on inertia.
  const tierExplicit = useRef(!!init.tierExplicit && !!init.tier);
  const [tier, setTier] = useState(init.tierExplicit ? init.tier : null);
  const [tierRows, setTierRows] = useState(null);      // one row per option: demand + delivery + verdict + why
  const [tierChosen, setTierChosen] = useState(null);  // the row the current block was actually built from
  // ── SHOW THE WORKING ────────────────────────────────────────────────────────────────────
  // Emil, 2026-07-25: "the Your Plan Tab under the Calendar is huge and reads like a Bible… Who
  // is going to read all of this information? There is way too much narrative for web and mobile."
  //
  // He is right, and the fix is NOT to delete the reasoning. Every paragraph on this card exists
  // because a number with no provenance is a number he cannot argue with — the base read, the
  // race-cost attribution, the not-advised list. Deleting them would trade one complaint for a
  // worse one. So they COLLAPSE instead: the card states the two or three numbers that actually
  // decide anything, and everything that explains where they came from lives one tap away, in
  // full, unchanged. Closed by default on every surface, because the default reader is Emil
  // glancing at his week, not Emil auditing the engine.
  const [showWork, setShowWork] = useState(false);
  // The triad: the committed option and the next two faster ones, each a REAL block from the
  // same generator, merged so one calendar week carries three numbers per run day.
  const [triad, setTriad] = useState(null);            // { rungs:[…], committedKey, ladderTopped }
  const [triadWeeks, setTriadWeeks] = useState(null);  // mergeTriadWeeks(rungs) — aligned by week key
  // The PACKED triad, held in a ref rather than state because commitTier fires inside the same
  // synchronous pass that builds it — a setState value is not readable there, and freezing last
  // render's triad onto this render's commitment would grade the athlete against numbers from a
  // plan he replaced a moment ago. The ref is written in the same breath as the state below.
  const triadPackRef = useRef(null);
  // Which rung the athlete is eyeing on each day of the week on screen: {dayIndex: rungKey}.
  // Deliberately NOT persisted and never written to the calendar. What tier you actually hit is
  // decided by the run you log, not by the number you tapped — Arnold derives, it does not ask.
  // This state exists so the weekly budget can answer "if I took these, is that still a week?"
  const [picks, setPicks] = useState({});
  // The athlete's OWN typed finish time, added 2026-07 for Emil's sub-3:40 Valencia target,
  // which fell between two published options and so could not be chosen at all. Held in a ref
  // as well as state because `generate()` is called from effects that close over a stale
  // render — the ref is what the generator reads, the state is what the input shows.
  const [customSecs, setCustomSecs] = useState(init.customGoalSecs || null);
  const customSecsRef = useRef(init.customGoalSecs || null);
  const [customDraft, setCustomDraft] = useState(init.customGoalSecs ? fmtGoal(init.customGoalSecs) : '');
  // How the volume base was derived, kept so the card can show the four weeks behind it.
  // A base that decides the whole build must never be a number from nowhere.
  const [baseRead, setBaseRead] = useState(null);
  // Does the block on screen match what is on the calendar? Emil: "I need to know when I pick
  // the plan ... is that when I need to regenerate the plan?" The answer should be visible,
  // not remembered — this drives the preview-vs-applied badge and the Apply CTA.
  const [dirty, setDirty] = useState(false);
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

  // LIVING trigger — a cheap signature of the athlete's ACTUAL training that changes
  // whenever a run is logged (count / latest date / total miles) or the calendar day
  // rolls over. The plan re-derives + re-anchors off THIS, so logging a run (or missing
  // one, seen at the next day-rollover) reshapes the ramp on its own — no button, no
  // "shock". Deliberately keyed on ACTIVITIES only (not the planner), so auto-applying
  // the recalibrated plan back to the calendar can't feed back into a re-derive loop.
  const liveSig = useMemo(() => {
    try {
      const a = storage.get('activities') || [];
      const total = a.reduce((s, x) => s + (Number(x.distanceMi) || 0), 0);
      return `${a.length}|${a[a.length - 1]?.date || ''}|${Math.round(total)}|${localDate()}`;
    } catch { return ''; }
  }, [storageVersion]);
  // SEASON signature — the other half of "living". liveSig covers what you RUN; this covers what you're
  // running TOWARD: the race list (dates + names) and the goal times on it. Until 2026-07 the re-derive
  // effect watched neither, so adding Berlin, deleting a race, or typing a new goal time changed nothing on
  // the calendar until you happened to touch a config knob or log a run — the plan was living in one
  // direction only. Safe to watch: the auto-apply writes 'planner', which is in neither signature, so this
  // can't feed back into a regenerate loop (the reason liveSig was activities-only in the first place).
  const seasonSig = useMemo(() => {
    try {
      const g = storage.get('goals') || {};
      return `${racesSig}#${g?.performance?.marathon?.targetSecs || g?.marathon?.targetSecs || ''}:${g?.aRaceDate || ''}`;
    } catch { return racesSig; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion, racesSig]);
  // Is the plan already LIVE on the calendar (has generated days in this block's range)?
  // Auto-apply only fires when it is — so an event-driven recalibration keeps an
  // already-applied plan in sync, but we never surprise-paste onto a plan you never applied.
  const plannerLiveInRange = (weeks) => {
    try {
      const planner = storage.get('planner') || {};
      return (weeks || []).some(w => { const wk = planner[w.weekKey]; return wk && Array.isArray(wk.days) && wk.days.some(d => d && d.generated); });
    } catch { return false; }
  };

  // Living reads: the marathon coach verdict + the recipe-path weak link. Re-reads on
  // liveSig so the coach's this-week target + feasibility track your actual runs.
  const coach = useMemo(() => { try { return getSeasonCoach(); } catch { return null; } }, [races, liveSig]);
  // The ONE easy ceiling (LT1) from the single source of truth — used both to SHOW the easy target HR on
  // the tile and to EVALUATE easy runs on zone discipline (not pace). One consistent voice for "easy".
  const zones = useMemo(() => { try { return resolveZones(); } catch { return null; } }, [races]);
  const easyCeil = zones && zones.z2Ceiling > 0 ? Math.round(zones.z2Ceiling) : null;
  const [profile, setProfile] = useState(null);
  const [goalVol, setGoalVol] = useState(null);   // goal-driven peak readout
  const [noBase, setNoBase] = useState(false);    // no logged running in 28d → we refuse to invent a volume base
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

  // `tier` is passed EXPLICITLY (not defaulted from state) so an option picked in the dropdown takes
  // effect on this pass rather than the next render — the same reason nextTarget is threaded through.
  // `undefined` means "no opinion, resolve it"; a string means "build this option".
  const generate = (nextTarget = target, { preview = true, autoApply = false, tier: nextTier } = {}) => {
    const goals = (() => { try { return getGoals(); } catch { return {}; } })();
    let p = null, easyMeta = null;
    try {
      const age = Number(goals.age) || Number((storage.get('profile') || {}).age) || null;
      const obs = observedEasyPaceSecs((() => { try { return allActivities(); } catch { return []; } })(), { age });
      p = pacesFromHubFacts(buildHubFromStorage().facts, { observedEasySecs: obs.secs });
      easyMeta = { source: obs.secs ? obs.source : 'vdot', n: obs.n };
    } catch {}
    setPaces(p ? { ...p, _easyMeta: easyMeta } : null);
    // ── VOLUME BASE — the single number the whole ramp climbs from. ──────────────────
    // It is ALWAYS what he actually ran (trailing 28 days ÷ 4), never a target, never a
    // constant. The old line here read `actualWeekly >= 3 ? actualWeekly : (goals
    // .weeklyRunDistanceTarget || 30)` — so ANY moment the memoized coach read came back
    // empty (mount race, a throw inside getSeasonCoach, a storage hiccup) the plan silently
    // built from a FABRICATED 30 mi/wk. That is exactly what produced the block stamped
    // 2026-07-13: 33 → 37 → 43 → 50 → 52, off a real base of ~12 mi/wk. A base he never ran
    // is not a conservative default, it's an injury prescription.
    //
    // Two reads of the SAME formula (core/seasonCoach.js#recentRunStats), not two formulas:
    // the coach memo when it's live, a direct re-read of the activity log when it isn't.
    // If BOTH say zero there is genuinely nothing logged — we refuse to generate rather
    // than invent a base.
    const logged = (() => {
      try { return recentRunStats(allActivities(), localDate()); }
      catch { return { weeklyMiles: 0, longestRecentMi: 0, runsLast28d: 0 }; }
    })();
    // ── 2026-07-25: the base is now the MEDIAN of the last four COMPLETE weeks, not the
    // trailing-28-day mean. Same source data, more robust statistic, and it fixes the exact
    // thing Emil reported ("even after I regenerate under Stretch I do not see the peak go to
    // 42"). His last four complete weeks were 0, 10.6, 19.0, 19.3 mi — one blank week. The
    // mean says 12.2 and the ramp then tops out at a 29 mi/wk peak NO MATTER WHICH OPTION IS
    // PICKED, which is precisely why the dropdown looked broken: every choice returned the
    // same plan because none of them was the binding constraint. The median says 14.8, and a
    // base of 19.3 reaches 44. One empty week four weeks ago was silently deciding whether
    // sub-3:40 was on the table. See core/seasonCoach.js#rampBaseMi for the full reasoning;
    // `recentRunStats` is untouched and still owns chronic load / ACWR.
    const rb = (() => {
      try {
        return rampBaseMi(allActivities(), localDate(), {
          demonstratedMi: demonstratedVolume(allActivities(), { today: localDate() }).bestBlockMi,
        });
      } catch { return null; }
    })();
    // The mean is the fallback, never the other way round: if the median read throws we would
    // rather build from a too-low honest number than from nothing.
    const actualWeekly = Number(rb?.baseMi) || Number(coach?.inputs?.weeklyMiles) || Number(logged.weeklyMiles) || 0;
    if (!(actualWeekly > 0)) {
      // No logged running in the trailing 28 days. Arnold derives, it doesn't guess.
      setNoBase(true); setBlock(null); setGoalVol(null);
      return null;
    }
    setNoBase(false);
    setBaseRead(rb);
    const weeklyMiles = Math.round(actualWeekly * 10) / 10;
    // Goal-driven peak: the ceiling comes from what the A-race goal REQUIRES —
    // not the athlete's current target (the old 1.4× cap made targeting a goal
    // do nothing). recommendedPeakMi maps goal marathon time → peak volume.
    // Read the target race + its goal FRESH from storage (so a goal just saved via
    // the Adjust field is seen this pass). Goal time = the race's goalTimeSecs, else
    // derived from your "Target marathon pace" goal.
    const freshRaces = (() => { try { return storage.get('races') || races; } catch { return races; } })();
    // Same rule as defaultTarget above: when no race is explicitly selected, the A-race comes from the ONE
    // resolver, never from an inline priority-first scan (every race is priority 'A', so that scan returned
    // whatever was soonest and sized the whole plan to a tune-up).
    const aRaceObj = nextTarget.startsWith('race:')
      ? freshRaces.find(r => r.date === nextTarget.slice(5))
      : resolveARace(freshRaces, localDate(), goals?.aRaceDate || null);
    let goalSecs = Number(aRaceObj?.goalTimeSecs) || null;
    // Fall back to the Performance-goals Marathon target (goals.marathon.targetSecs)
    // — that's where Emil's 3:29 lives, separate from the race's goalTimeSecs.
    if (!goalSecs && goals?.marathon && Number(goals.marathon.targetSecs) > 0) goalSecs = Number(goals.marathon.targetSecs);
    if (!goalSecs && goals.targetRacePace) {
      const [gm, gs] = String(goals.targetRacePace).split(':').map(Number);
      const spm = gm * 60 + (gs || 0);
      if (spm > 0) goalSecs = Math.round(spm * (Number(aRaceObj?.distanceMi) || 26.2));
    }
    // Build toward TARGET, never toward a fantasy. The raw goal (his 3:29) may be
    // BEYOND this cycle — building the peak straight to it prescribes a volume the
    // evidence doesn't support (Emil: "34 mpw can't run 3:29"). So clamp the plan's
    // build-target to the evidence-backed Target from the ONE live read: never build
    // FASTER than Target (anti-fantasy), never force him faster than his own goal
    // (respect a modest goal). Target already carries the promotion loop, so as he
    // proves absorption Target speeds up, the clamp relaxes, the peak rises, and the
    // goal "migrates forward" — the plan explores potential instead of guessing.
    //
    // ── THE TIER LADDER (2026-07, Emil: "I need options and I need a plan that provides"). ──
    // The clamp above answered ONE question — "is his goal a fantasy?" — with one number and no
    // recourse. It was right and it was useless: told 3:29 is out of reach, there was nothing to do
    // about it but accept 3:49. So the same ladder the outlook already publishes (current · target ·
    // stretch · goal · ceiling) is now offered as CHOICES, each priced in the only currency that
    // matters — weekly volume — and each judged against what he has demonstrably held.
    //
    // The clamp survives as the DEFAULT (recommendedTier is the fastest option that isn't a reach), so
    // nothing regresses for an athlete who never opens the dropdown. What changes is that the athlete
    // can now see the whole road and pick a harder one deliberately, and that an unreachable option
    // states its own price instead of just disappearing.
    //
    // Note what is NOT here: no second planning path. The option only decides which finish time feeds
    // buildGoalSecs. Everything downstream — volumeReadout, the ceiling, generateSeasonBlock — is
    // untouched, so there is still exactly one engine drawing exactly one plan.
    let buildGoalSecs = goalSecs, outlookTargetSecs = null, targetClamped = false;
    let rows = null, chosenRow = null;
    if (goalSecs) {
      try {
        const ro = getRaceOutlook();
        const entry = ro && ro.outlook && aRaceObj?.name ? ro.outlook.find(o => o.name === aRaceObj.name) : null;
        outlookTargetSecs = entry && entry.targetSecs > 0 ? entry.targetSecs : (ro?.ladder?.target > 0 ? ro.ladder.target : null);
        const ladder = ro?.ladder || null;
        if (ladder) {
          const acts = (() => { try { return allActivities(); } catch { return []; } })();
          const dv = demonstratedVolume(acts, { today: localDate() });
          const aRaceDate = aRaceObj?.date || null;
          const weeksToRace = aRaceDate
            ? Math.max(0, Math.round((new Date(`${aRaceDate}T12:00:00`) - new Date(`${localDate()}T12:00:00`)) / (7 * 86400000)))
            : 0;
          rows = tierFeasibility({
            ladder, baseMi: weeklyMiles, demonstratedMi: dv.bestBlockMi, weeksToRace,
            races: freshRaces, today: localDate(), aRaceDate,
            distanceMi: Number(aRaceObj?.distanceMi) || 26.2,
            // The athlete's own typed finish time, if they have entered one. Emil, 2026-07:
            // "A 19 week plan is pretty standard for marathon training, so I can try to get to
            // sub 3:40 in Valencia" — 3:40 sat between Stretch (3:46) and Goal (3:30) and so
            // was not on the ladder at all. It is priced by the same goalRequirements() call
            // and judged by the same evidence as every published option: an extra CHOICE, not
            // an extra model. tierFeasibility folds it in if it duplicates a published one.
            customSecs: customSecsRef.current || null,
          });
          // Carry the context of the read onto every row so the dropdown can show WHAT the verdict was
          // measured against, and so a commitment records the race it was made for. One pass, one truth.
          rows = rows.map(r => ({
            ...r, demonstratedMi: dv.bestBlockMi, atWeek: dv.atWeek, bestWeekMi: dv.bestWeekMi,
            baseMi: weeklyMiles, aRaceDate, aRaceName: aRaceObj?.name || null, lever: ro?.ladder?.lever || null,
          }));
          // Resolution order, most-deliberate first: the option just picked in the dropdown → the option
          // this component already has explicitly chosen → the option COMMITTED for this A-race → the
          // coach's honest default. The commitment sits above the default on purpose: once the plan is
          // on the calendar, a LIVING refresh must rebuild the option he agreed to, not quietly promote
          // him to a faster one because a good month moved recommendedTier.
          const committed = (() => { try { const c = getCommitment(); return commitmentAppliesTo(c, aRaceDate) ? c.tier : null; } catch { return null; } })();
          const asked = nextTier !== undefined ? nextTier
            : (tierExplicit.current && tier) ? tier
            : committed;
          // Every option is selectable now (Emil: "The Goal and the Ceiling are not available as
          // options"), so an asked-for option is simply honored. The only reason this can miss is
          // a saved key that no longer exists on the ladder — e.g. a custom time that has since
          // been cleared — and then the coach's default takes over.
          chosenRow = asked ? rows.find(r => r.key === asked) : null;
          if (!chosenRow) chosenRow = recommendedTier(rows);
        }
      } catch { /* no fitness state → no ladder; fall through to the raw goal */ }
      // With an option in hand the option IS the build target. Without one (no outlook yet, cold start)
      // the original anti-fantasy clamp still applies, unchanged.
      if (chosenRow) {
        buildGoalSecs = chosenRow.goalSecs;
        targetClamped = chosenRow.goalSecs > goalSecs;
      } else if (outlookTargetSecs && outlookTargetSecs > goalSecs) {
        buildGoalSecs = outlookTargetSecs; targetClamped = true;
      }
    }
    const vr = buildGoalSecs
      ? volumeReadout({ goalTimeSecs: buildGoalSecs, distanceMi: Number(aRaceObj?.distanceMi) || 26.2, currentWeeklyMi: weeklyMiles })
      : null;
    if (vr) { vr.buildGoalSecs = buildGoalSecs; vr.rawGoalSecs = goalSecs; vr.targetClamped = targetClamped; vr.tier = chosenRow || null; }
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
    // Seed the long run from your actual recent longest too — same rule, same source, and
    // likewise never from `goals.longRunTargetMi || 10` (a 10-mile long run you haven't run
    // is the same fabrication one axis over). We only get here with real logged running.
    const longestRecentMi = Number(coach?.inputs?.longestRecentMi) || Number(logged.longestRecentMi) || 0;
    // Pass the logged injury into the generator so a niggle actually reshapes the PLAN
    // (eases the sessions it aggravates across the block), not just the per-day swap modal.
    const base = { races, today: startDate, availableDays: avail, runDays, strengthDays, focus, paces: p, weeklyMiles, longestRecentMi, ceilingMiles, injury: injury || null, longRunDow: (longRunDow == null ? undefined : longRunDow), strengthDows: (strengthDows && strengthDows.length ? strengthDows : undefined) };
    const opts = nextTarget.startsWith('race:')
      ? { ...base, targetRaceDate: nextTarget.slice(5) }
      : { ...base, horizon: nextTarget === 'next-race' ? 'next-race' : parseInt(nextTarget, 10) };

    // ── ONE block generator, injected everywhere below ───────────────────────────────
    // (rampPct, minCeilingMi) => weeks[]. Every probe on this screen — the per-option
    // delivery check, the race-cost attribution, the three rungs of the triad, and the
    // block that actually lands on the calendar — goes through THIS function, so none of
    // them can be built from subtly different options than the one the athlete sees.
    // The ceiling floor rule is stated once here instead of being re-derived per probe.
    const ceilFloor = (minMi) => Math.max(Number(minMi) || 0, Number(goals.weeklyMileageCeiling) || 0, Math.round(weeklyMiles) || 0, 30);
    const buildBlockFor = (rampPct, minCeilingMi) => {
      try { return generateSeasonBlock({ ...opts, ceilingMiles: ceilFloor(minCeilingMi), maxRampPct: rampPct })?.weeks || []; }
      catch { return []; }
    };

    // ── THE FIX FOR "the peak doesn't move" ──────────────────────────────────────────
    // Emil: "even after I regenerate the plan under the stretch selection I do not see the
    // peak go to 42 miles." MEASURED (/tmp/rampsweep.mjs): the ramp step, not the ceiling,
    // was binding. seasonPlan.js climbed at a hard-coded 10%/wk, and with only ~12
    // progressing weeks surviving the two supported marathons, their recoveries, the
    // cut-backs and the taper, 14.8 × 1.10¹² = 35 and stops — below EVERY ceiling on the
    // ladder. So changing the option changed the ceiling and the ceiling changed nothing.
    //
    // Now the GOAL sets the ramp: solve for the smallest weekly step that genuinely
    // reaches this option's demanded peak, and judge THAT by ACWR — the constraint this
    // codebase already believes in — rather than by the 10% population heuristic. On
    // Emil's real ladder every option, including the 3:21 ceiling, solves to a steady-state
    // ACWR under 1.21, comfortably inside the 0.8–1.3 band (/tmp/triad.mjs §2).
    const chosenSolve = (chosenRow && chosenRow.peakMi > 0)
      ? solveRampForPeak({ buildBlock: buildBlockFor, targetPeakMi: chosenRow.peakMi })
      : null;
    const result = (chosenSolve && chosenSolve.rampPct != null)
      ? generateSeasonBlock({ ...opts, ceilingMiles: ceilFloor(chosenRow.peakMi), maxRampPct: chosenSolve.rampPct })
      : generateSeasonBlock(opts);
    setBlock(result);
    setPasted(false);

    // ── WANTS vs DELIVERS ─────────────────────────────────────────────────────────────
    // Emil: "even after I regenerate the plan under the stretch selection I do not see the
    // peak go to 42 miles." He was right, and the honest answer is not to force the ramp
    // higher — it is to stop quoting a peak the plan was never going to build. Each option
    // states a peak its finish time DEMANDS (`peakMi`, from goalRequirements). What the ramp
    // can actually CLIMB TO from today's base in the weeks remaining is a different number,
    // and until now nothing computed it, so the card advertised the demand and the calendar
    // delivered something else.
    //
    // So: run THE SAME engine, once per option — no second model, no estimate, no formula
    // that could drift from the generator. Whatever this returns is exactly what pressing
    // that option will put on the calendar, because it is literally the same call.
    //
    // v2 (2026-07): what varies per option is now the solved RAMP, not just the ceiling.
    // With the ceiling alone every row returned the identical 35 and the whole list looked
    // broken; solving each row's ramp is what makes the delivered peaks 36/41/42/44/48/51,
    // i.e. what each option actually asks for. ~6 solves × ~16 builds, ~90 ms measured on
    // the real 20-week Valencia block (/tmp/solve.mjs) — synchronous and cheap enough.
    //
    // The row's OWN peakMi is the target and the ceiling floor. It used to be re-derived
    // here through volumeReadout(); both that and tierFeasibility's row call the same
    // recommendedPeakMi(goalSecs, distanceMi), so this is the identical number with one
    // fewer place to disagree — the card prints r.peakMi, so the block must be built to it.
    if (rows && rows.length) {
      rows = rows.map((r) => {
        try {
          const solved = (r.key === chosenRow?.key && chosenSolve)
            ? chosenSolve                              // already solved for the chosen row — don't solve it twice
            : solveRampForPeak({ buildBlock: buildBlockFor, targetPeakMi: r.peakMi });
          return {
            ...r,
            rampPct: solved.rampPct, acwr: solved.acwr, rampBand: solved.band,
            rampWhy: solved.why, rampRefused: !!solved.refused,
            deliversPeakMi: solved.peakMi, deliversLongMi: solved.longestMi,
            shortfallMi: Math.max(0, r.peakMi - solved.peakMi),
          };
        } catch { return { ...r, deliversPeakMi: null, deliversLongMi: null, shortfallMi: null }; }
      });
      chosenRow = rows.find(r => r.key === chosenRow?.key) || chosenRow;

      // ── WHY IT FALLS SHORT ── two constraints, and telling them apart is the whole point.
      // A shortfall can come from where the ramp STARTS (a low base cannot climb far in the
      // weeks available) or from the SUPPORTED MARATHONS on the way (each costs its race week,
      // its recovery week, and the re-climb from the re-entry-capped resume value). So: build
      // the chosen option ONE more time with the supported marathons taken out, and let the
      // difference name itself. Same engine, one extra call.
      //
      // CRITICAL: this probe must use the SAME solved ramp as the block it is compared
      // against. Built at the old fixed 10% it measured the races as costing 16 mi/wk of
      // peak — a figure that was really measuring the ramp constant, not the races, because
      // at 10% the with-races run was pinned at 35 for reasons that had nothing to do with
      // Berlin or New York. Same ramp on both sides or the difference means nothing.
      if (chosenRow) {
        try {
          // Only the marathons INSIDE this block can cost it anything. The upper bound is not
          // pedantry: Emil has Tokyo on the calendar for 2027-03-07, three months past Valencia,
          // and without it the card would have named Tokyo as a reason his Valencia build falls
          // short — a true number with a false explanation attached, which is worse than no
          // explanation. Caught by /tmp/attrib.mjs.
          const supportedMarathons = (freshRaces || []).filter(r =>
            r && r.date && (Number(r.distanceMi) || 0) >= 24
            && r.date !== aRaceObj?.date && r.date >= startDate
            && (!aRaceObj?.date || r.date < aRaceObj.date));
          if (supportedMarathons.length) {
            const solo = generateSeasonBlock({
              ...opts,
              races: (freshRaces || []).filter(r => !supportedMarathons.includes(r)),
              ceilingMiles: ceilFloor(chosenRow.peakMi),
              maxRampPct: chosenSolve?.rampPct,   // undefined → the 10% default, same as before
            });
            const soloPeakMi = (solo?.weeks || []).length ? Math.max(0, ...solo.weeks.map(w => Number(w.targetWeeklyMiles) || 0)) : 0;
            chosenRow = {
              ...chosenRow,
              soloPeakMi,
              // What racing them costs THIS build, in mi/wk of peak. Never negative.
              raceCostMi: Math.max(0, soloPeakMi - (chosenRow.deliversPeakMi || 0)),
              costlyRaces: supportedMarathons.map(r => shortName(r.name || 'a marathon')),
            };
            rows = rows.map(r => (r.key === chosenRow.key ? chosenRow : r));
          }
        } catch { /* the attribution is commentary; the plan stands without it */ }
      }

      // Keep the volume readout pointing at the SAME row object the dropdown shows, so the
      // headline peak and the option's own delivered peak can never disagree.
      if (vr) { vr.tier = chosenRow || null; setGoalVol({ ...vr }); }

      // ── THE TRIAD ────────────────────────────────────────────────────────────────────
      // Emil's design, verbatim: "you need run a long run today — if you are following
      // baseline plan you run 10, if you run the reach plan you run 13 and if you want to
      // challenge yourself you run 15 ... so the runner knows what tier they are hitting."
      //
      // The rungs are the chosen option and the next two FASTER options, each built by this
      // same generator from this same base over this same race calendar — the only thing
      // that differs between them is the solved ramp. That is what makes "reach the long
      // run" a coherent week instead of a bigger number on one day, and it is why the
      // baseline rung comes out byte-identical to the block already on screen: it IS that
      // block, not a fourth parallel computation of it.
      try {
        const t = buildTierTriad({ rows, committedKey: chosenRow?.key || null, buildBlock: buildBlockFor });
        const tw = t.rungs.length ? mergeTriadWeeks(t.rungs) : null;
        setTriad(t);
        setTriadWeeks(tw);
        // Pack it NOW, while the rungs and the merged weeks are both in hand. packTriad keeps
        // only the days that are genuinely a ladder — tierable, a real spread, and monotone —
        // which is the same gate the tiles render behind, so what gets frozen is exactly what
        // the athlete was shown and nothing else.
        triadPackRef.current = (t.rungs.length && tw && tw.length) ? packTriad({ rungs: t.rungs, weeks: tw }) : null;
      } catch { setTriad(null); setTriadWeeks(null); triadPackRef.current = null; }
      setPicks({});   // a fresh plan is a fresh week — never carry yesterday's what-ifs onto it
    }
    setTierRows(rows);
    setTierChosen(chosenRow);
    // Only paint the calendar preview rings on an EXPLICIT (re)generate — not on the
    // auto-derive at mount, which otherwise circled every future day in blue permanently.
    if (preview) onPreview?.(result);
    try { storage.set('planPrefs', { availableDays: avail, runDays, strengthDays, focus, target: nextTarget, targetExplicit: targetExplicit.current, tier: chosenRow?.key || null, tierExplicit: tierExplicit.current, customGoalSecs: customSecsRef.current || null, startDate, longRunDow, strengthDows }, { skipValidation: true }); } catch {}
    // LIVING auto-apply — when the plan is already on your calendar, keep it in sync with
    // this recalibration automatically. 'refresh' RE-BASELINES the forward machine days to
    // the freshly-computed road (so a slower actual week pulls the whole road down, a strong
    // one lets it climb) while never touching the PAST and keeping your knee cross-swaps.
    // This is the fix for "the plan is static / needs a shock to wake up": every recompute
    // now writes through to the calendar instead of being discarded by fill-empty.
    if (autoApply && result?.weeks?.length && plannerLiveInRange(result.weeks)) {
      try {
        pasteSeasonBlock(storeApi(), result.weeks, { mode: 'refresh', today: localDate() });
        // Backfill only. A plan applied before commitments existed (or on a device that hasn't synced
        // one yet) would otherwise be coached against nothing. An EXISTING commitment for this race is
        // never overwritten here — a silent refresh must not be able to move the goalposts.
        if (chosenRow) {
          const cur = (() => { try { return getCommitment(); } catch { return null; } })();
          if (!commitmentAppliesTo(cur, chosenRow.aRaceDate)) commitTier(chosenRow, result.weeks);
          else refreshCommittedTriad(cur);
        }
        setPasted(true); setDirty(false); onApplied?.();
      } catch { /* keep the preview even if the silent apply fails */ }
    } else if (preview) {
      // An explicit regenerate that did NOT write through: the screen and the calendar have
      // diverged, and the card has to say so rather than let it be inferred.
      setDirty(true);
    }
    return result;
  };

  // ── window.livingPlanDebug() — inspect the road vs the calendar, from REAL data.
  // Dumps the races it's periodizing around, the freshly-computed weekly targets (the
  // "road"), and what's actually stored per week — so a fresh vs stored mismatch (the
  // stale-plan bug) is visible at a glance instead of inferred. Available while the Plan
  // view is open. Reads storage fresh each call.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.livingPlanDebug = () => {
      const RUN = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit', 'race', 'run']);
      const planner = (() => { try { return storage.get('planner') || {}; } catch { return {}; } })();
      const rcs = (() => { try { return (storage.get('races') || []).filter(r => r && r.date).sort((a, b) => a.date.localeCompare(b.date)); } catch { return []; } })();
      const road = (block?.weeks || []).map(w => {
        const wk = planner[w.weekKey];
        const days = (wk && Array.isArray(wk.days)) ? wk.days : [];
        const storedMi = days.filter(d => d && RUN.has(d.type)).reduce((s, d) => s + (Number(d.distanceMi) || 0), 0);
        const nGen = days.filter(d => d && d.generated).length;
        const nEdit = days.filter(d => d && d.type && d.type !== 'rest' && !d.generated).length;
        // Compare stored miles against the RACE-INCLUSIVE total, because storedMi counts
        // the race day (RUN includes 'race'). Against targetWeeklyMiles every race week
        // read STALE — a 47-mile marathon week measured against a 26-mile training line.
        const roadTotal = Number(w.totalWeeklyMiles ?? w.targetWeeklyMiles) || 0;
        return { week: w.weekKey, phase: w.phase, roadTarget: w.targetWeeklyMiles, roadTotal, raceMi: w.raceMi || 0, longRun: w.longRunTargetMi, longIsRace: !!w.longRunIsRace, race: w.raceName || '', storedRunMi: Math.round(storedMi * 10) / 10, storedGen: nGen, storedEdited: nEdit, match: Math.abs((storedMi || 0) - roadTotal) <= 3 ? 'ok' : 'STALE' };
      });
      // ORPHANED weeks — generated calendar weeks that fall OUTSIDE this block's span. The living re-sync
      // only ever rewrites weeks IN the block, so anything past its end keeps whatever was written the last
      // time a longer block was generated, silently, forever. This is how the 2026-07 stale-calendar bug hid:
      // the block was sized to a 5K three weeks out, so 17 marathon weeks sat frozen — and the road table
      // below, which only lists block weeks, showed "all in sync" while most of the season was months old.
      const span = (block?.weeks || []).map(w => w.weekKey);
      const lastKey = span[span.length - 1] || '';
      const orphans = Object.keys(planner).filter(k => k > lastKey && (planner[k]?.days || []).some(d => d && d.generated))
        .sort().map(k => ({ week: k, generatedAt: (planner[k].generatedAt || '').slice(0, 10) }));
      console.log('=== LIVING PLAN (road vs calendar) ===');
      console.log('target:', target, '· block spans', span.length, 'weeks:', span[0], '..', lastKey);
      if (orphans.length) {
        console.warn(`⚠ ${orphans.length} generated week(s) lie BEYOND the block and are never re-synced — the block is too short for the season:`);
        console.table(orphans);
      }
      // Volume base, from BOTH reads of recentRunStats — if these ever disagree the coach memo is
      // stale, and (since the fabricated `|| 30` fallback is gone) the plan is using the log read.
      const lg = (() => { try { return recentRunStats(allActivities(), localDate()); } catch { return null; } })();
      console.log('actual base — coach:', coach?.inputs?.weeklyMiles, 'mpw · log re-read:', lg ? Math.round(lg.weeklyMiles * 10) / 10 : '(failed)', 'mpw · longestRecent:', coach?.inputs?.longestRecentMi || lg?.longestRecentMi, 'mi', `· runs in 28d: ${lg?.runsLast28d ?? '?'}`);
      console.log('week 1 of the road starts at', (block?.weeks?.[0]?.targetMiles ?? '?'), 'mi — must be within ~15% of the base above, never a jump from nowhere.');
      console.log('goal peak (required):', goalVol?.peakMi, 'mpw · this-week coach target:', coach?.plan?.targetWeeklyMiles);
      console.log('races on calendar:', rcs.map(r => `${r.name || '?'} ${r.date}${(Number(r.distanceMi) || 0) >= 24 ? ' (M)' : ''}`).join('  |  ') || '(none)');
      console.table(road);
      const stale = road.filter(r => r.match === 'STALE').length;
      console.log(stale ? `⚠ ${stale}/${road.length} weeks STALE (calendar ≠ road) — re-sync not reaching those weeks.` : `✓ all ${road.length} weeks in sync.`);
      return { road, races: rcs };
    };
    return () => { try { delete window.livingPlanDebug; } catch {} };
  }, [block, coach, goalVol]);

  // REMOVED (Emil, 2026-07): window.arnoldSetRaceGoals() + its one-shot auto-apply, which wrote goal times
  // onto Tokyo/Berlin/NYC and re-flagged their priorities on first load. Two reasons it had to go:
  //   1. FABRICATION. Arnold derives from what you logged; it does not invent targets you never set. The only
  //      marathon goal in the record is Valencia 3:30 — you entered it. That the other races read "checkpoint
  //      · prove it here" is CORRECT: they have no goal because there is no goal, and the outlook says so.
  //   2. It was a THIRD writer of the race list (alongside GoalsHub and the race editor) running silently on
  //      mount — exactly the parallel-write drift saveRaces/deleteRaceEverywhere exist to stop.
  // The A-race no longer needs any of it: resolveARace ranks "the marathon you set a goal time on" above
  // `priority` (which the editor defaults to 'A' on every race and so can't be trusted), so Valencia anchors
  // the season from your real data alone. Set or change a goal time in the race editor and it flows through.

  // Auto-derive the plan on mount — the "living" part: no button to press. No preview
  // rings on the calendar for this silent pass (see the blue-circles fix).
  const _mounted = useRef(false);
  useEffect(() => { generate(target, { preview: false, autoApply: true }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  // Config changes (days / run+strength counts / focus) re-derive immediately, so
  // asking for 3 strength days shows 3 without hunting for a Regenerate button.
  useEffect(() => {
    if (!_mounted.current) { _mounted.current = true; return; }
    generate(target, { preview: false, autoApply: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runDays, strengthDays, focus, avail, startDate, longRunDow, strengthDows, injury, liveSig, seasonSig, target]);   // injury + liveSig → set the knee OR log a run and the plan reshapes; seasonSig + target → add/remove a race or change a goal time and the whole road re-periodizes around it. All re-apply themselves, no Regenerate/Apply.

  // When the target was never explicitly picked, it FOLLOWS the resolver. So entering a goal time on a
  // different marathon (or removing Valencia) re-anchors the season on its own instead of leaving the plan
  // pointed at a race that is no longer the A-race. An explicit pick is never overridden.
  useEffect(() => {
    if (!targetExplicit.current && target !== defaultTarget) setTarget(defaultTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTarget]);
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
      targetExplicit.current = true;   // tapping a race on the calendar IS a choice — remember it
      setTarget(`race:${openRaceReq.date}`);
      setExpanded(true);
      generate(`race:${openRaceReq.date}`);
      setTimeout(() => rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRaceReq && openRaceReq.n]);

  const toggleDay = i => setAvail(a => a.includes(i) ? a.filter(d => d !== i) : [...a, i].sort((x, y) => x - y));
  const storeApi = () => ({ get: (k) => storage.get(k), set: (k, v) => storage.set(k, v, { skipValidation: true }) });

  // Freeze the option at the moment the plan reaches the calendar, WITH the base and demonstrated
  // volume that were true when he agreed to it. That frozen context is what lets the coach ask a
  // fair question later ("you committed to 41 mi/wk off a 30.5 base — you're running 28") instead of
  // an unfair one against a target that moved while he wasn't looking.
  // `wks` is the WEEK ARRAY the plan wrote, not a count — the count alone could say how long
  // the block is but not where it sits, and every surface that traces progress needs the
  // bounds. Falls back to the rendered block when a caller has nothing fresher.
  // ── KEEPING THE FROZEN TRIAD ALIVE ────────────────────────────────────────────────────
  // Called on the same beat as the living re-apply, and ONLY on that beat: the calendar's
  // forward days have just been re-baselined, so the three roads printed on those same tiles
  // have to be re-cut from the same block or the tile contradicts itself.
  //
  // It is also the migration. Emil's commitment was frozen before flat days were kept, so it
  // carries nothing at all for his near weeks — his tiles were blank after a rebuild that fixed
  // the packer, because a rebuild does not rewrite storage. refreshTriadForward fills those in
  // from today forward and leaves every past day exactly as it was frozen.
  //
  // The record is otherwise untouched — spread in, one field out — because everything else in it
  // is a fact about the moment of choosing and must not drift. And it only writes when the bytes
  // actually changed, so a mount that finds nothing to fix does not churn the sync log.
  const refreshCommittedTriad = (cur) => {
    try {
      const fresh = triadPackRef.current;
      if (!cur || !fresh || !fresh.weeks || !Object.keys(fresh.weeks).length) return;
      const merged = refreshTriadForward(cur.triad || null, fresh, localDate());
      if (!merged || JSON.stringify(merged) === JSON.stringify(cur.triad || null)) return;
      setCommitment({ ...cur, triad: merged });
    } catch { /* the plan stands with the triad it already had */ }
  };

  const commitTier = (row, wks = null) => {
    if (!row) return;
    const weeks = Array.isArray(wks) ? wks : (block?.weeks || []);
    try {
      setCommitment({
        tier: row.key, tierLabel: row.label || TIER_LABEL[row.key] || row.key,
        goalSecs: row.goalSecs, peakMi: row.peakMi,
        longRunMi: row.longRunMi, thresholdWeeks: row.thresholdWeeks,
        // What the ramp actually reached, and why it fell short if it did. Frozen with the
        // rest so that in October — Berlin run, NYC run, both gone from the forward calendar —
        // the record can still explain a 35 mi/wk peak under a 44 mi/wk goal instead of
        // looking like the plan simply undershot.
        deliversPeakMi: row.deliversPeakMi ?? null,
        deliversLongMi: row.deliversLongMi ?? null,
        soloPeakMi: row.soloPeakMi ?? null,
        raceCostMi: row.raceCostMi ?? null,
        costlyRaces: row.costlyRaces ?? null,
        aRaceDate: row.aRaceDate || null, aRaceName: row.aRaceName || null,
        baseAtCommit: row.baseMi ?? null,
        demonstratedAtCommit: row.demonstratedMi ?? null,
        ratioAtCommit: row.ratio, verdictAtCommit: row.verdict,
        weeks: weeks.length || null,
        firstWeekKey: weeks[0]?.weekKey || null,
        lastWeekKey: weeks[weeks.length - 1]?.weekKey || null,
        // The three numbers that were printed on every run day, frozen with the choice. Without
        // this the rebase rule ("hit reach on 70% of sessions over the last four weeks") has
        // nothing to grade against — the live triad is built FORWARD from today and cannot
        // answer a question about a week that has already happened.
        triad: triadPackRef.current || null,
      });
    } catch { /* the plan still applies even if the record doesn't write */ }
  };

  const apply = () => {
    if (!block) return;
    const { written } = pasteSeasonBlock(storeApi(), block.weeks, { mode: overwrite ? 'overwrite' : 'fill-empty' });
    commitTier(tierChosen);
    showToast?.(tierChosen
      ? `Committed to ${TIER_LABEL[tierChosen.key] || tierChosen.key} — ${written} week${written === 1 ? '' : 's'} on your calendar, peaking at ${tierChosen.peakMi} mi/wk`
      : `Plan applied — ${written} week${written === 1 ? '' : 's'} to your calendar`);
    setPasted(true);
    setDirty(false);   // what's on screen and what's on the calendar are the same thing again
    onPreview?.(null);
    onApplied?.();
  };
  const removeFromCalendar = () => {
    if (!block) return;
    const { cleared } = clearSeasonBlock(storeApi(), block.weeks.map(w => w.weekKey));
    // A commitment to a plan that is no longer on the calendar is just a stale accusation.
    try { clearCommitment(); } catch {}
    showToast?.(`Removed the plan from ${cleared} week${cleared === 1 ? '' : 's'} (your hand-edits kept)`);
    setPasted(false);
    onApplied?.();
  };

  const plan = coach?.plan;
  const v = plan ? (VERDICT[plan.verdict] || { label: plan.verdict, color: '#9aa0a6' }) : null;
  // Protect-&-warn colour for the goal-feasibility read shown on the LIVING line.
  const FEAS_COLOR = { 'on-track': '#34d399', aggressive: '#e0b45e', unrealistic: '#f87171', unknown: 'var(--text-muted)', 'no-goal': 'var(--text-muted)' };
  // The weak link the plan is built to close (from the recipe-path).
  const weakLink = profile?.weakLink || null;
  const peakMi = block?.weeks?.length ? Math.max(1, ...block.weeks.map(w => w.targetWeeklyMiles || 0)) : 0;
  // THIS week as the BLOCK sees it. coach.plan is the periodization layer's read and it
  // deliberately knows nothing about the days — so on a race week it reports the training
  // line (26 mi) while the calendar below it lists a marathon and adds up to 47. Emil:
  // "On race weeks the plan should incorporate the runs into the weekly mileage." The
  // generator now publishes both numbers per week; the LIVING line reads the block's when
  // there is one so the sentence and the calendar underneath it are the same week.
  const thisBlockWk = useMemo(() => {
    const wks = block?.weeks; if (!wks || !wks.length) return null;
    const d = new Date(`${localDate()}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = ymd(d);
    return wks.find(w => w.weekKey === key) || null;
  }, [block]);

  // ── THE ACCOUNTABILITY READ ── planned vs actual on the weeks already gone by.
  // Recomputed whenever storage moves (a logged run, an edited planner week), so the
  // coach is looking at the same calendar the athlete is.
  const adherence = useMemo(() => {
    try { return planAdherence({ today: localDate() }); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion]);

  // The judgement lives in core/tierFeasibility.js — this only joins the three inputs it
  // needs (what was committed, what has actually been run, which options exist now) and
  // hands them over. Returns null whenever there is nothing to say, which is most weeks:
  // a coach who comments on every wobble is noise, and noise gets ignored precisely when
  // it finally matters.
  const recal = useMemo(() => {
    if (!adherence || !tierRows || tierRows.length === 0) return null;
    let c = null;
    try { c = getCommitment(); } catch { return null; }
    const aRaceDate = tierRows[0]?.aRaceDate || null;
    if (!commitmentAppliesTo(c, aRaceDate)) return null;
    const v = recalibrationVerdict({
      actualMi: adherence.actualMi, plannedMi: adherence.plannedMi,
      weeksShort: adherence.weeksShort, rows: tierRows, committedTier: c.tier,
    });
    return v.onTrack ? null : { ...v, commitment: c };
  }, [adherence, tierRows]);

  // ── THE REBASE READ ── Emil's rule, verbatim: "If you consistently (70% of the time for 4
  // weeks) hit reach plan targets, that becomes baseline, and then everything recalibrates
  // upward." Plus the amendment he approved: it is absorption-GATED, so hitting the numbers
  // while your body is falling behind them holds instead of promoting — and it is SYMMETRIC,
  // so the same loop that promotes can say out loud that it is time to come back down.
  //
  // The absorption signals are read from the ONE live outlook (which already assembles them
  // via hub/promotionLoop) and handed to tierProgress rather than recomputed here. Two modules
  // disagreeing about whether this athlete is coping is exactly the parallel-systems failure
  // this whole neighbourhood is built to avoid.
  const rebase = useMemo(() => {
    try {
      const ro = getRaceOutlook();
      const p = ro && ro.promotion ? ro.promotion : null;
      return tierProgress({
        absorption: p?.absorption || null,
        acwr: p?.inputs?.acwr ?? null,
        injuryActive: !!injury,
        today: localDate(),
      });
    } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageVersion, injury]);
  // The race the plan is actually building toward (the countdown should reflect
  // THIS, not the soonest marathon — otherwise it reads "→ Berlin" while you build to Valencia).
  const targetRace = target.startsWith('race:') ? races.find(r => r.date === target.slice(5)) : null;
  const targetDays = targetRace ? Math.max(0, Math.round((new Date(targetRace.date + 'T12:00:00') - new Date()) / 86400000)) : null;

  return (
    <div style={card} ref={rootRef}>
      {/* Executive header — plan + phase + countdown on ONE line */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        {/* Emil, 2026-07-25: "The Header is small and the Tiles with the time are huge." The
            hierarchy was inverted — the card's own name was the smallest thing on it. */}
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>Your plan</span>
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

      {/* LIVING status — visible proof the plan is tracking YOUR actual training, not a
          static template. It re-reads the moment you log a run (coach memo keys on liveSig),
          so this line moves on its own. The feasibility note is the protect-&-warn read:
          on track, or exactly how the goal is drifting at your current ramp. */}
      {coach && coach.inputs && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ color: '#5eead4', fontWeight: 700, letterSpacing: '0.05em' }}>⟳ LIVING</span>
          <span>you’re averaging <b style={{ color: 'var(--text-primary)' }}>{coach.inputs.weeklyMiles} mi/wk</b></span>
          {plan && plan.targetWeeklyMiles > 0 && (() => {
            // On a race week the two numbers genuinely differ and BOTH are true: the
            // training line is what the ramp is doing, the total is what you will cover.
            // Print the total (it is the number "how far am I running this week" means)
            // and show the training line beside it rather than silently picking one.
            const wkB = thisBlockWk;
            const total = wkB && wkB.totalWeeklyMiles > 0 ? Math.round(wkB.totalWeeklyMiles) : null;
            const train = wkB ? wkB.targetWeeklyMiles : plan.targetWeeklyMiles;
            const raceMi = wkB ? (wkB.raceMi || 0) : 0;
            const longMi = wkB ? wkB.longRunTargetMi : plan.longRunTargetMi;
            return (
              <span>· this week targets <b style={{ color: 'var(--text-primary)' }}>{total ?? train} mi</b>
                {raceMi > 0 && total ? ` (${train} training + ${raceMi} racing)` : ''}
                {longMi ? ` · long ${longMi}${wkB && wkB.longRunIsRace ? ' — the race' : ''}` : ''}</span>
            );
          })()}
          {coach.feasibility && coach.feasibility.note && coach.feasibility.verdict !== 'no-goal' && (
            <span style={{ color: FEAS_COLOR[coach.feasibility.verdict] || 'var(--text-muted)', fontWeight: 600 }}>· {coach.feasibility.note}</span>
          )}
        </div>
      )}

      {/* No logged running in the trailing 28 days → no volume base. We say so instead of
          building a plan off an invented number. */}
      {noBase && (
        <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '0.5px solid rgba(251,191,36,0.35)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
          <b style={{ color: '#fbbf24' }}>No volume base yet.</b> Nothing logged in 28 days, so there's nothing to ramp
          from. Log a few runs or sync Garmin and the block builds itself.
        </div>
      )}

      {/* Coach voice for the plan — missed sessions / drift / purpose, the same reasoned 'plan' surface as
          Play/Daily; silent when it has nothing, so a cold start stays quiet.
          The outlook LADDER deliberately does NOT appear here (Emil, 2026-07: "the same is shown in the Your
          Plan section in Calendar and that is repetitive"). EdgeIQ owns the ladder; the Calendar owns the
          execution. What the Calendar still needs — the number the plan is SIZED to — is carried by the
          goalVol line below ("Peak N mi/wk — what a H:MM marathon needs… sized to this cycle's Target"),
          which reads the SAME getRaceOutlook Target, so the two surfaces can't drift apart. */}
      <div style={{ marginTop: 10 }}>
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
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4, whiteSpace: 'nowrap' }}>Weak link</div>
            </div>
          )}
        </div>
      )}

      {/* Goal-driven volume — the peak the plan builds to. When the raw goal is
          beyond this cycle the peak is sized to the evidence-backed TARGET (not a
          fantasy), and we say so; the outlook ladder above shows the goal migrating. */}
      {goalVol && (
        <div style={{ fontSize: 11, color: '#5eead4', lineHeight: 1.4, marginTop: 6 }}>
          ◎ {goalVol.note}{goalVol.gapMi > 0 ? ` Building the base toward it — +${goalVol.gapMi} mi to the peak.` : ''}
          {goalVol.targetClamped && !tierChosen && showWork && (
            <span style={{ color: 'var(--text-muted)' }}> Sized to this cycle’s Target — your goal is a reach the plan grows into as you prove it.</span>
          )}
        </div>
      )}

      {/* ── PICK YOUR ROAD ── the ladder as OPTIONS, not as a verdict (Emil, 2026-07: "I need options
           and I need a plan that provides… a drop down in the plan generate field that shows these
           options. The user will see the path and then commit to calendar").

           Every option is listed, including the ones out of reach. Hiding an unreachable goal hides the
           REASON it's unreachable, and the reason is the only actionable thing on this card: it names
           the volume that would make it real, so the athlete can watch it come into reach rather than
           being told no. The verdicts are computed in core/tierFeasibility.js against his best logged
           four-week block — the same rows the coach's recalibration reads, so the dropdown and the
           coach can never disagree about what's possible. */}
      {tierRows && tierRows.length > 0 && (() => {
        const VC = { comfortable: '#34d399', reachable: '#34d399', aggressive: '#e0b45e', unrealistic: '#f87171', unknown: 'var(--text-muted)' };
        const cur = tierChosen ? tierRows.find(r => r.key === tierChosen.key) || tierChosen : null;
        const c = VC[cur?.verdict] || 'var(--text-muted)';
        const held = cur?.demonstratedMi || 0;
        // The coach's OPINION, which is no longer the same thing as permission. Every option can
        // be picked (Emil: "The Goal and the Ceiling are not available as options"); these are the
        // ones it would not advise, listed so the reason stays visible after you pick one anyway.
        const notAdvised = tierRows.filter(r => !r.advised);
        const lever = tierRows.find(r => r.lever)?.lever || null;
        // Does the ramp fall short for EVERY option? Then the goal is not what is limiting this
        // build, and saying so once is worth more than repeating it under each choice.
        const allShort = tierRows.every(r => r.shortfallMi > 2);
        const bestDeliverable = tierRows.reduce((b, r) => (r.deliversPeakMi > (b?.deliversPeakMi || 0) ? r : b), null);
        const commitCta = () => { tierExplicit.current = true; apply(); };
        // The shortest ORDINARY run in the previewed block — long run and races excluded, since
        // nobody is deterred by those. This is the number behind Emil's "I see 4 mile run days,
        // for which I am not even going to go out": it is read off the block the generator just
        // drew rather than estimated from the weekly total, so it cannot disagree with the tiles.
        const shortestOrdinaryMi = (() => {
          const wk0 = (block?.weeks || []).find(w => (w.days || []).some(d => d && Number(d.distanceMi) > 0));
          if (!wk0) return 0;
          const ordinary = (wk0.days || [])
            .filter(d => d && Number(d.distanceMi) > 0 && d.type !== 'long_run' && d.type !== 'race')
            .map(d => Number(d.distanceMi));
          return ordinary.length ? Math.min(...ordinary) : 0;
        })();
        return (
          <div style={{ marginTop: 12, padding: '8px 11px', borderRadius: 10, border: `0.5px solid ${c}44`, background: `${c}0d` }}>
            {/* ── THE HERO LINE ── Emil, 2026-07-26: *"There is too much space empty to the right.
                This should be one thin hero line that's it."* He circled roughly half the card.

                The cause was structural, not cosmetic. Everything here used to be a STACK: a header
                row, then a numbered step label, then the chip row, then the spread-over row, then the
                custom-time row, then the base line, then a second numbered step with the apply button.
                Seven full-width rows each holding a left-aligned fragment ~500px wide, on a ~1,340px
                card — so the card was tall AND two-fifths empty, which is the worst of both.

                It is now ONE wrapping flex row. Choice, spread, your own time, the base/peak readout
                and the apply button sit side by side and consume the width instead of leaving it, and
                the row wraps rather than overflows so the phone gets the same controls in two or three
                lines. Nothing was removed — the step labels became the apply button's own wording
                (which is where that instruction actually belongs), and every explanatory paragraph
                moved behind "show the working", where the rest of the provenance already lived. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', rowGap: 5, minWidth: 0, maxWidth: '100%' }}>
              <span
                title="Every option is selectable, including the ones the coach would not advise. Choosing one redraws the preview; nothing reaches your calendar until you apply."
                style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.09em', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
              >
                Pick your road{cur?.aRaceName ? ` · ${shortName(cur.aRaceName)}` : ''}
              </span>
              {cur && (
                <span style={{ fontSize: 8.5, fontWeight: 700, color: c, background: `${c}1a`, border: `0.5px solid ${c}55`, borderRadius: 5, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  {cur.verdict}
                </span>
              )}

              {/* The ladder itself. One line per chip now, not two: name, time, and the peak it
                  demands, read left to right. The ramp cost that used to occupy the second line is
                  in the tooltip and spelled out under "show the working" — it is the kind of number
                  you consult once, not the kind you scan six of.

                  ON A PHONE THE CHIPS ARE A GRID, NOT A RAGGED WRAP. Emil, 2026-07-26, circling this
                  strip: *"This does not display fully or well."* Six chips of unequal width flowing
                  into a wrapping row gave him a first line ending mid-option — the eye reads that as
                  truncation, and it is not wrong, because there is no visible rule saying where the
                  ladder ends. Three fixed columns × two rows is the same six options with an edge:
                  every chip the same width, every row full, nothing dangling. */}
              <div style={isMobile
                ? { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, width: '100%', minWidth: 0 }
                : { display: 'contents' }}>
              {tierRows.map(r => {
                const on = cur?.key === r.key;
                const rc = VC[r.verdict] || 'var(--text-muted)';
                // "plan reaches 29" — Emil: "What does plan reaches 29 mean? I do not understand."
                // Fair: no unit, no subject. It is the peak WEEKLY MILEAGE the ramp climbs to, said
                // beside the number it is being compared against, and only when it falls short.
                const short = r.deliversPeakMi > 0 && r.shortfallMi > 2;
                return (
                  <button
                    key={r.key}
                    className="arnold-compact-btn"
                    title={`${r.label} — ${fmtGoal(r.goalSecs)}. Needs ${r.peakMi} mi/wk at peak${r.rampPct > 0 ? `, a ${(r.rampPct * 100).toFixed(1)}%/wk climb` : ''}${short ? `; this plan peaks at ${r.deliversPeakMi}` : ''}.${r.advised ? '' : ' Not advised this cycle — you can still pick it.'}\n${r.rampWhy || r.why || ''}`}
                    onClick={() => { tierExplicit.current = true; setTier(r.key); setDirty(true); generate(target, { tier: r.key }); }}
                    style={{
                      all: 'unset', cursor: 'pointer', borderRadius: 7, whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'baseline', justifyContent: 'center',
                      gap: 3, padding: '2px 5px', minWidth: 0,
                      border: `0.5px solid ${on ? rc : 'var(--border-subtle)'}`,
                      background: on ? `${rc}1a` : 'rgba(255,255,255,0.02)',
                      opacity: on ? 1 : 0.78,
                    }}
                  >
                    <span style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.02em', textTransform: 'uppercase', color: on ? rc : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.label}{!r.advised ? ' ·' : ''}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 800, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {fmtGoal(r.goalSecs)}
                    </span>
                    <span style={{ fontSize: 8, color: short ? '#fbbf24' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {r.peakMi}
                    </span>
                  </button>
                );
              })}
              </div>

              {/* The athlete's own time. Emil's sub-3:40 fell between Stretch (3:46) and Goal (3:30)
                  and so was not on the ladder at all — a target you cannot name is a target you
                  cannot train for. Priced by the same model as every published option. */}
              <span style={{ width: 1, height: 13, background: 'var(--border-subtle)', flexShrink: 0 }} />
              <input
                className="arnold-compact-input"
                value={customDraft}
                placeholder="Your own"
                title="Name any finish time — it is priced by the same model as every option on the ladder."
                inputMode="numeric"
                onChange={e => setCustomDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                onBlur={() => {
                  const secs = parseGoal(customDraft);
                  const next = secs > 0 ? secs : null;
                  if (next === customSecsRef.current) return;
                  customSecsRef.current = next;
                  setCustomSecs(next);
                  setCustomDraft(next ? fmtGoal(next) : '');
                  // Picking your own time IS choosing it — regenerate onto it straight away rather
                  // than leaving a number sitting in a box doing nothing.
                  tierExplicit.current = true;
                  if (next) setTier('custom');
                  setDirty(true);
                  generate(target, { tier: next ? 'custom' : undefined });
                }}
                style={{ ...num, width: 62, textAlign: 'center', fontSize: 10.5, padding: '2px 4px' }}
              />
              {customSecs > 0 && (
                <button
                  className="arnold-compact-btn"
                  title="Drop your own time and go back to the ladder"
                  onClick={() => {
                    customSecsRef.current = null; setCustomSecs(null); setCustomDraft('');
                    if (tier === 'custom') setTier(null);
                    setDirty(true); generate(target, { tier: undefined });
                  }}
                  style={{ all: 'unset', cursor: 'pointer', fontSize: 9.5, color: 'var(--text-muted)', borderBottom: '0.5px dotted var(--border-subtle)' }}
                >Clear</button>
              )}

              {/* ── HOW MANY DAYS THE WEEK IS SPREAD OVER ────────────────────────────────────
                  Emil, 2026-07-25: "I see 4 mile run days, for which I am not even going to go
                  out, if I run slower run at 7 miles per run. Maybe I can just adjust how many
                  days to run." He can — and could all along — but the only control was a bare
                  number input buried in Adjust, three screens from the tiles showing the 4-mile
                  days. It belongs beside the finish time because those are the two halves of one
                  decision: the finish time sets HOW MANY miles the week owes, this sets HOW FEW
                  PIECES they arrive in. Same volume either way — 26 miles over six days is 4-mile
                  days, over four days it is 6.5s. Neither is fitter; one is a run he will actually
                  drive to the trail for, and that is the only difference that matters. */}
              <span style={{ width: 1, height: 13, background: 'var(--border-subtle)', flexShrink: 0 }} />
              <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Spread</span>
              {[3, 4, 5, 6, 7].map(n => (
                <button
                  key={n}
                  className="arnold-compact-btn"
                  title={`Fit the same weekly volume into ${n} run${n === 1 ? '' : 's'} a week`}
                  onClick={() => { if (n !== runDays) { setRunDays(n); setDirty(true); } }}
                  style={{
                    all: 'unset', cursor: 'pointer', minWidth: 11, textAlign: 'center',
                    borderRadius: 5, padding: '1px 6px', fontSize: 10,
                    fontWeight: runDays === n ? 800 : 600, fontVariantNumeric: 'tabular-nums',
                    color: runDays === n ? '#5eead4' : 'var(--text-muted)',
                    background: runDays === n ? 'rgba(94,234,212,0.14)' : 'transparent',
                    border: `0.5px solid ${runDays === n ? 'rgba(94,234,212,0.42)' : 'var(--border-subtle)'}`,
                  }}
                >{n}</button>
              ))}
              {/* The honest consequence of the button you just pressed, read off the previewed
                  block rather than estimated: the shortest ORDINARY run in it (long run and races
                  excluded — nobody is deterred by those). Only shown when it is under 4 mi, which
                  is the tile Emil was looking at when he wrote the sentence above; above that it is
                  a number with nothing to say, and it lives under the working like the rest. */}
              {shortestOrdinaryMi > 0 && shortestOrdinaryMi < 4 && (
                <span title="The shortest ordinary run in the previewed block. Fewer run days makes each one longer." style={{ fontSize: 9, color: '#fbbf24', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {Math.round(shortestOrdinaryMi * 10) / 10} mi days
                </span>
              )}

              <span style={{ flex: 1, minWidth: 4 }} />

              {/* ── THE NUMBERS THAT DECIDE THE BUILD ── base is here because it is the term that
                  moves. `asks` is GONE, and its removal is what bought the row back: it printed the
                  selected option's peak a second time, ~5cm to the right of the chip already showing
                  that exact number — 90px of duplication that was pushing "Working ▾" onto a line of
                  its own (Emil: "it drops to a new line for the working sign… fit it all on one row").
                  `peaks` survives but only when the ramp actually falls short, because that is the
                  only state in which it says something the chip does not. */}
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {baseRead?.baseMi > 0 && <>Base <b style={{ color: 'var(--text-primary)' }}>{baseRead.baseMi}</b></>}
                {cur && cur.peakMi > 0 && cur.deliversPeakMi > 0 && cur.shortfallMi > 2 && (
                  <>
                    {baseRead?.baseMi > 0 ? ' · ' : ''}Peaks <b style={{ color: '#fbbf24' }}>{cur.deliversPeakMi}</b> of {cur.peakMi}
                  </>
                )}
              </span>

              {/* Emil: "This needs to be a little more straight forward in terms of selecting and
                  generating." The button says which of the two states the card is in rather than
                  leaving it to be inferred from a numbered heading three rows down. */}
              {(!pasted || dirty) && block?.weeks?.length > 0 && (
                <button
                  className="arnold-compact-btn"
                  title="Choosing an option only redraws this preview. This writes it to your calendar."
                  onClick={commitCta}
                  style={{
                    all: 'unset', cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 7,
                    padding: '3px 9px', fontSize: 10, fontWeight: 700,
                    color: c, border: `0.5px solid ${c}77`, background: `${c}1a`,
                  }}
                >
                  Apply to calendar →
                </button>
              )}
              {pasted && !dirty && (
                <span title="This road is written to your calendar." style={{ fontSize: 9.5, color: '#34d399', whiteSpace: 'nowrap' }}>
                  ✓ {block?.weeks?.length || 0} wks{cur ? ` · ${cur.label}` : ''}
                </span>
              )}

              <button
                className="arnold-compact-btn"
                onClick={() => setShowWork(w => !w)}
                aria-expanded={showWork}
                style={{ all: 'unset', cursor: 'pointer', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-secondary)', borderBottom: '0.5px dotted var(--border-subtle)', whiteSpace: 'nowrap' }}
              >
                {showWork ? 'Hide working ▴' : 'Working ▾'}
              </button>
            </div>

            {showWork && (<>
            {cur && (
              <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: 8 }}>
                {cur.why}
              </div>
            )}

            {/* What the ramp column means, said once rather than six times. The 10%/week rule is a
                population heuristic; the real limit this app enforces is the acute:chronic ratio,
                and every rung above is solved to sit inside it. Printing the cost next to the goal
                is what turns "pick a finish time" into an informed choice instead of a wish. */}
            {cur?.rampPct > 0 && (
              <div style={{ fontSize: 9.5, color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 5 }}>
                Each finish time has a <i>Cost</i>: how fast the weekly volume has to climb to get there.
                {' '}{cur.label} needs <b style={{ color: 'var(--text-primary)' }}>{(cur.rampPct * 100).toFixed(1)}%/wk</b>
                {cur.acwr > 0 ? <> — a steady load ratio of <b style={{ color: 'var(--text-primary)' }}>{cur.acwr.toFixed(2)}</b>, {cur.acwr < 1.3 ? 'inside' : 'past'} the 0.8–1.3 band Arnold holds you to</> : null}.
                {shortestOrdinaryMi > 0 && <> Spread over <b style={{ color: 'var(--text-primary)' }}>{runDays}</b> days a week, the shortest ordinary run in this block is <b style={{ color: shortestOrdinaryMi < 4 ? '#fbbf24' : 'var(--text-primary)' }}>{Math.round(shortestOrdinaryMi * 10) / 10} mi</b>.</>}
              </div>
            )}

            {/* ── THE DELIVERY CHECK ── does the plan the engine just DREW reach the volume this
                 option DEMANDS? Two different questions, and only the first used to be asked.
                 tierFeasibility judges the finish time against demonstrated capacity; the ramp is
                 separately limited by where it STARTS and by what the calendar spends.

                 MEASURED 2026-07-25 at Emil's real numbers (/tmp/attrib.mjs), base 14.8: every
                 option delivers the same 35 mi/wk. With Berlin and NYC taken off the calendar the
                 SAME base reaches 36 / 41 / 42 / 44 / 48 / 51 — i.e. exactly what each option
                 asks for. So the entire shortfall is the two supported marathons, and the earlier
                 version of this card, which blamed the base for all of it, was telling him a true
                 number with a false reason attached. Which of the two is talking is now measured
                 per option, not assumed — see the attribution probe in generate(). */}
            {cur && cur.shortfallMi > 2 && (
              <div style={{ fontSize: 10, color: '#fbbf24', lineHeight: 1.5, marginTop: 6, paddingTop: 6, borderTop: '0.5px solid var(--border-subtle)' }}>
                <b>This one needs {cur.peakMi} mi/wk at peak and the plan peaks at {cur.deliversPeakMi} mi/wk.</b>{' '}
                {cur.raceCostMi > 2
                  ? <>The reason is on your calendar, not in the dropdown. Off your {cur.baseMi} mi/wk base this ramp
                      would climb to <b>{cur.soloPeakMi} mi/wk</b> — racing {cur.costlyRaces?.join(' and ')} properly
                      costs it <b>{cur.raceCostMi}</b> of that, because each marathon takes its race week, a recovery
                      week, and the climb back from the top of that recovery. That is the trade you chose, not a flaw
                      in the plan: three marathons in ten weeks and a peak build for the third are different seasons.
                      Keep them and train the honest {cur.deliversPeakMi}, or run one as a supported effort instead of
                      a race and this option opens back up.</>
                  : allShort
                    ? <>Every option on this list reaches the same {bestDeliverable?.deliversPeakMi} mi/wk, which is the
                        tell: what limits this build is not the finish time you pick, it is where the ramp starts —{' '}
                        {cur.baseMi} mi/wk. Nothing on this dropdown moves that. Only logged weeks do, and this re-reads
                        them every time you regenerate.</>
                    : <>Built safely from your {cur.baseMi} mi/wk base, that is as high as the ramp climbs before race
                        day. Picking it is still worth doing — you get the fastest honest curve toward it, and the
                        number rises as your logged weeks do.</>}
              </div>
            )}

            {/* WHERE THE BASE CAME FROM. This one number decides the entire build — at 12.2 mi/wk
                nothing on the ladder is reachable, at 19.3 sub-3:40 is — so it may never be a
                figure from nowhere. The four weeks behind it are printed underneath it. */}
            {baseRead?.weeks?.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
                Base <b style={{ color: 'var(--text-primary)' }}>{baseRead.baseMi} mi/wk</b> — {baseRead.method}:{' '}
                {baseRead.weeks.map(w => `${fmtWk(w.weekKey)} ${w.mi}`).join(' · ')}
                {/* The complete weeks above are the only ones in `weeks`, so when the CURRENT
                    week is the term that won the max, printing them alone would show a list
                    that visibly disagrees with the number in front of it. Print it too. */}
                {baseRead.weekToDateMi > 0 ? ` · this week so far ${baseRead.weekToDateMi}` : ''}.
                {baseRead.cappedBy ? ` Held at your demonstrated ${baseRead.cappedBy} mi/wk.` : ''}
                {held > 0 && <> Judged against <b style={{ color: 'var(--text-primary)' }}>{held} mi/wk</b>, your best four
                  consecutive weeks{cur?.atWeek ? ` (from ${fmtWk(cur.atWeek)})` : ''}.</>}
                {cur?.weeks?.lostToRaces > 0 && ` ${cur.weeks.progression} progression weeks left — ${cur.weeks.blockingRaces.join(' and ')} take ${cur.weeks.lostToRaces} of them.`}
              </div>
            )}

            {/* The options the coach would not advise — and the two honest ways to open them.
                They are all still selectable; this is advice, not a gate. */}
            {notAdvised.length > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6, paddingTop: 6, borderTop: '0.5px solid var(--border-subtle)' }}>
                <b style={{ color: '#f87171' }}>Not advised this cycle</b> (you can still pick them):{' '}
                {notAdvised.map(r => `${r.label} ${fmtGoal(r.goalSecs)} (${r.peakMi} mi/wk)`).join(', ')}.
                They come into range on their own as your logged four-week block rises, and this list re-reads it
                every time the plan regenerates.
                {lever === 'economy+threshold' && ' Faster without more miles is the other road: threshold work and running economy buy time at the same volume.'}
              </div>
            )}

            {/* Only worth saying while there IS an unapplied preview. Once the plan is on the
                calendar the line is telling him about a state he is not in. */}
            {(!pasted || dirty) && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 6 }}>
                Changing an option redraws this preview immediately — the calendar only changes when you apply.
              </div>
            )}
            </>)}
          </div>
        );
      })()}

      {/* ── RECALIBRATION ── Emil, 2026-07: "If the athlete is unable to complete a more aggressive
           target, the Coach will advise to recalibrate to the lower tier goals and stay realistic,
           but will also offer options to improve performance."

           Three rules this card obeys:
             1. It NEVER rewrites the calendar. Switching options regenerates a PREVIEW; the plan only
                moves when he presses apply, same as every other path. A coach that quietly downgrades
                your goal while you sleep is not honest, it's just deniable.
             2. It measures against what was COMMITTED (frozen at apply time), not against today's
                feasibility rows — those move weekly, and a target that moves can't be missed.
             3. It always offers the other road. Dropping an option is one way to close a gap; buying time
                at the same volume through threshold work and economy is the other, and an athlete told
                only "aim lower" has been managed, not coached. */}
      {recal && (() => {
        const a = recal.commitment;
        const lever = tierRows.find(r => r.lever)?.lever || null;
        const shortWeeks = (adherence?.weeks || []).filter(w => w.counted).slice(-4);
        return (
          <div style={{ marginTop: 10, padding: '11px 13px', borderRadius: 10, border: '0.5px solid #e0b45e55', background: '#e0b45e0d' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#e0b45e', textTransform: 'uppercase' }}>
                Recalibrate
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                committed to {TIER_LABEL[a.tier] || a.tier} · {fmtGoal(a.goalSecs)} · peak {a.peakMi} mi/wk
              </span>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: 7 }}>
              {recal.note}
            </div>
            {/* The receipts. A number the athlete can't check is a number he can argue with. */}
            {shortWeeks.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {shortWeeks.map(w => (
                  <span key={w.weekKey} style={{
                    fontSize: 9, fontWeight: 600, borderRadius: 6, padding: '2px 7px',
                    color: w.short ? '#f87171' : '#34d399',
                    background: w.short ? '#f8717115' : '#34d39915',
                    border: `0.5px solid ${w.short ? '#f8717144' : '#34d39944'}`,
                  }}>
                    {fmtWk(w.weekKey)} · {w.actualMi}/{w.plannedMi} mi
                  </span>
                ))}
              </div>
            )}
            {/* Option one: the honest option. Regenerates a preview — nothing is written yet. */}
            {recal.adviseTier && (
              <div style={{ marginTop: 9 }}>
                <button
                  onClick={() => {
                    tierExplicit.current = true;
                    setTier(recal.adviseTier.key);
                    generate(target, { tier: recal.adviseTier.key });
                  }}
                  style={{ ...chip, borderColor: '#e0b45e88', color: '#e0b45e', cursor: 'pointer' }}
                >
                  Rebuild at {recal.adviseTier.label} · {fmtGoal(recal.adviseTier.goalSecs)} · peak {recal.adviseTier.peakMi} mi/wk
                </button>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
                  Redraws the preview only — your calendar stays as it is until you apply. Holding the harder option is a real answer too.
                </div>
              </div>
            )}
            {/* Option two: same miles, faster. Never let "aim lower" be the only door. */}
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8, paddingTop: 7, borderTop: '0.5px solid var(--border-subtle)' }}>
              <b style={{ color: 'var(--text-secondary)' }}>Or keep the goal and change how you get there.</b>{' '}
              {lever === 'economy+threshold'
                ? 'Threshold work and running economy buy time at the same weekly volume — the miles you are managing, run better, are worth more than miles you keep missing.'
                : 'Volume is one lever; quality is the other. Fewer, better-executed weeks beat a bigger plan you keep missing.'}
              {' '}Consistency first: {a.baseAtCommit ? `you were holding ${a.baseAtCommit} mi/wk when you committed. ` : ''}
              Three weeks that land exactly as written will reopen this faster than one heroic week.
            </div>
          </div>
        );
      })()}

      {/* ── THE REBASE CARD ── the tier loop closing on itself.
           Emil: "As they progress the Peak adapts and rebases, and so do the race times. If you
           consistently (70% of the time for 4 weeks) hit reach plan targets, that becomes
           baseline, and then everything recalibrates upward."

           Three rules it inherits from the recalibration card above it, for the same reasons:
            1. It NEVER rewrites the calendar. A promotion offered is a promotion; a promotion
               applied while you slept is a target raised on you, and an athlete who finds his
               plan got harder overnight stops trusting the plan.
            2. It measures against the FROZEN triad — the three numbers that were actually
               printed on those days — never against a triad recomputed today from a base that
               has since moved. Grading old runs against new numbers is not accountability.
            3. It is SYMMETRIC. The same loop that promotes says out loud when it is time to come
               down. A coach who only ever has good news is not measuring anything. */}
      {rebase?.ok && rebase.verdict && rebase.weeks.length > 0 && (() => {
        const vd = rebase.verdict;
        const promote = vd.verdict === 'promote';
        const demote = vd.verdict === 'demote';
        const tone = promote ? '#34d399' : (demote ? (vd.gate === 'safety' ? '#f87171' : '#e0b45e') : '#9aa0a6');
        const head = promote ? 'Rebase earned' : (demote ? (vd.gate === 'safety' ? 'Back off' : 'Rebase down') : 'Rebase');
        const reachRung = (rebase.rungs || []).find(r => r && r.rung === 'reach') || null;
        // Only weeks that actually CARRIED a decision get a chip. A week the rule skipped for
        // being too light is not evidence and must not look like a score.
        const chips = (vd.perWeek || []).filter(w => w && w.counted);
        return (
          <div style={{ marginTop: 10, padding: '11px 13px', borderRadius: 10, border: `0.5px solid ${tone}55`, background: `${tone}0d` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: tone, textTransform: 'uppercase' }}>{head}</span>
              <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                {vd.weeksCounted}/{vd.weeksNeeded} weeks judged · {vd.judged} session{vd.judged === 1 ? '' : 's'}
                {vd.reachRate != null ? ` · ${Math.round(vd.reachRate * 100)}% at Reach` : ''}
              </span>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', marginTop: 7 }}>
              {vd.reason}
            </div>
            {/* The receipts, per week: sessions at Reach or above, out of the sessions where Reach
                actually asked for more than baseline did. */}
            {chips.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {chips.map(w => {
                  const good = w.judged > 0 && (w.hits / w.judged) >= 0.7;
                  return (
                    <span key={w.weekKey} style={{
                      fontSize: 9, fontWeight: 600, borderRadius: 6, padding: '2px 7px',
                      color: good ? '#34d399' : 'var(--text-muted)',
                      background: good ? '#34d39915' : 'transparent',
                      border: `0.5px solid ${good ? '#34d39944' : 'var(--border-subtle)'}`,
                    }}>
                      {fmtWk(w.weekKey)} · {w.hits}/{w.judged}
                    </span>
                  );
                })}
              </div>
            )}
            {/* Why the fraction is smaller than the week looks. Early in a block and on every
                cut-back week the three plans converge, and a day where Reach asks exactly what
                Baseline asks is not evidence about reaching — it leaves the fraction rather than
                padding it. Said out loud, because a fraction the athlete can't reconstruct isn't
                evidence either. */}
            {vd.flat > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                {vd.flat} session{vd.flat === 1 ? '' : 's'} left out: Reach asked for the same miles as baseline
                {' '}on {vd.flat === 1 ? 'that day' : 'those days'}, so running them says nothing either way.
              </div>
            )}
            {rebase.moved > 0 && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                {rebase.moved} run{rebase.moved === 1 ? '' : 's'} counted on a different day than planned — the week is the unit, not the weekday.
              </div>
            )}
            {/* The one tap. Preview only: the calendar does not move until you apply it. */}
            {promote && reachRung && (
              <div style={{ marginTop: 9 }}>
                <button
                  onClick={() => {
                    tierExplicit.current = true;
                    if (reachRung.tierKey === 'custom' && reachRung.goalSecs > 0) {
                      customSecsRef.current = reachRung.goalSecs; setCustomSecs(reachRung.goalSecs); setCustomDraft(fmtGoal(reachRung.goalSecs));
                    }
                    setTier(reachRung.tierKey);
                    generate(target, { tier: reachRung.tierKey });
                  }}
                  style={{ ...chip, borderColor: '#34d39988', color: '#34d399', cursor: 'pointer' }}
                >
                  Rebase to {reachRung.tierLabel || RUNG_LABEL.reach} · {fmtGoal(reachRung.goalSecs)} · peak {reachRung.deliversPeakMi || reachRung.needsPeakMi} mi/wk
                </button>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.5 }}>
                  Redraws the preview at the rung you've been running — nothing changes until you apply. Banking another steady block first is a real answer too.
                </div>
              </div>
            )}
            {demote && vd.gate !== 'delivery' && (
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 7, lineHeight: 1.5 }}>
                Nothing was changed for you — run the baseline numbers this week; the reach numbers are still there when the signals come back.
              </div>
            )}
          </div>
        );
      })()}

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
        // The triad for THIS calendar week, found BY WEEK KEY and never by position. The tiles
        // may be rendering an applied week that is not block.weeks[0] (after a Saturday generate
        // the first block week is next Monday), and indexing the triad positionally would hang
        // one week's three numbers off another week's days — the same class of bug that put this
        // week's misses on a plan that had not started yet.
        const tw = (triadWeeks || []).find(w => w && w.weekKey === wk.weekKey) || null;
        // The tiles speak the athlete's OWN vocabulary — Current / Target / Stretch / Ceiling /
        // Goal / "Your time" — not the engine's baseline·reach·challenge. Emil asked for the tiles
        // to show "Current, Target, Stretch and Goal"; those are the ladder rows, and each triad
        // rung already carries the row it was built from as `tierLabel`. baseline/reach/challenge
        // is an internal ORDERING (slowest of the three, middle, fastest) that he never chose and
        // has no reason to learn. Matched by `rung`, never by array position, so a triad that ever
        // ships fewer than three rungs cannot silently shift every label one place along.
        const rungTier = {};
        RUNG_ORDER.forEach((k) => {
          const r = (triad && Array.isArray(triad.rungs)) ? triad.rungs.find(x => x && x.rung === k) : null;
          rungTier[k] = (r && r.tierLabel) || RUNG_LABEL[k] || k;
        });
        // Completion overlay — the SAME per-day done/missed the calendar + mobile ticker read, so
        // the plan tab reflects reality (yesterday done, a missed run) instead of just the plan.
        let weekStatus = null;
        // Ask about THE WEEK BEING RENDERED (wk.weekKey), not about today. This used to pass
        // `new Date()`, so the overlay was always the CURRENT week's statuses — and they were
        // then indexed positionally onto whatever week these tiles actually show. `block.weeks[0]`
        // is the first week of the generated block, which after a Saturday generate is NEXT
        // Monday: a plan that had not started yet inherited this week's misses and the footer
        // printed "· N missed" for sessions that did not exist. Emil: "I still see misses across
        // all surfaces." summarizePlanWeek now takes the week and the clock separately, so a
        // future week reports upcoming/rest and nothing can be missed before it happens.
        try { weekStatus = appliedDays ? summarizePlanWeek(new Date(`${wk.weekKey}T12:00:00`)) : null; }
        catch { weekStatus = null; }
        const statusOf = (i) => (weekStatus && weekStatus.days && weekStatus.days[i]) ? weekStatus.days[i].status : null;
        // The ACTUAL miles logged that day (from summarizePlanWeek) — so a done day reflects what was
        // really run (7.5) rather than the planned figure (6). Null when nothing logged.
        const actualMiOf = (i) => (weekStatus && weekStatus.days && weekStatus.days[i] && weekStatus.days[i].actualMi != null) ? weekStatus.days[i].actualMi : null;
        const RUN_SET = new Set(['easy_run', 'long_run', 'tempo', 'intervals', 'hiit']);
        // totalWeeklyMiles first: the tiles beside this number include the race, so the
        // header has to as well or the card contradicts its own days on every race week.
        const plannedMi = weekStatus && weekStatus.totals ? Math.round(weekStatus.totals.runMiles) : Math.round(wk.totalWeeklyMiles ?? wk.targetWeeklyMiles);
        let doneMi = 0, missedCount = 0;
        if (weekStatus) days.forEach(({ d, i }) => {
          const st = statusOf(i);
          if (st === 'done' && RUN_SET.has(d.type)) doneMi += Number(actualMiOf(i) ?? d.distanceMi) || 0;   // count ACTUAL run miles
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
          // Once the day is logged, show the ACTUAL distance run (7.5) instead of the plan's 6.
          const mi = isRunFam ? ((statusOf(i) === 'done' && actualMiOf(i) != null) ? actualMiOf(i) : d.distanceMi) : null;
          const durMin = Number(d.durationMin) || 0;   // cross-train (bike/pool/…) is time-based, not miles
          const str = d.strength && d.type !== 'strength';
          const structure = QUALITY_TYPES.has(d.type) ? buildQualityStructure({ type: d.type, phase: wk.phase, paces, seed: i }) : null;
          const aggr = !!injury && sessionAggravatesInjury(d.type, injury);
          const isOpen = openSession === i;
          const status = statusOf(i);   // done | missed | today | upcoming | null
          // ── THE TRIAD ── Emil's design: "We need 3-4 mileage numbers on each run day, that move
          // with the session… so the runner knows what tier they are hitting."
          //
          // Five conditions, each of which exists because breaking it would print a lie:
          //   tierable        — a race is a fixed distance and strength has no miles; "26.2/30/33"
          //                     for Berlin would be absurd, and the absurdity is the point.
          //   tierSpreadMi>0  — three identical numbers are not a choice, they are noise pretending
          //                     to be one. Collapse to the single number the tile already showed.
          //   tierMonotone    — the three rungs are three separate blocks climbing at three
          //                     different rates, so they reach their every-4th cut-back week at
          //                     different build indices. In that one calendar week the FASTER plan
          //                     can honestly prescribe fewer miles — this generator really does
          //                     produce 7 / 6 / 7. A row where Reach is below Baseline is not a
          //                     ladder, and painting it as one makes the tiers look broken exactly
          //                     the way they were before any of this was fixed. Collapse instead.
          //   type matches    — the applied week can differ from the generated one (a swap). If the
          //                     athlete moved intervals to Thursday, Thursday's triad is not this
          //                     day's triad, and quietly showing it anyway is exactly the "parallel
          //                     systems computing the same thing differently" failure.
          //
          // WHAT CHANGED 2026-07-25 (Emil: "each calendar tile will show the target distance for
          // Current, Target, Stretch and Goal as separate mile numbers … and when the run is
          // complete only that number illuminates as done"):
          //
          // The fifth condition used to be `not logged`, which dropped the row the moment a run
          // went in — killing it in exactly the state he wanted it for. Logging a run does not
          // remove the three targets; it decides which one you met. So the row now survives the
          // log and changes AUTHORSHIP instead of visibility: before the run the chips are three
          // roads you can eye, after it they are three targets and the run picks one. Nothing
          // about the derivation moved — classifySessionRung reads the logged distance, the pick
          // is ignored the moment the day is settled, and Arnold still derives rather than asks.
          //
          // `tierSpreadMi > 0` also stopped meaning "print nothing". Three identical numbers are
          // still not a ladder and are still never painted as one, but week 1 and every cut-back
          // week are flat, and a tile that simply went blank there read as a bug. The flat day now
          // says so in one chip.
          const td = tw && Array.isArray(tw.days) ? tw.days[i] : null;
          const tierableHere = !!(td && td.tierable && td.tierMonotone && td.type === d.type);
          const tri = (tierableHere && td.tierSpreadMi > 0) ? td : null;
          const flatMi = (tierableHere && !(td.tierSpreadMi > 0) && td.tiers && td.tiers.baseline)
            ? (Number(td.tiers.baseline.distanceMi) || 0) : 0;
          // Settled = the day has already happened. A settled day is a verdict, not a menu.
          const settled = status === 'done' || status === 'missed';
          const logged = status === 'done' ? actualMiOf(i) : null;
          // WHICH RUNG THE RUN HIT — derived, never asked. The highest rung whose distance the
          // logged run actually met, inside planTiers' own tolerance. `short` means it came in
          // under all three, and in that case NOTHING lights: a tile that lit a rung anyway would
          // be flattering him with a number he did not run.
          const hit = (tri && logged != null) ? classifySessionRung({ tiers: tri.tiers, actualMi: logged }) : null;
          const pickRung = (tri && !settled && RUNG_ORDER.includes(picks[i])) ? picks[i] : 'baseline';
          const pickMi = (tri && !settled && tri.tiers[pickRung]) ? tri.tiers[pickRung].distanceMi : null;
          // The big number follows the rung you are eyeing. Nothing is written anywhere.
          const showMi = (pickMi > 0) ? pickMi : mi;
          // …and once the day is settled it follows the rung the run actually hit, so the headline
          // figure and the lit chip are the same colour and cannot tell two different stories.
          const bigTone = (hit && hit.rung && hit.rung !== 'baseline') ? RUNG_TONE[hit.rung]
            : (!settled && pickRung !== 'baseline') ? RUNG_TONE[pickRung] : undefined;
          // Emil, 2026-07-25: "these tiles are huge … Still a lot of space in mobile". The tile
          // was ~110px tall (80 minHeight + 18px padding + three 5px gaps + four stacked rows)
          // for four short facts. Same four facts, ~72px: tighter padding, smaller gaps, a
          // smaller headline figure and a smaller effort silhouette.
          return (
            <div key={i} onClick={() => { setAdaptOpen(false); setOpenSession(isOpen ? null : i); }}
              title={structure ? 'Tap for the workout structure' : 'Tap for the session detail'}
              style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, padding: '6px 8px', minHeight: 58, display: 'flex', flexDirection: 'column', gap: 3, background: `linear-gradient(160deg, ${c}1f, transparent 72%)`, border: `0.5px solid ${status === 'today' ? '#5eead4' : isOpen ? c : c + '44'}`, opacity: status === 'missed' ? 0.5 : 1, cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 14 }}>
                <span title={aggr ? `Aggravates your ${injury}` : undefined} style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: aggr ? '#fbbf24' : 'var(--text-muted)' }}>{DAY_LABELS[i]}{aggr ? ' ⚠' : ''}</span>
                {/* Top-right corner, CONSISTENTLY: the STR chip whenever there's a strength double
                    (quality days too — it sits next to the silhouette, not hidden by it), plus the
                    effort silhouette on quality days. One home for the lift indicator on every tile. */}
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
                  {str && <span style={{ fontSize: 7.5, fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.16)', borderRadius: 4, padding: '0px 4px' }}>STR</span>}
                  {structure && <span style={{ width: isMobile ? 42 : 64, flex: 'none' }}><WorkoutSilhouette profile={structure.profile} color={c} height={isMobile ? 13 : 16} /></span>}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <SessionGlyph type={d.type} color={c} size={13} />
                <span style={{ fontSize: 11, fontWeight: 600, color: c, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                {status === 'done' && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#34d399', fontWeight: 700, flex: 'none' }}>✓</span>}
                {status === 'missed' && <span style={{ marginLeft: 'auto', fontSize: 8, color: '#f87171', fontWeight: 700, flex: 'none', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Missed</span>}
              </div>
              {/* bottom row — effort/tag on the left, mileage big on the bottom-right */}
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4, marginTop: 'auto' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                  {structure
                    ? <span style={{ fontSize: 8.5, fontWeight: 700, color: c, background: `${c}1e`, borderRadius: 4, padding: '0px 4px' }}>{structure.tag} ▸</span>
                    : (pace
                        ? <><Lightning size={10} color="rgba(255,255,255,0.5)" weight="fill" /><span style={{ fontSize: 9, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{pace}</span></>
                        : (d.type === 'strength' ? <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>~45 min</span> : null))}
                </span>
                {showMi != null
                  ? <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 0.9, color: bigTone }}>{showMi}<span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 500 }}>mi</span></span>
                  : (durMin > 0 && <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 0.9 }}>{durMin}<span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 500 }}> min</span></span>)}
              </div>
              {/* ── THE THREE ROADS, ON THE TILE ──────────────────────────────────────────────
                  Emil: "each calendar tile will show the target distance for Current, Target,
                  Stretch and Goal as separate mile numbers, may be on the side or the bottom of
                  the tile, and then when the run is complete only that number illuminates as
                  done."

                  BEFORE the run: three tappable chips. Tapping one moves the big number above it
                  and the week budget below the grid, and nothing else — no calendar is written.
                  AFTER the run: the chips stop being a choice and become a verdict. Exactly one
                  lights, chosen by classifySessionRung from the distance actually logged, and the
                  other two recede to 34% so "only that number illuminates" is literally true. If
                  the run came in under every rung, none lights and the lowest one is marked short.

                  Labels only on web. A phone tile is a third of ~360px, so a chip is ~28px wide
                  and "Stretch" at any legible size becomes "Str…", which is worse than no label —
                  the week-budget row directly under the grid names all three in the same colours
                  and the same left-to-right order, so it is the legend for every tile above it.
                  stopPropagation because the tile itself opens the session drill-down, and
                  choosing a tier is not opening a session. */}
              {tri && (
                <div style={{ display: 'flex', gap: 3, marginTop: 2 }} onClick={e => e.stopPropagation()}>
                  {RUNG_ORDER.map(k => {
                    const t = tri.tiers[k];
                    if (!t || !(t.distanceMi > 0)) return null;
                    const kc = RUNG_TONE[k];
                    const dm = tri.tierDeltaMi ? tri.tierDeltaMi[k] : 0;
                    // One rule for both states, so a chip can never be lit for two reasons at
                    // once: settled days answer to the run, live days answer to the pick.
                    const lit = settled ? !!(hit && hit.rung === k) : pickRung === k;
                    const under = settled && k === RUNG_ORDER[0] && !!(hit && hit.short);
                    const bc = under ? '#f87171' : kc;
                    const title = settled
                      ? (lit ? `Ran ${logged} mi — that is ${rungTier[k]} (asked ${t.distanceMi})`
                        : under ? `Ran ${logged} mi — under ${rungTier[k]}, which asked ${t.distanceMi}`
                          : `${rungTier[k]} asked ${t.distanceMi} mi`)
                      : `${rungTier[k]} · ${t.distanceMi} mi${dm > 0 ? ` (+${dm} over ${rungTier[RUNG_ORDER[0]]})` : ''}`;
                    return (
                      <button
                        key={k}
                        title={title}
                        onClick={settled ? undefined : () => setPicks(p => (p[i] === k ? { ...p, [i]: 'baseline' } : { ...p, [i]: k }))}
                        style={{
                          all: 'unset', cursor: settled ? 'default' : 'pointer', flex: 1, minWidth: 0,
                          textAlign: 'center', borderRadius: 5, padding: '1px 0',
                          fontVariantNumeric: 'tabular-nums',
                          opacity: (settled && !lit && !under) ? 0.34 : 1,
                          color: (lit || under) ? bc : 'var(--text-muted)',
                          background: lit ? `${bc}22` : 'transparent',
                          border: `0.5px solid ${lit ? `${bc}88` : under ? '#f8717155' : 'rgba(255,255,255,0.05)'}`,
                        }}
                      >
                        {!isMobile && (
                          <div style={{ fontSize: 6.5, fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase', lineHeight: 1.2, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {rungTier[k]}
                          </div>
                        )}
                        <div style={{ fontSize: isMobile ? 9 : 9.5, fontWeight: lit ? 800 : 600, lineHeight: 1.15 }}>
                          {t.distanceMi}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {/* The FLAT day — early weeks and every cut-back week, where the three plans
                  genuinely prescribe the same run. Said out loud in one chip rather than either
                  painting 6 / 6 / 6 as a ladder (a lie) or going blank (reads as a bug). */}
              {!tri && flatMi > 0 && (
                <div
                  title={`All three roads prescribe the same ${flatMi} mi today — there is nothing to choose between them this week.`}
                  style={{
                    marginTop: 2, borderRadius: 5, padding: '1px 4px', textAlign: 'center',
                    border: '0.5px solid rgba(255,255,255,0.05)', fontSize: 7.5, lineHeight: 1.3,
                    color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  All three roads · {flatMi} mi
                </div>
              )}
            </div>
          );
        };

        // A recessive RECOVERY tile — rest and mobility are one bucket; the athlete
        // elects rest or a light mobility session. Web full-week only.
        const OffTile = ({ i }) => {
          const c = '#34d399';
          return (
            <div key={i} style={{ position: 'relative', overflow: 'hidden', borderRadius: 10, padding: '6px 8px', minHeight: 58, display: 'flex', flexDirection: 'column', gap: 3, border: '0.5px dashed rgba(255,255,255,0.08)', opacity: 0.7 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', height: 14 }}>{DAY_LABELS[i]}</div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <SessionGlyph type="mobility" color={c} size={13} />
                <span style={{ fontSize: 11, fontWeight: 600, color: c }}>Recovery</span>
              </span>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', lineHeight: 1.25 }}>Rest or 15-min mobility</div>
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
            {/* ── THE WEEK BUDGET ── the amendment Emil approved, and the reason the triad is safe
                 to make per-session. If every session is independently choosable then nothing stops
                 you assembling a week no coach would write: challenge long run AND challenge tempo
                 AND challenge midweek. That is not the challenge plan, it is three plans' hardest
                 days stacked, and miles alone cannot catch it — a Reach long run plus a Reach tempo
                 is the same mileage as one Challenge long run and a completely different week. So
                 core/planTiers.weekBudgetStatus guards VOLUME and QUALITY separately, and this line
                 is the only place either is reported. It never blocks a choice; it says what the
                 week you just assembled actually is, and names the one change that fixes it. */}
            {tw && (() => {
              let bs = null;
              try { bs = weekBudgetStatus({ week: tw, picks }); } catch { bs = null; }
              if (!bs) return null;
              const anyPick = RUNG_ORDER.some(k => k !== 'baseline' && Object.values(picks).includes(k));
              const bc = !bs.ok ? '#fbbf24' : (RUNG_TONE[bs.onRung] || 'var(--text-muted)');
              return (
                <div style={{ marginTop: 9, padding: '8px 10px', borderRadius: 10, border: `0.5px solid ${bs.ok ? 'var(--border-subtle)' : '#fbbf2455'}`, background: bs.ok ? 'rgba(255,255,255,0.02)' : '#fbbf240d' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Week budget</span>
                    {/* Doubles as the LEGEND for the chips on every tile above: same three names,
                        same three colours, same left-to-right order. That is what lets the mobile
                        chips be numbers only without becoming three anonymous digits. */}
                    {RUNG_ORDER.map(k => (tw.budgetMi && tw.budgetMi[k] > 0 ? (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontVariantNumeric: 'tabular-nums', fontWeight: bs.onRung === k ? 700 : 500, color: bs.onRung === k ? RUNG_TONE[k] : 'var(--text-muted)' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: RUNG_TONE[k], flex: 'none' }} />
                        {rungTier[k]} {tw.budgetMi[k]}
                      </span>
                    ) : null))}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, fontWeight: 800, color: bc, fontVariantNumeric: 'tabular-nums' }}>{bs.totalMi} mi</span>
                  </div>
                  {bs.note
                    ? <div style={{ fontSize: 10, lineHeight: 1.5, marginTop: 5, color: bs.ok ? 'var(--text-secondary)' : '#fbbf24' }}>{bs.note}</div>
                    : (!anyPick && (
                      // Was a four-line paragraph restating what the chips already show. The chips
                      // are now labelled and the row above is their legend, so the only thing left
                      // worth saying is the one thing no layout can say by itself.
                      <div style={{ fontSize: 9.5, lineHeight: 1.5, marginTop: 5, color: 'var(--text-muted)' }}>
                        Tap a number on any day to price that week. Nothing is written to your calendar — the tier you hit is decided by the run you log.
                      </div>
                    ))}
                </div>
              );
            })()}
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
                        if (act) execution = scoreSession({ planned: { type: od.type, distanceMi: od.distanceMi, paceTarget: od.paceTarget }, actual: { distanceMi: act.distanceMi, avgPaceRaw: act.avgPaceRaw, durationSecs: act.durationSecs, avgHR: act.avgHR }, zones: easyCeil ? { z2Ceiling: easyCeil } : null });
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
                      {bodyPurpose}{paceForType(od.type) ? ` · ${odMi ? odMi + ' mi ' : ''}@ ${paceForType(od.type)}/mi` : (od.type === 'strength' ? ' · ~45 min' : (durMin ? ` · ${durMin} min` : ''))}{easyCeil && ['easy_run', 'recovery', 'long_run'].includes(od.type) ? ` · keep it ≤${easyCeil} bpm (easy)` : ''}
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
                <select className="arnold-compact-input" value={target} onChange={e => { targetExplicit.current = true; setTarget(e.target.value); generate(e.target.value); }} style={sel}>
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
