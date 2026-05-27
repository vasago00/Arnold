# Arnold — Race Format Reference

Canonical specs for race events Arnold can reason about. Each race
type has a known structure (segments, weights, distances) that the
coach engine can use to:

- Generate race-specific prep recommendations ("your wall-ball
  volume is low for HYROX in 10d")
- Estimate expected race performance from current fitness
- Score how well today's workout maps to the race's actual demands
- Sequence cuts/peaks around race day with format-aware mechanics
  (e.g., HYROX needs glycogen + grip + sled push — different from
  marathon's pure aerobic prep)

This doc is the source of truth. Code reads from a structured
constant; update the constant when the doc updates.

---

## HYROX

Eight functional fitness stations alternated with 1 km runs. Total
distance run: 8 km. Total workout: ~60-90 min depending on division.

Stations (in order) and weights for the **Men's Open** division
(Emil's division, as of 2026-05-24):

| # | Station | Distance / Reps | Men's Open weight |
|---|---|---|---|
| — | Run | 1 km × 8 (between stations) | — |
| 01 | SkiErg | 1000 m | — |
| 02 | Sled Push | 50 m | 152 kg |
| 03 | Sled Pull | 50 m | 103 kg |
| 04 | Burpee Broad Jumps | 80 m | bodyweight |
| 05 | Rowing | 1000 m | — |
| 06 | Farmers Carry | 200 m | 2 × 24 kg |
| 07 | Sandbag Lunges | 100 m | 20 kg |
| 08 | Wall Balls | 100 reps | 6 kg |

### Other divisions (weights vary)

| Station | Women's Open | Women's Pro | Men's Pro |
|---|---|---|---|
| Sled Push | 100 kg | 125 kg | 200 kg |
| Sled Pull | 75 kg | 92 kg | 153 kg |
| Farmers Carry | 2 × 16 kg | 2 × 20 kg | 2 × 32 kg |
| Sandbag Lunges | 10 kg | 15 kg | 30 kg |
| Wall Balls | 4 kg | 6 kg | 9 kg |

Distances and rep counts identical across divisions; only the loads
change.

### What this means for prep (coach-engine targets)

What the engine should be able to surface for HYROX-specific coaching:

- **Sled-push capacity**: heavy push @ ~bodyweight (152 kg ≈ 1.8 × 85 kg). Strength + leg drive matter.
- **Wall-ball volume**: 100 unbroken reps challenges shoulder endurance more than load.
- **Grip + posterior chain**: farmers carry (48 kg total) over 200 m. Forearm endurance.
- **Glycogen demand**: 8 km of running + 8 high-output stations = ~700-1100 kcal expenditure. Race-day fuelling matters.
- **Pacing strategy**: alternating run/station forces controlled effort — too hard early on stations destroys subsequent runs.

### Race-aware pattern ideas (Coach Engine follow-ups)

- `patternHyroxStationCoverage` — did your recent training cover all 8 stations? Flag missing modalities.
- `patternHyroxStrengthReadiness` — is your strength baseline sufficient for the loaded stations (sled push, farmers, sandbag)?
- `patternHyroxGlycogenWindow` — race in 10d: are carbs being prioritised in the right window?
- `patternHyroxPacingPrep` — race-pace simulation work done in last 3 weeks?

---

## Marathon (sub 3:30 target — December)

Goal: 26.2 miles at 8:00 min/mile average pace.

Key prep metrics Arnold should track:

- Weekly mileage trajectory (target peak: 45-55 mi/week)
- Long-run progression (target peak: 20-22 mi)
- Tempo / threshold time at race pace
- Polarised distribution (target ≥80% Z1-Z2, ≤15% Z4-Z5)
- ACWR over the build (target 0.8-1.3)

### Race-aware pattern ideas (deferred)

- `patternMarathonMileageBuild` — weekly mi vs goal trajectory for sub-3:30
- `patternMarathonPaceWork` — minutes at goal pace in last 4 weeks
- `patternMarathonTaper` — auto-detect 2-3 week taper window ahead of race

---

## Adding a new race type

1. Add a section to this doc with the format, distances, loads, division variants.
2. Add a structured entry to `src/core/raceFormats.js` (TBD — currently parking specs in this doc only).
3. If the engine should produce race-aware coaching, add patterns to `coachBriefs.js` and reference them here under "Race-aware pattern ideas."

Keep this doc as the canonical reference. Code constants mirror it.
