# Arnold — Modeling & Coaching Updates (2026-07)

Snapshot of what changed in the modeling/coaching layer this cycle, **where each
improvement surfaces in the UI**, and the **Monte-Carlo pressure-test results**.
Companion to `HANDOVER.md` (state), `SPRINT_PLAN_2026-06.md` (plan), `POSTMORTEMS.md`
(bugs), and `ROADMAP_NEXT_2026-06.md` (§B flagship direction).

---

## 1. What improved, and why it matters

**One coach voice.** Training phase/taper was computed by three engines that could
disagree. Collapsed onto one source (`seasonPlan.racePhase`); all surfaces delegate;
dead duplicate (`phaseForWeeksOut`) removed; a delegation test *proves* the three
agree. → No self-contradiction across Calendar/Plan/Start, and the prerequisite for
a plan that re-solves without arguing with its own phase call.

**The coach reasons from goals, not scattered metrics.** Goals were a flat bag +
a separate races store + derived bits, read ad hoc. Now one structured model
(`core/goalResolve.js` → `buildGoalModel`): race (A-race, tune-ups, feasibility),
training, body (direction + loss-rate + deadline), nutrition (+ EA floor), each with
a *horizon*. → From "observer of numbers" toward "reasoning about what you're trying
to achieve, by when." Built with clean seams (pure inputs, no user-specific
constants) so it generalizes to any athlete.

**Conflicts surfaced with trade-offs; the user decides.** The model detects goals in
tension — cut-vs-race, aggressive-cut-vs-training, goal-time-vs-fitness — and spells
out the cost of *each* choice. The coach never silently picks; it stores the user's
decision (`get/setGoalResolution`). → The essence of "coach, not scorekeeper," and
the foundation for the flagship live re-solve.

**Daily prescription: adaptive, fueled, honest.** Session adapts to readiness *with
the reason shown*; fuel is prescribed per session (pre-carbs, recovery protein,
RED-S/low-EA flag); "what Arnold learned about you" is a hero with confidence shown
as a distribution; confidence chips woven into RMR / Race Predictor / energy tiles.

**More correct numbers.** Calorie eat-back now stacks *on top of* the RMR floor
(training days replenish) — extracted to a pure, tested `composeCalorieTarget`. The
fuel 7-day trend uses the same effective target as the header (surplus days show).
Plus data-integrity: duplicate-activity guard, reliable cross-device sync, and a
`__arnoldDiag` self-check layer.

**Pressure-tested engine.** A Monte-Carlo harness runs the *real* engine over
thousands of synthetic athlete-days asserting invariants with *measured* margins
(§3). Everything runs under one command — 322 tests green.

---

## 2. Where you SEE it — UI-surface map

The honest picture: the **daily coaching** improvements are live on Start / Daily /
Fuel. The **newest, most strategic** work (goal model + conflicts) is currently
**engine-only** — its UI is the next slice (3.1c). Reliability work (sim,
diagnostics) is intentionally not user-facing.

| Improvement | Where it shows | Status |
|---|---|---|
| Adaptive session + reason | `PlannedWorkoutTile` — mobile Start pre-tile **and** web Daily: adjusted distance/time chips, "Z2" ease cue, Cleared/Adapted coach line | **LIVE** |
| Prescriptive fuel + RED-S/low-EA flag | `PlannedWorkoutTile` fuel band: pre-carbs · PM protein · color-coded EA chip + tooltip | **LIVE** |
| Learned-about-you + confidence (bell curves) | `LearnedHero` hero card, web Daily | **LIVE** |
| Confidence chips (RMR, Race Predictor, energy) | mobile Start tiles (`MetricTile`) + energy Σ dot (`EnergyTimingChart`) | **LIVE** |
| Calorie target replenishes on training days | daily calorie-target number (Start / Fuel header) | **LIVE** |
| Fuel 7-day trend deficit/surplus colors | Fuel tab → Energy Balance trend | **LIVE** |
| One coach voice (phase/taper consistency) | Calendar / Plan / Start coaching agree | **LIVE** (invisible correctness) |
| **Unified goal model** | — not yet rendered | **ENGINE-ONLY** |
| **Goal conflicts + trade-offs (user decides)** | planned: a GoalsHub conflict card showing both trade-offs + tap-to-choose | **PENDING UI → 3.1c** |
| Self-check diagnostics | `window.__arnoldDiag()` console; future in-app "⚠ N issues" banner | **DEV-ONLY** |
| Monte-Carlo sim | test suite + `npm run sim` | **DEV/CI** (reliability, not user-facing) |

