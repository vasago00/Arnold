# Arnold — Platform Information Architecture (the contract) · 2026-06-14

> Settled with Emil this session. This is the **platform-level contract**: one job per
> surface, the same job in the same place, density that follows the job, and web carrying the
> lean-back depth. Every screen mockup/build must slot into this — we design the platform, not
> screens in isolation. Supersedes the tangled current nav (see "What's wrong today").

---

## Operating principles
1. **One job per surface.** Readiness, analysis, logging, scheduling, planning are distinct
   jobs; each lives on exactly one surface. No more readiness/coach/health smeared across three
   screens.
2. **Same job = same place + same name on both platforms.** Kill the current mismatch (web tab
   "EdgeIQ" actually renders the Start component; the real EdgeIQ is labelled "Trend").
3. **Density follows the job.** Decision surfaces are tight/glanceable; the analysis surface is
   governed-dense (see `UX_UI_REVIEW_2026-06.md` density doctrine). No empty real estate.
4. **Web carries lean-back depth.** Authoring/planning and the deepest analysis are richer on web;
   mobile is glance + act + review.
5. **Capture is passive, but review is a valued ritual.** Emil logs ~nothing manually (FIT +
   Cronometer + Garmin sync) — so logging is not a chore. BUT the *review* of activity + nutrition
   is a deliberate daily pleasure: seeing the session post and the targets illuminate is an
   **accomplishment/closure loop** (the Apple-rings/streak retention mechanic). So the Daily
   (Play+Fuel) review stays a **primary** surface — the reward engine, not buried in "More".

---

## Navigation sequence — ✅ LOCKED (Emil, 2026-06-14)
**Mobile bottom bar (in order):** `Start · EdgeIQ · Play · Fuel · Calendar`
(Play + Fuel are the "Daily" pair, two tabs.)
**Web nav:** the same five **plus `Plan`** (authoring) **and `Profile/Admin`** (likely web-only).
**Everything else** (Body/Core, Labs, Stack) = secondary surfaces, reached via "More" / web tabs — defined below.
Design & polish come AFTER the full surface inventory is settled.

---

## The surfaces (both platforms)

