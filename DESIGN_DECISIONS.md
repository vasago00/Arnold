# DESIGN_DECISIONS.md — binding rules (read EVERY session, treat as law)

> Purpose: stop re-litigating settled decisions and stop building the big version
> when Emil asked for the small fix. Any new Cowork/Claude session reads this
> BEFORE touching the UI. When a rule is wrong, Emil corrects the rule here ONCE
> and it stays fixed. Newest decisions appended at the bottom of each section.

## How I (Claude) must work here
- **Do the smallest change that satisfies the literal ask.** Don't infer extra scope.
- **Before anything beyond a small fix, restate the ask + my plan in ONE line and wait for "yes."**
- **One source of truth per number.** A metric is computed once and shown identically everywhere (Daily, EdgeIQ, Trend). Never two functions for the same value.
- **Verify, don't claim.** A source edit isn't "fixed" on Emil's screen until he rebuilds; say so.
- **Match the existing visual language** (boxed tiles, the app's tokens) — don't introduce new patterns unasked.

## Activity card — structure (LOCKED)
- **Hero band** (top, universal on every activity): LEFT = Training Readiness 7d/30d + A:C ratio · CENTER = rTSS speedometer (load + zone word) · RIGHT = 3 universal metrics **HR Effort · Avg HR · Calories**. The right rail never changes by sport.
- **Card body:**
  1. **Macro metrics** — the **4** discipline basics (fixed per activity). Keep this; Emil likes it.
  2. **Details** — the per-activity SUB-metrics. **This includes user-logged RPE and Added Load** — they are *details*, NOT their own section. Aim for a **consistent set count** per activity (don't leave it at 2 when the pool has more).
  3. **Fuel** — Fuel & Fluids + Replenish under ONE "Fuel" header (stacked, vertical — NO swipe panes; reverted 2026-06-09).
  4. **Vs Goal / Vs usual** — below Fuel.
- **NO narrative / directional writing on the card.** Numbers, tiles, visuals only. The ONLY place narrative/coaching analysis belongs is the **Coach** voice (CoachComment / top-right panel).

## Things explicitly REMOVED / rejected (don't re-add without asking)
- The "≈ in oz" hydration tile (redundant with litres).
- The Replenish "X/Y · NN%" summary badge (per-tile ✓ checkmarks are enough).
- The manual "Log post-run weight" button (sweat model auto-reads synced weigh-ins).
- The per-card coach line (coaching voice lives in the Coach, not the card).
- Fuel·Goals **swipe panes** (built then reverted — Emil: that was "the wrong piece").

## Naming / labels (LOCKED)
- Speedometer effort tile = **"HR Effort"** (measured). Perceived effort = **RPE** (logged on the card). They're complementary; keep both, keep them distinct.

## Open / not yet decided
- Visual primitives for the card (HR-zone bar / effort rings / sparklines) — Emil wants to see the layout land before choosing.
- Tap-to-expand on the 4 macro tiles — agreed in principle, not built.
- "Set number" of Details per activity — confirm the target count with Emil.
