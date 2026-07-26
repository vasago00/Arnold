// ─── Calendar Tab ────────────────────────────────────────────────────────────
// Phase 4r.calendar.1
//
// Replaces the legacy RacesTab. Shows a month grid (7×6) where each day
// tile renders a compact summary of what happened (or what's planned)
// that day. Tap a tile → opens an inline day drawer with planned +
// completed activities, recovery metrics, race entry, and notes.
//
// Race entry routes:
//   1. Curated catalog (raceCatalog.js) — picker with region/distance
//      filters + free-text search
//   2. ICS sync (existing arnold:calendar-url) — pulls from any calendar
//      feed, used historically for Garmin race calendars
//   3. Manual entry (existing) — name + date + distance form
//
// Tile design: Option B (color-tinted background by activity type, icon
// in the middle, race trophy in the top-right, dashed border for
// planned-not-done days).

import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { PersonSimpleTaiChi } from "@phosphor-icons/react/PersonSimpleTaiChi";  // per-icon deep import (bypasses barrel; see LivingPlan note) — avoids Rolldown build OOM
import { useSwipeNav } from "./MobileHome.jsx";
import { storage } from "../core/storage.js";
import { getRaces, saveRaces, deleteRaceEverywhere } from "../core/memory.js";
import { allActivities as getUnifiedActivities } from "../core/dcyMath.js";
import { isRun, isStrength, isHIIT, isExplicitHIIT, isHybridWorkout, isMobility, isCycling, isSwim, isSki, isWalk } from "../core/activityClass.js";
import { getPlannerWeek, savePlannerWeek, weekKey, DAY_TYPES, daySessions, makeDay, dayRunMiles, dayWorkoutCount, weekPlanTotals } from "../core/planner.js";
import { SESSION_RUN_TYPES } from "../core/runMiles.js";   // ROUND 98 — the ONE "does this carry run miles" set
import { PLAN_TYPE_FAMILY } from "../core/todayStatus.js";   // plan-type → family for the planned-session rail
// The three roads, on the ACTUAL month grid (Emil: "I see nothing on the Calendar for the option
// on what to run"). READ ONLY — the calendar never builds a triad, it reads back the one that was
// frozen onto the commitment when the plan was applied. See indexTriadByDate below.
import { getCommitment } from "../core/planCommitment.js";
import { triadDayFrom, classifySessionRung, RUNG_ORDER } from "../core/planTiers.js";
import { LivingPlan } from "./LivingPlan.jsx";   // 3.2c — the living plan (retires the static SeasonPlanGenerator)
import { ChangeSessionWindow } from "./ChangeSessionWindow.jsx";   // THE single change/swap hub (Option B)
import { recordPlanChange } from "../core/planChanges.js";   // capture intentional changes → coach responds/re-calibrates
import { planChangeLine } from "../core/coachNarrative.js";   // moment-of-action coach voice (spoken the instant you commit)
import { getModalities } from "../core/modalities.js";
import { sessionAggravatesInjury } from "../core/injury.js";
import { analyzePlannedWeek, analyzeSeason } from "../core/planLoad.js";
import { CoachSigil } from "./CoachSigil.jsx";
import { morningWeightRows } from "../core/bodyWeight.js";
import { fetchAndParseICS } from "../core/parsers/icsParser.js";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { PredictedBandsCard } from "./PredictedBandsCard.jsx";
import { plannedMinutes } from "./PlannedWorkoutTile.jsx";
import { sigSrc as sigSrcOf } from "../core/activitySignatures.js";
import { predictRaceFinish } from "../core/derive/tileMetrics.js";
// Phase 4r.dataspine.4 — calorie/macro target reads route through
// goalModel.js (the canonical Layer 3 surface). resolveCalorieTarget
// import removed; all consumers in this file migrated.
import { getEffectiveTargets } from "../core/goalModel.js";
import { getGoals } from "../core/goals.js";
import {
  RACE_CATALOG, REGION_OPTIONS, DISTANCE_FILTERS,
  filterCatalog, defaultDateForRace, distanceLabel,
} from "../core/raceCatalog.js";
import { localDate, ymd } from "../core/time.js";

// Activity family → color + icon glyph (Tabler-ish unicode for inline use).
// Phase colors for the plan-generator PREVIEW overlay on the grid (C3).
const PHASE_OVERLAY = { build: '#60a5fa', 'mini-taper': '#fbbf24', 'race-week': '#ef4444', recovery: '#34d399' };

const FAMILY_STYLE = {
  run:      { color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.32)', icon: '→' },
  long_run: { color: '#60a5fa', bg: 'rgba(96,165,250,0.13)',  border: 'rgba(96,165,250,0.36)', icon: '→' },
  tempo:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.32)', icon: '↗' },
  intervals:{ color: '#fb7185', bg: 'rgba(251,113,133,0.12)', border: 'rgba(251,113,133,0.36)', icon: '⇈' },
  // Phase 4r.color.1 — HIIT shifted to coral-pink so it reads distinct
  // from tempo (amber) at mobile-calendar tile size. Distinct from race
  // red (#ef4444) because this is a pink, not a deep red.
  hiit:     { color: '#fb7185', bg: 'rgba(251,113,133,0.14)', border: 'rgba(251,113,133,0.40)', icon: '⚡' },
  strength: { color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.32)', icon: '◇' },
  mobility: { color: '#5eead4', bg: 'rgba(94,234,212,0.10)',  border: 'rgba(94,234,212,0.32)', icon: '~' },
  cross:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', border: 'rgba(148,163,184,0.32)', icon: '○' },
  // First-class cross-train disciplines — their own color/border so a planned
  // cycle/swim tile reads amber/cyan (matching its figure) instead of gray-rest.
  cycle:    { color: '#eab308', bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.32)',  icon: '⚙' },
  swim:     { color: '#38bdf8', bg: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.30)', icon: '≈' },
  ski:      { color: '#818cf8', bg: 'rgba(129,140,248,0.10)', border: 'rgba(129,140,248,0.30)', icon: '⛷' },
  walk:     { color: '#34d399', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)', icon: '⇢' },
  race:     { color: '#ef4444', bg: 'rgba(239,68,68,0.16)',   border: 'rgba(239,68,68,0.50)',  icon: '★' },
  rest:     { color: '#64748b', bg: 'transparent',             border: 'rgba(140,140,140,0.18)', icon: '' },
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
// Phase 4r.calendar.21 — week starts Monday (ISO 8601 / European
// convention). Calendar grid header + startWeekday math both use
// this order. Date.getDay() returns Sun=0..Sat=6, so we remap with
// (day + 6) % 7 to get Mon=0..Sun=6.
const WEEKDAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// Decide an activity's display family from its parsed flags.
//
// Phase 4r.calendar.fix.3 — three running visual identities, each routing
// to a different image AND label, in priority order:
//
//   1. Hybrid / multi-modal (HYROX, CrossFit, AMRAP, EMOM, circuit, F45,
//      Orangetheory): even if there's running distance, the OTHER components
//      (stations, weights, gymnastics) define the workout's shape. Family
//      'hiit' → hiit.png. Why: "HIIT" in the user mental model = "running +
//      something else."
//   2. Pure-running with HIIT structure (Fartlek, track repeats, sprint
//      intervals, 400s): distance + interval structure but ONLY running.
//      Family 'intervals' → speed.png. The leaning-to-explode figure.
//   3. Pure-running steady-state (easy run, long run, tempo, Z2):
//      Family 'run' / 'long_run' → easy-run.png.
//
// User feedback 2026-05-26: HYROX sessions were being misclassified as
// Intervals after the first fix because they also pass isRun() (running
// distance present) AND isHIIT() (the 'hyrox' keyword is in HIIT_RE).
// The hybrid check at the top resolves the ambiguity in favor of HIIT.
// Long-run threshold (miles). A run longer than this auto-classifies as a
// long run. Phase 4r.run.longrun — lowered from 13 to 10 per user.
const LONG_RUN_MIN_MI = 10;

function activityFamily(a) {
  if (!a) return 'rest';
  if (isMobility(a)) return 'mobility';
  // Hybrid multi-modal workouts (HYROX, CrossFit, etc.) → 'hiit' even with
  // running distance. The hybrid check goes BEFORE the run-with-distance
  // check so HYROX sessions don't accidentally route to 'intervals'.
  if (isHybridWorkout(a)) return 'hiit';
  // Phase 4r.calendar.fix.4 — explicit HIIT label ("HIIT", cardio_training,
  // high_intensity_interval_training) wins over run-with-distance. Without
  // this, a Garmin HIIT session that happened to record running distance
  // landed in the 'intervals' branch and showed the speed-icon labelled
  // "Intervals" instead of HIIT. Fartlek/sprint/tempo without the bare HIIT
  // token still take the run-with-distance path below.
  if (isExplicitHIIT(a)) return 'hiit';
  // Pure-running with distance: intervals get speed.png, regular runs
  // get easy-run.png. Long runs split off.
  if (isRun(a) && (Number(a.distanceMi) || 0) > 0) {
    const mi = Number(a.distanceMi) || 0;
    // Phase 4r.run.longrun — auto-classify any run > 10 mi as a long run
    // (was >= 13). Per user: 10 mi is the long-run boundary for this athlete.
    if (mi > LONG_RUN_MIN_MI) return 'long_run';
    if (isHIIT(a)) return 'intervals';
    return 'run';
  }
  if (isHIIT(a))     return 'hiit';
  if (isStrength(a)) return 'strength';
  if (isRun(a)) {
    // Run flag set but no distance — treadmill incidents, very-short laps.
    return 'run';
  }
  // Phase 4r.sports / 0.3b — cycling/swim/ski/walk are first-class disciplines,
  // each with its own figure/color. Detection centralized in activityClass.
  if (isSki(a))     return 'ski';
  if (isCycling(a)) return 'cycle';
  if (isSwim(a))    return 'swim';
  if (isWalk(a))    return 'walk';
  return 'rest';
}

// Phase 4r.calendar.fix.8 — pick the DOMINANT activity for the tile's image
// when a day has multiple completed sessions. Picking completed[0] (whichever
// was logged first) caused days with morning mobility + afternoon HIIT/Run
// to display the mobility figure instead of the main workout. The right
// ranking is by training significance, not by log order.
//
// Priority (highest to lowest training-load weight):
//   race > hiit > long_run > intervals > tempo > run > strength > cross >
//   mobility > rest
//
// Mobility ranks LAST among active sessions because it's a recovery /
// supplementary block, not a training stimulus. The secondary-activity
// rail (small dots beside the image) still surfaces the mobility so it's
// not invisible — it just doesn't claim the main image slot.
const FAMILY_PRIORITY = {
  race: 100,
  hiit: 90,
  long_run: 85,
  intervals: 80,
  tempo: 75,
  run: 70,
  // Cross-train disciplines rank as the day's headline workout — above strength so a
  // Cycle+Strength day leads with the bike (matching the plan tab), below the runs.
  cycle: 68,
  ski: 67,
  swim: 66,
  strength: 65,
  cross: 60,
  walk: 40,
  mobility: 20,
  rest: 0,
};
function dominantActivityFamily(completed) {
  const a = dominantActivity(completed);
  return a ? activityFamily(a) : null;
}

/**
 * Pick the single most-significant completed activity by training-priority.
 * Used so the rail-of-secondary-activities can filter against the SAME object
 * the image is rendered from (instead of assuming index 0).
 */
function dominantActivity(completed) {
  if (!completed || completed.length === 0) return null;
  let best = completed[0];
  let bestRank = FAMILY_PRIORITY[activityFamily(best)] ?? 50;
  for (let i = 1; i < completed.length; i++) {
    const r = FAMILY_PRIORITY[activityFamily(completed[i])] ?? 50;
    if (r > bestRank) { best = completed[i]; bestRank = r; }
  }
  return best;
}

/**
 * All completed activities EXCEPT the dominant one, preserving order.
 * The rail renders these as small dots / family icons so a morning mobility
 * stays visible after the HIIT/intervals claims the main image.
 */
function secondaryActivities(completed, max = 3) {
  const dom = dominantActivity(completed);
  return (completed || []).filter(a => a !== dom).slice(0, max);
}

// Pull today-or-earlier completed activities and group by date string.
function indexActivitiesByDate(activities) {
  const map = new Map();
  for (const a of activities) {
    if (!a.date) continue;
    if (!map.has(a.date)) map.set(a.date, []);
    map.get(a.date).push(a);
  }
  return map;
}

