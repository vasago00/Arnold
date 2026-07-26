// planWeekSummary (Sprint 3, Task #32) — a compact glance at the CURRENT week of
// the living plan, for the mobile home summary strip. Reads the APPLIED planner
// week (what LivingPlan pasted onto the calendar) so the strip stays in sync with
// the calendar — it does NOT re-generate a plan.
//
// Returns the week's day-by-day "headline" session (its shape), the planned
// totals, and the next KEY session (long run / quality / race) from today
// forward — the one piece neither the "This Week" (actual volume) nor the
// "Marathon Coach" (verdict/targets) card already shows.
//
// Pure aside from the planner storage read (via getPlannerWeek). Node-testable
// by seeding storage; the strip component is dumb presentation on top.

import {
  getPlannerWeek, weekKey, nextWeekKey, daySessions, weekPlanTotals, DAY_LABELS,
} from './planner.js';
import { storage } from './storage.js';
import { allActivities, canonicalActivityType } from './dcyMath.js';
// activityClass is THE classification contract (isRun/isHIIT/isStrength/…) and it
// is a pure module — no imports, no storage — so it is safe to pull in statically.
import {
  isRun, isHIIT, isStrengthVolume, isCycling, isSwim, isSki, isWalk, isMobility,
} from './activityClass.js';

// Which logged modality actually SATISFIES a planned day. A planned tempo is
// "done" only if you RAN — not if you lifted that day. This is the per-modality
// honesty the flat "any run or strength" flag lacked. Recovery types
// (rest/mobility/walk) are intentionally absent — they're never "missed" and
// don't require a match. `cross` accepts any non-run cardio.
//
// intervals/hiit accept BOTH 'run' and 'hiit'. Emil's Garmin stamps a Fartlek or
// a HYROX session as activityType 'HIIT', which classifies as hiit — a planned
// interval session satisfied by a logged HIIT session was reading MISSED even
// though isRun() calls the very same activity a run everywhere else.
//
// race accepts ANY logged session (the '*' sentinel). A race day is satisfied by
// showing up; hard-coding ['run'] meant a cycling, swim or ski race — or a
// marathon whose file came back tagged HIIT — was permanently missed.
const ANY = '*';
const PLAN_TO_CANON = {
  easy_run: ['run'], long_run: ['run'], tempo: ['run'],
  intervals: ['run', 'hiit'], hiit: ['run', 'hiit'], race: [ANY],
  strength: ['strength'],
  cycle: ['cycling'], swim: ['swim'], ski: ['ski'],
  cross: ['cycling', 'swim', 'ski', 'hiit', 'row', 'rowing', 'elliptical', 'cross'],
};

// The modes a single logged activity satisfies, decided by the SAME predicates
// every other surface uses. Deliberately NOT one-of: the contract at the top of
// activityClass.js says a HIIT session with distance passes both isHIIT() and
// isRun(), and a HYROX session is both hiit and strength volume. An activity that
// genuinely covers two planned modalities should credit both — the alternative is
// the old behaviour, where dcyMath's canonicalActivityType() (written for DEDUP,
// not for classification) returned one string and quietly disagreed with isRun().
export function modesForActivity(a) {
  const out = new Set();
  if (!a) return out;
  if (isMobility(a)) { out.add('mobility'); return out; }   // mobility is exclusive
  if (isRun(a))           out.add('run');
  if (isHIIT(a))          out.add('hiit');
  if (isStrengthVolume(a)) out.add('strength');
  if (isCycling(a))       out.add('cycling');
  if (isSwim(a))          out.add('swim');
  if (isSki(a))           out.add('ski');
  if (isWalk(a))          out.add('walk');
  // Nothing matched — fall back to the canonical string so an exotic type still
  // lands somewhere rather than vanishing.
  if (!out.size) out.add(canonicalActivityType(a.activityType || a.title));
  return out;
}

// Recovery days = rest OR mobility (athlete's choice, per the plan's unified
// "Recovery" model). They're flexible: skipping one (resting) is a valid choice,
// so they are NEVER "missed"; only a real RUN/strength on one reads as off-plan.
const RECOVERY_TYPES = new Set(['rest', 'mobility', 'walk', 'recovery']);

