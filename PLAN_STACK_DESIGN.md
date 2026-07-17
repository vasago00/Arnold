# PLAN_STACK_DESIGN.md — the Plan tab as a growing annual STACK (2026-07-13)

> **Origin (Emil, 2026-07-13).** Evolve the Plan tab (and quiet Trend) from analytical walls
> of text into a **growing stack**: through the year you build layers; on **Jan 1 the stack
> drops to the ground and becomes a thin new floor** you build on again. A gamified, visual,
> compounding experience — to attract new generations without losing the serious athlete.
> This is a STARTER doc — to be developed with mocks (mock-first). It is the sibling of
> `COACH_NARRATIVE_DESIGN.md`: **the Stack renders the Plan-surface coaching beats.**

---

## 1. Why a stack (not a gimmick)

- **Physiologically honest.** Endurance fitness compounds over years — last year's peak is
  this year's floor. You don't restart at zero; you restart *higher*. The stack is a true
  picture of annual periodization + carried-over aerobic base.
- **The Jan-1 drop = consolidation, not loss.** The year's layers compress into a thin, taller
  base you step onto and build from again. A yearly ritual/reveal — the emotional hook.
- **It's the visual body of the coach's memory.** Each layer is *earned* adaptation. The
  Coach Narrative engine's Plan-surface beats (trajectory, weak link, phase why, conflicts)
  are what the Stack renders and the coach narrates.

## 2. The non-negotiable tension

The core user is the **analytical, educated athlete** (`DESIGN_LESSONS` §1) who bristles at
Duolingo-style toy mechanics. The Stack must be **executive + information-dense**: every layer
*means* something (real volume / quality / adaptation), beautiful AND rigorous. Get this
balance and it's a differentiator; miss it and it reads as a toy and alienates the base.
Rule: **no points/badges for their own sake — every visual element encodes real data.**

## 3. Layer grammar (draft — to mock)

A **layer** = a completed block of earned adaptation. Candidate encodings (pick with mocks):

- **Height** = volume/load accumulated in the block (real mi / TSS).
- **Color/material** = the block's dominant stimulus (base=blue, threshold=amber,
  durability/strength=purple, sharpening=coral, race=red) — reuse the app palette.
- **Width/solidity** = consistency (sessions hit vs planned) — a flaky block is thinner/cracked.
- **A capstone** = a race or a PR (a marker embedded in the layer at its date).
- **The weak link** = a visible notch/gap the current block is working to fill (ties to
  `raceRecipe.weakLink`).

The stack reads top-down as "your year so far"; the coach narrates the newest layers.

## 4. The Jan-1 drop (the ritual)

- What **persists**: the *base floor* height carries over = your retained fitness (not zero).
- What **resets**: the visual stack + streak counters + the year's layer set.
- The **moment**: an animated compression/settle → a new thin foundation, with a coach
  retrospective ("last year you built X; you carry Y into this one; the gap to close is Z").
- Design so it feels **rewarding** (a year consolidated into a higher floor), never punishing.

## 5. How it renders the coach

Per `COACH_NARRATIVE_DESIGN.md` §7/§13, the Plan surface selects the strategic beats
(trajectory / conflicts / volume + phase why / weak link). The Stack is their *visual*; the
coach line is their *voice*. Because both come from the one beat engine, the Stack and the
coach never disagree, and **Trend can go quiet** (its multi-week story folds into the Stack's
history view) — surfaces stop duplicating.

## 6. Open questions (to resolve with mocks)

1. Layer = a periodization block, a month, or a "training effect" earned? (Leaning: block.)
2. How to show the *current* in-progress layer growing in real time vs completed layers.
3. Mobile vs web: the full stack on web; a compact "tower" glance on mobile?
4. Streaks/gamification: how far to lean in for "new generations" without going toy.
5. Does the drop happen exactly Jan 1, or at the athlete's season boundary (post-A-race)?

## 7. Status

Vision captured. NEXT: mock the stack + a layer + the drop (visualize widget), get Emil's
sign-off, then it becomes the Plan renderer in Coach Narrative **Phase G**. Not started —
gated behind Phase B (the engine) so the beats it renders exist first.
