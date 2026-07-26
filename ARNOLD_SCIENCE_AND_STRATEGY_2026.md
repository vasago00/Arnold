# Arnold — Endurance Science, the App Landscape, and the Build Plan
*Holistic research synthesis + prioritized product strategy · 2026-07-18*
*(Supersedes the interim brief `RUNNING_SCIENCE_LANDSCAPE_2026.md` — merges three verified deep-research passes plus targeted follow-up on zone-2 and AI-coaching.)*

> **Method & honesty.** Three fan-out research passes (≈320 sub-agents across the three), each source
> put through 3-vote adversarial verification; topics that survived are cited to primary literature or
> official product docs. Two topics (zone-2 definitions, AI-coaching efficacy) failed the harness's
> hard-effect-size gate — their evidence is definitional/early-stage — so they were filled with targeted
> primary-source fetches, flagged as such. Where a claim rests on a vendor's own marketing, a small or
> single-sex study, or observational data, it is marked. This is the same no-fabrication discipline Arnold
> holds its own coach to.

---

# PART I — WHAT THE EVIDENCE SAYS

## 1. How the market actually models fitness and predicts races

**The decisive finding: every serious platform moves an athlete's fitness — and, where it predicts races,
its prediction — from *ordinary training*, not from races.** Arnold's anchor-only predictor is the outlier.

| Platform | Fitness model | Race predictor? | Updates from training? |
|---|---|---|---|
| **Garmin** (Firstbeat) | VO₂max from HR-vs-pace on any run | **Yes** — 5K/10K/HM/M from VO₂max + history + PRs | **Yes**; races only calibrate. *Marathon skews optimistic.* |
| **COROS** (EvoLab) | Running VO₂max + Base Fitness (6-wk HR-TRIMP) | **Yes** — workout type → distance (long run→M, threshold→10K) | **Yes**, 6-week window. *"Lab-equivalent" is an unvalidated vendor claim.* |
| **Stryd** | Critical Power auto-fit from training | **Via CP** | **Yes** — max power across durations |
| **TrainingPeaks / Intervals.icu / Strava** | Banister/Coggan CTL(42d)/ATL(7d)/TSB | No native run-time predictor in the core chart (Strava ships a separate "Performance Predictions") | **Yes** — rolling load; Strava estimates load from HR "Relative Effort" if no power |
| **Runalyze** | "Effective VO₂max" (HR→%vVO₂max, 30-day avg) | **Yes** — VO₂max-based prognosis | **Yes**; deliberately ignores economy for cross-runner comparability |
| **WHOOP / Oura** | HRV-centric Recovery / Readiness | **No running predictor** (recovery/readiness only; Oura ships a separate VO₂max feature) | Recovery updates daily |

**The mechanism in one line:** wearable VO₂max (HR-vs-pace) *or* rolling load (CTL) → a fitness state that
rises with consistent training → a race prediction derived from that state. **This is the blend Arnold must
adopt.** The honest differentiator is a **confidence band** — because their single numbers overpromise
(Garmin's optimism; COROS's unvalidated lab-equivalence claim), and independent wearable-VO₂max validity
remains an open question.

## 2. The physiological stack underneath

- **VDOT / Riegel** (Arnold has both): fine as *distance converters*; they only move when the input anchor
  moves — the root of the frozen-number bug.
- **Banister / Morton impulse-response** — the peer-reviewed structure behind CTL/ATL/TSB. Performance =
  fitness − fatigue, both convolutions of the same training impulse; **fitness decays ~49 days, fatigue
  ~11** (TrainingPeaks uses 42/7). Because fitness decays slower and accumulates, consistent training raises
  a modeled ceiling. *Flag: the "validated on one runner" pedigree failed verification — use the structure,
  not a dose-response law.*
- **The better anchor:** velocity at VO₂max (**vVO₂max**) was the single best predictor of distance
  performance (~94% of variance) *because it integrates aerobic power and running economy*, which raw VO₂max
  misses. *(Small n≈17 study — foundational, not a constant.)*
- **Critical Speed** — validated heavy/severe-domain boundary and a strong mile-to-marathon determinant,
  computable **lab-free from two+ maximal efforts.** *Label carefully: CS is NOT your lactate threshold/MLSS.*

## 3. Durability — the "fourth pillar" and Arnold's clearest edge