// Monday-anchored week start + day offset → ISO date (noon-safe, matches how the
// planner and GoalsHub derive planner-day dates).
function addDaysISO(iso, n) {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The day's single "headline" session — the hardest/most defining one, so the
// strip shows one glyph per day. Priority: race > long > intervals/hiit > tempo >
// easy > strength-only > recovery.
const HEADLINE_PRIORITY = [
  'race', 'long_run', 'intervals', 'hiit', 'tempo',
  'easy_run', 'cross', 'cycle', 'swim', 'ski', 'strength', 'mobility', 'walk',
];

export function dayHeadline(day) {
  const types = daySessions(day).map(s => s.type);
  if (!types.length) return 'rest';
  for (const t of HEADLINE_PRIORITY) if (types.includes(t)) return t;
  return types[0];
}

// Sessions that count as a "key" session worth surfacing as next-up.
const KEY_TYPES = new Set(['long_run', 'tempo', 'intervals', 'hiit', 'race']);

// Monday-anchored day index for a date (Mon=0 … Sun=6).
function dowIndex(date) {
  const d = date.getDay();
  return d === 0 ? 6 : d - 1;
}

function findKey(days, fromIdx) {
  for (let i = fromIdx; i < 7; i++) {
    const key = daySessions(days[i]).find(s => KEY_TYPES.has(s.type));
    if (key) return { idx: i, session: key };
  }
  return null;
}

// PURE core — takes the two week objects + today's Monday-index and returns the
// summary. No storage/DOM, so it's node-testable by passing plain week records.
// `executedDates` (Set/array of ISO dates with a logged activity) drives per-day
// status: done / missed / off-plan.
export function buildPlanWeekSummary({ week, nextWeek = null, todayIdx = 0, weekStart = null, executedDates = [], executedMi = {}, executedModes = null }) {
  const rawDays = (week?.days || []).slice(0, 7);
  // `todayIdx` is where TODAY falls inside THIS week, and it is deliberately NOT clamped into
  // 0..6 any more. It used to be, which quietly made this function unable to describe any week
  // except the current one:
  //
  //   • a FUTURE week (todayIdx < 0) had Monday pinned to `tIdx = 0`, so Monday read "today" and
  //     — combined with a caller passing a different week's days — earlier positions read `isPast`
  //     and came back **missed**. That is Emil's "I still see misses across all surfaces": a block
  //     generated on a Saturday starts next Monday and was being marked missed before it existed.
  //   • a PAST week (todayIdx > 6) had Sunday pinned to `tIdx = 6`, so Sunday read "today" and a
  //     genuinely skipped Sunday long run could never be marked missed at all.
  //
  // Out of range now means what it says: below 0, the whole week is ahead of us; above 6, the
  // whole week is behind us. `isToday` can then legitimately be true for no day at all.
  const tIdx = Number.isFinite(todayIdx) ? Math.trunc(todayIdx) : 0;
  const execSet = executedDates instanceof Set ? executedDates : new Set(executedDates || []);
  const execMi = (executedMi && typeof executedMi === 'object') ? executedMi : {};
  // Per-date executed modalities: { iso: Set<canonType> }. When present, done/
  // missed is decided by whether the PLANNED modality was actually trained;
  // when absent (older callers / the pure tests) we fall back to the flat
  // "any run or strength" flag so the contract is unchanged.
  const execModes = (executedModes && typeof executedModes === 'object') ? executedModes : null;

  const days = rawDays.map((d, i) => {
    const type = dayHeadline(d);
    const isToday = i === tIdx, isPast = i < tIdx;
    const iso = weekStart ? addDaysISO(weekStart, i) : null;
    const modeSet = (iso && execModes) ? execModes[iso] : null;
    // `executed` — did the athlete train (run/strength) at all that day? Drives
    // off-plan detection on recovery days. `executedPlanned` — did they do the
    // specific modality this day called for? Drives done/missed on load days.
    let executed, executedPlanned;
    if (modeSet) {
      executed = modeSet.has('run') || modeSet.has('strength');
      const accept = PLAN_TO_CANON[type];
      executedPlanned = accept
        ? (accept[0] === ANY ? modeSet.size > 0 : accept.some(c => modeSet.has(c)))
        : executed;
    } else {
      executed = iso ? execSet.has(iso) : false;
      executedPlanned = executed;
    }
    // The ACTUAL run miles logged that day (so the plan reflects "you ran 7.5"
    // vs the planned 6). Sourced ONLY from real logged miles — planned mileage
    // is NEVER credited as actual when nothing was run (actualMi stays null).
    const actualMi = (iso && execMi[iso] != null) ? Math.round(Number(execMi[iso]) * 10) / 10 : null;
    const isRecovery = RECOVERY_TYPES.has(type);
    // status: today (ring, nothing logged yet) · done (executed the planned
    // modality, INCLUDING today the moment you log it) · missed (past LOAD day,
    // planned modality not trained) · offplan (recovery day but a run/strength
    // was logged) · rest (recovery, flexible — never "missed") · upcoming.
    let status;
    if (isToday) {
      if (isRecovery) status = executed ? 'offplan' : 'today';
      else status = executedPlanned ? 'done' : 'today';   // today flips to done when the planned work is logged
    }
    else if (!isPast) status = isRecovery ? 'rest' : 'upcoming';
    else if (isRecovery) status = executed ? 'offplan' : 'rest';   // recovery is optional
    else status = executedPlanned ? 'done' : 'missed';             // load day: needs the planned modality
    return { idx: i, label: DAY_LABELS[i], type, isToday, isPast, executed, actualMi, status };
  });

  const totals = weekPlanTotals(week || {});
  const hasPlan = totals.sessions > 0;

  // Next KEY session: today forward this week, then roll into next week.
  let nextKey = null;
  // Scan from today, or from Monday when the whole week is still ahead. A fully-past week
  // (tIdx > 6) finds nothing and correctly rolls into nextWeek below.
  const hit = findKey(rawDays, Math.max(0, tIdx));
  if (hit) {
    nextKey = {
      type: hit.session.type,
      dow: DAY_LABELS[hit.idx],
      distanceMi: Number(hit.session.distanceMi) || null,
      when: hit.idx === tIdx ? 'today' : 'this-week',
    };
  } else if (nextWeek) {
    const nHit = findKey((nextWeek.days || []).slice(0, 7), 0);
    if (nHit) {
      nextKey = {
        type: nHit.session.type,
        dow: DAY_LABELS[nHit.idx],
        distanceMi: Number(nHit.session.distanceMi) || null,
        when: 'next-week',
      };
    }
  }

  return { weekStart, days, totals, hasPlan, nextKey };
}

// Storage wrapper — reads the applied planner weeks and delegates to the pure core.
//
// TWO dates, and keeping them apart is the whole point of the second parameter:
//   `date` — WHICH WEEK to summarize (any day inside it).
//   `now`  — WHEN IT IS. Defaults to the real clock, injectable for tests.
//
// They used to be the same value, which meant this function could only ever describe the
// current week. Callers that wanted a different week — LivingPlan renders `block.weeks[0]`,
// which after a Saturday generate is NEXT Monday's week — got this week's statuses handed back
// and applied positionally to a different week's days. Days that had not happened yet came back
// **missed**. Emil: "I still see misses across all surfaces."
//
// With them separate, todayIdx is today's position RELATIVE TO THE WEEK ASKED FOR: negative when
// that week is still ahead (nothing can be missed yet), 0..6 inside the current week, and 7 or
// more when the week is fully behind us (its Sunday can finally be judged).
export function summarizePlanWeek(date = new Date(), now = null) {
  const d0 = date instanceof Date ? date : new Date(date);
  const nowD = now == null ? new Date() : (now instanceof Date ? now : new Date(now));
  const wkStart = weekKey(d0);
  const nowWkStart = weekKey(nowD);
  // Whole weeks between the requested week and the current one, then today's offset inside it.
  // Computed on the noon-safe ISO ladder rather than by dividing epoch millis, so a DST change
  // between the two weeks cannot shift the answer by a day (Europe's 25 Oct change falls inside
  // Emil's block). Bounded so a corrupt week key can't spin.
  let weeksAhead = 0;
  if (wkStart !== nowWkStart) {
    const forward = wkStart > nowWkStart;   // ISO dates compare lexicographically
    let cursor = forward ? nowWkStart : wkStart, n = 0;
    const stop = forward ? wkStart : nowWkStart;
    while (cursor < stop && n < 520) { cursor = addDaysISO(cursor, 7); n++; }
    weeksAhead = forward ? n : -n;
  }
  const exec = executedForWeek(wkStart);
  return buildPlanWeekSummary({
    week: getPlannerWeek(wkStart),
    nextWeek: getPlannerWeek(nextWeekKey(d0)),
    // -7 per week ahead pushes every day of a future week past `isToday`/`isPast`; +7 per week
    // behind pushes every day of a past week into `isPast`, where it can be judged.
    todayIdx: dowIndex(nowD) - weeksAhead * 7,
    weekStart: wkStart,
    executedDates: exec.set,
    executedMi: exec.mi,
    executedModes: exec.modes,
  });
}

// What was actually trained this week (Mon..Sun), read from the ONE unified
// activity universe (dcyMath.allActivities — CSV + FIT-in-dailyLogs, deduped)
// so a run logged only as a FIT attachment isn't invisible here and marked
// "missed". Returns, per ISO date:
//   • modes — Set of modes actually done that day (run/hiit/strength/cycling/
//     swim/ski/walk/mobility), per modesForActivity(), for done/missed matching.
//     One activity can contribute several — a HYROX is both hiit and strength.
//   • mi    — SUMMED run miles (so the plan can show what was actually run)
//   • set   — flat "a run or strength happened" set (back-compat / off-plan)
// Strength sessions also come from the workouts store (they don't always land
// in the activity universe). Best-effort — never throws.
function executedForWeek(weekStart) {
  const modes = {};
  const mi = {};
  const weekDates = new Set(Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)));
  const add = (iso, mode) => { (modes[iso] || (modes[iso] = new Set())).add(mode); };
  try {
    for (const a of (allActivities() || [])) {
      if (!a?.date || !weekDates.has(a.date)) continue;
      for (const mode of modesForActivity(a)) add(a.date, mode);
      // Miles are gated on isRun() — the SAME predicate planAdherence.js:63 uses
      // to total the week. The strip and the adherence engine now agree by
      // construction instead of by coincidence.
      if (isRun(a)) {
        const m = Number(a.distanceMi ?? a.distance_mi ?? a.miles) || 0;
        if (m > 0) mi[a.date] = (mi[a.date] || 0) + m;
      }
    }
  } catch { /* ignore */ }
  try {
    for (const w of (storage.get('workouts') || [])) {
      if (w?.date && weekDates.has(w.date)) add(w.date, 'strength');
    }
  } catch { /* ignore */ }
  // Flat set = any run/strength that day (mobility/walk/cycle alone don't count
  // as "trained" for off-plan purposes — matching the prior behavior).
  const set = new Set(
    Object.keys(modes).filter(iso => modes[iso].has('run') || modes[iso].has('strength'))
  );
  return { set, mi, modes };
}

// A short human label for the next-key session, e.g. "Sat · 18 mi long run".
const KEY_LABEL = {
  long_run: 'long run', tempo: 'tempo', intervals: 'intervals', hiit: 'HIIT', race: 'race',
};
export function nextKeyLabel(nextKey) {
  if (!nextKey) return null;
  const name = KEY_LABEL[nextKey.type] || nextKey.type;
  const mi = nextKey.distanceMi ? `${nextKey.distanceMi} mi ` : '';
  const when = nextKey.when === 'today' ? 'Today' : nextKey.dow;
  return `${when} ${mi}${name}`;
}

export default summarizePlanWeek;
