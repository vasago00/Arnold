// ─── ARNOLD Narrative Scenarios — Fixture Library ──────────────────────────
//
// Phase 4r.narrative.2.1 (2026-05-25). Hand-built userState snapshots that
// drive specific narrative paths. Lets the user inspect how the composer
// reads each canonical situation without having to wait for their own
// signals to drift into a problematic state.
//
// Each fixture is a minimal coachSignals object — only the fields the
// composer reads. Real userState carries far more (numbers, trust, phase,
// etc.) but the narrative engine only uses coachSignals so we can mock
// just that surface.
//
// Usage:
//   window.narrativeDebug()                              // your real data
//   window.narrativeScenarios()                          // list fixtures
//   window.narrativeDebug({ scenario: 'sleep-leverage' })// see this fixture
//   window.narrativeDebug({ scenario: 'all' })           // print all fixtures
//
// When adding a scenario: pick a CANONICAL situation we want to verify the
// engine handles well. Don't fixture noise. Each scenario doubles as a
// regression test — if the prose stops reading right, we know which path
// regressed.

const today = new Date().toISOString().slice(0, 10);

// Default goal-progress block — populates with a generic on-pace cut so
// scenarios that don't override it still produce a coherent macro paragraph.
const ON_PACE_CUT = {
  status: 'on-pace',
  goalKind: 'cut',
  currentLbs: 178,
  targetLbs: 172,
  remainingLbs: 6.0,
  actualRatePerWeek: 0.6,
  progressRatePerWeek: 0.6,
  requiredRatePerWeek: 0.65,
  paceRatio: 0.92,
  weeksToGoalAtActualRate: 10.0,
  weeksToGoalAtRequiredRate: 9.2,
  weeksSpanned: 4.0,
  n: 8,
};

// Shared "noise floor" — signals that aren't part of the story but that
// the composer might read for graph values. Each fixture spreads this
// then overrides specific signals to drive its scenario.
const QUIET_BASE = {
  asOf: today,
  sleepDebt:      { status: 'paid',  debt7d: 0.8, avgHours7d: 7.7, targetHours: 7.5, nightsBelow7d: 1 },
  hrvDepression:  { status: 'normal', latest: 46, baseline28d: 46, depressionMs: 0, depressionPct: 0, consecutiveDepressedDays: 0, n: 60 },
  rhrDrift:       { status: 'stable', latest: 52, baseline28d: 52, slopeBpmPerWeek: 0.1 },
  recoveryVelocity: { status: 'stable', avgDaysToRecover: 1.8, baselineAvg: 1.8, driftDays: 0, driftPct: 0, nRecent: 4, nBaseline: 3 },
  tdeeDrift:      { status: 'stable', recentTdee: 2500, baselineTdee: 2500, driftKcal: 0, driftPct: 0, confidence: 'high' },
  energyAvailability: { status: 'sufficient', eaKcalPerKgLBM: 42, netKcal: 2800, lbmKg: 66 },
  glycogen:       { status: 'replete', adequacyRatio: 1.3, supplied24h: 320, need24h: 250, confidence: 'medium' },
  polarization:   { status: 'polarized', easyPct: 80, moderatePct: 8, hardPct: 12, nActivities: 6, windowDays: 28 },
  sleepQuality:   { status: 'restorative', targetsMet: 4, deepAvgPct: 17, remAvgPct: 22, effAvgPct: 91, awakeAvg: 2, n: 7 },
  monotonyStrain: { status: 'balanced', monotony: 1.2, weeklyLoad: 380 },
  // Personalization signals (used by aligned-state callouts)
  sleepHrvCorrelation: { surfaceable: false },
  sleepRhrCorr:        { surfaceable: false },
  sleepRunQualityCorr: { surfaceable: false },
  deficitHrvCorr:      { surfaceable: false },
  loadSleepCorr:       { surfaceable: false },
  dowPatterns:         { status: 'subtle' },
  upcomingPlan:        { status: 'insufficient', next7Days: [] },
  goalProgress:        ON_PACE_CUT,
  raceHorizon:         { status: 'general', phase: 'general', phaseLabel: 'General training', race: null, weeksOut: null, daysOut: null, phaseConflict: null },
};

