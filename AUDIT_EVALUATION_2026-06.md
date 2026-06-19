# Arnold — Audit Evaluation & Progress Review (2026-06-14)

> Companion to `PRODUCT_AUDIT_2026-06.md`. Goes finding-by-finding against the audit,
> grades each on what's actually shipped (verified against the code, not the plan board),
> re-scores the audit's scorecard, and lists the work that remains. Written in the audit's
> own spirit — no flattery, claims grounded in the source.
>
> Status key: ✅ Addressed · ◐ Partial · ☐ Open · ＊ Out of scope / not a defect

---

## 0. Verdict — has the uplift been successful?

**Yes, decisively, on the half the audit said was broken.** The audit's one-line summary was
"an A-grade brain inside a C-grade body … the work ahead is almost entirely about the body."
Every Tier-0 foundation and every Tier-1/Tier-2 differentiator the audit prioritized has
shipped and been build/test-verified. The headline structural finding — the **11,800-line
monolith** — is now **2,050 lines** with ~60 extracted, individually-loadable components, and
the duplication-driven bug class (the audit's "#1 defect generator") is closed at the source.

What remains is genuinely the long tail: full visual/web-mobile parity (diminishing
returns), component/snapshot tests + CI, and three small functional debts. None of it is
load-bearing for the credo. **The brain is unchanged (still A); the body has moved from a
C to roughly a B/B+.**

---

## 1. Functional findings (audit §2)

| # | Finding (audit rating) | Status | Evidence |
|---|---|---|---|
| 2.1 | Intelligence real but **under-surfaced** | ✅ | `components/LearnedHero.jsx` — confidence-aware "what Arnold's learned about you" promoted to a first-class surface on Daily/Play (Step 1.1). The exact "demo that wins" the audit named. |
| 2.2 | **Loop open** — engine predicts, plan doesn't adapt | ✅ | `core/adaptPlan.js` + `core/todayAdaptation.js`: readiness/debt/fatigue → today's session eases (Z2, −vol) with the reason shown on the pre-workout tile; weekly strip shows a ⤵ marker (Step 2.1). Scorekeeper → coach. |
| 2.3 | **Nutrition ingested but not prescriptive** | ✅ | `core/fuelForWork.js` (+9 tests): pre-carbs / during-fuel / recovery-protein / low-EA flag, surfaced as CARB·PRO·EA chips on the pre-workout card (Step 2.2). The Fuelin/MAVR whitespace. |
| 2.4 | **Coaching fragmented — no single voice** | ✅ | Consolidated on one rendered composer (`CoachComment`); `CoachBeta`/`CoachLine` retired from render. One `computeUserState` pass, surface-aware focus (Step 1.2). |
| 2.5 | **Coach reacts to noise, not events** (living coach) | ✅ | Living time-of-day × session-state model on `composeDigest`/`classifyPlayState`; morning-forward fix so the Start coach faces forward instead of "sleep at 8am" (Step 1.2). |
| 2.6a | Max HR colored inconsistently across surfaces | ✅ | Resolved via the token unification (§3.3) + neutral Max-HR treatment; one source for status color. |
| 2.6b | sRPE captured but only **partially wired** into load | ◐→✅ | `trainingStress.js` now imports `srpeEquivRTSS` and blends sRPE into the session metric / daily score (RPE-load wins when it exceeds HR-load). Substantially closed for load; whether it should also feed the ACWR acute/chronic series specifically is a judgment call, not a bug. |
| 2.6c | **Planned miles not feeding** weekly/annual projections | ☐ | No code path found wiring planned distance into weekly/annual projection. Still open (small). |
| 2.6d | Logged bike/swim/walk first-class but **completion matching loose** | ◐ | Start post-workout card (`PlannedWorkoutTile`) fixed R63 — cycle/swim/ski/walk now flip to the post-workout summary + get HR-based load. Play/Daily (`LogDay`) still has gaps: **ski missing from its `PROFILES`** (falls back to a run layout) and a **run-centric "Vs Goal"** for these sports. |

**Functional verdict:** 5 of 6 substantive items fully addressed; 2.6c open and 2.6d half-done.
The audit's Tier-1 and Tier-2 (the differentiators) are complete.

---

## 2. Visual & UX findings (audit §3)

| # | Finding (audit rating) | Status | Evidence |
|---|---|---|---|
| 3.1 | Bespoke not systematic → **per-screen churn** | ◐ | Token system shipped (Step 0.1); shared `MetricTile` exists and mobile uses it. The remaining piece — a `<Card>`/`<SectionHeader>` primitive + migrating `PlannedWorkoutTile` — is deliberately **not** done: that card is the churn epicenter (~13 rounds) and `DESIGN_DECISIONS.md` counsels against reopening it. So the *churn* is contained even though the primitive isn't universal. |
| 3.2 | **Metric overload** vs 2–3-hero best practice | ✅ | Desaturation pass across all 3 health grids; one readiness "verdict" hero on both Daily and Play (Step 3.1). Colored-number count cut to status/trend only. |
| 3.3 | **Color doing too many jobs, 4 disagreeing sources** | ✅ | `src/theme/tokens.js` is the single source (CATEGORY/STATUS/BRAND); the 4 copies (`FAMILY_COLOR`, `planner.DAY_TYPES`, `PlanPickerModal.OPTIONS`, `metricRegistry.COLOR`) now read from it (Step 0.1). Whole bug class (intervals `#f87171` vs `#fbbf24`, Max-HR yellow) removed at root. |
| 3.4 | **Two front-ends drift** (web vs mobile) | ◐ | Shared presentation layer landed: `readinessVerdict`, `healthStatusColor`, `healthFillTint`, unified `HealthSystemTile`; R63 brought the Start post-workout card to discipline parity. Still open-ended — other duplicated surfaces remain (Play/Daily cards next), diminishing returns. |
| 3.5 | What's already good (keep/amplify) | ＊ | Low-poly/dark brand, coach-driven card, rTSS speedometer + rings hero — all retained. |

**Visual verdict:** the color/hierarchy roots are fixed; full parity and a universal card
primitive are the honest remaining gaps, both with deliberately diminishing returns.

---

## 3. Architecture & code-health findings (audit §4)

| # | Finding (audit rating) | Status | Evidence |
|---|---|---|---|
| 4.1 | **The monolith** (~11,800 lines) | ✅ | `Arnold.jsx` is **2,050 lines** (verified). `LogDay`, `EdgeIQ`, `TrainingTab`, `ClinicalModule`, `LabsModule`, `WebSystemDetail`, `ProfileSettings`-adjacent panels, etc. all extracted to ~60 component files (Step 0.5, rounds 38–59). The mount-truncation pain the audit attributed to file size is correspondingly reduced. |
| 4.2 | **Duplication that silently diverges** (#1 defect generator) | ✅ | One signature map (`core/activitySignatures.js`), one classifier (ski/walk folded into `activityClass.js`), one plannable-types list (PlanPicker derives from `planner.DAY_TYPES`), tokens unified (Step 0.3). The "one source of truth per concept" law is now honored for these. |
| 4.3 | **Styling has no system** | ◐ | Tokens + `S` style object centralized; CSS-var usage more consistent. A fully enforced shared `<Card>`/`<Tile>` primitive is still partial (same item as 3.1). |
| 4.4 | **Testing & verification** (one test) | ◐ | From 1 Node test → **8 vitest suites (~40+ cases)** around the core math (adaptPlan, fuelForWork, activityClass, signatures, tokens, readiness/health tokens, todayAdaptation) (Step 0.4). Still **no component/snapshot tests** and **no CI** — the audit's "snapshot tests around the tiles" remains open, and build is still a manual Windows step. |
| 4.5 | Strong: core modular + local-first | ＊ | Unchanged and intact; the decomposition reinforced it. |

**Architecture verdict:** the two findings the audit graded lowest-impact-but-highest-pain
(monolith, duplication) are **fully resolved**. Test rigor improved a full grade but is the
clearest remaining architectural gap.

---

## 4. Re-scored scorecard (audit §6 → today)

| Dimension | Audit grade | Today (est.) | Why it moved |
|---|---|---|---|
| Concept / vision | A | **A** | Unchanged — was never the problem |
| Core engine / math | A− | **A−** | Unchanged; sRPE wiring a minor plus |
| Differentiation potential | A | **A** | Unchanged; now actually *surfaced* (LearnedHero) |
| Functional completeness | B− | **A−** | Loop closed (2.1), nutrition prescriptive (2.2), coach unified (2.4/2.5); only 2.6c + half of 2.6d remain |
| Visual design | C+ | **B** | Token system + desaturation + one-hero; brand retained. Held from B+ by the missing universal card primitive |
| UX / information design | C | **B** | Differentiator promoted to hero; metric overload cut |
| Architecture / maintainability | C− | **B+** | Monolith gone (11.8k→2.05k), duplication collapsed; held from A− only by the partial styling primitive |
| Test / verification rigor | D | **C+** | 1 → 8 suites of core-math tests; held back by no component/snapshot tests + no CI |

**Net:** the audit's "A-grade brain in a C-grade body" is now an **A-grade brain in a B/B+
body.** Every dimension the uplift targeted moved up; the two that didn't (Concept, Core
engine) were already A's.

---

## 5. Additional work that remains (prioritized)

**Small functional debts (finish the audit's §2.6):**
1. ☐ **Planned miles → weekly/annual projections** (2.6c) — wire planned distance into the
   projection so the annual/weekly view reflects intent, not just completed work. Small.
2. ◐ **Play/Daily card discipline parity** (2.6d, continues R63) — add `ski` to `LogDay`'s
   `PROFILES` (today it falls back to the run layout) and replace the run-centric "Vs Goal"
   (weekly miles / run pace) with sport-appropriate goals for cycle/swim/ski/walk.

**Polish / parity (audit Tier 3, diminishing returns):**
3. ◐ **True web/mobile parity** (3.4) — continue unifying duplicated surfaces off the shared
   presentation layer as they're found.
4. ◐ **Universal `<Card>`/`<SectionHeader>` primitive** (3.1/4.3) — the last styling-system
   piece. Note: touching `PlannedWorkoutTile` is the churn risk `DESIGN_DECISIONS.md` warns
   about; do it only with a clear before/after and Emil's sign-off.

**Test rigor (audit §4.4 — the clearest remaining architectural gap):**
5. ☐ **Component/snapshot tests** around the tiles + **CI** so "one number, shown identically"
   is enforced automatically rather than by manual Windows builds. The core is pure and
   already partly covered; the tiles are not.

**Not defects (no action):** Concept, Core engine, Differentiation, local-first, and the
brand assets the audit said to keep.

---

## 6. Honest caveats on this evaluation

- Grades for **Visual / UX** are inherently subjective and **build-verified by Emil**, not by
  this evaluation — the code changes are confirmed present and esbuild/test-clean, but "does
  it *look* a tier better" is Emil's call on a device.
- "Successful" here means *the audit's prioritized work shipped and verifies clean*. It does
  **not** claim market outcomes — the audit's thesis (transparency as the wedge) is now
  *surfaced* and testable with real users, which is the next kind of validation.
- Test count is ~40+ cases across 8 suites (measured), covering core math; the absence of
  UI/snapshot coverage is the reason Test rigor is graded C+ not B.