// Walk planner weeks and build a date → planned entry map.
function indexPlannerByDate(monthYear, monthMonth) {
  // Get the Monday-keyed week strings covering the displayed month + a
  // little overflow into adjacent months. Each planner week stores
  // 7 days starting Monday.
  const map = new Map();
  const start = new Date(monthYear, monthMonth, -6);  // a few days before month start
  const end   = new Date(monthYear, monthMonth + 1, 7); // a few after end
  // Iterate week-by-week.
  const cursor = new Date(start);
  while (cursor <= end) {
    const wk = weekKey(cursor);
    const week = getPlannerWeek(wk);
    if (week && Array.isArray(week.days)) {
      const monday = new Date(wk + 'T12:00:00');
      week.days.forEach((dayEntry, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const ds = ymd(d);
        if (!map.has(ds)) map.set(ds, dayEntry);
      });
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return map;
}

// ── THE THREE ROADS ON THE MONTH GRID ────────────────────────────────────────────────
// Emil, 2026-07-25: "I see nothing on the Calendar for the option on what to run."
//
// Fair — the per-session triad shipped onto LivingPlan's THIS-WEEK strip, which is a
// different surface from the month grid he was looking at. This puts it where he asked
// for it, and the ONE rule that governs how is: the calendar does not compute a triad.
//
// It cannot. Building one here would mean a second call to buildTierTriad off a second
// read of the base, the ladder and the race set — and the moment either surface's inputs
// moved a day out of step with the other's, the calendar and the plan would print
// different mileages for the same Tuesday. That is exactly the "parallel systems
// computing the same thing differently" failure Emil has named more than once, and it is
// not worth three numbers on a tile.
//
// So the calendar READS BACK the triad that was frozen onto the commitment record at the
// moment the plan was applied (planTiers.packTriad → commitment.triad). One derivation,
// one writer, two readers. If nothing has been committed there is simply nothing to show,
// which is correct: three roads you never chose between are not a fact about your week.
//
// The type gate is the same one LivingPlan applies. A frozen day carries the session type
// it was generated as; if the athlete has since swapped Tuesday's intervals to Thursday,
// Thursday's numbers are not this day's numbers, and quietly showing them anyway would be
// the same class of lie in a smaller font.
function indexTriadByDate(monthYear, monthMonth) {
  const map = new Map();
  const labels = {};
  let packed = null;
  try {
    const c = getCommitment();
    packed = (c && c.triad && c.triad.weeks) ? c.triad : null;
  } catch { packed = null; }
  if (!packed) return { map, labels };
  // The athlete's OWN vocabulary (Current / Target / Stretch / Ceiling / Goal), matched by
  // rung and never by array position — a triad that ever ships fewer than three rungs must
  // not silently shift every label one place along.
  RUNG_ORDER.forEach((k) => {
    const r = (packed.rungs || []).find(x => x && x.rung === k);
    labels[k] = (r && r.tierLabel) || k;
  });
  const start = new Date(monthYear, monthMonth, -6);
  const end   = new Date(monthYear, monthMonth + 1, 7);
  const cursor = new Date(start);
  while (cursor <= end) {
    const wk = weekKey(cursor);
    const monday = new Date(wk + 'T12:00:00');
    for (let i = 0; i < 7; i++) {
      const day = triadDayFrom(packed, wk, i);
      if (!day) continue;
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = ymd(d);
      if (!map.has(ds)) map.set(ds, day);
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return { map, labels };
}

// The tile's three-number row. Shared by DayTile and MobileDayTile so the web grid and the
// phone grid cannot drift — the same component, the same rule, two sizes.
//
// BEFORE the run: three targets, dimmed, in ladder order.
// AFTER it: exactly one lights — the highest rung the logged distance actually met, decided
// by planTiers.classifySessionRung and by nothing else. Under all three, none lights and the
// lowest is marked red, because lighting a rung he did not run would be flattery.
function TriadRow({ triad, plannedTypes, actualMi, isPast, labels, compact }) {
  if (!triad || !triad.tiers) return null;
  // Type gate — a swapped session is not this day's triad. Only enforced when the day HAS a
  // planned session to compare against; an empty planner day (nothing applied there, or the
  // week was cleared) simply has nothing to contradict the frozen record.
  const types = plannedTypes || [];
  if (triad.type && types.length && !types.includes(triad.type)) return null;
  const mis = RUNG_ORDER.map(k => triad.tiers[k] && triad.tiers[k].distanceMi).filter(x => x > 0);
  if (mis.length < 2) return null;
  const settled = actualMi > 0 || isPast;
  const hit = actualMi > 0 ? classifySessionRung({ tiers: triad.tiers, actualMi }) : null;
  const TONE = { baseline: '#94a3b8', reach: '#5eead4', challenge: '#e0b45e' };

  // FLAT DAY. Early in a block all three roads genuinely prescribe the same run — the ladder
  // only opens up once the blocks have had weeks to diverge. Printing 4 / 4 / 4 across the
  // tile would paint that as a choice the athlete doesn't have, and printing nothing (which
  // is what this surface did until 2026-07-26) reads as a broken feature. So: one chip that
  // says the true thing out loud, worded and toned exactly as LivingPlan's week strip words
  // it, because the same Tuesday must not be described two ways on two screens.
  const spread = Math.max(...mis) - Math.min(...mis);
  if (spread < 0.05) {
    const flatMi = mis[0];
    const done = actualMi > 0 && actualMi >= flatMi - 0.05;
    const shortOf = actualMi > 0 && !done;
    const bc = done ? '#5eead4' : shortOf ? '#f87171' : null;
    return (
      <div
        title={actualMi > 0
          ? `Ran ${actualMi} mi against ${flatMi} mi — all three roads asked for the same run today.`
          : `All three roads prescribe the same ${flatMi} mi today — there is nothing to choose between them this week.`}
        style={{
          flexShrink: 0, borderRadius: 3, textAlign: 'center',
          padding: compact ? '0px 1px' : '0px 2px',
          fontSize: compact ? 6.5 : 7.5, fontWeight: done ? 800 : 600,
          fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
          opacity: settled ? 1 : 0.75,
          color: bc || 'var(--text-muted)',
          background: done ? `${bc}22` : 'transparent',
          border: `0.5px solid ${bc ? `${bc}88` : 'rgba(255,255,255,0.05)'}`,
          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.3,
        }}>{compact ? `All 3 · ${flatMi}` : `All three roads · ${flatMi} mi`}</div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 1.5, flexShrink: 0, lineHeight: 1 }}>
      {RUNG_ORDER.map(k => {
        const t = triad.tiers[k];
        if (!t || !(t.distanceMi > 0)) return null;
        const lit = !!(hit && hit.rung === k);
        const under = !!(hit && hit.short) && k === RUNG_ORDER[0];
        const bc = under ? '#f87171' : TONE[k];
        const name = labels[k] || k;
        return (
          <span key={k}
            title={lit ? `Ran ${actualMi} mi — that is ${name} (asked ${t.distanceMi})`
              : under ? `Ran ${actualMi} mi — under ${name}, which asked ${t.distanceMi}`
                : `${name} · ${t.distanceMi} mi`}
            style={{
              flex: 1, minWidth: 0, textAlign: 'center', borderRadius: 3,
              padding: compact ? '0px 1px' : '0px 2px',
              fontSize: compact ? 6.5 : 7.5, fontWeight: lit ? 800 : 600,
              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
              opacity: (settled && !lit && !under) ? 0.3 : (settled ? 1 : 0.75),
              color: (lit || under) ? bc : 'var(--text-muted)',
              background: lit ? `${bc}22` : 'transparent',
              border: `0.5px solid ${lit ? `${bc}88` : under ? '#f8717155' : 'rgba(255,255,255,0.05)'}`,
              overflow: 'hidden', whiteSpace: 'nowrap',
            }}>{t.distanceMi}</span>
        );
      })}
    </div>
  );
}

export function CalendarTab({ showToast }) {
  const [now, setNow] = useState(() => new Date());
  const [viewYear, setViewYear]   = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(localDate());
  // Phase 4r.calendar.14 — drawer can be collapsed so the user can
  // see just the calendar grid. Click the same date twice to toggle,
  // or use the X button in the drawer header.
  // Phase 4r.calendar.20 — mobile drawer is an overlay sheet, so it
  // should default closed (user shouldn't land on the page with a
  // sheet covering the grid). Desktop defaults open since it's a
  // sticky side-column.
  const [drawerOpen, setDrawerOpen] = useState(true);
  // Phase 4r.calendar.25 — mobile drawer is always open (inline
  // below the grid), so tap just changes the selected date. Desktop
  // still toggles the sticky right-drawer on re-tap.
  const handlePickDate = (date) => {
    setSelectedDate(date);
    if (typeof window !== 'undefined' && window.innerWidth <= 600) return;
    if (date === selectedDate && drawerOpen) {
      setDrawerOpen(false);
    } else {
      setDrawerOpen(true);
    }
  };

  // Phase 4r.calendar.13 — responsive layout. Wide screens (≥1000px)
  // get a two-column layout: month grid on the left, day drawer on
  // the right. Narrow screens keep the original vertical stack
  // (drawer above grid). Track window width so resizes flip the
  // layout live.
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1000 : true
  );
  // Phase 4r.calendar.20 — mobile detection. ≤600px gets the compact
  // tile + bottom-sheet variant instead of the desktop cockpit grid.
  // Matches the isMobileApp breakpoint used in Arnold.jsx so the
  // calendar feels native when mobile users get here via the
  // Calendar bottom-nav slot.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 600 : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setIsWide(window.innerWidth >= 1000);
      setIsMobile(window.innerWidth <= 600);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const [races, setRaces] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase 4r.calendar.34 — land on today every time CalendarTab mounts.
  // Resets the month view to today's month and scrolls today into view.
  // Doesn't fight subsequent user navigation: this runs once per mount,
  // and the user can scroll/click freely after.
  const todayCellRef = useRef(null);
  useEffect(() => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(localDate());
    // Wait one frame for the grid to render with the new month, then scroll.
    const id = requestAnimationFrame(() => {
      try {
        if (todayCellRef.current && todayCellRef.current.scrollIntoView) {
          todayCellRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
        } else {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        }
      } catch {}
    });
    return () => cancelAnimationFrame(id);
    // Empty deps — run once per mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [manualOpen, setManualOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);  // Phase 4r.calendar.33
  const [editPlan, setEditPlan] = useState(null); // {date, idx, session} when editing an existing planned session
  const [tick, setTick] = useState(0);
  const [genRaceReq, setGenRaceReq] = useState(null); // tap-a-race → open generator pre-targeted (C2)
  const [previewBlock, setPreviewBlock] = useState(null); // generator preview → grid overlay (C3)
  const [changeCtx, setChangeCtx] = useState(null);   // the ChangeSessionWindow context (Option B hub) — null = closed

  // ── Hold-and-sweep drag (mobile, per-session): long-press a drawer session
  // chip to pick it up, drag onto another day to move it, or fling it off the
  // grid to delete it (Emil). ──
  const gridRef = useRef(null);
  const ghostRef = useRef(null);
  const [drag, setDrag] = useState(false); // true only while a chip is being dragged (no per-move re-renders)

  const movePlannedSession = (fromDate, idx, toDate) => {
    try {
      const fromWk = weekKey(new Date(fromDate + 'T12:00:00'));
      const fromWeek = getPlannerWeek(fromWk);
      const fromMon = new Date(fromWk + 'T12:00:00');
      const fromIdx = Math.floor((new Date(fromDate + 'T12:00:00') - fromMon) / 86400000);
      if (fromIdx < 0 || fromIdx >= 7) return;
      const fromDays = [...(fromWeek.days || Array(7).fill({ type: 'rest' }))];
      while (fromDays.length < 7) fromDays.push({ type: 'rest' });
      const fromSessions = daySessions(fromDays[fromIdx]);
      const moved = fromSessions[idx];
      if (!moved) return;
      fromSessions.splice(idx, 1);
      fromDays[fromIdx] = makeDay(fromSessions);
      const toWk = weekKey(new Date(toDate + 'T12:00:00'));
      if (toWk === fromWk) {
        const toIdx = Math.floor((new Date(toDate + 'T12:00:00') - fromMon) / 86400000);
        if (toIdx < 0 || toIdx >= 7) return;
        fromDays[toIdx] = makeDay([...daySessions(fromDays[toIdx]), moved]);
        savePlannerWeek(fromWk, { ...fromWeek, days: fromDays });
      } else {
        savePlannerWeek(fromWk, { ...fromWeek, days: fromDays });
        const toWeek = getPlannerWeek(toWk);
        const toMon = new Date(toWk + 'T12:00:00');
        const toIdx = Math.floor((new Date(toDate + 'T12:00:00') - toMon) / 86400000);
        if (toIdx < 0 || toIdx >= 7) return;
        const toDays = [...(toWeek.days || Array(7).fill({ type: 'rest' }))];
        while (toDays.length < 7) toDays.push({ type: 'rest' });
        toDays[toIdx] = makeDay([...daySessions(toDays[toIdx]), moved]);
        savePlannerWeek(toWk, { ...toWeek, days: toDays });
      }
      setTick(t => t + 1);
      showToast?.(`Moved ${prettyFamily(moved.type)} to ${new Date(toDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    } catch (e) { console.warn('[calendar] move session failed:', e); }
  };

  const deletePlannedSession = (fromDate, idx) => {
    try {
      const wk = weekKey(new Date(fromDate + 'T12:00:00'));
      const week = getPlannerWeek(wk);
      const mon = new Date(wk + 'T12:00:00');
      const dIdx = Math.floor((new Date(fromDate + 'T12:00:00') - mon) / 86400000);
      if (dIdx < 0 || dIdx >= 7) return;
      const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
      while (days.length < 7) days.push({ type: 'rest' });
      const sessions = daySessions(days[dIdx]);
      const removed = sessions[idx];
      sessions.splice(idx, 1);
      days[dIdx] = makeDay(sessions);
      savePlannerWeek(wk, { ...week, days });
      setTick(t => t + 1);
      if (removed) showToast?.(`Removed ${prettyFamily(removed.type)}`);
    } catch (e) { console.warn('[calendar] delete session failed:', e); }
  };

  // ── Tile drag (mobile): long-press a calendar day that HAS a plan, then drag
  // it onto another day to move the whole day's plan, or fling it off the grid
  // to clear it. Touch handlers live ON THE TILE (the touch target) so moves
  // dispatch reliably; ghost + highlight are imperative (no per-move re-render).
  const dragRef = useRef(null);    // { date, label, overDate, offGrid, gb } during a drag
  const hlCellRef = useRef(null);  // currently-highlighted target cell
  const rafPending = useRef(false);
  const lastXY = useRef({ x: 0, y: 0 });

  const dayPlanLabel = (date) => {
    try {
      const sess = daySessions(plannerByDate.get(date)).filter(x => x.type && x.type !== 'rest');
      if (!sess.length) return 'move';
      const ff = sess[0];
      const mi = Number(ff.distanceMi) || 0;
      return `${prettyFamily(ff.type)}${mi > 0 ? ` \u00b7 ${mi} mi` : ''}${sess.length > 1 ? ` +${sess.length - 1}` : ''}`;
    } catch { return 'move'; }
  };
  const paintGhost = (cx, cy) => {
    const g = ghostRef.current, d = dragRef.current;
    if (!g || !d) return;
    g.style.left = cx + 'px';
    g.style.top = cy + 'px';
    g.style.background = d.offGrid ? 'rgba(220,38,38,0.92)' : 'var(--bg-surface)';
    g.style.borderColor = d.offGrid ? '#ef4444' : '#5eead4';
    g.style.color = d.offGrid ? '#fff' : 'var(--text-primary)';
    g.textContent = d.offGrid ? '\u2715 release to remove'
      : `${d.label}${d.overDate && d.overDate !== d.date ? ` \u2192 ${new Date(d.overDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`;
  };
  const highlightCell = (cellEl) => {
    const prev = hlCellRef.current;
    if (prev && prev !== cellEl) { prev.style.outline = ''; prev.style.outlineOffset = ''; }
    if (cellEl) { cellEl.style.outline = '2px solid #5eead4'; cellEl.style.outlineOffset = '-1px'; }
    hlCellRef.current = cellEl;
  };
  const moveDayPlan = (fromDate, toDate) => {
    try {
      const fromWk = weekKey(new Date(fromDate + 'T12:00:00'));
      const fromWeek = getPlannerWeek(fromWk);
      const fromMon = new Date(fromWk + 'T12:00:00');
      const fIdx = Math.floor((new Date(fromDate + 'T12:00:00') - fromMon) / 86400000);
      if (fIdx < 0 || fIdx >= 7) return;
      const fromDays = [...(fromWeek.days || Array(7).fill({ type: 'rest' }))];
      while (fromDays.length < 7) fromDays.push({ type: 'rest' });
      const moving = daySessions(fromDays[fIdx]).filter(x => x.type && x.type !== 'rest');
      if (!moving.length) return;
      fromDays[fIdx] = makeDay([]);
      const toWk = weekKey(new Date(toDate + 'T12:00:00'));
      if (toWk === fromWk) {
        const tIdx = Math.floor((new Date(toDate + 'T12:00:00') - fromMon) / 86400000);
        if (tIdx < 0 || tIdx >= 7) return;
        fromDays[tIdx] = makeDay([...daySessions(fromDays[tIdx]).filter(x => x.type && x.type !== 'rest'), ...moving]);
        savePlannerWeek(fromWk, { ...fromWeek, days: fromDays });
      } else {
        savePlannerWeek(fromWk, { ...fromWeek, days: fromDays });
        const toWeek = getPlannerWeek(toWk);
        const toMon = new Date(toWk + 'T12:00:00');
        const tIdx = Math.floor((new Date(toDate + 'T12:00:00') - toMon) / 86400000);
        if (tIdx < 0 || tIdx >= 7) return;
        const toDays = [...(toWeek.days || Array(7).fill({ type: 'rest' }))];
        while (toDays.length < 7) toDays.push({ type: 'rest' });
        toDays[tIdx] = makeDay([...daySessions(toDays[tIdx]).filter(x => x.type && x.type !== 'rest'), ...moving]);
        savePlannerWeek(toWk, { ...toWeek, days: toDays });
      }
      setTick(t => t + 1);
      showToast?.(`Moved to ${new Date(toDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    } catch (e) { console.warn('[calendar] move day plan failed:', e); }
  };
  const clearDayPlan = (date) => {
    try {
      const wk = weekKey(new Date(date + 'T12:00:00'));
      const week = getPlannerWeek(wk);
      const mon = new Date(wk + 'T12:00:00');
      const dIdx = Math.floor((new Date(date + 'T12:00:00') - mon) / 86400000);
      if (dIdx < 0 || dIdx >= 7) return;
      const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
      while (days.length < 7) days.push({ type: 'rest' });
      days[dIdx] = makeDay([]);
      savePlannerWeek(wk, { ...week, days });
      setTick(t => t + 1);
      showToast?.('Removed plan');
    } catch (e) { console.warn('[calendar] clear day plan failed:', e); }
  };
  // Normalise a stored planner week → the shape weekResolve wants ({ sessions:[{type,distanceMi}] } × 7).
  const buildNormWeek = (wk) => {
    const week = getPlannerWeek(wk);
    const days = [...(week.days || [])];
    while (days.length < 7) days.push({ type: 'rest' });
    return days.slice(0, 7).map((d) => ({ sessions: daySessions(d).map((s) => ({ type: s.type, distanceMi: Number(s.distanceMi) || 0 })) }));
  };
  const dayIdxOf = (wk, date) => Math.floor((new Date(date + 'T12:00:00') - new Date(wk + 'T12:00:00')) / 86400000);

  // SWAP (exchange) two days' plans within a week — the drag-to-swap commit. Distinct from the
  // legacy moveDayPlan (which STACKED onto the target); a swap exchanges, conserving the week.
  const swapDayPlans = (fromDate, toDate) => {
    try {
      const wk = weekKey(new Date(fromDate + 'T12:00:00'));
      if (wk !== weekKey(new Date(toDate + 'T12:00:00'))) { moveDayPlan(fromDate, toDate); return; }  // cross-week → legacy move
      const week = getPlannerWeek(wk);
      const fi = dayIdxOf(wk, fromDate), ti = dayIdxOf(wk, toDate);
      if (fi < 0 || fi >= 7 || ti < 0 || ti >= 7) return;
      const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
      while (days.length < 7) days.push({ type: 'rest' });
      const a = days[fi] || { type: 'rest' };
      days[fi] = days[ti] || { type: 'rest' };
      days[ti] = a;
      savePlannerWeek(wk, { ...week, days });
      setTick(t => t + 1);
      const wd = (dt) => new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      showToast?.(`Swapped ${wd(fromDate)} ⇄ ${wd(toDate)}`);
    } catch (e) { console.warn('[calendar] swap day plans failed:', e); }
  };

  // THE shared swap entry — from a drag drop, a web drag, or tap-to-pick. Given a source day and
  // a target day the athlete CHOSE, run the what-if and open the impact modal (commit on Confirm).
  // The athlete always picks the target; nothing is auto-chosen. Cross-week falls back to a move.

  // Tap-to-pick: the drawer's "Swap day" button arms this; the next day the athlete taps on the
  // grid becomes the target (handlePickDate routes here). Works identically on web + mobile, and
  // — unlike the old auto-pick — the athlete chooses the day.
  // Drawer entry points now open the single Change window (Option B hub) instead of arming a
  // separate pick-mode. Day button → hub; a session chip's ⇄ → hub scoped to that session.
  const beginSwapPick = (dateStr) => openChangeWindow(dateStr);
  const handleTileDrop = (fromDate, toDate) => {
    if (!toDate || toDate === fromDate) return;
    openChangeWindow(fromDate, { initialTarget: toDate, initialScope: 'both' });
  };

  // PER-SESSION move — arm from a session chip in the day drawer; the next day tapped becomes the
  // target, and we move JUST that session (leaving the other half of a double day in place).
  const beginSessionPick = (dateStr, idx) => openChangeWindow(dateStr, { initialScope: idx });

  // ── THE single change/swap hub (Option B). Opens from tap (day button / session chip) or a drag
  // (pre-selects Move + target). Builds the context the window needs; commits route through the
  // existing planner writers (swapDayPlans / movePlannedSession / makeDay+savePlannerWeek). ──
  const openChangeWindow = (date, opts = {}) => {
    try {
      const injuryVal = (() => { try { return storage.get('injury') || ''; } catch { return ''; } })();
      const wk = weekKey(new Date(date + 'T12:00:00'));
      const fromIdx = dayIdxOf(wk, date);
      if (fromIdx < 0 || fromIdx >= 7) return;
      const week = getPlannerWeek(wk);
      const wdays = [...(week.days || [])]; while (wdays.length < 7) wdays.push({ type: 'rest' });
      const all = daySessions(wdays[fromIdx]);
      const sessions = all.map((s, i) => ({ idx: i, type: s.type, label: prettyFamily(s.type), distanceMi: Number(s.distanceMi) || 0, aggravated: injuryVal ? sessionAggravatesInjury(s.type, injuryVal) : false }))
        .filter((s) => s.type && s.type !== 'rest' && s.type !== 'race');
      if (!sessions.length) { showToast?.('Nothing planned that day to change.'); return; }
      const parts = String(wk).split('-').map(Number);
      const monday = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
      const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const HARD = new Set(['tempo', 'intervals', 'hiit', 'long_run']);
      const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const targetDays = []; let openCount = 0; const openLabels = [];
      for (let ti = 0; ti < 7; ti++) {
        if (ti === fromIdx) continue;
        const d = new Date(monday); d.setDate(monday.getDate() + ti); const ds = fmt(d);
        const tAll = daySessions(wdays[ti]); const tReal = tAll.filter((x) => x.type && x.type !== 'rest' && x.type !== 'race');
        const isRace = tAll.some((x) => x.type === 'race'); const isRest = tReal.length === 0; const isHard = tReal.some((x) => HARD.has(x.type));
        const disabled = ds < todayStr || isRace;
        if (!disabled && isRest) { openCount++; openLabels.push(labels[ti]); }
        targetDays.push({ date: ds, idx: ti, label: labels[ti], disabled, warn: isHard, hint: isRest ? 'open' : (isHard ? 'hard' : '') });
      }
      setChangeCtx({
        date, dayLabel: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
        sessions, normWeek: buildNormWeek(wk), fromIdx, targetDays,
        modalities: getModalities(), injuryArea: injuryVal || null,
        weekOpenDays: openCount, openDayLabels: openLabels,
        initialTarget: opts.initialTarget || null, initialScope: opts.initialScope != null ? opts.initialScope : null,
      });
    } catch (e) { console.warn('[calendar] open change window failed:', e); }
  };
  const commitChangeMove = (scope, toDate) => {
    if (!changeCtx) return;
    if (scope === 'both') swapDayPlans(changeCtx.date, toDate);
    else movePlannedSession(changeCtx.date, scope, toDate);
    try {
      const s = Array.isArray(changeCtx.sessions) ? (scope === 'both' ? changeCtx.sessions[0] : changeCtx.sessions[scope]) : null;
      recordPlanChange({ date: changeCtx.date, kind: 'move', fromType: s ? s.type : null, toDate });
      const line = planChangeLine({ kind: 'move', fromType: s ? s.type : null, toDate });
      if (line) showToast?.(line);
    } catch {}
  };
  const SUB_TYPE = { sub_bike: 'cycle', sub_pool: 'cross', sub_rower: 'cross', sub_elliptical: 'cross', sub_gym: 'strength', sub_treadmill: null };
  const commitChangeSubstitute = (scope, opt) => {
    try {
      if (!changeCtx) return;
      const date = changeCtx.date; const wk = weekKey(new Date(date + 'T12:00:00'));
      const week = getPlannerWeek(wk); const days = [...(week.days || [])]; while (days.length < 7) days.push({ type: 'rest' });
      const fi = dayIdxOf(wk, date); if (fi < 0 || fi >= 7) return;
      const sess = daySessions(days[fi]); const idx = scope === 'both' ? 0 : scope;
      if (!sess[idx]) return;
      const fromType = sess[idx].type;   // capture BEFORE mutation — the coach re-calibrates by the session's role
      // Changing the type invalidates the baked-in paceTarget — clear it; pace is DERIVED from the
      // session type at display time (see LivingPlan paceForType), so it's always right, both ways.
      let changed = false; let logKind = 'substitute'; let logToType = null; let logDur = null;
      // coach-facing modality names so the narrative's cross-train detection fires (bike/pool/row/elliptical)
      const SUB_LABEL = { sub_bike: 'bike', sub_pool: 'pool swim', sub_rower: 'rowing', sub_elliptical: 'elliptical', sub_gym: 'strength' };
      if (opt.id === 'to_easy') {
        sess[idx] = { ...sess[idx], type: 'easy_run', paceTarget: null }; changed = true; logToType = 'easy_run';   // de-load → easy run (pace derived from type)
      } else if (opt.id === 'to_mobility') {
        sess[idx] = { type: 'mobility', label: 'Mobility', distanceMi: null, strength: false }; changed = true; logToType = 'mobility';   // make it a recovery day
      } else if (Object.prototype.hasOwnProperty.call(SUB_TYPE, opt.id)) {
        const t = SUB_TYPE[opt.id];
        if (!t) { showToast?.('Same session — on the treadmill.'); return; }
        // Cross-train is time-based, not run-mileage — DROP the run miles (Emil: "the 5
        // miles from the Tempo remained") and carry the duration the athlete entered
        // (falls back to any pre-existing durationMin). Bike/pool/row/etc. have no run pace.
        const dur = Number(opt.minutes) > 0 ? Math.round(Number(opt.minutes)) : (Number(sess[idx].durationMin) || null);
        sess[idx] = { ...sess[idx], type: t, distanceMi: null, durationMin: dur, paceTarget: null }; changed = true;
        logToType = SUB_LABEL[opt.id] || t; logDur = dur;
      } else if (opt.id === 'shorten_easy' || opt.id === 'shorten_quality') {
        const cur = Number(sess[idx].distanceMi) || 0; if (cur > 0) { sess[idx] = { ...sess[idx], distanceMi: Math.max(1, Math.round(cur * 0.6)) }; changed = true; logKind = 'shorten'; }
      } else { showToast?.(`${opt.title} — noted for today.`); return; }
      if (changed) {
        days[fi] = makeDay(sess); savePlannerWeek(wk, { ...week, days }); setTick((t) => t + 1);
        try {
          recordPlanChange({ date, kind: logKind, fromType, toType: logToType, durationMin: logDur });
          // Moment-of-action: the coach reacts the instant you commit — not only later on a surface you navigate to.
          const line = planChangeLine({ kind: logKind, fromType, toType: logToType, durationMin: logDur });
          showToast?.(line || `Changed to ${prettyFamily(sess[idx].type)}`);
        } catch { showToast?.(`Changed to ${prettyFamily(sess[idx].type)}`); }
      }
    } catch (e) { console.warn('[calendar] change substitute failed:', e); }
  };
  const commitChangeSkip = (scope) => {
    try {
      if (!changeCtx) return;
      const date = changeCtx.date; const wk = weekKey(new Date(date + 'T12:00:00'));
      const week = getPlannerWeek(wk); const days = [...(week.days || [])]; while (days.length < 7) days.push({ type: 'rest' });
      const fi = dayIdxOf(wk, date); if (fi < 0 || fi >= 7) return;
      let sess = daySessions(days[fi]);
      const skipped = scope === 'both' ? (sess[0] || null) : (sess[scope] || null);   // capture role before removal
      sess = scope === 'both' ? [] : sess.filter((_, k) => k !== scope);
      days[fi] = makeDay(sess); savePlannerWeek(wk, { ...week, days }); setTick((t) => t + 1);
      try {
        recordPlanChange({ date, kind: 'skip', fromType: skipped ? skipped.type : null });
        const line = planChangeLine({ kind: 'skip', fromType: skipped ? skipped.type : null });
        showToast?.(line || 'Removed from the plan');
      } catch { showToast?.('Removed from the plan'); }
    } catch (e) { console.warn('[calendar] change skip failed:', e); }
  };

  const tileDragStart = (date, x, y) => {
    try { navigator.vibrate?.(15); } catch {}
    dragRef.current = { date, label: dayPlanLabel(date), overDate: date, offGrid: false, gb: gridRef.current ? gridRef.current.getBoundingClientRect() : null };
    setDrag(true);
    requestAnimationFrame(() => paintGhost(x, y));
  };
  const tileDragMove = (x, y) => {
    if (!dragRef.current) return;
    lastXY.current.x = x; lastXY.current.y = y;
    if (rafPending.current) return;           // coalesce many touchmoves into 1 update/frame
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const d = dragRef.current; if (!d) return;
      const cx = lastXY.current.x, cy = lastXY.current.y;
      const el = document.elementFromPoint(cx, cy);
      const cellEl = el && el.closest ? el.closest('[data-cal-date]') : null;
      d.overDate = cellEl ? cellEl.getAttribute('data-cal-date') : null;
      const gb = d.gb;                          // cached at drag start (scroll is locked during drag)
      d.offGrid = gb ? (cx < gb.left - 12 || cx > gb.right + 12 || cy < gb.top - 12 || cy > gb.bottom + 12) : false;
      highlightCell(d.offGrid ? null : cellEl);
      paintGhost(cx, cy);
    });
  };
  const tileDragEnd = () => {
    const d = dragRef.current;
    dragRef.current = null;
    highlightCell(null);
    setDrag(false);
    if (!d) return;
    if (d.offGrid) { clearDayPlan(d.date); return; }
    if (!d.overDate || d.overDate === d.date) return;
    openChangeWindow(d.date, { initialTarget: d.overDate, initialScope: 'both' });   // drag → Change window at Move drill
  };

  // Click/tap a planned session chip → reopen the plan picker to edit it in place.
  const openEditPlan = (idx, session) => {
    setEditPlan({ date: selectedDate, idx, session });
    setPlanPickerOpen(true);
  };

  // (drag move/drop listeners are attached synchronously in beginSessionDrag)

  // Load races on mount and after any add/remove.
  useEffect(() => {
    getRaces().then(setRaces).catch(() => setRaces([]));
  }, [tick]);

  const activities = useMemo(() => getUnifiedActivities(), [tick]);
  const todayStr   = localDate();

  // Phase 4r.calendar.4 — daily goals + sleep + nutrition for the
  // 3-domain (Act / Fuel / Body) strip in each tile.
  const goals       = useMemo(() => getGoals(), [tick]);
  // Coach watches the calendar: read the in-view week's shape (volume, intensity,
  // rest) → a verdict (heavy / light / imbalanced / balanced) + suggestion.
  const planLoad = useMemo(() => {
    try {
      const ref = selectedDate || new Date().toISOString().slice(0, 10);
      const wk = weekKey(new Date(ref + 'T12:00:00'));
      return analyzePlannedWeek(getPlannerWeek(wk), { weeklyRunMilesGoal: goals?.weeklyRunDistanceTarget });
    } catch { return null; }
  }, [selectedDate, goals, tick]);
  const sleepRows   = useMemo(() => storage.get('sleep') || [], [tick]);
  const hrvRows     = useMemo(() => storage.get('hrv')   || [], [tick]);
  const sleepByDate = useMemo(() => {
    const m = new Map();
    for (const s of sleepRows) if (s.date) m.set(s.date, s);
    return m;
  }, [sleepRows]);
  const hrvByDate = useMemo(() => {
    const m = new Map();
    for (const h of hrvRows) if (h.date) m.set(h.date, h);
    return m;
  }, [hrvRows]);

  // Build the 6×7 grid cells (some leading/trailing days from neighbor months).
  // Phase 4r.calendar.21 — week now starts Monday. getDay() is Sun=0..Sat=6;
  // shift to Mon=0..Sun=6 so the leading-day count matches the new header order.
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = useMemo(() => {
    const out = [];
    // Leading days (from prev month)
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const day = prevMonthDays - i;
      const d = new Date(viewYear, viewMonth - 1, day);
      out.push({ date: ymd(d), inMonth: false, day });
    }
    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(viewYear, viewMonth, day);
      out.push({ date: ymd(d), inMonth: true, day });
    }
    // Trailing — pad to 42 (6 rows).
    let trailingDay = 1;
    while (out.length < 42) {
      const d = new Date(viewYear, viewMonth + 1, trailingDay);
      out.push({ date: ymd(d), inMonth: false, day: trailingDay });
      trailingDay++;
    }
    return out;
  }, [viewYear, viewMonth, startWeekday, daysInMonth]);

  const activitiesByDate = useMemo(() => indexActivitiesByDate(activities), [activities]);
  const plannerByDate    = useMemo(() => indexPlannerByDate(viewYear, viewMonth), [viewYear, viewMonth, tick]);
  // Frozen triad → date. Same deps as the planner map: applying a plan writes both the weeks
  // and the commitment, so they must be re-read together or the tiles would show one month's
  // numbers against another month's sessions.
  const { map: triadByDate, labels: rungLabels } = useMemo(() => indexTriadByDate(viewYear, viewMonth), [viewYear, viewMonth, tick]);
  // C3 — map each date the preview block will fill → its phase, for the grid overlay.
  const previewByDate = useMemo(() => {
    const m = new Map();
    if (!previewBlock || !previewBlock.weeks) return m;
    for (const w of previewBlock.weeks) {
      const monday = new Date(w.weekKey + 'T12:00:00');
      (w.days || []).forEach((d, idx) => {
        if (!d || d.type === 'rest') return;
        const dt = new Date(monday); dt.setDate(dt.getDate() + idx);
        m.set(ymd(dt), { phase: w.phase });
      });
    }
    return m;
  }, [previewBlock]);
  const racesByDate      = useMemo(() => {
    const m = new Map();
    for (const r of races) {
      if (!r.date) continue;
      if (!m.has(r.date)) m.set(r.date, []);
      m.get(r.date).push(r);
    }
    return m;
  }, [races]);

  const goPrev = () => {
    let m = viewMonth - 1, y = viewYear;
    if (m < 0) { m = 11; y--; }
    setViewMonth(m); setViewYear(y);
  };
  const goNext = () => {
    let m = viewMonth + 1, y = viewYear;
    if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };

  // Phase 4r.calendar.21 — swipe left to advance month, swipe right
  // to go back. Reuses the same useSwipeNav hook the mobile tab nav
  // uses. Phase 4r.calendar.22 — wrap goNext/goPrev in setTimeout to
  // defer state changes off the touch-event call stack so any
  // downstream render error doesn't crash the gesture.
  // Phase 4r.calendar.26 — wrap raw touch events with stopPropagation
  // so the page-level (Arnold.jsx) swipe handler doesn't ALSO fire
  // and navigate to the next tab. Without this, swiping on the
  // calendar grid jumps to Core instead of advancing the month.
  const rawSwipeHandlers = useSwipeNav({
    onSwipeLeft:  () => setTimeout(() => { try { goNext(); } catch (e) { console.warn('[calendar] swipe next failed:', e); } }, 0),
    onSwipeRight: () => setTimeout(() => { try { goPrev(); } catch (e) { console.warn('[calendar] swipe prev failed:', e); } }, 0),
  });
  const swipeHandlers = {
    onTouchStart:  (e) => { e.stopPropagation(); rawSwipeHandlers.onTouchStart(e); },
    onTouchEnd:    (e) => { e.stopPropagation(); rawSwipeHandlers.onTouchEnd(e); },
    onTouchCancel: (e) => { e.stopPropagation(); rawSwipeHandlers.onTouchCancel(e); },
  };
  const goToday = () => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(ymd(d));
  };

  // Phase 4r.calendar.26 — belt-and-suspenders today-on-mount.
  // CalendarTab unmounts when the user switches tabs (Arnold.jsx
  // uses {tab==='races'&&<CalendarTab/>}) so state resets naturally,
  // but if React ever preserves the component, this useEffect makes
  // sure landing on Calendar always shows today's data first.
  useEffect(() => {
    const d = new Date();
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(ymd(d));
    // empty dep array — runs once on mount only
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="arnold-tab-panel" style={{ padding: '8px 0' }}>
      <CalendarHeader
        monthLabel={`${MONTH_NAMES[viewMonth]} ${viewYear}`}
        onPrev={goPrev} onNext={goNext} onToday={goToday}
      />

      {/* Weekly RUN (actual) + PLANNED vs goal, labeled by week, + a projection
          (past = what you ran, future = what's planned) against the goal. */}
      {(() => {
        const weeks = [];
        for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
        const wGoal = Number(goals?.weeklyRunDistanceTarget) || null;
        const mp = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
        const runMi = d => (activitiesByDate.get(d) || []).reduce((s, a) => s + (isRun(a) && Number(a.distanceMi) > 0 ? Number(a.distanceMi) : 0), 0);
        const r1 = x => Math.round(x * 10) / 10;
        const rows = weeks.map(w => {
          const d0 = new Date(w[0].date + 'T12:00:00');
          return {
            label: `${d0.getMonth() + 1}/${d0.getDate()}`,
            actual: r1(w.reduce((s, c) => s + runMi(c.date), 0)),
            planned: r1(w.reduce((s, c) => s + (dayRunMiles(plannerByDate.get(c.date)) + (racesByDate.get(c.date) || []).reduce((rs, r) => rs + (Number(r.distanceMi) || 0), 0)), 0)),
            inMonth: w.some(c => c.date && c.date.startsWith(mp)),
            current: w.some(c => c.date === todayStr),
          };
        });
        const inMonthWeeks = rows.filter(r => r.inMonth).length;
        // Projection: past days = actual, today+future = planned.
        let proj = 0;
        for (const c of cells) {
          if (!c.date || !c.date.startsWith(mp)) continue;
          proj += c.date < todayStr ? runMi(c.date) : (dayRunMiles(plannerByDate.get(c.date)) + (racesByDate.get(c.date) || []).reduce((rs, r) => rs + (Number(r.distanceMi) || 0), 0));
        }
        proj = r1(proj);
        const target = wGoal ? wGoal * inMonthWeeks : null;
        const pct = target ? Math.round((proj / target) * 100) : null;
        return (
          <div style={{ margin: '4px 2px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 4, marginBottom: 5 }}>
              {rows.filter(r => r.inMonth).map((r, i) => {
                const hit = wGoal ? (r.actual + r.planned) >= wGoal * 0.9 : null;
                return (
                  <div key={i} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '3px 2px', borderRadius: r.current ? 999 : 5, background: r.current ? 'rgba(94,234,212,0.07)' : 'rgba(255,255,255,0.03)', border: r.current ? '1px solid rgba(94,234,212,0.45)' : '0.5px solid var(--border-subtle)', opacity: r.inMonth ? 1 : 0.45 }}>
                    <span style={{ fontSize: 8, color: r.current ? '#5eead4' : 'var(--text-faint)' }}>{r.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color: hit == null ? 'var(--text-secondary)' : hit ? '#5eead4' : '#60a5fa', lineHeight: 1 }}>{r.actual}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{r.planned}</span></span>
                  </div>
                );
              })}
            </div>
            {target != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Projected</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{proj}<span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/{target} mi</span></span>
                <div style={{ flex: 1, maxWidth: 130, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(pct || 0, 100)}%`, height: '100%', background: pct >= 90 ? '#5eead4' : pct >= 70 ? '#60a5fa' : 'var(--text-muted)', opacity: 0.7 }} />
                </div>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{pct}%</span>
                {wGoal && isMobile ? <span style={{ fontSize: 9, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>goal {wGoal}/wk</span> : null}
              </div>
            )}
          </div>
        );
      })()}

      {/* Coach — SEASON trajectory (across weeks + toward races) + this week's shape. */}
      {planLoad && (() => {
        const season = (() => {
          try {
            const weeks = [];
            for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
            const runMi = d => (activitiesByDate.get(d) || []).reduce((s, a) => s + (isRun(a) && Number(a.distanceMi) > 0 ? Number(a.distanceMi) : 0), 0);
            const sw = weeks.map(w => ({ start: w[0].date, end: w[w.length - 1].date, actual: w.reduce((s, c) => s + runMi(c.date), 0), planned: w.reduce((s, c) => s + (dayRunMiles(plannerByDate.get(c.date)) + (racesByDate.get(c.date) || []).reduce((rs, r) => rs + (Number(r.distanceMi) || 0), 0)), 0) }));
            return analyzeSeason(sw, { weeklyRunMilesGoal: goals?.weeklyRunDistanceTarget, today: todayStr, races });
          } catch { return null; }
        })();
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '0 0 6px', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '0.5px solid var(--border-subtle)' }}>
            <CoachSigil size={16} style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#5eead4' }}>
                  Coach{season ? (season.mode === 'taper' ? ' · race week' : season.behind ? ' · behind plan' : ' · on track') : ''}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  wk {planLoad.runMiles}{planLoad.milesGoal ? `/${planLoad.milesGoal}` : ''} mi · {planLoad.verdict}
                </span>
              </div>
              {season && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 3 }}>{season.message}</div>}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>This week: {planLoad.message}</div>
            </div>
          </div>
        );
      })()}

      {/* Phase 4r.calendar.13 — responsive 2-column layout on wide
          screens (grid left, day drawer right). Phase 4r.calendar.14
          — when the drawer is collapsed (toggled off via re-click or
          the X button), the calendar grid expands to fill the full
          width. Phase 4r.calendar.20 — on mobile (≤600px) the grid
          always renders full-width and the drawer becomes a
          slide-up bottom sheet overlay rendered below. */}
      <div
        {...(isMobile && !drag ? swipeHandlers : {})}
        style={{
        display: (isWide && drawerOpen) ? 'grid' : 'flex',
        gridTemplateColumns: (isWide && drawerOpen) ? 'minmax(0, 1fr) 340px' : undefined,
        flexDirection: (isWide && drawerOpen) ? undefined : 'column-reverse',
        gap: 12,
        alignItems: 'flex-start',
        // touchAction pan-y lets vertical scroll work normally while
        // horizontal swipes get captured by the useSwipeNav handlers.
        touchAction: isMobile ? 'pan-y' : undefined,
      }}>
        <div ref={gridRef} style={{ width: '100%', minWidth: 0 }}>
          <MonthGrid todayCellRef={todayCellRef}
            cells={cells}
            todayStr={todayStr}
            selectedDate={selectedDate}
            activitiesByDate={activitiesByDate}
            plannerByDate={plannerByDate}
            triadByDate={triadByDate}
            rungLabels={rungLabels}
            racesByDate={racesByDate}
            sleepByDate={sleepByDate}
            hrvByDate={hrvByDate}
            goals={goals}
            isMobile={isMobile}
            onTileDragStart={tileDragStart}
            onTileDragMove={tileDragMove}
            onTileDragEnd={tileDragEnd}
            onPickDate={handlePickDate}
            onTileDrop={handleTileDrop}
            previewByDate={previewByDate}
          />
        </div>
        {/* Desktop / tablet inline drawer — mobile renders an inline
            panel BELOW this wrapper so the grid stays visible on top.
            Phase 4r.calendar.25 — mobile drawer is now always-open
            and lives below the grid (not a modal sheet). */}
        {drawerOpen && !isMobile && (
          <div style={{
            position: isWide ? 'sticky' : 'static',
            top: isWide ? 8 : undefined,
            width: '100%',
          }}>
            <DayDrawer
              isMobile={isMobile}
              dateStr={selectedDate}
              activities={activitiesByDate.get(selectedDate) || []}
              planned={plannerByDate.get(selectedDate) || null}
              races={racesByDate.get(selectedDate) || []}
              onClose={() => setDrawerOpen(false)}
              onEditSession={openEditPlan}
              onAddRace={() => setPickerOpen(true)}
              onAddPlan={() => { setEditPlan(null); setPlanPickerOpen(true); }} onPlanChange={() => setTick(t => t + 1)}
              onManualAdd={() => setManualOpen(true)}
              onBuildPlanToRace={(date) => setGenRaceReq({ date, n: Date.now() })}
              onIcsImport={() => setIcsOpen(true)}
              onSwapDay={beginSwapPick}
              onMoveSession={beginSessionPick}
              onDeleteRace={(id, date) => {
                const race = races.find(r => r.id === id);
                deleteRaceEverywhere(id, date || race?.date).then((next) => { setRaces(next); setTick(t => t + 1); showToast?.('Race removed'); });
              }}
            />
          </div>
        )}
      </div>

      {/* Phase 4r.calendar.25 — mobile drawer is always-open and
          inline below the grid. No modal, no backdrop, no animation.
          Tapping a different day just updates drawer content.
          Default selection is today (set in CalendarTab init).
          Phase 4r.calendar.36 — explicit 10px marginTop between grid
          and drawer so the +Plan / +Add race chips' hit areas can't
          physically reach the grid's bottom-row tiles. Was 0 before;
          combined with the old -8px hit-area extension on the chips,
          taps on May 30/31 were landing on +Add race instead. */}
      {isMobile && (
        <div style={{ marginTop: 10 }}>
          <DayDrawer
            isMobile={isMobile}
            dateStr={selectedDate}
            activities={activitiesByDate.get(selectedDate) || []}
            planned={plannerByDate.get(selectedDate) || null}
            races={racesByDate.get(selectedDate) || []}
            onEditSession={openEditPlan}
            onAddRace={() => setPickerOpen(true)}
            onAddPlan={() => { setEditPlan(null); setPlanPickerOpen(true); }} onPlanChange={() => setTick(t => t + 1)}
            onManualAdd={() => setManualOpen(true)}
            onIcsImport={() => setIcsOpen(true)}
            onSwapDay={beginSwapPick}
            onMoveSession={beginSessionPick}
            onDeleteRace={(id, date) => {
              const race = races.find(r => r.id === id);
              deleteRaceEverywhere(id, date || race?.date).then((next) => { setRaces(next); setTick(t => t + 1); showToast?.('Race removed'); });
            }}
          />
        </div>
      )}

      {/* The LIVING plan (3.2c) — the EXECUTION half (sessions + arc + apply);
          the verdict/feasibility glance lives on Start's Marathon Coach, so this
          no longer repeats it (de-dupe 2026-07). Sits directly below the day
          drawer with no dead gap; the bottom-nav clearance now trails the plan.
          (Web → Plan tab relocation still pending — task #32.) */}
      <div style={{ marginTop: isMobile ? 10 : 0, paddingBottom: isMobile ? 112 : 0 }}>
        <LivingPlan isMobile={isMobile} onApplied={() => setTick(t => t + 1)} showToast={showToast} openRaceReq={genRaceReq} onPreview={setPreviewBlock} onChangeSession={openChangeWindow} />
      </div>

      {drag && createPortal((
        <div ref={ghostRef} style={{
          position: 'fixed', zIndex: 9999,
          transform: 'translate(-50%, -150%)', pointerEvents: 'none',
          padding: '5px 10px', borderRadius: 8, whiteSpace: 'nowrap',
          fontSize: 12, fontWeight: 600,
          color: 'var(--text-primary)', background: 'var(--bg-surface)',
          border: '1px solid #5eead4', boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        }} />
      ), document.body)}

      {changeCtx && (
        <ChangeSessionWindow
          date={changeCtx.date} dayLabel={changeCtx.dayLabel} sessions={changeCtx.sessions}
          normWeek={changeCtx.normWeek} fromIdx={changeCtx.fromIdx} targetDays={changeCtx.targetDays}
          modalities={changeCtx.modalities} injuryArea={changeCtx.injuryArea}
          weekOpenDays={changeCtx.weekOpenDays} openDayLabels={changeCtx.openDayLabels}
          initialTarget={changeCtx.initialTarget} initialScope={changeCtx.initialScope}
          onCommitMove={commitChangeMove} onCommitSubstitute={commitChangeSubstitute} onCommitSkip={commitChangeSkip}
          onClose={() => setChangeCtx(null)}
        />
      )}

      {planPickerOpen && (
        <PlanPickerModal
          dateStr={editPlan ? editPlan.date : selectedDate}
          editing={!!editPlan}
          initialType={editPlan ? editPlan.session.type : null}
          initialDist={editPlan && Number(editPlan.session.distanceMi) > 0 ? editPlan.session.distanceMi : ''}
          onClose={() => { setPlanPickerOpen(false); setEditPlan(null); }}
          onPick={(type, distanceMi, slot) => {
            const wasEdit = !!editPlan;
            try {
              const targetDate = editPlan ? editPlan.date : selectedDate;
              const wk = weekKey(new Date(targetDate + 'T12:00:00'));
              const week = getPlannerWeek(wk);
              const monday = new Date(wk + 'T12:00:00');
              const idx = Math.floor(
                (new Date(targetDate + 'T12:00:00') - monday) / 86400000
              );
              if (idx >= 0 && idx < 7) {
                const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
                while (days.length < 7) days.push({ type: 'rest' });
                if (editPlan) {
                  // EDIT the existing session in place (replace type/distance).
                  const sessions = daySessions(days[idx]);
                  if (sessions[editPlan.idx]) {
                    const updated = { ...sessions[editPlan.idx], type };
                    if (Number(distanceMi) > 0) updated.distanceMi = Number(distanceMi);
                    else delete updated.distanceMi;
                    sessions[editPlan.idx] = updated;
                    days[idx] = makeDay(sessions);
                  }
                } else if (type === 'rest') {
                  // Rest = clear the day's sessions.
                  days[idx] = makeDay([]);
                } else {
                  // APPEND a session (multi-session days — hybrid). Optional
                  // AM/PM/EVE slot + planned distance.
                  const session = { type };
                  if (Number(distanceMi) > 0) session.distanceMi = Number(distanceMi);
                  if (slot) session.slot = slot;
                  days[idx] = makeDay([...daySessions(days[idx]), session]);
                }
                savePlannerWeek(wk, { ...week, days });
              }
            } catch (e) { console.warn('[calendar] plan save failed:', e); }
            setPlanPickerOpen(false);
            setEditPlan(null);
            setTick(t => t + 1);
            showToast?.(wasEdit
              ? `Updated ${prettyFamily(type)}${Number(distanceMi) > 0 ? ` · ${distanceMi} mi` : ''}`
              : (type === 'rest' ? 'Set to rest' : `Added ${prettyFamily(type)}${slot ? ` · ${slot}` : ''}${Number(distanceMi) > 0 ? ` · ${distanceMi} mi` : ''}`));
          }}
        />
      )}

      {pickerOpen && (
        <RacePickerModal
          dateStr={selectedDate}
          onClose={() => setPickerOpen(false)}
          onPick={(race) => {
            const newEntry = {
              id: `r-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
              name: race.name,
              date: selectedDate,
              distanceMi: race.distanceMi,
              city: race.city,
              country: race.country,
              url: race.url,
              source: 'catalog',
            };
            const next = [...races, newEntry];
            saveRaces(next).then(() => {
              setRaces(next);
              setPickerOpen(false);
              // Also flip the planner day to type='race' — fixes the
              // mismatch Phase 4r.race.14 had to work around.
              try {
                const wk = weekKey(new Date(selectedDate + 'T12:00:00'));
                const week = getPlannerWeek(wk);
                const monday = new Date(wk + 'T12:00:00');
                const idx = Math.floor(
                  (new Date(selectedDate + 'T12:00:00') - monday) / 86400000
                );
                if (idx >= 0 && idx < 7) {
                  const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
                  while (days.length < 7) days.push({ type: 'rest' });
                  days[idx] = { ...(days[idx] || {}), type: 'race', notes: race.name };
                  savePlannerWeek(wk, { ...week, days });
                }
              } catch (e) { console.warn('[calendar] planner sync failed:', e); }
              setTick(t => t + 1);
              showToast?.(`Added ${race.name}`);
            });
          }}
        />
      )}

      {manualOpen && (
        <ManualRaceModal
          dateStr={selectedDate}
          onClose={() => setManualOpen(false)}
          onAdd={(entry) => {
            const newEntry = {
              id: `r-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
              ...entry,
              source: 'manual',
            };
            const next = [...races, newEntry];
            saveRaces(next).then(() => {
              setRaces(next);
              setManualOpen(false);
              setTick(t => t + 1);
              showToast?.(`Added ${entry.name}`);
            });
          }}
        />
      )}

      {icsOpen && (
        <IcsImportModal
          existingRaces={races}
          onClose={() => setIcsOpen(false)}
          onImported={(merged) => {
            saveRaces(merged).then(() => {
              setRaces(merged);
              setIcsOpen(false);
              setTick(t => t + 1);
              showToast?.(`Synced ${merged.length} races`);
            });
          }}
        />
      )}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function CalendarHeader({ monthLabel, onPrev, onNext, onToday }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '0 4px 8px',
    }}>
      {/* Phase 4r.calendar.26 — arrows grouped tightly around the
          month label on the left; Today chip on the far right.
          Previously a flex:1 spacer pushed the right arrow off into
          empty space. */}
      <button onClick={onPrev} style={iconBtn} className="arnold-compact-btn" title="Previous month">‹</button>
      <span style={{
        fontSize: 16, fontWeight: 500, color: 'var(--text-primary)',
        minWidth: 0,
      }}>{monthLabel}</span>
      <button onClick={onNext} style={iconBtn} className="arnold-compact-btn" title="Next month">›</button>
      <span style={{ flex: 1 }}/>
      <button onClick={onToday} style={chipBtn} className="arnold-compact-btn">Today</button>
    </div>
  );
}