Jones (2024, *J Physiol*) establishes **physiological resilience/durability** as an independent 4th
determinant alongside VO₂max, threshold, and economy. It is **independent of VO₂max** (r=0.03 with the
magnitude of fade), so it must be *measured, not inferred*: critical power can fall ~10% (range <1%–32%)
after 2h. **It's measurable in amateurs with no lab via aerobic decoupling** — in **82,303 marathoners**,
less decoupling meant faster finishes, and adding decoupling **improved marathon prediction beyond critical
speed alone.** Essentially no consumer app coaches this well. *(Caveat: evidence is within-race
observational; *forecasting* fade from ordinary training is still unresolved — an opportunity, not a solved
problem.)*

## 4. Intensity — distribution, and the honest definition of "easy"

- **Don't dogmatize "polarized."** Elites historically train **pyramidally**; a 2024 meta-analysis found
  polarized beats other distributions **only for short-term VO₂peak** (small, gone by 12 weeks) and **no
  advantage on race performance**; "polarized wins prospective trials" was **refuted 0–3.** The robust
  principle is **~80–90% easy volume**, agnostic on the label.
- **"Zone 2" is being used two incompatible ways** *(IJSPP 2025 expert viewpoint, targeted fetch).*
  Physiologists define zone 2 as **"intensities just below LT1/VT1"** (the first lactate/ventilatory
  threshold). Popular/influencer "zone 2" uses a generic **60–70% max-HR** band that "might be interpreted as
  quite heterogeneous intensities." **Lab-free anchors for LT1:** ~70–80% max HR (or ~80–90% of LT1 HR),
  talk-test "can converse *with some effort*," RPE ~2–3/10, lactate ~1–2 mmol/L. Expected adaptations:
  capillarization, mitochondrial enzymes in type-I fibers, metabolic efficiency, modest VO₂max/CP gains —
  and physiology is a **continuum**, not a switch. **Implication: Arnold should label easy intensity to the
  LT1 concept, not a bare %HRmax, and say what it's anchored on.**

## 5. Readiness — HRV is a nudge, not a plan-driver

Two peer-reviewed meta-analyses agree **HRV-guided training does *not* significantly outperform predefined
periodized plans** for VO₂max or performance (between-group effects trivial/NS). Its only evidence-backed
edge: modestly better at **maintaining vagal HRV and reducing non-responders.** **Implication: use HRV as a
readiness/adaptation *nudge* (ease/hold a hard day), never as the thing that writes the plan** — which is
exactly the conservative role Arnold should give it.

## 6. Fueling — carbs up, bicarbonate narrow, CGM out

- **Carbohydrate:** a 2026 review argues the old ~90 g/hr ceiling "should probably no longer be considered
  the absolute upper limit," proposing **up to 120 g/hr** for trained athletes in efforts >2.5h **with
  practiced gut tolerance.** Scale guidance with duration; flag gut-training.
- **Sodium bicarbonate:** robustly ergogenic **only for ~45 s–10 min high-intensity** efforts; a meta-analysis
  found a **negligible, non-significant** effect on continuous running (SMD 0.18, p=0.06). The Maurten
  hydrogel genuinely raises/sustains bicarbonate and cuts GI distress, but performance gains are confined to
  **short cycling TTs.** **Marginal for a marathoner** — at most an optional note for VO₂max/interval days.
- **CGM for non-diabetic athletes — do NOT build on it.** Peer-reviewed 2023–2025 consensus: **no validated
  link** between interstitial glucose and fueling adequacy or performance; **no accepted athlete reference
  values**; it measures **neither muscle glycogen nor carb flux** (blood glucose is ~20–30% of exercise
  fuel); accuracy **degrades during exercise**; a 156-km ultra found **no relation** between glycemic metrics
  and finish time. The large "athletes may benefit" cohort was **authored by Supersapiens-affiliated,
  stock-holding researchers** and tested **no** performance outcome. **This is the clearest marketing-vs-
  evidence gap in the space — Arnold should explicitly not treat CGM as a signal (and can say why).**

## 7. RED-S / low energy availability — Arnold's moat, done to the 2023 standard

