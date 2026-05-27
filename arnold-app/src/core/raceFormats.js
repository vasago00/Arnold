// ─── Race format reference ─────────────────────────────────────────────────
//
// Canonical specs for race events Arnold can reason about.
// See RACES.md for the human-readable reference and notes on
// race-aware coaching patterns built off this data.
//
// Format: each entry keyed by race type id; sections + weights
// + modalities. The coach engine reads this when a race is upcoming
// to surface format-aware preparation insights.

export const RACE_FORMATS = {
  hyrox: {
    id: 'hyrox',
    name: 'HYROX',
    totalRunKm: 8,
    stationCount: 8,
    estimatedDurationMinutes: { open: 75, pro: 65 },
    estimatedKcalBurn: { open: 900, pro: 1000 },
    stations: [
      { order: 1, name: 'SkiErg',             metric: 'distance_m', value: 1000, modality: 'ergometer_upper' },
      { order: 2, name: 'Sled Push',          metric: 'distance_m', value: 50,   modality: 'strength_push' },
      { order: 3, name: 'Sled Pull',          metric: 'distance_m', value: 50,   modality: 'strength_pull' },
      { order: 4, name: 'Burpee Broad Jumps', metric: 'distance_m', value: 80,   modality: 'bodyweight_explosive' },
      { order: 5, name: 'Rowing',             metric: 'distance_m', value: 1000, modality: 'ergometer_full' },
      { order: 6, name: 'Farmers Carry',      metric: 'distance_m', value: 200,  modality: 'grip_posterior' },
      { order: 7, name: 'Sandbag Lunges',     metric: 'distance_m', value: 100,  modality: 'loaded_lunge' },
      { order: 8, name: 'Wall Balls',         metric: 'reps',       value: 100,  modality: 'shoulder_endurance' },
    ],
    weightsByDivision: {
      'mens-open':    { sledPushKg: 152, sledPullKg: 103, farmersCarryKgEach: 24, sandbagLungeKg: 20, wallBallKg: 6 },
      'mens-pro':     { sledPushKg: 200, sledPullKg: 153, farmersCarryKgEach: 32, sandbagLungeKg: 30, wallBallKg: 9 },
      'womens-open':  { sledPushKg: 100, sledPullKg: 75,  farmersCarryKgEach: 16, sandbagLungeKg: 10, wallBallKg: 4 },
      'womens-pro':   { sledPushKg: 125, sledPullKg: 92,  farmersCarryKgEach: 20, sandbagLungeKg: 15, wallBallKg: 6 },
    },
    prepFocus: [
      'sled_push_capacity',     // 152kg @ Men's Open ≈ 1.5-1.8× BW. Strength + leg drive.
      'wall_ball_endurance',    // 100 unbroken reps — shoulder + cardiovascular.
      'grip_posterior_chain',   // 200m at 48kg total. Forearm endurance.
      'glycogen_loading',       // ~900-1000 kcal expenditure. Carbs in race week.
      'mixed_pacing',           // Alternating run/station — controlled effort matters.
    ],
  },

  marathon: {
    id: 'marathon',
    name: 'Marathon',
    totalDistanceMi: 26.2,
    prepFocus: [
      'weekly_mileage_build',
      'long_run_progression',
      'tempo_at_race_pace',
      'polarised_distribution',
      'taper_2_3_weeks',
    ],
  },

  // Add new race formats here — keep the shape consistent so
  // coach patterns can iterate generically when possible.
};

/**
 * Look up the format for a race object stored in goals.
 * Race objects use a `type` field that maps to this constant.
 * Returns null if the race type isn't a known format (silent fallback
 * — race-aware patterns just skip that race rather than crashing).
 */
export function getRaceFormat(race) {
  if (!race?.type) return null;
  const key = String(race.type).toLowerCase().trim();
  return RACE_FORMATS[key] || null;
}

/**
 * For a known race + division, return the weight-set the athlete
 * faces. Defaults to mens-open if division isn't specified (most
 * common case for the current user).
 */
export function getRaceWeights(race, division = 'mens-open') {
  const fmt = getRaceFormat(race);
  if (!fmt?.weightsByDivision) return null;
  return fmt.weightsByDivision[division] || fmt.weightsByDivision['mens-open'] || null;
}