// ── Month grid ──────────────────────────────────────────────────────────────

function MonthGrid({ cells, todayStr, selectedDate, activitiesByDate, plannerByDate, triadByDate, rungLabels, racesByDate, sleepByDate, hrvByDate, goals, isMobile, dragOverDate, onTileDragStart, onTileDragMove, onTileDragEnd, onPickDate, onTileDrop, todayCellRef, previewByDate }) {
  const TileComponent = isMobile ? MobileDayTile : DayTile;
  // Web drag-and-drop (desktop). Mobile keeps its touch long-press path; on the web the tiles
  // weren't draggable at all, so a session couldn't be moved. Native HTML5 DnD on the cell
  // wrapper: pick up a day that has a plan, drop it on another day → the shared what-if + modal.
  const [webDragOver, setWebDragOver] = useState(null);
  // Mobile: trim trailing all-next-month weeks so a month that fits in 5 rows
  // doesn't render a bare 6th row of next-month days above the drawer (Emil).
  const shownCells = (() => {
    if (!isMobile) return cells;
    let lastIn = 0;
    cells.forEach((c, i) => { if (c.inMonth) lastIn = i; });
    const weeksNeeded = Math.ceil((lastIn + 1) / 7);
    return cells.slice(0, weeksNeeded * 7);
  })();
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      padding: isMobile ? 4 : 6,
      // Phase 4r.calendar.26 — tighter bottom margin on mobile so
      // the always-open drawer sits flush against the grid instead
      // of separated by ~16px of empty space.
      marginBottom: isMobile ? 2 : 12,
    }}>
      {/* Phase 4r.calendar.22 — flexbox + fixed-width cells. Grid
          (even with minmax(0, 1fr) + !important) was collapsing to
          4 cols on the user's Samsung device, presumably because
          some upstream rule was injecting min-width. Switching to
          flex-wrap with calc((100% - 12px) / 7) is mathematically
          guaranteed: 6 gaps × 2px = 12px, divided by 7 children. */}
      <div className="arnold-cal-weekrow" style={{
        display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 4, width: '100%',
      }}>
        {WEEKDAY_SHORT.map(w => (
          <div key={w} style={{
            flex: '0 0 calc((100% - 12px) / 7)',
            fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
            color: 'var(--text-muted)', textAlign: 'center', padding: '2px 0',
            minWidth: 0, overflow: 'hidden',
            boxSizing: 'border-box',
          }}>{w.toUpperCase()}</div>
        ))}
      </div>

      {/* 6×7 grid via flexbox — uses MobileDayTile on small screens, DayTile otherwise. */}
      <div className="arnold-cal-grid" style={{
        display: 'flex', flexWrap: 'wrap', gap: 2, width: '100%',
      }}>
        {shownCells.map(cell => {
          const pv = previewByDate && previewByDate.get(cell.date);
          const pvColor = pv ? (PHASE_OVERLAY[pv.phase] || '#5eead4') : null;
          // Web DnD: a cell is a drag SOURCE if it has a (non-race) plan and isn't in the past.
          const cellHasPlan = daySessions(plannerByDate.get(cell.date)).some(x => x.type && x.type !== 'rest' && x.type !== 'race');
          const cellRace = (racesByDate.get(cell.date) || []).length > 0;
          const webDraggable = !isMobile && cellHasPlan && !cellRace && cell.date >= todayStr;
          return (
          <div key={cell.date}
            data-cal-date={cell.date}
            ref={cell.date === todayStr ? todayCellRef : null}
            draggable={webDraggable || undefined}
            onDragStart={webDraggable ? (e) => { try { e.dataTransfer.setData('text/plain', cell.date); e.dataTransfer.effectAllowed = 'move'; } catch {} } : undefined}
            onDragOver={!isMobile ? (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = 'move'; } catch {}; if (webDragOver !== cell.date) setWebDragOver(cell.date); } : undefined}
            onDragLeave={!isMobile ? () => setWebDragOver(o => (o === cell.date ? null : o)) : undefined}
            onDrop={!isMobile ? (e) => { e.preventDefault(); setWebDragOver(null); let from = ''; try { from = e.dataTransfer.getData('text/plain'); } catch {}; if (from && from !== cell.date) onTileDrop?.(from, cell.date); } : undefined}
            style={{
              flex: '0 0 calc((100% - 12px) / 7)',
              minWidth: 0,
              boxSizing: 'border-box',
              borderRadius: 6,
              cursor: webDraggable ? 'grab' : undefined,
              outline: (cell.date === dragOverDate || cell.date === webDragOver) ? '2px solid #5eead4' : 'none',
              outlineOffset: -1,
              // C3 — plan-generator preview: ring the days the block will fill, colored by phase.
              boxShadow: pvColor ? `inset 0 0 0 1.5px ${pvColor}` : undefined,
            }}>
            <TileComponent cell={cell}
              isToday={cell.date === todayStr}
              isSelected={cell.date === selectedDate}
              completed={activitiesByDate.get(cell.date) || []}
              planned={plannerByDate.get(cell.date)}
              triad={(triadByDate && triadByDate.get(cell.date)) || null}
              rungLabels={rungLabels || {}}
              races={racesByDate.get(cell.date) || []}
              sleep={sleepByDate.get(cell.date)}
              hrv={hrvByDate.get(cell.date)}
              goals={goals}
              isPast={cell.date < todayStr}
              onTileDragStart={onTileDragStart}
              onTileDragMove={onTileDragMove}
              onTileDragEnd={onTileDragEnd}
              onPick={() => onPickDate(cell.date)}
            />
          </div>
          );
        })}
      </div>
    </div>
  );
}

