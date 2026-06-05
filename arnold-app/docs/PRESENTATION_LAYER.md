# The Presentation Layer — the screens as the coaching team's voice

> Status: **VISION / DESIGN** (2026-06-04). Not yet built. This is the contract
> between the reasoning core and the pixels. It sits at layer 3 of the Coaching
> Team ("ONE VOICE (presentation)", COACHING_TEAM.md §3) and consumes the
> Intelligence Hub (INTELLIGENCE_HUB.md). It is the presentation analogue of
> METRIC_OVERLAP_AUDIT: that doc gave every metric ONE source of truth for its
> *value*; this doc gives every metric ONE source of truth for its *story and
> its rendering*. Read those three first.

## The problem (user, 2026-06-04)
> "We are managing different types of workouts and different views between the
> platform… the screens are now tools that the coaching team should be using to
> tell the story. We're making some of these decisions on the fly."

Today presentation is hand-authored for every combination of
**activity kind × surface × platform** — run vs strength vs HYROX vs mobility,
Daily vs Play vs EdgeIQ vs Start, web vs mobile. Each new combination is a fresh
pixel decision (row vs column, label length, what to show, what to cut). That is
why it feels ad-hoc: it *is*. Layer-1 metrics are wired straight to JSX with no
contract in between. "Should reps and tempo be side by side?" becomes a manual
edit in two files instead of a property of the model.

This does not scale (every workout type we add multiplies the surfaces to tune)
and it is not what the vision says the screens are for. The screens are meant to
be where the hub's reasoning is **told as a story**, not a grid we re-tune by
hand each time.

## The fix in one sentence
Insert a declarative layer between data and pixels: each activity **kind**
declares its **story** (which metrics matter, in what role and priority); a
single **responsive renderer** turns `{metrics, roles, surface}` into layout —
once, correctly, for every case.

## First principles
1. **The screen renders a story, not a metric dump.** What appears is chosen by
   role and priority, not by "what data exists." A surface with less room drops
   the lowest-priority roles, never truncates randomly.
2. **One declaration per (kind → story); one renderer for all layout.** No
   caller ever sets `flexDirection`, gap, or label length. Those are decisions
   the renderer owns, derived from role + surface density.
3. **Platform = a density parameter, not a code fork.** Web and mobile call the
   same renderer with different density profiles. No duplicated JSX, no
   "mobile-only" layout drift.
4. **The story shape = the arbiter's output shape.** We hardcode the story specs
   now (static per kind); when the Coaching Team is built, the arbiter EMITS the
   story (which metric is primary *today*, the headline text) and the same
   renderer consumes it unchanged. Build the contract now, fill it with
   intelligence later.
5. **Single source of truth for format, not just value.** Extends
   METRIC_OVERLAP_AUDIT: each metric declares its formatter, unit, label (full +
   short), tier-color, tooltip in ONE place. "A:C zone" has one short-label map;
   "density" formats identically on every surface.

## The three pieces

### 1. Metric registry — one definition per metric (format SoT)
A map keyed by metric id. METRIC_OVERLAP_AUDIT fixed the *value* (one resolver,
one window); this adds the *presentation*:
```
density: {
  id: 'density',
  resolve: us => strengthMetrics(us).density,   // value SoT (existing)
  format: v => v?.toFixed(1) ?? '—',
  unit: sm => sm.densityUnit,                     // 'lb/min' | 'reps/min'
  label:      { full: 'Density',       short: 'Dens' },
  tier:       sm => ({ color, name }),            // color + tier word
  tooltip:    sm => '…',
}
```
Every surface that shows density imports this — the formatter, the unit, the
short label all live here, so "reps/min wrapping" or "Density vs Dens" is a
one-line change, globally.

### 2. Story contract — one declaration per activity kind
For each `activityKind` (run, strength, hybrid/HYROX, mobility, rest), declare
the ordered metrics with a **semantic role**:
```
run: {
  headline: 'rtss',                              // what the gauge centers on
  primary:  ['ngpPace', 'intensityFactor', 'efficiencyFactor'],
  secondary:['avgHR', 'duration', 'anaerobicTE'],
  context:  ['readiness7', 'readiness30', 'acwr'],   // shared, not session-specific
  message:  ctx => '…',                          // static template now; arbiter later
}
strength: {
  headline: 'tonnage' | 'load',
  primary:  ['density', 'workRest', 'effortPct'],
  secondary:['sets', 'reps', 'avgHR', 'duration'],
  context:  ['readiness7', 'readiness30', 'acwr'],
  message:  ctx => '…',
}
```
HYROX classifies to `hybrid` (already true via `isStrengthVolume`) → it gets the
hybrid story automatically. **Adding a workout type = one story entry, zero JSX.**

