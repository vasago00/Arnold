// core/coachMemory.js — the coach's EPISODIC memory (novelty). Phase D, slice 1.
//
// The salience function in coachNarrative.js already reaches for `ctx.memory.saidAgoDays[beatId]`
// (down-weight a beat the coach said in the last two days) — but nothing populated it, so the coach
// had no sense of what it told you yesterday and would repeat the same line every morning. This is
// that store: a small, STRUCTURED, date-keyed index (per the architecture decision in
// COACH_NARRATIVE_DESIGN §18 — deterministic, not embeddings), recording which beats were shown on
// which dates and computing days-since for each.
//
// KEY SEMANTIC: novelty is measured against PRIOR days only. `computeSaidAgoDays` ignores a beat's
// record for `today` itself, so recording a beat as shown today never down-weights it within the
// same session (which would make the coach flip-flop mid-day). It penalises repetition ACROSS days.
//
// Pure core (`computeSaidAgoDays`, `recordShownInto`) is node-testable; the storage wrappers are the
// thin live shell.

import { storage } from './storage.js';

const KEY = 'coachMemory';
const CAP = 6;   // keep the last few showings per beat — enough for "said in the last N days"

const daysBetween = (from, to) => {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};

// PURE — { beatId: [dateStr…] } + today → { beatId: daysAgo } using the most recent showing STRICTLY
// BEFORE today (so today's own record can't affect today's ranking). Beats never shown before today
// are omitted → no penalty.
export function computeSaidAgoDays(store, today) {
  const out = {};
  if (!store || typeof store !== 'object' || !today) return out;
  for (const id of Object.keys(store)) {
    const dates = Array.isArray(store[id]) ? store[id] : [];
    let best = null;
    for (const d of dates) {
      if (typeof d === 'string' && d < today && (!best || d > best)) best = d;
    }
    if (best) { const n = daysBetween(best, today); if (n != null) out[id] = Math.max(0, n); }
  }
  return out;
}

// PURE — fold today's shown beats into the store: append `today` once per beat (idempotent within a
// day), cap the per-beat history. Returns a NEW store (never mutates the input).
export function recordShownInto(store, beatIds, today) {
  const base = (store && typeof store === 'object' && !Array.isArray(store)) ? store : {};
  if (!today || !Array.isArray(beatIds) || !beatIds.length) return base;
  const next = { ...base };
  for (const id of beatIds) {
    if (!id || typeof id !== 'string') continue;
    const arr = Array.isArray(next[id]) ? [...next[id]] : [];
    if (arr[arr.length - 1] !== today) arr.push(today);
    next[id] = arr.slice(-CAP);
  }
  return next;
}

// ── live shell ────────────────────────────────────────────────────────────────
export function getCoachMemory() {
  try { const m = storage.get(KEY); return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {}; }
  catch { return {}; }
}

// Read for the context assembler.
export function saidAgoDays(today) {
  return computeSaidAgoDays(getCoachMemory(), today);
}

// Record what a surface actually showed. No-op write guard keeps storage (and the render loop) quiet
// once a beat is already logged for today — combined with the prior-days-only read semantic, exactly
// one write per new beat per day, then steady state.
export function recordShown(beatIds, today) {
  try {
    const cur = getCoachMemory();
    const next = recordShownInto(cur, beatIds, today);
    if (JSON.stringify(next) !== JSON.stringify(cur)) storage.set(KEY, next, { skipValidation: true });
    return next;
  } catch { return null; }
}

export default saidAgoDays;
