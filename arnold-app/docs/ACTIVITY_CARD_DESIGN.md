# Activity Card Design — per-workout-type spec (DRAFT v2 for review)

> Goal: every logged workout renders a card designed for that discipline. Structure is
> now two-tier (Macro → Micro) under a universal hero band, with a single merged Fuel
> block. This v2 reflects your model.

---

## A. Hero band (universal — identical on EVERY activity)
The top band never changes shape by sport. Activity-specific detail lives in the card below.

```
[ Readiness 7d ]                                   [ universal metric 1 ]
[ Readiness 30d ]      ( rTSS speedometer )        [ universal metric 2 ]
[ A:C ratio ]            load + zone word          [ universal metric 3 ]
        LEFT RAIL (3)         CENTER                    RIGHT RAIL (3)
```

- **Left rail (3):** Readiness 7d, Readiness 30d, A:C ratio. *(already there)*
- **Center:** rTSS gauge — load number + zone word (Easy/Moderate/Hard). Works for all.
- **Right rail (3): universal metrics that apply to every activity and stay put.** These do
  NOT change by sport (that's what made the old "Power/Effort" tile feel inconsistent).
  Candidates that translate to all activities: **Effort %**, **Duration**, **Calories**,
  **Avg HR**. → see Question 1 for which 3.

The gauge already expresses Load, so Load is NOT repeated on the right rail.

---

## B. Card body (below the hero) — three layers
1. **Macro metrics — 4 tiles.** The discipline-level facts (a Run's 4, a Cycle's 4…). Same 4
   for every sub-type of that discipline.
2. **Micro metrics — 3–4 tiles.** The sub-type's signature signals (Easy vs Tempo vs Intervals
   differ here). This is where the card "knows" what kind of session it was.
3. **Fuel** — ONE block titled **Fuel** that merges today's *Fuel & Fluids* + *Replenish*
   (sweat/replenish/oz/window tiles, then the pre/during/post replenish tiles) under a single
   header. Same little blocks as today, just unified.

*(Vs-goal / vs-usual stays below Fuel, as today.)*
Optional: a one-line **coach insight** read from macro+micro (Question 3).

---

## C. Disciplines, macro tiles, and sub-types (micro tiles)

### Run  — macro: **Distance · Pace · Avg HR · Duration**
| Sub-type | Micro tiles |
|---|---|
| Easy run | Z2 %, Cardiac drift, Decoupling, Cadence |
| Long run | Z2 %, Cardiac drift, Elevation, late-fade |
| Tempo | Z3–4 %, GAP, IF, HR recovery |
| Intervals | Z4–5 %, Anaerobic TE, Max HR, HR recovery |

### Cycle — macro: **Power *or* Distance · Avg HR · Duration · Calories**
| Sub-type | Micro tiles |
|---|---|
| Power meter | IF (NP/FTP), Norm power, Cadence, Efficiency (W/bpm) |
| HR-only (indoor) | Effort %, Z2 %, Cardiac drift, Aero TE |

### Strength — macro: **Sets · Reps · Duration · Avg HR**
Micro: Density, Work:Rest, Tonnage, Effort %. *(HYROX/hybrid counts here.)*

### Swim — macro: **Distance · Pace /100 · Avg HR · Duration**
Micro: SWOLF, Z2 %, Max HR, Aero TE.

### Walk / Hike — macro: **Distance · Duration · Elevation · Avg HR**
Micro: Z2 %, Steps, Calories, Aero TE.

### Ski (NEW) — macro: **Distance · Duration · Vert (descent) · Avg HR**
Micro: Z2 %, runs/laps, Max HR, Aero TE. *(Alpine vs Nordic/XC differ — Nordic is closer to a
run aerobically; see Question 4 on whether to split them.)*

### Mobility — macro: **Duration · Avg HR · Calories · Body battery**
Micro: none by design — recovery framing, intentionally light.

### HIIT (standalone, not a run) — macro: **Duration · Avg HR · Max HR · Calories**
Micro: Z4–5 %, Anaerobic TE, HR recovery, Work:Rest.

### Race — **detects the underlying sport**, then renders THAT discipline's macro+micro,
plus a race header (finish time, place/field if known, negative-split). A run race → run
tiles; a HYROX race → strength/HIIT tiles; a tri leg → swim/bike/run. Detection uses the same
classifiers (activityType/name/Garmin key) the cards now use.

### Cross-train — **the catch-all for cardio with no dedicated card** (elliptical, rower,
SkiErg, stair-climber, etc.). Macro: **Duration · Avg HR · Load · Calories**; Micro: Effort %,
Z2 %, Aero TE. *(Once a discipline gets its own card it leaves "cross-train".)* → Question 2.

---

## D. Watch-outs you flagged
- **HIIT** — intensity-based, often zero-distance; never force it into the run grid.
- **Mobility** — keep it light; no micro row, recovery-toned coach line only.
- **Race** — must detect sub-sport and adopt that card; don't hard-code "run race".

---

## Decisions (LOCKED 2026-06-07)
1. **Right-rail universal 3:** **Effort % · Avg HR · Calories** — fixed on every activity.
2. **Cross-train:** **dropped.** Every activity maps to a specific discipline card; an
   unrecognized activity falls back to a generic layout (Duration · Avg HR · Load · Calories).
3. **Coach line:** **on every card** — one insight read from that session's macro+micro.
4. **Ski:** **one Ski card** (Distance · Duration · Vert · Avg HR; micro: Z2 %, runs, Max HR, Aero TE).

## Build order
1. Hero right rail → universal Effort · Avg HR · Calories (both Daily + Play).
2. Card body → macro(4) + micro(3–4) per discipline/sub-type; add Ski; drop cross→generic.
3. Merge Fuel & Fluids + Replenish into one **Fuel** block.
4. Coach line per card (`cardCoach`).
5. Race → detect underlying sport, adopt that card + race header.
