// core/coachPersonalization.js — engagement-driven PREFERENCE LEARNING + the semantic PERSON model
// (roadmap Stage 4). This is the piece that had preference learning parked: it needs an ENGAGEMENT
// SIGNAL (did the athlete act on / expand / ignore / dismiss a coach beat?), which nothing captured.
//
// It completes the four-type memory taxonomy the architecture calls for:
//   • working   — this turn's ctx (already assembled per render)
//   • episodic  — coachMemory.js novelty (what was said, when) + THIS engagement event log
//   • semantic  — the PERSON model derived here (stance preference, recurring patterns)
//   • procedural— the learned kind-weights derived here (what the coach should surface more/less)
//
// The engine ALREADY consumes the output: coachNarrative's salience adds `ctx.memory.kindWeight[kind]`
// (a producer-less seam until now) and the reasoner will read `person.stancePref`. So learning here
// closes a loop that's already wired on the read side.
//
// PRODUCTION HYGIENE from day one (the field's memory failure modes): RECENCY-WEIGHTING (recent
// engagement counts more; old decays), TTL (drop stale events), DEDUP + CONFLICT RESOLUTION (one
// action per beat per day, latest wins), and a hard CAP. Structured + deterministic → node-testable;
// storage is a thin shell. COLD START is neutral: no history → no weights → today's behaviour exactly.

import { storage } from './storage.js';

const KEY = 'coachEngagement';

// Signal valence: acting on a beat is the strongest positive; dismissing it the strongest negative.
// `shown` alone is neutral (0) — being displayed isn't evidence of preference, only interaction is.
export const ACTION_VALENCE = { acted: 1, expanded: 0.5, shown: 0, ignored: -0.3, dismissed: -1 };
const VALID_ACTIONS = new Set(Object.keys(ACTION_VALENCE));

const CAP_DAYS = 60;    // TTL — engagement older than this stops informing preference (recency > history)
const CAP_N = 400;      // hard cap on stored events (keep the most recent)
const HALF_LIFE = 14;   // days — a signal's influence halves every fortnight
const PREF_CAP = 0.2;   // kindWeight is bounded so learning nudges, never dominates, salience

const daysBetween = (from, to) => {
  const a = new Date(`${from}T12:00:00`), b = new Date(`${to}T12:00:00`);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
};
const decay = (daysAgo) => 2 ** (-Math.max(0, daysAgo) / HALF_LIFE);
import { clamp } from './stats.js';
// tanh so a run of strong signals saturates toward the cap instead of running away.
const tanh = (x) => { const e = Math.exp(2 * x); return (e - 1) / (e + 1); };

// ── PURE: fold one engagement into the event log, with dedup + TTL + cap ─────────────────────────
// event: { id, kind, corrective, action, date }. Dedup/conflict: the LATEST action for a given
// (beat id, date) replaces any earlier one that day. Then TTL-drop by `today` and cap the tail.
export function recordEngagementInto(events, event, today) {
  const base = Array.isArray(events) ? events : [];
  if (!event || !event.id || !VALID_ACTIONS.has(event.action) || !today) return base;
  const e = {
    id: String(event.id),
    kind: event.kind ? String(event.kind) : 'unknown',
    corrective: !!event.corrective,
    action: event.action,
    date: today,
  };
  // Conflict resolution: drop any prior same-beat-same-day record (latest action wins).
  let next = base.filter((x) => !(x && x.id === e.id && x.date === e.date));
  next.push(e);
  // TTL: forget events older than CAP_DAYS relative to today.
  next = next.filter((x) => { const n = x && x.date ? daysBetween(x.date, today) : null; return n == null ? false : n <= CAP_DAYS; });
  // Hard cap: keep the most recent CAP_N.
  if (next.length > CAP_N) next = next.slice(next.length - CAP_N);
  return next;
}

