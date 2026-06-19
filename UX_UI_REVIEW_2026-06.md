# Arnold — UX/UI Review, Industry Comparison & End-State Plan (2026-06-14)

> Companion to `PRODUCT_AUDIT_2026-06.md` and `AUDIT_EVALUATION_2026-06.md`. An objective
> read of Arnold's UX/UI as it stands today, benchmarked against the current (2025–2026)
> competitive set with cited specifics, a concrete recommendation for a polished + functional
> end state, and a sequenced plan to close everything still open. Whole-app scope. No flattery.

---

## 1. Objective UX/UI assessment (today)

**Headline:** the visual/architectural foundations are now sound (one token system, desaturated
hierarchy, decomposed code), but the *information design still skews "power tool," not "consumer
product."* The single biggest UX liability is **density** — several surfaces present far more
simultaneous numbers than working memory can hold — and the single biggest *missed* opportunity
is that **Arnold's one true differentiator (transparent, learned attribution) is computed but not
the hero of any screen.**

What's genuinely good (keep and amplify):
- The **rTSS speedometer + readiness rings** hero band is the right pattern — one glanceable
  summary that answers "how am I today" before any chart.
- The **low-poly figure system + dark/neon identity** is a real, ownable brand — more
  characterful than the utilitarian analytics incumbents.
- The **coach-driven card** (macro tiles + coach-picked detail) is the correct instinct
  (progressive disclosure), and the recent desaturation pass + single readiness "verdict" word
  moved hierarchy in the right direction.

Where it falls short of consumer tier:
- **EdgeIQ's 12-tile cockpit rail** is the clearest violation: research puts reliable working
  memory at **3–5 items (max ~4–7)**, and cluttered dashboards measured **12 minutes to insight
  vs 3 minutes** for cognitively-optimized equivalents on the same data
  (browserlondon.com, fegno.com). Twelve peer tiles fight the eye; nothing is the hero.
- **The activity/post-workout card** is information-dense (macro row + details + fuel + vs-goal +
  vs-usual + coach), which is a lot of vertical scanning for "how did that session go."
- **Per-surface bespoke layout** still exists in pockets (no universal `<Card>`/`<SectionHeader>`),
  so screens differ subtly and the card area remains the historic churn epicenter (~13 redesign
  rounds on one card).
- **Web/mobile parity is partial** — shared tokens/verdict/health-tile exist, but the two render
  paths still diverge on several surfaces.
- **Transparency is buried.** The "what Arnold's learned about you" surface (the thing no
  competitor can match) exists as a panel, not the headline.

Net: the body has moved from the audit's **C to roughly a B**. The remaining distance to a polished
B+/A− is mostly *information design* (density, hierarchy, transparency-as-hero), not new visuals.

---

## 2. Where Arnold sits vs the market (current, cited)

The category splits into four camps; Arnold is the only entrant attempting all four locally with a
self-explaining model. The comparison below is current as of 2025–2026.

