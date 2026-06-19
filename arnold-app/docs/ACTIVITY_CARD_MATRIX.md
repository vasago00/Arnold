# Activity Card Metric Matrix — audit + per-activity table

> Companion to ACTIVITY_CARD_DESIGN.md. This audits every metric we compute and
> decides which belong on a per-SESSION activity card vs. which are aggregate
> (Trend/EdgeIQ/Hub) and therefore NOT card material. Then it tables, per
> activity: the 4 fixed MACRO tiles + the MICRO menu the coach chooses from.

## 1. Where metrics live (and whether they belong on a card)

A card describes ONE session. Aggregate/longitudinal metrics describe weeks or
your body — they live in Trend/EdgeIQ, not on the card.

### 1a. Per-SESSION metrics → eligible for cards
| Metric | Unit | Needs | Applies to |
|---|---|---|---|
| Distance | mi | GPS | run, cycle(out), swim, walk, ski, race |
| Pace | /mi or /100 | dist+time | run, swim, walk, race |
| Duration | min | — | ALL |
| Avg HR ⟦HERO⟧ | bpm | HR | all w/ HR |
| Max HR | bpm | HR | all w/ HR |
| Effort ⟦HERO⟧ | % max HR | HR+maxHR | all w/ HR |
| Calories ⟦HERO⟧ | kcal | — | ALL |
| Load / rTSS ⟦GAUGE⟧ | rTSS | HR or power | ALL |
| Z1 / Z2 / Z3–4 / Z4–5 time | % | HR zones | all w/ HR zones |
| Cardiac drift | % | HR time-series | steady sessions (run/cycle/row/ski) |
| Aerobic decoupling | % | (pace or power)+HR | run, cycle(power) |
| Aerobic TE | /5 | Garmin | all Garmin aerobic |
| Anaerobic TE | /5 | Garmin | intervals, hiit, strength, race |
| HR recovery (1 min) | bpm | Garmin | intervals, hiit, tempo |
| Cadence | spm/rpm | sensor | run (spm), cycle (rpm) |
| Vertical oscillation | cm | run dynamics | run |
| GAP (grade-adj pace) | /mi | dist+elev | run (hilly) |
| Elevation gain | ft | baro/GPS | run(long), cycle(out), walk, ski, race |
| Avg / Normalized power | W | power meter | cycle(power) |
| Avg speed | mph | dist+time | cycle, (out) |
| Efficiency | W/bpm | power+HR | cycle(power) |
| Sets / Reps | # | FIT sets | strength |
| Work:Rest | ratio | FIT laps | strength, hiit |
| Density / Tonnage | lb/min | template+sets | strength |
| Body-battery drain | pts | Garmin | mobility, any |

### 1b. AGGREGATE / longitudinal → Trend, EdgeIQ, Hub (NOT on cards)
Trend tab (weekly/recovery/body): Weekly Miles, Weekly Hours, Weekly Load, Long Run,
ACWR, Race Predictor, Pace:HR ratio, Z2 Weekly, EPOC, Overnight HRV, RHR (+trend),
Sleep Score, Sleep Regularity, Body Battery (morning), Daily Stress, Training Readiness,
Recovery Hours, Recovery Velocity, Calories/Protein/Carbs/Fat/Fiber, Micros, Sodium,
Weight Trend, Body Fat, Lean Mass, BMI, RMR, TDEE drift, Energy Availability, Glycogen.
Hub: fitness estimate (10K-equiv), heat/response sensitivity, sweat-rate, body/hydration model.
→ These stay where they are. (Pre-/Post-training carbs/protein already feed the **Fuel** block.)

## 2. Per-activity card table
MACRO = the fixed 4 (rendered in priority order; first 4 with data show). MICRO menu =
the coach's pool for that activity; the angle reorders it and the card shows the first 3–4
with data. Nothing here repeats Effort / Avg HR / Calories (hero) or Load (gauge).

| Activity | MACRO (fixed 4) | MICRO menu (coach picks 3–4) | Coach angles |
|---|---|---|---|
| **Easy run** | Distance · Pace · Z2 % · Cadence | Cardiac drift, Decoupling, Aero TE, HR recovery, Z3–4 %, Z1 %, Elevation | aerobic_quality / durability / recovery |
| **Long run** | Distance · Pace · Elevation · Cardiac drift | Decoupling, Z2 %, Aero TE, HR recovery, Z1 % | aerobic_quality / durability |
| **Tempo** | Distance · Pace · GAP · Z3–4 % | Aero decoupling/IF, HR recovery, Aero TE, Max HR, Z4–5 % | threshold |
| **Intervals** | Distance · Z4–5 % · Max HR · Pace | Anaerobic TE, HR recovery, Aero TE, Z3–4 % | intensity |
| **HIIT** | Duration · Max HR · Z4–5 % · Anaerobic TE | HR recovery, Aero TE, Z3–4 %, Cardiac drift, Work:Rest | intensity |
| **Strength** | Sets · Reps · Duration · Max HR | Density/Tonnage, Work:Rest, Anaerobic TE, Aero TE, HR recovery | volume |
| **Mobility** | Duration · Max HR · Body battery · Z2 % | Aero TE, Cardiac drift, Z1 % | recovery |
| **Cycle (power)** | Avg power · Distance · Cadence(rpm) · Avg speed | IF (NP/FTP), Norm power, Efficiency, Cardiac drift, Aero TE | power |
| **Cycle (HR-only)** | Duration · Max HR · Z2 % · Z1 % | Cardiac drift, Aero TE, Z3–4 %, Z4–5 %, HR recovery | recovery / effort |
| **Swim** | Distance · Pace /100 · Duration · Max HR | Z2 %, Aero TE, Z1 %, Cardiac drift | aerobic_quality |
| **Walk / Hike** | Distance · Pace · Elevation · Max HR | Z2 %, Aero TE, Z1 %, Cardiac drift | recovery |
| **Ski** | Distance · Duration · Elevation · Max HR | Z2 %, Aero TE, Z1 %, Cardiac drift | effort |
| **Race** | *(adopts detected sport's macro)* + Finish time | *(detected sport's micro)* + IF, neg-split, place | result |
| **Generic / other** | Duration · Max HR · Z2 % · Z1 % | Aero TE, Cardiac drift, Z3–4 %, HR recovery | effort |