// Short labels per family — shown inside tile rows so each activity is
// instantly identifiable.
const FAMILY_SHORT = {
  run: 'Run', long_run: 'Long', tempo: 'Tempo', intervals: 'Int',
  hiit: 'HIIT', strength: 'Lift', mobility: 'Mob',
  cross: 'Cross', race: 'Race', rest: 'Rest',
  cycle: 'Bike', swim: 'Swim', ski: 'Ski', walk: 'Walk',
};

// Full-word tile labels for the WEB day-tile top tag — there's room across the wide
// tile, so spell the workout out ("Mobility", "Lift") instead of abbreviating ("MOB",
// "LIF"). Two-a-days read as a compound with the PRIMARY workout first
// (e.g. "Run + Lift", "Mobility + Run"). Strength stays "Lift" (Emil's preference over
// "Strength"). Mobile keeps the short codes + per-session glyphs (see MobileDayTile).
const FAMILY_LABEL_FULL = {
  run: 'Run', long_run: 'Long', tempo: 'Tempo', intervals: 'Intervals',
  hiit: 'HIIT', strength: 'Lift', mobility: 'Mobility',
  cross: 'Cross', race: 'Race', rest: 'Rest',
  cycle: 'Bike', swim: 'Swim', ski: 'Ski', walk: 'Walk',
};
// Compound label from an ordered (primary-first) list of family keys — deduped,
// joined with " + ". Used for the web day-tile headline on two-a-day days.
function familiesLabel(families, map) {
  const seen = new Set();
  const parts = [];
  for (const f of (families || [])) {
    const key = f || 'rest';
    if (key === 'rest' || seen.has(key)) continue;
    seen.add(key);
    parts.push(map[key] || prettyFamily(key));
  }
  return parts.join(' + ');
}

// Phase 0.3 — signature map/version moved to the single source
// `core/activitySignatures.js`. Local wrapper preserves the prior behavior of
// always returning *some* figure (unknown/rest families fell back to easy-run).
function sigSrc(family) {
  return sigSrcOf(family) || sigSrcOf('easy_run');
}

// Phase 4r.calendar.18 — per-family visual scale boost so mobility and
// race figures (which sit smaller inside their PNG canvases due to the
// figure pose, not framing) appear the same on-screen size as the
// upright running figures. Applied as a CSS transform on the <img>.
const SIG_SCALE = {
  // Retuned 2026-06-17 (Emil): the wide-pose figures (mobility warrior, cyclist,
  // lifter) read LARGER than the upright runners, not smaller — so the run family
  // is the baseline (1.0) and the wide ones scale DOWN. First pass; fine-tune by eye.
  mobility: 0.95,
  cycle:    0.82,
  strength: 0.85,
  race:     1.05,
  hiit:     1.05,
  // run / easy_run / long_run / tempo / intervals / swim / ski / walk = 1.0 baseline
};

// Phase 4r.calendar.18 — pretty label for any activity / planner type.
// Replaces lowercase enum values ("mobility", "easy_run") with the
// title-cased display form ("Mobility", "Easy Run") used everywhere
// else in Arnold. Used by the day drawer header + tile fallbacks.
const FAMILY_PRETTY = {
  run: 'Run', easy_run: 'Easy Run', long_run: 'Long Run',
  tempo: 'Tempo', intervals: 'Intervals', speed_run: 'Speed',
  ski: 'Ski', hiit: 'HIIT', strength: 'Strength',
  mobility: 'Mobility', cross: 'Cross-Training', race: 'Race', rest: 'Rest',
};
// Only run-family sessions carry mileage; cross-train (bike/pool/…) is time-based, so
// any leftover distanceMi on a non-run type is stale and must not render as "N mi" (Emil).
// ROUND 98 — this list was the most complete of the six copies in the tree, so it became
// the shared one rather than being replaced by a narrower one. Same members, one home.
const MILEAGE_TYPES = SESSION_RUN_TYPES;

function prettyFamily(type) {
  if (!type) return '';
  if (FAMILY_PRETTY[type]) return FAMILY_PRETTY[type];
  // Generic fallback — replace _ with space, capitalize each word.
  return String(type).split(/[_\s]+/)
    .map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : '')
    .join(' ');
}

// Phase 4r.calendar.19 — mobility-done indicator now uses the same
// Phosphor duotone glyph (PersonSimpleTaiChi) that the Start-screen
// workout tile uses (PlannedWorkoutTile.jsx FamilyMobility). Higher
// fidelity than the hand-rolled stick figure and matches the rest of
// Arnold's iconography exactly.
function MobilityDoneIcon({ size = 14, color = '#5eead4' }) {
  return <PersonSimpleTaiChi size={size} color={color} weight="duotone" />;
}

// Compact per-activity metric label. Distance wins for run-family;
// otherwise duration in minutes.
function activityMetric(a) {
  const mi   = Number(a.distanceMi)   || 0;
  const secs = Number(a.durationSecs) || 0;
  if (mi >= 0.5)    return `${mi.toFixed(1)}mi`;
  if (secs >= 60)   return `${Math.round(secs / 60)}m`;
  return '';
}

// Quick load estimate per activity for the bottom-strip TSS sum.
// Uses stored TSS when present; otherwise computes a coarse hrTSS with
// a default 165 threshold (good enough for tile coloring, not gospel).
function estActivityLoad(a) {
  const stored = Number(a.trainingStressScore || a.rTSS || a.hrTSS) || 0;
  if (stored > 0) return Math.round(stored);
  const avgHR = Number(a.avgHR || a.avgHeartRate) || 0;
  const dur   = Number(a.durationSecs) || 0;
  if (!avgHR || !dur) return 0;
  const IF = avgHR / 165;
  return Math.round((dur / 3600) * IF * IF * 100);
}

