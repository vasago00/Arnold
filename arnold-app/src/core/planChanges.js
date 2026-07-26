// core/planChanges.js — captures the athlete's INTENTIONAL plan changes (substitute / move / skip / shorten)
// as events, so the Coach can RESPOND to a decision the moment it's made — acknowledge it, state the tax,
// re-calibrate — instead of only noticing a missed session after the fact. This is what makes the plan feel
// alive: you swap a long run for a bike to protect a knee, and the coach talks back about it.
//
// Data layer only (record + read-recent). The coach voice lives in coachNarrative (gPlanChange).

import { storage } from './storage.js';

const KEEP = 50;   // retain the last N changes (also carried into the durable record)

/**
 * recordPlanChange(change) — append an intentional change. `change`:
 *   { date, kind:'substitute'|'move'|'skip'|'shorten', fromType, toType?, toDate?, mi?, durationMin?, note? }
 * Stamps `at` (ISO) and returns the entry. Non-throwing.
 */
export function recordPlanChange(change) {
  try {
    if (!change || !change.kind) return null;
    const list = Array.isArray(storage.get('planChanges')) ? storage.get('planChanges') : [];
    const entry = { at: new Date().toISOString(), ...change };
    storage.set('planChanges', [entry, ...list].slice(0, KEEP));
    return entry;
  } catch { return null; }
}

/**
 * recentPlanChange({ today, withinDays }) — the most recent change still worth speaking to (default ≤ 3 days).
 * Returns null once it's stale, so the coach acknowledges a change briefly and then lets it go (no lingering).
 */
export function recentPlanChange(opts = {}) {
  try {
    const today = opts.today || new Date().toISOString().slice(0, 10);
    const within = opts.withinDays ?? 3;
    const list = Array.isArray(storage.get('planChanges')) ? storage.get('planChanges') : [];
    const t = new Date(`${today}T12:00:00`).getTime();
    for (const c of list) {
      const raw = String(c.date || c.at || '').slice(0, 10);
      const cd = new Date(`${raw}T12:00:00`).getTime();
      if (!Number.isFinite(cd)) continue;
      const ageD = (t - cd) / 86400000;
      if (ageD <= within && ageD >= -1) return { ...c, ageDays: Math.round(ageD) };
    }
    return null;
  } catch { return null; }
}

export default recordPlanChange;
