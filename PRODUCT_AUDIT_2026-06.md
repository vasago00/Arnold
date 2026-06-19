# Arnold — Product & Codebase Audit (2026-06-10)

> Commissioned by Emil: an objective, critical, constructive assessment of quality,
> purpose, and current performance — functional and visual — measured against the
> credo (a personal health & fitness *intelligence* that fuses Garmin + Cronometer,
> learns the individual, and speaks with one Coach voice) and against the market.
> Written to keep us honest. No flattery.

---

## 0. The one-paragraph verdict

Arnold's **engine is a genuine 9/10** — a Bayesian, two-ledger intelligence hub with
attribution, learned personalization (heat strain, sweat rate, sensitivity), a Health
System score, Cut Mode, race prediction, and a narrative layer. Almost nothing in the
consumer market has this depth, and the *concept* — one local-first brain that fuses
training + recovery + nutrition and can explain itself — is differentiated and ahead of
its time. But the **product around the engine is a 5/10**, and the **presentation layer
is the bottleneck**: a single ~11,800-line web file, the same maps and colors duplicated
across 3–4 files (and silently diverging), two parallel web/mobile render paths that
drift apart, no design-token system, and almost no tests. The result is a power-user data
tool (intervals.icu / Runalyze tier) wearing a nice dark theme — not yet the premium,
explain-everything product the engine could power (WHOOP / Oura tier). **The single
biggest opportunity is not a new feature; it's to turn the engine's transparency into the
hero of the experience, on top of a design system that stops the per-session UI churn.**

---

## 1. Where Arnold sits in the market

The endurance/health-data market splits into four camps. No incumbent owns the
intersection Arnold targets.