// ── Tile figure sizing (shared web + mobile) ─────────────────────────────────
// A workout is MAJOR (>=30 min → big center figure, up to 2 side-by-side) or
// MINOR (<30 min → small rim figure). Hoisted to module scope so the web
// DayTile and MobileDayTile build the SAME double-figure view (Emil — the two
// surfaces used to disagree: mobile showed two figures on a double day, web
// showed one figure + a text tick).
const TILE_TYPE_MIN = { mobility: 15, strength: 45, hiit: 30, cycle: 45, swim: 40, ski: 60, walk: 40, cross: 40, easy_run: 40, long_run: 90, tempo: 45, intervals: 45, run: 40, recovery_run: 30, race: 120 };
const estPlanMinutes = (ses) => {
  if (Number(ses.durationMin) > 0) return Number(ses.durationMin);
  try { const m = plannedMinutes({ planned: ses, profile: storage.get('profile') || {} }); if (m) return m; } catch {}
  return TILE_TYPE_MIN[ses.type] || 30;
};
const actMinutes = (a) => {
  const secs = Number(a.durationSecs) || 0;
  if (secs > 0) return secs / 60;
  return TILE_TYPE_MIN[activityFamily(a)] || 30;
};
// Build the ordered {family,min} list of a day's figures (race → completed →
// planned), then split into center "majors" (up to 2) and rim "minors".
function tileFigures({ hasRace, hasCompleted, isPlannedOnly, races, completed, plannedRanked }) {
  const out = [];
  if (hasRace) {
    races.forEach(() => out.push({ family: 'race', min: TILE_TYPE_MIN.race }));
    // On a race day the dominant logged activity IS the race — skip it once so
    // the tile doesn't show the race AND the race-run as two figures.
    const domFam = dominantActivityFamily(completed);
    let domSkipped = false;
    completed.forEach(a => {
      const af = activityFamily(a);
      if (!domSkipped && af === domFam) { domSkipped = true; return; }
      out.push({ family: af, min: actMinutes(a) });
    });
  } else if (hasCompleted) {
    completed.forEach(a => out.push({ family: activityFamily(a), min: actMinutes(a) }));
  } else if (isPlannedOnly) {
    plannedRanked.forEach(ses => out.push({ family: ses.type, min: estPlanMinutes(ses) }));
  }
  const bigItems = out.filter(it => it.min >= 30);
  const smallItems = out.filter(it => it.min < 30);
  // Dominant workout always gets a big center figure; a day whose only work is
  // short (e.g. a mobility day) still shows big-centered, not a tiny rim png.
  const majors = bigItems.length ? bigItems.slice(0, 2) : smallItems.slice(0, 1);
  const minors = bigItems.length ? [...bigItems.slice(2), ...smallItems] : smallItems.slice(1);
  return { majors, minors };
}

// Phase 4r.calendar.3 — richer tile design. Each day shows up to three
// activity rows (family-colored stripe + short label + metric) so the
// month grid reads as the user's training journey rather than a sparse
// scatter of single numbers.
// Phase 4r.calendar.4 — bottom strip now carries the three-domain
// summary (Activity / Fuel / Body) that Arnold tracks throughout the
// app, mirroring the daily score's composition on every calendar cell.
function DayTile({ cell, isToday, isSelected, completed, planned, triad, rungLabels, races, sleep, hrv, goals, onPick }) {
  const hasRace = races.length > 0;
  const hasCompleted = completed.length > 0;
  const isPlannedOnly = !hasRace && !hasCompleted && planned && planned.type && planned.type !== 'rest';

  // Planned sessions ranked by the SAME training-priority as completed days (race > hiit
  // > long_run > ... > strength > mobility), so a Strength+Run day leads with the RUN
  // figure, not whichever session was added first. Primary = image + headline; the rest
  // go on the secondary rail. planFamily maps a plan type to its priority/style key
  // (easy_run → run), preferring an exact FAMILY_STYLE key so long_run/tempo keep theirs.
  const planFamily = (t) => (FAMILY_STYLE[t] ? t : (PLAN_TYPE_FAMILY[t] || 'cross'));
  const plannedRanked = isPlannedOnly
    ? daySessions(planned)
        .filter(s => s && s.type && s.type !== 'rest')
        .sort((a, b) => (FAMILY_PRIORITY[planFamily(b.type)] || 0) - (FAMILY_PRIORITY[planFamily(a.type)] || 0))
    : [];
  const plannedPrimary = plannedRanked[0] || null;

  // Dominant family for tile coloring (race > completed > planned > rest).
  // Phase 4r.calendar.fix.8 — pick by training-priority not log order so
  // morning mobility doesn't claim the tile when the day also had a HIIT.
  let family = 'rest';
  if (hasRace) family = 'race';
  else if (hasCompleted) family = dominantActivityFamily(completed);
  else if (isPlannedOnly) family = plannedPrimary ? planFamily(plannedPrimary.type) : (planned.type || 'rest');
  const style = FAMILY_STYLE[family] || FAMILY_STYLE.rest;

  // Day totals for the activity strip cell.
  const totalMi   = completed.reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
  const totalSecs = completed.reduce((s, a) => s + (Number(a.durationSecs) || 0), 0);
  const totalLoad = completed.reduce((s, a) => s + estActivityLoad(a), 0);

  // Run miles — planned vs actually run, shown on running-day tiles (Emil).
  const plannedRunMi = (() => { try { return dayRunMiles(planned) + (races || []).reduce((s, r) => s + (Number(r.distanceMi) || 0), 0); } catch { return 0; } })();
  const actualRunMi = completed.reduce((s, a) => s + (isRun(a) && Number(a.distanceMi) > 0 ? Number(a.distanceMi) : 0), 0);
  const isRunningDay = plannedRunMi > 0 || actualRunMi > 0;

  // Every session type the day is planned for — the type gate the triad row checks itself
  // against, so a swapped Tuesday never wears Thursday's three numbers.
  const plannedTypes = (() => { try { return daySessions(planned).map(s => s.type); } catch { return []; } })();
  // A race is a fixed distance, so it is never tierable and packTriad already dropped it;
  // this is belt-and-braces so a race day can't inherit a neighbouring day's row.
  const showTriad = !!triad && !hasRace;


  // Fuel — pull daily nutrition totals + compare to calorie target.
  // Show calorie target hit %; null when nothing was logged.
  const nut = (() => {
    try { return nutDailyTotals(cell.date); } catch { return null; }
  })();
  // Phase 4r.dataspine.4 — legacy resolveCalorieTarget fallback removed.
  // getEffectiveTargets has been the only source of truth in practice for
  // weeks; the fallback never fired and is being deleted alongside the
  // legacy exports.
  const calTarget = (() => {
    try { return getEffectiveTargets({ date: cell.date }).dailyCalories.effective; }
    catch { return null; }
  })();
  const calLogged = nut?.calories || 0;
  const fuelPct = calLogged > 0 ? Math.min(Math.round((calLogged / calTarget) * 100), 200) : null;

  // Body / Recovery — sleep score (or hrs as fallback). Single 0-100
  // value summarizing the night that preceded this day.
  // Phase 4r.calendar.32 — accept both totalSleepMinutes (live Garmin
  // worker field) and durationMinutes (legacy HC sync field).
  const sleepScore = sleep?.sleepScore != null ? Math.round(sleep.sleepScore) : null;
  const _sleepMins = sleep?.totalSleepMinutes ?? sleep?.durationMinutes ?? null;
  const sleepHrs   = _sleepMins != null ? (_sleepMins / 60).toFixed(1) : null;
  const bodyVal = sleepScore != null ? sleepScore : null;

  // Phase 4r.calendar.34 — Today highlight on web matches mobile:
  // blue tinted bg + blue border + filled day-pill. Subtler scale (0.14 vs
  // 0.18 alpha) than mobile so the larger desktop tile doesn't shout.
  const tileBg = isToday ? 'rgba(55,138,221,0.14)'
               : (hasCompleted || hasRace) ? style.bg
               : 'transparent';
  const tileBorder = isToday ? '#378ADD'
                   : isSelected ? 'var(--accent-border)'
                   : (hasCompleted || hasRace || isPlannedOnly) ? style.border
                   : 'var(--border-subtle)';
  const borderStyle = isPlannedOnly && !hasCompleted && !hasRace ? 'dashed' : 'solid';
  const borderWidth = isToday ? '1.5px' : isSelected ? '1.5px' : '0.5px';

  // Phase 4r.calendar.5 — central session-signature image(s). Uses the
  // existing PNG signatures from /public/session-signatures/. Emil: match
  // the mobile tile — a two-a-day shows BOTH figures side-by-side in the
  // center (up to 2 majors), with short add-ons on the rim.
  const { majors, minors } = tileFigures({ hasRace, hasCompleted, isPlannedOnly, races, completed, plannedRanked });
  const hasFigures = majors.length > 0 || minors.length > 0;

  // Phase 4r.calendar.8 — single source of truth for family label so
  // the top-right tag matches whether the day is completed, planned, or
  // a race. Always uses the FAMILY_SHORT short form (RUN, LIFT, MOB,
  // HIIT, RACE) rather than mixing "MOB" with "MOBILITY".
  let headline = null;
  if (hasRace) {
    headline = (races[0].name || 'Race');
  } else if (hasCompleted) {
    // Compound, primary-first: a run+strength day reads "Run + Lift".
    headline = familiesLabel([family, ...secondaryActivities(completed, 3).map(activityFamily)], FAMILY_LABEL_FULL);
  } else if (isPlannedOnly) {
    // Full workout names across the wide web tile; two-a-days show BOTH, primary first
    // (plannedRanked is already priority-sorted → "Run + Lift", "Mobility + Run").
    headline = familiesLabel(plannedRanked.map(s => planFamily(s.type)), FAMILY_LABEL_FULL);
  }

  // Headline metric — single number for the day's primary line.
  const headlineMetric = hasCompleted
    ? (totalMi >= 0.5 ? `${totalMi.toFixed(1)}mi` : `${Math.round(totalSecs / 60)}m`)
    : null;

  // Phase 4r.calendar.6 — F1 cockpit layout. Image fills the left
  // panel; vitals stack down the right side as a status readout. Each
  // vital is one row (LABEL | VALUE) in mono font, color-coded by
  // status. Reads like an instrument cluster instead of a centered
  // single-image card.
  const fuelColor = fuelPct == null ? null
                  : fuelPct >= 90 && fuelPct <= 110 ? '#4ade80'
                  : fuelPct >= 70 && fuelPct <= 130 ? '#fbbf24'
                  : '#f87171';
  const bodyColor = bodyVal == null ? null
                  : bodyVal >= 80 ? '#4ade80'
                  : bodyVal >= 60 ? '#fbbf24'
                  : '#f87171';

  return (
    <button onClick={onPick}
      style={{
        all: 'unset', cursor: 'pointer',
        aspectRatio: '1',
        padding: '4px 5px',
        position: 'relative',
        borderRadius: 5,
        border: `${borderWidth} ${borderStyle} ${tileBorder}`,
        boxShadow: isToday ? '0 0 0 1px rgba(55,138,221,0.30) inset' : 'none',
        background: cell.inMonth ? tileBg : 'transparent',
        opacity: cell.inMonth ? 1 : 0.30,
        display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box',
        minHeight: 0,
        overflow: 'hidden',
        gap: 2,
      }}>

      {/* Header strip: day number + RACE badge or family label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', lineHeight: 1, flexShrink: 0, gap: 4 }}>
        <span style={{
          fontSize: isToday ? 13 : 12,
          fontWeight: isToday ? 700 : 600,
          color: isToday ? '#fff' : (cell.inMonth ? 'var(--text-primary)' : 'var(--text-muted)'),
          background: isToday ? '#378ADD' : 'transparent',
          padding: isToday ? '1px 6px' : 0,
          borderRadius: isToday ? 8 : 0,
          minWidth: isToday ? 16 : 'auto',
          textAlign: 'center',
          lineHeight: 1,
        }}>{cell.day}</span>
        {hasRace ? (
          <span style={{
            fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
            color: '#ef4444',
            background: 'rgba(239,68,68,0.15)',
            border: '0.5px solid rgba(239,68,68,0.40)',
            padding: '1px 5px', borderRadius: 6, lineHeight: 1,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '70%',
          }}>★ {(races[0].name || 'RACE').split(' ').slice(0, 2).join(' ')}</span>
        ) : headline ? (
          <span style={{
            fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em',
            color: style.color,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '82%',
            opacity: isPlannedOnly ? 0.6 : 1,
          }}>{headline}</span>
        ) : null}
      </div>

      {/* Run miles: actual run / planned (Emil — see daily planned + run).
          When the three roads render below, the "/planned" half is dropped: the triad row
          already states every target the day was given, and repeating the lowest of them as
          "/4.0" is the same number said twice in two different vocabularies. */}
      {isRunningDay && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, lineHeight: 1, flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 600, fontFamily: 'var(--font-mono)', color: actualRunMi > 0 ? '#60a5fa' : 'var(--text-muted)' }}>
            {actualRunMi > 0 ? actualRunMi.toFixed(1) : '–'}
          </span>
          {plannedRunMi > 0 && !showTriad && (
            <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>/{plannedRunMi.toFixed(1)}</span>
          )}
          <span style={{ fontSize: 7, color: 'var(--text-faint)' }}>mi</span>
        </div>
      )}

      {/* ── THE THREE ROADS ── read back from the frozen commitment, never recomputed here. */}
      {showTriad && (
        <TriadRow triad={triad} plannedTypes={plannedTypes} actualMi={actualRunMi}
          isPast={cell.date < localDate()} labels={rungLabels || {}} compact={false} />
      )}

      {/* COCKPIT BODY: image stays size-locked regardless of secondary
          activities. Phase 4r.calendar.10 — image container is always
          centered with the same dimensions; the secondary-activity
          rail is absolutely positioned on the right edge so it
          overlays the body without shrinking the image. This keeps
          every day's image at the SAME display size across the grid. */}
      <div style={{
        flex: 1, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 0,
      }}>
        {/* Center: up to TWO major figures side-by-side (Emil — match the
            mobile double-image view on two-a-day tiles). SIG_SCALE per family
            normalizes the mobility/race PNG whitespace so figures read the
            same size. Falls back to the crescent placeholder when empty. */}
        <div style={{
          height: '90%', width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 2,
          opacity: isPlannedOnly && !hasCompleted ? 0.45 : 1,
        }}>
          {hasFigures ? (
            majors.map((it, i) => (
              <img key={i} src={sigSrc(it.family)} alt={it.family}
                style={{
                  maxWidth: majors.length > 1 ? '50%' : '90%', maxHeight: '100%',
                  objectFit: 'contain', display: 'block',
                  transform: `scale(${SIG_SCALE[it.family] || 1})`,
                  transformOrigin: 'center',
                }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ))
          ) : (
            cell.inMonth && (
              <svg viewBox="0 0 24 24" width="45%" height="45%"
                fill="none" stroke="rgba(140,140,140,0.35)"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 14.5C19 17 16.5 19 13 19c-4 0-7-3-7-7 0-3.5 2-6 4.5-7 -1 4 2 8 9.5 9.5z"/>
              </svg>
            )
          )}
        </div>

        {/* Right rim: MINOR add-ons (<30min) — small figures / mobility icon,
            absolute so they don't compress the center. Matches the mobile rim. */}
        {minors.length > 0 && (
          <div style={{
            position: 'absolute',
            right: 0, top: 0, bottom: 0,
            display: 'flex', flexDirection: 'column',
            gap: 3, alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 2,
          }}>
            {minors.slice(0, 3).map((it, i) => (
              it.family === 'mobility'
                ? <MobilityDoneIcon key={i} size={16} color={(FAMILY_STYLE[it.family] || FAMILY_STYLE.rest).color}/>
                : <img key={i} src={sigSrc(it.family)} alt={it.family}
                    style={{ height: 20, width: 'auto', objectFit: 'contain', transform: `scale(${SIG_SCALE[it.family] || 1})` }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
            ))}
            {minors.length > 3 && (
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>+{minors.length - 3}</span>
            )}
          </div>
        )}
      </div>

      {/* Horizontal vital rail at the bottom — 4 cells, each is
          icon + value. Reads as a single instrument strip rather than
          a vertical right-side column. */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 2,
        borderTop: `0.5px solid ${style.border}`,
        paddingTop: 2,
        flexShrink: 0,
        alignItems: 'center',
      }}>
        <CockpitVitalH icon="dist"
          value={headlineMetric}
          color={style.color}/>
        <CockpitVitalH icon="act"
          value={totalLoad > 0 ? totalLoad : null}
          color={totalLoad > 0 ? style.color : null}/>
        <CockpitVitalH icon="fuel"
          value={fuelPct != null ? `${fuelPct}%` : null}
          color={fuelColor}/>
        <CockpitVitalH icon="body"
          value={bodyVal != null ? bodyVal : (sleepHrs ? `${sleepHrs}h` : null)}
          color={bodyColor}/>
      </div>

      {/* Phase 4r.calendar.9 — multi-activity hint moved to a right-side
          rail inside the body row (above) so it doesn't fight the
          horizontal vitals strip below. */}
    </button>
  );
}

// Phase 4r.calendar.7 — vital glyphs. Replaces the 3-character labels
// (VOL/ACT/FUEL/BODY) with compact inline SVG icons so the right-side
// instrument cluster reads tighter and more iconic. Each glyph is
// drawn at 9×9 in currentColor so it picks up the row's status color.
function VitalIcon({ kind, size = 9, color }) {
  const props = {
    width: size, height: size, viewBox: '0 0 10 10',
    fill: 'none', stroke: color, strokeWidth: 1.4,
    strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { flexShrink: 0, display: 'block' },
  };
  switch (kind) {
    case 'dist':  // running figure / forward arrow — distance/volume
      return <svg {...props}><path d="M1 7 L9 7"/><path d="M6 4.5 L9 7 L6 9.5"/></svg>;
    case 'act':   // lightning bolt — activity load
      return <svg {...props} fill={color} stroke="none"><path d="M5.5 0.5 L2 5.5 L4.5 5.5 L3.5 9.5 L8 4 L5.5 4 L6.5 0.5 Z"/></svg>;
    case 'fuel':  // flame — fuel/nutrition. Simpler teardrop shape so
                  // it reads as flame at 9px; the previous complex curve
                  // got lost at small sizes.
      return <svg {...props} fill={color} stroke="none"><path d="M5 0.5 C3 3 2 5 2 7 C2 8.5 3.3 9.5 5 9.5 C6.7 9.5 8 8.5 8 7 C8 5.5 7.2 4.5 6.5 4 C6.5 5.5 5.5 6 5 6 C5 4.5 5.5 2.5 5 0.5 Z"/></svg>;
    case 'body':  // heart — body/recovery
      return <svg {...props} fill={color} stroke="none"><path d="M5 9 C2 7 0.5 5.2 0.5 3.3 C0.5 2 1.4 1 2.7 1 C3.7 1 4.5 1.6 5 2.4 C5.5 1.6 6.3 1 7.3 1 C8.6 1 9.5 2 9.5 3.3 C9.5 5.2 8 7 5 9 Z"/></svg>;
    default: return null;
  }
}

// Single vital readout cell (vertical column variant — legacy, kept
// for back-compat; main layout now uses the horizontal version below).
function CockpitVital({ icon, value, color }) {
  const isDim = value == null || color == null;
  const c = isDim ? 'rgba(140,140,140,0.55)' : color;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 4, lineHeight: 1,
    }}>
      <VitalIcon kind={icon} size={9} color={c}/>
      <span style={{
        fontSize: 9, fontWeight: 600,
        color: c,
        opacity: isDim ? 0.5 : 1,
      }}>{isDim ? '—' : value}</span>
    </div>
  );
}