**Role vocabulary**
- `headline` — the single state the hero gauge expresses (load + zone).
- `primary` — the 2–3 metrics that define *this session type's quality*.
- `secondary` — supporting detail shown when the surface has room.
- `context` — readiness/load framing shared across ALL kinds (rings, A:C). Lives
  outside the per-kind spec; the same on every session.

### 3. Cluster renderer — one component owns all layout
`<MetricCluster metrics={…} role="primary" surface="play-hero" />` (or a
`<Hero story={…} surface={…}/>` that composes context + headline + primary).
It — and only it — decides direction, wrap, gap, truncation, and which label
variant to use. Inputs:
- **metrics** — already-resolved `{value, unit, label, tier}` from the registry.
- **role** — drives prominence (headline = big/centered; context = muted chips).
- **surface profile** — see below.

It guarantees: tiles self-size, never clip the card edge, wrap or drop by
priority (lowest role first) when space is tight. The reps/tempo and
"Under-training" wrap problems become impossible by construction — there is one
place that decides row-vs-column and one place that picks the short label.

## Surface profiles
A surface declares HOW MUCH story it tells and at what density. The same story
spec renders differently per surface because the *profile* differs, not the JSX.
```
'play-hero'  (mobile): density 'compact',     roles [context, headline, primary],     maxPrimary 3, labels 'short'
'daily-hero' (web):    density 'comfortable',  roles [context, headline, primary],     maxPrimary 3, labels 'full'
'edgeiq'     (web/mob):density 'comfortable',  roles [headline, primary, secondary],   …
'session-detail':      density 'expanded',     roles [headline, primary, secondary],   labels 'full', tooltips on
'start-tiles':         user-configured (METRIC_OVERLAP_AUDIT R7) — same registry feeds it
```
Density tiers map to concrete style tokens (font sizes, inline-vs-stacked unit,
gap). `compact` uses short labels + tight gaps; `expanded` uses full labels +
tooltips. Platform difference = picking a profile, nothing more.

## How it ties back to the hub
The story spec's `headline`/`primary`/`message` are **static templates today**
(we choose them from sport science + the current screens). That is already a big
win — one declaration replaces per-surface JSX. The deeper win comes when the
Coaching Team lands: the arbiter's per-day output (which thread matters, which
metric to foreground, the one-line message) becomes the story spec at runtime,
and the renderer is unchanged. So this layer is the **rendering contract the
arbiter writes to** — designing it now also pins down the arbiter's output shape
(COACHING_TEAM.md §"Each expert returns a structured RECOMMENDATION").

## Migration (incremental, low-regret)
- **Pass 0 — prove it on the hero.** Build the registry (just the metrics the
  hero uses), the `run`/`strength`/`hybrid` story specs, two surface profiles
  (`play-hero`, `daily-hero`), and `MetricCluster`. Re-point BOTH the web Daily
  hero band and the mobile Play hero band at it. Outcome: web + mobile heroes are
  the SAME component with different profiles; reps/tempo + label-wrap decisions
  become declarations; the two heroes can never drift again.
- **Pass 1 — spread.** EdgeIQ, session detail panels, Start tiles consume the
  same registry + renderer.
- **Pass 2 — intelligence.** Arbiter emits story specs; templates become live
  reasoning. No renderer changes.

## Open decisions (for Emil — to settle before Pass 0)
1. **Scope of Pass 0** — hero band only (recommended), or hero + EdgeIQ in one go?
2. **Where the code lives** — new `src/core/presentation/` (registry + story
   specs as data) + `src/components/MetricCluster.jsx`, or co-locate specs with
   `activityClass.js`?
3. **Density: auto or fixed?** — container-query/measure-driven responsive
   (more robust, more work) vs fixed profile per surface (simpler, we pick the
   breakpoint). Recommend fixed profiles first, add measurement later if needed.
4. **Role vocabulary depth** — ship all four roles now, or start with
   `context + headline + primary` and add `secondary` when EdgeIQ needs it?
5. **Message ownership** — keep `message` out of Pass 0 (the Coach already
   speaks via CoachComment) and add it when the arbiter exists, or template it
   now for parity?

## Non-negotiables (carry into the build)
- No caller sets layout primitives (direction/gap/label length). The renderer owns them.
- One registry entry per metric; one story spec per kind; one renderer for all.
- Platform is a profile, never a code fork.
- The contract shape must be what the arbiter can emit (forward-compatible with COACHING_TEAM.md).
- Values still flow from the METRIC_OVERLAP_AUDIT resolvers — this layer formats and arranges, it does not recompute.