// Pre-built raceHorizon shapes for the scenario fixtures.
function makeRace(name, daysOut, type='hyrox') {
  const d = new Date(); d.setDate(d.getDate() + daysOut);
  return {
    name, type,
    date: d.toISOString().slice(0, 10),
    distanceKm: null, distanceMi: null,
  };
}
const RACE_HORIZON_TAPER = (cut=false) => ({
  status: 'taper', phase: 'taper', phaseLabel: 'Taper',
  race: makeRace('HYROX London', 14), weeksOut: 2.0, daysOut: 14,
  recovering: false, phaseConflict: cut ? 'cut-vs-taper' : null,
});
const RACE_HORIZON_RACE_WEEK = (cut=false) => ({
  status: 'race-week', phase: 'race-week', phaseLabel: 'Race week',
  race: makeRace('HYROX London', 4), weeksOut: 0.6, daysOut: 4,
  recovering: false, phaseConflict: cut ? 'cut-vs-race-week' : null,
});
const RACE_HORIZON_BUILD = () => ({
  status: 'build', phase: 'build', phaseLabel: 'Build',
  race: makeRace('HYROX London', 56), weeksOut: 8.0, daysOut: 56,
  recovering: false, phaseConflict: null,
});
const RACE_HORIZON_RECOVERY = () => ({
  status: 'recovery', phase: 'recovery', phaseLabel: 'Post-race recovery',
  race: makeRace('HYROX London', -5), weeksOut: -0.7, daysOut: -5,
  recovering: true, phaseConflict: null,
});

// ─── Scenario fixtures ──────────────────────────────────────────────────────