// ── Mobile day tile (Phase 4r.calendar.20 / .21) ───────────────────────────
// Compact variant for ≤600px viewports. Phase 4r.calendar.21 — now
// shows a family/race short-label top-right and a headline metric at
// the bottom, matching the desktop cockpit information density while
// staying readable at small size. Mobility tilde still bottom-right
// when mobility is layered on a non-mobility primary.
function MobileDayTile({ cell, isToday, isSelected, completed, planned, triad, rungLabels, races, isPast, onTileDragStart, onTileDragMove, onTileDragEnd, onPick }) {
  const hasRace = races.length > 0;
  const hasCompleted = completed.length > 0;
  const isPlannedOnly = !hasRace && !hasCompleted && planned && planned.type && planned.type !== 'rest';

  // Planned sessions ranked by the SAME training-priority as completed days (web parity),
  // so a Strength+Run day LEADS with the run — color, top-right tag, and the centered
  // figure — instead of whichever session was added first.
  const planFamily = (t) => (FAMILY_STYLE[t] ? t : (PLAN_TYPE_FAMILY[t] || 'cross'));
  const plannedRanked = isPlannedOnly
    ? daySessions(planned).filter(s => s && s.type && s.type !== 'rest')
        .sort((a, b) => (FAMILY_PRIORITY[planFamily(b.type)] || 0) - (FAMILY_PRIORITY[planFamily(a.type)] || 0))
    : [];
  const plannedPrimary = plannedRanked[0] || null;

  let family = 'rest';
  if (hasRace) family = 'race';
  // Phase 4r.calendar.fix.8 — dominant-by-training-priority, not log order.
  else if (hasCompleted) family = dominantActivityFamily(completed);
  else if (isPlannedOnly) family = plannedPrimary ? planFamily(plannedPrimary.type) : (planned.type || 'rest');
  const style = FAMILY_STYLE[family] || FAMILY_STYLE.rest;

  // Secondary mobility indicator. Phase 4r.calendar.fix.9 — was slice(1)
  // which assumed completed[0] was the dominant activity; after the
  // priority-based dominant-pick fix, mobility could be at index 0 with
  // a higher-priority HIIT/run at index 1. Now: mobility is "secondary"
  // whenever it's present AND it's not the dominant family on the tile.
  const hasMobilitySecondary = (
    (hasCompleted && family !== 'mobility' && completed.some(a => activityFamily(a) === 'mobility')) ||
    (isPlannedOnly && family !== 'mobility' &&
      daySessions(planned).some(s => s.type === 'mobility') &&
      daySessions(planned).some(s => s.type !== 'mobility' && s.type !== 'rest'))
  );

  const sigImg = (hasRace || hasCompleted || isPlannedOnly) ? sigSrc(family) : null;

  // Family / race short label — top-right. Race shows ★ + first word
  // of the race name (e.g. "★ RBC"); everything else shows the
  // FAMILY_SHORT 3-letter code (RUN / LIFT / HIIT / MOB).
  let topLabel = null;
  if (hasRace) {
    const firstWord = (races[0].name || 'Race').split(' ')[0];
    topLabel = { text: firstWord.slice(0, 5).toUpperCase(), color: '#ef4444', isRace: true };
  } else if (hasCompleted || isPlannedOnly) {
    const fam = hasCompleted ? family : family;
    const short = (FAMILY_SHORT[fam] || fam).toUpperCase().slice(0, 4);
    topLabel = { text: short, color: style.color, isRace: false };
  }

  // Headline metric for the bottom strip — distance for run-family,
  // duration otherwise. Null when nothing completed.
  const totalMi   = completed.reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
  const totalSecs = completed.reduce((s, a) => s + (Number(a.durationSecs) || 0), 0);
  // Run miles — actual run / planned, on running days (Emil — see both per tile).
  const plannedRunMi = (() => { try { return dayRunMiles(planned) + (races || []).reduce((s, r) => s + (Number(r.distanceMi) || 0), 0); } catch { return 0; } })();
  const actualRunMi = completed.reduce((s, a) => s + (isRun(a) && Number(a.distanceMi) > 0 ? Number(a.distanceMi) : 0), 0);
  const isRunningDay = plannedRunMi > 0 || actualRunMi > 0;
  const headlineMetric = isRunningDay
    ? `${actualRunMi > 0 ? actualRunMi.toFixed(1) : '–'}${plannedRunMi > 0 ? '/' + plannedRunMi.toFixed(1) : ''}mi`
    : hasCompleted
      ? (totalMi >= 0.5 ? `${totalMi.toFixed(1)}mi` : totalSecs >= 60 ? `${Math.round(totalSecs / 60)}m` : null)
      : null;
  void headlineMetric; // computed for parity with the web tile; the phone tile shows the triad row instead

  // ── THE THREE ROADS, phone size ────────────────────────────────────────────
  // Emil, 2026-07-25: "I see nothing on the Calendar for the option on what to run."
  // Identical rule to the web tile, because it is literally the same component — TriadRow
  // is shared so the two grids cannot print different numbers for the same Tuesday. Only
  // the size differs (compact), which is a fact about the screen and not about the plan.
  //
  // Note the phone tile never showed mileage at all before this, so nothing is being
  // replaced: the three targets are new information here, not a re-styling of old.
  const plannedTypes = (() => { try { return daySessions(planned).map(s => s.type); } catch { return []; } })();
  const showTriad = !!triad && !hasRace;

  // Glyph-only cells (Emil pick B): one small signature per distinct
  // session on the day. Races first, then completed families, else the
  // planned session families. Deduped; capped at 3 in render.
  const glyphFamilies = (() => {
    const out = [];
    const push = (gf) => { if (gf && gf !== 'rest' && !out.includes(gf)) out.push(gf); };
    if (hasRace) { push('race'); completed.forEach(a => push(activityFamily(a))); }
    else if (hasCompleted) { completed.forEach(a => push(activityFamily(a))); }
    else if (isPlannedOnly) { plannedRanked.forEach(s => push(s.type)); }
    if (!out.length && (hasRace || hasCompleted || isPlannedOnly)) push(family);
    return out;
  })();

  // Phase 4r.calendar.27 — today gets a much more pronounced
  // highlight: stronger blue tint, thicker glowing border, and
  // the day-number renders inside a small filled blue circle.
  // Previous treatment (faint 0.08 bg + 1px border) was too subtle
  // to spot at a glance.
  const tileBg = isToday ? 'rgba(55,138,221,0.18)'
               : (hasCompleted || hasRace) ? style.bg
               : 'transparent';
  const tileBorder = isToday ? '#378ADD'
                   : isSelected ? 'var(--accent-border)'
                   : (hasCompleted || hasRace || isPlannedOnly) ? style.border
                   : 'var(--border-subtle)';
  const borderStyle = isPlannedOnly && !hasCompleted && !hasRace ? 'dashed' : 'solid';
  const borderWidth = isToday ? '1.5px' : isSelected ? '1.5px' : '0.5px';

  // Tile figures: MAJOR (>=30min, big center, up to 2 side-by-side) vs MINOR
  // (<30min, small rim). Shared with the web DayTile via tileFigures() so both
  // surfaces render the same double-image view (Emil).
  const { majors, minors } = tileFigures({ hasRace, hasCompleted, isPlannedOnly, races, completed, plannedRanked });

  // Tile drag (mobile): long-press a day that has a plan to pick it up, then
  // drag onto another day. Native non-passive touchmove on the tile element so
  // preventDefault works AND the in-progress touch is actually delivered
  // (dynamically-added window listeners were not — confirmed via console).
  const hasPlan = !!planned && daySessions(planned).some(x => x.type && x.type !== 'rest');
  const draggable = !isPast && hasPlan && !hasRace;
  const btnRef = useRef(null);
  const lp = useRef({ timer: 0, dragging: false, sx: 0, sy: 0 });
  useEffect(() => {
    const el = btnRef.current;
    if (!el || !draggable) return undefined;
    const onTM = (e) => {
      const t = e.touches[0]; if (!t) return;
      const st = lp.current;
      if (st.dragging) { onTileDragMove?.(t.clientX, t.clientY); if (e.cancelable) e.preventDefault(); }
      else if (Math.abs(t.clientX - st.sx) > 14 || Math.abs(t.clientY - st.sy) > 14) { clearTimeout(st.timer); }
    };
    el.addEventListener('touchmove', onTM, { passive: false });
    return () => el.removeEventListener('touchmove', onTM);
  }, [draggable]);
  const onTileTouchStart = (e) => {
    if (!draggable) return;
    const t = e.touches[0]; if (!t) return;
    const st = lp.current;
    st.sx = t.clientX; st.sy = t.clientY; st.dragging = false;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => { st.dragging = true; onTileDragStart?.(cell.date, st.sx, st.sy); }, 320);
  };
  const onTileTouchEnd = () => {
    const st = lp.current;
    clearTimeout(st.timer);
    if (st.dragging) { st.dragging = false; onTileDragEnd?.(); }
  };

  return (
    <button onClick={onPick} ref={btnRef}
      onTouchStart={draggable ? onTileTouchStart : undefined}
      onTouchEnd={draggable ? onTileTouchEnd : undefined}
      onTouchCancel={draggable ? onTileTouchEnd : undefined}
      className="arnold-cal-cell"
      style={{
        all: 'unset', cursor: 'pointer',
        // Phase 4r.calendar.36 — removed arnold-compact-btn. Day tiles
        // are already large (~55×46px on a Samsung S25U) so the invisible
        // hit-area extension was unnecessary and was causing neighboring
        // tiles' extended areas to overlap, making tap targets fuzzy at
        // the row boundaries. Tile is its own touch target now.
        // Phase 4r.calendar.28 — shrink to 6:5 (wider than tall) so
        // the full 6-row grid + drawer fits on a Samsung S25U
        // screen without forcing the user to scroll to see the
        // drawer's Body section. Square tiles were too tall: 6 rows
        // × ~52px = ~312px just for the grid. 6:5 saves ~50px while
        // keeping the signature figure readable.
        aspectRatio: '6 / 5',
        width: '100%',
        padding: '2px 4px',
        position: 'relative',
        borderRadius: 5,
        border: `${borderWidth} ${borderStyle} ${tileBorder}`,
        // Soft outer glow on today only — no shadow on others.
        boxShadow: isToday ? '0 0 0 1px rgba(55,138,221,0.35) inset' : 'none',
        background: cell.inMonth ? tileBg : 'transparent',
        opacity: cell.inMonth ? 1 : 0.30,
        display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'hidden',
        minWidth: 0,
      }}>
      {/* Top row: day number (left) + family/race label (right).
          Today's day number renders inside a filled blue pill for
          unmistakable visual emphasis. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: 2, lineHeight: 1, position: 'relative', zIndex: 1,
      }}>
        <span style={{
          fontSize: isToday ? 11 : 10,
          fontWeight: isToday ? 700 : 500,
          color: isToday ? '#fff' : (cell.inMonth ? 'var(--text-primary)' : 'var(--text-muted)'),
          background: isToday ? '#378ADD' : 'transparent',
          padding: isToday ? '1px 5px' : 0,
          borderRadius: isToday ? 8 : 0,
          minWidth: isToday ? 14 : 'auto',
          textAlign: 'center',
        }}>{cell.day}</span>
        {topLabel && (
          <span style={{
            fontSize: 7, fontWeight: 700, letterSpacing: '0.04em',
            color: topLabel.color,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            maxWidth: '60%',
            opacity: isPlannedOnly && !hasCompleted ? 0.7 : 1,
          }}>{topLabel.isRace ? `★${topLabel.text}` : topLabel.text}</span>
        )}
      </div>

      {/* Major workouts (>=30min) fill the tile — up to two, side by side. */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 1, minHeight: 0,
        opacity: isPlannedOnly && !hasCompleted ? 0.6 : 1,
      }}>
        {majors.map((it, i) => (
          <img key={i} src={sigSrc(it.family)} alt={it.family}
            style={{
              maxWidth: majors.length > 1 ? '50%' : '100%', maxHeight: '100%',
              objectFit: 'contain', display: 'block',
              transform: `scale(${SIG_SCALE[it.family] || 1})`,
              transformOrigin: 'center',
            }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ))}
      </div>

      {/* Minor workouts (<30min) — small figures on the right rim (Emil). */}
      {minors.length > 0 && (
        <div style={{
          position: 'absolute', top: '50%', right: 1, transform: 'translateY(-50%)',
          zIndex: 2, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-end',
        }}>
          {minors.slice(0, 3).map((it, i) => (
            it.family === 'mobility'
              ? <MobilityDoneIcon key={i} size={13} color="#5eead4"/>
              : <img key={i} src={sigSrc(it.family)} alt={it.family}
                  style={{ height: 15, width: 'auto', objectFit: 'contain', transform: `scale(${SIG_SCALE[it.family] || 1})` }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
          ))}
        </div>
      )}

      {/* The three roads. Sits under the figure and takes its height from it — the
          signature block above is flex:1, so it yields the ~9px this row needs rather
          than the row overflowing the tile. */}
      {showTriad && (
        <div style={{ position: 'relative', zIndex: 1, marginTop: 1 }}>
          <TriadRow triad={triad} plannedTypes={plannedTypes} actualMi={actualRunMi}
            isPast={isPast} labels={rungLabels || {}} compact />
        </div>
      )}
    </button>
  );
}

// Horizontal vital readout cell — icon stacked above value. Used in
// the bottom strip of each calendar tile (Phase 4r.calendar.8).
function CockpitVitalH({ icon, value, color }) {
  const isDim = value == null || color == null;
  const c = isDim ? 'rgba(140,140,140,0.55)' : color;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 1, lineHeight: 1,
    }}>
      <VitalIcon kind={icon} size={9} color={c}/>
      <span style={{
        fontSize: 8, fontWeight: 600,
        color: c,
        opacity: isDim ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}>{isDim ? '—' : value}</span>
    </div>
  );
}

// ── 3-domain cell (Activity / Fuel / Body) ──────────────────────────────────
// Renders one cell of the per-day three-domain strip. Empty cells stay
// dim with a "—" placeholder so the tile communicates "no data here"
// rather than "the domain doesn't exist."
function ThreeDomainCell({ label, value, color }) {
  const isDim = value == null || color == null;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      lineHeight: 1, gap: 1,
    }}>
      <span style={{
        fontSize: 7, fontWeight: 700, letterSpacing: '0.04em',
        color: isDim ? 'var(--text-muted)' : color,
        opacity: isDim ? 0.5 : 0.8,
      }}>{label}</span>
      <span style={{
        fontSize: 9, fontWeight: 600,
        color: isDim ? 'var(--text-muted)' : color,
        opacity: isDim ? 0.4 : 1,
      }}>{isDim ? '—' : value}</span>
    </div>
  );
}

// ── Day drawer ──────────────────────────────────────────────────────────────

