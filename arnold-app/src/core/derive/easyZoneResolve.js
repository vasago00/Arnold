// core/derive/easyZoneResolve.js — the storage-coupled wrapper around the PURE easyZone model.
// Kept separate from easyZone.js so the model stays node-testable and free of IO. This reads the
// athlete's real record — runs (with HR), sleep (resting HR), profile overrides — and the planner
// (so a run's PLANNED intent is known, which is what lets hot-drift honestly tell an easy day that
// ran hot from a genuine workout). Guarded end-to-end; returns null/undefined rather than throwing.

import { storage } from '../storage.js';
import { getPlannerWeek, daySessions } from '../planner.js';
import { buildEasyZone } from './easyZone.js';
import { resolveZones } from '../zones.js';   // the app's SINGLE source of truth for the easy ceiling (LT1)

// Build a { 'YYYY-MM-DD' → plannedType } map from the planner (keyed by Monday-aligned week). Each
// week's days are Mon..Sun, so a day's date is weekStart + index. Best-effort: any failure → empty map,
// and hot-drift simply falls back to leaning toward flagging (documented behaviour).
function plannedTypeByDate() {
  const map = {};
  try {
    const planner = storage.get('planner') || {};
    for (const wk of Object.keys(planner)) {
      const week = getPlannerWeek(wk);
      const days = (week && week.days) || [];
      for (let i = 0; i < days.length; i++) {
        const d = new Date(`${wk}T12:00:00`);
        d.setDate(d.getDate() + i);
        const ds = d.toISOString().slice(0, 10);
        const sess = daySessions(days[i]) || [];
        const primary = sess.find((s) => s && s.type) || sess[0];
        if (primary && primary.type) map[ds] = primary.type;
      }
    }
  } catch { /* empty map */ }
  return map;
}

/**
 * resolveEasyZone({ storage?, today? }) → the athlete's honest easy zone from their real record, or null.
 * Thin glue only: field-maps the store into the pure buildEasyZone (which does all the physiology + math).
 */
export function resolveEasyZone(ctx = {}) {
  const store = ctx.storage || storage;
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  const get = (k) => { try { return store.get(k); } catch { return null; } };
  try {
    const activities = get('activities') || [];
    const sleep = get('sleep') || [];
    const profile = get('profile') || {};
    const ptypes = plannedTypeByDate();

    const runs = activities
      .filter((a) => a && (a.isRun === true || /run/i.test(String(a.activityType || a.sport || ''))))
      .map((a) => ({
        date: a.date,
        distanceMi: a.distanceMi,
        durationSecs: a.durationSecs,
        avgHR: a.avgHR,
        maxHR: a.maxHR,
        isRun: a.isRun,
        activityType: a.activityType,
        plannedType: ptypes[a.date] || null,
      }));
    const restingHrSeries = sleep.map((s) => ({ date: s.date, restingHR: s.restingHR ?? s.restingHeartRate }));
    const prof = { maxHR: profile.maxHR, restingHR: profile.restingHR };

    // Take the easy CEILING from the app's single source of truth (resolveZones — lab / personal-data /
    // garmin / karvonen), so the analysis below sits on the SAME number the rest of the app uses. The
    // pure model computes the pace band, the 80/20 share and hot-drift on top of that canonical ceiling.
    const zones = (() => { try { return resolveZones({ runs: activities, today }); } catch { return null; } })();

    return buildEasyZone({ runs, restingHrSeries, profile: prof, zones }, { today }) || null;
  } catch { return null; }
}

export default resolveEasyZone;
