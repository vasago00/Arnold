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
import { PersonSimpleTaiChi } from "@phosphor-icons/react";
import { useSwipeNav } from "./MobileHome.jsx";
import { storage } from "../core/storage.js";
import { getRaces, saveRaces } from "../core/memory.js";
import { allActivities as getUnifiedActivities } from "../core/dcyMath.js";
import { isRun, isStrength, isHIIT, isMobility, isCycling, isSwim } from "../core/activityClass.js";
import { getPlannerWeek, savePlannerWeek, weekKey } from "../core/planner.js";
import { fetchAndParseICS } from "../core/parsers/icsParser.js";
import { dailyTotals as nutDailyTotals } from "../core/nutrition.js";
import { resolveCalorieTarget } from "../core/calorieTarget.js";
import { getGoals } from "../core/goals.js";
import {
  RACE_CATALOG, REGION_OPTIONS, DISTANCE_FILTERS,
  filterCatalog, defaultDateForRace, distanceLabel,
} from "../core/raceCatalog.js";
import { localDate, ymd } from "../core/time.js";

// Activity family → color + icon glyph (Tabler-ish unicode for inline use).
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
function activityFamily(a) {
  if (!a) return 'rest';
  if (isHIIT(a))     return 'hiit';
  if (isMobility(a)) return 'mobility';
  if (isStrength(a)) return 'strength';
  if (isRun(a)) {
    const mi = Number(a.distanceMi) || 0;
    if (mi >= 13) return 'long_run';
    return 'run';
  }
  if (isCycling(a) || isSwim(a)) return 'cross';
  return 'rest';
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
  const [manualOpen, setManualOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  const [planPickerOpen, setPlanPickerOpen] = useState(false);  // Phase 4r.calendar.33
  const [tick, setTick] = useState(0);

  // Load races on mount and after any add/remove.
  useEffect(() => {
    getRaces().then(setRaces).catch(() => setRaces([]));
  }, [tick]);

  const activities = useMemo(() => getUnifiedActivities(), [tick]);
  const todayStr   = localDate();

  // Phase 4r.calendar.4 — daily goals + sleep + nutrition for the
  // 3-domain (Act / Fuel / Body) strip in each tile.
  const goals       = useMemo(() => getGoals(), [tick]);
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

      {/* Phase 4r.calendar.13 — responsive 2-column layout on wide
          screens (grid left, day drawer right). Phase 4r.calendar.14
          — when the drawer is collapsed (toggled off via re-click or
          the X button), the calendar grid expands to fill the full
          width. Phase 4r.calendar.20 — on mobile (≤600px) the grid
          always renders full-width and the drawer becomes a
          slide-up bottom sheet overlay rendered below. */}
      <div
        {...(isMobile ? swipeHandlers : {})}
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
        <MonthGrid
          cells={cells}
          todayStr={todayStr}
          selectedDate={selectedDate}
          activitiesByDate={activitiesByDate}
          plannerByDate={plannerByDate}
          racesByDate={racesByDate}
          sleepByDate={sleepByDate}
          hrvByDate={hrvByDate}
          goals={goals}
          isMobile={isMobile}
          onPickDate={handlePickDate}
        />
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
              dateStr={selectedDate}
              activities={activitiesByDate.get(selectedDate) || []}
              planned={plannerByDate.get(selectedDate) || null}
              races={racesByDate.get(selectedDate) || []}
              onClose={() => setDrawerOpen(false)}
              onAddRace={() => setPickerOpen(true)}
              onAddPlan={() => setPlanPickerOpen(true)}
              onManualAdd={() => setManualOpen(true)}
              onIcsImport={() => setIcsOpen(true)}
              onDeleteRace={(id) => {
                const next = races.filter(r => r.id !== id);
                saveRaces(next).then(() => { setRaces(next); showToast?.('Race removed'); });
              }}
            />
          </div>
        )}
      </div>

      {/* Phase 4r.calendar.25 — mobile drawer is always-open and
          inline below the grid. No modal, no backdrop, no animation.
          Tapping a different day just updates drawer content.
          Default selection is today (set in CalendarTab init). */}
      {isMobile && (
        <div style={{ marginTop: 0, paddingBottom: 112 }}>
          <DayDrawer
            dateStr={selectedDate}
            activities={activitiesByDate.get(selectedDate) || []}
            planned={plannerByDate.get(selectedDate) || null}
            races={racesByDate.get(selectedDate) || []}
            onAddRace={() => setPickerOpen(true)}
            onAddPlan={() => setPlanPickerOpen(true)}
            onManualAdd={() => setManualOpen(true)}
            onIcsImport={() => setIcsOpen(true)}
            onDeleteRace={(id) => {
              const next = races.filter(r => r.id !== id);
              saveRaces(next).then(() => { setRaces(next); showToast?.('Race removed'); });
            }}
          />
        </div>
      )}

      {planPickerOpen && (
        <PlanPickerModal
          dateStr={selectedDate}
          onClose={() => setPlanPickerOpen(false)}
          onPick={(type) => {
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
                days[idx] = { ...(days[idx] || {}), type };
                savePlannerWeek(wk, { ...week, days });
              }
            } catch (e) { console.warn('[calendar] plan save failed:', e); }
            setPlanPickerOpen(false);
            setTick(t => t + 1);
            showToast?.(`Planned ${prettyFamily(type)}`);
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

function MonthGrid({ cells, todayStr, selectedDate, activitiesByDate, plannerByDate, racesByDate, sleepByDate, hrvByDate, goals, isMobile, onPickDate }) {
  const TileComponent = isMobile ? MobileDayTile : DayTile;
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
        {cells.map(cell => (
          <div key={cell.date} style={{
            flex: '0 0 calc((100% - 12px) / 7)',
            minWidth: 0,
            boxSizing: 'border-box',
          }}>
            <TileComponent cell={cell}
              isToday={cell.date === todayStr}
              isSelected={cell.date === selectedDate}
              completed={activitiesByDate.get(cell.date) || []}
              planned={plannerByDate.get(cell.date)}
              races={racesByDate.get(cell.date) || []}
              sleep={sleepByDate.get(cell.date)}
              hrv={hrvByDate.get(cell.date)}
              goals={goals}
              onPick={() => onPickDate(cell.date)}
            />
          </div>
        ))}
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
};

// Session-signature PNG path per family (Phase 4r.calendar.5).
// Mirrors the SIGNATURE_SRC map in PlannedWorkoutTile.jsx but kept local
// so the calendar can use the same imagery as the Performance card.
// Phase 4r.calendar.8 — `run` now uses easy-run.png (run.png doesn't
// exist on disk; the canonical generic-run image is easy-run.png).
const SIG_VERSION = 'v11';
const SIG_FILE = {
  run: 'easy-run.png', long_run: 'easy-run.png', easy_run: 'easy-run.png',
  tempo: 'tempo.png', intervals: 'speed.png', speed_run: 'speed.png',
  ski: 'ski.png',
  hiit: 'hiit.png', strength: 'strength.png',
  mobility: 'mobility.png', cross: 'cross.png',
  race: 'race.png',
};
function sigSrc(family) {
  const f = SIG_FILE[family] || SIG_FILE.easy_run;
  return `/session-signatures/${f}?${SIG_VERSION}`;
}

// Phase 4r.calendar.18 — per-family visual scale boost so mobility and
// race figures (which sit smaller inside their PNG canvases due to the
// figure pose, not framing) appear the same on-screen size as the
// upright running figures. Applied as a CSS transform on the <img>.
const SIG_SCALE = {
  mobility: 1.22,
  race:     1.18,
  // everything else = 1.0
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

// Phase 4r.calendar.3 — richer tile design. Each day shows up to three
// activity rows (family-colored stripe + short label + metric) so the
// month grid reads as the user's training journey rather than a sparse
// scatter of single numbers.
// Phase 4r.calendar.4 — bottom strip now carries the three-domain
// summary (Activity / Fuel / Body) that Arnold tracks throughout the
// app, mirroring the daily score's composition on every calendar cell.
function DayTile({ cell, isToday, isSelected, completed, planned, races, sleep, hrv, goals, onPick }) {
  const hasRace = races.length > 0;
  const hasCompleted = completed.length > 0;
  const isPlannedOnly = !hasRace && !hasCompleted && planned && planned.type && planned.type !== 'rest';

  // Dominant family for tile coloring (race > completed > planned > rest).
  let family = 'rest';
  if (hasRace) family = 'race';
  else if (hasCompleted) family = activityFamily(completed[0]);
  else if (isPlannedOnly) family = planned.type;
  const style = FAMILY_STYLE[family] || FAMILY_STYLE.rest;

  // Day totals for the activity strip cell.
  const totalMi   = completed.reduce((s, a) => s + (Number(a.distanceMi) || 0), 0);
  const totalSecs = completed.reduce((s, a) => s + (Number(a.durationSecs) || 0), 0);
  const totalLoad = completed.reduce((s, a) => s + estActivityLoad(a), 0);

  // Fuel — pull daily nutrition totals + compare to calorie target.
  // Show calorie target hit %; null when nothing was logged.
  const nut = (() => {
    try { return nutDailyTotals(cell.date); } catch { return null; }
  })();
  // Phase 4r.fuel.1 — dynamic per-day target (RMR + activity + NEAT + TEF)
  const calTarget = resolveCalorieTarget(cell.date, goals);
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

  const tileBg = (hasCompleted || hasRace) ? style.bg : 'transparent';
  const tileBorder = isSelected ? 'var(--accent-border)'
                   : (hasCompleted || hasRace || isPlannedOnly) ? style.border
                   : 'var(--border-subtle)';
  const borderStyle = isPlannedOnly && !hasCompleted && !hasRace ? 'dashed' : 'solid';

  // Phase 4r.calendar.5 — central session-signature image. Uses the
  // existing PNG signatures from /public/session-signatures/. Image
  // dominates the middle of the tile so the family is readable at a
  // glance without straining to parse text rows.
  const sigImg = (hasRace || hasCompleted || isPlannedOnly) ? sigSrc(family) : null;

  // Phase 4r.calendar.8 — single source of truth for family label so
  // the top-right tag matches whether the day is completed, planned, or
  // a race. Always uses the FAMILY_SHORT short form (RUN, LIFT, MOB,
  // HIIT, RACE) rather than mixing "MOB" with "MOBILITY".
  let headline = null;
  if (hasRace) {
    headline = (races[0].name || 'RACE');
  } else if (hasCompleted) {
    headline = (FAMILY_SHORT[family] || family).toUpperCase();
  } else if (isPlannedOnly) {
    const plannedFam = planned.type === 'easy_run' ? 'run'
                     : planned.type === 'long_run' ? 'long_run'
                     : planned.type === 'intervals' ? 'intervals'
                     : planned.type === 'tempo' ? 'tempo'
                     : planned.type === 'race' ? 'race'
                     : planned.type;
    headline = (FAMILY_SHORT[plannedFam] || plannedFam).toUpperCase();
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
        border: `${isSelected ? '1.5px' : '0.5px'} ${borderStyle} ${tileBorder}`,
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
          fontSize: isToday ? 14 : 12,
          fontWeight: isToday ? 700 : 600,
          color: isToday ? 'var(--accent-border)' : (cell.inMonth ? 'var(--text-primary)' : 'var(--text-muted)'),
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
            fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
            color: style.color,
            textTransform: 'uppercase',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            opacity: isPlannedOnly ? 0.6 : 1,
          }}>{headline}</span>
        ) : null}
      </div>

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
        <div style={{
          height: '90%', aspectRatio: '1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isPlannedOnly && !hasCompleted ? 0.45 : 1,
        }}>
          {sigImg ? (
            <img src={sigImg} alt={family}
              style={{
                width: '100%', height: '100%',
                objectFit: 'contain', display: 'block',
                // Phase 4r.calendar.18 — visual-size normalization. The
                // mobility/race PNGs have more whitespace around the
                // figure than upright runners, so they look ~20% smaller
                // at the same container size. SIG_SCALE counter-acts
                // that so every day reads the same.
                transform: `scale(${SIG_SCALE[family] || 1})`,
                transformOrigin: 'center',
              }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
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

        {/* Right rail: absolute-positioned so it doesn't compress the
            image. Only renders for 2+ activities.
            Phase 4r.calendar.18 — borderLeft removed (the visible
            vertical line user flagged). Mobility now renders as the
            shared Stretch SVG (matches mobile Start screen). Other
            secondary activities still show the family-colored dot +
            short label since we don't have icon parity for them yet. */}
        {hasCompleted && completed.length > 1 && (
          <div style={{
            position: 'absolute',
            right: 0, top: 0, bottom: 0,
            display: 'flex', flexDirection: 'column',
            gap: 3, paddingLeft: 2,
            alignItems: 'flex-end', justifyContent: 'center',
          }}>
            {completed.slice(1, 4).map((a, i) => {
              const fam = activityFamily(a);
              const c = FAMILY_STYLE[fam] || FAMILY_STYLE.rest;
              // Mobility gets the dedicated reaching-up figure SVG.
              if (fam === 'mobility') {
                return (
                  <div key={i} title="Mobility done" style={{
                    display: 'flex', alignItems: 'center', lineHeight: 1,
                  }}>
                    <MobilityDoneIcon size={14} color={c.color}/>
                  </div>
                );
              }
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 2, lineHeight: 1,
                }}>
                  <span style={{
                    width: 2, height: 8, background: c.color, borderRadius: 1,
                  }}/>
                  <span style={{
                    fontSize: 7, fontWeight: 700, letterSpacing: '0.04em',
                    color: c.color, textTransform: 'uppercase',
                  }}>{(FAMILY_SHORT[fam] || fam).slice(0, 3)}</span>
                </div>
              );
            })}
            {completed.length > 4 && (
              <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>+{completed.length - 4}</span>
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
function MobileDayTile({ cell, isToday, isSelected, completed, planned, races, onPick }) {
  const hasRace = races.length > 0;
  const hasCompleted = completed.length > 0;
  const isPlannedOnly = !hasRace && !hasCompleted && planned && planned.type && planned.type !== 'rest';

  let family = 'rest';
  if (hasRace) family = 'race';
  else if (hasCompleted) family = activityFamily(completed[0]);
  else if (isPlannedOnly) family = planned.type;
  const style = FAMILY_STYLE[family] || FAMILY_STYLE.rest;

  // Secondary mobility indicator — same trigger as desktop tile.
  const hasMobilitySecondary = hasCompleted && completed.length > 1 &&
    completed.slice(1).some(a => activityFamily(a) === 'mobility');

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
  const headlineMetric = hasCompleted
    ? (totalMi >= 0.5 ? `${totalMi.toFixed(1)}mi` : totalSecs >= 60 ? `${Math.round(totalSecs / 60)}m` : null)
    : null;

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

  return (
    <button onClick={onPick}
      className="arnold-compact-btn arnold-cal-cell"
      style={{
        all: 'unset', cursor: 'pointer',
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

      {/* Signature image centered. SIG_SCALE keeps mobility/race
          visually matched in size to the upright runners. */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: 0,
        opacity: isPlannedOnly && !hasCompleted ? 0.55 : 1,
      }}>
        {sigImg && (
          <img src={sigImg} alt={family}
            style={{
              maxWidth: '100%', maxHeight: '100%',
              objectFit: 'contain', display: 'block',
              transform: `scale(${SIG_SCALE[family] || 1})`,
              transformOrigin: 'center',
            }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* Bottom row: headline metric (mileage or minutes). Phase
          4r.calendar.22 — bumped to 9px and given a clearer prefix
          arrow so users can tell the value represents the day's
          total at a glance. Renders only when there's data. */}
      {headlineMetric && (
        <div style={{
          fontSize: 9, fontWeight: 600, color: style.color,
          textAlign: 'center', lineHeight: 1, marginTop: 1,
          letterSpacing: '-0.02em',
        }}>{headlineMetric}</div>
      )}

      {/* Mobility-done indicator — bottom-right (uses the same
          PersonSimpleTaiChi glyph as the desktop secondary rail). */}
      {hasMobilitySecondary && (
        <span style={{
          position: 'absolute', bottom: 1, right: 2, zIndex: 2,
          display: 'flex', lineHeight: 1,
        }}>
          <MobilityDoneIcon size={10} color="#5eead4"/>
        </span>
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

function DayDrawer({ dateStr, activities, planned, races, onAddRace, onAddPlan, onManualAdd, onIcsImport, onDeleteRace, onClose }) {
  const d = new Date(dateStr + 'T12:00:00');
  const dateLabel = d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  // Phase 4r.calendar.24 — strictly-past dates hide the race-add
  // buttons (adding races to days that already happened is
  // irrelevant). Compare local-date strings, not Date objects, to
  // dodge timezone drift.
  const isPast = dateStr < localDate();

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
  const weightForDate = allWeights.find(w => w.date === dateStr) || null;
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

  // Phase 4r.calendar.30 — fueling targets. Calories from goals; macro
  // targets either from goals (if set) or derived from total calories
  // using a balanced default split: 30% protein, 45% carbs, 25% fat.
  const goals = getGoals?.() || {};
  // Phase 4r.fuel.1 — dynamic per-day target (RMR + activity + NEAT + TEF)
  const calTarget = resolveCalorieTarget(dateStr, goals);
  const proTarget = parseFloat(goals.dailyProteinTarget) || Math.round(calTarget * 0.30 / 4);
  const carbTarget = parseFloat(goals.dailyCarbTarget)    || Math.round(calTarget * 0.45 / 4);
  const fatTarget  = parseFloat(goals.dailyFatTarget)     || Math.round(calTarget * 0.25 / 9);

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '0.5px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      // Phase 4r.calendar.29 — contour-less inside, but keep the
      // outer panel border so the drawer reads as one unit. Stable
      // min-height so the panel doesn't jump as the user picks
      // different days with varying amounts of data.
      padding: '10px 14px',
      marginBottom: 8,
      minHeight: 280,
    }}>
      {/* Header: date label (left) + race pill OR +Add race (right) +
          optional close button. Phase 4r.calendar.29 — no border-bottom
          to keep the contour-less look. */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 8, marginBottom: 10,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{dateLabel}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {races.length > 0 && races[0].distanceMi
              ? `${distanceLabel(races[0])}${races[0].city ? ` · ${races[0].city}` : ''}`
              : planned?.type && planned.type !== 'rest'
                ? `Planned: ${prettyFamily(planned.type)}`
                : 'No plan'}
          </div>
        </div>
        {/* Phase 4r.calendar.29 — top-right slot: race pill if scheduled,
            otherwise + Add race button (hidden on past dates per
            4r.calendar.24). Manual entry + ICS sync removed from
            drawer entirely. */}
        {races.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{
              background: 'rgba(239,68,68,0.15)', color: '#ef4444',
              fontSize: 10, fontWeight: 600,
              padding: '3px 10px', borderRadius: 999,
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>★ {races[0].name}</span>
            {onDeleteRace && (
              <button onClick={() => onDeleteRace(races[0].id)} style={{
                all: 'unset', cursor: 'pointer', fontSize: 11,
                color: '#f87171', padding: '0 4px',
              }} title="Remove race">✕</button>
            )}
          </div>
        ) : !isPast ? (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            {/* Phase 4r.calendar.33 — +Plan opens the workout picker. */}
            {onAddPlan && (
              <button onClick={onAddPlan} className="arnold-compact-btn" style={{
                all: 'unset', cursor: 'pointer',
                fontSize: 11, fontWeight: 500,
                padding: '3px 10px', borderRadius: 999,
                color: '#a78bfa',
                background: 'rgba(167,139,250,0.10)',
                border: '0.5px solid rgba(167,139,250,0.30)',
              }}>+ Plan</button>
            )}
            {onAddRace && (
              <button onClick={onAddRace} className="arnold-compact-btn" style={{
                all: 'unset', cursor: 'pointer',
                fontSize: 11, fontWeight: 500,
                padding: '3px 10px', borderRadius: 999,
                color: '#60a5fa',
                background: 'rgba(96,165,250,0.10)',
                border: '0.5px solid rgba(96,165,250,0.30)',
              }}>+ Add race</button>
            )}
          </div>
        ) : null}
        {onClose && (
          <button onClick={onClose} title="Close detail panel" style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 14, lineHeight: 1, padding: '2px 6px',
            color: 'var(--text-muted)', flexShrink: 0,
            borderRadius: 4,
          }}>✕</button>
        )}
      </div>

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

function PlanPickerModal({ dateStr, onClose, onPick }) {
  const OPTIONS = [
    { type: 'easy_run',  label: 'Easy run',  color: '#60a5fa', desc: 'Z2 aerobic base' },
    { type: 'long_run',  label: 'Long run',  color: '#60a5fa', desc: 'Endurance' },
    { type: 'tempo',     label: 'Tempo',     color: '#fbbf24', desc: 'Threshold work' },
    { type: 'intervals', label: 'Intervals', color: '#fbbf24', desc: 'Speed reps' },
    { type: 'hiit',      label: 'HIIT',      color: '#fb7185', desc: 'High intensity' },
    { type: 'strength',  label: 'Strength',  color: '#a78bfa', desc: 'Resistance' },
    { type: 'mobility',  label: 'Mobility',  color: '#5eead4', desc: 'Yoga / stretch' },
    { type: 'cross',     label: 'Cross',     color: '#22d3ee', desc: 'Cycle / swim' },
    { type: 'rest',      label: 'Rest',      color: '#94a3b8', desc: 'Recovery day' },
  ];
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
            <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Plan workout</div>
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
              onClick={() => onPick(o.type)}
              style={{
                all: 'unset', cursor: 'pointer',
                padding: '8px 10px', borderRadius: 6,
                background: `${o.color}1a`,
                border: `0.5px solid ${o.color}44`,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, color: o.color }}>{o.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted, #94a3b8)' }}>{o.desc}</div>
            </button>
          ))}
        </div>
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

const iconBtn = {
  all: 'unset', cursor: 'pointer',
  fontSize: 16, padding: '2px 10px',
  color: 'var(--text-primary)',
  background: 'transparent',
  border: '0.5px solid var(--border-default)',
  borderRadius: 4,
};

const chipBtn = {
  all: 'unset', cursor: 'pointer',
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
