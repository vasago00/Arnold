// core/weekResolve.js — the WHAT-IF brain for session agility. A proposed calendar
// change (reschedule a day's plan onto another day, or substitute a session for a
// cross-train modality) is judged ONCE here, so the swap ladder's "Swap it out" action
// and the calendar's drag-to-swap read identically: what it does to weekly VOLUME, to
// session SPACING (back-to-back hard days, a hard day the eve of the long run, losing the
// last rest day), and whether it PROTECTS the week's key sessions. Advisory, never blocking
// (structurally-invalid targets are gated by the caller, which owns the dates).
//
// PURE + node-testable: it operates on a NORMALISED week — an array of 7 day objects, each
// { sessions: [{ type, distanceMi }] } (rest = empty sessions). The caller normalises via the
// planner's daySessions() before calling, so this file imports nothing storage-coupled.

import { SESSION_RUN_TYPES } from './runMiles.js';

const HARD = new Set(['long_run', 'tempo', 'intervals', 'hiit', 'race']);
const QUALITY = new Set(['tempo', 'intervals', 'hiit']);
// ROUND 98 — this used to be a local Set that omitted `race`, `recovery` and the legacy
// `run`, so a week containing any of them resolved against a smaller total than the same
// week showed on the calendar. One definition now (core/runMiles.js, zero imports, so this
// file stays as storage-free as its header promises).
const RUN = SESSION_RUN_TYPES;
const RECOVERY_CLASSES = new Set(['rest', 'recovery']);
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const sessionsOf = (day) => (day && Array.isArray(day.sessions) ? day.sessions.filter((s) => s && s.type && s.type !== 'rest') : []);

// A day's dominant training load, for spacing analysis.
export function classifyDay(day) {
  const s = sessionsOf(day);
  if (!s.length) return 'rest';
  if (s.some((x) => x.type === 'race')) return 'race';
  if (s.some((x) => HARD.has(x.type))) return 'hard';
  if (s.some((x) => x.type === 'easy_run')) return 'easy';
  if (s.some((x) => x.type === 'strength')) return 'strength';
  if (s.some((x) => x.type === 'mobility' || x.type === 'walk')) return 'recovery';
  return 'other';
}

const isRecoveryDay = (day) => { const c = classifyDay(day); return c === 'rest' || c === 'recovery'; };
const dayRunMi = (day) => sessionsOf(day).reduce((m, s) => m + (RUN.has(s.type) ? (Number(s.distanceMi) || 0) : 0), 0);
const weekRunMi = (days) => days.reduce((m, d) => m + dayRunMi(d), 0);
const label = (i, dayLabels) => (dayLabels && dayLabels[i]) || DOW[i] || `day ${i + 1}`;
const headline = (day) => { const s = sessionsOf(day); return s.length ? (s[0].type || 'session') : 'rest'; };
const pretty = (t) => String(t || '').replace(/_/g, ' ');

// Scan a week for spacing problems (used on the PROPOSED arrangement).
function spacingConflicts(days, dayLabels) {
  const out = [];
  const cls = days.map(classifyDay);
  for (let i = 0; i < days.length - 1; i++) {
    if (cls[i] === 'hard' && cls[i + 1] === 'hard') {
      const nextLong = sessionsOf(days[i + 1]).some((s) => s.type === 'long_run');
      out.push({
        kind: nextLong ? 'hard_before_long' : 'back_to_back_hard',
        text: nextLong
          ? `puts a hard session the day before ${label(i + 1, dayLabels)}'s long run — you'd start it tired`
          : `stacks two hard days back-to-back (${label(i, dayLabels)} + ${label(i + 1, dayLabels)})`,
      });
    }
  }
  return out;
}