| # | Surface | One job | Mobile | Web | Density |
|---|---|---|---|---|---|
| 1 | **Start** (home) | "What's my status today and am I ready?" — readiness hero + the *why* (top system contributors + confidence) + today's plan slice + today's activity/nutrition convergence | Primary tab — **named "Start"** | Primary tab — **named "Start"** | Medium — synthesis, glanceable in seconds |
| 2 | **EdgeIQ** | The intelligence/analysis instrument panel — all-systems status + drivers + trends, the deep "how am I trending across everything, and why" | Primary tab | Primary tab | **High, governed** (the dense mockup) |
| 3a | **Play** | Activity — today's session posted + the post-workout card; the accomplishment of seeing it land | **Own primary tab** (Emil: Play + Fuel are different sides of the same coin, each merits its own tab) | Tab / drill-down | Detail + reward |
| 3b | **Fuel** | Nutrition — intake + targets *illuminating* as they're hit | **Own primary tab** | Tab / drill-down | Detail + reward |
| 4 | **Calendar** | The schedule — races + sessions as events; **race entry lives here** (scheduling act) | Primary tab | Primary tab | Structured/scheduling |
| 5 | **Plan** | The kitchen/factory — goal inputs (activity·race·body·nutrition, near+long) → Coach generates → you edit; output flows to Calendar + Today | **Glance/read-only** (what's next, surfaced in Today/Calendar) | **Primary tab — full authoring (web-only editing)** | Workshop |
| – | **Body** (Core + Labs) | DEXA / VO₂ / RMR / bloods reference | "More" | Tab(s) | Reference |
| – | **Stack** (supplements/bioactives) | The bio stack (the buttons Emil taps) | "More" / quick-add | Tab | Compact |
| – | **Profile** | Settings | "More" | Tab | — |

**Trend:** not a surface. Folds into **EdgeIQ** as its depth tier (Emil rarely uses the standalone
Trend; migrate any valued visuals into EdgeIQ, retire the rest).

---

## Naming decisions (locked)
- **Home = "Start"** on BOTH platforms (Emil, firm — not "Today").
- **"EdgeIQ" = the intelligence/analysis surface** (Screen 2). The name means "intelligence edge" —
  it belongs on the deep surface, not the home.
- **Play and Fuel = separate primary tabs on mobile** (not merged into a "Daily").
- Fixes the current backwards wiring (web "EdgeIQ" tab → Start component; web "Trend" → EdgeIQ
  component): make the home tab actually named **Start**, and the analysis tab actually **EdgeIQ**.
- **Mobile bottom bar (5):** Start · EdgeIQ · Play · Fuel · Calendar. Plan(web-only), Body(Core/Labs),
  Stack, Profile reached via a top-right menu / "More". Coach is ambient, not a tab.

## Density per surface (the doctrine, applied)
- **Today** — medium: one readiness hero + the why + today's plan/fuel summary. Stay glanceable;
  do **not** let it become the full dashboard (that's EdgeIQ's job).
- **EdgeIQ** — high governed density: hero anchor + clustered domains + small-multiples trend wall,
  color = exceptions only, tabular alignment, fills the canvas. (Prototype:
  `mockups/edgeiq-governed-density.html`.)
- **Daily (Play+Fuel)** — detail + **reward**: the activity card + nutrition targets illuminating;
  designed to *feel* like accomplishment (rings/closure), not a data form.
- **Calendar/Plan** — structured scheduling/authoring density.
- **Body/Stack/Profile** — reference density, reached on demand ("More").

---

## Everything else (secondary surfaces) — proposal to settle next
Beyond the locked spine, these remain. Proposed structure (Emil to confirm/adjust):

- **Body** — *proposal: merge today's `Core` + `Labs` into one "Body" surface.* The measured-body
  state: DEXA / VO₂max / RMR / body-comp **and** bloods/biomarkers — they answer one question
  ("what does my body measure at?") and splitting them is legacy. Web: a tab. Mobile: "More".
  **Open Q1: merge Core+Labs into "Body", or keep separate?**
- **Stack** (supplements / bioactives) — the daily stack Emil actually taps. Needs quick access.
  *Proposal: keep as its own surface but also expose a quick-add; consider whether it lives near
  Fuel (nutrition-adjacent).* **Open Q2: standalone, or folded under Fuel?**
- **Plan** — the authoring "factory" (goals → Coach generates → edit). **Web-only** (lean-back).
  Mobile sees the *output* (Start/Calendar), not the editor.
- **Profile / Admin** — settings, data/sync, backup, danger zone (the Profile-E reorg). *Proposal:
  **web-primary** (admin is a lean-back task); mobile keeps only essential toggles.*
  **Open Q3: Profile/Admin web-only, or a thin mobile version too?**

Once Q1–Q3 are settled we have the complete platform inventory; *then* design + polish.

---

## What's wrong today (the tangle this replaces)
- Web tab **labelled "EdgeIQ"** renders `TrainingTab` (internally "Start").
- Web tab **labelled "Trend"** renders `EdgeIQ.jsx` (the real EdgeIQ).
- The word "EdgeIQ" points at different screens across platforms; "Start" exists only on mobile.
- Plan tab is a grab-bag (GoalsHub + PlanGenerator + Workbench); race entry scattered.
- (Play/Fuel: kept primary as the **Daily** reward surface — reaffirmed 2026-06-14 — they're the
  accomplishment loop, not just logging.)

---

## Active threads spun out of this
- **Plan-as-factory** — move race *entry* to Calendar; make Plan the goal→generate→edit workshop.
  This IS the roadmap #3 (Coach as planner) + #4 (live re-solve) work — see `ROADMAP_NEXT_2026-06.md`.
- **Trend → EdgeIQ migration** — audit old Trend visuals, migrate the keepers, retire the rest.
- **Rebrand exploration (Emil):** the *stacking/compounding* metaphor ("stack each day → complete
  hybrid athlete") is a keeper as the core narrative/tagline. "Stack" itself rejected as the product
  name (too generic; weak trademark/discoverability; collides with the existing Stack/supplements
  tab). **Now exploring ownable names that carry the same notion.** Working shortlist (carry stack /
  layer / compound / accumulate): **Cairn** (stacked trail-marker stones → stacked days + summit),
  **Strata** (layers over time; premium/scientific, fits the engine), **Ledger** (every action
  logged + compounded; ties to the engine's two-ledger model). Others on the bench: Compound,
  Keystone, Tally, Course, Accrue, Mettle/Forge (strength-leaning). Next: availability + trademark +
  app-store scan on the finalists. Status: **name under exploration; logo decision should FOLLOW the
  name** (logo serves the chosen name/metaphor).

---

## How we use this
Every screen design from here references this contract: state which surface it is, its one job, and
its density tier. If a proposed element doesn't fit the surface's job, it belongs on a different
surface (or as a drill-down) — not crammed in. The IA is the contract; the density doctrine is how
each surface is rendered.