function DayDrawer({ isMobile, dateStr, activities, planned, races, onSessionDragStart, onEditSession, onAddRace, onAddPlan, onManualAdd, onIcsImport, onDeleteRace, onClose, onPlanChange, onBuildPlanToRace, onSwapDay, onMoveSession }) {
  const d = new Date(dateStr + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  // Phase 4r.calendar.24 — strictly-past dates hide the race-add
  // buttons (adding races to days that already happened is
  // irrelevant). Compare local-date strings, not Date objects, to
  // dodge timezone drift.
  const isPast = dateStr < localDate();

  // A planned session is "done" once Arnold has a matching logged activity (a
  // real timestamped record) for the day. Cancel/edit is tied to THIS — not the
  // calendar date, and not to whether some OTHER session that day happened
  // (Emil: today's race-run shouldn't lock an un-done strength session).
  const sessionDone = (session) => {
    const t = session && session.type;
    if (!t || t === 'rest') return false;
    const RUNISH = /run|tempo|interval|threshold|speed|race|recovery|progression/i;
    return (activities || []).some(a => {
      const fam = activityFamily(a);
      if (RUNISH.test(t)) return isRun(a) || a.isRace || ['run', 'intervals', 'tempo', 'race'].includes(fam);
      if (t === 'strength') return isStrength(a) || fam === 'strength';
      if (t === 'mobility') return isMobility(a) || fam === 'mobility';
      if (t === 'cycle' || t === 'bike') return isCycling(a) || fam === 'cycle';
      if (t === 'hiit') return isHIIT(a) || isExplicitHIIT(a) || fam === 'hiit';
      if (t === 'swim') return isSwim(a) || fam === 'swim';
      if (t === 'ski') return isSki(a) || fam === 'ski';
      if (t === 'walk') return isWalk(a) || fam === 'walk';
      return fam === t;
    });
  };

  // Remove one planned session from this day, then refresh the calendar.
  const removeSession = (idx) => {
    try {
      const wk = weekKey(d);
      const week = getPlannerWeek(wk);
      const monday = new Date(wk + 'T12:00:00');
      const dIdx = Math.floor((d - monday) / 86400000);
      if (dIdx < 0 || dIdx >= 7) return;
      const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
      while (days.length < 7) days.push({ type: 'rest' });
      const sessions = daySessions(days[dIdx]);
      sessions.splice(idx, 1);
      days[dIdx] = makeDay(sessions);
      savePlannerWeek(wk, { ...week, days });
      onPlanChange?.();
    } catch (e) { console.warn('[calendar] remove session failed:', e); }
  };

  // Edit a planned session's mileage in place — no need to ✕ and re-add (Emil).
  const updateSessionDistance = (idx, newMi) => {
    try {
      const wk = weekKey(d);
      const week = getPlannerWeek(wk);
      const monday = new Date(wk + 'T12:00:00');
      const dIdx = Math.floor((d - monday) / 86400000);
      if (dIdx < 0 || dIdx >= 7) return;
      const days = [...(week.days || Array(7).fill({ type: 'rest' }))];
      while (days.length < 7) days.push({ type: 'rest' });
      const sessions = daySessions(days[dIdx]);
      if (!sessions[idx]) return;
      sessions[idx] = { ...sessions[idx], distanceMi: Math.max(0, Number(newMi) || 0) };
      days[dIdx] = makeDay(sessions);
      savePlannerWeek(wk, { ...week, days });
      onPlanChange?.();
    } catch (e) { console.warn('[calendar] update session distance failed:', e); }
  };

  // Recovery snapshot
  // Phase 4r.calendar.32 — live Garmin worker stores total sleep as
  // `totalSleepMinutes` (per garmin-client.js normalizeSleepRow).
  // The earlier code looked for `durationMinutes` (legacy HC field)
  // and `totalSleepHours` (never existed), which is why every Sleep
  // cell rendered empty for the user's live-Garmin data. Check both
  // names in priority order for backward compat with any older HC
  // rows still in storage.
  const sleep = (storage.get('sleep') || []).find(s => s.date === dateStr);
  const hrv = (storage.get('hrv') || []).find(h => h.date === dateStr);
  const sleepScore = sleep?.sleepScore != null ? Math.round(sleep.sleepScore) : null;
  const sleepMins = sleep?.totalSleepMinutes ?? sleep?.durationMinutes ?? null;
  const sleepHrs   = sleepMins != null ? (sleepMins / 60).toFixed(1) : null;
  const overnightHRV = sleep?.overnightHRV ?? hrv?.overnightHRV ?? null;
  const rhr = sleep?.restingHR ?? sleep?.restingHeartRate ?? null;

  // Phase 4r.calendar.32 — Weight is now EXACT-MATCH ONLY. Earlier
  // (.29) a 7-day lookback inherited the most recent weigh-in, but
  // that misrepresents days where you didn't actually weigh — today
  // showed weight even when there was no weigh-in. The calendar is
  // a "what happened today" log, not a "what does the data project."
  // Days without an exact-date weigh-in render no Weight cell.
  const allWeights = [
    ...(storage.get('weight') || []),
    ...(storage.get('arnold:garmin-weight') || []),
  ].filter(w => w?.date && (w.weightLbs != null || w.weightKg != null));
  // Morning-fasted reading for the day (not a post-workout/intraday one). Same
  // exact-date philosophy — no weigh-in that morning → no Weight cell.
  const weightForDate = morningWeightRows(allWeights).find(w => w.date === dateStr) || null;
  const weightLbs = weightForDate
    ? (weightForDate.weightLbs != null
        ? parseFloat(weightForDate.weightLbs)
        : (weightForDate.weightKg != null ? parseFloat(weightForDate.weightKg) * 2.20462 : null))
    : null;

  // Phase 4r.calendar.27 — previous-day snapshot for delta arrows in
  // the metric pills. We pull the same fields from the day before
  // dateStr so MetricBox can show ↑/↓ vs yesterday.
  const prevDateStr = (() => {
    try {
      const pd = new Date(dateStr + 'T12:00:00');
      pd.setDate(pd.getDate() - 1);
      return ymd(pd);
    } catch { return null; }
  })();
  const prevSleep = prevDateStr ? (storage.get('sleep') || []).find(s => s.date === prevDateStr) : null;
  const prevHrv   = prevDateStr ? (storage.get('hrv')   || []).find(h => h.date === prevDateStr) : null;
  const prevSleepScore = prevSleep?.sleepScore != null ? Math.round(prevSleep.sleepScore) : null;
  const prevSleepMins  = prevSleep?.totalSleepMinutes ?? prevSleep?.durationMinutes ?? null;
  const prevSleepHrs   = prevSleepMins != null ? parseFloat((prevSleepMins / 60).toFixed(1)) : null;
  const prevOvernightHRV = prevSleep?.overnightHRV ?? prevHrv?.overnightHRV ?? null;
  const prevRhr = prevSleep?.restingHR ?? null;
  const prevNut = (() => {
    if (!prevDateStr) return null;
    try { return nutDailyTotals(prevDateStr); } catch { return null; }
  })();
  // Phase 4r.calendar.29 — prev weight for the delta arrow.
  const prevWeightEntry = prevDateStr ? allWeights.find(w => w.date === prevDateStr) : null;
  const prevWeightLbs = prevWeightEntry
    ? (prevWeightEntry.weightLbs != null
        ? parseFloat(prevWeightEntry.weightLbs)
        : (prevWeightEntry.weightKg != null ? parseFloat(prevWeightEntry.weightKg) * 2.20462 : null))
    : null;

  // Phase 4r.calendar.30 — 7-day history for Core sparklines. Walks
  // back from dateStr inclusive and collects each day's value (or null
  // if missing). Sparkline component will filter nulls and normalize.
  const sleepRowsAll = storage.get('sleep') || [];
  const hrvRowsAll   = storage.get('hrv')   || [];
  const buildHistory = (extract) => {
    const out = [];
    if (!dateStr) return out;
    try {
      const d0 = new Date(dateStr + 'T12:00:00');
      for (let i = 6; i >= 0; i--) {
        const d = new Date(d0);
        d.setDate(d.getDate() - i);
        const ds = ymd(d);
        out.push(extract(ds));
      }
    } catch {}
    return out;
  };
  const rhrHistory    = buildHistory(ds => {
    const s = sleepRowsAll.find(x => x.date === ds);
    return s?.restingHR != null ? Number(s.restingHR) : null;
  });
  const hrvHistory    = buildHistory(ds => {
    const s = sleepRowsAll.find(x => x.date === ds);
    const h = hrvRowsAll.find(x => x.date === ds);
    const v = s?.overnightHRV ?? h?.overnightHRV ?? null;
    return v != null ? Number(v) : null;
  });
  const sleepHistory  = buildHistory(ds => {
    const s = sleepRowsAll.find(x => x.date === ds);
    const mins = s?.totalSleepMinutes ?? s?.durationMinutes ?? null;
    return mins != null ? Number(mins) / 60 : null;
  });
  const weightHistory = buildHistory(ds => {
    const w = allWeights.find(x => x.date === ds);
    if (!w) return null;
    if (w.weightLbs != null) return Number(w.weightLbs);
    if (w.weightKg  != null) return Number(w.weightKg) * 2.20462;
    return null;
  });

  // Phase 4r.dataspine.4 — canonical Layer 3 targets from goalModel.
  // All four macros (calories + protein + carbs + fat) now come from
  // getEffectiveTargets — the macro fields landed in dataspine.4 so
  // the legacy parseFloat(goals.X) fallbacks are no longer needed.
  const goals = getGoals?.() || {};
  const _effTargets = (() => {
    try { return getEffectiveTargets({ date: dateStr }); } catch { return null; }
  })();
  const calTarget  = _effTargets?.dailyCalories?.effective || 0;
  const proTarget  = _effTargets?.dailyProtein?.effective  || 0;
  const carbTarget = _effTargets?.dailyCarbs?.effective    || 0;
  const fatTarget  = _effTargets?.dailyFat?.effective      || 0;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      // Phase 4r.calendar.29 — contour-less inside, but keep the
      // outer panel border so the drawer reads as one unit. Stable
      // min-height so the panel doesn't jump as the user picks
      // different days with varying amounts of data.
      padding: isMobile ? '8px 12px' : '10px 14px',
      marginBottom: 8,
      minHeight: isMobile ? 180 : 280,
    }}>
      {/* Header: date label (left) + race pill OR +Add race (right) +
          optional close button. Phase 4r.calendar.29 — no border-bottom
          to keep the contour-less look. */}
      <div style={{ marginBottom: 10 }}>
        {/* Row 1: date (full width) + close. */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{dateLabel}</div>
          {onClose && (
            <button onClick={onClose} title="Close detail panel" style={{ all: 'unset', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '2px 6px', color: 'var(--text-muted)', flexShrink: 0, borderRadius: 4 }}>✕</button>
          )}
        </div>
        {/* Race line — name + distance + city + prediction, consolidated (no
            separate pill / redundant "Race" chip). */}
        {(() => {
          // A store race OR a planner-only race day (type:'race' on the Calendar
          // but never written to the races store — e.g. from "build plan to race").
          // Renders for either, distance optional, always deletable.
          const plannerRace = daySessions(planned).find(s => s.type === 'race') || null;
          const raceEntry = races[0]
            || (plannerRace ? { name: plannerRace.name || (planned && planned.notes) || 'Race', distanceMi: Number(plannerRace.distanceMi) || null, city: null, date: dateStr } : null);
          if (!raceEntry) return null;
          const racePred = raceEntry.distanceMi ? (() => { try { return predictRaceFinish(raceEntry, getUnifiedActivities() || []); } catch { return null; } })() : null;
          const ss = racePred?.seconds;
          const racePredStr = (ss != null && Number.isFinite(ss) && ss > 0)
            ? (() => { const h = Math.floor(ss / 3600), m = Math.floor((ss % 3600) / 60), sec = Math.round(ss % 60); return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; })()
            : null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span style={{ fontSize: 11, color: '#ef4444', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {`\u2605 ${raceEntry.name || 'Race'}${raceEntry.distanceMi ? ' \u00b7 ' + distanceLabel(raceEntry) : ''}${raceEntry.city ? ` \u00b7 ${raceEntry.city}` : ''}${racePredStr ? ` \u00b7 \u23f1 ~${racePredStr}` : ''}`}
              </span>
              {onDeleteRace && !sessionDone({ type: 'race' }) && (
                <button onClick={() => onDeleteRace(races[0]?.id ?? null, dateStr)} title="Remove race" style={{ all: 'unset', cursor: 'pointer', fontSize: 11, color: '#f87171', flexShrink: 0, padding: '0 2px' }}>✕</button>
              )}
            </div>
          );
        })()}
        {/* Planned-session chips (excluding the race itself) + actions, flowing
            across the full width instead of squashed into a skinny column. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {daySessions(planned).map((s, i) => {
            if (!s.type || s.type === 'rest' || s.type === 'race') return null;
            const mi = MILEAGE_TYPES.has(s.type) ? (Number(s.distanceMi) || 0) : 0;   // ignore stale miles on cross-train
            const durMin = Number(s.durationMin) || 0;   // cross-train carries an explicit duration (no miles)
            const TIMED = new Set(['easy_run', 'long_run']);
            const mins = TIMED.has(s.type) ? (() => { try { return plannedMinutes({ planned: s, profile: storage.get('profile') || {} }); } catch { return null; } })() : null;
            const extra = [mi > 0 ? `${mi} mi` : null, durMin > 0 ? `${durMin} min` : (mins ? `~${mins} min` : null)].filter(Boolean).join(' \u00b7 ');
            // Double day (2+ real sessions) \u2192 each chip gets a per-session move (\u21c4): relocate JUST
            // this session, leaving the other half. Single-session days use the day-level "Move to\u2026".
            const isDouble = daySessions(planned).filter(x => x.type && x.type !== 'rest' && x.type !== 'race').length > 1;
            return (
              <span key={i} onClick={!sessionDone(s) ? (e) => { if (e.target && e.target.tagName === 'BUTTON') return; onEditSession?.(i, s); } : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 3px 2px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: !sessionDone(s) ? 'pointer' : undefined }}>
                {s.slot ? <span style={{ fontSize: 8, color: 'var(--text-faint)' }}>{s.slot}</span> : null}
                <span>{prettyFamily(s.type)}{extra ? ` \u00b7 ${extra}` : ''}</span>
                {!sessionDone(s) && !isPast && isDouble && onMoveSession && (
                  <button onClick={(e) => { e.stopPropagation(); onMoveSession(dateStr, i, prettyFamily(s.type)); }} className="arnold-compact-btn" style={{ all: 'unset', cursor: 'pointer', color: '#5eead4', fontSize: 11, lineHeight: 1, padding: '0 2px' }} title={`Change just this ${prettyFamily(s.type)} — move or swap it`}>⇄</button>
                )}
                {!sessionDone(s) && (
                  <button onClick={(e) => { e.stopPropagation(); removeSession(i); }} className="arnold-compact-btn" style={{ all: 'unset', cursor: 'pointer', color: '#f87171', fontSize: 12, lineHeight: 1, padding: '0 3px' }} title="Remove this session">✕</button>
                )}
              </span>
            );
          })}
          {!isPast && onAddPlan && (
            <button onClick={onAddPlan} className="arnold-compact-btn" style={{ all: 'unset', cursor: 'pointer', position: 'relative', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 999, color: '#a78bfa', background: 'rgba(167,139,250,0.10)', border: '0.5px solid rgba(167,139,250,0.30)' }}>+ Plan</button>
          )}
          {!isPast && onSwapDay && daySessions(planned).some(s => s.type && s.type !== 'rest' && s.type !== 'race') && (
            <button onClick={() => onSwapDay(dateStr)} className="arnold-compact-btn" title="Change this day — move it, swap the workout, or skip it (you’ll see the impact first)"
              style={{ all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 999, color: '#5eead4', background: 'rgba(94,234,212,0.10)', border: '0.5px solid rgba(94,234,212,0.30)' }}>↻ Change…</button>
          )}
          {!isPast && races.length > 0 && onBuildPlanToRace && (
            <button onClick={() => onBuildPlanToRace(races[0].date)} className="arnold-compact-btn" title="Open the plan generator targeting this race" style={{ all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 999, color: '#5eead4', background: 'rgba(94,234,212,0.10)', border: '0.5px solid rgba(94,234,212,0.30)' }}>✦ Build plan to this race</button>
          )}
          {!isPast && races.length === 0 && onAddRace && (
            <button onClick={onAddRace} className="arnold-compact-btn" style={{ all: 'unset', cursor: 'pointer', position: 'relative', fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 999, color: '#60a5fa', background: 'rgba(96,165,250,0.10)', border: '0.5px solid rgba(96,165,250,0.30)' }}>+ Add race</button>
          )}
          {races.length === 0 && !daySessions(planned).some(s => s.type && s.type !== 'rest') && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No plan</span>
          )}
        </div>
      </div>

      {/* Phase 4r.intel.11 — Predicted bands for the planned workout.
          Renders only when today (or a future date) has a non-rest plan
          AND no activity is logged for the day yet. Once an activity is
          logged, the Activity section below carries the actual numbers and
          the expected-bands card disappears — no more stale "expected" once
          you've actually done the workout (Phase 4r.intel.12-fix4). */}
      {!isPast && activities.length === 0 && (() => {
        const ws = daySessions(planned).filter(ps => ps.type && ps.type !== 'rest');
        if (!ws.length) return null;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: isMobile ? 6 : 10 }}>
            {ws.map((ps, i) => (
              <PredictedBandsCard key={i}
                family={ps.type}
                dateStr={dateStr}
                maxHR={parseFloat((storage.get('profile') || {}).maxHR) || null}
                planLabel={`${prettyFamily(ps.type)}${MILEAGE_TYPES.has(ps.type) && Number(ps.distanceMi) > 0 ? ` \u00b7 ${ps.distanceMi} mi` : (Number(ps.durationMin) > 0 ? ` \u00b7 ${ps.durationMin} min` : '')}`}
              />
            ))}
          </div>
        );
      })()}

      {/* Activity — Phase 4r.calendar.30 — single-line rows, no
          signature (calendar tile carries the imagery). HR zone bar
          renders only below the primary (first) activity. */}
      <SectionTitle>Activity</SectionTitle>
      {activities.length === 0 ? (
        <EmptyHint>No activities logged.</EmptyHint>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
          {activities.map((a, i) => (
            <div key={i}>
              <ActivityRow activity={a}/>
              {i === 0 && Array.isArray(a.hrZones) && a.hrZones.length > 0 && (
                <ZoneBar zones={a.hrZones}/>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fuel — Phase 4r.calendar.30 — horizontal progress bars.
          Each bar shows value/target so users see progress-to-goal
          at a glance, not just an absolute number. Colors aligned to
          BOWL_PALETTES in NutritionInput.jsx. */}
      <SectionTitle>Fuel</SectionTitle>
      {(() => {
        let nut = null;
        try { nut = nutDailyTotals(dateStr); } catch {}
        if (!nut || (!nut.calories && !nut.protein && !nut.carbs && !nut.fat)) {
          return <EmptyHint>No nutrition logged for this day.</EmptyHint>;
        }
        return (
          <div style={{ marginBottom: 10 }}>
            <FuelBar label="Cal"  value={Math.round(nut.calories || 0)} target={calTarget}  unit=""  color="#60a5fa"/>
            <FuelBar label="Pro"  value={Math.round(nut.protein  || 0)} target={proTarget}  unit="g" color="#4ade80"/>
            <FuelBar label="Carb" value={Math.round(nut.carbs    || 0)} target={carbTarget} unit="g" color="#fbbf24"/>
            <FuelBar label="Fat"  value={Math.round(nut.fat      || 0)} target={fatTarget}  unit="g" color="#f472b6"/>
          </div>
        );
      })()}

      {/* Core — Phase 4r.calendar.30 — 4-up compact vital row.
          Each cell carries icon + delta + value + label + 7-day
          sparkline. RHR lowerIsBetter (down=green), HRV/Sleep
          higher=better, Weight neutral. */}
      <SectionTitle>Core</SectionTitle>
      {!sleepHrs && !overnightHRV && !rhr && weightLbs == null ? (
        <EmptyHint>No body data for this day.</EmptyHint>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 6, marginBottom: 4,
        }}>
          {rhr != null && (
            <CompactVital
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>}
              value={Math.round(rhr)} unit="bpm" label="RHR" color="#f87171"
              prev={prevRhr != null ? Math.round(prevRhr) : null}
              lowerIsBetter history={rhrHistory}
            />
          )}
          {overnightHRV != null && (
            <CompactVital
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>}
              value={Math.round(overnightHRV)} unit="ms" label="HRV" color="#4ade80"
              prev={prevOvernightHRV != null ? Math.round(prevOvernightHRV) : null}
              history={hrvHistory}
            />
          )}
          {sleepHrs && (
            <CompactVital
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>}
              value={sleepHrs} unit="h" label="Sleep" color="#22d3ee"
              prev={prevSleepHrs}
              history={sleepHistory}
            />
          )}
          {weightLbs != null && (
            <CompactVital
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11 }}><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/></svg>}
              value={weightLbs.toFixed(1)} unit="lb" label="Weight" color="#fbbf24"
              prev={prevWeightLbs != null ? parseFloat(prevWeightLbs.toFixed(1)) : null}
              neutral history={weightHistory}
            />
          )}
        </div>
      )}

      {/* Phase 4r.calendar.29 — bottom action row removed entirely.
          + Add race lives in the top-right slot when no race is
          scheduled (replaces the race pill when present). + Manual
          and ⇣ ICS sync were rarely used and added clutter, so they
          moved out of the drawer. If you need them, they're still
          available via the calendar header (desktop) or can be
          re-introduced behind a long-press menu later. */}
    </div>
  );
}

