// core/coachReactivity.js — observability for WHEN each coach message reacts and WHAT triggered it.
//
// Emil's concern (2026-07-18): a coach message can LINGER on screen while data streams in ~24 h a day —
// he wants to SEE, per surface, when the message last actually changed, what triggered it, and whether it's
// gone stale relative to incoming data. This records exactly that, with near-zero overhead, and exposes it
// to the device's remote console + to the Coach Reactivity Map visual.
//
// How to read it on the device:
//   __coachReactivity()        → a table: per surface, current text, when it last changed, minutes since,
//                                how many storage updates have landed WITHOUT changing it (stickiness),
//                                and the triggering beats (their `why`).
//   __coachReactivityFeed()    → the raw chronological change-events (feed the Coach Reactivity Map).
//   copy(JSON.stringify(__coachReactivityFeed()))  → paste into the visual for a timeline.
//
// "Sticky" is not automatically bad — most data changes don't concern a given surface. It's a WATCH signal:
// a high sticky count on a surface whose data clearly moved is the lingering case to investigate.

const FEED = [];            // chronological change events (capped)
const CAP = 240;
const CURRENT = {};         // surface -> live state

const nowMs = () => { try { return Date.now(); } catch { return 0; } };

/**
 * recordCoachRead({ surface, text, beats, storageVersion }) — call once per render with the DETERMINISTIC
 * read (the underlying message, not the LLM rephrase). Deduplicates: a feed entry is pushed only when the
 * text actually changes; unchanged renders just advance the stickiness counter.
 */
export function recordCoachRead({ surface, text, beats, storageVersion } = {}) {
  if (!surface || typeof text !== 'string' || !text) return;
  const at = nowMs();
  const cur = CURRENT[surface];
  const triggers = (Array.isArray(beats) ? beats : []).map((b) => ({ id: b && b.id, why: (b && b.why) || null }));
  if (!cur || cur.text !== text) {
    const entry = { surface, at, text, triggers, storageVersion: storageVersion ?? null, prevText: cur ? cur.text : null };
    FEED.push(entry);
    if (FEED.length > CAP) FEED.shift();
    CURRENT[surface] = {
      text, at, firstAt: cur ? cur.firstAt : at, changes: (cur ? cur.changes : 0) + 1,
      triggers, changedAtVersion: storageVersion ?? null, lastSeenVersion: storageVersion ?? null, lastSeenAt: at,
    };
  } else {
    cur.lastSeenAt = at;
    if (storageVersion != null) cur.lastSeenVersion = storageVersion;
  }
}

/**
 * coachReactivityReport() → per-surface snapshot, oldest message first (the top of the list is the most
 * likely to be lingering). Also prints a console table when a console is present.
 */
export function coachReactivityReport() {
  const rows = Object.keys(CURRENT).map((surface) => {
    const c = CURRENT[surface];
    const ageMin = Math.round((nowMs() - c.at) / 60000);
    // storage updates observed since this text last changed — the "stickiness" watch signal.
    const stickyUpdates = (c.lastSeenVersion != null && c.changedAtVersion != null)
      ? Math.max(0, c.lastSeenVersion - c.changedAtVersion) : 0;
    return {
      surface,
      text: c.text.length > 80 ? c.text.slice(0, 77) + '…' : c.text,
      lastChangedAt: new Date(c.at).toISOString().slice(11, 16),   // HH:MM
      ageMin,
      changes: c.changes,
      stickyUpdates,
      triggers: (c.triggers || []).map((t) => t.why || t.id).filter(Boolean).join(' · ') || '(legacy composer)',
    };
  }).sort((a, b) => b.ageMin - a.ageMin);
  try { if (typeof console !== 'undefined' && console.table) console.table(rows); } catch { /* ignore */ }
  return rows;
}

export function coachReactivityFeed() { return FEED.slice(); }
export function coachReactivityClear() { FEED.length = 0; for (const k of Object.keys(CURRENT)) delete CURRENT[k]; }

// Console handles — drive it from the device's remote inspector with no imports.
try {
  if (typeof window !== 'undefined') {
    window.__coachReactivity = coachReactivityReport;
    window.__coachReactivityFeed = coachReactivityFeed;
    window.__coachReactivityClear = coachReactivityClear;
  }
} catch { /* ignore */ }

export default { recordCoachRead, coachReactivityReport, coachReactivityFeed, coachReactivityClear };