| Camp | Leaders | What they nail | What they miss (Arnold's wedge) |
|---|---|---|---|
| **Analytics** | intervals.icu (free, single-dev), TrainingPeaks ($20/mo), Runalyze | Deep load/fitness-fatigue (CTL/ATL/TSB), zone & power analytics | No nutrition; little learned personalization; no real "coach voice"; opaque or utilitarian UX |
| **Adaptive AI plans** | TrainAsONE, Runna (now Strava-owned) | Daily-adapting plans, a "readiness score" that reshapes the week | No nutrition/fueling; closed black-box; no recovery-data depth |
| **Recovery/readiness** | WHOOP, Oura, Athlytic | One daily loop (recovery % → strain budget), clean consumer polish | Thin training analytics; no nutrition; criticized for "made-up", unexplained scores |
| **Performance nutrition** | Fuelin (coach-led), MAVR (AI fueling) | "Fuel for the work required" — fueling tied to the training calendar | Bolt-on to TrainingPeaks/Garmin; not an analytics or recovery engine |

**Arnold's unique position:** the only one attempting *all four at once, locally, with a
learning model that explains itself.* That is real whitespace. The risk is that "does
everything" becomes "does nothing sharply" unless the UX makes one thing obviously great.

**The strategic gift the incumbents are handing you:** Garmin's Training Readiness and
Body Battery are widely criticized for **hidden weighting** — users "genuinely cannot tell
how much of a poor score is sleep vs other factors," and a respected HRV scientist
publicly called Body Battery "made-up scores." Arnold already computes the attribution
(the hub's `attribution.js`, `hubFacts`, `coachInsights`, "what Arnold's learned about
you"). **Transparency is the feature the whole category is failing at, and you've already
built the hard part.** Today it's buried below the fold. That is the miss to fix first.

---

## 2. Functional audit — gaps & opportunities

### 2.1 The intelligence is real but under-surfaced
The hub (`core/hub/*`: `estimate`, `responseModel`, `fitnessModel`, `bodyModel`,
`sweatModel`, `trainingHeat`, `raceFitness`, `promote`, `hubFacts`) is the asset. Yet on
the Daily screen the learned insight ("Heat strain +1.35%/°C · 76% sure") renders as a
small, low-contrast line under an "Intelligence" header, below the fold. **The most
differentiated thing in the product is visually the least important.** Opportunity: make
"What Arnold has learned about you — and how sure it is" a first-class, confidence-aware
surface (the thing no competitor can show).

### 2.2 The loop is open — the engine predicts, but the plan doesn't adapt
TrainAsONE and Runna's core hook is a plan that **reshapes daily** from readiness. Arnold
has a richer readiness/fitness model *and* a planner (`planner.js`, `planGenerator.js`)
but they're only loosely coupled — the plan is largely static once generated, and
completion is the only feedback. **Closing the loop** (hub readiness/debt → tomorrow's
prescribed session auto-adjusts, with the reason shown) would convert Arnold from a
"scorekeeper" into a "coach," and it's mostly wiring existing parts.

### 2.3 Nutrition is ingested but barely prescriptive
You have Cronometer fueling data and energy models (`calorieTarget`, `energyBalance`,
`raceFueling`, `cutMode`). The market gap (Fuelin/MAVR) is **"fuel for the work
required"** — telling the athlete what to eat for *tomorrow's* session and flagging
under-fuelling/low energy availability. Arnold has the inputs to do this better than a
bolt-on, and it would make the Cronometer integration pay off beyond a Replenish tile.

### 2.4 Coaching is fragmented — there is no single voice
There are multiple composers: `CoachComment`, `CoachLine`, `CoachBeta`, `coachBriefs`,
`narrativeComposer`, `narrativeGraph`, `coachingPrompts`, plus per-surface logic. Emil's
own standing note: "Coach MESSAGING differs Daily vs Play vs Fuel." A coach that
contradicts itself across screens reads as *not one mind*. This is the credo's core
promise ("one Coach voice") and it's currently not met.

### 2.5 The coach reacts to noise, not events
Known issue: the coach can talk about sleep at 8am, or fire on a water log. Best-practice
recovery products (WHOOP) earn trust by speaking **once, at the right time, about the
thing that changed.** This is the deferred "living coach" track and should be elevated —
it's central to whether Arnold *feels* intelligent.

### 2.6 Smaller functional debts (from the working backlog)
- Max HR colored inconsistently across surfaces (being unified now).
- sRPE captured but only partially wired into ACWR/Trend.
- Planned miles not feeding weekly/annual projections.
- Logged bike/swim/walk now first-class (just shipped) — but completion matching is loose.

---

## 3. Visual & UX audit

### 3.1 Current level: competent dark dashboard, bespoke not systematic
Honest placement: **UI ≈ intervals.icu / Runalyze tier (power-user, data-dense, dark,
functional), clearly below WHOOP/Oura/Athlytic consumer polish.** The low-poly athlete
figures and the dark, neon-accented identity are a genuine brand asset — more
characterful than intervals.icu's utilitarian look, and worth leaning into. But the
execution is *bespoke per screen* rather than *systematic*, which both caps the polish and
causes the churn (this session alone ran ~13 redesign rounds on a single card).

### 3.2 Metric overload vs the evidence
Best practice (2025 dashboard UX research): **2–3 key stats per screen, progressive
disclosure (summary → drill-down), actionable insight over raw data, strong visual
hierarchy (size/colour for primary vs supporting).** Arnold trends the other way — 32
Trend metrics, dense multi-tile cards, many simultaneously-colored numbers. The
coach-driven card (macro 4 + coach-selected details) is exactly the right instinct
(progressive disclosure), but the density and the number of colored elements still fight
the eye. Rule of thumb to adopt: **on any screen, exactly one thing should be the hero.**

### 3.3 Color is doing too many jobs, from too many sources
Color currently encodes *category* (family), *status* (good/warn/bad), *tier* (HR zone),
and *brand* — sometimes all on one card — and it's defined in at least four places that
disagree (`FAMILY_COLOR`, `planner.DAY_TYPES`, `PlanPickerModal.OPTIONS`,
`metricRegistry.COLOR`; e.g., intervals is `#f87171` in one and `#fbbf24` in another).
The Max HR "yellow" bug is a symptom: a *peak* value painted by the *average's* zone band.
A single semantic color system (brand / category / status, each with one job and one
source of truth) would remove a whole class of these bugs and instantly raise perceived
quality.

### 3.4 Two front-ends that drift
Web (`Arnold.jsx`) and mobile (`MobileHome.jsx`) are largely separate render paths with
their own `MetricTile`, their own tile-building, and their own copies of maps. Every
divergence Emil has flagged (Max HR color, coach messaging) traces to this. It doubles the
work and guarantees drift.

### 3.5 What's already good (keep/amplify)
- The low-poly figure system and dark identity — a real, ownable brand.
- The coach-driven card concept (macro + coach-picked details).
- The rTSS speedometer + readiness rings hero band (a clear, glanceable summary — the
  right pattern).
- Recent empty-state and pre-workout work moved in the right direction (more visual, less
  wall-of-text).

---

## 4. Architecture & code health

This is where the honest grade is lowest, and where the UX problems are *born*.

### 4.1 The monolith
`Arnold.jsx` is ~**11,800 lines** in one file — the web shell, routing, `LogDay` (the
whole Daily/Play screen + the activity-card builder), `HomeCockpit`, `Dashboard`,
`ImportHub`, `PlanPickerModal`, and dozens of inline components. Effects: it's hard to
reason about, hard to test, fragile to edit (the recurring sandbox mount-truncation pain
is a direct consequence of file size), and it forces "find the needle" greps for every
change. This file should be decomposed into feature modules.

### 4.2 Duplication that silently diverges (the #1 defect generator)
- **Session-signature maps in 3 files** (`PlannedWorkoutTile.SIGNATURE_SRC`,
  `WeeklyPlanner.PLAN_SIGNATURE`, `CalendarTab.SIG_FILE`) — each with its own `SIG_VERSION`
  to bump by hand. We bumped three this session.
- **Activity classification in ≥3 places** (`activityClass.js`, a local classifier in
  `CalendarTab`, and `Arnold._resolvePlanType`) — parallel, subtly different rules.
- **Plannable types / colors in ≥4 places** (`planner.DAY_TYPES`,
  `PlanPickerModal.OPTIONS`, `FAMILY_COLOR`, `metricRegistry`). The calendar drawer not
  showing the new sports (this session) was exactly this: a second hardcoded list.
- **Two `MetricTile`s** (web/mobile).
Every one of these is a place where a change has to be made N times and a bug is born when
it's made N-1 times. **One source of truth per concept** is already a stated law in
`DESIGN_DECISIONS.md` — the code doesn't honor it yet.

### 4.3 Styling has no system
Inline styles with hardcoded hex are pervasive; CSS variables are used inconsistently;
there is no shared `<Tile>`/`<Card>` primitive enforcing spacing, radius, and color
semantics. This is why a one-line visual intent becomes a multi-file hunt and why screens
look subtly different.

### 4.4 Testing & verification
`package.json` `test` = a single Node test (`classifyActivityForHyrox`). No component
tests, no visual regression, and the build is a manual Windows step with no CI mentioned.
For an app whose value is *correct numbers shown identically everywhere*, the lack of unit
tests around the core math (and snapshot tests around the tiles) is the biggest latent
risk. The good news: the core is mostly pure functions (`core/*`) and is highly testable —
this is low-hanging fruit.

### 4.5 What's strong architecturally
- The **core/ engine is well-modularized** (~100+ focused, mostly-pure modules; clean
  hub/ separation). The rot is in the *view* layer, not the brain.
- **Local-first** (OPFS, Dexie, LWW cloud-sync, startup-heal) is a real privacy/ownership
  differentiator vs cloud-only incumbents — worth marketing.

---

## 5. Prioritized roadmap (what to act on)

Sequenced for compounding value. Each tier is shippable on its own.

**Tier 0 — Stop the bleeding (foundations; 1–2 focused passes)**
1. **One design-token + primitive layer.** A single source for brand/category/status
   colors, spacing, radius, and one shared `<Tile>`/`<Card>`/`<MetricValue>`. Delete the
   4 color copies and 3 signature maps; centralize. This single change ends most of the
   per-session churn and the divergence bugs.
2. **Collapse the duplications** behind that layer: one classifier, one signature map, one
   plannable-types list, one `MetricTile`. (Mechanical once #1 exists.)
3. **Seed the test net** around core math + a few tile snapshots. Cheap insurance for "one
   number, shown identically."

**Tier 1 — Make the differentiator the hero (highest ROI on perception)**
4. **"What Arnold has learned about you" as a first-class, confidence-aware surface** — the
   transparency the whole category fails at. This is the demo that wins.
5. **One Coach voice** — collapse the composers into a single brief, calibrated to
   time-of-day, that speaks once about the thing that changed (the "living coach"). Directly
   serves the credo.

**Tier 2 — Close the loop (turn scorekeeper into coach)**
6. **Adaptive plan** — hub readiness/debt reshapes tomorrow's session, with the reason
   shown. Matches TrainAsONE/Runna's hook, on a better engine.
7. **"Fuel for the work required"** — prescriptive nutrition for the next session + low-EA
   flags, making the Cronometer integration pay off (Fuelin/MAVR whitespace).

**Tier 3 — Polish to consumer tier**
8. Visual hierarchy pass (one hero per screen, progressive disclosure, fewer simultaneous
   colors), lean into the low-poly/dark brand, and bring the mobile/web surfaces to true
   parity off the shared primitives.

---

## 6. Scorecard (objective, current state)

| Dimension | Grade | One-line basis |
|---|---|---|
| Concept / vision | **A** | Fuses 4 categories no one fuses; explain-yourself angle is whitespace |
| Core engine / math | **A−** | Bayesian hub, attribution, learned personalization — category-leading depth |
| Differentiation potential | **A** | Transparency + nutrition + local-first is a real, ownable wedge |
| Functional completeness | **B−** | Loop open (no plan adaptation), nutrition not prescriptive, coach fragmented |
| Visual design | **C+** | Strong identity, but bespoke/dense; power-tool tier, below consumer polish |
| UX / information design | **C** | Metric overload vs 2–3-hero best practice; differentiator buried |
| Architecture / maintainability | **C−** | 11.8k-line monolith, 3–4× duplication, drift between web/mobile |
| Test / verification rigor | **D** | One test; manual build; high latent-bug risk on a numbers product |

**Net:** an A-grade brain inside a C-grade body. The work ahead is almost entirely about
the body — surfacing, unifying, and systematizing what the brain already knows.

---

## 7. Sources (competitive & UX references)
- TrainingPeaks vs Intervals.icu vs Runalyze comparisons — getwatts.app, saashub, icusync, intervals.icu forum
- WHOOP / Oura / Athlytic recovery UX — askvora.com, sensai.fit
- AI running coaches (TrainAsONE, Runna/Strava) — trainasone.com, therunninggenie.com, umit.net
- Garmin Training Readiness / Body Battery criticism — the5krunner.com, scienceinsights.org
- Dashboard/fitness UX best practices (metric overload, progressive disclosure) — uxpin.com, dataconomy.com, uxmatters.com
- Performance-nutrition + training-load apps (Fuelin, MAVR) — mavr.app, apple app store