// Phase 4r.calendar.30 — single-line activity row. No signature
// (the calendar tile above already carries the imagery). Glyph +
// name + metric string. Time formatted "1h 35m" when >= 60 min.
// Avg HR appended when available.
function ActivityRow({ activity }) {
  const fam = activityFamily(activity);
  const style = FAMILY_STYLE[fam] || FAMILY_STYLE.rest;
  const secs = activity.durationSecs || 0;
  const mins = secs ? Math.round(secs / 60) : null;
  const timeStr = mins ? (mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`) : null;
  const mi = activity.distanceMi ? activity.distanceMi.toFixed(1) : null;
  const avgHR = activity.avgHR || activity.avgHeartRate || null;
  const bits = [];
  if (mi) bits.push(`${mi} mi`);
  if (timeStr) bits.push(timeStr);
  if (avgHR) bits.push(`♥ ${Math.round(avgHR)}`);
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      padding: '2px 0',
    }}>
      <span style={{
        color: style.color, fontSize: 13, fontWeight: 700,
        lineHeight: 1, width: 14, flexShrink: 0, textAlign: 'center',
      }}>{style.icon}</span>
      <span style={{
        flex: 1, fontSize: 12, color: 'var(--text-primary)', fontWeight: 500,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {activity.activityName || activity.activityType || prettyFamily(fam)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, letterSpacing: '-0.01em' }}>
        {bits.join(' · ')}
      </span>
    </div>
  );
}

// Phase 4r.calendar.30 — HR zone time-in-zone bar. 5-segment colored
// bar showing the share of activity time spent in each HR zone.
// Renders only when the primary activity has an hrZones array.
function ZoneBar({ zones }) {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  // Each zone entry can be { secsInZone } or just a number. Tolerate both.
  const secs = zones.map(z => typeof z === 'object' ? (z.secsInZone || z.seconds || 0) : (Number(z) || 0));
  const total = secs.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const colors = ['#5DCAA5', '#378ADD', '#4ade80', '#EF9F27', '#f87171']; // Z1..Z5
  return (
    <div>
      <div style={{
        display: 'flex', gap: 1,
        marginLeft: 22, marginTop: 4, marginBottom: 2,
        height: 3, borderRadius: 2, overflow: 'hidden',
      }}>
        {secs.slice(0, 5).map((s, i) => {
          const frac = s / total;
          if (frac <= 0) return null;
          return (
            <div key={i} style={{
              background: colors[i] || '#888', flex: frac,
            }}/>
          );
        })}
      </div>
    </div>
  );
}

// Phase 4r.calendar.30 — horizontal progress bar for Fuel macros.
// Label left (muted small-caps) + colored progress bar (fill = value/target)
// + value/target text right. Reads cleaner than bowls at the drawer's
// compact width and surfaces progress-to-goal at a glance.
function FuelBar({ label, value, target, unit, color }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const fmtNum = (n) => n >= 1000 ? n.toLocaleString() : String(n);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <span style={{
        width: 30, fontSize: 9, fontWeight: 600,
        color, textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</span>
      <div style={{
        flex: 1, height: 5,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 3, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color, borderRadius: 3,
        }}/>
      </div>
      <span style={{
        minWidth: 76, textAlign: 'right',
        fontSize: 10, color: 'var(--text-primary)',
        letterSpacing: '-0.01em',
      }}>{fmtNum(value)} / {fmtNum(target)}{unit ? ` ${unit}` : ''}</span>
    </div>
  );
}

// Phase 4r.calendar.30 — compact vital cell for the Core 4-up row.
// Cockpit-style cell: icon top-left, delta top-right, big value
// centered, label below, mini 7-day sparkline at the floor. Subtle
// family-color left rail + barely-tinted background.
function CompactVital({ icon, value, unit, label, prev = null, lowerIsBetter = false, neutral = false, history = null, color }) {
  let delta = null;
  if (typeof prev === 'number' && !isNaN(prev) && typeof value !== 'undefined') {
    const cur = parseFloat(value);
    if (!isNaN(cur) && cur !== prev) {
      const diff = cur - prev;
      const fmt = Math.abs(diff) >= 10 ? Math.round(diff) : (Math.round(diff * 10) / 10);
      const isUp = diff > 0;
      const good = neutral ? null : lowerIsBetter ? !isUp : isUp;
      const arrowColor = good == null ? 'var(--text-muted)' : good ? '#4ade80' : '#f87171';
      delta = { text: `${isUp ? '↑' : '↓'}${Math.abs(fmt)}`, color: arrowColor };
    }
  }
  // Sparkline: normalize history to 0-1 over its own range.
  let sparkPath = null;
  if (Array.isArray(history) && history.length >= 2) {
    const vals = history.filter(v => typeof v === 'number' && !isNaN(v));
    if (vals.length >= 2) {
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min || 1;
      const w = 100, h = 9;
      const points = vals.map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = h - ((v - min) / range) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      sparkPath = points;
    }
  }
  return (
    <div style={{
      padding: '6px 4px 4px 6px',
      borderRadius: 8,
      background: 'rgba(255,255,255,0.02)',
      borderLeft: `2px solid ${color}`,
      display: 'flex', flexDirection: 'column', gap: 1,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
        <span style={{ width: 11, height: 11, color, display: 'flex' }}>{icon}</span>
        {delta && (
          <span style={{
            fontSize: 8.5, fontWeight: 600, color: delta.color,
            letterSpacing: '-0.02em',
          }}>{delta.text}</span>
        )}
      </div>
      <div style={{
        fontSize: 13, fontWeight: 600, color,
        lineHeight: 1, letterSpacing: '-0.02em',
      }}>
        {value}<span style={{ fontSize: 8, color: 'var(--text-muted)', marginLeft: 1, fontWeight: 400 }}>{unit}</span>
      </div>
      <div style={{
        fontSize: 7.5, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1,
      }}>{label}</div>
      {sparkPath && (
        <svg width="100%" height="9" viewBox="0 0 100 9" preserveAspectRatio="none" style={{ marginTop: 1, display: 'block' }}>
          <polyline points={sparkPath} fill="none" stroke={color} strokeWidth="1.4" opacity="0.7"/>
        </svg>
      )}
    </div>
  );
}

// Phase 4r.calendar.29 — inline metric row. Kept for any caller that
// still wants the simple row layout; the drawer now uses FuelBar +
// CompactVital instead.
function MetricRow({ label, value, unit, color = 'var(--text-primary)', prev = null, lowerIsBetter = false, neutral = false }) {
  let delta = null;
  if (typeof prev === 'number' && !isNaN(prev) && typeof value !== 'undefined') {
    const cur = parseFloat(value);
    if (!isNaN(cur) && cur !== prev) {
      const diff = cur - prev;
      const fmt = Math.abs(diff) >= 10 ? Math.round(diff) : (Math.round(diff * 10) / 10);
      const isUp = diff > 0;
      const good = neutral ? null : lowerIsBetter ? !isUp : isUp;
      const arrowColor = good == null ? 'var(--text-muted)' : good ? '#4ade80' : '#f87171';
      delta = { text: `${isUp ? '↑' : '↓'}${Math.abs(fmt)}`, color: arrowColor };
    }
  }
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      padding: '3px 0',
    }}>
      <span style={{
        flex: 1, fontSize: 11, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 500,
      }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 600, color, lineHeight: 1, flexShrink: 0,
      }}>
        {value}<span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 400 }}>{unit}</span>
      </span>
      <span style={{
        fontSize: 10, fontWeight: 600,
        color: delta ? delta.color : 'transparent',
        width: 36, textAlign: 'right', flexShrink: 0,
        letterSpacing: '-0.02em',
      }}>{delta ? delta.text : '·'}</span>
    </div>
  );
}

// Phase 4r.calendar.14 / .27 — colored MetricBox.
// Each metric carries the color Arnold uses for it across the app:
//   Nutrition (matches BOWL_PALETTES in NutritionInput.jsx):
//     calories #60a5fa (blue), protein #4ade80 (green),
//     carbs #fbbf24 (amber), fat #f472b6 (pink)
//   Body: sleep #22d3ee (cyan), HRV #4ade80 (green), RHR #f87171 (red)
// Phase 4r.calendar.27 — right-aligned value + optional delta arrow
// vs previous day. prev = previous-day numeric value; lowerIsBetter
// flips arrow coloring (RHR: down=good). Neutral metrics (calories,
// macros tied to a plan) pass neutral=true to skip color judgment.
function MetricBox({ label, value, unit, color = '#94a3b8', prev = null, lowerIsBetter = false, neutral = false }) {
  // Delta arrow only renders when prev is a real number AND current
  // value is too. Skip when no comparable data exists.
  let delta = null;
  if (typeof prev === 'number' && !isNaN(prev) && typeof value !== 'undefined') {
    const cur = parseFloat(value);
    if (!isNaN(cur) && cur !== prev) {
      const diff = cur - prev;
      // Pick rounding: integers stay integers, decimals get 1 place.
      const fmt = Math.abs(diff) >= 10 ? Math.round(diff) : (Math.round(diff * 10) / 10);
      const isUp = diff > 0;
      const good = neutral ? null
                 : lowerIsBetter ? !isUp
                 : isUp;
      const arrowColor = good == null ? 'var(--text-muted)'
                       : good ? '#4ade80' : '#f87171';
      delta = {
        text: `${isUp ? '↑' : '↓'}${Math.abs(fmt)}`,
        color: arrowColor,
      };
    }
  }
  return (
    <div style={{
      background: `${color}10`,
      border: `0.5px solid ${color}30`,
      borderLeft: `2px solid ${color}`,
      borderRadius: 6, padding: '6px 8px',
      position: 'relative',
    }}>
      {/* Delta indicator — top-right corner, fills what used to be dead space */}
      {delta && (
        <span style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 9, fontWeight: 600,
          color: delta.color, lineHeight: 1,
          letterSpacing: '-0.02em',
        }}>{delta.text}</span>
      )}
      <div style={{
        fontSize: 14, fontWeight: 600, color,
        textAlign: 'right',
        // Phase 4r.calendar.28 — dropped mono from the value because
        // Android WebView renders it fuzzy at 14px. Sans-serif at
        // weight 600 stays crisp. Mono is kept on the delta arrow
        // only (9px, where it still reads cleanly).
        paddingRight: delta ? 24 : 0,
      }}>
        {value}<span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 2, fontWeight: 400 }}>{unit}</span>
      </div>
      <div style={{
        fontSize: 9, color: 'var(--text-muted)', marginTop: 1,
        textTransform: 'uppercase', letterSpacing: '0.04em',
        textAlign: 'right',
      }}>{label}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      color: 'var(--text-muted)', textTransform: 'uppercase',
      marginBottom: 5,
    }}>{children}</div>
  );
}

function EmptyHint({ children }) {
  return (
    <div style={{
      fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
      marginBottom: 12,
    }}>{children}</div>
  );
}

// ── Plan picker modal (Phase 4r.calendar.33) ────────────────────────────────
// Lightweight workout-category picker. Lists Arnold's standard families;
// tapping one saves it to the planner for the selected date.

function PlanPickerModal({ dateStr, onClose, onPick, editing = false, initialType = null, initialDist = '' }) {
  // Phase 0.3 — the option list is DERIVED from planner.DAY_TYPES (the single
  // source), so any discipline added there auto-appears in this picker. This kills
  // the second hardcoded list that caused the "new sports missing from the drawer"
  // miss. Picker-only copy (the one-line descriptions) lives in DESC.
  const DESC = {
    easy_run: 'Z2 aerobic base', long_run: 'Endurance', tempo: 'Threshold work',
    intervals: 'Speed reps', strength: 'Resistance', hiit: 'High intensity',
    mobility: 'Yoga / stretch', cross: 'General cross-train', cycle: 'Bike ride',
    swim: 'Pool / open water', ski: 'Alpine / nordic', walk: 'Walk or hike', rest: 'Recovery day',
  };
  const OPTIONS = DAY_TYPES
    .filter(t => t.id !== 'race') // race is scheduled via the race picker, not here
    .map(t => ({ type: t.id, label: t.label, color: t.color, desc: DESC[t.id] || '' }));
  // Phase 4r.plan.distance — run-family plans accept an optional distance so
  // the calendar can show expected time + so weekly/annual mileage projections
  // can count planned miles. Selecting a run type reveals a distance field;
  // non-run types commit immediately on tap (no distance to capture).
  const RUN_TYPES = new Set(['easy_run', 'long_run', 'tempo', 'intervals']);
  const [selType, setSelType] = useState(RUN_TYPES.has(initialType) ? initialType : null);
  const [dist, setDist] = useState(initialDist != null ? String(initialDist) : '');
  const handlePick = (type) => {
    if (RUN_TYPES.has(type)) {
      setSelType(type);            // stage it; show the distance field
    } else {
      onPick(type, null);          // commit non-run plans immediately
    }
  };
  const confirmRun = () => {
    const mi = parseFloat(dist);
    onPick(selType, Number.isFinite(mi) && mi > 0 ? mi : null);
  };
  const dateLabel = (() => {
    try {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    } catch { return dateStr; }
  })();
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-elevated, #0f1419)',
        border: '0.5px solid var(--border-subtle, rgba(148,163,184,0.20))',
        borderRadius: 12, padding: '14px 16px 16px',
        maxWidth: 360, width: '100%',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{editing ? 'Edit workout' : 'Plan workout'}</div>
            <div style={{ fontSize: 13, color: 'var(--text-primary, #e2e8f0)', marginTop: 2 }}>{dateLabel}</div>
          </div>
          <button onClick={onClose} style={{
            all: 'unset', cursor: 'pointer',
            color: 'var(--text-muted, #94a3b8)', fontSize: 16, padding: '0 6px',
          }}>✕</button>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 6, marginTop: 8,
        }}>
          {OPTIONS.map(o => (
            <button
              key={o.type}
              onClick={() => handlePick(o.type)}
              style={{
                all: 'unset', cursor: 'pointer',
                padding: '8px 10px', borderRadius: 6,
                background: selType === o.type ? `${o.color}33` : `${o.color}1a`,
                border: `${selType === o.type ? 1.5 : 0.5}px solid ${o.color}${selType === o.type ? 'cc' : '44'}`,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: o.color }}>{o.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)' }}>{o.desc}</div>
            </button>
          ))}
        </div>

        {/* Distance + confirm — shown once a run type is staged. Optional:
            confirm with a blank distance to plan the run without one. */}
        {selType && (
          <div style={{
            marginTop: 12, paddingTop: 12,
            borderTop: '0.5px solid var(--border-subtle, rgba(148,163,184,0.20))',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', whiteSpace: 'nowrap' }}>
              Distance
            </label>
            <input
              autoFocus
              type="number"
              inputMode="decimal"
              value={dist}
              onChange={e => setDist(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmRun(); }}
              placeholder="Miles (optional)"
              style={{
                flex: 1, minWidth: 0, fontSize: 13,
                background: 'var(--bg-surface, #0b0f14)', color: 'var(--text-primary, #e2e8f0)',
                border: '0.5px solid var(--border-default, rgba(148,163,184,0.30))',
                borderRadius: 6, padding: '6px 8px',
              }}
            />
            <button onClick={confirmRun} style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: '#60a5fa',
              padding: '6px 12px', borderRadius: 6,
              background: 'rgba(96,165,250,0.15)', border: '0.5px solid rgba(96,165,250,0.4)',
              whiteSpace: 'nowrap',
            }}>{editing ? 'Save' : 'Plan it'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Race picker modal (curated catalog) ─────────────────────────────────────

function RacePickerModal({ dateStr, onClose, onPick }) {
  const [region, setRegion] = useState('all');
  const [distance, setDistance] = useState('all');
  const [query, setQuery] = useState('');
  // Phase 4r.calendar.11 — default to the selected date's month so the
  // picker only shows races that typically run around that time. Avoids
  // showing Chicago in October when the user picked a November date for
  // the NYC Marathon. Toggle off to browse the full year.
  const selectedMonth = (() => {
    try { return new Date(dateStr + 'T12:00:00').getMonth() + 1; } catch { return null; }
  })();
  const [monthFilter, setMonthFilter] = useState(true);
  const monthForFilter = monthFilter ? selectedMonth : null;

  const results = useMemo(
    () => filterCatalog({ region, distance, query, month: monthForFilter }),
    [region, distance, query, monthForFilter]
  );

  const monthName = selectedMonth
    ? new Date(2000, selectedMonth - 1, 1).toLocaleString('en-US', { month: 'long' })
    : null;

  return (
    <ModalShell onClose={onClose} title={`Add race for ${dateStr}`}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <select value={region} onChange={e => setRegion(e.target.value)} style={selectStyle}>
          {REGION_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={distance} onChange={e => setDistance(e.target.value)} style={selectStyle}>
          {DISTANCE_FILTERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search races, cities, countries…"
          style={{ ...inputStyle, flex: 1, minWidth: 160 }}/>
      </div>

      {/* Month-window toggle. Default ON so the picker matches the
          selected date's month exactly (Phase 4r.calendar.16 — tightened
          from ±1 to exact match so each race only shows in its true
          month, not three adjacent ones). */}
      {selectedMonth && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={monthFilter}
              onChange={e => setMonthFilter(e.target.checked)}
              style={{ width: 12, height: 12, cursor: 'pointer' }}/>
            <span>Only show {monthName} races</span>
          </label>
          <span style={{ opacity: 0.6 }}>· uncheck for full year</span>
        </div>
      )}

      {/* Results */}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {results.length === 0 ? (
          <EmptyHint>No races match. Try a different filter or add manually.</EmptyHint>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {results.map(r => (
              <button key={r.id} onClick={() => onPick(r)} style={{
                all: 'unset', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                background: 'rgba(255,255,255,0.02)',
                border: '0.5px solid var(--border-subtle)',
                borderRadius: 4,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {r.name}{r.wmm && <span style={{ fontSize: 9, color: '#fbbf24', marginLeft: 5 }}>WMM</span>}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {r.city}, {r.country} · {distanceLabel(r)}
                  </div>
                </div>
                <span style={{
                  fontSize: 9, color: '#60a5fa',
                  background: 'rgba(96,165,250,0.10)',
                  padding: '2px 6px', borderRadius: 10,
                }}>+ Add</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ── Manual entry modal ──────────────────────────────────────────────────────

function ManualRaceModal({ dateStr, onClose, onAdd }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(dateStr);
  const [distance, setDistance] = useState('');
  const [city, setCity] = useState('');

  const submit = () => {
    if (!name.trim() || !date) return;
    onAdd({
      name: name.trim(),
      date,
      distanceMi: distance ? parseFloat(distance) : null,
      city: city.trim() || null,
    });
  };

  return (
    <ModalShell onClose={onClose} title="Add race manually">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Field label="Race name">
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. RBC Brooklyn Half" style={inputStyle} autoFocus/>
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle}/>
        </Field>
        <Field label="Distance (mi, optional)">
          <input type="number" value={distance} onChange={e => setDistance(e.target.value)}
            placeholder="13.1" step="0.1" style={inputStyle}/>
        </Field>
        <Field label="City (optional)">
          <input value={city} onChange={e => setCity(e.target.value)}
            placeholder="Brooklyn" style={inputStyle}/>
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
          <button onClick={onClose} style={chipBtn}>Cancel</button>
          <button onClick={submit} style={primaryBtn} disabled={!name.trim() || !date}>Add</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── ICS import modal ────────────────────────────────────────────────────────

function IcsImportModal({ existingRaces, onClose, onImported }) {
  const [url, setUrl] = useState(() => localStorage.getItem('arnold:calendar-url') || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const submit = async () => {
    if (!url.trim()) return;
    setBusy(true); setResult(null);
    try {
      const events = await fetchAndParseICS(url.trim());
      localStorage.setItem('arnold:calendar-url', url.trim());
      const byKey = new Map(existingRaces.map(r => [`${r.name}|${r.date}`, r]));
      let added = 0;
      for (const e of events) {
        const key = `${e.name}|${e.date}`;
        if (!byKey.has(key)) { byKey.set(key, e); added++; }
        else byKey.set(key, { ...byKey.get(key), ...e, source: 'garmin-ics' });
      }
      const merged = [...byKey.values()].sort((a,b) => (a.date||'').localeCompare(b.date||''));
      setResult({ ok: true, msg: `Parsed ${events.length} events · ${added} new` });
      onImported(merged);
    } catch (e) {
      setResult({ ok: false, msg: `Could not reach calendar (${e.message}).` });
    } finally { setBusy(false); }
  };

  return (
    <ModalShell onClose={onClose} title="Import races from calendar">
      <Field label="Calendar URL (.ics)">
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://connect.garmin.com/modern/calendar/export/…"
          style={inputStyle}/>
      </Field>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
        Paste any .ics URL — Garmin race calendar, Google Calendar export, RaceRoster feed.
        Arnold parses race-like events and merges them into your races list.
      </div>
      {result && (
        <div style={{
          marginTop: 8, padding: '6px 10px', borderRadius: 4,
          fontSize: 11,
          background: result.ok ? 'rgba(74,222,128,0.10)' : 'rgba(248,113,113,0.10)',
          color: result.ok ? '#4ade80' : '#f87171',
        }}>{result.msg}</div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        <button onClick={onClose} style={chipBtn}>Cancel</button>
        <button onClick={submit} style={primaryBtn} disabled={busy || !url.trim()}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        width: '100%', maxWidth: 520,
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{title}</span>
          <button onClick={onClose} style={{
            all: 'unset', cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)',
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

// Phase 4r.calendar.37 — position: 'relative' is REQUIRED on every button
// that also carries the .arnold-compact-btn className. The class's ::before
// pseudo-element is position: absolute with inset: -3px -8px; without an
// explicit positioned ancestor it walks up the DOM to the viewport and
// becomes a full-screen click absorber. See POSTMORTEMS.md entry
// 2026-05-23 for the full bug chain. The CSS now has `!important` as
// belt-and-suspenders, but we keep position: 'relative' inline here too
// so the intent is visible at the call site.
const iconBtn = {
  all: 'unset', cursor: 'pointer', position: 'relative',
  fontSize: 16, padding: '2px 10px',
  color: 'var(--text-primary)',
  background: 'transparent',
  border: '0.5px solid var(--border-default)',
  borderRadius: 4,
};

const chipBtn = {
  all: 'unset', cursor: 'pointer', position: 'relative',
  fontSize: 11, padding: '4px 10px',
  color: 'var(--text-primary)',
  background: 'transparent',
  border: '0.5px solid var(--border-default)',
  borderRadius: 4,
};

const primaryBtn = {
  all: 'unset', cursor: 'pointer',
  fontSize: 11, fontWeight: 500,
  padding: '4px 10px',
  color: '#60a5fa',
  background: 'rgba(96,165,250,0.10)',
  border: '0.5px solid rgba(96,165,250,0.30)',
  borderRadius: 4,
};

const inputStyle = {
  fontSize: 11, padding: '4px 8px',
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)', borderRadius: 4,
  outline: 'none',
};

const selectStyle = {
  fontSize: 11, padding: '4px 8px',
  background: 'var(--bg-input)', color: 'var(--text-primary)',
  border: '0.5px solid var(--border-default)', borderRadius: 4,
};