## 3. Data-availability notes (why a tile sometimes drops)
- **Cardiac drift / decoupling** need an HR (and for decoupling, pace/power) time-series.
  A short/flat indoor bike often doesn't yield drift → the card backfills the next micro
  (Aero TE, Z3–4 %). *(This is why drift wasn't on the indoor-bike card.)*
- **Power / NP / IF(power) / Efficiency / Speed / Distance / Cadence** are absent on a
  power-less indoor trainer → the cycle macro falls back to Duration/Max HR/Z2/Z1.
- **Anaerobic TE / HR recovery** are Garmin firmware-dependent; absent → backfilled.
- **Sets/Reps/Density/Work:Rest** need typed FIT set/lap data; older watches may lack it.

## 5. Research-backed additions (sports-science audit, 2025)
What pro/amateur athletes track per session that we should consider. Tagged by
availability: ⟦HAVE⟧ already computed · ⟦PARSED⟧ in our FIT data, no tile yet ·
⟦DERIVE⟧ computable from data we store · ⟦FIT⟧ in Garmin files, parser needed ·
⟦MANUAL⟧ needs user input.

**Endurance (run / cycle / row / ski)**
- **Efficiency Factor (EF = NGP or NP ÷ avg HR)** ⟦HAVE⟧ — the headline aerobic-
  efficiency number; rising EF at equal effort = fitness gain. Surface on the card.
- **Aerobic decoupling (Pw:Hr / Pa:Hr)** ⟦HAVE⟧ — <5% = sound aerobic base. Keep.
- **Durability / fatigue resistance** ⟦DERIVE⟧ — the 2025 hot topic: efficiency/
  decoupling in the LAST third vs first third of long efforts. Add a "fade %" read
  on long runs/rides.
- **Running dynamics — Ground Contact Time, Vertical Ratio, Stride Length** ⟦PARSED⟧
  — already in our FIT output (avgGroundContactTime / avgVerticalRatio / avgStrideLength),
  no tiles yet. Vertical ratio is the cleanest running-economy proxy.
- **Variability Index (VI = NP ÷ avg power)** ⟦DERIVE⟧ (cycle) — pacing evenness; ~1.0
  steady, >1.1 surgy.
- **VO₂max (per-session estimate)** ⟦FIT⟧ — Garmin re-estimates each outdoor run/ride.
- **Respiration rate (avg/max)** ⟦FIT⟧ — increasingly used as an internal-load signal.
- **Leg-spring stiffness** ⟦FIT/Stryd⟧ — running-economy trend (needs Stryd/parser).
- **Peak-effort splits** (best 5s/1/5/20-min power, fastest mile) ⟦DERIVE⟧ — session bests.

**Strength**
- **Estimated 1RM (Epley/Brzycki from top set)** ⟦DERIVE⟧ — if weight is logged; the
  practical strength-progress metric.
- **Session tonnage / density / work:rest** ⟦HAVE⟧ — keep.
- **Velocity-based (bar speed, e1RM by velocity)** ⟦MANUAL/device⟧ — needs a VBT tool.

**Universal — strongest single addition**
- **Session-RPE load (RPE × duration, Foster CR-10)** ⟦MANUAL⟧ — 36+ studies validate
  it across sports/levels; the simplest robust internal-load metric and it works for
  EVERY activity (yoga, lifting, intervals). Needs a one-tap RPE prompt post-session.

## 6. Aggregate metrics that ARE per-session relevant
These usually live in Trend but are attributable to one session, so they can frame a card:
- **Aerobic / Anaerobic Training Effect** ⟦HAVE⟧ — already per-session.
- **VO₂max estimate** ⟦FIT⟧ — updates from this session.
- **EPOC / Training Load (Firstbeat)** ⟦FIT⟧ — this session's excess O₂ cost.
- **Body-battery drain** ⟦HAVE⟧ — this session's cost.
- **Training Readiness (pre-session)** ⟦HAVE⟧ — frames "trained at 83 readiness."
- **This session's ACWR contribution** ⟦DERIVE⟧ — how much this load moved acute load.

## 7. Recommendation (what to build)
1. **Now (low-risk, data on hand):** add tiles for Ground Contact Time, Vertical Ratio,
   Efficiency Factor (run), Variability Index (cycle); add to the run/cycle menus.
2. **Next (derive):** Durability/fade on long sessions; Estimated 1RM on strength.
3. **Bigger (your call):** Session-RPE one-tap capture (highest value, needs UI);
   parser support for VO₂max + respiration rate.

## 4. Open decisions for you
1. Approve the MACRO 4 per activity (left column) — change any?
2. Approve / prune the MICRO menus (middle column).
3. Cycle: keep one card that auto-splits power vs HR-only (as above), or two explicit cards?
4. Anything from §1b you actually want surfaced on a card (e.g. Training Readiness on every card)?