// ── RESCHEDULE / SWAP — move day `fromIdx`'s plan onto `toIdx`, exchanging whatever is
// there (a move onto a rest day is just a swap with rest). Volume is conserved; the risk is
// spacing. Returns the full impact the modal renders. ──
export function evaluateReschedule({ normWeek, fromIdx, toIdx, dayLabels } = {}) {
  const days = Array.isArray(normWeek) ? normWeek.map((d) => ({ sessions: sessionsOf(d) })) : [];
  if (days.length !== 7 || fromIdx == null || toIdx == null || fromIdx === toIdx || !days[fromIdx] || !days[toIdx]) {
    return { valid: false, reason: 'invalid target', kind: 'reschedule' };
  }
  const fromSess = days[fromIdx].sessions;
  const toSess = days[toIdx].sessions;
  if (!fromSess.length) return { valid: false, reason: 'nothing to move', kind: 'reschedule' };

  const proposed = days.map((d) => ({ sessions: d.sessions.slice() }));
  proposed[toIdx] = { sessions: fromSess.slice() };      // moved session lands on the target
  proposed[fromIdx] = { sessions: toSess.slice() };      // target's contents come back (swap; empty if rest)

  const conflictsBefore = spacingConflicts(days, dayLabels);
  const conflicts = spacingConflicts(proposed, dayLabels).filter(
    (c) => !conflictsBefore.some((b) => b.text === c.text),   // only NEW problems the swap introduces
  );

  const volBefore = Math.round(weekRunMi(days));
  const volAfter = Math.round(weekRunMi(proposed));
  const restBefore = days.filter(isRecoveryDay).length;
  const restAfter = proposed.filter(isRecoveryDay).length;
  const losesRest = restAfter < restBefore && restAfter === 0;
  const isSwap = toSess.length > 0;

  const movingLabel = pretty(headline({ sessions: fromSess }));
  const goodSpacing = conflicts.length === 0 && !losesRest;

  const parts = [];
  parts.push(isSwap
    ? `Swaps your ${movingLabel} to ${label(toIdx, dayLabels)} and ${pretty(headline({ sessions: toSess }))} back to ${label(fromIdx, dayLabels)}.`
    : `Moves your ${movingLabel} to ${label(toIdx, dayLabels)}.`);
  parts.push(volBefore === volAfter
    ? `Weekly volume is unchanged (${volAfter} mi) and every session is kept.`
    : `Weekly volume goes ${volAfter > volBefore ? 'up' : 'down'} ${Math.abs(volAfter - volBefore)} mi (${volBefore}→${volAfter}).`);
  for (const c of conflicts) parts.push(`Heads up: it ${c.text}.`);
  if (losesRest) parts.push(`Heads up: it leaves no rest day this week — recovery is where the work sticks.`);
  if (goodSpacing) parts.push(`Spacing stays clean — no back-to-back hard days.`);

  return {
    valid: true,
    kind: isSwap ? 'swap' : 'move',
    fromIdx, toIdx,
    volume: { before: volBefore, after: volAfter, delta: volAfter - volBefore },
    conflicts, losesRest,
    protectsSessions: true,               // reschedule never drops a session
    tone: goodSpacing ? 'affirming' : 'gentle',
    summary: parts.join(' '),
  };
}

