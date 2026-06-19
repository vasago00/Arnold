# Arnold — Audit Re-Evaluation v2 (2026-06-14)

> A full re-run of the assessment in `PRODUCT_AUDIT_2026-06.md`, scored against Arnold's
> **current** state after this session's work (supersedes `AUDIT_EVALUATION_2026-06.md`, which
> was written mid-uplift). Finding-by-finding, re-graded scorecard, refreshed industry comparison
> + expectations. Arnold claims are verified against the code; competitor facts are as of the
> 2026-06 research in `UX_UI_REVIEW_2026-06.md`. Written in the audit's spirit — no flattery.

Status key: ✅ Addressed · ◐ Partial · ☐ Open/parked · ＊ Not a defect

---

## 0. Verdict — what's changed since the audit

The audit's thesis was **"an A-grade brain inside a C-grade body — the work is almost entirely the
body."** That work is now largely done on **three of the body's four systems**: the architecture is
rebuilt, the engine's loop is closed and its data model simplified, and there's a real automated
test net. The **fourth — visual/UX — is the remaining frontier**: its *strategy* is now fully
settled (a platform IA contract, a "governed density" doctrine, and screen mockups) but **not yet
implemented** — deliberately parked by Emil so the structure is locked before pixels.

Concretely, the headline architecture finding — the **11,800-line monolith — is now 2,037 lines**
(‑83%) across 62 focused components, and the duplication that generated bugs is collapsed to single
sources. Tests went from **1 → 59** (with component/snapshot coverage of the shared tiles) plus
**CI on every push/PR**. The energy model was corrected (a real ~80× NEAT bug + a workout
double-count, both fixed), Health Connect was retired in favor of a single Garmin source that now
**auto-refreshes**, and every small functional debt the audit listed is closed.

**Net: the brain is still an A. The body has moved from a C to roughly a B+ — held back from
A‑territory only by the still-unbuilt visual layer, which is now designed and queued.**

---

## 1. Functional findings (audit §2) — current state

