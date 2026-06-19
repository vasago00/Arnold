// Story specs + surface profiles — the declarative contract between an activity
// and the screen. See docs/PRESENTATION_LAYER.md.
//
// STORY: per activity-kind, which metrics fill each semantic role. Static
// templates today; when the Coaching Team (COACHING_TEAM.md) lands, the arbiter
// EMITS this shape per day and the renderer is unchanged.
//
// Roles:
//   headline  — the single state the hero gauge expresses (load + zone). The
//               gauge is still a dedicated viz; the story just names its source.
//   primary   — the 2–3 metrics that define THIS session type's quality.
//   secondary — supporting detail shown when the surface has room. (Pass 1.)
//   context   — readiness/load framing shared across ALL kinds (rings, A:C);
//               lives outside the per-kind spec, same on every session.

export const STORY = {
  run:      { headline: 'load', primary: ['pace', 'effortIF', 'efficiency'] },
  strength: { headline: 'load', primary: ['density', 'workRest', 'effortPct'] },
  hybrid:   { headline: 'load', primary: ['density', 'workRest', 'effortPct'] },
  // Cycling cluster: quality metrics only — the gauge already expresses Load, so
  // we do NOT repeat it here (that "rTSS Load" tile next to the speedometer was
  // redundant). Power leads when a meter is present (Power · Effort · Efficiency);
  // a power-less indoor ride falls back to Effort · Avg HR.
  cycling:  { headline: 'load', primary: ['power', 'cyclingEffort', 'cyclingEff', 'cyclingAvgHR'] },
  mobility: { headline: 'load', primary: [] },
  rest:     { headline: 'load', primary: [] },
};

// Pick the session kind from the already-computed value bag. Run takes
// precedence (a run with rTSS is a run); otherwise strength/hybrid volume
// drives the strength story. Mirrors the heroes' existing run-vs-strength gate.
export function kindFromBag(bag) {
  if (bag.runMetrics && bag.runMetrics.rTSS) return 'run';
  if (bag.cyclingMetrics) return 'cycling';
  if (bag.strengthMetrics) return 'strength';
  return 'rest';
}

export function storyFor(kind) {
  return STORY[kind] || STORY.run;
}

// Convenience: the ordered primary metric ids for whatever this bag is.
export function primaryIdsFor(bag) {
  return storyFor(kindFromBag(bag)).primary;
}

// SURFACE PROFILES — HOW MUCH story a surface tells and at what density. The
// SAME story renders differently per surface because the PROFILE differs, not
// the JSX. Platform (web vs mobile) is just a different profile here.
export const SURFACE = {
  'play-hero':  { density: 'compact',     labels: 'short' }, // mobile Play hero
  'daily-hero': { density: 'comfortable', labels: 'full'  }, // web Daily hero
};

export function profileFor(surface) {
  return SURFACE[surface] || SURFACE['play-hero'];
}