// ── PER-SESSION MOVE — relocate ONE session off a (possibly double) day onto another day.
// The per-session counterpart to evaluateReschedule: on a run+lift Wednesday you can move just
// the run, leaving the lift behind. Volume is conserved (same session, new day); the risks are
// spacing at the target and whether the source day empties out. ──
export function evaluateSessionMove({ normWeek, fromIdx, fromSessionIdx = 0, toIdx, dayLabels } = {}) {
  const days = Array.isArray(normWeek) ? normWeek.map((d) => ({ sessions: sessionsOf(d) })) : [];
  if (days.length !== 7 || fromIdx == null || toIdx == null || fromIdx === toIdx || !days[fromIdx] || !days[toIdx]) {
    return { valid: false, reason: 'invalid target', kind: 'sessionMove' };
  }
  const fromSess = days[fromIdx].sessions;
  if (!fromSess.length) return { valid: false, reason: 'nothing to move', kind: 'sessionMove' };
  const si = (fromSessionIdx != null && fromSess[fromSessionIdx]) ? fromSessionIdx : 0;
  const moved = fromSess[si];

  const proposed = days.map((d) => ({ sessions: d.sessions.slice() }));
  proposed[fromIdx] = { sessions: fromSess.filter((_, k) => k !== si) };  // source keeps the OTHER sessions
  proposed[toIdx] = { sessions: [...days[toIdx].sessions, moved] };       // target gains this one

  const conflictsBefore = spacingConflicts(days, dayLabels);
  const conflicts = spacingConflicts(proposed, dayLabels).filter((c) => !conflictsBefore.some((b) => b.text === c.text));
  // Per-session-specific: dropping a hard session onto a day that ALREADY has one = two quality
  // efforts the same day (the day-swap path can't create this; a session move can).
  if (HARD.has(moved.type) && days[toIdx].sessions.some((s) => HARD.has(s.type))) {
    conflicts.push({ kind: 'double_hard', text: `puts a second hard session on ${label(toIdx, dayLabels)} — two quality efforts the same day` });
  }
  const volBefore = Math.round(weekRunMi(days));
  const volAfter = Math.round(weekRunMi(proposed));
  const restBefore = days.filter(isRecoveryDay).length;
  const restAfter = proposed.filter(isRecoveryDay).length;
  const losesRest = restAfter < restBefore && restAfter === 0;
  const leftBehind = proposed[fromIdx].sessions.map((s) => pretty(s.type)).join(' + ');
  const goodSpacing = conflicts.length === 0 && !losesRest;

  const parts = [];
  parts.push(`Moves ${label(fromIdx, dayLabels)}'s ${pretty(moved.type)} to ${label(toIdx, dayLabels)}${leftBehind ? ` (leaves ${leftBehind} on ${label(fromIdx, dayLabels)})` : ` — ${label(fromIdx, dayLabels)} becomes a rest day`}.`);
  parts.push(volBefore === volAfter
    ? `Weekly volume is unchanged (${volAfter} mi) and every session is kept.`
    : `Weekly volume goes ${volAfter > volBefore ? 'up' : 'down'} ${Math.abs(volAfter - volBefore)} mi (${volBefore}→${volAfter}).`);
  for (const c of conflicts) parts.push(`Heads up: it ${c.text}.`);
  if (losesRest) parts.push(`Heads up: it leaves no rest day this week — recovery is where the work sticks.`);
  if (goodSpacing) parts.push(`Spacing stays clean — no back-to-back hard days.`);

  return {
    valid: true,
    kind: 'sessionMove',
    fromIdx, toIdx, movedType: moved.type,
    volume: { before: volBefore, after: volAfter, delta: volAfter - volBefore },
    conflicts, losesRest,
    protectsSessions: true,
    tone: goodSpacing ? 'affirming' : 'gentle',
    summary: parts.join(' '),
  };
}

// ── SUBSTITUTE — replace day `dayIdx`'s run with a cross-train modality (the ladder's
// "Bike it / pool it"). The run stimulus is (partly) kept but the miles leave weekly RUN
// volume — the honest trade the athlete should see. ──
export function evaluateSubstitute({ normWeek, dayIdx, modalityLabel = 'cross-train', keeps = null, dayLabels } = {}) {
  const days = Array.isArray(normWeek) ? normWeek.map((d) => ({ sessions: sessionsOf(d) })) : [];
  if (days.length !== 7 || dayIdx == null || !days[dayIdx]) return { valid: false, reason: 'invalid day', kind: 'substitute' };
  const droppedMi = Math.round(dayRunMi(days[dayIdx]));
  const volBefore = Math.round(weekRunMi(days));
  const volAfter = volBefore - droppedMi;
  const parts = [`Swaps ${label(dayIdx, dayLabels)}'s run for ${modalityLabel}.`];
  if (keeps) parts.push(`Keeps the ${keeps}.`);
  parts.push(droppedMi > 0
    ? `Weekly running drops ${droppedMi} mi (${volBefore}→${volAfter}) — cross-train doesn't count as run volume, but the stimulus is protected.`
    : `Weekly running is unchanged.`);
  return {
    valid: true, kind: 'substitute', dayIdx,
    volume: { before: volBefore, after: volAfter, delta: -droppedMi },
    tone: droppedMi > 6 ? 'gentle' : 'affirming',
    summary: parts.join(' '),
  };
}

export default evaluateReschedule;