The **2023 IOC REDs consensus** redefines REDs as a **multi-system syndrome in both sexes** from problematic
low energy availability (affecting metabolism, bone, endocrine/menstrual, immunity, glycogen, cardiovascular).
Critically, it **moves away from the single ~30 kcal/kg FFM/day cutoff** — noting males may show REDs at
~9–25 kcal/kg FFM/day and that individual/organ variability "precludes a single clinical cutoff" — and
introduces the **REDs Clinical Assessment Tool v2 (CAT2)**, a four-tier green/yellow/orange/red severity
model for **physician-led diagnosis.** **Implication (the responsible design boundary): Arnold should
*estimate* energy availability from its training-load + nutrition + DEXA/bloodwork inputs and *flag risk
indicators* (a screen, not a diagnosis), pair that with validated screening context (LEAF-Q / RED-S CAT),
and hand *diagnosis* to a clinician.** Almost no running app connects clinical markers to readiness — this
is Arnold's defensible differentiation.

## 8. Menstrual-cycle-aware training — individualize, don't prescribe

Multiple systematic reviews (McNulty 2020; Carmichael 2021; Schlie 2025) converge on **low-quality, small,
underpowered evidence** with **trivial, inconsistent phase effects** and **no consensus best phase** (McNulty
pooled ES ≈ −0.06). The reviews explicitly state general phase-based guidance **"cannot be formed"** and
recommend an **individualized** approach. **Implication: symptom/response tracking + individualization —
never a prescriptive phase-based plan presented as evidence-based.**

## 9. AI / adaptive coaching — the evidence validates Arnold's exact architecture

*(Targeted primary fetches — GPTCoach, CHI 2025, Stanford; and a 2025 scoping review of AI-delivered
motivational interviewing.)*

- **Facilitative/MI coaching works and is liked, and LLMs can execute it faithfully.** GPTCoach (a GPT-4 MI
  coach grounded in wearable data via prompt-chaining) hit **93% MI-consistent behavior (MITI-4),
  substantially beating vanilla GPT-4**; users felt supported **4.8/5**, advice personalized **4.6/5**,
  actionable **4.3/5**. Across the MI-chatbot literature, **87% of studies report positive
  feasibility/acceptability**, with users finding agents **"judgment-free, supportive, and easier to engage
  with than human counselors, particularly in stigmatized contexts."**