export const NARRATIVE_SCENARIOS = {

  // ── The textbook leverage point we've been writing prose against. ──
  'sleep-leverage': {
    label: 'Sleep is the leverage — debt + HRV + recovery all firing',
    description: 'Moderate sleep debt has pulled HRV down and lengthened recovery velocity. Classic single-cause-many-effects pattern. Composer should pick sleepDebt as leverage and stitch a single flowing chain.',
    coachSignals: {
      ...QUIET_BASE,
      sleepDebt:        { status: 'moderate', debt7d: 4.2, avgHours7d: 6.9, targetHours: 7.5, nightsBelow7d: 5 },
      hrvDepression:    { status: 'mild', latest: 38, baseline28d: 46, depressionMs: 8, depressionPct: 17, consecutiveDepressedDays: 3, n: 60 },
      rhrDrift:         { status: 'rising', latest: 55, baseline28d: 52, slopeBpmPerWeek: 0.7 },
      recoveryVelocity: { status: 'slowing', avgDaysToRecover: 2.4, baselineAvg: 1.8, driftDays: 0.6, driftPct: 33, nRecent: 4, nBaseline: 3 },
    },
  },

  // ── Cut adaptation is the dominant story, not sleep. ──
  'cut-adaptation': {
    label: 'Cut is the leverage — TDEE drift + EA low + downstream HRV',
    description: 'TDEE has dropped 8% over 4 weeks (adapting) and EA today is low. HRV is mildly depressed but it traces to the cut, not sleep. Composer should pick tdeeDrift as leverage.',
    coachSignals: {
      ...QUIET_BASE,
      tdeeDrift:          { status: 'adapting', recentTdee: 2320, baselineTdee: 2520, driftKcal: -200, driftPct: -7.9, confidence: 'high' },
      energyAvailability: { status: 'low', eaKcalPerKgLBM: 34, netKcal: 2244, lbmKg: 66 },
      hrvDepression:      { status: 'mild', latest: 42, baseline28d: 46, depressionMs: 4, depressionPct: 9, consecutiveDepressedDays: 2, n: 60 },
    },
  },

  // ── Polarization grey-zone — training-quality leverage. ──
  'grey-zone': {
    label: 'Grey-zone training — polarization is the leverage',
    description: 'Polarization in the grey-zone band (28% Z3) is dragging recovery. Composer should pick polarization as leverage even though it has a softer severity than acute concerns.',
    coachSignals: {
      ...QUIET_BASE,
      polarization:     { status: 'grey-zone', easyPct: 58, moderatePct: 28, hardPct: 14, nActivities: 7, windowDays: 28 },
      recoveryVelocity: { status: 'slowing', avgDaysToRecover: 2.2, baselineAvg: 1.8, driftDays: 0.4, driftPct: 22, nRecent: 4, nBaseline: 3 },
    },
  },

  // ── Glycogen depletion before tomorrow's hard session. ──
  'glycogen-critical': {
    label: 'Glycogen critical — fuel timing leverage',
    description: 'Carb supply 24h is 40% of need after a Z4-5-heavy day. Immediate action signal: eat now or tomorrow underperforms.',
    coachSignals: {
      ...QUIET_BASE,
      glycogen: { status: 'critical', adequacyRatio: 0.42, supplied24h: 160, need24h: 380, confidence: 'medium',
                  breakdown: { z45Min: 32, z3Min: 0, z2Min: 60, baselineG: 150, carbsLoggedG: 230, carbsTimingSource: 'per-meal' } },
    },
  },

  // ── Multi-thread stress test — sleep + cut + training all firing. ──
  // The composer should pick ONE leverage point and weave 1-2 secondary
  // thread paragraphs. Verifies the secondary-thread composition path.
  'multi-thread': {
    label: 'Multi-thread — sleep + cut + training all flagged',
    description: 'Sleep debt moderate AND TDEE adapting AND polarization grey-zone. Tests how the composer picks one leverage and surfaces the other two as secondary threads.',
    coachSignals: {
      ...QUIET_BASE,
      sleepDebt:          { status: 'moderate', debt7d: 3.8, avgHours7d: 6.95, targetHours: 7.5, nightsBelow7d: 5 },
      hrvDepression:      { status: 'mild', latest: 41, baseline28d: 46, depressionMs: 5, depressionPct: 11, consecutiveDepressedDays: 2, n: 60 },
      recoveryVelocity:   { status: 'slowing', avgDaysToRecover: 2.3, baselineAvg: 1.8, driftDays: 0.5, driftPct: 28, nRecent: 4, nBaseline: 3 },
      tdeeDrift:          { status: 'adapting', recentTdee: 2350, baselineTdee: 2500, driftKcal: -150, driftPct: -6, confidence: 'medium' },
      energyAvailability: { status: 'low', eaKcalPerKgLBM: 36, netKcal: 2376, lbmKg: 66 },
      polarization:       { status: 'grey-zone', easyPct: 60, moderatePct: 26, hardPct: 14, nActivities: 8, windowDays: 28 },
    },
  },

  // ── Overreaching territory — multiple severe signals. ──
  'overreaching': {
    label: 'Overreaching — RHR climb + HRV depressed + recovery concerning',
    description: 'The classic overreaching constellation. Tests how the composer handles a severe leverage point with corroborating downstream evidence.',
    coachSignals: {
      ...QUIET_BASE,
      sleepDebt:        { status: 'mild', debt7d: 2.0, avgHours7d: 7.2, targetHours: 7.5, nightsBelow7d: 3 },
      rhrDrift:         { status: 'concerning', latest: 60, baseline28d: 52, slopeBpmPerWeek: 1.8 },
      hrvDepression:    { status: 'moderate', latest: 34, baseline28d: 46, depressionMs: 12, depressionPct: 26, consecutiveDepressedDays: 6, n: 60 },
      recoveryVelocity: { status: 'concerning', avgDaysToRecover: 3.1, baselineAvg: 1.8, driftDays: 1.3, driftPct: 72, nRecent: 4, nBaseline: 3 },
      monotonyStrain:   { status: 'high-strain', monotony: 2.1, weeklyLoad: 620 },
    },
  },

  // ── Quality sleep problem with adequate hours. ──
  // Tests the sleep-quality vs sleep-debt distinction.
  'fragmented-sleep': {
    label: 'Sleep quality — hours fine, architecture impaired',
    description: 'Duration is fine (7.4h avg) but sleep architecture is impaired (8% deep, 13% REM, 4 wake events/night). HRV is suffering as a result. The leverage isn\'t hours; it\'s quality.',
    coachSignals: {
      ...QUIET_BASE,
      sleepDebt:     { status: 'paid', debt7d: 1.0, avgHours7d: 7.4, targetHours: 7.5, nightsBelow7d: 2 },
      sleepQuality:  { status: 'impaired', targetsMet: 1, deepAvgPct: 8, remAvgPct: 13, effAvgPct: 87, awakeAvg: 4, n: 7,
                       weaknesses: [
                         { key: 'deep',  label: 'deep sleep', actual: '8%', target: '≥13%' },
                         { key: 'rem',   label: 'REM sleep',  actual: '13%', target: '≥18%' },
                         { key: 'awake', label: 'continuity', actual: '4 wakes/night', target: '≤3' },
                       ] },
      hrvDepression: { status: 'mild', latest: 41, baseline28d: 46, depressionMs: 5, depressionPct: 11, consecutiveDepressedDays: 3, n: 60 },
    },
  },

  // ── Everything's working — tests the aligned-state narrative. ──
  'aligned': {
    label: 'Aligned — nothing pulling against you',
    description: 'Every signal in the stable/sufficient/polarized/etc. band. Composer should produce the aligned-state narrative naming what\'s working.',
    coachSignals: {
      ...QUIET_BASE,
      recoveryVelocity: { status: 'improving', avgDaysToRecover: 1.5, baselineAvg: 1.8, driftDays: -0.3, driftPct: -17, nRecent: 5, nBaseline: 4 },
    },
  },

  // ── Cut stalled — macro signal that overrides today's micro story. ──
  'cut-stalled': {
    label: 'Cut stalled — macro signal becomes the story',
    description: 'Last 4 weeks averaged 0.15 lb/wk vs 0.65 lb/wk plan. Sleep + recovery + nutrition look fine in isolation, but the OUTCOME isn\'t happening. Tests the stalled macro paragraph + TDEE-drift secondary thread.',
    coachSignals: {
      ...QUIET_BASE,
      tdeeDrift:    { status: 'adapting', recentTdee: 2350, baselineTdee: 2520, driftKcal: -170, driftPct: -6.7, confidence: 'medium' },
      energyAvailability: { status: 'low', eaKcalPerKgLBM: 35, netKcal: 2310, lbmKg: 66 },
      goalProgress: {
        status: 'stalled',
        goalKind: 'cut',
        currentLbs: 178.8,
        targetLbs: 172,
        remainingLbs: 6.8,
        actualRatePerWeek: 0.15,
        progressRatePerWeek: 0.15,
        requiredRatePerWeek: 0.65,
        paceRatio: 0.23,
        weeksToGoalAtActualRate: 45.3,
        weeksToGoalAtRequiredRate: 10.5,
        weeksSpanned: 4.0,
        n: 8,
      },
    },
  },

  // ── Cut near goal — celebrate and prompt the transition. ──
  'cut-near-goal': {
    label: 'Near goal — transition to maintenance',
    description: '1.2 lbs from target, on pace. Tests the "achieved/near-achieved" macro paragraph and the transition prompt.',
    coachSignals: {
      ...QUIET_BASE,
      goalProgress: {
        status: 'on-pace',
        goalKind: 'cut',
        currentLbs: 173.2,
        targetLbs: 172,
        remainingLbs: 1.2,
        actualRatePerWeek: 0.55,
        progressRatePerWeek: 0.55,
        requiredRatePerWeek: 0.65,
        paceRatio: 0.85,
        weeksToGoalAtActualRate: 2.2,
        weeksToGoalAtRequiredRate: 1.8,
        weeksSpanned: 4.0,
        n: 8,
      },
    },
  },

  // ── Race week + still cutting — phase-conflict path. ──
  'race-week-cutting': {
    label: 'Race week + still cutting — phase conflict',
    description: 'HYROX in 4 days, user is still in active cut. Macro should pivot to "race-week dominant" and call out the cut-vs-race-week conflict. Cut should pause.',
    coachSignals: {
      ...QUIET_BASE,
      goalProgress: {
        status: 'on-pace', goalKind: 'cut',
        currentLbs: 176.5, targetLbs: 172, remainingLbs: 4.5,
        actualRatePerWeek: 0.6, progressRatePerWeek: 0.6, requiredRatePerWeek: 0.65,
        paceRatio: 0.92, weeksToGoalAtActualRate: 7.5, weeksToGoalAtRequiredRate: 6.9,
        weeksSpanned: 4.0, n: 8,
      },
      raceHorizon: RACE_HORIZON_RACE_WEEK(true),
    },
  },

  // ── Taper week + cut conflict ──
  'taper-with-cut': {
    label: 'Taper + cut overlap',
    description: 'HYROX in 2 weeks (taper phase), still cutting. Macro should flag the cut-vs-taper conflict and recommend a gentle cut + maintenance shift the week before.',
    coachSignals: {
      ...QUIET_BASE,
      goalProgress: {
        status: 'on-pace', goalKind: 'cut',
        currentLbs: 174.8, targetLbs: 172, remainingLbs: 2.8,
        actualRatePerWeek: 0.55, progressRatePerWeek: 0.55, requiredRatePerWeek: 0.5,
        paceRatio: 1.10, weeksToGoalAtActualRate: 5.1, weeksToGoalAtRequiredRate: 5.6,
        weeksSpanned: 4.0, n: 8,
      },
      raceHorizon: RACE_HORIZON_TAPER(true),
    },
  },

  // ── Build phase, on-pace cut, no conflicts ──
  'build-phase-with-cut': {
    label: 'Build phase + on-pace cut (no conflict)',
    description: 'HYROX in 8 weeks (build phase), cut is on pace. Macro should merge both signals into one paragraph: cut details + build-phase framing.',
    coachSignals: {
      ...QUIET_BASE,
      goalProgress: ON_PACE_CUT,
      raceHorizon: RACE_HORIZON_BUILD(),
    },
  },

  // ── Post-race recovery ──
  'post-race-recovery': {
    label: 'Post-race recovery — capacity returning',
    description: 'Race was 5 days ago. Macro should switch to recovery framing: no deficit, easy aerobic only, gradual return.',
    coachSignals: {
      ...QUIET_BASE,
      raceHorizon: RACE_HORIZON_RECOVERY(),
    },
  },

  // ── Cut ahead of pace — sustainability check. ──
  'cut-ahead': {
    label: 'Ahead of pace — sustainability watch',
    description: 'Losing 0.95 lb/wk vs 0.65 plan. Often a precursor to TDEE drop. Tests the ahead macro paragraph.',
    coachSignals: {
      ...QUIET_BASE,
      goalProgress: {
        status: 'ahead',
        goalKind: 'cut',
        currentLbs: 176.5,
        targetLbs: 172,
        remainingLbs: 4.5,
        actualRatePerWeek: 0.95,
        progressRatePerWeek: 0.95,
        requiredRatePerWeek: 0.65,
        paceRatio: 1.46,
        weeksToGoalAtActualRate: 4.7,
        weeksToGoalAtRequiredRate: 6.9,
        weeksSpanned: 4.0,
        n: 8,
      },
    },
  },

  // ── Aligned + a learned personal correlation. Tests the callouts slot. ──
  'aligned-with-personal-pattern': {
    label: 'Aligned + personalization callout',
    description: 'Same aligned-state as above, plus Arnold has surfaceable correlations and a meaningful DOW rhythm. Tests the personalization callouts in the aligned path.',
    coachSignals: {
      ...QUIET_BASE,
      recoveryVelocity: { status: 'improving', avgDaysToRecover: 1.5, baselineAvg: 1.8, driftDays: -0.3, driftPct: -17, nRecent: 5, nBaseline: 4 },
      dowPatterns: {
        status: 'meaningful',
        n: 78, overallMean: 46,
        lowestDow:  { dow: 1, label: 'Mon', n: 11, mean: 38, vsOverallMs: -8, vsOverallPct: -17 },
        highestDow: { dow: 3, label: 'Wed', n: 11, mean: 50, vsOverallMs: 4, vsOverallPct: 9 },
        spreadMs: 12, spreadPct: 26,
      },
      sleepHrvCorrelation: {
        surfaceable: true, n: 55, r: 0.42, slope: 4.2, pValue: 0.0015,
        insight: '+1h sleep ≈ +4.2ms HRV next day (n=55, r=0.42)',
      },
    },
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function listScenarios() {
  return Object.entries(NARRATIVE_SCENARIOS).map(([key, s]) => ({
    key, label: s.label, description: s.description,
  }));
}

export function getScenario(key) {
  return NARRATIVE_SCENARIOS[key] || null;
}

// Build a minimal userState shape from a scenario's coachSignals. The
// narrative composer only reads userState.coachSignals + userState.asOf,
// so this is all we need.
export function scenarioToUserState(key) {
  const s = getScenario(key);
  if (!s) return null;
  return {
    asOf: s.coachSignals.asOf || today,
    coachSignals: s.coachSignals,
    // Stub out the rest so destructured reads elsewhere don't NPE.
    activeGoalKinds: {},
    numbers: {},
    burdens: [],
    trust: {},
  };
}

if (typeof window !== 'undefined') {
  window.narrativeScenarios = function () {
    const list = listScenarios();
    console.log('=== NARRATIVE SCENARIOS ===');
    console.log(`${list.length} fixtures. Run window.narrativeDebug({ scenario: 'KEY' }) to see each one.\n`);
    for (const s of list) {
      console.log(`%c${s.key}`, 'color:#5eead4;font-weight:600', `— ${s.label}`);
      console.log(`  ${s.description}\n`);
    }
    return list;
  };
}