| Product | Camp | Hero pattern | Transparency | Visual polish | Price |
|---|---|---|---|---|---|
| **WHOOP 5.0** | Recovery | One giant 0–100 Recovery %, 3-color traffic light, near-black UI so the score "pops" (925studios.co) | Names contributors (HRV/RHR/sleep/resp) but score itself called "arbitrary"; ships a "what if my score doesn't match how I feel?" help article (the5krunner) | High (consumer benchmark) | $25–40/mo, hardware "free" with membership (the5krunner) |
| **Oura (Ring 4)** | Recovery | "Today" tab like a news app's Top Stories; score chips + a time-of-day daily highlight (ouraring.com) | Strongest on paper: per-metric "top contributors" + personal baselines; yet Oura's own advisor Marco Altini calls readiness/recovery "made up scores" (marcoaltini.substack.com) | High | $349+ ring + $5.99/mo (ouraring.com) |
| **Athlytic** | Recovery | One 0–100 readiness score, green/yellow/red, "check in under 10s" | **Markets "why your score is what it is" as its edge** — breaks down sleep/RHR/HRV drivers; reviewers call it "refreshing" (fitnesstoolsreviewed.com) | Good (on Apple Watch data) | ~$2/mo, no hardware (fitnesstoolsreviewed.com) |
| **intervals.icu** | Analytics | No hero — month calendar + Fitness/Fatigue/Form chart in a side menu | Model-level (CTL/ATL/TSB exposed) but interpretation left to user; "never win design awards" (paincave.io) | Utilitarian by design | Free, no gating |
| **TrainingPeaks** | Analytics | Performance Management Chart (PMC) as de-facto hero; Fitness/Fatigue/Form tiles on mobile | Model-level, consistent color semantics (CTL blue / ATL pink / TSB) but "dated… enterprise software" (paincave.io) | Below consumer tier | Free + ~$20/mo (analytics paywalled) |
| **Runna** (Strava) | Adaptive plan | One plan view; "today's session in a forward-looking week"; chat-style onboarding | Plain-language adaptation ("Not Feeling 100%" reshapes the plan) | **Near consumer/WHOOP tier — the polish bar in this space** (therunninggenie.com) | ~£10–16/mo, no real free tier |
| **TrainAsONE** | Adaptive plan | One "Today's AI Recommendation" + Readiness Score | Shows *what changed* (continuous rebuild, planned-vs-performed) but "prescribes without clearly explaining why" (therunninggenie.com) | Dated | Free + ~$10/mo |
| **Fuelin** | Nutrition | Traffic-light per-meal carb prescription tied to the training calendar (campfireendurance.com) | Implicit (intake-vs-target gap); criticized for an "earn your food" feel (mavr.app) | Sleek (App 2.0, Apr 2025) | $29/mo |
| **MAVR** | Nutrition | **Live glycogen % gauge + timed meal timeline**, conversational coach "Kai" (mavr.app) | Glycogen projection is the under-fuel signal | Modern, dark, card-based | Free trial + undisclosed Pro |

**The three things this comparison makes obvious:**

1. **Transparency is the category's open wound — and Arnold's wedge.** The dominant expert critique
   across recovery apps, voiced even by Oura's *own* HRV advisor, is that the scores are "made up"
   and "not good at tracking what they claim" (marcoaltini.substack.com). The recurring user
   failure mode is "the score doesn't match how I feel." Athlytic has discovered that *explaining
   the score* is a marketable edge — and it's the one thing Arnold already computes deeply
   (`attribution.js`, `hubFacts`, LearnedHero) but doesn't lead with. **This is the demo that wins,
   and the work is surfacing, not building.**

2. **Everyone converges on "one hero + 3-color + progressive disclosure."** WHOOP = one giant
   number; Oura = one timely highlight; Athlytic = one score; Runna/TrainAsONE = one decision.
   Arnold's EdgeIQ 12-tile rail is the outlier in the wrong direction.

3. **Polish ceiling is set by WHOOP/Oura/Runna; the analytics incumbents are beatable.** No
   endurance-analytics tool matches consumer polish — that gap *is* Arnold's opportunity, because
   it has the brand assets (low-poly/dark) the data tools lack.

---

## 3. The strategic recommendation (the one that matters most)

**Make transparent, confidence-aware attribution the hero of the primary screen — "here's your
state, and exactly why, and how sure I am."** This is the only recommendation that is simultaneously
(a) backed by best practice (one hero, System-1 "aha" before conscious thought — browserlondon.com),
(b) the unmet need across the entire competitive set, and (c) already built in Arnold's engine.