**Takeaway / next UI work:** the goal-model + conflict engine (3.1a/b) delivers real
value only once the user can *see* a conflict and pick a side — that's **3.1c** (the
GoalsHub conflict card + explicit A-race pick + deadlines). It's the priority UI
slice so the modeling doesn't sit invisible. After that, 3.2/3.3 surface the
coach-owned plan and the live re-solve.

---

## 3. Monte-Carlo pressure test — results & how to run

**What it does.** Generates synthetic athletes from documented physiology
distributions (sex, age, weight, body-fat → LBM/RMR, HRmax, HRV baseline, sleep,
fitness), walks each through an autocorrelated random-walk day-stream, and runs the
**real** engine (`adaptSession`, `prescribeFuel`, `composeCalorieTarget`) on every
day — asserting HARD invariants (zero-tolerance contracts) and STATISTICAL
properties (distribution expectations with explicit, rationale'd margins). Seeded →
reproducible. Files: `src/core/sim/` + `sim.test.js`; heavy runner
`scripts/simHeavy.mjs`.

**Results (10,000 cases = 400 athletes × 25 days, in the CI suite):**

- **Hard invariants: 0 violations** (after the sim-caught fix below).
- Adaptation mix: **ease 24.1% · trim 1.1% · hold 74.6% · greenlit 0.1%**.
- Hard sessions on a low-readiness day that got eased/trimmed: **100%** (n ≈ 2,214)
  — the coach always backs off a hard day when depleted.
- Low energy-availability flagged: **~24–25%** (the RED-S path is exercised, not dead
  or stuck-on).
- Calorie target range: **1,113 / 2,659 / 5,395** kcal (min/mean/max) — all
  physiologically plausible.
- **Stable across 3 seeds:** greenlit 0.14–0.23%, low-EA 24–25%, hard-low-readiness
  eased 100%.

**Issues it caught (its whole point):**
1. `adaptSession` was green-lighting **mobility/recovery** days (only `type==='rest'`
   was short-circuited) → fixed with a proper recovery-type guard; re-run 0/10,000.
2. **Our own bad margin** — the greenlit floor was guessed at 2%; the engine
   correctly greenlights only ~0.15%. Re-measured across seeds and calibrated. This
   is the "genuine tests + acceptable margin of error" discipline enforcing itself on
   us, not just the code.

**How to run more (Emil's "as much as feasible"):**

```
cd arnold-app
npm test            # CI guard — 10k cases, fast, deterministic, every run
npm run sim         # heavy sweep — 20,000 athletes × 30 days = 600k cases, random seed
npm run sim 100000 30      # 3,000,000 cases
npm run sim 20000 30 12345 # fixed seed (reproduce a specific run)
```

The heavy runner prints throughput (cases/s), the output distributions (eyeball for
plausibility), and any violation with the **seed + indices to reproduce it exactly**.
Exit code is non-zero on any violation, so it can gate a release. Because the default
seed is random, each heavy run explores fresh ground — run it liberally; a real
failure is reproducible from the printed seed.

**Roadmap for the sim (3.1d → 3.4):** extend it from single-day invariants to
*goal-model* invariants (model always well-formed, conflicts detected, priority a
valid order) and eventually *plan-level* invariants for the flagship re-solve (never
breaks the ACWR ramp cap, never stacks back-to-back hard on low readiness, keeps the
goal reachable-or-flags-it).
