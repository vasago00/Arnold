// core/record/careerRacesSeed.js — the marathon RÉSUMÉ (durable career record).
//
// Emil's full racing career (100+ NYRR races + majors) doesn't live in one extractable place, and it doesn't
// need to: DURABILITY / experience only needs the marathon FINISHES. This is the curated, authoritative list of
// them — seeded once, hand-editable, stored durably (a first-class record category the memory retains), and read
// by marathonExperience to RELAX the marathon fade. It is NOT level evidence: every entry is > 6 months old, so
// the current-fitness window (fitnessState, 180 d) ignores them by construction. The current number stays fresh;
// only the "has this athlete proven the distance" fade leans on this.
//
// Distances are the OFFICIAL 42.195 km (GPS drift removed); times are his verbatim finishes.

export const CAREER_MARATHONS = [
  { date: '2025-11-02', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14869, activityType: 'running', isRun: true, source: 'career' },
  { date: '2025-10-12', name: 'Chicago Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 13663, activityType: 'running', isRun: true, source: 'career' },
  { date: '2025-08-31', name: 'Sydney Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 13627, activityType: 'running', isRun: true, source: 'career' },
  { date: '2024-11-03', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14018, activityType: 'running', isRun: true, source: 'career' },
  { date: '2024-10-13', name: 'Chicago Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 17087, activityType: 'running', isRun: true, source: 'career' },
  { date: '2024-09-29', name: 'Berlin Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14164, activityType: 'running', isRun: true, source: 'career' },
  { date: '2023-11-05', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 17517, activityType: 'running', isRun: true, source: 'career' },
  { date: '2023-09-24', name: 'Berlin Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 15271, activityType: 'running', isRun: true, source: 'career' },
  { date: '2021-11-07', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 16070, activityType: 'running', isRun: true, source: 'career' },
  { date: '2020-11-01', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14418, activityType: 'running', isRun: true, source: 'career' },
  { date: '2019-11-03', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14044, activityType: 'running', isRun: true, source: 'career' },
  { date: '2019-09-29', name: 'Berlin Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 13770, activityType: 'running', isRun: true, source: 'career' },
  { date: '2018-11-04', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 16899, activityType: 'running', isRun: true, source: 'career' },
  { date: '2017-11-05', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 14275, activityType: 'running', isRun: true, source: 'career' },
  { date: '2016-11-06', name: 'New York City Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 15071, activityType: 'running', isRun: true, source: 'career' },
  { date: '2016-10-09', name: 'Chicago Marathon', distanceKm: 42.195, distanceMi: 26.219, durationSecs: 13749, activityType: 'running', isRun: true, source: 'career' },
];

/**
 * seedCareerRaces(storage) — write the résumé into storage ONCE, only if the athlete has none yet. Idempotent +
 * non-destructive: if a career list already exists (hand-edited, or a fuller import), it is left untouched.
 */
export function seedCareerRaces(storage) {
  try {
    const existing = storage.get('careerRaces');
    if (Array.isArray(existing) && existing.length) return existing;   // already curated → never clobber
    storage.set('careerRaces', CAREER_MARATHONS);
    return CAREER_MARATHONS;
  } catch { return null; }
}

export default CAREER_MARATHONS;