Concretely, the hero should answer three questions in one glance:
- **What** — the readiness/health state (the existing gauge/verdict).
- **Why** — the top 2–3 weighted contributors with direction (e.g. "Sleep −, HRV +, heat +1.4%/°C").
- **How sure** — the confidence bar Arnold already has (LearnedHero's "76% sure").

No competitor can show all three honestly. That is the product's signature.

---

## 4. Specific recommendations to a polished, functional end state (whole app)

Organized by principle, each with the concrete Arnold change. These are design directives, not yet
a build order (that's §5).

**A. One hero per screen (kill density).**
- *EdgeIQ:* collapse the 12-tile cockpit rail to **one hero (Daily score gauge) + ≤4 supporting
  drivers**, with the remaining tiles behind a "More" expander. Target the 3–5 working-memory
  ceiling (fegno.com).
- *Activity card:* lead with the speedometer + the single most important outcome for that sport;
  demote the rest to a tap-to-expand "Details."
- *Mantra:* "exactly one thing is the hero" on every screen (uxpin.com).

**B. Progressive disclosure, max 2 levels (NN/G).**
- Standardize the tier: **summary → trend → raw**. Score/verdict on top; 7-day trend one level
  down; raw tiles/charts only on explicit drill-down. NN/G: ">2 disclosure levels typically have
  low usability," and deferring secondary content is "a key guideline for mobile" (nngroup.com).
- Use expand/disclosure controls with clear information scent (a labeled "Why" / "Details" chip),
  not silent truncation.

**C. Transparency hero (see §3).** Promote LearnedHero + readiness attribution from a mid-page
panel to the top-of-screen headline on Start and Daily. This is the highest-ROI single change.

**D. Finish the color system + make it accessible.**
- Color is largely unified (tokens) and desaturated — finish the job by ensuring **every status
  color is paired with an icon or shape**, since color-only red/green fails colorblind users and
  "isn't considered accessible" (pencilandpaper.io; datarocks.co.nz). Many Arnold tiles already
  carry icons; audit for the few that rely on hue alone.
- Keep semantic colors (status) strictly separate from brand/category accents (uxpin.com) — the
  token split already encodes this; enforce it in any new component.

**E. One component system → true web/mobile parity.**
- Land a shared `<Card>`/`<SectionHeader>` primitive and migrate surfaces onto it so web and mobile
  render from the same parts. This ends the drift the audit flagged (Max-HR color, coach messaging)
  and the per-screen churn. (Caveat: `PlannedWorkoutTile` is the churn epicenter — migrate it last,
  with a clear before/after and sign-off, per `DESIGN_DECISIONS.md`.)

**F. Nutrition: surface the prescription like the category leaders.**
- Arnold already computes glycogen adequacy (`computeGlycogenEstimate`) and fuel-for-work
  (`fuelForWork.js`). MAVR's winning device is a **live glycogen % readout + a timed meal
  timeline** (mavr.app); Fuelin's is a **color-coded per-meal carb prescription** (campfireendurance.com).
  Recommendation: elevate Arnold's fuel output from chips to a small **"fuel for tomorrow's session"
  card** (pre/during/recovery + an EA/under-fuel flag) — the Cronometer integration finally paying off.

**G. Keep the one-voice, event-driven Coach (already best practice).** WHOOP earns trust by
"speaking once, at the right time, about the thing that changed." Arnold's unified CoachComment +
living-coach model already matches this — protect it; don't let new surfaces reintroduce parallel
coach composers.

---

## 5. Plan to complete what's open (functional debts + UX end-state)

Sequenced for compounding value and ascending risk. Effort: S(<½ day) · M(1–2 days) · L(multi-day).
Each phase is independently shippable and build/test-verifiable.

### Phase A — Close the remaining functional debts (audit §2.6)  · highest certainty
- **A1 · Play/Daily discipline parity** (continues R63). Add `ski` to `LogDay`'s `PROFILES`
  (today it falls back to the run layout); give cycle/swim/ski/walk a sport-appropriate "Vs Goal"
  instead of the run-centric "weekly miles / run pace." **M, low risk** (additive, mirrors R63).
- **A2 · Planned miles → weekly/annual projections** (§2.6c). Wire planned distance into the
  weekly/annual projection so the view reflects intent, not just completed work. **S–M, low risk.**

### Phase B — Transparency hero (the wedge; §3 + §4C)  · highest ROI on perception
- **B1 · Promote attribution to the hero** on Start + Daily: state + top 2–3 weighted contributors
  + confidence, from existing `attribution.js`/`hubFacts`/LearnedHero. **M, medium risk** (visual;
  needs Emil build-verify on device). Mockup of this end-state ships alongside this doc.

### Phase C — Density & hierarchy pass (§4A/§4B)  · biggest "feels premium" jump
- **C1 · EdgeIQ one-hero rebuild** — collapse the 12-tile rail to hero + ≤4 + "More." **M–L,
  medium risk** (touches the dense EdgeIQ surface; build-verify).
- **C2 · Activity card progressive disclosure** — lead metric + tap-to-expand Details/Fuel.
  **M, medium risk** (touches card area — careful, churn-prone).

### Phase D — Component system & parity (§4E)  · ends drift + churn
- **D1 · Shared `<Card>`/`<SectionHeader>` primitive**; migrate non-churn surfaces first. **M.**
- **D2 · Web/mobile parity sweep** off the primitive; `PlannedWorkoutTile` migration last, gated.
  **L, higher risk** (the churn epicenter — explicit sign-off required).

### Phase E — Nutrition prescription surface (§4F)  · makes Cronometer pay off
- **E1 · "Fuel for tomorrow" card** (pre/during/recovery + EA flag) from `fuelForWork` +
  `computeGlycogenEstimate`. **M, low-medium risk** (mostly surfacing existing engine output).

### Phase F — Test & verification rigor (audit §4.4)  · insurance, do alongside
- **F1 · Component/snapshot tests** for the shared tiles/cards (the "one number, shown identically"
  guarantee) + a CI step so the manual Windows build isn't the only gate. **M, low risk.**

**Suggested order:** A (finish debts) → B (transparency hero — the win) → C (density) → E (nutrition)
→ D (primitive/parity) → F (tests, in parallel throughout). A, B, and E are the high-ROI / lower-risk
core; C and D carry the most visual/churn risk and want Emil's eyes on each build.

---

## 6. Honest caveats
- Visual-quality judgments here are directional and rest on Emil's on-device build verification, not
  this review.
- Several cited competitor sources are affiliate- or competitor-authored (Paincave, The Running
  Genie, agency teardowns) — treat their *praise* as directional; the *criticisms* and first-party
  mechanics are better corroborated. The strongest independent voices are Marco Altini (HRV science)
  and the5krunner.
- The transparency wedge is now *surfaceable and testable with real users* — which is the next kind
  of validation beyond "shipped clean."

---

## 7. Sources
**Recovery (WHOOP/Oura/Athlytic):** 925studios.co/blog/whoop-design-breakdown · the5krunner.com (WHOOP 5.0 review; Altini/Body Battery) · marcoaltini.substack.com/p/measurements-vs-made-up-scores · whoop.com (recovery 101) · ouraring.com/blog/new-oura-app-experience · ouraring.com/membership · droid-life.com (Oura app facelift) · nbcnews.com (Oura Ring 4 review) · fitnesstoolsreviewed.com (Athlytic review) · corahealth.app/compare/athlytic
**Analytics/adaptive (intervals.icu/TrainingPeaks/Runna/TrainAsONE):** thetravelrunner.com/intervals-icu-review · paincave.io/blog/training-platform-comparison · saashub.com (TP vs intervals) · help.trainingpeaks.com (PMC; CTL) · trainingpeaks.com/coach-blog (ATL/CTL/TSB) · runwithrachel.co.uk/runna-app-review · therunninggenie.com/blog/best-ai-running-coach-apps · umit.net/trainasone-2025-review · trainasone.com/faqs
**Nutrition (Fuelin/MAVR):** fuelin.com (+ /pricing, /reviews) · endurancesportswire.com (Fuelin App 2.0) · campfireendurance.com/blog/fuelin-a-review · mavr.app (+ vs-fuelin, alternatives blogs) · apps.apple.com (MAVR)
**UX best practice:** nngroup.com/articles/progressive-disclosure (+ defer-secondary-content-for-mobile) · uxpin.com/studio/blog (dashboard-design-principles; ux-design-principles; color-consistency) · pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards · browserlondon.com (cognitive cost of dashboards) · fegno.com (cognitive load) · uitop.design · fuselabcreative.com · aufaitux.com · basishealth.io · datarocks.co.nz · loop11.com