| # | Finding (audit) | Status | Evidence (today) |
|---|---|---|---|
| 2.1 | Intelligence under-surfaced | ◐→ridge | `LearnedHero` ships on Daily/Play; the *full* "transparency as hero" promotion is designed (cockpit Start, `start-cockpit.html`) but parked with the visual track. Built, not yet hero. |
| 2.2 | Loop open (plan doesn't adapt) | ✅ | `adaptPlan` + `todayAdaptation`: readiness/debt/fatigue → today's session eases with reason; weekly ⤵ marker. Scorekeeper → coach (day-level). |
| 2.3 | Nutrition not prescriptive | ✅ | `fuelForWork.js` (+tests): pre/during/recovery + low-EA flag as CARB·PRO·EA chips. |
| 2.4 | Coach fragmented — no single voice | ✅ | One rendered composer (`CoachComment`); others retired. |
| 2.5 | Coach reacts to noise, not events | ✅ | Living time-of-day × state model; morning-forward fix. |
| 2.6a | Max HR colored inconsistently | ✅ | Token unification + neutral Max-HR treatment. |
| 2.6b | sRPE only partially wired | ✅ | `trainingStress.js` blends sRPE into the session metric/daily score. |
| 2.6c | Planned miles not in projections | ✅ | **A2** — annual run projection now uses the planner's actual run miles (`getPlannerWeek`) when a plan exists, else the goal target. |
| 2.6d | Logged bike/swim/walk "completion matching loose" | ✅ | **A1 + R63** — Start post-workout card flips for cycle/swim/ski/walk (`matchFamily` + HR-load); LogDay gained a `ski` profile + sport-appropriate Vs Goal. |
| — | **NEW since audit: energy model corrected** | ✅ | `#2` fixed a ~80× NEAT coefficient bug + a workout double-count; NEAT is now steps-driven (`restingTdee` baseline; workouts counted once via eat-back). |
| — | **NEW: data model simplified** | ✅ | `#1` Garmin is the single steps/energy source on every platform; **Health Connect retired**; `#68` Garmin **auto-refreshes** (boot + foreground + 30 min) — no manual pull. |

**Functional verdict:** every §2 debt is closed; the engine's data model is now simpler and more
correct than at audit time. The *only* functional frontier left is the **Coach → planner/guide +
live re-solve** ambition (roadmap #3/#4) — net-new capability, not a debt, and design-coupled.

---

## 2. Visual & UX findings (audit §3) — current state

| # | Finding (audit) | Status | Evidence (today) |
|---|---|---|---|
| 3.1 | Bespoke not systematic → churn | ◐ | Token system shipped; churn contained. A universal `<Card>`/`<SectionHeader>` primitive is **designed, parked**. |
| 3.2 | Metric overload vs 2–3-hero | ◐→reframed | Desaturation shipped. **Emil rejected the "one hero" consumer convention** in favor of a **governed-density** doctrine (the ownable wedge: intervals.icu depth + WHOOP legibility). Doctrine + EdgeIQ prototype done; not yet implemented. |
| 3.3 | Color from 4 disagreeing sources | ✅ | `src/theme/tokens.js` is the single source; the 4 copies read from it. Bug class removed. |
| 3.4 | Two front-ends drift | ◐ | Shared presentation primitives landed; **a settled platform IA contract** (`PLATFORM_IA_2026-06.md`) now governs both surfaces. Full parity implementation parked. |
| 3.5 | What's good (keep) | ＊ | Low-poly/dark brand, coach-driven card, speedometer hero — retained. |

**Visual verdict: this is the remaining frontier, and it's honest to say the *shipped* visual
product hasn't moved much since the last eval — but the *strategy* has gone from "ideas" to a
locked contract + doctrine + mockups.** The product is now in the best possible position to execute
a visual uplift: it knows exactly what to build (Start cockpit, governed-dense EdgeIQ, the spine
Start·EdgeIQ·Play·Fuel·Calendar) and on what system (tokens, shared tiles, a test net to refactor
against). The C+ → consumer-tier jump is *designed and de-risked*, not yet rendered.

---

## 3. Architecture & code health (audit §4) — current state

| # | Finding (audit) | Status | Evidence (today) |
|---|---|---|---|
| 4.1 | The monolith (~11,800 lines) | ✅ | **`Arnold.jsx` = 2,037 lines** (‑83%); 62 components extracted (LogDay, EdgeIQ, TrainingTab, Clinical/Labs, WebSystemDetail, …). The "mount-truncation pain" the audit tied to file size is correspondingly reduced. |
| 4.2 | Duplication that diverges (#1 defect generator) | ✅ | One signature map, one classifier, one plannable-types list, one token source. The law is honored. |
| 4.3 | Styling has no system | ◐ | Tokens + shared `S`/`MetricTile`; a fully-enforced `<Card>`/`<SectionHeader>` primitive is the last piece (parked with the visual work). |
| 4.4 | Testing & verification (one test) | ✅ | **59 tests / 11 suites** — core math + classifiers + **component/snapshot tests on the shared tiles** — plus **CI** (`.github/workflows/test.yml`) running build + test on every push/PR (on Linux, dodging the Windows-rollup issue). The audit's "snapshot tests around the tiles" is delivered. |
| 4.5 | Strong: core modular + local-first | ＊ | Reinforced — the decomposition made the brain/view split explicit. |

**Architecture verdict: the two lowest grades in the audit (monolith, duplication) are fully
resolved, and the third (testing) jumped from a D to a genuine automated gate.** Styling-system is
the only ◐, and it's coupled to the parked visual work. Architecture is now a strength, not a risk.

---

## 4. Re-scored scorecard (audit → last eval → now)

| Dimension | Audit | Last eval | **Now** | Why it moved since last eval |
|---|---|---|---|---|
| Concept / vision | A | A | **A** | Unchanged |
| Core engine / math | A− | A− | **A** | Energy model corrected (NEAT bug + double-count), sRPE wired, single clean data source |
| Differentiation | A | A | **A** | Data model simplified; transparency now *designed* as the hero |
| Functional completeness | B− | A− | **A−** | All §2.6 debts closed (A1/A2), HC retired, auto-refresh; only the (net-new) coach-planner ambition remains |
| Visual design | C+ | B | **B** | No new pixels shipped (parked); strategy locked but unbuilt — honestly flat |
| UX / information design | C | B | **B** | Same — settled IA contract + density doctrine de-risk it but don't yet change the live product |
| Architecture / maintainability | C− | B+ | **A−** | Monolith fully gone (11.8k→2.0k), dedup complete, HC removed = less surface |
| Test / verification rigor | D | C+ | **B+** | Component/snapshot tests + CI on push/PR — a real automated "one number, shown identically" gate |

**Net:** the audit's "A-brain / C-body" is now **A-brain / B+ body**. Architecture and tests are
genuinely strong; functional completeness is high; **visual/UX is the single dimension still sitting
where it was — and it's the one with a fully-drawn plan ready to execute.**

---

## 5. Industry comparison & expectations (refreshed)

*(Competitor facts as of the 2026-06 cited research in `UX_UI_REVIEW_2026-06.md`.)*

**Where Arnold now sits, by camp:**
- **vs Analytics (intervals.icu, TrainingPeaks, Runalyze):** Arnold matches/exceeds on load/readiness
  depth AND adds nutrition + learned personalization + a coach voice they lack — and is now
  comparably *engineered* (modular, tested, CI). Its disadvantage vs them was never depth; it was
  polish, which is the parked track.
- **vs Recovery (WHOOP, Oura, Athlytic):** Arnold's engine is deeper and — critically — its scores
  are *explainable*, the exact gap the whole category is criticized for (Oura's own advisor calls
  these scores "made up"). Arnold computes the attribution; what's missing is surfacing it as the
  hero. WHOOP/Oura still win on **consumer visual polish** — the frontier Arnold has now *designed*
  to close on its own terms (governed density, not imitation).
- **vs Adaptive plans (Runna, TrainAsONE):** Arnold's day-level adaptation matches their hook on a
  better engine; their edge is plan *authoring* polish (Runna sets the bar). Arnold's planned
  "Plan = factory" + coach-planner (roadmap #3/#4) targets exactly this, deeper.
- **vs Nutrition (Fuelin, MAVR):** Arnold's `fuelForWork` + glycogen model + corrected energy
  accounting now rival the bolt-ons, integrated rather than tacked on.

**Expectation / honest bar:** Arnold is now an **engineering-complete, well-tested, internally
coherent platform with category-leading intelligence** — but it is **not yet a consumer-tier
*product*** because the visual/UX uplift is designed, not shipped. The distance to WHOOP/Oura/Runna
tier is now almost entirely **execution of a known plan**, not discovery. The single highest-leverage
move remains what the audit said on day one: **make the transparent, learned readiness the hero** —
now concretely specified (the Start cockpit), waiting on the green light to build.

---

## 6. What remains (prioritized)

1. **Visual/UX implementation (the frontier).** Un-park the design track: build the **Start cockpit**
   (fighter-pilot, governed density — `start-cockpit.html`), then **governed-dense EdgeIQ**, off the
   shared tile/token system, against the new test net. This is the move that converts the B body to
   consumer tier. *Designed; ready.*
2. **Coach → planner/guide + live re-solve (roadmap #3/#4).** The net-new capability that turns
   day-level adaptation into goal-level coaching. Design-coupled; the flagship next feature.
3. **Universal `<Card>`/`<SectionHeader>` primitive + full web/mobile parity** (3.1/3.4/4.3) —
   finishes the styling system; do alongside the visual build.
4. **Grow the test net** — extend component/snapshot coverage beyond the first 3 tiles (KRITile,
   token renders) as surfaces are rebuilt.
5. **Rebrand** — "Stack" rejected (generic/collision); name shortlist (Cairn/Strata/Ledger) pending
   an availability scan; logo follows the name.

---

## 7. Honest caveats
- Visual/UX grades are subjective and rest on Emil's on-device builds, not this review.
- "Functional completeness A−" counts shipped capability; the coach-planner ambition is deliberately
  excluded as net-new, not a debt.
- Competitor data is days-old (2026-06 session research); stable but not re-verified today.
- The strategy work (IA contract, density doctrine, mockups) raises *readiness*, not the *shipped*
  grade — reflected by holding Visual/UX at B until pixels land.