- **But two sober caveats.** (1) **Behavior-change efficacy is still thin** — only **3/15 (20%)** studies
  showed significant behavioral change; near-term value is **engagement and warmth**, not proven performance
  outcomes. (2) **The field's glaring gap is safety:** **87% of studies described *no* strategy to prevent
  hallucination/misinformation**, and GPTCoach itself flags hallucination, data-misuse, and equity risks and
  relied on **researcher supervision** rather than autonomous deployment. Grounding data use was also
  **variable** (GPTCoach sometimes failed to use the athlete's own numbers).

**This is a direct endorsement of Arnold's design.** Arnold's deterministic, no-fabrication engine with a
**fact-checker gating every LLM sentence (output ⊆ certified facts) and an always-on deterministic fallback**
is *precisely* the safety architecture the literature says is missing everywhere else. The facilitative
"Stage 6" stance is the evidence-backed tone. And the "coach must actually use the athlete's own data" gap is
one Arnold already solves by construction (the LLM only ever *rephrases* certified, data-grounded beats).

---

# PART II — THE ARNOLD BUILD PLAN (prioritized)

**The thesis, confirmed:** the market has trained everyone to expect a fitness number that *responds to
training*; Arnold's differentiation is not the number itself but **honesty (confidence bands), depth
(durability + clinical/RED-S), and a safe, warm coach** the rest of the field can't ship because they lack
the fact-checked architecture. "Pro-grade awareness and tooling, wholesomely delivered, for the hybrid
amateur."

**P1 — Training-responsive finish-time model (fixes the reported bug; reaches parity).** Blend, don't
replace: a **training-driven fitness estimate** (a vVO₂max/critical-speed construct from *any* quality effort
at *any* distance + **aerobic efficiency** pace-at-HR + the **chronic-load trend** already computed) against
a **demonstrated-performance ceiling**, wrapped in an **honest, widening confidence band** that tightens when
a benchmark confirms it, with **provenance + an "as-of" date** on the number. *(Pairs with the Training
Profile redesign already in the backlog.)*

**P2 — Durability as a first-class metric (the differentiation play).** Compute **aerobic decoupling** from
ordinary HR+pace long runs, trend it, and fold it into both the marathon prediction and the coach voice
("your pace held to the end of the 18 — durability's trending up, the marathon-specific fitness pace tables
miss"). Evidence: independent of VO₂max, improves marathon prediction, unbuilt by competitors.

**P3 — RED-S to the 2023 standard (the moat).** Estimate energy availability from training load + nutrition +
DEXA/bloodwork; surface **risk flags** on a severity gradient (mirroring CAT2's green→red *as a screen*),
ground it with LEAF-Q/RED-S-CAT context, and **hand diagnosis to a clinician** with an explicit "not medical
advice / see a professional" boundary. This is Arnold's most defensible, least-copyable capability.

**P4 — Define "easy" honestly (correct, not trendy).** Anchor the easy/aerobic zone to the **LT1/VT1**
concept (estimated lab-free) rather than a bare %HRmax band, and **label what it's anchored on**. Protect an
**~80–90% easy-volume** ratio as the robust principle; **stay agnostic** on polarized-vs-pyramidal. Flag
"grey-zone" drift (too-hard easy days).

**P5 — Readiness + the wholesome coach (Stage 6), leaning on the safety moat.** Keep **HRV as a nudge**
(ease/hold a hard day), never a plan-writer. Ship the **facilitative/MI stance** the evidence rewards
(advise-with-permission, affirm what's working, one nudge not five) — and **market the fact-checked
architecture as the feature it is**, since 87% of AI coaches ship no hallucination guard and Arnold's is
built in.

**P6 — Fueling: duration-scaled carbs; skip CGM; bicarbonate optional-and-narrow.** Scale carb guidance with
session duration (up to 90–120 g/hr for long efforts, with a gut-training caveat). **Explicitly do not build
on CGM** (and optionally educate the user on why). Treat **bicarbonate** as at most an optional note for short
VO₂max/interval work — out of scope for the marathon itself.

**P7 — Women's health: individualize, don't prescribe.** Offer **symptom/response tracking** and
personalization; never present phase-based periodization as evidence-based. (RED-S in both sexes per §7.)

**Sequencing.** P1 is the immediate fix and unblocks the Training Profile redesign. P2 and P3 are the
differentiation and should headline the next build arc. P4–P5 are correctness + the coaching leap (Stage 6,
already on the roadmap). P6–P7 are guardrails/scope decisions that mostly *prevent* wasted work.

---

## Sources (verified across three passes + targeted follow-up)
**Apps/models:** Garmin Race Predictor · COROS EvoLab · Stryd Critical Power · TrainingPeaks CTL/ATL/TSB ·
Intervals.icu Fitness Chart · Strava Fitness & Freshness · Runalyze Effective VO₂max · WHOOP Recovery · Oura
Readiness.
**Physiology:** Morton/Fitz-Clarke/Banister 1990 (J Appl Physiol) · McLaughlin 2010 vVO₂max (MSSE) · Critical
Speed & D′ 2026 scoping review (Sports Med) · Stöggl & Sperlich 2015 + Sun 2024 (intensity distribution) ·
Jones 2024 "fourth dimension" (J Physiol) + Zanini/Jones/Nybo 2025 · Smyth & Muniz-Pumares 2022 (decoupling,
82,303 marathoners) · Haugen 2024 Norwegian double-threshold (Sports Med).
**Trends/controversies:** 2026 J Nutrition carbohydrate review (120 g/hr) · sodium-bicarbonate meta-analyses
(EJAP 2024, JISSN 2025) + Maurten hydrogel trials (Gough & Sparks 2024) · CGM-in-athletes reviews
(Flockhart & Larsen 2023; Bowler/Burke 2024–25; Performance Nutrition 2025) · IOC REDs 2023 consensus +
CAT2 (Mountjoy et al., BJSM) · HRV-guided meta-analyses (Granero-Gallegos 2020; PMC8507742) · menstrual-cycle
reviews (McNulty 2020; Carmichael 2021; Schlie 2025).
**Zone 2 & AI coaching (targeted fetch):** "What Is Zone 2 Training?" experts' viewpoint (IJSPP 2025) ·
GPTCoach (Jörke et al., CHI 2025, Stanford HCI) · Scoping review of AI-delivered motivational interviewing
(2025).

*Full URLs preserved in the interim brief and the three research-pass transcripts.*