// ── PURE: engagement history → per-KIND salience nudge (the procedural memory) ───────────────────
// Recency-weighted valence per beat-kind, squashed into [-PREF_CAP, +PREF_CAP]. Kinds the athlete
// engages with tilt up; kinds they dismiss tilt down. Only kinds with real signal appear (cold start
// and `shown`-only histories yield {} → zero nudge → unchanged behaviour).
export function deriveKindWeights(events, today) {
  const raw = {};
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || !e.kind || !VALID_ACTIONS.has(e.action)) continue;
    const v = ACTION_VALENCE[e.action];
    if (v === 0) continue;                                  // `shown` carries no preference signal
    const n = e.date ? daysBetween(e.date, today) : null;
    if (n == null || n < 0) continue;
    raw[e.kind] = (raw[e.kind] || 0) + v * decay(n);
  }
  const out = {};
  for (const [kind, sum] of Object.entries(raw)) {
    if (Math.abs(sum) < 1e-6) continue;
    out[kind] = Math.round(PREF_CAP * tanh(sum / 3) * 1000) / 1000;
  }
  return out;
}

// ── PURE: engagement history → the semantic PERSON (stance + patterns) ───────────────────────────
// stancePref: how the athlete responds to DIRECTIVE (corrective/gentle) coaching. Consistently
// dismissing/ignoring it → 'facilitative' (surface less, ask more — the "stop nagging me" signal);
// consistently acting on it → 'directive' is welcome. Neutral/insufficient signal → null (no claim).
// patterns: the kinds they most reject, as compact tags for the reasoner ("dismisses:reds").
export function derivePerson(events, today, { minSignal = 1.5 } = {}) {
  let correctiveScore = 0;
  const kindScore = {};
  for (const e of (Array.isArray(events) ? events : [])) {
    if (!e || !VALID_ACTIONS.has(e.action)) continue;
    const v = ACTION_VALENCE[e.action];
    if (v === 0) continue;
    const n = e.date ? daysBetween(e.date, today) : null;
    if (n == null || n < 0) continue;
    const w = v * decay(n);
    if (e.corrective) correctiveScore += w;
    kindScore[e.kind] = (kindScore[e.kind] || 0) + w;
  }
  let stancePref = null;
  if (correctiveScore <= -minSignal) stancePref = 'facilitative';
  else if (correctiveScore >= minSignal) stancePref = 'directive';
  const patterns = Object.entries(kindScore)
    .filter(([, s]) => s <= -minSignal)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([kind]) => `dismisses:${kind}`);
  return { stancePref, patterns };
}

// ── live shell ───────────────────────────────────────────────────────────────────────────────
export function getEngagement() {
  try { const e = storage.get(KEY); return Array.isArray(e) ? e : []; }
  catch { return []; }
}

/**
 * recordEngagement(beat, action, today) — capture one interaction. `beat` is the shown beat (needs
 * id/kind/tone); `action` ∈ shown|expanded|acted|ignored|dismissed. This is the ONE call site the UI
 * adds (e.g. CoachComment: 'expanded' on tap-to-expand, 'dismissed' on dismiss, 'acted' when the
 * athlete follows the suggestion). No-op-write-guarded so steady state is quiet.
 */
export function recordEngagement(beat, action, today) {
  try {
    if (!beat || !beat.id || !VALID_ACTIONS.has(action) || !today) return null;
    const cur = getEngagement();
    const next = recordEngagementInto(cur, {
      id: beat.id, kind: beat.kind,
      corrective: beat.tone === 'corrective' || beat.tone === 'gentle',
      action,
    }, today);
    if (JSON.stringify(next) !== JSON.stringify(cur)) storage.set(KEY, next, { skipValidation: true });
    return next;
  } catch { return null; }
}

// Reads for the context assembler.
export function learnedKindWeights(today) { return deriveKindWeights(getEngagement(), today); }
export function learnedPerson(today) { return derivePerson(getEngagement(), today); }

export default learnedKindWeights;
